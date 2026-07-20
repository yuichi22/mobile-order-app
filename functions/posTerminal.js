// functions/posTerminal.js
// POS「カード」会計を、別プロジェクトの Core(Stripe Terminal 決済)へ委譲する onCall 群。
// 方式A(サーバー間 OIDC): 本関数(mobile_order)がスタッフ権限を判定し、
// Core の非公開エンドポイントを Google 署名 OIDC で叩く。認証は Core 側 Cloud Run の
// IAM(run.invoker) が担保するため、ここではトークン取得のみ行う。
//
// store→Core のマッピングは stores/{storeId}/settings/terminal に持つ(既存 settings/shopify 方式)。
// tenantId 等は必ずサーバ側でこの doc から解決し、クライアント値は信用しない。
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

// Core(Stripe Terminal決済) の base URL。dev 既定。環境変数で上書き可(prod切替用)。
const CORE_BASE =
  process.env.CORE_TERMINAL_BASE ||
  "https://asia-northeast1-suomin-9ff5a.cloudfunctions.net";

const googleAuth = new GoogleAuth();

const str = (v) => String(v ?? "").trim();

// users/{uid} の storeId/role を見る既存規約(index.js の getUserRoleForStore と同じ)。
const ROLE_MAP = {
  admin: "owner",
  owner: "owner",
  manager: "manager",
  staff: "staff",
  super_admin: "super_admin",
};
async function getUserRoleForStore(uid, storeId) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  if (str(d.storeId) !== str(storeId)) return null;
  return ROLE_MAP[str(d.role).toLowerCase()] || null;
}

// Core の非公開 onRequest を OIDC で叩く。audience=関数URL。
async function callCore(fnName, body) {
  const url = `${CORE_BASE}/${fnName}`;
  const client = await googleAuth.getIdTokenClient(url);
  try {
    const res = await client.request({
      url,
      method: "POST",
      data: body,
      headers: { "Content-Type": "application/json" },
    });
    return res.data;
  } catch (e) {
    // Core からの構造化エラー(code/error)を拾って HttpsError に変換
    const data = e?.response?.data;
    const status = e?.response?.status;
    const msg = data?.error || e?.message || "core call failed";
    const code =
      status === 404
        ? "not-found"
        : status === 409
        ? "failed-precondition"
        : status === 400
        ? "invalid-argument"
        : status === 403
        ? "permission-denied"
        : "internal";
    throw new HttpsError(code, `Core: ${msg}`);
  }
}

// スタッフ認可 + store→Core マッピング解決の共通前段。
async function resolveContext(request, { requireCardEnabled = false } = {}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");

  const storeId = str(request.data?.storeId);
  if (!storeId) throw new HttpsError("invalid-argument", "storeId が必要です。");

  const role = await getUserRoleForStore(uid, storeId);
  if (!role) throw new HttpsError("permission-denied", "この店舗の権限がありません。");

  const storeRef = db.collection("stores").doc(storeId);

  if (requireCardEnabled) {
    const basicSnap = await storeRef.collection("settings").doc("basic").get();
    const accepted = basicSnap.exists ? basicSnap.data()?.acceptedPaymentMethods : null;
    if (!Array.isArray(accepted) || !accepted.includes("card")) {
      throw new HttpsError("failed-precondition", "この店舗はカード決済が無効です。");
    }
  }

  const termSnap = await storeRef.collection("settings").doc("terminal").get();
  const term = termSnap.exists ? termSnap.data() || {} : {};
  const coreTenantId = str(term.coreTenantId);
  const coreSpaceId = str(term.coreSpaceId);
  const coreReaderId = str(term.coreReaderId);
  if (term.enabled !== true || !coreTenantId || !coreSpaceId) {
    throw new HttpsError(
      "failed-precondition",
      "端末連携(settings/terminal)が未設定です。"
    );
  }

  return { uid, role, storeId, coreTenantId, coreSpaceId, coreReaderId };
}

// ---- 会計開始: PaymentIntent 作成 + reader 送出 ----
export const startCardPayment = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request, { requireCardEnabled: true });

  const orderId = str(request.data?.orderId);
  const idempotencyKey = str(request.data?.idempotencyKey) || orderId;
  const amount = Number(request.data?.amount);
  if (!orderId) throw new HttpsError("invalid-argument", "orderId が必要です。");
  if (!ctx.coreReaderId)
    throw new HttpsError("failed-precondition", "リーダー(coreReaderId)が未設定です。");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "amount は正の整数(JPY)。");
  }

  return await callCore("createPosTerminalPaymentHttp", {
    tenantId: ctx.coreTenantId,
    spaceId: ctx.coreSpaceId,
    readerId: ctx.coreReaderId,
    orderId,
    idempotencyKey,
    amount,
    currency: "jpy",
  });
});

// ---- 状態取得(ポーリング) ----
export const getCardPaymentStatus = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request);
  const paymentIntentId = str(request.data?.paymentIntentId);
  if (!paymentIntentId)
    throw new HttpsError("invalid-argument", "paymentIntentId が必要です。");

  return await callCore("getPosTerminalPaymentStatusHttp", {
    tenantId: ctx.coreTenantId,
    paymentIntentId,
  });
});

// ---- 中断 ----
export const cancelCardPayment = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request);
  const paymentIntentId = str(request.data?.paymentIntentId);
  if (!paymentIntentId)
    throw new HttpsError("invalid-argument", "paymentIntentId が必要です。");

  return await callCore("cancelPosTerminalPaymentHttp", {
    tenantId: ctx.coreTenantId,
    paymentIntentId,
  });
});
