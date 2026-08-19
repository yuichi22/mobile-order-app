// crmMember.js
// レジから会員ポイントを扱うための Core 中継（onCall）。
// 共有シークレットはサーバだけが持つ（ブラウザには絶対に出さない）。
// - crmLookupMember: 会員コード → 氏名/残高/利用ルール（レジで読み取った直後の表示）
// - crmRedeemPoints: ポイント利用 / 取消時の戻し（refund）
// 店舗↔Core拠点の対応は settings/terminal のみを出所にする（クライアントの申告は信用しない）。
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();

const ROLE_MAP = {
  admin: "owner",
  owner: "owner",
  manager: "manager",
  staff: "staff",
  super_admin: "super_admin",
};

/** users/{uid} の storeId/role を見る既存規約（posTerminal.js と同じ）。 */
async function assertStoreStaff(request, storeId) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "権限がありません。");
  const d = snap.data() || {};
  if (str(d.storeId) !== str(storeId)) throw new HttpsError("permission-denied", "権限がありません。");
  const role = ROLE_MAP[str(d.role).toLowerCase()];
  if (!role) throw new HttpsError("permission-denied", "権限がありません。");
  return role;
}

/** 店舗 → Core の tenant/space（settings/terminal が唯一の出所） */
async function resolveCoreLink(storeId) {
  const snap = await db.collection("stores").doc(storeId).collection("settings").doc("terminal").get();
  const t = snap.exists ? snap.data() || {} : {};
  const coreTenantId = str(t.coreTenantId);
  const coreSpaceId = str(t.coreSpaceId);
  if (!coreTenantId) {
    throw new HttpsError("failed-precondition", "この店舗は Akuto と連携されていません。");
  }
  return { coreTenantId, coreSpaceId: coreSpaceId || null };
}

/** Core の共有シークレット付きエンドポイントを叩く。 */
async function callCore(path, body, idempotencyKey) {
  const base = str(process.env.CORE_CRM_BASE) ||
    str(process.env.CORE_CRM_POINTS_URL).replace(/\/receiveCrmPointEvent$/, "");
  const secret = str(process.env.CORE_SALES_SECRET);
  if (!base || !secret) {
    throw new HttpsError("failed-precondition", "サーバー設定が不足しています。運営にお問い合わせください。");
  }
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Core の構造化エラーを、レジで出す日本語メッセージに変換
    const err = str(data?.error);
    if (err === "unknown_member_code" || err === "unknown_member") {
      throw new HttpsError("not-found", "会員が見つかりません。");
    }
    if (err === "insufficient_balance") {
      throw new HttpsError("failed-precondition", `ポイントが不足しています（残高 ${data?.balance ?? 0}pt）。`);
    }
    if (err === "invalid_unit") {
      throw new HttpsError("invalid-argument", `${data?.unit}pt 単位でご利用いただけます。`);
    }
    throw new HttpsError("internal", `Core: ${err || res.status}`);
  }
  return data;
}

/** 会員コード → 氏名/残高/利用ルール */
export const crmLookupMember = onCall({ region: REGION }, async (request) => {
  const storeId = str(request.data?.storeId);
  const memberCode = str(request.data?.memberCode);
  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!memberCode) throw new HttpsError("invalid-argument", "memberCode required.");
  await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  const data = await callCore("lookupCrmMember", {
    coreTenantId: link.coreTenantId,
    coreSpaceId: link.coreSpaceId,
    memberCode,
  });
  return {
    ok: true,
    personId: data.personId,
    displayName: data.displayName || null,
    pointBalance: Number(data.pointBalance || 0),
    redeem: data.redeem || { yenPerPoint: 1, unit: 1 },
  };
});

/** ポイント利用（refund=true で会計取消時の戻し）。冪等キーは会計ID。 */
export const crmRedeemPoints = onCall({ region: REGION }, async (request) => {
  const d = request.data || {};
  const storeId = str(d.storeId);
  const personId = str(d.personId);
  const points = Math.floor(Number(d.points) || 0);
  const txId = str(d.txId);
  const refund = d.refund === true;

  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!personId) throw new HttpsError("invalid-argument", "personId required.");
  if (points <= 0) throw new HttpsError("invalid-argument", "points must be positive.");
  if (!txId) throw new HttpsError("invalid-argument", "txId required.");
  await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  const data = await callCore(
    "redeemCrmPoints",
    {
      coreTenantId: link.coreTenantId,
      coreSpaceId: link.coreSpaceId,
      personId,
      points,
      idempotencyKey: txId,
      provider: "pos",
      refund,
    },
    txId
  );
  return { ok: true, ...data };
});
