/**
 * Webからのテイクアウト注文を受け取る。
 *
 * ⚠⚠ 設計の芯: **クライアントから来た金額・可否・締め切りを一切信じない。**
 *   すべて Firestore の現物から取り直して検証する。サイトの表示が古かったり、
 *   誰かがリクエストを細工したりしても、店が損をしないようにするため。
 *
 * ⚠ 注文は `orders` ではなく `takeoutOrders` に入れる。
 *   キッチンの注文ボードは orders を全件購読しているので、そこへ入れると
 *   2日後の受け取り分まで「いま作るもの」として並んでしまう。
 *   キッチンではサイドペインに別枠で出す。
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const db = getFirestore("main");

/** ⚠ Slack通知用。値はSecret Managerに置く（コードにもGitにも書かない）。 */
const SLACK_WEBHOOK_URL = defineSecret("TAKEOUT_SLACK_WEBHOOK_URL");

const ALLOWED_ORIGINS = [
  "https://haus.ne.jp",
  "https://www.haus.ne.jp",
  "https://haus-site--suomin-prod.asia-east1.hosted.app",
  "http://localhost:3700",
];

/** ⚠ publicSite.js の PUBLIC_STORES と揃えること。公開対象の店だけ受け付ける。 */
const ACCEPTING_STORES = {
  store_ar2y9: { name: "CAFE TABLE HAUS", tel: "0852-61-5888" },
};

// ⚠ サイト側(takeoutSlots.ts / TakeoutOrder.tsx)と同じ値にすること。
//   ここが本当の関門で、サイト側は親切のための表示にすぎない。
const LIMITS = {
  maxQuantity: 10,
  maxAmount: 20000,
  pickupFromMinutes: 11 * 60 + 30,
  pickupToMinutes: 19 * 60 + 30,
  slotStepMinutes: 30,
  defaultLeadMinutes: 180,
  maxDaysAhead: 14,
};

const str = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

/** 日本時間の「その日の0時0分からの分数」。⚠ サーバーのタイムゾーンに依存させない。 */
function jstMinutesOfDay(date) {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
}

