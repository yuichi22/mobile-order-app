// checkoutRequests.js
// groom(予約アプリ)からの会計依頼伝票の受け口。
// 「作業完了・お会計」でgroomが自拠点の tenantId/spaceId 付きで伝票を送り、
// coreLinks/{tenantId__spaceId} で店舗を逆引きして stores/{storeId}/checkoutRequests に積む。
// POSレジは pending を購読して呼出→会計する(UIは別途)。
// - 認証: Authorization: Bearer <CORE_SALES_SECRET>(プロビジョニング/売上同期と同じ第一者共有シークレット)
// - 冪等: requestId(groom側発番, 例 groom_{tenantId}_{bookingId}) がdoc ID。
//   再送は現状返却、cancelled/expired への再送は pending に復活させる(内容も更新)。
// - 状態機械: pending → claimed → paid(終端) / cancelled / expired(期限切れは遅延判定)
import { onRequest } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { timingSafeEqual } from "node:crypto";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
};

// 送信から12時間で失効(レジ側はグレー表示、groomから再送で復活)
const EXPIRES_HOURS = 12;

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_LINES = 50;
const MAX_AMOUNT = 10_000_000; // 円。トリミング会計の上限ガード

// 明細行を検証して保存形に正規化。不正なら null。
function normalizeLine(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name);
  const qty = Number(raw.qty ?? 1);
  const unitPrice = Number(raw.unitPrice);
  const taxRate = Number(raw.taxRate ?? 10);
  const taxRateType = raw.taxRateType === "reduced" ? "reduced" : "standard";
  if (!name || name.length > 200) return null;
  if (!Number.isInteger(qty) || qty <= 0 || qty > 999) return null;
  if (!Number.isInteger(unitPrice) || unitPrice < 0 || unitPrice > MAX_AMOUNT) return null;
  if (![8, 10].includes(taxRate)) return null;
  return { name, qty, unitPrice, taxRate, taxRateType };
}

// 検証済みリクエストから伝票docの中身(不変部分)を組む
function buildRequestFields({ tenantId, spaceId, source, request, lines }) {
  return {
    requestId: str(request.requestId),
    source,
    coreTenantId: tenantId,
    coreSpaceId: spaceId,
    groomTenantId: str(request.groomTenantId) || null,
    bookingId: str(request.bookingId),
    personId: str(request.personId) || null,
    lineUserId: str(request.lineUserId) || null,
    customerName: str(request.customerName) || null,
    totalAmount: Number(request.totalAmount),
    lines,
    note: str(request.note) || null,
  };
}

export const receiveCheckoutRequest = onRequest(
  { region: REGION, cors: false, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

    const secret = str(process.env.CORE_SALES_SECRET);
    const authz = req.get("authorization") || "";
    const bearer = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length) : "";
    if (!secret || !safeEqual(bearer, secret)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const tenantId = str(body.tenantId);
    const spaceId = str(body.spaceId);
    const source = str(body.source) || "groom";
    const action = str(body.action) || "create";
    const request = body.request && typeof body.request === "object" ? body.request : {};
    const requestId = str(request.requestId);

    if (!tenantId || !spaceId || !REQUEST_ID_RE.test(requestId) || !["create", "cancel"].includes(action)) {
      return res.status(400).json({ ok: false, error: "invalid_request" });
    }

    let lines = null;
    if (action === "create") {
      const rawLines = Array.isArray(request.lines) ? request.lines : [];
      lines = rawLines.map(normalizeLine);
      const total = Number(request.totalAmount);
      if (
        !str(request.bookingId) ||
        !Number.isInteger(total) || total < 0 || total > MAX_AMOUNT ||
        lines.length === 0 || lines.length > MAX_LINES || lines.some((l) => l === null)
      ) {
        return res.status(400).json({ ok: false, error: "invalid_request" });
      }
    }

    try {
      const linkSnap = await db.collection("coreLinks").doc(`${tenantId}__${spaceId}`).get();
      const storeId = str(linkSnap.data()?.storeId);
      if (!linkSnap.exists || !storeId) {
        return res.status(404).json({ ok: false, error: "space_not_linked" });
      }

      const reqRef = db
        .collection("stores").doc(storeId)
        .collection("checkoutRequests").doc(requestId);

      const status = await db.runTransaction(async (tx) => {
        const snap = await tx.get(reqRef);
        const now = FieldValue.serverTimestamp();
        const cur = snap.exists ? snap.data() || {} : null;
        const curStatus = cur ? str(cur.status) : null;
        const expired =
          cur &&
          (curStatus === "expired" ||
            (cur.expiresAt instanceof Timestamp && cur.expiresAt.toMillis() < Date.now()));

        if (action === "cancel") {
          if (!cur) return "not_found";
          if (curStatus === "paid") return "paid";
          if (curStatus === "cancelled") return "cancelled";
          tx.update(reqRef, {
            status: "cancelled",
            cancelledAt: now,
            cancelledFrom: source,
            updatedAt: now,
          });
          return "cancelled";
        }

        // action === "create"
        const fields = buildRequestFields({ tenantId, spaceId, source, request, lines });
        const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRES_HOURS * 60 * 60 * 1000);

        if (!cur) {
          tx.set(reqRef, {
            ...fields,
            status: "pending",
            expiresAt,
            createdAt: now,
            updatedAt: now,
            claimedBy: null,
            claimedAt: null,
            paidAt: null,
            transactionId: null,
            cancelledAt: null,
            cancelledFrom: null,
          });
          return "pending";
        }
        if (curStatus === "paid") return "paid";
        if (curStatus === "cancelled" || expired) {
          // 再送: 内容を更新して pending に復活
          tx.set(reqRef, {
            ...fields,
            status: "pending",
            expiresAt,
            createdAt: cur.createdAt || now,
            updatedAt: now,
            claimedBy: null,
            claimedAt: null,
            paidAt: null,
            transactionId: null,
            cancelledAt: null,
            cancelledFrom: null,
          });
          return "pending";
        }
        // pending / claimed の再送は冪等 no-op(会計中の金額差し替えを防ぐ)
        return curStatus || "pending";
      });

      if (action === "cancel" && status === "not_found") {
        return res.status(404).json({ ok: false, error: "request_not_found" });
      }

      console.log(`[receiveCheckoutRequest] ${action} ${storeId}/${requestId} -> ${status}`);
      return res.json({ ok: true, storeId, requestId, status });
    } catch (e) {
      console.error("[receiveCheckoutRequest] error:", e);
      return res.status(500).json({ ok: false, error: e?.message || "internal error" });
    }
  }
);
