/* global process, Buffer */
// coreLogin.js
// AKUTO Core のポータルの「開く」から、ログインした状態でレジ・モバイルオーダーを開く。
// - issueCoreLoginTicket: Core の openAppWithLogin が呼ぶ（Bearer <CORE_SALES_SECRET>）。
//   同じメールのスタッフがいて、その拠点に結び付いた店舗（coreLinks / settings/terminal）の人なら、
//   1回限り・約1分の入場券付き /sso URL を返す。いなければ loginUrl: null（ポータルは普通の URL を開く）。
// - redeemCoreLoginTicket: /sso の画面が呼ぶ。入場券を使用済みにしてログイン用のトークンを返す。
// 入場券は coreLoginTickets/{sha256}（ルールに載せていないのでクライアントからは読めない）。
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  CORE_LOGIN_TTL_MS,
  coreLoginAccessError,
  coreLoginUrl,
  isTicketFormat,
  parseCoreLoginBody,
  ticketDocId,
  ticketError,
} from "./coreLoginLogic.js";

const REGION = "asia-northeast1";
if (!getApps().length) initializeApp();
const db = getFirestore("main");

const str = (v) => String(v ?? "").trim();

const hasCoreSecret = (authorization) => {
  const secret = str(process.env.CORE_SALES_SECRET);
  const authz = String(authorization || "");
  const bearer = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!secret) return false;
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

// 招待リンクと同じ公開 URL（スタッフがふだん開いている場所）
const appBase = () =>
  str(process.env.PROVISION_BASE_URL) || str(process.env.APP_BASE_URL) || `https://${process.env.GCLOUD_PROJECT}.web.app`;

// その拠点に結び付いた店舗
async function linkedStoreIdsFor(tenantId, spaceId, profileStoreId) {
  const ids = [];
  const link = await db.collection("coreLinks").doc(`${tenantId}__${spaceId}`).get();
  if (str(link.data()?.storeId)) ids.push(str(link.data().storeId));
  if (profileStoreId && !ids.includes(profileStoreId)) {
    // 管理画面の「拠点連携」で手で結び付けた店舗
    const t = await db.doc(`stores/${profileStoreId}/settings/terminal`).get();
    const d = t.data() || {};
    if (str(d.coreSpaceId) === spaceId && (!str(d.coreTenantId) || str(d.coreTenantId) === tenantId)) {
      ids.push(profileStoreId);
    }
  }
  return ids;
}

export const issueCoreLoginTicket = onRequest({ region: REGION, cors: false, invoker: "public" }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method-not-allowed" });
  if (!hasCoreSecret(req.get("authorization"))) return res.status(401).json({ ok: false, error: "unauthorized" });
  const input = parseCoreLoginBody(req.body);
  if (!input) return res.status(400).json({ ok: false, error: "invalid-input" });

  try {
    const user = await getAuth()
      .getUserByEmail(input.email)
      .catch((e) => {
        if (e?.code === "auth/user-not-found") return null;
        throw e;
      });
    if (!user) return res.json({ ok: true, loginUrl: null, reason: "no-account" });

    const profileSnap = await db.collection("users").doc(user.uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : null;
    const linkedStoreIds = profile
      ? await linkedStoreIdsFor(input.tenantId, input.spaceId, str(profile.storeId))
      : [];
    const denied = coreLoginAccessError({ disabled: user.disabled, profile, linkedStoreIds });
    if (denied) return res.json({ ok: true, loginUrl: null, reason: denied });

    const ticket = randomBytes(32).toString("base64url");
    await db.collection("coreLoginTickets").doc(ticketDocId(ticket)).set({
      uid: user.uid,
      storeId: str(profile.storeId),
      tenantId: input.tenantId,
      spaceId: input.spaceId,
      used: false,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + CORE_LOGIN_TTL_MS),
    });
    return res.json({ ok: true, loginUrl: coreLoginUrl(appBase(), input, ticket) });
  } catch (e) {
    console.error("[issueCoreLoginTicket]", e);
    return res.status(500).json({ ok: false, error: "internal-error" });
  }
});

const TICKET_MESSAGE = {
  "not-found": "このリンクは使えません。ポータルからもう一度開いてください。",
  used: "このリンクはすでに使われています。ポータルからもう一度開いてください。",
  expired: "このリンクは期限切れです（1分）。ポータルからもう一度開いてください。",
};

export const redeemCoreLoginTicket = onCall({ region: REGION }, async (request) => {
  const ticket = request.data?.ticket;
  if (!isTicketFormat(ticket)) throw new HttpsError("invalid-argument", TICKET_MESSAGE["not-found"]);

  const ref = db.collection("coreLoginTickets").doc(ticketDocId(ticket));
  const uid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    const err = ticketError(d ? { used: d.used === true, expiresAtMs: d.expiresAt?.toMillis?.() ?? 0 } : null, Date.now());
    if (err) throw new HttpsError("failed-precondition", TICKET_MESSAGE[err]);
    tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
    return d.uid;
  });

  const user = await getAuth().getUser(uid);
  if (user.disabled) throw new HttpsError("permission-denied", "このアカウントは使えません。店舗の管理者に確かめてください。");
  const token = await getAuth().createCustomToken(uid);
  return { token };
});
