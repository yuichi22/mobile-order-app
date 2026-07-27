// provisioning.js
// Akuto Core からの店舗自動プロビジョニング受け口。
// 拠点(space)で order/pos が有効化されたとき、Core のトリガーがここを叩き、
// 対応する mobile_order 店舗を自動作成して拠点に紐付ける。
// - 認証: Authorization: Bearer <CORE_SALES_SECRET>（売上同期と同じ第一者共有シークレット）
// - 冪等: coreLinks/{tenantId__spaceId} に作成済み storeId を記録し、再送は既存を返す
// - オーナーは作らない(1アカウント=1店舗のため既存アカウントと衝突する)。代わりに
//   owner ロールの招待(staffInvites, source=core-provision)を発行し、初期設定リンクを返す。
//   リンクは既存の /register?store_id&invite フロー(createInvitedMember)で消化される。
import { onRequest } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomBytes, timingSafeEqual } from "node:crypto";

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

const createStoreId = () => `store_${randomBytes(4).toString("hex").slice(0, 5)}`;

const INVITE_TTL_DAYS = 30;

export const provisionStoreForSpace = onRequest(
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
    const spaceName = str(body.spaceName) || "(拠点名未設定)";
    const apps = body.apps && typeof body.apps === "object" ? body.apps : {};
    if (!tenantId || !spaceId) {
      return res.status(400).json({ ok: false, error: "tenantId and spaceId required" });
    }

    const inviteBase = str(process.env.PROVISION_BASE_URL) || str(process.env.APP_BASE_URL);
    const linkRef = db.collection("coreLinks").doc(`${tenantId}__${spaceId}`);

    try {
      // 冪等: 既存リンクがあればそれを返す
      const existing = await linkRef.get();
      if (existing.exists) {
        const d = existing.data() || {};
        return res.json({ ok: true, alreadyProvisioned: true, storeId: d.storeId, inviteUrl: d.inviteUrl || null });
      }

      const storeId = createStoreId();
      const inviteCode = randomBytes(16).toString("hex");
      const inviteUrl = inviteBase
        ? `${inviteBase}/register?store_id=${storeId}&invite=${inviteCode}`
        : null;
      const now = FieldValue.serverTimestamp();
      const storeRef = db.collection("stores").doc(storeId);

      const batch = db.batch();
      batch.set(storeRef, {
        name: spaceName,
        platformStatus: "active",
        source: "core-provision",
        createdAt: now,
        updatedAt: now,
      });
      batch.set(storeRef.collection("settings").doc("platformAccess"), {
        storeStatus: "active",
        updatedAt: now,
      });
      batch.set(storeRef.collection("settings").doc("terminal"), {
        coreTenantId: tenantId,
        coreSpaceId: spaceId,
        linkedAt: now,
      });
      batch.set(storeRef.collection("settings").doc("coreApps"), {
        order: apps.order === true,
        pos: apps.pos === true,
        groom: apps.groom === true,
        spatial: apps.spatial === true,
        crm: apps.crm === true,
        addons: {},
        coreTenantId: tenantId,
        coreSpaceId: spaceId,
        fetchedAt: now,
      });
      batch.set(storeRef.collection("staffInvites").doc(inviteCode), {
        storeId,
        role: "owner",
        status: "active",
        source: "core-provision",
        createdBy: "core-provision",
        createdAt: now,
        expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
      batch.set(linkRef, {
        tenantId,
        spaceId,
        storeId,
        inviteUrl,
        createdAt: now,
      });
      await batch.commit();

      console.log(`[provisionStoreForSpace] created store ${storeId} for ${tenantId}/${spaceId}`);
      return res.json({ ok: true, storeId, inviteUrl });
    } catch (e) {
      console.error("[provisionStoreForSpace] error:", e);
      return res.status(500).json({ ok: false, error: e?.message || "internal error" });
    }
  }
);
