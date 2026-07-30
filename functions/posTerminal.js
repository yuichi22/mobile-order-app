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

// Core(Stripe Terminal決済) の base URL。環境ごとの値は functions/.env.<projectId> で設定する。
const CORE_BASE = (process.env.CORE_TERMINAL_BASE || "").trim();

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
  if (!CORE_BASE) {
    console.error("[posTerminal] CORE_TERMINAL_BASE 未設定（functions/.env.<projectId> を確認）");
    throw new HttpsError("failed-precondition", "サーバー設定が不足しています。運営にお問い合わせください。");
  }
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

// レジ(register)から Stripe リーダーIDを解決する。
// マッピング:
//   店舗単位  settings/terminal      = { coreTenantId, coreSpaceId }（店舗の Core identity）
//   レジ単位  settings/basic.registers[].stripeReaderId（各レジに割り当てたリーダー）
//   フォールバック settings/terminal.coreReaderId（店舗デフォルト。単一レジ/テイクアウト向け）
// 「リーダー割当の有無」が唯一のスイッチ。連携/非連携トグルは設けない。
function resolveReaderId(basicData, term, registerId) {
  const rid = str(registerId);
  if (rid && basicData && Array.isArray(basicData.registers)) {
    const reg = basicData.registers.find((r) => str(r?.id) === rid);
    const fromReg = str(reg?.stripeReaderId);
    if (fromReg) return fromReg;
  }
  return str(term?.coreReaderId); // 店舗デフォルト（無ければ空）
}

// スタッフ認可 + store→Core マッピング解決の共通前段。
async function resolveContext(request, { requireCardEnabled = false, needReader = false } = {}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");

  const storeId = str(request.data?.storeId);
  if (!storeId) throw new HttpsError("invalid-argument", "storeId が必要です。");

  const role = await getUserRoleForStore(uid, storeId);
  if (!role) throw new HttpsError("permission-denied", "この店舗の権限がありません。");

  const storeRef = db.collection("stores").doc(storeId);
  const [basicSnap, termSnap] = await Promise.all([
    storeRef.collection("settings").doc("basic").get(),
    storeRef.collection("settings").doc("terminal").get(),
  ]);
  const basicData = basicSnap.exists ? basicSnap.data() || {} : {};
  const term = termSnap.exists ? termSnap.data() || {} : {};

  if (requireCardEnabled) {
    const accepted = basicData.acceptedPaymentMethods;
    if (!Array.isArray(accepted) || !accepted.includes("card")) {
      throw new HttpsError("failed-precondition", "この店舗はカード決済が無効です。");
    }
  }

  // 店舗が Core にリンクされているか（連携の実体は enabled フラグではなく tenant/space の設定有無）
  const coreTenantId = str(term.coreTenantId);
  const coreSpaceId = str(term.coreSpaceId);
  if (!coreTenantId || !coreSpaceId) {
    throw new HttpsError("failed-precondition", "端末連携(settings/terminal)が未設定です。");
  }

  let coreReaderId = "";
  if (needReader) {
    coreReaderId = resolveReaderId(basicData, term, request.data?.registerId);
    if (!coreReaderId) {
      throw new HttpsError(
        "failed-precondition",
        "このレジにStripeリーダーが割り当てられていません。"
      );
    }
  }

  return { uid, role, storeId, coreTenantId, coreSpaceId, coreReaderId };
}

// ---- リーダー一覧(設定UIのレジ割当用) ----
export const listCardReaders = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request); // reader不要。店舗リンク済みが前提
  return await callCore("listPosTerminalReadersHttp", {
    tenantId: ctx.coreTenantId,
    spaceId: ctx.coreSpaceId,
  });
});

// ---- 端末登録(店舗セルフサービス) ----
// 「カード決済端末連携」モーダルから、登録コードで物理端末(テストはシミュレーター)を登録。
// 登録済み端末はレジ→リーダー割当に出てくる。管理者のみ。
const READER_ADMIN_ROLES = new Set(["owner", "manager", "super_admin"]);
export const registerCardReader = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request); // 店舗リンク済みが前提
  if (!READER_ADMIN_ROLES.has(ctx.role)) {
    throw new HttpsError("permission-denied", "端末登録は店舗管理者のみ可能です。");
  }
  const registrationCode = str(request.data?.registrationCode);
  const label = str(request.data?.label);
  if (!registrationCode)
    throw new HttpsError("invalid-argument", "登録コードが必要です。");

  return await callCore("registerPosTerminalReaderHttp", {
    tenantId: ctx.coreTenantId,
    spaceId: ctx.coreSpaceId,
    registrationCode,
    label,
  });
});

// ---- 拠点の Terminal Location を用意(店舗セルフ・住所入力) ----
// 端末登録の前提。拠点(space)に Location が無ければ、店舗が住所を入れて作成する。管理者のみ。
export const ensureCardTerminalLocation = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request); // 店舗リンク済みが前提
  if (!READER_ADMIN_ROLES.has(ctx.role)) {
    throw new HttpsError("permission-denied", "拠点の設定は店舗管理者のみ可能です。");
  }
  const d = request.data || {};
  return await callCore("ensurePosTerminalLocationHttp", {
    tenantId: ctx.coreTenantId,
    spaceId: ctx.coreSpaceId,
    displayName: str(d.displayName),
    addressKanji: d.addressKanji || null,
    addressKana: d.addressKana || null,
    phone: str(d.phone) || null,
  });
});

// ---- 【テスト専用】シミュレーター端末にカード提示をシミュレート ----
// 物理端末が無くても待機モーダルから会計を succeeded まで通すための補助。
// 本番キーでは Core 側で failed-precondition になる(実害なし)。
export const simulateCardPresentation = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request);
  const paymentIntentId = str(request.data?.paymentIntentId);
  if (!paymentIntentId)
    throw new HttpsError("invalid-argument", "paymentIntentId が必要です。");
  return await callCore("simulatePosTerminalCardHttp", {
    tenantId: ctx.coreTenantId,
    paymentIntentId,
  });
});

// ---- 会計開始: PaymentIntent 作成 + reader 送出 ----
export const startCardPayment = onCall({ region: REGION }, async (request) => {
  const ctx = await resolveContext(request, { requireCardEnabled: true, needReader: true });

  const orderId = str(request.data?.orderId);
  const idempotencyKey = str(request.data?.idempotencyKey) || orderId;
  const amount = Number(request.data?.amount);
  if (!orderId) throw new HttpsError("invalid-argument", "orderId が必要です。");
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
