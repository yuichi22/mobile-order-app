// entitlements.js
// Akuto Core から拠点の契約状態(enabledApps)を取得してキャッシュする。
// - 対象: settings/terminal に coreTenantId/coreSpaceId が設定済みの店舗のみ（Terminal/売上同期と同じマッピング）
// - キャッシュ先: stores/{id}/settings/coreApps { order, pos, groom, spatial, crm, fetchedAt }
// - 認証: Authorization: Bearer <CORE_SALES_SECRET>（Core 側は CRM_WEBHOOK_SECRET と同値運用）
// - 未連携店舗はキャッシュを書かない（クライアントはキャッシュ無し=フェイルオープンで全機能表示）
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();

// users/{uid} の storeId/role を見る既存規約(posTerminal.js と同じ)
const ROLE_MAP = {
  owner: "owner",
  admin: "owner",
  manager: "manager",
  staff: "staff",
  super_admin: "owner",
  superadmin: "owner",
};

async function getUserRoleForStore(uid, storeId) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  if (str(d.storeId) !== str(storeId)) return null;
  return ROLE_MAP[str(d.role).toLowerCase()] || null;
}

export const refreshEntitlements = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");

  const storeId = str(request.data?.storeId);
  if (!storeId) throw new HttpsError("invalid-argument", "storeId が必要です。");

  const role = await getUserRoleForStore(uid, storeId);
  if (!role) throw new HttpsError("permission-denied", "この店舗の権限がありません。");

  const termSnap = await db
    .collection("stores").doc(storeId)
    .collection("settings").doc("terminal").get();
  const term = termSnap.exists ? termSnap.data() || {} : {};
  const coreTenantId = str(term.coreTenantId);
  const coreSpaceId = str(term.coreSpaceId);

  // Core 未連携 → ゲート対象外（キャッシュも書かない）
  if (!coreTenantId || !coreSpaceId) return { ok: true, linked: false };

  const url = str(process.env.CORE_ENTITLEMENTS_URL);
  const secret = str(process.env.CORE_SALES_SECRET);
  if (!url || !secret) {
    console.warn("[refreshEntitlements] CORE_ENTITLEMENTS_URL / CORE_SALES_SECRET 未設定");
    return { ok: true, linked: true, refreshed: false };
  }

  let payload;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ tenantId: coreTenantId, spaceId: coreSpaceId }),
    });
    payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      // Core 側の一時障害で機能を落とさない（前回キャッシュ据え置き）
      console.warn("[refreshEntitlements] Core応答NG:", res.status, payload?.error || "");
      return { ok: true, linked: true, refreshed: false };
    }
  } catch (e) {
    console.warn("[refreshEntitlements] Core接続失敗:", e?.message || e);
    return { ok: true, linked: true, refreshed: false };
  }

  const ea = payload.enabledApps || {};
  const coreApps = {
    order: ea.order === true,
    pos: ea.pos === true,
    groom: ea.groom === true,
    spatial: ea.spatial === true,
    crm: ea.crm === true,
    addons: payload.addons && typeof payload.addons === "object" ? payload.addons : {},
    coreTenantId,
    coreSpaceId,
    fetchedAt: FieldValue.serverTimestamp(),
  };

  await db
    .collection("stores").doc(storeId)
    .collection("settings").doc("coreApps")
    .set(coreApps, { merge: false });

  return { ok: true, linked: true, refreshed: true, enabledApps: { order: coreApps.order, pos: coreApps.pos } };
});
