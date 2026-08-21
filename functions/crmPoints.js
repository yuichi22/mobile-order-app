// crmPoints.js
// 会計確定を Akuto Core の CRM へ通知してポイントを付与する。
// 会計の確定はクライアント側で3経路(PosRegister / PosMain / 返品のマイナス伝票)あるため、
// transactions の作成トリガで一本化する。レジUIには一切触らない。
//
// 会員の特定は当面 groom 会計依頼が運んでくる personId のみ（レジでの会員コード読取は次段）。
// personId が無い会計＝会員が特定できないので何もしない。
// 返品(isReversal)は totalAmount がマイナスなので、同じ経路でポイントも自動的に戻る。
// Core 側は Idempotency-Key(txId) で冪等なので、トリガの at-least-once 再発火でも二重付与しない。
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 会計金額(税込)。salesSync と同じ優先順で拾う。 */
function pickTotal(tx) {
  const cand = [tx?.totalAmount, tx?.totalPrice, tx?.amount];
  for (const v of cand) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

export const onTransactionCreatedSyncCrmPoints = onDocumentCreated(
  { region: REGION, database: DB_ID, document: "stores/{storeId}/transactions/{txId}" },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;
    const tx = snap.data() || {};
    const { storeId, txId } = event.params;

    // 対象外の伝票（salesSync と同じ判定）
    if (tx.isPaid === false) return;              // 締め前取消
    if (tx.isMethodAdjustment === true) return;   // 支払方法の付替え（売上ではない）

    // 会員の特定。personId が最優先だが、⚠groom会計依頼は「初回来店の顧客」だと
    // personId=null で届く（中央の person は予約完了イベントが非同期で作るため間に合わない）。
    // その場合でも伝票は lineUserId を持っているので、Core 側に名寄せさせる。
    const personId = str(tx.personId);
    const lineUserId = str(tx.crmLineUserId);
    if (!personId && !lineUserId) return; // どちらも無ければ会員不明＝対象外

    const amount = pickTotal(tx);
    if (amount === 0) return;

    const url = str(process.env.CORE_CRM_POINTS_URL);
    const secret = str(process.env.CORE_SALES_SECRET);
    if (!url || !secret) {
      console.warn("[crmPoints] CORE_CRM_POINTS_URL / CORE_SALES_SECRET が未設定のため送信しません。");
      return;
    }

    // 店舗 → Core の拠点（対応は settings/terminal が唯一の出所。クライアントは信用しない）
    const termSnap = await db.collection("stores").doc(storeId).collection("settings").doc("terminal").get();
    const term = termSnap.exists ? termSnap.data() || {} : {};
    const coreTenantId = str(term.coreTenantId);
    const coreSpaceId = str(term.coreSpaceId);
    if (!coreTenantId) return; // Core 未連携の店舗

    const paidAt = tx.paidAt?.toDate ? tx.paidAt.toDate() : null;

    const payload = {
      coreTenantId,
      coreSpaceId: coreSpaceId || null,
      sourceKey: storeId,
      // 空文字は送らない（Core 側で「指定あり」と誤認させないため）
      ...(personId ? { personId } : {}),
      ...(!personId && lineUserId ? { lineUserId } : {}),
      amount: num(amount),
      type: tx.isReversal === true ? "pos_reversal" : "pos",
      provider: "pos",
      brand: str(tx.departmentName) || null,
      at: (paidAt || new Date()).toISOString(),
      bookingId: str(tx.groomBookingId) || null,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
          "Idempotency-Key": str(txId),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[crmPoints] Core応答NG", res.status, body.slice(0, 200), { storeId, txId });
        return;
      }
      const json = await res.json().catch(() => ({}));
      console.log("[crmPoints] 付与", {
        storeId, txId,
        person: personId || `(line経由)${json?.personId ?? ""}`,
        points: json?.points, duplicate: json?.duplicate, awarded: json?.awarded,
      });
    } catch (e) {
      // Core 側の一時障害でレジ運用を止めない（売上は Firestore に確定済み）
      console.error("[crmPoints] 送信失敗", e?.message, { storeId, txId });
    }
  }
);
