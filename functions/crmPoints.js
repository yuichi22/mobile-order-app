// crmPoints.js
// 会計確定を Akuto Core の CRM へ通知してポイントを付与する。
// 会計の確定はクライアント側で3経路(PosRegister / PosMain / 返品のマイナス伝票)あるため、
// transactions の作成トリガで一本化する。レジUIには一切触らない。
//
// 会員の特定は当面 groom 会計依頼が運んでくる personId のみ（レジでの会員コード読取は次段）。
// personId が無い会計＝会員が特定できないので何もしない。
// 返品(isReversal)は totalAmount がマイナスなので、同じ経路でポイントも自動的に戻る。
// Core 側は Idempotency-Key(txId) で冪等なので、トリガの at-least-once 再発火でも二重付与しない。
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
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

/**
 * 会計(またはその取消)を Core CRM へ1件送る。冪等キー単位で Core が二重計上を防ぐ。
 * reversalOf がある場合は Core が「元の会計で実際に付いたポイント」から按分して戻す(倍率分も・LTVも)。
 */
async function sendPointEvent({ storeId, idemKey, tx, amount, type, reversalOf = null }) {
  const personId = str(tx.personId);
  const lineUserId = str(tx.crmLineUserId);
  if (!personId && !lineUserId) return; // 会員不明＝対象外
  if (!amount) return;

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

  // セグメント配信用: 購入商品の売り場・ブランド(ユニーク名・最大20件)を同梱する。
  // Core側で台帳行に載り、「HAUSでブランドXを買った人に配信」等の絞り込みに使う。
  const uniqNames = (vals) => [...new Set(vals.map((v) => str(v)).filter(Boolean))].slice(0, 20);
  const txItems = Array.isArray(tx.items) ? tx.items : [];
  const salesAreas = uniqNames(txItems.map((i) => i?.salesAreaName));
  const brands = uniqNames(txItems.map((i) => i?.brandName));

  const payload = {
    coreTenantId,
    coreSpaceId: coreSpaceId || null,
    sourceKey: storeId,
    // 空文字は送らない（Core 側で「指定あり」と誤認させないため）
    ...(personId ? { personId } : {}),
    ...(!personId && lineUserId ? { lineUserId } : {}),
    amount: num(amount),
    type,
    provider: "pos",
    brand: str(tx.departmentName) || null,
    ...(salesAreas.length ? { salesAreas } : {}),
    ...(brands.length ? { brands } : {}),
    at: (type === "pos" && paidAt ? paidAt : new Date()).toISOString(),
    bookingId: type === "pos" ? (str(tx.groomBookingId) || null) : null,
    ...(reversalOf ? { reversalOf } : {}),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        "Idempotency-Key": str(idemKey),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[crmPoints] Core応答NG", res.status, body.slice(0, 200), { storeId, idemKey, type });
      return;
    }
    const json = await res.json().catch(() => ({}));
    console.log("[crmPoints] 送信", {
      storeId, idemKey, type,
      person: personId || `(line経由)${json?.personId ?? ""}`,
      points: json?.points, duplicate: json?.duplicate,
    });
  } catch (e) {
    // Core 側の一時障害でレジ運用を止めない（売上は Firestore に確定済み）
    console.error("[crmPoints] 送信失敗", e?.message, { storeId, idemKey, type });
  }
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

    const amount = pickTotal(tx);
    if (amount === 0) return;
    const isReversal = tx.isReversal === true;
    // 締め後の返品/取消はマイナス伝票が新規作成される。元の会計ID(reversalOf)を渡し、
    // Core が元の付与分から按分して戻す(倍率分・LTVも)。
    await sendPointEvent({
      storeId,
      idemKey: txId,
      tx,
      amount,
      type: isReversal ? "pos_reversal" : "pos",
      reversalOf: isReversal ? (str(tx.reversalOf) || null) : null,
    });
  }
);

/**
 * 当日(締め前)の取消・一部取消。POSは元伝票をその場で書き換える(新規伝票を作らない)ため、
 * onCreate では拾えず、以前はポイントが戻らなかった(2026-09-28 dev再現で確認)。
 * cancellations[] が増えた書き換えだけを拾い、減った金額をマイナスで送る。
 * 冪等キーは POS のポイント利用返却と同じ `${txId}#c${取消回数}`(取消ごとにユニーク)。
 */
export const onTransactionUpdatedSyncCrmCancel = onDocumentUpdated(
  { region: REGION, database: DB_ID, document: "stores/{storeId}/transactions/{txId}" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { storeId, txId } = event.params;

    if (after.isReversal === true || after.isMethodAdjustment === true) return;
    const beforeCount = Array.isArray(before.cancellations) ? before.cancellations.length : 0;
    const afterCount = Array.isArray(after.cancellations) ? after.cancellations.length : 0;
    if (afterCount <= beforeCount) return; // 取消以外の書き換え
    if (before.isPaid === false) return;   // 元々未会計

    // ⚠pickTotal は0を飛ばして別フィールドを拾うので使わない(全額取消は totalAmount=0 になる)
    const reduced = num(before.totalAmount) - num(after.totalAmount);
    if (!(reduced > 0)) return;

    await sendPointEvent({
      storeId,
      idemKey: `${txId}#c${afterCount}`,
      tx: { ...after, personId: after.personId || before.personId, crmLineUserId: after.crmLineUserId || before.crmLineUserId },
      amount: -reduced,
      type: "pos_cancel",
      reversalOf: txId,
    });
  }
);
