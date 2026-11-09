// coreLoginLogic.js
// AKUTO Core のポータルから「ログインした状態で開く」ための純粋関数（Firestore に触れない）。
import { createHash } from "node:crypto";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const TICKET_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** 入場券の有効期間（ポータルで押してから画面が開くまで） */
export const CORE_LOGIN_TTL_MS = 60 * 1000;

const STAFF_ROLES = ["owner", "manager", "staff"];

const str = (v) => String(v ?? "").trim();

/** Core から届いた本文を検査して整える。不正なら null */
export function parseCoreLoginBody(body) {
  const b = body && typeof body === "object" ? body : {};
  const tenantId = str(b.tenantId);
  const spaceId = str(b.spaceId);
  const rawEmail = str(b.email).toLowerCase();
  const email = EMAIL_RE.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;
  const app = str(b.app) === "order" ? "order" : "pos";
  // 同じメールのスタッフがいないとき、その店舗の管理者で入ってよいか。
  // Core が「ポータルの人はこの会社の管理者」と確かめたときだけ true で来る（拠点ごとに別のメールを使う運用のため）
  const asSpaceAdmin = b.asSpaceAdmin === true;
  const rawStore = str(b.posStoreId);
  const posStoreId = ID_RE.test(rawStore) ? rawStore : null;
  if (!ID_RE.test(tenantId) || !ID_RE.test(spaceId) || (!email && !asSpaceAdmin)) return null;
  return { tenantId, spaceId, email, app, asSpaceAdmin, posStoreId };
}

/**
 * 店舗の管理者アカウント（owner のうち最初に登録した人、いなければ manager）。いなければ null。
 * rows = その店舗の users（{ uid, role, createdAtMs, disabled }）
 */
export function pickStoreAdmin(rows) {
  const usable = (rows || []).filter((r) => !r.disabled);
  for (const role of ["owner", "manager"]) {
    const hit = usable.filter((r) => str(r.role) === role).sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
    if (hit) return hit.uid;
  }
  return null;
}

/**
 * そのスタッフで、その拠点の店舗に入ってよいか。
 * profile = users/{uid}、linkedStoreIds = その拠点に結び付いた店舗（coreLinks / settings/terminal）。
 */
export function coreLoginAccessError({ disabled, profile, linkedStoreIds }) {
  if (disabled) return "disabled";
  if (!profile) return "no-profile";
  if (!STAFF_ROLES.includes(str(profile.role))) return "no-role";
  const storeId = str(profile.storeId);
  if (!storeId || !(linkedStoreIds || []).includes(storeId)) return "other-store";
  return null;
}

/** 入場券は doc ID にそのまま残さず、ハッシュで持つ */
export const ticketDocId = (ticket) => createHash("sha256").update(String(ticket)).digest("hex");

export const isTicketFormat = (ticket) => typeof ticket === "string" && TICKET_RE.test(ticket);

/** 入場券を使ってよいか */
export function ticketError(t, nowMs) {
  if (!t) return "not-found";
  if (t.used) return "used";
  if (!(Number(t.expiresAtMs) > nowMs)) return "expired";
  return null;
}

/** ポータルが開く URL。入場券はサーバーのログや Referer に残らないよう # の後ろに置く */
export function coreLoginUrl(base, { app, tenantId, spaceId }, ticket) {
  const u = new URL("/sso", base);
  u.searchParams.set("app", app);
  u.searchParams.set("tenantId", tenantId);
  u.searchParams.set("spaceId", spaceId);
  u.hash = `ticket=${ticket}`;
  return u.toString();
}
