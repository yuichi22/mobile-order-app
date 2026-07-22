// salesSync.js
// 店舗の取引(stores/{id}/transactions)を Akuto Core の売上受信口へ同期する。
// - 対象: settings/terminal に coreTenantId/coreSpaceId が設定済みの店舗のみ（Terminal連携と同じマッピングを流用）
// - 差分: stores/{id}/settings/coreSales.lastPaidAtMs 以降の paidAt のみ送る
// - 冪等: 取引IDを Core 側ドキュメントIDにする（再送しても同内容の上書きのみ）
// - 認証: Authorization: Bearer <CORE_SALES_SECRET>（Core 側は CRM_WEBHOOK_SECRET と同値運用）
// - 実行: 毎時スケジュール syncSalesToCore ＋ 手動キック runSalesSyncNow(同Bearer保護・dev検証用)
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const PAGE_LIMIT = 500; // 1店舗・1回あたりの最大取引数（残りは次回実行で追随）
const POST_CHUNK = 100; // 1リクエストに載せる取引数

const str = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// JSTの YYYY-MM-DD
const jstDate = (date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// 取引 → Core 送信イベントへ正規化（フィールド欠落に寛容）
function normalizeTx(storeId, link, txId, tx) {
  const paidAt = tx.paidAt?.toDate ? tx.paidAt.toDate() : null;
  if (!paidAt) return null;
  const items = Array.isArray(tx.items) ? tx.items : [];
  const lines = items.map((it) => ({
    item: str(it?.name) || "(名称なし)",
    qty: num(it?.quantity) || 1,
    unitPrice: num(it?.unitPrice ?? it?.price),
    taxRate: it?.taxRate != null ? num(it.taxRate) : null,
  }));
  return {
    tenantId: str(link.coreTenantId),
    spaceId: str(link.coreSpaceId),
    txId: str(txId),
    storeId: str(storeId),
    app: "pos",
    date: jstDate(paidAt),
    paidAt: paidAt.toISOString(),
    totalInclTax: num(tx.totalAmount ?? tx.totalPrice ?? tx.amount),
    payment: str(tx.paymentMethodGroup || tx.paymentMethod) || "その他",
    lines,
  };
}

async function postEvents(events) {
  const url = str(process.env.CORE_SALES_URL);
  const secret = str(process.env.CORE_SALES_SECRET);
  if (!url || !secret) throw new Error("CORE_SALES_URL / CORE_SALES_SECRET が未設定です。");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ source: "mobile_order", events }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Core sales endpoint ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

// 1店舗分を同期。処理した件数を返す。
async function syncStore(storeDoc) {
  const storeId = storeDoc.id;
  const linkSnap = await db.doc(`stores/${storeId}/settings/terminal`).get();
  const link = linkSnap.exists ? linkSnap.data() : null;
  if (!str(link?.coreTenantId) || !str(link?.coreSpaceId)) return { storeId, skipped: "unlinked" };

  const stateRef = db.doc(`stores/${storeId}/settings/coreSales`);
  const stateSnap = await stateRef.get();
  const lastPaidAtMs = num(stateSnap.exists ? stateSnap.data()?.lastPaidAtMs : 0);

  const txSnap = await db
    .collection(`stores/${storeId}/transactions`)
    .where("paidAt", ">", Timestamp.fromMillis(lastPaidAtMs))
    .orderBy("paidAt", "asc")
    .limit(PAGE_LIMIT)
    .get();

  if (txSnap.empty) return { storeId, sent: 0 };

  const events = [];
  let maxPaidAtMs = lastPaidAtMs;
  for (const d of txSnap.docs) {
    const ev = normalizeTx(storeId, link, d.id, d.data());
    if (!ev) continue;
    events.push(ev);
    const ms = d.data().paidAt.toMillis();
    if (ms > maxPaidAtMs) maxPaidAtMs = ms;
  }

  for (let i = 0; i < events.length; i += POST_CHUNK) {
    await postEvents(events.slice(i, i + POST_CHUNK));
  }

  await stateRef.set(
    { lastPaidAtMs: maxPaidAtMs, lastSyncedAt: Timestamp.now(), lastSentCount: events.length },
    { merge: true }
  );
  return { storeId, sent: events.length, hasMore: txSnap.size === PAGE_LIMIT };
}

async function runSalesSync() {
  // listDocuments: サブコレクションだけ持つ「幻の親ドキュメント」も列挙できる
  //（stores/{id} は本体docが無く settings/transactions のみのケースがあるため .get() では取れない）
  const storeRefs = await db.collection("stores").listDocuments();
  const results = [];
  for (const ref of storeRefs) {
    try {
      results.push(await syncStore(ref));
    } catch (e) {
      console.error(`[salesSync] store ${ref.id} failed:`, e);
      results.push({ storeId: ref.id, error: e?.message || String(e) });
    }
  }
  console.log("[salesSync] done:", JSON.stringify(results));
  return results;
}

// 毎時同期
export const syncSalesToCore = onSchedule(
  { region: REGION, schedule: "every 60 minutes", timeZone: "Asia/Tokyo" },
  async () => {
    await runSalesSync();
  }
);

// 手動キック（dev検証用。Core と同じ Bearer で保護）
export const runSalesSyncNow = onRequest({ region: REGION }, async (req, res) => {
  const secret = str(process.env.CORE_SALES_SECRET);
  const authz = req.get("authorization") || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length) : "";
  if (!secret || bearer !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const results = await runSalesSync();
  res.json({ ok: true, results });
});