export const createTakeoutOrder = onRequest(
  { region: REGION, cors: false, invoker: "public", secrets: [SLACK_WEBHOOK_URL] },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    try {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const storeId = str(body.storeId);
      const store = ACCEPTING_STORES[storeId];
      if (!store) return res.status(404).json({ error: "store_not_public" });

      // ── お客様の情報 ───────────────────────────────
      const name = str(body.name).slice(0, 40);
      const telRaw = str(body.tel).replace(/[-\s]/g, "");
      const note = str(body.note).slice(0, 200);
      if (!name) return res.status(400).json({ error: "name_required" });
      // ⚠ 固定電話も携帯も受ける。国際表記や内線は受けない。
      if (!/^0\d{8,10}$/.test(telRaw)) {
        return res.status(400).json({ error: "tel_invalid" });
      }

      // ── 店舗の契約と設定 ─────────────────────────────
      const basicSnap = await db.doc(`stores/${storeId}/settings/basic`).get();
      const basic = basicSnap.data() || {};
      if (basic.webOrderEnabled !== true || basic.allowTakeout === false) {
        return res.status(403).json({ error: "web_order_disabled" });
      }

      // ── 品目 ───────────────────────────────────
      const rawItems = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
      if (rawItems.length === 0) return res.status(400).json({ error: "cart_empty" });

      const snaps = await Promise.all(
        rawItems.map((i) => db.doc(`stores/${storeId}/menuItems/${str(i.id)}`).get())
      );

      const items = [];
      let totalQuantity = 0;
      let totalAmount = 0;
      let leadMinutes = LIMITS.defaultLeadMinutes;

      for (let i = 0; i < rawItems.length; i += 1) {
        const snap = snaps[i];
        const quantity = Math.floor(num(rawItems[i].quantity) ?? 0);
        if (quantity <= 0) continue;
        if (!snap.exists) return res.status(409).json({ error: "item_not_found" });

        const v = snap.data() || {};
        // ⚠ サイトに出す条件とまったく同じ。ここが最後の関門。
        const price = num(v.takeoutPrice) ?? 0;
        if (v.webOrderEnabled !== true || v.allowsTakeout === false || price <= 0) {
          return res.status(409).json({ error: "item_not_orderable", name: str(v.name) });
        }
        if (v.isSoldOut === true) {
          return res.status(409).json({ error: "item_sold_out", name: str(v.name) });
        }

        totalQuantity += quantity;
        totalAmount += price * quantity;
        leadMinutes = Math.max(
          leadMinutes,
          num(v.webOrderLeadMinutes) || LIMITS.defaultLeadMinutes
        );

        items.push({
          menuItemId: snap.id,
          name: str(v.name),
          categoryId: str(v.category),
          quantity,
          // ⚠ 単価はFirestoreの現物。クライアントの値は使わない。
          unitPrice: price,
          totalPrice: price * quantity,
        });
      }

      if (items.length === 0) return res.status(400).json({ error: "cart_empty" });
      if (totalQuantity > LIMITS.maxQuantity) {
        return res.status(400).json({ error: "too_many_items", max: LIMITS.maxQuantity });
      }
      if (totalAmount > LIMITS.maxAmount) {
        return res.status(400).json({ error: "amount_too_large", max: LIMITS.maxAmount });
      }

      // ── 受け取り日時 ───────────────────────────────
      const pickupAt = new Date(str(body.pickupAt));
      if (Number.isNaN(pickupAt.getTime())) {
        return res.status(400).json({ error: "pickup_invalid" });
      }
      const now = new Date();
      // ⚠ 締め切りを満たしているか。サイト側の選択肢を信じない。
      if (pickupAt.getTime() < now.getTime() + leadMinutes * 60 * 1000) {
        return res.status(409).json({ error: "pickup_too_soon", leadMinutes });
      }
      if (
        pickupAt.getTime() >
        now.getTime() + (LIMITS.maxDaysAhead + 1) * 24 * 3600 * 1000
      ) {
        return res.status(400).json({ error: "pickup_too_far" });
      }
      const mod = jstMinutesOfDay(pickupAt);
      if (
        mod < LIMITS.pickupFromMinutes ||
        mod > LIMITS.pickupToMinutes ||
        mod % LIMITS.slotStepMinutes !== 0
      ) {
        return res.status(400).json({ error: "pickup_out_of_window" });
      }

      // ── 保存 ───────────────────────────────────
      const ref = db.collection(`stores/${storeId}/takeoutOrders`).doc();
      await ref.set({
        source: "web",
        status: "pending",
        customerName: name,
        customerTel: telRaw,
        note,
        pickupAt: Timestamp.fromDate(pickupAt),
        leadMinutes,
        items,
        totalQuantity,
        totalAmount,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // ⚠ Slack通知は「送れなくても注文は成立させる」。通知の失敗で
      //   お客様にエラーを返すと、実際には入っている注文を二重に出される。
      notifySlack({ store, name, telRaw, pickupAt, items, totalAmount, note }).catch(
        (err) => console.error("[createTakeoutOrder] slack失敗", err?.message)
      );

      return res.json({
        ok: true,
        orderId: ref.id,
        totalAmount,
        pickupAt: pickupAt.toISOString(),
      });
    } catch (err) {
      console.error("[createTakeoutOrder] failed", err);
      return res.status(500).json({ error: "internal" });
    }
  }
);

async function notifySlack({ store, name, telRaw, pickupAt, items, totalAmount, note }) {
  const url = SLACK_WEBHOOK_URL.value();
  if (!url || !url.startsWith("https://hooks.slack.com/")) return;

  const j = new Date(pickupAt.getTime() + 9 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
  const lines = items
    .map((i) => `・${i.name.replace(/\s*\n\s*/g, " ")} ×${i.quantity}　¥${i.totalPrice.toLocaleString()}`)
    .join("\n");

  const text = [
    `🍱 *テイクアウトのWeb注文* (${store.name})`,
    `*受け取り* ${when}`,
    `*お客様* ${name} 様 / ${telRaw}`,
    "",
    lines,
    `*合計* ¥${totalAmount.toLocaleString()}（店頭でお支払い）`,
    note ? `*ご要望* ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    console.error("[createTakeoutOrder] slack応答", res.status, await res.text());
  }
}
