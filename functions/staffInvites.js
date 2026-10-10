// staffInvites.js
// メンバー招待の「メールで送る」【AKUTOブランド基準 10-10: 全アプリ共通の メンバー と招待】。
// 招待そのもの(stores/{storeId}/staffInvites/{inviteId})は画面で作る(従来どおり)。ここは送るだけ。
// - 送れるのはその店のオーナー(と super_admin)。招待と削除はオーナーだけ、の共通ルール
// - 件名・本文は画面で編集した文面。{お名前}{招待リンク}{有効期限} を差し込み、リンクが無ければ最後に足す
// - リンクはサーバー側で組み立てる(画面から受け取った URL は使わない=なりすまし防止)。
//   リンク先の元(オリジン)は、画面のオリジンが許可リストにあるときだけそれを使う(dev/prod/ローカル)
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { Resend } from "resend";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "AKUTO <noreply@notify.akuto.app>";
const APP_BASE_URL = process.env.APP_BASE_URL || "https://akuto.akuto.app";
const SUPPORT = "info@akuto.app（平日10:00〜17:00）";

const str = (v) => String(v ?? "").trim();
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const ALLOWED_ORIGINS = new Set([
  new URL(APP_BASE_URL).origin,
  "https://akuto.akuto.app",
  "https://mobile-order-prod.web.app",
  "https://mobile-order-dev-5f7fd.web.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

const ROLE_LABEL = { manager: "マネージャー", staff: "スタッフ" };

async function assertStoreOwner(uid, storeId) {
  const snap = await db.collection("users").doc(uid).get();
  const u = snap.exists ? snap.data() : {};
  const role = u.role === "admin" ? "owner" : u.role;
  if (role === "super_admin") return u;
  if (role !== "owner" || str(u.storeId) !== storeId) {
    throw new HttpsError("permission-denied", "メンバーの招待はオーナーだけができます。");
  }
  return u;
}

export const sendStaffInviteEmail = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "ログインしてください。");
  if (!RESEND_API_KEY) throw new HttpsError("failed-precondition", "メール送信の設定がありません。リンクをコピーして送ってください。");

  const d = request.data || {};
  const storeId = str(d.storeId);
  const inviteId = str(d.inviteId);
  const to = str(d.email).toLowerCase();
  const name = str(d.name).slice(0, 60);
  const subject = str(d.subject).slice(0, 120);
  const body = String(d.body ?? "").replace(/\r\n/g, "\n").slice(0, 4000).trim();
  if (!storeId || !inviteId) throw new HttpsError("invalid-argument", "招待が指定されていません。");
  if (!isEmail(to)) throw new HttpsError("invalid-argument", "メールアドレスを正しく入力してください。");
  if (!subject || !body) throw new HttpsError("invalid-argument", "件名と本文を入れてください。");

  await assertStoreOwner(request.auth.uid, storeId);

  const inviteRef = db.collection("stores").doc(storeId).collection("staffInvites").doc(inviteId);
  const snap = await inviteRef.get();
  const inv = snap.exists ? snap.data() : null;
  const expiresAt = inv?.expiresAt?.toDate ? inv.expiresAt.toDate() : null;
  if (!inv || inv.status !== "active" || !expiresAt || expiresAt <= new Date()) {
    throw new HttpsError("failed-precondition", "この招待は使えません。新しく招待を作ってください。");
  }

  let origin = new URL(APP_BASE_URL).origin;
  try {
    const o = new URL(str(d.origin)).origin;
    if (ALLOWED_ORIGINS.has(o)) origin = o;
  } catch { /* 既定のまま */ }
  const link = `${origin}/register?store_id=${encodeURIComponent(storeId)}&invite=${encodeURIComponent(inviteId)}`;
  const until = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(expiresAt);

  let text = body
    .replace(/\{有効期限\}/g, until)
    .replace(/\{お名前\}/g, name ? `${name} 様` : "こんにちは。")
    .replace(/\{役割\}/g, ROLE_LABEL[inv.role] || "スタッフ");
  text = text.includes("{招待リンク}") ? text.replace(/\{招待リンク\}/g, link) : `${text}\n\n${link}`;
  text += `\n\n—\nこのメールは AKUTO から送信しています。お問い合わせ: ${SUPPORT}`;

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: MAIL_FROM, to: [to], subject, text });
  if (error) {
    console.error("[sendStaffInviteEmail] resend error", error);
    throw new HttpsError("internal", "メールを送れませんでした。時間をおくか、リンクをコピーして送ってください。");
  }

  await inviteRef.set({
    email: to, ...(name ? { name } : {}),
    mailSubject: subject, mailBody: body,
    sentAt: FieldValue.serverTimestamp(), sentBy: request.auth.uid,
  }, { merge: true });

  return { ok: true };
});
