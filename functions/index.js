import { initializeApp } from 'firebase-admin/app';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import Stripe from 'stripe';


initializeApp();

const REGION = 'asia-northeast1';
// ★ 名前付きDB 'main'(asia-northeast1) を使用。(default) は旧 nam5(米国)で放置。
const FIRESTORE_DATABASE_ID = 'main';
const db = getFirestore(FIRESTORE_DATABASE_ID);
const adminAuth = getAuth();
const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  OWNER: 'owner',
  MANAGER: 'manager',
  STAFF: 'staff'
};

const APP_ERROR_MESSAGES = {
  'app/method-not-allowed': 'このリクエスト方法は利用できません。',
  'app/custom-mail-not-configured': '独自メール送信の設定が見つかりません。',
  'app/email-verification-mail-failed': '確認メールの送信に失敗しました。',
  'app/invite-invalid': '招待情報を確認してください。',
  'app/invite-not-found': '招待リンクが見つかりません。',
  'app/invite-unavailable': 'この招待リンクは現在利用できません。',
  'app/invite-role-invalid': '招待ロールに問題があります。',
  'app/account-already-registered': 'そのアカウントは既に存在しています。',
  'app/invite-register-failed': '招待アカウントの登録に失敗しました。',
  'app/member-not-found': '対象のメンバーが見つかりません。',
  'app/member-delete-forbidden': 'このメンバーは削除できません。',
  'app/member-delete-failed': 'メンバー削除に失敗しました。',
  'app/unauthenticated': 'ログイン状態を確認してください。',
  'app/account-removed': 'このアカウントは現在利用できません。',
  'app/permission-denied': 'この操作を行う権限がありません。',
  'app/platform-invite-not-found': '管理者招待リンクが見つかりません。',
  'app/platform-invite-unavailable': 'この管理者招待リンクは現在利用できません。',
  'app/platform-admin-register-failed': '管理者アカウントの登録に失敗しました。',
  'app/platform-admin-auth-required': 'スーパーアドミン確認が必要です。',
  'app/platform-admin-auth-failed': '確認コードが正しくありません。',
  'app/platform-admin-auth-expired': '確認コードの有効期限が切れています。',
  'app/platform-admin-session-invalid': 'スーパーアドミン確認セッションが無効です。',
  'app/platform-signup-invalid': '申込内容を確認してください。',
  'app/platform-signup-failed': '申込の送信に失敗しました。',
  'app/stripe-not-configured': 'Stripe設定が見つかりません。',
  'app/platform-plan-not-found': '料金プランが見つかりません。',
  'app/platform-contract-not-found': '契約情報が見つかりません。',
  'app/mobile-order-checkout-failed': 'Checkoutの作成に失敗しました。',
  'app/mobile-order-billing-portal-failed': 'Billing Portalの作成に失敗しました。',
  'app/mobile-order-contract-sync-failed': '契約情報の同期に失敗しました。',
  'app/stripe-webhook-not-configured': 'Stripe Webhook設定が見つかりません。',
  'app/stripe-webhook-invalid': 'Stripe Webhookの検証に失敗しました。'
};

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://haus-qr-order-system.web.app';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const stripeClient = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const TABLE_ENTRY_REUSE_GUARD_TTL_MS = 30 * 60 * 1000;
const PLATFORM_ADMIN_CODE_TTL_MS = 10 * 60 * 1000;
const PLATFORM_ADMIN_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const normalizeUserRole = (role) => {
  if (role === 'admin') return USER_ROLES.OWNER;
  if (
    role === USER_ROLES.SUPER_ADMIN ||
    role === USER_ROLES.OWNER ||
    role === USER_ROLES.MANAGER ||
    role === USER_ROLES.STAFF
  ) {
    return role;
  }
  return null;
};

const getUserProfileSnapshot = async (uid) => db.collection('users').doc(uid).get();
const getPlatformAdminSnapshot = async (uid) => db.collection('platformAdmins').doc(uid).get();

const createStoreId = () => `store_${Math.random().toString(36).substring(2, 7)}`;
const createSessionInviteToken = () => randomBytes(24).toString('hex');
const createParticipantToken = () => randomBytes(24).toString('hex');
const createParticipantId = () => `participant_${randomBytes(8).toString('hex')}`;
const normalizeTableId = (tableId) => String(tableId || '').trim();
const hashToken = (token) => createHash('sha256').update(String(token || '')).digest('hex');
const normalizeParticipantToken = (value) => String(value || '').trim().slice(0, 256);
const getParticipantRecords = (sessionData) => (
  sessionData && typeof sessionData.participantsByTokenHash === 'object' && sessionData.participantsByTokenHash !== null
    ? sessionData.participantsByTokenHash
    : {}
);

const sendJson = (response, status, body) => {
  response.status(status).json(body);
};

const sendAppError = (response, status, appCode, fallbackMessage) => {
  sendJson(response, status, {
    ok: false,
    error: {
      code: appCode,
      message: APP_ERROR_MESSAGES[appCode] || fallbackMessage || '処理に失敗しました。'
    }
  });
};

const parseJsonBody = (request) => {
  if (typeof request.body === 'object' && request.body !== null) {
    return request.body;
  }

  try {
    return JSON.parse(request.body || '{}');
  } catch {
    return {};
  }
};

const getTokyoDateKey = (date = new Date()) => {
  const parts = TOKYO_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const shouldCountOrderForLimitedStock = (orderData) => (
  Boolean(orderData && orderData.status !== 'cancelled' && Array.isArray(orderData.items))
);

const collectItemQuantities = (items = []) => items.reduce((accumulator, item) => {
  const isCancelledItem =
    item?.status === 'cancelled' ||
    item?.kitchenStatus === 'cancelled';

  if (isCancelledItem) {
    return accumulator;
  }

  const itemId = String(item?.id || '').trim();
  const quantity = Math.max(Number(item?.quantity) || 0, 0);

  if (!itemId || quantity <= 0) {
    return accumulator;
  }

  accumulator.set(itemId, (accumulator.get(itemId) || 0) + quantity);
  return accumulator;
}, new Map());

const getBearerToken = (request) => {
  const authHeader = request.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
};

const verifyRequestUser = async (request) => {
  const idToken = getBearerToken(request);
  if (!idToken) {
    throw new Error('app/unauthenticated');
  }

  return adminAuth.verifyIdToken(idToken);
};

const assertStoreOwner = async (uid, storeId) => {
  const callerSnapshot = await getUserProfileSnapshot(uid);

  if (!callerSnapshot.exists) {
    throw new Error('app/account-removed');
  }

  const callerData = callerSnapshot.data();
  const callerRole = normalizeUserRole(callerData.role);

  if (callerData.storeId !== storeId || callerRole !== USER_ROLES.OWNER) {
    throw new Error('app/permission-denied');
  }
};

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const isCustomMailConfigured = () => Boolean(resendClient && MAIL_FROM);

const createNumericCode = (length = 6) => {
  const max = 10 ** length;
  const value = Number.parseInt(randomBytes(4).toString('hex'), 16) % max;
  return String(value).padStart(length, '0');
};

const hashPlatformAdminSecret = (value) => createHash('sha256').update(String(value || '')).digest('hex');

const assertPlatformAdminUser = async (uid) => {
  const adminSnapshot = await getPlatformAdminSnapshot(uid);

  if (!adminSnapshot.exists) {
    throw new Error('app/permission-denied');
  }

  const adminData = adminSnapshot.data() || {};
  if (normalizeUserRole(adminData.role) !== USER_ROLES.SUPER_ADMIN) {
    throw new Error('app/permission-denied');
  }

  return adminData;
};

const getStripeClient = () => {
  if (!stripeClient) {
    throw new Error('app/stripe-not-configured');
  }

  return stripeClient;
};

const getPlatformPlan = async (planId) => {
  const planSnapshot = await db.collection('platformPlans').doc(planId).get();

  if (!planSnapshot.exists) {
    throw new Error('app/platform-plan-not-found');
  }

  return {
    id: planSnapshot.id,
    ref: planSnapshot.ref,
    data: planSnapshot.data() || {}
  };
};

const getPlatformContract = async (contractId) => {
  const contractSnapshot = await db.collection('platformContracts').doc(contractId).get();

  if (!contractSnapshot.exists) {
    throw new Error('app/platform-contract-not-found');
  }

  return {
    id: contractSnapshot.id,
    ref: contractSnapshot.ref,
    data: contractSnapshot.data() || {}
  };
};

const resolveAppUrl = (path = '/') => {
  const normalizedPath = String(path || '/');
  return new URL(normalizedPath, APP_BASE_URL).toString();
};

const buildPlatformAdminAccessCodeMail = ({ email, code }) => {
  const safeEmail = escapeHtml(email);
  const safeCode = escapeHtml(code);

  return {
    subject: 'Akuto スーパーアドミン確認コード',
    text: [
      'Akuto スーパーアドミン画面へのアクセス確認コードです。',
      '',
      `確認コード: ${code}`,
      '',
      'このコードは10分間有効です。',
      '心当たりがない場合は、このメールを破棄してください。'
    ].join('\n'),
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.8;color:#0f172a;">
        <p>${safeEmail} 様</p>
        <p>Akuto スーパーアドミン画面へのアクセス確認コードです。</p>
        <div style="margin:24px 0;padding:18px 22px;border-radius:16px;background:#f8fafc;font-size:28px;font-weight:800;letter-spacing:0.18em;text-align:center;">
          ${safeCode}
        </div>
        <p>このコードは10分間有効です。</p>
        <p style="color:#64748b;font-size:13px;">心当たりがない場合は、このメールを破棄してください。</p>
      </div>
    `
  };
};

const resolvePlatformAdminSessionDocId = (uid, sessionToken) => `${uid}_${hashPlatformAdminSecret(sessionToken).slice(0, 48)}`;

const resolveRedirectUrl = (value, fallbackPath = '/login') => {
  const fallbackUrl = new URL(fallbackPath, APP_BASE_URL).toString();
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return fallbackUrl;
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    return fallbackUrl;
  }
};

const buildPasswordResetMail = ({ email, resetUrl }) => {
  const safeEmail = escapeHtml(email);
  const safeResetUrl = escapeHtml(resetUrl);

  return {
    subject: '【Akuto Order System】パスワード再設定のご案内',
    html: `
      <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;box-shadow:0 20px 45px rgba(15,23,42,0.08);">
          <div style="background:#111827;padding:32px;text-align:center;">
            <div style="display:inline-block;background:#2563eb;color:#ffffff;border-radius:18px;padding:14px 18px;font-size:14px;font-weight:700;letter-spacing:0.08em;">Akuto Order System</div>
            <h1 style="margin:18px 0 0;font-size:26px;line-height:1.3;font-weight:800;color:#ffffff;">パスワード再設定のご案内</h1>
            <p style="margin:10px 0 0;font-size:14px;line-height:1.8;color:#d1d5db;">ご本人による再設定操作として受け付けました。</p>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 18px;font-size:14px;line-height:1.9;color:#475569;">${safeEmail} 宛てに、パスワード再設定用のリンクをご案内します。下のボタンから新しいパスワードを設定してください。</p>
            <div style="margin:28px 0;text-align:center;">
              <a href="${safeResetUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:15px 28px;border-radius:16px;">パスワードを再設定する</a>
            </div>
            <div style="margin:0 0 18px;padding:16px 18px;border:1px solid #fde68a;background:#fffbeb;border-radius:18px;font-size:13px;line-height:1.8;color:#92400e;">
              このメールに心当たりがない場合は、無視してください。
            </div>
            <p style="margin:0;font-size:12px;line-height:1.9;color:#64748b;">このメールは自動送信されています。</p>
          </div>
        </div>
      </div>
    `,
    text: [
      '【Akuto Order System】パスワード再設定のご案内',
      '',
      `${email} 宛てに、パスワード再設定用のリンクをご案内します。`,
      '以下の URL から新しいパスワードを設定してください。',
      resetUrl,
      '',
      'このメールに心当たりがない場合は、無視してください。'
    ].join('\n')
  };
};

const buildEmailVerificationMail = ({ email, verificationUrl }) => {
  const safeEmail = escapeHtml(email);
  const safeVerificationUrl = escapeHtml(verificationUrl);

  return {
    subject: '【Akuto Order System】メールアドレス確認のお願い',
    html: `
      <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;box-shadow:0 20px 45px rgba(15,23,42,0.08);">
          <div style="background:#111827;padding:32px;text-align:center;">
            <div style="display:inline-block;background:#ea580c;color:#ffffff;border-radius:18px;padding:14px 18px;font-size:14px;font-weight:700;letter-spacing:0.08em;">Akuto Order System</div>
            <h1 style="margin:18px 0 0;font-size:26px;line-height:1.3;font-weight:800;color:#ffffff;">メールアドレス確認のお願い</h1>
            <p style="margin:10px 0 0;font-size:14px;line-height:1.8;color:#d1d5db;">アカウント登録を完了するため、メールアドレスの確認をお願いします。</p>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 18px;font-size:14px;line-height:1.9;color:#475569;">${safeEmail} 宛ての確認メールです。下のボタンを押して、メールアドレスの確認を完了してください。</p>
            <div style="margin:28px 0;text-align:center;">
              <a href="${safeVerificationUrl}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:15px 28px;border-radius:16px;">メールアドレスを確認する</a>
            </div>
            <div style="margin:0 0 18px;padding:16px 18px;border:1px solid #fed7aa;background:#fff7ed;border-radius:18px;font-size:13px;line-height:1.8;color:#9a3412;">
              このメールに心当たりがない場合は、無視してください。
            </div>
            <p style="margin:0;font-size:12px;line-height:1.9;color:#64748b;">このメールは自動送信されています。</p>
          </div>
        </div>
      </div>
    `,
    text: [
      '【Akuto Order System】メールアドレス確認のお願い',
      '',
      `${email} 宛ての確認メールです。`,
      '以下の URL からメールアドレスの確認を完了してください。',
      verificationUrl,
      '',
      'このメールに心当たりがない場合は、無視してください。'
    ].join('\n')
  };
};

const sendPasswordResetWithCustomMail = async ({ email, redirectUrl }) => {
  if (!isCustomMailConfigured()) {
    throw new Error('app/custom-mail-not-configured');
  }

  let userRecord = null;
  try {
    userRecord = await adminAuth.getUserByEmail(email);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return { delivery: 'custom-noop' };
    }
    throw error;
  }

  const firebaseResetUrl = await adminAuth.generatePasswordResetLink(userRecord.email, {
    url: redirectUrl
  });
  let resetUrl = firebaseResetUrl;

  try {
    const generatedUrl = new URL(firebaseResetUrl);
    const appResetUrl = new URL(redirectUrl);
    const mode = generatedUrl.searchParams.get('mode');
    const oobCode = generatedUrl.searchParams.get('oobCode');
    const apiKey = generatedUrl.searchParams.get('apiKey');
    const lang = generatedUrl.searchParams.get('lang');

    if (mode) appResetUrl.searchParams.set('mode', mode);
    if (oobCode) appResetUrl.searchParams.set('oobCode', oobCode);
    if (apiKey) appResetUrl.searchParams.set('apiKey', apiKey);
    if (lang) appResetUrl.searchParams.set('lang', lang);

    resetUrl = appResetUrl.toString();
  } catch {
    resetUrl = firebaseResetUrl;
  }

  const message = buildPasswordResetMail({ email: userRecord.email, resetUrl });

  await resendClient.emails.send({
    from: MAIL_FROM,
    to: [userRecord.email],
    subject: message.subject,
    html: message.html,
    text: message.text
  });

  return { delivery: 'custom' };
};

const sendEmailVerificationWithCustomMail = async ({ uid, redirectUrl }) => {
  if (!isCustomMailConfigured()) {
    throw new Error('app/custom-mail-not-configured');
  }

  const userRecord = await adminAuth.getUser(uid);
  if (!userRecord.email) {
    throw new Error('app/email-verification-mail-failed');
  }

  if (userRecord.emailVerified) {
    return { delivery: 'custom-noop' };
  }

  const firebaseVerificationUrl = await adminAuth.generateEmailVerificationLink(userRecord.email, {
    url: redirectUrl
  });
  let verificationUrl = firebaseVerificationUrl;

  try {
    const generatedUrl = new URL(firebaseVerificationUrl);
    const appVerificationUrl = new URL(redirectUrl);
    const mode = generatedUrl.searchParams.get('mode');
    const oobCode = generatedUrl.searchParams.get('oobCode');
    const apiKey = generatedUrl.searchParams.get('apiKey');
    const lang = generatedUrl.searchParams.get('lang');

    if (mode) appVerificationUrl.searchParams.set('mode', mode);
    if (oobCode) appVerificationUrl.searchParams.set('oobCode', oobCode);
    if (apiKey) appVerificationUrl.searchParams.set('apiKey', apiKey);
    if (lang) appVerificationUrl.searchParams.set('lang', lang);

    verificationUrl = appVerificationUrl.toString();
  } catch {
    verificationUrl = firebaseVerificationUrl;
  }

  const message = buildEmailVerificationMail({
    email: userRecord.email,
    verificationUrl
  });

  await resendClient.emails.send({
    from: MAIL_FROM,
    to: [userRecord.email],
    subject: message.subject,
    html: message.html,
    text: message.text
  });

  return { delivery: 'custom' };
};

const getUserRoleForStore = async (uid, storeId) => {
  const snapshot = await getUserProfileSnapshot(uid);
  if (!snapshot.exists) return null;

  const data = snapshot.data();
  if (data.storeId !== storeId) return null;

  return normalizeUserRole(data.role);
};

const assertValidInvite = async (storeId, inviteCode) => {
  const inviteRef = db.collection('stores').doc(storeId).collection('staffInvites').doc(inviteCode);
  const inviteSnapshot = await inviteRef.get();

  if (!inviteSnapshot.exists) {
    throw new Error('app/invite-not-found');
  }

  const inviteData = inviteSnapshot.data();
  const inviteRole = normalizeUserRole(inviteData.role);
  const isExpired = inviteData.expiresAt?.toDate?.() <= new Date();

  if (inviteData.status !== 'active' || isExpired) {
    throw new Error('app/invite-unavailable');
  }

  if (inviteRole !== USER_ROLES.MANAGER && inviteRole !== USER_ROLES.STAFF) {
    throw new Error('app/invite-role-invalid');
  }

  return {
    inviteRef,
    inviteRole
  };
};

const assertValidPlatformAdminInvite = async (inviteCode) => {
  const inviteRef = db.collection('platformAdminInvites').doc(inviteCode);
  const inviteSnapshot = await inviteRef.get();

  if (!inviteSnapshot.exists) {
    throw new Error('app/platform-invite-not-found');
  }

  const inviteData = inviteSnapshot.data();
  const isExpired = inviteData.expiresAt?.toDate?.() <= new Date();

  if (inviteData.status !== 'active' || isExpired) {
    throw new Error('app/platform-invite-unavailable');
  }

  return {
    inviteRef,
    inviteData
  };
};

export const bootstrapCustomerSession = onRequest(
  {
    region: REGION,
    cors: true,
    invoker: 'public',
    minInstances: 1
  },
  async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { storeId, tableId, tableToken, participantToken } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedTableId = normalizeTableId(tableId);
    const normalizedTableToken = String(tableToken || '').trim();
    const normalizedParticipantToken = normalizeParticipantToken(participantToken);
    const requestedParticipantTokenHash = normalizedParticipantToken ? hashToken(normalizedParticipantToken) : '';

    if (!normalizedStoreId || !normalizedTableId) {
      return sendAppError(response, 400, 'app/invite-invalid', 'テーブル情報を確認してください。');
    }

    let role = '';
    let isStoreStaff = false;

    // 通常のお客様QR入口では tableToken が必ずあるため、staff判定は不要。
    // tableTokenなしの管理/スタッフ導線だけ、従来通り role を確認する。
    if (!normalizedTableToken) {
      role = await getUserRoleForStore(authUser.uid, normalizedStoreId);
      isStoreStaff = role === USER_ROLES.OWNER || role === USER_ROLES.MANAGER || role === USER_ROLES.STAFF;

      if (!isStoreStaff) {
        return sendAppError(response, 400, 'app/invite-invalid', 'テーブル情報を確認してください。');
      }
    }

    const tableRef = db.collection('stores').doc(normalizedStoreId).collection('tables').doc(normalizedTableId);
    const tableSessionRef = db.collection('stores').doc(normalizedStoreId).collection('tableSessions').doc(normalizedTableId);
    const tableEntryGuardRef = db.collection('stores').doc(normalizedStoreId).collection('tableEntryGuards').doc(normalizedTableId);
    const sessionsRef = db.collection('stores').doc(normalizedStoreId).collection('sessions');
    const platformAccessRef = db.collection('stores').doc(normalizedStoreId).collection('settings').doc('platformAccess');
    const requestedTableTokenHash = normalizedTableToken ? hashToken(normalizedTableToken) : '';

    const result = await db.runTransaction(async (transaction) => {
      const now = Date.now();

      const [
        accessSnapshot,
        tableSnapshot,
        guardSnapshot,
        lockSnapshot
      ] = await transaction.getAll(
        platformAccessRef,
        tableRef,
        tableEntryGuardRef,
        tableSessionRef
      );

      if (accessSnapshot.exists && accessSnapshot.data()?.storeStatus === 'stopped') {
        return { action: 'stopped' };
      }

      let tableDisplayName = '';

      if (tableSnapshot.exists) {
        const tableData = tableSnapshot.data();
        tableDisplayName = String(
          tableData.tableDisplayName ||
          tableData.displayName ||
          tableData.name ||
          ''
        ).trim();

        if (tableData.isDisabled) {
          return { action: 'disabled' };
        }

        if (!isStoreStaff) {
          const expectedHash = tableData.tableTokenHash || '';
          if (!expectedHash || hashToken(normalizedTableToken) !== expectedHash) {
            return { action: 'error' };
          }
        }
      } else if (!isStoreStaff) {
        return { action: 'error' };
      }

      const resolveActiveSession = async (sessionId) => {
        if (!sessionId) return null;

        const sessionRef = sessionsRef.doc(sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);
        if (!sessionSnapshot.exists) return null;

        const sessionData = sessionSnapshot.data();
        if (sessionData.status !== 'active' || normalizeTableId(sessionData.tableId) !== normalizedTableId) {
          return null;
        }

        return { id: sessionSnapshot.id, data: sessionData };
      };

      const guardData = guardSnapshot.exists ? guardSnapshot.data() : null;
      const guardExpiresAt = guardData?.expiresAt?.toDate?.() || null;

      let activeSession = null;
      if (lockSnapshot.exists) {
        activeSession = await resolveActiveSession(lockSnapshot.data().sessionId);
      }

      let guardSession = null;
      if (!activeSession && guardData?.activeSessionId) {
        guardSession = await resolveActiveSession(guardData.activeSessionId);
        if (guardSession) {
          activeSession = guardSession;
        }
      }

      if (activeSession) {
        const participantRecords = getParticipantRecords(activeSession.data);
        const matchedParticipant = requestedParticipantTokenHash
          ? participantRecords[requestedParticipantTokenHash] || null
          : null;

        const matchedCurrentUserEntry = Object.entries(participantRecords).find(([, record]) => (
          record?.currentUserId === authUser.uid
        ));
        const matchedCurrentUserTokenHash = matchedCurrentUserEntry?.[0] || '';
        const matchedCurrentUserParticipant = matchedCurrentUserEntry?.[1] || null;

        const isSameTableToken = Boolean(
          requestedTableTokenHash
          && activeSession.data.tableTokenHash === requestedTableTokenHash
        );

        const canRestoreByParticipant = Boolean(
          requestedParticipantTokenHash
          && matchedParticipant
          && isSameTableToken
        );

        const canRestoreByCurrentUser = Boolean(
          !canRestoreByParticipant
          && matchedCurrentUserParticipant
          && isSameTableToken
        );

        transaction.set(tableSessionRef, {
          tableId: normalizedTableId,
          sessionId: activeSession.id,
          status: 'active',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        if (canRestoreByParticipant || canRestoreByCurrentUser) {
          const restoredParticipant = matchedParticipant || matchedCurrentUserParticipant;
          const restoredParticipantToken = normalizedParticipantToken || createParticipantToken();
          const restoredParticipantTokenHash = normalizedParticipantToken
            ? requestedParticipantTokenHash
            : hashToken(restoredParticipantToken);

          const nextParticipantRecords = {
            ...participantRecords,
            [restoredParticipantTokenHash]: {
              ...restoredParticipant,
              currentUserId: authUser.uid
            }
          };

          const sessionRestorePayload = {
            members: FieldValue.arrayUnion(authUser.uid),
            participantsByTokenHash: nextParticipantRecords,
            updatedAt: FieldValue.serverTimestamp()
          };

          if (restoredParticipant.role === 'host') {
            sessionRestorePayload.hostUserId = authUser.uid;
          }

          transaction.set(sessionsRef.doc(activeSession.id), sessionRestorePayload, { merge: true });

          return {
            action: 'restore',
            sessionId: activeSession.id,
            tableId: normalizedTableId,
            tableDisplayName: activeSession.data.tableDisplayName || activeSession.data.tableName || tableDisplayName || '',
            tableName: activeSession.data.tableName || activeSession.data.tableDisplayName || tableDisplayName || '',
            participantToken: restoredParticipantToken,
            participantId: restoredParticipant.participantId || ''
          };
        }

        if (isStoreStaff) {
          const nextParticipantToken = createParticipantToken();
          const nextParticipantTokenHash = hashToken(nextParticipantToken);
          const nextParticipantId = createParticipantId();

          transaction.set(sessionsRef.doc(activeSession.id), {
            members: FieldValue.arrayUnion(authUser.uid),
            participantsByTokenHash: {
              ...participantRecords,
              [nextParticipantTokenHash]: {
                participantId: nextParticipantId,
                role: 'staff',
                currentUserId: authUser.uid,
                createdByStaff: true
              }
            },
            updatedAt: FieldValue.serverTimestamp(),
            lastActivityAt: FieldValue.serverTimestamp()
          }, { merge: true });

          return {
            action: 'staff-join',
            sessionId: activeSession.id,
            tableId: normalizedTableId,
            tableDisplayName: activeSession.data.tableDisplayName || activeSession.data.tableName || tableDisplayName || '',
            tableName: activeSession.data.tableName || activeSession.data.tableDisplayName || tableDisplayName || '',
            participantToken: nextParticipantToken,
            participantId: nextParticipantId
          };
        }

        transaction.set(tableEntryGuardRef, {
          tableId: normalizedTableId,
          activeSessionId: activeSession.id,
          tableTokenHash: requestedTableTokenHash,
          expiresAt: new Date(now + TABLE_ENTRY_REUSE_GUARD_TTL_MS),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return {
          action: 'occupied',
          sessionId: activeSession.id,
          tableId: normalizedTableId,
          tableDisplayName: activeSession.data.tableDisplayName || activeSession.data.tableName || tableDisplayName || '',
          tableName: activeSession.data.tableName || activeSession.data.tableDisplayName || tableDisplayName || ''
        };
      }

      if (
        guardSnapshot.exists
        && (
          !guardExpiresAt
          || guardExpiresAt.getTime() <= now
          || (guardData?.activeSessionId && !guardSession)
        )
      ) {
        transaction.delete(tableEntryGuardRef);
      }

      const sessionRef = sessionsRef.doc();
      const inviteToken = createSessionInviteToken();
      const nextParticipantToken = createParticipantToken();
      const nextParticipantTokenHash = hashToken(nextParticipantToken);
      const nextParticipantId = createParticipantId();
      const inviteRef = db.collection('stores').doc(normalizedStoreId).collection('sessionInvites').doc(inviteToken);

      transaction.set(sessionRef, {
        tableId: normalizedTableId,
        tableDisplayName,
        tableName: tableDisplayName,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp(),
        hasOrders: false,
        createdBy: authUser.uid,
        hostUserId: authUser.uid,
        hostParticipantTokenHash: nextParticipantTokenHash,
        members: [authUser.uid],
        participantsByTokenHash: {
          [nextParticipantTokenHash]: {
            participantId: nextParticipantId,
            role: 'host',
            currentUserId: authUser.uid
          }
        },
        totalAmount: 0,
        ...(normalizedTableToken ? { tableTokenHash: hashToken(normalizedTableToken) } : {})
      });

      transaction.set(tableSessionRef, {
        tableId: normalizedTableId,
        tableDisplayName,
        tableName: tableDisplayName,
        sessionId: sessionRef.id,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp()
      });

      transaction.set(inviteRef, {
        sessionId: sessionRef.id,
        tableId: normalizedTableId,
        tableDisplayName,
        tableName: tableDisplayName,
        status: 'active',
        createdAt: FieldValue.serverTimestamp()
      });

      return {
        action: 'created',
        sessionId: sessionRef.id,
        tableId: normalizedTableId,
        tableDisplayName,
        tableName: tableDisplayName,
        inviteToken,
        participantToken: nextParticipantToken,
        participantId: nextParticipantId
      };
    });

    return sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('bootstrapCustomerSession error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', 'テーブル情報の確認に失敗しました。');
  }
});

export const preflightCustomerEntry = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const { storeId, tableId, tableToken, participantToken } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedTableId = normalizeTableId(tableId);
    const normalizedTableToken = String(tableToken || '').trim();
    const normalizedParticipantToken = normalizeParticipantToken(participantToken);

    if (!normalizedStoreId || !normalizedTableId || !normalizedTableToken) {
      return sendAppError(response, 400, 'app/invite-invalid', 'テーブル情報を確認してください。');
    }

    const tableRef = db.collection('stores').doc(normalizedStoreId).collection('tables').doc(normalizedTableId);
    const tableSessionRef = db.collection('stores').doc(normalizedStoreId).collection('tableSessions').doc(normalizedTableId);
    const sessionsRef = db.collection('stores').doc(normalizedStoreId).collection('sessions');
    const platformAccessRef = db.collection('stores').doc(normalizedStoreId).collection('settings').doc('platformAccess');

    const [accessSnapshot, tableSnapshot, lockSnapshot] = await Promise.all([
      platformAccessRef.get(),
      tableRef.get(),
      tableSessionRef.get()
    ]);

    if (accessSnapshot.exists && accessSnapshot.data()?.storeStatus === 'stopped') {
      return sendJson(response, 200, { ok: true, action: 'stopped' });
    }

    if (!tableSnapshot.exists) {
      return sendJson(response, 200, { ok: true, action: 'error' });
    }

    const tableData = tableSnapshot.data();
    if (tableData.isDisabled) {
      return sendJson(response, 200, { ok: true, action: 'disabled' });
    }

    const expectedHash = tableData.tableTokenHash || '';
    if (!expectedHash || hashToken(normalizedTableToken) !== expectedHash) {
      return sendJson(response, 200, { ok: true, action: 'error' });
    }

    if (!lockSnapshot.exists) {
      return sendJson(response, 200, { ok: true, action: 'open' });
    }

    const activeSessionId = String(lockSnapshot.data()?.sessionId || '').trim();
    if (!activeSessionId) {
      return sendJson(response, 200, { ok: true, action: 'open' });
    }

    const sessionSnapshot = await sessionsRef.doc(activeSessionId).get();
    if (!sessionSnapshot.exists) {
      return sendJson(response, 200, { ok: true, action: 'open' });
    }

    const sessionData = sessionSnapshot.data();
    if (sessionData.status !== 'active' || normalizeTableId(sessionData.tableId) !== normalizedTableId) {
      return sendJson(response, 200, { ok: true, action: 'open' });
    }

    const participantRecords = getParticipantRecords(sessionData);
    const requestedTableTokenHash = normalizedTableToken ? hashToken(normalizedTableToken) : '';
    const requestedParticipantTokenHash = normalizedParticipantToken ? hashToken(normalizedParticipantToken) : '';
    const canRestoreByParticipant = Boolean(
      requestedParticipantTokenHash
      && participantRecords[requestedParticipantTokenHash]
      && requestedTableTokenHash
      && sessionData.tableTokenHash === requestedTableTokenHash
    );

    if (canRestoreByParticipant) {
      return sendJson(response, 200, {
        ok: true,
        action: 'restore',
        sessionId: sessionSnapshot.id
      });
    }

    return sendJson(response, 200, {
      ok: true,
      action: 'occupied',
      sessionId: sessionSnapshot.id
    });
  } catch (error) {
    console.error('preflightCustomerEntry error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', 'テーブル情報の確認に失敗しました。');
  }
});

export const preflightJoinCustomerSession = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const { storeId, sessionId, inviteToken, participantToken } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedInviteToken = String(inviteToken || '').trim();
    const normalizedParticipantToken = normalizeParticipantToken(participantToken);

    if (!normalizedStoreId || !normalizedSessionId || !normalizedInviteToken) {
      return sendAppError(response, 400, 'app/invite-invalid', '参加情報を確認してください。');
    }

    const platformAccessRef = db.collection('stores').doc(normalizedStoreId).collection('settings').doc('platformAccess');
    const inviteRef = db.collection('stores').doc(normalizedStoreId).collection('sessionInvites').doc(normalizedInviteToken);
    const sessionRef = db.collection('stores').doc(normalizedStoreId).collection('sessions').doc(normalizedSessionId);

    const [accessSnapshot, inviteSnapshot, sessionSnapshot] = await Promise.all([
      platformAccessRef.get(),
      inviteRef.get(),
      sessionRef.get()
    ]);

    if (accessSnapshot.exists && accessSnapshot.data()?.storeStatus === 'stopped') {
      return sendJson(response, 200, { ok: true, action: 'stopped' });
    }

    if (!inviteSnapshot.exists || !sessionSnapshot.exists) {
      return sendJson(response, 200, { ok: true, action: 'invalid' });
    }

    const inviteData = inviteSnapshot.data();
    const sessionData = sessionSnapshot.data();

    if (
      inviteData.status !== 'active'
      || inviteData.sessionId !== normalizedSessionId
      || sessionData.status !== 'active'
    ) {
      return sendJson(response, 200, { ok: true, action: 'invalid' });
    }

    return sendJson(response, 200, {
      ok: true,
      action: 'open',
      sessionId: sessionSnapshot.id
    });
  } catch (error) {
    console.error('preflightJoinCustomerSession error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', '参加情報の確認に失敗しました。');
  }
});

export const preflightCustomerSession = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const { storeId, sessionId } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();

    if (!normalizedStoreId || !normalizedSessionId) {
      return sendAppError(response, 400, 'app/invite-invalid', 'セッション情報を確認してください。');
    }

    const sessionRef = db.collection('stores').doc(normalizedStoreId).collection('sessions').doc(normalizedSessionId);
    const sessionSnapshot = await sessionRef.get();

    if (!sessionSnapshot.exists) {
      return sendJson(response, 200, { ok: true, action: 'missing' });
    }

    const sessionData = sessionSnapshot.data();
    const tableDisplayName = String(
      sessionData.tableDisplayName ||
      sessionData.tableName ||
      ''
    ).trim();

    if (sessionData.status !== 'active') {
      return sendJson(response, 200, {
        ok: true,
        action: 'ended',
        tableId: sessionData.tableId || null,
        tableDisplayName,
        tableName: tableDisplayName
      });
    }

    return sendJson(response, 200, {
      ok: true,
      action: 'active',
      tableId: sessionData.tableId || null,
      tableDisplayName,
      tableName: tableDisplayName,
      hostUserId: sessionData.hostUserId || null
    });
  } catch (error) {
    console.error('preflightCustomerSession error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', 'セッション情報の確認に失敗しました。');
  }
});

export const joinCustomerSession = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { storeId, sessionId, inviteToken, participantToken } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedInviteToken = String(inviteToken || '').trim();
    const normalizedParticipantToken = normalizeParticipantToken(participantToken);

    if (!normalizedStoreId || !normalizedSessionId || !normalizedInviteToken) {
      return sendAppError(response, 400, 'app/invite-invalid', '参加情報を確認してください。');
    }

    const platformAccessRef = db.collection('stores').doc(normalizedStoreId).collection('settings').doc('platformAccess');
    const inviteRef = db.collection('stores').doc(normalizedStoreId).collection('sessionInvites').doc(normalizedInviteToken);
    const sessionRef = db.collection('stores').doc(normalizedStoreId).collection('sessions').doc(normalizedSessionId);

    const result = await db.runTransaction(async (transaction) => {
      const accessSnapshot = await transaction.get(platformAccessRef);
      if (accessSnapshot.exists && accessSnapshot.data()?.storeStatus === 'stopped') {
        return { action: 'stopped' };
      }

      const inviteSnapshot = await transaction.get(inviteRef);
      if (!inviteSnapshot.exists) {
        return { action: 'missing-invite' };
      }

      const inviteData = inviteSnapshot.data();
      if (inviteData.status !== 'active' || inviteData.sessionId !== normalizedSessionId) {
        return { action: 'invalid-invite' };
      }

      const sessionSnapshot = await transaction.get(sessionRef);
      if (!sessionSnapshot.exists) {
        return { action: 'missing' };
      }

      const sessionData = sessionSnapshot.data();
      if (sessionData.status !== 'active') {
        return { action: 'closed' };
      }

      const members = Array.isArray(sessionData.members) ? sessionData.members : [];
      const participantRecords = getParticipantRecords(sessionData);
      const requestedParticipantTokenHash = normalizedParticipantToken ? hashToken(normalizedParticipantToken) : '';
      const matchedParticipant = requestedParticipantTokenHash
        ? participantRecords[requestedParticipantTokenHash] || null
        : null;

      if (!members.includes(authUser.uid)) {
        transaction.update(sessionRef, {
          members: FieldValue.arrayUnion(authUser.uid)
        });
      }

      if (matchedParticipant) {
        transaction.set(sessionRef, {
          participantsByTokenHash: {
            ...participantRecords,
            [requestedParticipantTokenHash]: {
              ...matchedParticipant,
              currentUserId: authUser.uid
            }
          }
        }, { merge: true });

        return {
          action: 'joined',
          sessionId: normalizedSessionId,
          tableId: sessionData.tableId || null,
          participantToken: normalizedParticipantToken,
          participantId: matchedParticipant.participantId || ''
        };
      }

      const nextParticipantToken = createParticipantToken();
      const nextParticipantTokenHash = hashToken(nextParticipantToken);
      const nextParticipantId = createParticipantId();

      transaction.set(sessionRef, {
        participantsByTokenHash: {
          ...participantRecords,
          [nextParticipantTokenHash]: {
            participantId: nextParticipantId,
            role: 'member',
            currentUserId: authUser.uid
          }
        }
      }, { merge: true });

      return {
        action: 'joined',
        sessionId: normalizedSessionId,
        tableId: sessionData.tableId || null,
        participantToken: nextParticipantToken,
        participantId: nextParticipantId
      };
    });

    if (result.action === 'stopped') {
      return sendAppError(response, 403, 'app/permission-denied', 'この店舗は現在停止中です。');
    }

    if (result.action === 'missing') {
      return sendAppError(response, 404, 'app/invite-not-found', 'セッションが見つかりませんでした。');
    }

    if (result.action === 'missing-invite') {
      return sendAppError(response, 404, 'app/invite-not-found', '参加用リンクが見つかりません。');
    }

    if (result.action === 'invalid-invite') {
      return sendAppError(response, 400, 'app/invite-unavailable', 'この参加用リンクは現在利用できません。');
    }

    if (result.action === 'closed') {
      return sendAppError(response, 400, 'app/invite-unavailable', 'このセッションには参加できません。');
    }

    return sendJson(response, 200, {
      ok: true,
      sessionId: result.sessionId,
      tableId: result.tableId || null,
      participantToken: result.participantToken || '',
      participantId: result.participantId || ''
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/invite-not-found': 404,
        'app/invite-unavailable': 400
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('joinCustomerSession error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', '参加情報の確認に失敗しました。');
  }
});

export const restoreCustomerSessionMember = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { storeId, sessionId, participantToken } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedParticipantToken = normalizeParticipantToken(participantToken);

    if (!normalizedStoreId || !normalizedSessionId || !normalizedParticipantToken) {
      return sendAppError(response, 400, 'app/invite-invalid', '参加情報を確認してください。');
    }

    const sessionRef = db.collection('stores').doc(normalizedStoreId).collection('sessions').doc(normalizedSessionId);

    const result = await db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionRef);
      if (!sessionSnapshot.exists) {
        return { action: 'missing' };
      }

      const sessionData = sessionSnapshot.data();
      if (sessionData.status !== 'active') {
        return { action: 'closed' };
      }

      const participantRecords = getParticipantRecords(sessionData);
      const participantTokenHash = hashToken(normalizedParticipantToken);
      const matchedParticipant = participantRecords[participantTokenHash] || null;

      if (!matchedParticipant) {
        return { action: 'not-found' };
      }

      transaction.set(sessionRef, {
        members: FieldValue.arrayUnion(authUser.uid),
        participantsByTokenHash: {
          ...participantRecords,
          [participantTokenHash]: {
            ...matchedParticipant,
            currentUserId: authUser.uid
          }
        },
        ...(matchedParticipant.role === 'host'
          ? { hostUserId: authUser.uid }
          : {}),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return {
        action: 'restored',
        sessionId: normalizedSessionId,
        tableId: sessionData.tableId || null,
        participantToken: normalizedParticipantToken,
        participantId: matchedParticipant.participantId || ''
      };
    });

    if (result.action === 'missing') {
      return sendAppError(response, 404, 'app/invite-not-found', 'セッションが見つかりませんでした。');
    }

    if (result.action === 'closed') {
      return sendAppError(response, 400, 'app/invite-unavailable', 'このセッションには参加できません。');
    }

    if (result.action === 'not-found') {
      return sendAppError(response, 403, 'app/permission-denied', 'このセッションを復元できませんでした。');
    }

    return sendJson(response, 200, {
      ok: true,
      sessionId: result.sessionId,
      tableId: result.tableId || null,
      participantToken: result.participantToken || '',
      participantId: result.participantId || ''
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/invite-not-found': 404,
        'app/invite-unavailable': 400,
        'app/permission-denied': 403
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('restoreCustomerSessionMember error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', 'セッションの復元に失敗しました。');
  }
});

export const ensureSessionInvite = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { storeId, sessionId } = parseJsonBody(request);
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();

    if (!normalizedStoreId || !normalizedSessionId) {
      return sendAppError(response, 400, 'app/invite-invalid', '招待情報を確認してください。');
    }

    const sessionRef = db.collection('stores').doc(normalizedStoreId).collection('sessions').doc(normalizedSessionId);
    const sessionSnapshot = await sessionRef.get();

    if (!sessionSnapshot.exists) {
      return sendAppError(response, 404, 'app/invite-not-found', 'セッションが見つかりませんでした。');
    }

    const sessionData = sessionSnapshot.data();
    if (sessionData.status !== 'active') {
      return sendAppError(response, 400, 'app/invite-unavailable', 'このセッションでは招待を利用できません。');
    }

    if (sessionData.hostUserId !== authUser.uid) {
      return sendAppError(response, 403, 'app/permission-denied', 'この操作を行う権限がありません。');
    }

    const invitesRef = db.collection('stores').doc(normalizedStoreId).collection('sessionInvites');
    const activeInviteSnapshot = await invitesRef
      .where('sessionId', '==', normalizedSessionId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (!activeInviteSnapshot.empty) {
      return sendJson(response, 200, {
        ok: true,
        inviteToken: activeInviteSnapshot.docs[0].id
      });
    }

    const inviteToken = createSessionInviteToken();
    await invitesRef.doc(inviteToken).set({
      sessionId: normalizedSessionId,
      tableId: normalizeTableId(sessionData.tableId),
      status: 'active',
      createdAt: FieldValue.serverTimestamp()
    });

    return sendJson(response, 200, {
      ok: true,
      inviteToken
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/invite-not-found': 404,
        'app/invite-unavailable': 400
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('ensureSessionInvite error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', '招待リンクの準備に失敗しました。');
  }
});

export const requestPlatformAdminAccessCode = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    if (!isCustomMailConfigured()) {
      return sendAppError(response, 503, 'app/custom-mail-not-configured');
    }

    const authUser = await verifyRequestUser(request);
    const adminData = await assertPlatformAdminUser(authUser.uid);
    const userRecord = await adminAuth.getUser(authUser.uid);
    const email = userRecord.email || adminData.email;

    if (!email) {
      return sendAppError(response, 400, 'app/email-verification-mail-failed');
    }

    const code = createNumericCode(6);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PLATFORM_ADMIN_CODE_TTL_MS);

    await db.collection('platformAdminAccessCodes').doc(authUser.uid).set({
      uid: authUser.uid,
      email,
      codeHash: hashPlatformAdminSecret(code),
      status: 'active',
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt
    }, { merge: true });

    const message = buildPlatformAdminAccessCodeMail({ email, code });

    await resendClient.emails.send({
      from: MAIL_FROM,
      to: [email],
      subject: message.subject,
      html: message.html,
      text: message.text
    });

    await db.collection('platformAuditLogs').add({
      action: 'platform_admin_access_code_requested',
      uid: authUser.uid,
      email,
      createdAt: FieldValue.serverTimestamp()
    });

    return sendJson(response, 200, {
      ok: true,
      delivery: 'custom',
      expiresInSeconds: Math.floor(PLATFORM_ADMIN_CODE_TTL_MS / 1000)
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/custom-mail-not-configured': 503
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('requestPlatformAdminAccessCode error:', error);
    return sendAppError(response, 500, 'app/platform-admin-auth-required');
  }
});

export const verifyPlatformAdminAccessCode = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { code } = parseJsonBody(request);
    const normalizedCode = String(code || '').trim();

    if (!/^\d{6}$/.test(normalizedCode)) {
      return sendAppError(response, 400, 'app/platform-admin-auth-failed');
    }

    await assertPlatformAdminUser(authUser.uid);

    const codeRef = db.collection('platformAdminAccessCodes').doc(authUser.uid);
    const codeSnapshot = await codeRef.get();

    if (!codeSnapshot.exists) {
      return sendAppError(response, 400, 'app/platform-admin-auth-required');
    }

    const codeData = codeSnapshot.data() || {};
    const expiresAt = codeData.expiresAt?.toDate?.() || null;

    if (codeData.status !== 'active' || !expiresAt || expiresAt <= new Date()) {
      await codeRef.set({ status: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return sendAppError(response, 400, 'app/platform-admin-auth-expired');
    }

    if ((Number(codeData.attempts) || 0) >= 5) {
      await codeRef.set({ status: 'locked', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return sendAppError(response, 400, 'app/platform-admin-auth-failed');
    }

    const codeHash = hashPlatformAdminSecret(normalizedCode);
    if (codeHash !== codeData.codeHash) {
      await codeRef.set({
        attempts: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return sendAppError(response, 400, 'app/platform-admin-auth-failed');
    }

    const sessionToken = randomBytes(32).toString('hex');
    const sessionExpiresAt = new Date(Date.now() + PLATFORM_ADMIN_SESSION_TTL_MS);
    const sessionRef = db.collection('platformAdminSessions').doc(resolvePlatformAdminSessionDocId(authUser.uid, sessionToken));

    await db.runTransaction(async (transaction) => {
      transaction.set(sessionRef, {
        uid: authUser.uid,
        sessionTokenHash: hashPlatformAdminSecret(sessionToken),
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: sessionExpiresAt
      }, { merge: true });

      transaction.set(codeRef, {
        status: 'used',
        usedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      transaction.create(db.collection('platformAuditLogs').doc(), {
        action: 'platform_admin_access_code_verified',
        uid: authUser.uid,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    return sendJson(response, 200, {
      ok: true,
      sessionToken,
      expiresAt: sessionExpiresAt.toISOString()
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/platform-admin-auth-required': 401,
        'app/platform-admin-auth-failed': 400,
        'app/platform-admin-auth-expired': 400
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('verifyPlatformAdminAccessCode error:', error);
    return sendAppError(response, 500, 'app/platform-admin-auth-failed');
  }
});

export const verifyPlatformAdminSession = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { sessionToken } = parseJsonBody(request);
    const normalizedSessionToken = String(sessionToken || '').trim();

    if (!normalizedSessionToken) {
      return sendAppError(response, 401, 'app/platform-admin-session-invalid');
    }

    await assertPlatformAdminUser(authUser.uid);

    const sessionRef = db.collection('platformAdminSessions').doc(resolvePlatformAdminSessionDocId(authUser.uid, normalizedSessionToken));
    const sessionSnapshot = await sessionRef.get();

    if (!sessionSnapshot.exists) {
      return sendAppError(response, 401, 'app/platform-admin-session-invalid');
    }

    const sessionData = sessionSnapshot.data() || {};
    const expiresAt = sessionData.expiresAt?.toDate?.() || null;

    if (
      sessionData.status !== 'active' ||
      sessionData.sessionTokenHash !== hashPlatformAdminSecret(normalizedSessionToken) ||
      !expiresAt ||
      expiresAt <= new Date()
    ) {
      await sessionRef.set({ status: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return sendAppError(response, 401, 'app/platform-admin-session-invalid');
    }

    return sendJson(response, 200, {
      ok: true,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/platform-admin-session-invalid': 401
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('verifyPlatformAdminSession error:', error);
    return sendAppError(response, 500, 'app/platform-admin-session-invalid');
  }
});

export const createMobileOrderCheckoutSession = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    await assertPlatformAdminUser(authUser.uid);

    const {
      contractId,
      planId = 'standard',
      includeInitialSetup = true,
      successUrl,
      cancelUrl
    } = parseJsonBody(request);

    const normalizedContractId = String(contractId || '').trim();
    if (!normalizedContractId) {
      return sendAppError(response, 400, 'app/platform-contract-not-found');
    }

    const stripe = getStripeClient();
    const [contract, plan] = await Promise.all([
      getPlatformContract(normalizedContractId),
      getPlatformPlan(String(planId || 'standard').trim())
    ]);

    const contractData = contract.data;
    const planData = plan.data;
    const stripePriceId = String(planData.stripePriceId || '').trim();
    const initialSetupStripePriceId = String(planData.initialSetupStripePriceId || '').trim();

    if (!stripePriceId) {
      return sendAppError(response, 400, 'app/platform-plan-not-found');
    }

    let stripeCustomerId = String(contractData.stripe?.customerId || '').trim();

    if (!stripeCustomerId) {
      const organizationId = String(contractData.organizationId || '').trim();
      const storeId = String(contractData.storeId || '').trim();

      let customerEmail = '';
      let customerName = contractData.planName || 'Akuto Mobile Order';

      if (organizationId) {
        const organizationSnapshot = await db.collection('platformOrganizations').doc(organizationId).get();
        const organizationData = organizationSnapshot.data() || {};
        customerEmail = organizationData.ownerEmail || '';
        customerName = organizationData.name || customerName;
      }

      const customer = await stripe.customers.create({
        email: customerEmail || undefined,
        name: customerName,
        metadata: {
          service: 'akuto_mobile_order',
          organizationId,
          storeId,
          contractId: contract.id
        }
      });

      stripeCustomerId = customer.id;
    }

    const lineItems = [
      {
        price: stripePriceId,
        quantity: 1
      }
    ];

    if (includeInitialSetup && initialSetupStripePriceId) {
      lineItems.push({
        price: initialSetupStripePriceId,
        quantity: 1
      });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: lineItems,
      success_url: resolveRedirectUrl(successUrl, `/?mode=platform&checkout=success&contract_id=${encodeURIComponent(contract.id)}`),
      cancel_url: resolveRedirectUrl(cancelUrl, `/?mode=platform&checkout=cancel&contract_id=${encodeURIComponent(contract.id)}`),
      allow_promotion_codes: false,
      subscription_data: {
        metadata: {
          service: 'akuto_mobile_order',
          organizationId: String(contractData.organizationId || ''),
          storeId: String(contractData.storeId || ''),
          contractId: contract.id,
          planId: plan.id,
          partnerId: String(contractData.partnerId || '')
        }
      },
      metadata: {
        service: 'akuto_mobile_order',
        organizationId: String(contractData.organizationId || ''),
        storeId: String(contractData.storeId || ''),
        contractId: contract.id,
        planId: plan.id,
        partnerId: String(contractData.partnerId || ''),
        includeInitialSetup: includeInitialSetup ? 'true' : 'false'
      }
    });

    await contract.ref.set({
      status: contractData.status || 'draft',
      billingStatus: 'not_started',
      stripe: {
        ...(contractData.stripe || {}),
        customerId: stripeCustomerId,
        checkoutSessionId: checkoutSession.id,
        productId: planData.stripeProductId || '',
        priceId: stripePriceId
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('platformAuditLogs').add({
      action: 'mobile_order_checkout_session_created',
      uid: authUser.uid,
      contractId: contract.id,
      organizationId: contractData.organizationId || '',
      storeId: contractData.storeId || '',
      checkoutSessionId: checkoutSession.id,
      createdAt: FieldValue.serverTimestamp()
    });

    return sendJson(response, 200, {
      ok: true,
      url: checkoutSession.url,
      sessionId: checkoutSession.id,
      customerId: stripeCustomerId
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/stripe-not-configured': 503,
        'app/platform-plan-not-found': 404,
        'app/platform-contract-not-found': 404
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('createMobileOrderCheckoutSession error:', error);
    return sendAppError(response, 500, 'app/mobile-order-checkout-failed');
  }
});

const normalizeStripeSubscriptionStatus = (status) => {
  if (status === 'trialing') return 'trialing';
  if (status === 'active') return 'active';
  if (status === 'past_due') return 'past_due';
  if (status === 'unpaid') return 'unpaid';
  if (status === 'canceled') return 'canceled';
  if (status === 'incomplete' || status === 'incomplete_expired') return 'not_started';
  return status || 'not_started';
};

const resolveContractSnapshotForStripeEvent = async ({ contractId, subscriptionId, customerId }) => {
  const normalizedContractId = String(contractId || '').trim();
  if (normalizedContractId) {
    const snapshot = await db.collection('platformContracts').doc(normalizedContractId).get();
    if (snapshot.exists) return snapshot;
  }

  const normalizedSubscriptionId = String(subscriptionId || '').trim();
  if (normalizedSubscriptionId) {
    const bySubscription = await db.collection('platformContracts')
      .where('stripe.subscriptionId', '==', normalizedSubscriptionId)
      .limit(1)
      .get();

    if (!bySubscription.empty) return bySubscription.docs[0];
  }

  const normalizedCustomerId = String(customerId || '').trim();
  if (normalizedCustomerId) {
    const byCustomer = await db.collection('platformContracts')
      .where('stripe.customerId', '==', normalizedCustomerId)
      .limit(1)
      .get();

    if (!byCustomer.empty) return byCustomer.docs[0];
  }

  return null;
};

const stripeUnixToDate = (value) => {
  const seconds = Number(value || 0);
  return seconds > 0 ? new Date(seconds * 1000) : null;
};

const applyStripeSubscriptionToContract = async ({ contractSnapshot, subscription, extra = {} }) => {
  if (!contractSnapshot?.exists || !subscription) return;

  const status = normalizeStripeSubscriptionStatus(subscription.status);
  const currentPeriodStart = stripeUnixToDate(subscription.current_period_start);
  const currentPeriodEnd = stripeUnixToDate(subscription.current_period_end);
  const canceledAt = stripeUnixToDate(subscription.canceled_at);
  const subscriptionItemId = subscription.items?.data?.[0]?.id || '';

  const update = {
    status,
    billingStatus: status,
    stripe: {
      ...(contractSnapshot.data()?.stripe || {}),
      customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || '',
      subscriptionId: subscription.id,
      subscriptionItemId,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      canceledAt,
      ...extra
    },
    onboarding: {
      ...(contractSnapshot.data()?.onboarding || {}),
      billingConnected: status === 'active' || status === 'trialing'
    },
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === 'active' || status === 'trialing'
      ? { activatedAt: FieldValue.serverTimestamp() }
      : {}),
    ...(status === 'canceled' ? { canceledAt: FieldValue.serverTimestamp() } : {})
  };

  await contractSnapshot.ref.set(update, { merge: true });
};

export const syncMobileOrderContract = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    await assertPlatformAdminUser(authUser.uid);

    const { contractId } = parseJsonBody(request);
    const normalizedContractId = String(contractId || '').trim();

    if (!normalizedContractId) {
      return sendAppError(response, 400, 'app/platform-contract-not-found');
    }

    const stripe = getStripeClient();
    const contract = await getPlatformContract(normalizedContractId);
    const contractData = contract.data;
    const stripeData = contractData.stripe || {};

    let subscriptionId = String(stripeData.subscriptionId || '').trim();
    const customerId = String(stripeData.customerId || '').trim();

    let subscription = null;

    if (subscriptionId) {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } else if (customerId) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 10
      });

      subscription = subscriptions.data.find((item) => (
        item.metadata?.contractId === contract.id
      )) || subscriptions.data[0] || null;

      subscriptionId = subscription?.id || '';
    }

    if (!subscription) {
      await contract.ref.set({
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return sendJson(response, 200, {
        ok: true,
        synced: false,
        reason: 'subscription_not_found'
      });
    }

    await applyStripeSubscriptionToContract({
      contractSnapshot: await contract.ref.get(),
      subscription
    });

    await db.collection('platformAuditLogs').add({
      action: 'mobile_order_contract_synced',
      uid: authUser.uid,
      contractId: contract.id,
      organizationId: contractData.organizationId || '',
      storeId: contractData.storeId || '',
      customerId,
      subscriptionId,
      createdAt: FieldValue.serverTimestamp()
    });

    return sendJson(response, 200, {
      ok: true,
      synced: true,
      subscriptionId: subscription.id,
      status: normalizeStripeSubscriptionStatus(subscription.status)
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/stripe-not-configured': 503,
        'app/platform-contract-not-found': 404
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('syncMobileOrderContract error:', error);
    return sendAppError(response, 500, 'app/mobile-order-contract-sync-failed');
  }
});

export const createMobileOrderBillingPortal = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    await assertPlatformAdminUser(authUser.uid);

    const { contractId, returnUrl } = parseJsonBody(request);
    const normalizedContractId = String(contractId || '').trim();

    if (!normalizedContractId) {
      return sendAppError(response, 400, 'app/platform-contract-not-found');
    }

    const stripe = getStripeClient();
    const contract = await getPlatformContract(normalizedContractId);
    const contractData = contract.data;
    const stripeCustomerId = String(contractData.stripe?.customerId || '').trim();

    if (!stripeCustomerId) {
      return sendAppError(response, 400, 'app/platform-contract-not-found', 'Stripe Customer が未作成です。先にCheckoutを作成してください。');
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: resolveRedirectUrl(returnUrl, `/?mode=platform&contract_id=${encodeURIComponent(contract.id)}`)
    });

    await contract.ref.set({
      stripe: {
        ...(contractData.stripe || {}),
        customerId: stripeCustomerId,
        billingPortalLastOpenedAt: FieldValue.serverTimestamp()
      },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('platformAuditLogs').add({
      action: 'mobile_order_billing_portal_created',
      uid: authUser.uid,
      contractId: contract.id,
      organizationId: contractData.organizationId || '',
      storeId: contractData.storeId || '',
      customerId: stripeCustomerId,
      createdAt: FieldValue.serverTimestamp()
    });

    return sendJson(response, 200, {
      ok: true,
      url: portalSession.url
    });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/stripe-not-configured': 503,
        'app/platform-contract-not-found': 404
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('createMobileOrderBillingPortal error:', error);
    return sendAppError(response, 500, 'app/mobile-order-billing-portal-failed');
  }
});

export const stripeWebhook = onRequest({ region: REGION, cors: false, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return response.status(405).send('Method Not Allowed');
  }

  const stripe = getStripeClient();

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('stripeWebhook missing STRIPE_WEBHOOK_SECRET');
    return response.status(503).send('Webhook secret not configured');
  }

  const signature = request.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(request.rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('stripeWebhook signature verification failed:', error.message);
    return response.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    const object = event.data.object;

    if (event.type === 'checkout.session.completed') {
      const session = object;
      const contractId = session.metadata?.contractId || '';
      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || '';
      const customerId = typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id || '';

      const contractSnapshot = await resolveContractSnapshotForStripeEvent({
        contractId,
        subscriptionId,
        customerId
      });

      if (contractSnapshot?.exists) {
        await contractSnapshot.ref.set({
          status: 'active',
          billingStatus: 'active',
          stripe: {
            ...(contractSnapshot.data()?.stripe || {}),
            customerId,
            subscriptionId,
            checkoutSessionId: session.id,
            latestInvoiceId: typeof session.invoice === 'string' ? session.invoice : session.invoice?.id || ''
          },
          onboarding: {
            ...(contractSnapshot.data()?.onboarding || {}),
            billingConnected: true
          },
          activatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await applyStripeSubscriptionToContract({
            contractSnapshot,
            subscription,
            extra: {
              checkoutSessionId: session.id,
              latestInvoiceId: typeof session.invoice === 'string' ? session.invoice : session.invoice?.id || ''
            }
          });
        }
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = object;
      const contractId = subscription.metadata?.contractId || '';
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id || '';

      const contractSnapshot = await resolveContractSnapshotForStripeEvent({
        contractId,
        subscriptionId: subscription.id,
        customerId
      });

      await applyStripeSubscriptionToContract({ contractSnapshot, subscription });
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = object;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id || '';
      const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id || '';

      const contractSnapshot = await resolveContractSnapshotForStripeEvent({
        contractId: invoice.metadata?.contractId || '',
        subscriptionId,
        customerId
      });

      if (contractSnapshot?.exists) {
        const nextBillingStatus = event.type === 'invoice.paid' ? 'active' : 'past_due';
        await contractSnapshot.ref.set({
          status: nextBillingStatus,
          billingStatus: nextBillingStatus,
          stripe: {
            ...(contractSnapshot.data()?.stripe || {}),
            customerId,
            subscriptionId,
            latestInvoiceId: invoice.id
          },
          onboarding: {
            ...(contractSnapshot.data()?.onboarding || {}),
            billingConnected: event.type === 'invoice.paid'
          },
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    await db.collection('platformAuditLogs').add({
      action: 'stripe_webhook_received',
      eventId: event.id,
      eventType: event.type,
      createdAt: FieldValue.serverTimestamp()
    });

    return response.status(200).send('ok');
  } catch (error) {
    console.error('stripeWebhook handler error:', error);
    return response.status(500).send('Webhook handler failed');
  }
});

export const submitPlatformSignupLead = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const {
      companyName,
      storeName,
      contactName,
      email,
      tel,
      message,
      source = 'signup_page'
    } = parseJsonBody(request);

    const normalizedCompanyName = String(companyName || '').trim();
    const normalizedStoreName = String(storeName || '').trim();
    const normalizedContactName = String(contactName || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedTel = String(tel || '').trim();
    const normalizedMessage = String(message || '').trim();

    if (!normalizedStoreName || !normalizedContactName || !normalizedEmail) {
      return sendAppError(response, 400, 'app/platform-signup-invalid');
    }

    const leadRef = db.collection('platformSignupLeads').doc();

    await leadRef.set({
      id: leadRef.id,
      service: 'akuto_mobile_order',
      companyName: normalizedCompanyName,
      storeName: normalizedStoreName,
      contactName: normalizedContactName,
      email: normalizedEmail,
      tel: normalizedTel,
      message: normalizedMessage,
      source: String(source || 'signup_page').trim(),
      status: 'new',
      salesChannel: 'direct',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    await db.collection('platformAuditLogs').add({
      action: 'platform_signup_lead_submitted',
      leadId: leadRef.id,
      email: normalizedEmail,
      storeName: normalizedStoreName,
      createdAt: FieldValue.serverTimestamp()
    });

    return sendJson(response, 200, {
      ok: true,
      leadId: leadRef.id
    });
  } catch (error) {
    console.error('submitPlatformSignupLead error:', error);
    return sendAppError(response, 500, 'app/platform-signup-failed');
  }
});

export const requestPasswordResetMail = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const { email, redirectUrl } = parseJsonBody(request);
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      return sendJson(response, 400, {
        ok: false,
        error: {
          code: 'auth/missing-email',
          message: 'メールアドレスを入力してください。'
        }
      });
    }

    const result = await sendPasswordResetWithCustomMail({
      email: normalizedEmail,
      redirectUrl: resolveRedirectUrl(redirectUrl)
    });

    return sendJson(response, 200, {
      ok: true,
      delivery: result.delivery
    });
  } catch (error) {
    if (error.message === 'app/custom-mail-not-configured') {
      return sendAppError(response, 503, error.message);
    }

    if (error.code === 'auth/user-not-found') {
      return sendJson(response, 200, {
        ok: true,
        delivery: 'custom-noop'
      });
    }

    console.error('requestPasswordResetMail error:', error);
    return sendJson(response, 500, {
      ok: false,
      error: {
        code: 'app/password-reset-mail-failed',
        message: '再設定メールの送信に失敗しました。'
      }
    });
  }
});

export const requestEmailVerificationMail = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { redirectUrl } = parseJsonBody(request);

    const result = await sendEmailVerificationWithCustomMail({
      uid: authUser.uid,
      redirectUrl: resolveRedirectUrl(redirectUrl)
    });

    return sendJson(response, 200, {
      ok: true,
      delivery: result.delivery
    });
  } catch (error) {
    if (error.message === 'app/custom-mail-not-configured') {
      return sendAppError(response, 503, error.message);
    }

    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/email-verification-mail-failed': 400
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('requestEmailVerificationMail error:', error);
    return sendJson(response, 500, {
      ok: false,
      error: {
        code: 'app/email-verification-mail-failed',
        message: '確認メールの送信に失敗しました。'
      }
    });
  }
});

export const createInvitedMember = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  const { email, password, name, inviteCode, storeId } = parseJsonBody(request);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');
  const normalizedName = String(name || '').trim();
  const normalizedInviteCode = String(inviteCode || '').trim();
  const normalizedStoreId = String(storeId || '').trim();

  if (!normalizedEmail || !normalizedPassword || !normalizedName || !normalizedInviteCode || !normalizedStoreId) {
    return sendAppError(response, 400, 'app/invite-invalid');
  }

  let createdUser = null;

  try {
    const { inviteRef, inviteRole } = await assertValidInvite(normalizedStoreId, normalizedInviteCode);

    let existingAuthUser = null;
    try {
      existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    if (existingAuthUser) {
      const existingUserSnapshot = await getUserProfileSnapshot(existingAuthUser.uid);

      if (existingUserSnapshot.exists) {
        return sendAppError(response, 409, 'app/account-already-registered');
      }

      await adminAuth.deleteUser(existingAuthUser.uid);
    }

    createdUser = await adminAuth.createUser({
      email: normalizedEmail,
      password: normalizedPassword,
      displayName: normalizedName
    });

    await db.runTransaction(async (transaction) => {
      const freshInviteSnapshot = await transaction.get(inviteRef);

      if (!freshInviteSnapshot.exists) {
        throw new Error('app/invite-not-found');
      }

      const freshInviteData = freshInviteSnapshot.data();
      const isExpired = freshInviteData.expiresAt?.toDate?.() <= new Date();

      if (freshInviteData.status !== 'active' || isExpired) {
        throw new Error('app/invite-unavailable');
      }

      transaction.set(db.collection('users').doc(createdUser.uid), {
        uid: createdUser.uid,
        email: normalizedEmail,
        name: normalizedName,
        role: inviteRole,
        storeId: normalizedStoreId,
        inviteCode: normalizedInviteCode,
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true });

      transaction.update(inviteRef, {
        status: 'used',
        usedBy: createdUser.uid,
        usedAt: FieldValue.serverTimestamp()
      });
    });

    return sendJson(response, 200, {
      ok: true,
      uid: createdUser.uid
    });
  } catch (error) {
    if (createdUser?.uid) {
      try {
        await adminAuth.deleteUser(createdUser.uid);
      } catch (deleteError) {
        if (deleteError.code !== 'auth/user-not-found') {
          console.error('Invited member cleanup error:', deleteError);
        }
      }
    }

    if (error.message?.startsWith('app/')) {
      const appCode = error.message;
      const status = appCode === 'app/account-already-registered' ? 409 : 400;
      return sendAppError(response, status, appCode);
    }

    console.error('createInvitedMember error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed');
  }
});

export const createOwnerAccount = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  const { email, password, name } = parseJsonBody(request);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');
  const normalizedName = String(name || '').trim();

  if (!normalizedEmail || !normalizedPassword || !normalizedName) {
    return sendAppError(response, 400, 'app/invite-invalid', '入力内容を確認してください。');
  }

  let createdUser = null;

  try {
    let existingAuthUser = null;
    try {
      existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    if (existingAuthUser) {
      const existingUserSnapshot = await getUserProfileSnapshot(existingAuthUser.uid);
      if (existingUserSnapshot.exists) {
        return sendAppError(response, 409, 'app/account-already-registered');
      }

      await adminAuth.deleteUser(existingAuthUser.uid);
    }

    createdUser = await adminAuth.createUser({
      email: normalizedEmail,
      password: normalizedPassword,
      displayName: normalizedName
    });

    const storeId = createStoreId();

    await db.collection('users').doc(createdUser.uid).set({
      uid: createdUser.uid,
      email: normalizedEmail,
      name: normalizedName,
      role: USER_ROLES.OWNER,
      storeId,
      createdAt: FieldValue.serverTimestamp()
    });

    await db.collection('stores').doc(storeId).set({
      name: '',
      platformStatus: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('stores').doc(storeId).collection('settings').doc('platformAccess').set({
      storeStatus: 'active',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return sendJson(response, 200, {
      ok: true,
      uid: createdUser.uid,
      storeId
    });
  } catch (error) {
    if (createdUser?.uid) {
      try {
        await adminAuth.deleteUser(createdUser.uid);
      } catch (deleteError) {
        if (deleteError.code !== 'auth/user-not-found') {
          console.error('Owner account cleanup error:', deleteError);
        }
      }
    }

    if (error.message?.startsWith('app/')) {
      const status = error.message === 'app/account-already-registered' ? 409 : 400;
      return sendAppError(response, status, error.message);
    }

    console.error('createOwnerAccount error:', error);
    return sendAppError(response, 500, 'app/invite-register-failed', 'オーナーアカウントの登録に失敗しました。');
  }
});

export const createPlatformAdminAccount = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  const { email, password, name, inviteCode } = parseJsonBody(request);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');
  const normalizedName = String(name || '').trim();
  const normalizedInviteCode = String(inviteCode || '').trim();

  if (!normalizedEmail || !normalizedPassword || !normalizedName || !normalizedInviteCode) {
    return sendAppError(response, 400, 'app/invite-invalid', '入力内容を確認してください。');
  }

  let createdUser = null;

  try {
    const { inviteRef, inviteData } = await assertValidPlatformAdminInvite(normalizedInviteCode);

    let existingAuthUser = null;
    try {
      existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    if (existingAuthUser) {
      const [existingUserSnapshot, existingAdminSnapshot] = await Promise.all([
        getUserProfileSnapshot(existingAuthUser.uid),
        getPlatformAdminSnapshot(existingAuthUser.uid)
      ]);

      if (existingUserSnapshot.exists || existingAdminSnapshot.exists) {
        return sendAppError(response, 409, 'app/account-already-registered');
      }

      await adminAuth.deleteUser(existingAuthUser.uid);
    }

    createdUser = await adminAuth.createUser({
      email: normalizedEmail,
      password: normalizedPassword,
      displayName: normalizedName
    });

    await db.runTransaction(async (transaction) => {
      const freshInviteSnapshot = await transaction.get(inviteRef);

      if (!freshInviteSnapshot.exists) {
        throw new Error('app/platform-invite-not-found');
      }

      const freshInviteData = freshInviteSnapshot.data();
      const isExpired = freshInviteData.expiresAt?.toDate?.() <= new Date();

      if (freshInviteData.status !== 'active' || isExpired) {
        throw new Error('app/platform-invite-unavailable');
      }

      transaction.set(db.collection('platformAdmins').doc(createdUser.uid), {
        uid: createdUser.uid,
        email: normalizedEmail,
        name: normalizedName,
        role: 'super_admin',
        invitedBy: inviteData.createdBy || '',
        createdAt: FieldValue.serverTimestamp()
      }, { merge: true });

      transaction.update(inviteRef, {
        status: 'used',
        usedBy: createdUser.uid,
        usedAt: FieldValue.serverTimestamp()
      });
    });

    return sendJson(response, 200, {
      ok: true,
      uid: createdUser.uid
    });
  } catch (error) {
    if (createdUser?.uid) {
      try {
        await adminAuth.deleteUser(createdUser.uid);
      } catch (deleteError) {
        if (deleteError.code !== 'auth/user-not-found') {
          console.error('Platform admin cleanup error:', deleteError);
        }
      }
    }

    if (error.message?.startsWith('app/')) {
      const status = error.message === 'app/account-already-registered' ? 409 : 400;
      return sendAppError(response, status, error.message);
    }

    console.error('createPlatformAdminAccount error:', error);
    return sendAppError(response, 500, 'app/platform-admin-register-failed');
  }
});

export const deleteStoreMember = onRequest({ region: REGION, cors: true, invoker: 'public' }, async (request, response) => {
  if (request.method !== 'POST') {
    return sendAppError(response, 405, 'app/method-not-allowed');
  }

  try {
    const authUser = await verifyRequestUser(request);
    const { memberId } = parseJsonBody(request);
    const normalizedMemberId = String(memberId || '').trim();

    if (!normalizedMemberId) {
      return sendAppError(response, 400, 'app/member-not-found');
    }

    const memberRef = db.collection('users').doc(normalizedMemberId);
    const memberSnapshot = await memberRef.get();

    if (!memberSnapshot.exists) {
      return sendAppError(response, 404, 'app/member-not-found');
    }

    const memberData = memberSnapshot.data();
    const memberRole = normalizeUserRole(memberData.role);

    await assertStoreOwner(authUser.uid, memberData.storeId);

    if (authUser.uid === normalizedMemberId || memberRole === USER_ROLES.OWNER) {
      return sendAppError(response, 403, 'app/member-delete-forbidden');
    }

    try {
      await adminAuth.deleteUser(normalizedMemberId);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    await memberRef.delete();

    return sendJson(response, 200, { ok: true });
  } catch (error) {
    if (error.message?.startsWith('app/')) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/account-removed': 403,
        'app/permission-denied': 403,
        'app/member-not-found': 404
      };
      return sendAppError(response, statusByCode[error.message] || 400, error.message);
    }

    console.error('deleteStoreMember error:', error);
    return sendAppError(response, 500, 'app/member-delete-failed');
  }
});

export const syncLimitedMenuStock = onDocumentWritten(
  {
    region: REGION,
    database: FIRESTORE_DATABASE_ID,
    document: 'stores/{storeId}/orders/{orderId}'
  },
  async (event) => {
    const beforeData = event.data?.before?.exists ? event.data.before.data() : null;
    const afterData = event.data?.after?.exists ? event.data.after.data() : null;

    const beforeItems = shouldCountOrderForLimitedStock(beforeData) ? beforeData.items : [];
    const afterItems = shouldCountOrderForLimitedStock(afterData) ? afterData.items : [];

    const beforeQuantities = collectItemQuantities(beforeItems);
    const afterQuantities = collectItemQuantities(afterItems);
    const itemIds = new Set([...beforeQuantities.keys(), ...afterQuantities.keys()]);

    if (itemIds.size === 0) {
      return;
    }

    const todayKey = getTokyoDateKey();
    const storeId = event.params.storeId;

    await db.runTransaction(async (transaction) => {
      for (const itemId of itemIds) {
        const delta = (afterQuantities.get(itemId) || 0) - (beforeQuantities.get(itemId) || 0);
        if (delta === 0) continue;

        const itemRef = db.collection('stores').doc(storeId).collection('menuItems').doc(itemId);
        const itemSnapshot = await transaction.get(itemRef);
        if (!itemSnapshot.exists) continue;

        const itemData = itemSnapshot.data();
        const limitedQuantity = Number(itemData.limitedQuantity) || 0;
        if (limitedQuantity <= 0) continue;

        const currentSoldCount = itemData.dailySoldDate === todayKey
          ? Math.max(Number(itemData.dailySoldCount) || 0, 0)
          : 0;
        const nextSoldCount = Math.max(currentSoldCount + delta, 0);

        transaction.set(itemRef, {
          dailySoldDate: todayKey,
          dailySoldCount: nextSoldCount,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });
  }
);

const toSafeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeReceiptItems = (items = []) => {
  return items
    .filter((item) => (
      item?.status !== 'cancelled' &&
      item?.kitchenStatus !== 'cancelled'
    ))
    .map((item) => {
      const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
      const unitPrice = toSafeNumber(item.unitPrice || item.price, 0);
      const taxIncludedAmount = quantity * unitPrice;

      return {
        id: String(item.id || ''),
        name: String(item.name || '商品'),
        quantity,
        unitPrice,
        taxRate: toSafeNumber(item.taxRate, 10),
        taxIncludedAmount,
        options: Array.isArray(item.options)
          ? item.options
          : Array.isArray(item.selectedOptions)
            ? item.selectedOptions.map((option) => option.name).filter(Boolean)
            : []
      };
    });
};

const buildReceiptNo = (orderId) => {
  const dateKey = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const shortOrderId = String(orderId || '').slice(0, 8).toUpperCase();
  return `R-${dateKey}-${shortOrderId}`;
};

const buildSimpleTaxSummary = ({ totalAmount, taxRate = 10 }) => {
  const normalizedTotal = Math.max(toSafeNumber(totalAmount, 0), 0);
  const normalizedTaxRate = toSafeNumber(taxRate, 10);

  const taxAmount = Math.floor(
    normalizedTotal * normalizedTaxRate / (100 + normalizedTaxRate)
  );

  return [
    {
      taxRate: normalizedTaxRate,
      taxIncludedTotal: normalizedTotal,
      taxAmount
    }
  ];
};

const normalizeTaxMode = (value, fallback = 'tax_included') => (
  ['tax_included', 'tax_excluded'].includes(value) ? value : fallback
);

const normalizeCostTaxRateType = (value, fallback = 'standard') => (
  ['standard', 'reduced', 'exempt'].includes(value) ? value : fallback
);

const normalizeTaxRoundingMode = (value) => (
  ['floor', 'ceil', 'round'].includes(value) ? value : 'floor'
);

const applyTaxRoundingServer = (value, mode = 'floor') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;

  const roundedBase = Number(amount.toFixed(8));
  const normalizedMode = normalizeTaxRoundingMode(mode);

  if (normalizedMode === 'ceil') return Math.ceil(roundedBase);
  if (normalizedMode === 'round') return Math.round(roundedBase);
  return Math.floor(roundedBase);
};

const splitTaxIncludedAmountServer = (taxIncludedAmount, taxRate, roundingMode = 'floor') => {
  const included = Math.max(toSafeNumber(taxIncludedAmount, 0), 0);
  const rate = Math.max(toSafeNumber(taxRate, 0), 0);

  if (rate <= 0) {
    return {
      taxIncludedAmount: included,
      taxExcludedAmount: included,
      taxAmount: 0
    };
  }

  const taxExcludedAmount = applyTaxRoundingServer(included / (1 + (rate / 100)), roundingMode);
  return {
    taxIncludedAmount: included,
    taxExcludedAmount,
    taxAmount: included - taxExcludedAmount
  };
};

const toTaxIncludedAmountServer = (taxExcludedAmount, taxRate, roundingMode = 'floor') => {
  const excluded = Math.max(toSafeNumber(taxExcludedAmount, 0), 0);
  const rate = Math.max(toSafeNumber(taxRate, 0), 0);

  if (rate <= 0) {
    return {
      taxIncludedAmount: excluded,
      taxExcludedAmount: excluded,
      taxAmount: 0
    };
  }

  const taxIncludedAmount = applyTaxRoundingServer(excluded * (1 + (rate / 100)), roundingMode);
  return {
    taxIncludedAmount,
    taxExcludedAmount: excluded,
    taxAmount: taxIncludedAmount - excluded
  };
};

const resolveSalesTaxSnapshot = ({ menuData = {}, storeData = {}, taxIncludedAmount = 0 }) => {
  const included = Math.max(toSafeNumber(taxIncludedAmount, 0), 0);

  const taxRateType = menuData.taxRateType === 'reduced'
    || menuData.isReducedTaxRate === true
    || menuData.allowsTakeout === true && menuData.takeoutSelected === true
    ? 'reduced'
    : 'standard';

  const salesTaxRate = taxRateType === 'reduced'
    ? Math.max(toSafeNumber(storeData.taxRateReduced, 8), 0)
    : Math.max(toSafeNumber(storeData.taxRate, 10), 0);

  const taxRounding = normalizeTaxRoundingMode(storeData.taxRounding);
  const breakdown = splitTaxIncludedAmountServer(included, salesTaxRate, taxRounding);

  return {
    salesTaxRateType: taxRateType,
    salesTaxRate,
    salesTaxIncludedAmount: breakdown.taxIncludedAmount,
    salesTaxExcludedAmount: breakdown.taxExcludedAmount,
    salesTaxAmount: breakdown.taxAmount
  };
};

const resolveCostSnapshot = ({ menuData = {}, storeData = {}, quantity = 1, salesTaxIncludedAmount = 0 }) => {
  const salesSnapshot = resolveSalesTaxSnapshot({
    menuData,
    storeData,
    taxIncludedAmount: salesTaxIncludedAmount
  });

  const rawCostPrice = menuData.costPrice;

  if (rawCostPrice === null || rawCostPrice === undefined || rawCostPrice === '') {
    return {
      costPrice: null,
      costTaxMode: normalizeTaxMode(storeData.defaultCostTaxMode, 'tax_included'),
      costTaxRateType: normalizeCostTaxRateType(storeData.defaultCostTaxRateType, 'standard'),
      costTaxRate: null,
      unitCostTaxIncluded: null,
      unitCostTaxExcluded: null,
      unitCostTaxAmount: null,
      costTaxIncludedAmount: null,
      costTaxExcludedAmount: null,
      costTaxAmount: null,
      ...salesSnapshot,
      grossProfitTaxIncluded: null,
      grossProfitTaxExcluded: null,
      grossProfitRate: null
    };
  }

  const normalizedQuantity = Math.max(toSafeNumber(quantity, 0), 0);
  const unitCost = Math.max(toSafeNumber(rawCostPrice, 0), 0);

  const defaultCostTaxMode = normalizeTaxMode(storeData.defaultCostTaxMode, 'tax_included');
  const defaultCostTaxRateType = normalizeCostTaxRateType(storeData.defaultCostTaxRateType, 'standard');

  const costTaxMode = normalizeTaxMode(
    menuData.costTaxMode === 'inherit' ? defaultCostTaxMode : menuData.costTaxMode,
    defaultCostTaxMode
  );

  const costTaxRateType = normalizeCostTaxRateType(
    menuData.costTaxRateType === 'inherit' ? defaultCostTaxRateType : menuData.costTaxRateType,
    defaultCostTaxRateType
  );

  const costTaxRate = costTaxRateType === 'exempt'
    ? 0
    : costTaxRateType === 'reduced'
      ? Math.max(toSafeNumber(storeData.taxRateReduced, 8), 0)
      : Math.max(toSafeNumber(storeData.taxRate, 10), 0);

  const taxRounding = normalizeTaxRoundingMode(storeData.taxRounding);

  const unitCostBreakdown = costTaxMode === 'tax_excluded'
    ? toTaxIncludedAmountServer(unitCost, costTaxRate, taxRounding)
    : splitTaxIncludedAmountServer(unitCost, costTaxRate, taxRounding);

  const costTaxIncludedAmount = unitCostBreakdown.taxIncludedAmount * normalizedQuantity;
  const costTaxExcludedAmount = unitCostBreakdown.taxExcludedAmount * normalizedQuantity;
  const costTaxAmount = unitCostBreakdown.taxAmount * normalizedQuantity;

  const salesIncluded = Math.max(toSafeNumber(salesSnapshot.salesTaxIncludedAmount, 0), 0);
  const salesExcluded = Math.max(toSafeNumber(salesSnapshot.salesTaxExcludedAmount, 0), 0);
  const grossProfitTaxIncluded = salesIncluded - costTaxIncludedAmount;
  const grossProfitTaxExcluded = salesExcluded - costTaxExcludedAmount;

  return {
    ...salesSnapshot,
    costPrice: unitCost,
    costTaxMode,
    costTaxRateType,
    costTaxRate,
    unitCostTaxIncluded: unitCostBreakdown.taxIncludedAmount,
    unitCostTaxExcluded: unitCostBreakdown.taxExcludedAmount,
    unitCostTaxAmount: unitCostBreakdown.taxAmount,
    costTaxIncludedAmount,
    costTaxExcludedAmount,
    costTaxAmount,
    grossProfitTaxIncluded,
    grossProfitTaxExcluded,
    grossProfitRate: salesIncluded > 0
      ? Math.round((grossProfitTaxIncluded / salesIncluded) * 1000) / 10
      : null
  };
};


async function getTableDisplayName({ storeId, tableId }) {
  const normalizedStoreId = String(storeId || '').trim();
  const normalizedTableId = String(tableId || '').trim();

  if (!normalizedStoreId || !normalizedTableId) return '';

  try {
    const tableSnapshot = await db
      .collection('stores')
      .doc(normalizedStoreId)
      .collection('tables')
      .doc(normalizedTableId)
      .get();

    if (!tableSnapshot.exists) return '';

    const tableData = tableSnapshot.data() || {};

    return String(
      tableData.tableDisplayName ||
      tableData.displayName ||
      tableData.name ||
      ''
    ).trim();
  } catch (error) {
    console.warn('[getTableDisplayName] failed', {
      storeId: normalizedStoreId,
      tableId: normalizedTableId,
      error
    });
    return '';
  }
}

async function getReceiptStoreData(storeRef) {
  const [storeSnapshot, basicSettingsSnapshot] = await Promise.all([
    storeRef.get(),
    storeRef.collection('settings').doc('basic').get()
  ]);

  const rootStoreData = storeSnapshot.exists ? storeSnapshot.data() || {} : {};
  const basicSettings = basicSettingsSnapshot.exists
    ? basicSettingsSnapshot.data() || {}
    : {};

  return {
    ...rootStoreData,
    ...basicSettings
  };
}

async function issueReceiptForOrder({
  storeId,
  orderRef,
  orderData,
  storeData = {}
}) {
  const receiptRef = db
    .collection('stores')
    .doc(storeId)
    .collection('receipts')
    .doc();

  const receiptNo = buildReceiptNo(orderRef.id);
  const totalAmount = toSafeNumber(orderData.totalPrice || orderData.totalAmount, 0);
  const items = normalizeReceiptItems(orderData.items || []);

  const receiptData = {
    receiptId: receiptRef.id,
    receiptNo,

    orderId: orderRef.id,
    sessionId: orderData.sessionId || '',
    tableId: orderData.tableId || '',

    customerIds: [
      orderData.participantId || orderData.customerId || orderData.userId
    ].filter(Boolean),

    customerSummaries: [
      {
        customerId: orderData.participantId || orderData.customerId || orderData.userId || '',
        orderIds: [orderRef.id],
        orderCount: 1,
        totalAmount: toSafeNumber(orderData.totalPrice || orderData.totalAmount, 0)
      }
    ],

    type: 'receipt',
    status: 'issued',

    store: {
      storeId,
      name: storeData.name || storeData.storeName || '店舗名',
      address: storeData.address || '',
      phone: storeData.tel || storeData.phone || '',
      registrationNumber: storeData.invoiceNumber || storeData.registrationNumber || ''
    },

    items,

    taxSummaries: buildSimpleTaxSummary({
      totalAmount,
      taxRate: storeData.taxRate || 10
    }),

    totals: {
      subtotal: Math.max(
        totalAmount - buildSimpleTaxSummary({ totalAmount, taxRate: storeData.taxRate || 10 })[0].taxAmount,
        0
      ),
      tax: buildSimpleTaxSummary({ totalAmount, taxRate: storeData.taxRate || 10 })[0].taxAmount,
      total: totalAmount
    },

    payment: {
      method: orderData.paymentMethod || 'prepay',
      status: 'paid',
      paidAt: FieldValue.serverTimestamp()
    },

    issuedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  await receiptRef.set(receiptData);

  await orderRef.set({
    receiptId: receiptRef.id,
    receiptNo,
    receiptIssuedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    receiptId: receiptRef.id,
    receiptNo
  };
}



// NOTE: 以前は createPostpayOrder のトランザクション内で session ドキュメントを
// 書き込む markSessionHasOrders ヘルパを使っていたが、hot-doc 競合対策(案1)により
// コミット後のトランザクション外書き込みに移したため廃止。



const SHOPIFY_ADMIN_API_VERSION = '2026-01';

const normalizeShopifyDomain = (value = '') => {
  const domain = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error('Shopifyストアドメインを確認してください。');
  }

  return domain;
};

const normalizeShopifyMoney = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return '0';
  return String(Math.round(amount));
};

const normalizeShopifyPriceSyncMode = (value = '') => (
  value === 'taxExcluded' ? 'taxExcluded' : 'taxIncluded'
);

const resolveShopifySyncPriceValue = (product = {}, priceSyncMode = 'taxIncluded') => {
  const mode = normalizeShopifyPriceSyncMode(priceSyncMode);

  if (mode === 'taxExcluded') {
    return product.priceTaxExcluded ?? product.price ?? product.salesPrice ?? 0;
  }

  return product.priceTaxIncluded ?? product.priceTaxExcluded ?? product.price ?? product.salesPrice ?? 0;
};

const calculateTaxIncludedPrice = (taxExcluded, taxRate = 10) => {
  const excluded = Number(taxExcluded);
  const rate = Number(taxRate);

  if (!Number.isFinite(excluded) || excluded <= 0) return null;
  if (!Number.isFinite(rate) || rate < 0) return Math.round(excluded);

  return Math.round(excluded * (1 + rate / 100));
};

const resolveShopifyEffectivePriceValue = (product = {}, priceSyncMode = 'taxIncluded') => {
  const mode = normalizeShopifyPriceSyncMode(priceSyncMode);

  if (mode === 'taxExcluded') {
    return product.priceTaxExcluded ?? product.price ?? 0;
  }

  const taxIncluded = Number(product.priceTaxIncluded);
  const taxExcluded = Number(product.priceTaxExcluded);
  const taxRate = Number(product.taxRate ?? 10);

  const recalculatedTaxIncluded = calculateTaxIncludedPrice(taxExcluded, taxRate);

  if (
    recalculatedTaxIncluded !== null &&
    Number.isFinite(taxIncluded) &&
    taxIncluded > 0 &&
    Math.abs(recalculatedTaxIncluded - taxIncluded) > 1
  ) {
    return recalculatedTaxIncluded;
  }

  if (recalculatedTaxIncluded !== null && (!Number.isFinite(taxIncluded) || taxIncluded <= 0)) {
    return recalculatedTaxIncluded;
  }

  return product.priceTaxIncluded ?? product.price ?? 0;
};

const buildShopifySyncPriceSnapshot = (product = {}, priceSyncMode = 'taxIncluded') => {
  const mode = normalizeShopifyPriceSyncMode(priceSyncMode);
  const rawPrice = resolveShopifyEffectivePriceValue(product, mode);

  return {
    priceSyncMode: mode,
    rawPrice,
    price: normalizeShopifyMoney(rawPrice),
    priceTaxExcluded: product.priceTaxExcluded ?? null,
    priceTaxIncluded: product.priceTaxIncluded ?? null,
    taxRate: product.taxRate ?? null
  };
};

// タイトルは「ブランド名｜商品名」(全角縦棒)。ブランド無し/商品名に既に｜がある/
// 商品名がブランド名で始まる場合は二重付与しない。
const resolveShopifyProductTitle = (group = {}, products = []) => {
  const primaryProduct = products.find((product) => product.productGroupRole === 'primary') || products[0] || {};
  const baseTitle = normalizeShopifyText(
    primaryProduct.name || primaryProduct.productGroupName || group.name,
    group.baseProductName || group.name || 'Akuto Product'
  );
  const brandName = normalizeShopifyText(group.brandName || primaryProduct.brandName, '');

  if (!brandName) return baseTitle;
  if (baseTitle.includes('｜')) return baseTitle;
  if (baseTitle.toLowerCase().startsWith(brandName.toLowerCase())) return baseTitle;

  return `${brandName}｜${baseTitle}`;
};

// productGroups ドキュメントは保存経路により brandName/categoryName/subCategoryName/
// categoryGroupName を持たないことがあるため、primary商品の値で補完する。
const enrichShopifyGroupContext = (group = {}, products = []) => {
  const primaryProduct = products.find((product) => product.productGroupRole === 'primary') || products[0] || {};

  return {
    ...group,
    brandId: group.brandId || primaryProduct.brandId || '',
    brandName: normalizeShopifyText(group.brandName || primaryProduct.brandName, ''),
    categoryName: normalizeShopifyText(group.categoryName || primaryProduct.categoryName, ''),
    subCategoryName: normalizeShopifyText(group.subCategoryName || primaryProduct.subCategoryName, ''),
    categoryGroupName: normalizeShopifyText(group.categoryGroupName || primaryProduct.categoryGroupName, '')
  };
};

// ブランドプロフィール(商品メタフィールド my_fields._brand)の取得。
// ブランドマスターUIの「ブランドプロフィール」欄は brands/{id}.note に保存されている。
const fetchShopifyBrandProfile = async (storeRef, group = {}, products = []) => {
  try {
    const primaryProduct = products.find((product) => product.productGroupRole === 'primary') || products[0] || {};
    const brandId = String(group.brandId || primaryProduct.brandId || '').trim();
    if (!brandId) return '';
    const brandSnap = await storeRef.collection('brands').doc(brandId).get();
    if (!brandSnap.exists) return '';
    return String(brandSnap.data()?.note || '').trim();
  } catch (error) {
    console.warn('[shopify] brand profile fetch failed', error?.message);
    return '';
  }
};

// 同期(作成/更新)直後にPOSの現在庫をShopifyへ初期反映する(on_hand絶対値set)。
// productSet は在庫数量を扱わないため、これが無いと同期直後の Shopify 在庫は 0 のままになる。
// inventorySyncEnabled かつ locationId 設定時のみ。失敗しても同期自体は成功として扱う。
const pushInitialInventoryToShopify = async ({ shopDomain, accessToken, settings, products, savedVariants }) => {
  try {
    if (!settings.inventorySyncEnabled) return { pushed: 0, skipped: 'inventorySyncDisabled' };
    const locationId = String(settings.locationId || '').trim();
    if (!locationId) return { pushed: 0, skipped: 'noLocationId' };

    const quantityByProductId = new Map(products.map((product) => [
      String(product.id),
      Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0)
    ]));
    // 商品単位の在庫同期OFFは初期反映もスキップ。
    const syncDisabledProductIds = new Set(
      products
        .filter((product) => product.shopifyInventorySyncDisabled === true)
        .map((product) => String(product.id))
    );
    const setQuantities = savedVariants
      .filter((variant) => String(variant.shopifyInventoryItemId || '').trim())
      .filter((variant) => !syncDisabledProductIds.has(String(variant.productId)))
      .map((variant) => ({
        inventoryItemId: variant.shopifyInventoryItemId,
        locationId,
        quantity: quantityByProductId.get(String(variant.productId)) ?? 0
      }));
    if (setQuantities.length === 0) return { pushed: 0, skipped: 'noLinkedItems' };

    const mutation = 'mutation($input: InventorySetOnHandQuantitiesInput!){ inventorySetOnHandQuantities(input:$input){ userErrors{ field message } } }';
    const data = await callShopifyGraphql({
      shopDomain,
      accessToken,
      query: mutation,
      variables: { input: { reason: 'correction', setQuantities } }
    });
    const userErrors = data.inventorySetOnHandQuantities?.userErrors || [];
    if (userErrors.length) console.warn('[shopify] initial inventory push userErrors', userErrors);
    return { pushed: setQuantities.length, userErrors: userErrors.length };
  } catch (error) {
    console.warn('[shopify] initial inventory push failed', error?.message);
    return { pushed: 0, error: error?.message || 'failed' };
  }
};

// 商品レベルの metafields (ブランドプロフィール)。空なら送らない(=Shopify側を上書きしない)。
const buildShopifyProductMetafields = (brandProfile = '') => {
  const value = String(brandProfile || '').trim();
  if (!value) return [];
  return [
    {
      namespace: 'my_fields',
      key: '_brand',
      type: 'multi_line_text_field',
      value
    }
  ];
};

const normalizeShopifyText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};


const normalizeShopifyTag = (value = '') => (
  normalizeShopifyText(value, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const buildMergedShopifyTags = (...values) => {
  const seen = new Set();

  return values
    .flat()
    .map((value) => normalizeShopifyText(value, ''))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// 性別タグ。正データは products.gender(大文字 MEN/WOMEN/UNISEX/'')。性別はグループ単位=primary代表。
// MEN→MEN / WOMEN→WOMEN / UNISEX→MEN+WOMEN+UNISEX / 空→なし。設計: docs/gender-attribute-design.md
const SHOPIFY_GENDER_VALUES = new Set(['MEN', 'WOMEN', 'UNISEX']);

const normalizeShopifyGenderValue = (value) => {
  const upper = String(value || '').trim().toUpperCase();
  return SHOPIFY_GENDER_VALUES.has(upper) ? upper : '';
};

const resolveShopifyGenderTags = (products = []) => {
  const primary = products.find((product) => product.productGroupRole === 'primary') || products[0] || {};
  const gender = normalizeShopifyGenderValue(primary.gender);
  if (gender === 'MEN') return ['MEN'];
  if (gender === 'WOMEN') return ['WOMEN'];
  if (gender === 'UNISEX') return ['MEN', 'WOMEN', 'UNISEX'];
  return [];
};

// カテゴリー系タグ = categoryGroupName + categoryName + subCategoryName。
// 性別 literal(MEN/WOMEN/UNISEX)は性別タグへ委ねるため除外(重複はどのみち後段でdedup)。
const resolveShopifyCategoryTags = (group = {}) => {
  const tags = [];
  if (!normalizeShopifyGenderValue(group.categoryGroupName)) {
    tags.push(group.categoryGroupName);
  }
  tags.push(group.categoryName);
  if (!normalizeShopifyGenderValue(group.subCategoryName)) {
    tags.push(group.subCategoryName);
  }
  return tags;
};

const getShopifyProductTags = async ({ shopDomain, accessToken, productId }) => {
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId) return [];

  const data = await callShopifyGraphql({
    shopDomain,
    accessToken,
    query: `
      query GetProductTags($id: ID!) {
        product(id: $id) {
          id
          tags
        }
      }
    `,
    variables: { id: normalizedProductId }
  });

  return Array.isArray(data?.product?.tags) ? data.product.tags : [];
};


const getShopifyAccessTokenFromSettings = async (settings = {}) => {
  const shopDomain = normalizeShopifyDomain(settings.shopDomain);
  const clientId = String(settings.clientId || '').trim();
  const clientSecret = String(settings.clientSecret || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('Shopify Dev DashboardのクライアントID/シークレットが未設定です。');
  }

  const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const tokenBody = await tokenResponse.json().catch(() => ({}));

  if (!tokenResponse.ok || !tokenBody.access_token) {
    console.error('[shopify] token request failed', {
      status: tokenResponse.status,
      body: tokenBody
    });
    throw new Error(tokenBody.error_description || tokenBody.error || 'Shopifyアクセストークンの取得に失敗しました。');
  }

  return {
    shopDomain,
    accessToken: tokenBody.access_token,
    expiresIn: tokenBody.expires_in || null,
    scope: tokenBody.scope || ''
  };
};

const callShopifyGraphql = async ({ shopDomain, accessToken, query, variables }) => {
  const graphqlResponse = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({ query, variables })
  });

  const graphqlBody = await graphqlResponse.json().catch(() => ({}));

  if (!graphqlResponse.ok || graphqlBody.errors) {
    console.error('[shopify] graphql request failed', {
      status: graphqlResponse.status,
      body: graphqlBody
    });
    throw new Error(graphqlBody.errors?.[0]?.message || 'Shopify GraphQL APIの呼び出しに失敗しました。');
  }

  return graphqlBody.data || {};
};

const resolveShopifyOptionName = (products = []) => {
  const sizes = new Set(products.map((product) => String(product.size || '').trim()).filter(Boolean));
  const colors = new Set(products.map((product) => String(product.colorName || '').trim()).filter(Boolean));

  if (sizes.size > 1 && colors.size <= 1) return 'サイズ';
  if (colors.size > 1 && sizes.size <= 1) return 'カラー';
  return 'バリエーション';
};

const resolveShopifyOptionValue = (product = {}, optionName = 'バリエーション') => {
  const size = String(product.size || '').trim();
  const color = String(product.colorName || '').trim();

  if (optionName === 'サイズ' && size) return size;
  if (optionName === 'カラー' && color) return color;
  if (size && color) return `${size} / ${color}`;
  if (size) return size;
  if (color) return color;
  return String(product.sku || product.productCode || product.id || 'Default').trim();
};

const resolveUniqueShopifyOptionValue = (product = {}, optionName = 'バリエーション', index = 0, usedOptionValues = new Set()) => {
  const rawBase = normalizeShopifyText(resolveShopifyOptionValue(product, optionName), '');
  const sku = normalizeShopifyText(product.sku || product.productCode, '');
  const productId = normalizeShopifyText(product.id, '');
  const fallback = sku || productId || `variant-${index + 1}`;

  const candidates = [
    rawBase,
    rawBase && sku ? `${rawBase} / ${sku}` : '',
    sku,
    productId,
    `${fallback} ${index + 1}`
  ].filter(Boolean);

  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (!usedOptionValues.has(key)) {
      usedOptionValues.add(key);
      return candidate;
    }
  }

  const finalValue = `${fallback} ${index + 1}`;
  usedOptionValues.add(finalValue.toLowerCase());
  return finalValue;
};

// バーコード重複のみ事前チェック(オプション値/サイズ×カラーの一意化は buildShopifyOptionAssignment 側で吸収)。
const assertUniqueShopifyInputValues = (products = []) => {
  const seenBarcodes = new Map();
  const duplicated = [];

  products.forEach((product, index) => {
    const label = product.name || product.productGroupName || product.sku || product.productCode || product.id || `商品${index + 1}`;
    const barcode = String(product.barcode || '').trim();
    if (!barcode) return;
    const barcodeKey = barcode.toLowerCase();
    if (seenBarcodes.has(barcodeKey)) {
      duplicated.push(`JAN重複: ${barcode}（${seenBarcodes.get(barcodeKey)} / ${label}）`);
    } else {
      seenBarcodes.set(barcodeKey, label);
    }
  });

  if (duplicated.length > 0) {
    throw new Error(`Shopify同期前チェックで重複があります。\n${duplicated.join('\n')}`);
  }
};

// 単品(バリエーション無し)は Shopify 標準の Title/Default Title パターンで登録する。
// → hasOnlyDefaultVariant=true となりバリエーション欄が表示されず、SKU空でも登録できる
//   (品番にバーコードを入れてバリエーション表示される不自然さを回避)。
const SHOPIFY_DEFAULT_OPTION_NAME = 'Title';
const SHOPIFY_DEFAULT_OPTION_VALUE = 'Default Title';

const SHOPIFY_SIZE_OPTION_NAME = 'Size';
const SHOPIFY_COLOR_OPTION_NAME = 'Color';
const SHOPIFY_GENERIC_OPTION_NAME = 'Variant';

// サイズ・カラーを別オプションに分けて割り当てる(複数商品用)。
// - サイズ/カラーそれぞれ「値が入力されている(1商品でも非空)」次元をオプション化。
//   値が1種でも入力があれば作る(例: カラーがBROWN1色でも Color オプションを作る)。未入力の次元は作らない。
//   両方入力あり→2オプション/片方→1/どちらも未入力→SKU の単一オプション。
// - 各variantは全オプションの値を持つ必要があるため、空のサイズ/カラーは「フリー」「ワンカラー」で補う。
// - 組合せ(サイズ×カラー)が衝突したら最後の軸に sku/連番を付けて一意化する。
// 返り値: { productOptions:[{name,position,values:[{name}]}], optionValuesByIndex:[[{optionName,name}],...] }
const buildShopifyOptionAssignment = (products = []) => {
  const sizeOf = (product) => String(product.size || '').trim();
  const colorOf = (product) => String(product.colorName || '').trim();
  const sizeHasInput = products.some((product) => sizeOf(product) !== '');
  const colorHasInput = products.some((product) => colorOf(product) !== '');

  const defs = [];
  if (sizeHasInput) defs.push({ name: SHOPIFY_SIZE_OPTION_NAME, get: (product) => sizeOf(product) || 'Free' });
  if (colorHasInput) defs.push({ name: SHOPIFY_COLOR_OPTION_NAME, get: (product) => colorOf(product) || 'One Color' });
  if (defs.length === 0) {
    defs.push({
      name: SHOPIFY_GENERIC_OPTION_NAME,
      get: (product, index) => normalizeShopifyText(product.sku || product.productCode || `variant-${index + 1}`, `variant-${index + 1}`)
    });
  }

  const usedCombos = new Set();
  const optionValuesByIndex = products.map((product, index) => {
    let values = defs.map((def) => def.get(product, index));
    let key = values.join(' / ').toLowerCase();
    if (usedCombos.has(key)) {
      const suffix = normalizeShopifyText(product.sku || product.productCode || String(index + 1), String(index + 1));
      let n = 1;
      do {
        values = defs.map((def, i) => (i === defs.length - 1 ? `${def.get(product, index)} (${suffix}${n > 1 ? `-${n}` : ''})` : def.get(product, index)));
        key = values.join(' / ').toLowerCase();
        n += 1;
      } while (usedCombos.has(key));
    }
    usedCombos.add(key);
    return defs.map((def, i) => ({ optionName: def.name, name: values[i] }));
  });

  const productOptions = defs.map((def, i) => {
    const seen = new Set();
    const values = [];
    optionValuesByIndex.forEach((optionValues) => {
      const name = optionValues[i].name;
      const dedupeKey = name.toLowerCase();
      if (!seen.has(dedupeKey)) { seen.add(dedupeKey); values.push({ name }); }
    });
    return { name: def.name, position: i + 1, values };
  });

  return { productOptions, optionValuesByIndex };
};

// ── SEO(メタディスクリプション / URLハンドル) ──────────────────────────
// ハンドルはASCIIのみにして日本語URLの %エンコード を回避する。ラテンはそのまま、
// カナ(ひら/カタ)はローマ字化、漢字は辞書無しで読めないためスラッグから落ちる(→フォールバック)。
const KANA_ROMAJI_YOUON = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', シャ: 'sha', シュ: 'shu', ショ: 'sho',
  チャ: 'cha', チュ: 'chu', チョ: 'cho', ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
  ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo', ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
  リャ: 'rya', リュ: 'ryu', リョ: 'ryo', ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
  ジャ: 'ja', ジュ: 'ju', ジョ: 'jo', ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
  ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo', ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo',
  ティ: 'ti', ディ: 'di', ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ウォ: 'wo'
};
const KANA_ROMAJI = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'wo', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do', バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o'
};
const hiraganaToKatakana = (text) => String(text || '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const kanaToRomaji = (input) => {
  const s = hiraganaToKatakana(input);
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const two = s.substr(i, 2);
    if (KANA_ROMAJI_YOUON[two]) { out += KANA_ROMAJI_YOUON[two]; i += 1; continue; }
    const ch = s[i];
    if (ch === 'ッ') { const nx = KANA_ROMAJI_YOUON[s.substr(i + 1, 2)] || KANA_ROMAJI[s[i + 1]] || ''; if (nx) out += nx[0]; continue; }
    if (ch === 'ー') continue; // 長音は落とす
    out += KANA_ROMAJI[ch] || ch; // 非カナ(英数/漢字/記号)はそのまま(漢字は後段スラッグで除去)
  }
  return out;
};
const slugifyAscii = (text) => String(text || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90);

// URLハンドル(ASCIIのみ)。ブランド-商品名(ローマ字)。漢字のみ等でスラッグ不能ならブランド-SKUへ。
const buildShopifyHandle = (group = {}, products = []) => {
  const primary = products.find((p) => p.productGroupRole === 'primary') || products[0] || {};
  const brandSlug = slugifyAscii(kanaToRomaji(normalizeShopifyText(group.brandName || primary.brandName, '')));
  const nameSlug = slugifyAscii(kanaToRomaji(normalizeShopifyText(primary.name || primary.productGroupName || group.name, '')));
  // 名前がローマ字化できた(=nameSlugあり)ならブランド-名前。漢字のみ等でnameSlugが空なら
  // ブランド-SKU で一意性を確保(ブランド名だけだと同ブランドの漢字商品同士で衝突するため)。
  let handle;
  if (nameSlug) {
    handle = [brandSlug, nameSlug].filter(Boolean).join('-');
  } else {
    const skuSlug = slugifyAscii(String(primary.sku || primary.productCode || '').trim());
    handle = [brandSlug, skuSlug].filter(Boolean).join('-') || slugifyAscii(String(group.id || primary.id || 'akuto-product'));
  }
  return handle.slice(0, 100);
};

// メタディスクリプション。ブランドプロフィール優先(冒頭要約)、無ければカテゴリー説明。
const resolveShopifySeoDescription = (group = {}, products = [], brandProfile = '') => {
  const primary = products.find((p) => p.productGroupRole === 'primary') || products[0] || {};
  const brand = normalizeShopifyText(group.brandName || primary.brandName, '');
  const name = normalizeShopifyText(primary.name || primary.productGroupName || group.name, '');
  const head = brand ? `${brand}「${name}」` : name;
  const profile = String(brandProfile || '').replace(/\s+/g, ' ').trim();
  let tail;
  if (profile) {
    tail = profile.length > 100 ? `${profile.slice(0, 100)}…` : profile;
  } else {
    const cat = [normalizeShopifyText(group.categoryGroupName, ''), normalizeShopifyText(group.categoryName, '')].filter(Boolean).join(' ');
    tail = cat ? `${cat}のアイテム。HAUSオンラインストアでお求めいただけます。` : 'HAUSオンラインストアでお求めいただけます。';
  }
  const desc = `${head}。${tail}`;
  return desc.length > 160 ? `${desc.slice(0, 159)}…` : desc;
};

const buildShopifyVariantMetafields = (group = {}, product = {}) => ([
  {
    namespace: 'akuto',
    key: 'product_id',
    type: 'single_line_text_field',
    value: String(product.id || '')
  },
  {
    namespace: 'akuto',
    key: 'product_group_id',
    type: 'single_line_text_field',
    value: String(group.id || '')
  }
]);

const buildShopifyProductSetInput = ({ group, products, priceSyncMode = 'taxIncluded', brandProfile = '' }) => {
  const isSingleProduct = products.length === 1;
  const assignment = isSingleProduct ? null : buildShopifyOptionAssignment(products);

  const variants = products.map((product, index) => {
    const optionValues = isSingleProduct
      ? [{ optionName: SHOPIFY_DEFAULT_OPTION_NAME, name: SHOPIFY_DEFAULT_OPTION_VALUE }]
      : assignment.optionValuesByIndex[index];
    const sku = String(product.sku || product.productCode || '').trim();

    return {
      optionValues,
      ...(sku ? { sku } : {}),
      barcode: String(product.barcode || '').trim(),
      price: buildShopifySyncPriceSnapshot(product, priceSyncMode).price,
      taxable: true,
      inventoryItem: {
        tracked: true
      },
      metafields: buildShopifyVariantMetafields(group, product)
    };
  });

  const productOptions = isSingleProduct
    ? [{ name: SHOPIFY_DEFAULT_OPTION_NAME, values: [{ name: SHOPIFY_DEFAULT_OPTION_VALUE }] }]
    : assignment.productOptions;
  const tags = buildMergedShopifyTags(
    resolveShopifyCategoryTags(group),
    resolveShopifyGenderTags(products),
    'akuto-sync'
  );
  const productMetafields = buildShopifyProductMetafields(brandProfile);

  return {
    title: resolveShopifyProductTitle(group, products),
    handle: buildShopifyHandle(group, products),
    seo: { title: resolveShopifyProductTitle(group, products), description: resolveShopifySeoDescription(group, products, brandProfile) },
    ...(normalizeShopifyText(group.brandName, '') ? { vendor: normalizeShopifyText(group.brandName, '') } : {}),
    ...(normalizeShopifyText(group.categoryGroupName || group.categoryName, '') ? { productType: normalizeShopifyText(group.categoryGroupName || group.categoryName, '') } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(productMetafields.length > 0 ? { metafields: productMetafields } : {}),
    status: 'DRAFT',
    productOptions,
    variants,
    metafields: [
      {
        namespace: 'akuto',
        key: 'product_group_id',
        type: 'single_line_text_field',
        value: String(group.id || '')
      },
      {
        namespace: 'akuto',
        key: 'group_code',
        type: 'single_line_text_field',
        value: String(group.groupCode || '')
      }
    ].filter((metafield) => metafield.value)
  };
};

const productSetCreateDraftMutation = `
  mutation ProductSetCreateDraft($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        title
        handle
        status
        vendor
        productType
        tags
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            inventoryItem {
              id
              tracked
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const extractShopifyProductSetResult = (data = {}) => {
  const payload = data.productSet || {};
  const userErrors = Array.isArray(payload.userErrors) ? payload.userErrors : [];

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).filter(Boolean).join(' / ') || 'Shopify商品作成でエラーが発生しました。');
  }

  if (!payload.product?.id) {
    throw new Error('Shopify商品IDを取得できませんでした。');
  }

  return payload.product;
};

// handle を明示指定すると衝突時に Shopify がエラーを返す(自動で -1 は付かない)。
// 「Handle ... already in use」なら handle に -2,-3… を付けて再試行する。
const runProductSetWithHandleRetry = async ({ shopDomain, accessToken, query, input, synchronous = true }) => {
  const baseHandle = String(input.handle || '').trim();
  const MAX_RETRY = 10;
  for (let attempt = 0; ; attempt += 1) {
    const currentInput = (attempt === 0 || !baseHandle)
      ? input
      : { ...input, handle: `${baseHandle}-${attempt + 1}`.slice(0, 100) };
    const data = await callShopifyGraphql({ shopDomain, accessToken, query, variables: { input: currentInput, synchronous } });
    const userErrors = Array.isArray(data.productSet?.userErrors) ? data.productSet.userErrors : [];
    const handleTaken = userErrors.some((error) => (
      /handle/i.test(String(error.message || ''))
      && /already in use|taken/i.test(String(error.message || ''))
    ));
    if (handleTaken && baseHandle && attempt < MAX_RETRY) continue;
    return extractShopifyProductSetResult(data);
  }
};

const fetchStoreMemberForRequest = async ({ storeId, uid }) => {
  const userSnapshot = await db.collection('users').doc(uid).get();
  const userData = userSnapshot.exists ? userSnapshot.data() || {} : {};
  const userStoreId = String(userData.storeId || '').trim();
  const role = normalizeUserRole(userData.role);

  if (userStoreId && userStoreId !== storeId && role !== USER_ROLES.SUPER_ADMIN) {
    throw new Error('この店舗を操作する権限がありません。');
  }

  if (![USER_ROLES.SUPER_ADMIN, USER_ROLES.OWNER, USER_ROLES.MANAGER].includes(role)) {
    throw new Error('Shopify連携を実行する権限がありません。');
  }

  return { uid, role };
};

export const createShopifyDraftProduct = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }

      const authUser = await verifyRequestUser(req);
      const { storeId, productGroupId, force = false } = parseJsonBody(req);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedProductGroupId = String(productGroupId || '').trim();

      if (!normalizedStoreId || !normalizedProductGroupId) {
        return sendJson(res, 400, {
          ok: false,
          error: { message: 'storeId / productGroupId が不足しています。' }
        });
      }

      await fetchStoreMemberForRequest({
        storeId: normalizedStoreId,
        uid: authUser.uid
      });

      const storeRef = db.collection('stores').doc(normalizedStoreId);
      const settingsSnapshot = await storeRef.collection('settings').doc('shopify').get();
      const shopifySettings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
      const taxPriceSettingsSnapshot = await storeRef.collection('settings').doc('taxPrice').get();
      const taxPriceSettings = taxPriceSettingsSnapshot.exists ? taxPriceSettingsSnapshot.data() || {} : {};
      const priceSyncMode = normalizeShopifyPriceSyncMode(taxPriceSettings.shopifyPriceSyncMode);

      if (!shopifySettings.syncEnabled) {
        throw new Error('Shopify連携がOFFです。EC連携設定を確認してください。');
      }

      const groupRef = storeRef.collection('productGroups').doc(normalizedProductGroupId);
      const groupSnapshot = await groupRef.get();

      if (!groupSnapshot.exists) {
        throw new Error('商品グループが見つかりません。');
      }

      const group = {
        id: groupSnapshot.id,
        ...groupSnapshot.data()
      };

      if (!group.shopifyEnabled) {
        throw new Error('この商品グループはShopify連携がOFFです。');
      }

      if (group.shopifyProductId && !force) {
        await storeRef.collection('shopifySyncLogs').add({
          action: 'createShopifyDraftProduct',
          status: 'skipped_already_synced',
          productGroupId: normalizedProductGroupId,
          shopifyProductId: group.shopifyProductId,
          createdBy: authUser.uid,
          createdAt: FieldValue.serverTimestamp()
        });

        return sendJson(res, 200, {
          ok: true,
          status: 'already_synced',
          productGroupId: normalizedProductGroupId,
          shopifyProductId: group.shopifyProductId,
          message: 'この商品グループは既にShopify商品IDを持っています。重複作成はしていません。'
        });
      }

      const productsSnapshot = await storeRef
        .collection('products')
        .where('productGroupId', '==', normalizedProductGroupId)
        .get();

      const products = productsSnapshot.docs
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        .filter((product) => product.shopifyCreateEnabled !== false)
        .sort((a, b) => {
          const aRole = a.productGroupRole === 'primary' ? 0 : 1;
          const bRole = b.productGroupRole === 'primary' ? 0 : 1;
          if (aRole !== bRole) return aRole - bRole;
          return String(a.sku || a.productCode || '').localeCompare(String(b.sku || b.productCode || ''));
        });

      if (products.length === 0) {
        throw new Error('Shopify作成対象のSKUがありません。');
      }

      // 複数バリエーションのみSKU必須(オプション値の一意性に必要)。
      // 単品はSKU無しでもデフォルトバリアント(バリエーション非表示)で登録できる。
      if (products.length > 1) {
        const invalidSku = products.find((product) => !String(product.sku || product.productCode || '').trim());
        if (invalidSku) {
          throw new Error('SKU未入力の商品があります。');
        }
        assertUniqueShopifyInputValues(products);
      }

      const enrichedGroup = enrichShopifyGroupContext(group, products);
      const brandProfile = await fetchShopifyBrandProfile(storeRef, enrichedGroup, products);

      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(shopifySettings);
      const input = buildShopifyProductSetInput({
        group: enrichedGroup,
        products,
        priceSyncMode,
        brandProfile
      });
      const priceSnapshots = products.map((product) => ({
        productId: product.id,
        sku: String(product.sku || product.productCode || '').trim(),
        barcode: String(product.barcode || '').trim(),
        ...buildShopifySyncPriceSnapshot(product, priceSyncMode)
      }));

      const shopifyProduct = await runProductSetWithHandleRetry({
        shopDomain,
        accessToken,
        query: productSetCreateDraftMutation,
        input,
        synchronous: true
      });
      const shopifyVariants = Array.isArray(shopifyProduct.variants?.nodes)
        ? shopifyProduct.variants.nodes
        : [];

      // barcode は variant ごとに一意。SKU(品番)はサイズ/色違いで共有されるため
      // SKUキーだと衝突して在庫紐付けが壊れる。barcode を主キー、SKUを保険にする。
      const variantsByBarcode = new Map(
        shopifyVariants
          .map((variant) => [String(variant.barcode || '').trim(), variant])
          .filter(([barcode]) => barcode)
      );
      const variantsBySku = new Map(
        shopifyVariants.map((variant) => [String(variant.sku || '').trim(), variant])
      );

      const syncedAt = FieldValue.serverTimestamp();
      const savedVariants = [];

      await db.runTransaction(async (transaction) => {
        transaction.set(groupRef, {
          shopifyProductId: shopifyProduct.id,
          shopifyProductHandle: shopifyProduct.handle || '',
          shopifySyncStatus: 'created',
          shopifyLastSyncedAt: syncedAt,
          updatedAt: syncedAt
        }, { merge: true });

        for (const product of products) {
          const sku = String(product.sku || product.productCode || '').trim();
          const barcode = String(product.barcode || '').trim();
          // barcode(一意)優先で突合。単品はデフォルトバリアントに、最後の保険でSKU。
          const variant = variantsByBarcode.get(barcode)
            || ((products.length === 1 && shopifyVariants.length === 1) ? shopifyVariants[0] : undefined)
            || variantsBySku.get(sku);

          if (!variant?.id) {
            throw new Error(`Shopify variant ID を取得できませんでした: ${sku || barcode}`);
          }

          const productRef = storeRef.collection('products').doc(product.id);
          const inventoryItemId = variant.inventoryItem?.id || '';

          transaction.set(productRef, {
            shopifyProductId: shopifyProduct.id,
            shopifyVariantId: variant.id,
            shopifyInventoryItemId: inventoryItemId,
            shopifySyncStatus: 'created',
            shopifyLastSyncedAt: syncedAt,
            updatedAt: syncedAt
          }, { merge: true });

          const priceSnapshot = buildShopifySyncPriceSnapshot(product, priceSyncMode);

          savedVariants.push({
            productId: product.id,
            sku,
            shopifyVariantId: variant.id,
            shopifyInventoryItemId: inventoryItemId,
            priceSyncMode: priceSnapshot.priceSyncMode,
            price: priceSnapshot.price,
            priceTaxExcluded: priceSnapshot.priceTaxExcluded,
            priceTaxIncluded: priceSnapshot.priceTaxIncluded,
            taxRate: priceSnapshot.taxRate
          });
        }

        const logRef = storeRef.collection('shopifySyncLogs').doc();
        transaction.set(logRef, {
          action: products.length > 1 ? 'createShopifyDraftProductMultiSku' : 'createShopifyDraftProduct',
          status: 'success',
          productGroupId: normalizedProductGroupId,
          productIds: products.map((product) => product.id),
          shopifyProductId: shopifyProduct.id,
          shopifyProductHandle: shopifyProduct.handle || '',
          title: shopifyProduct.title || input.title,
          skuCount: products.length,
          variants: savedVariants,
          priceSyncMode,
          priceSnapshots,
          createdBy: authUser.uid,
          createdAt: syncedAt
        });
      });

      // 現在庫をShopifyへ初期反映(在庫連携ON時のみ。ベストエフォート)。
      const initialInventoryPush = await pushInitialInventoryToShopify({
        shopDomain,
        accessToken,
        settings: shopifySettings,
        products,
        savedVariants
      });

      return sendJson(res, 200, {
        ok: true,
        status: 'created',
        productGroupId: normalizedProductGroupId,
        shopifyProductId: shopifyProduct.id,
        shopifyProductHandle: shopifyProduct.handle || '',
        title: shopifyProduct.title || input.title,
        skuCount: products.length,
        variants: savedVariants,
        priceSyncMode,
        priceSnapshots,
        initialInventoryPush
      });
    } catch (error) {
      console.error('[createShopifyDraftProduct] failed', error);
      return sendJson(res, 400, {
        ok: false,
        error: {
          message: error.message || 'Shopify DRAFT商品の作成に失敗しました。'
        }
      });
    }
  }
);

const productSetUpdateMutation = `
  mutation ProductSetUpdate($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        title
        handle
        status
        vendor
        productType
        tags
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            inventoryItem {
              id
              tracked
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const buildShopifyProductUpdateInput = ({ group, products, existingTags = [], priceSyncMode = 'taxIncluded', brandProfile = '' }) => {
  const isSingleProduct = products.length === 1;
  const assignment = isSingleProduct ? null : buildShopifyOptionAssignment(products);
  const usedShopifyVariantIds = new Set();

  const variants = products.map((product, index) => {
    const optionValues = isSingleProduct
      ? [{ optionName: SHOPIFY_DEFAULT_OPTION_NAME, name: SHOPIFY_DEFAULT_OPTION_VALUE }]
      : assignment.optionValuesByIndex[index];
    const shopifyVariantId = String(product.shopifyVariantId || '').trim();
    const shouldUseShopifyVariantId = shopifyVariantId && !usedShopifyVariantIds.has(shopifyVariantId.toLowerCase());

    if (shopifyVariantId) {
      usedShopifyVariantIds.add(shopifyVariantId.toLowerCase());
    }

    const sku = String(product.sku || product.productCode || '').trim();

    return {
      ...(shouldUseShopifyVariantId ? { id: shopifyVariantId } : {}),
      optionValues,
      ...(sku ? { sku } : {}),
      barcode: String(product.barcode || '').trim(),
      price: buildShopifySyncPriceSnapshot(product, priceSyncMode).price
    };
  });

  const productOptions = isSingleProduct
    ? [{ name: SHOPIFY_DEFAULT_OPTION_NAME, position: 1, values: [{ name: SHOPIFY_DEFAULT_OPTION_VALUE }] }]
    : assignment.productOptions;

  const tags = buildMergedShopifyTags(
    existingTags,
    resolveShopifyCategoryTags(group),
    resolveShopifyGenderTags(products)
  );
  const productMetafields = buildShopifyProductMetafields(brandProfile);

  return {
    id: String(group.shopifyProductId || '').trim(),
    title: resolveShopifyProductTitle(group, products),
    seo: { title: resolveShopifyProductTitle(group, products), description: resolveShopifySeoDescription(group, products, brandProfile) },
    ...(normalizeShopifyText(group.brandName, '') ? { vendor: normalizeShopifyText(group.brandName, '') } : {}),
    ...(normalizeShopifyText(group.categoryGroupName || group.categoryName, '') ? { productType: normalizeShopifyText(group.categoryGroupName || group.categoryName, '') } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(productMetafields.length > 0 ? { metafields: productMetafields } : {}),
    productOptions,
    variants
  };
};

export const updateShopifyProduct = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }

      const authUser = await verifyRequestUser(req);
      const { storeId, productGroupId } = parseJsonBody(req);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedProductGroupId = String(productGroupId || '').trim();

      if (!normalizedStoreId || !normalizedProductGroupId) {
        return sendJson(res, 400, {
          ok: false,
          error: { message: 'storeId / productGroupId が不足しています。' }
        });
      }

      await fetchStoreMemberForRequest({
        storeId: normalizedStoreId,
        uid: authUser.uid
      });

      const storeRef = db.collection('stores').doc(normalizedStoreId);
      const settingsSnapshot = await storeRef.collection('settings').doc('shopify').get();
      const shopifySettings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
      const taxPriceSettingsSnapshot = await storeRef.collection('settings').doc('taxPrice').get();
      const taxPriceSettings = taxPriceSettingsSnapshot.exists ? taxPriceSettingsSnapshot.data() || {} : {};
      const priceSyncMode = normalizeShopifyPriceSyncMode(taxPriceSettings.shopifyPriceSyncMode);

      if (!shopifySettings.syncEnabled) {
        throw new Error('Shopify連携がOFFです。EC連携設定を確認してください。');
      }

      const groupRef = storeRef.collection('productGroups').doc(normalizedProductGroupId);
      const productsRef = storeRef.collection('products');
      const groupSnapshot = await groupRef.get();

      if (!groupSnapshot.exists) {
        throw new Error('商品グループが見つかりません。');
      }

      const group = {
        id: groupSnapshot.id,
        ...groupSnapshot.data()
      };

      if (!group.shopifyProductId) {
        throw new Error('Shopify商品IDがありません。先にShopify下書きを作成してください。');
      }

      const productsSnapshot = await storeRef
        .collection('products')
        .where('productGroupId', '==', normalizedProductGroupId)
        .get();

      const products = productsSnapshot.docs
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        .filter((product) => String(product.shopifyVariantId || '').trim())
        .sort((a, b) => {
          const aRole = a.productGroupRole === 'primary' ? 0 : 1;
          const bRole = b.productGroupRole === 'primary' ? 0 : 1;
          if (aRole !== bRole) return aRole - bRole;
          return String(a.sku || a.productCode || '').localeCompare(String(b.sku || b.productCode || ''));
        });

      if (products.length === 0) {
        throw new Error('Shopify更新対象のSKUがありません。Shopify variant ID を確認してください。');
      }

      // 複数バリエーションのみSKU必須(単品はSKU無しのデフォルトバリアント運用を許可)。
      const optionName = products.length === 1 ? SHOPIFY_DEFAULT_OPTION_NAME : resolveShopifyOptionName(products);
      if (products.length > 1) {
        const invalidSku = products.find((product) => !String(product.sku || product.productCode || '').trim());
        if (invalidSku) {
          throw new Error('SKU未入力の商品があります。');
        }
        assertUniqueShopifyInputValues(products, optionName);
      }

      const enrichedGroup = enrichShopifyGroupContext(group, products);
      const brandProfile = await fetchShopifyBrandProfile(storeRef, enrichedGroup, products);

      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(shopifySettings);
      const existingTags = await getShopifyProductTags({
        shopDomain,
        accessToken,
        productId: group.shopifyProductId
      });
      const input = buildShopifyProductUpdateInput({
        group: enrichedGroup,
        products,
        existingTags,
        priceSyncMode,
        brandProfile
      });
      const priceSnapshots = products.map((product) => ({
        productId: product.id,
        sku: String(product.sku || product.productCode || '').trim(),
        barcode: String(product.barcode || '').trim(),
        ...buildShopifySyncPriceSnapshot(product, priceSyncMode)
      }));

      const shopifyProduct = await runProductSetWithHandleRetry({
        shopDomain,
        accessToken,
        query: productSetUpdateMutation,
        input,
        synchronous: true
      });
      const shopifyVariants = Array.isArray(shopifyProduct.variants?.nodes)
        ? shopifyProduct.variants.nodes
        : [];

      const variantsById = new Map(
        shopifyVariants.map((variant) => [String(variant.id || '').trim(), variant])
      );
      const variantsByBarcode = new Map(
        shopifyVariants
          .map((variant) => [String(variant.barcode || '').trim(), variant])
          .filter(([barcode]) => barcode)
      );
      const variantsByOptionValue = new Map(
        shopifyVariants
          .map((variant) => [
            String(variant.selectedOptions?.[0]?.value || variant.title || '').trim().toLowerCase(),
            variant
          ])
          .filter(([optionValue]) => optionValue)
      );

      const syncedAt = FieldValue.serverTimestamp();
      const savedVariants = [];
      const batch = db.batch();

      batch.set(groupRef, {
        shopifyProductId: shopifyProduct.id,
        shopifyProductHandle: shopifyProduct.handle || group.shopifyProductHandle || '',
        shopifySyncStatus: 'updated',
        shopifyLastSyncedAt: syncedAt,
        updatedAt: syncedAt
      }, { merge: true });

      for (const product of products) {
        const currentVariantId = String(product.shopifyVariantId || '').trim();
        const barcode = String(product.barcode || '').trim();
        const optionValue = resolveShopifyOptionValue(product, optionName);
        const normalizedOptionValue = String(optionValue || '').trim().toLowerCase();

        // barcode(variant毎に一意)優先。旧SKU共有バグで複数商品が同一 shopifyVariantId に
        // 誤紐付けされた場合、variantId優先だと再同期でも直らないため barcode を最優先にする。
        const variant = (
          variantsByBarcode.get(barcode) ||
          variantsById.get(currentVariantId) ||
          variantsByOptionValue.get(normalizedOptionValue) ||
          // 単品(デフォルトバリアント)はoptionValueで一致しないため、唯一のvariantに対応付ける。
          ((products.length === 1 && shopifyVariants.length === 1) ? shopifyVariants[0] : undefined)
        );

        if (!variant) {
          continue;
        }

        const resolvedVariantId = String(variant.id || currentVariantId).trim();
        const inventoryItemId = variant?.inventoryItem?.id || product.shopifyInventoryItemId || '';
        const matchedBy = variantsByBarcode.get(barcode)
          ? 'barcode'
          : (variantsById.get(currentVariantId) ? 'variantId' : 'optionValue');

        batch.set(productsRef.doc(product.id), {
          shopifyProductId: shopifyProduct.id,
          shopifyVariantId: resolvedVariantId,
          shopifyInventoryItemId: inventoryItemId,
          shopifySyncStatus: 'updated',
          shopifyLastSyncedAt: syncedAt,
          updatedAt: syncedAt
        }, { merge: true });

        const priceSnapshot = buildShopifySyncPriceSnapshot(product, priceSyncMode);
        savedVariants.push({
          productId: product.id,
          sku: String(product.sku || product.productCode || '').trim(),
          barcode,
          shopifyVariantId: resolvedVariantId,
          shopifyInventoryItemId: inventoryItemId,
          matchedBy,
          ...priceSnapshot
        });
      }

      const logRef = storeRef.collection('shopifySyncLogs').doc();
      batch.set(logRef, {
        action: products.length > 1 ? 'updateShopifyProductMultiSku' : 'updateShopifyProduct',
        productGroupId: group.id,
        productIds: products.map((product) => product.id),
        shopifyProductId: shopifyProduct.id,
        shopifyProductHandle: shopifyProduct.handle || group.shopifyProductHandle || '',
        title: shopifyProduct.title || input.title,
        variantCount: savedVariants.length,
        variants: savedVariants,
        priceSyncMode,
        priceSnapshots,
        createdAt: syncedAt,
        updatedAt: syncedAt
      });

      await batch.commit();

      // 現在庫をShopifyへ初期反映(在庫連携ON時のみ。ベストエフォート)。
      // 「同期したのに在庫が0のまま」を防ぐ。更新同期でもPOS現在庫を正としてsetする。
      const initialInventoryPush = await pushInitialInventoryToShopify({
        shopDomain,
        accessToken,
        settings: shopifySettings,
        products,
        savedVariants
      });

      return sendJson(res, 200, {
        ok: true,
        status: 'updated',
        productGroupId: normalizedProductGroupId,
        shopifyProductId: shopifyProduct.id,
        shopifyProductHandle: shopifyProduct.handle || group.shopifyProductHandle || '',
        title: shopifyProduct.title || input.title,
        skuCount: products.length,
        variants: savedVariants,
        priceSyncMode,
        priceSnapshots,
        initialInventoryPush
      });
    } catch (error) {
      console.error('[updateShopifyProduct] failed', error);
      return sendJson(res, 400, {
        ok: false,
        error: {
          message: error.message || 'Shopify商品の更新に失敗しました。'
        }
      });
    }
  }
);



// Shopify掲載商品をFirestore商品へ紐付け同期する（手動「Shopify同期」ボタン用）。
// 指定ステータス(ACTIVE/DRAFT/ARCHIVED)のShopify商品を取得し、barcode突合(+既存variantId)で
// shopifyProductId / shopifyVariantId / shopifyInventoryItemId / shopifyStatus を設定する。
// ブランド/仕入先など他フィールドには触れない。
export const syncShopifyProductLinks = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 540, memory: '1GiB' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }

      const authUser = await verifyRequestUser(req);
      const { storeId, statuses } = parseJsonBody(req);
      const normalizedStoreId = String(storeId || '').trim();
      if (!normalizedStoreId) {
        return sendJson(res, 400, { ok: false, error: { message: 'storeId が不足しています。' } });
      }

      await fetchStoreMemberForRequest({ storeId: normalizedStoreId, uid: authUser.uid });

      const ALLOWED = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
      const requested = Array.isArray(statuses)
        ? statuses.map((s) => String(s || '').trim().toUpperCase()).filter((s) => ALLOWED.includes(s))
        : [];
      const statusScope = requested.length ? [...new Set(requested)] : ['ACTIVE'];

      const storeRef = db.collection('stores').doc(normalizedStoreId);
      const settingsSnapshot = await storeRef.collection('settings').doc('shopify').get();
      const shopifySettings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(shopifySettings);

      const statusQuery = statusScope.length === ALLOWED.length
        ? null
        : statusScope.map((s) => `status:${s.toLowerCase()}`).join(' OR ');
      const productsQuery = 'query($cursor:String,$q:String){ products(first:40, after:$cursor, query:$q){ pageInfo{ hasNextPage endCursor } nodes{ id status variants(first:100){ nodes{ id barcode inventoryItem{ id } } } } } }';

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const byBarcode = new Map();
      const byVariant = new Map();
      let cursor = null;

      for (;;) {
        let data = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            data = await callShopifyGraphql({ shopDomain, accessToken, query: productsQuery, variables: { cursor, q: statusQuery } });
            break;
          } catch (gqlError) {
            if (String(gqlError.message || '').toLowerCase().includes('throttl')) {
              await sleep(2000);
              continue;
            }
            throw gqlError;
          }
        }
        if (!data) throw new Error('Shopify商品の取得に失敗しました（スロットリング）。');

        const connection = data.products;
        for (const product of connection.nodes) {
          for (const variant of product.variants.nodes) {
            const barcode = String(variant.barcode || '').trim();
            const inventoryItemId = variant.inventoryItem?.id || '';
            byVariant.set(variant.id, { pid: product.id, iid: inventoryItemId, status: product.status });
            if (barcode && !byBarcode.has(barcode)) {
              byBarcode.set(barcode, { pid: product.id, vid: variant.id, iid: inventoryItemId, status: product.status });
            }
          }
        }
        if (!connection.pageInfo.hasNextPage) break;
        cursor = connection.pageInfo.endCursor;
      }

      const productsSnap = await storeRef.collection('products').select('barcode', 'shopifyVariantId').get();
      let batch = db.batch();
      let ops = 0;
      let linkedByBarcode = 0;
      let linkedByVariant = 0;
      const commitIfNeeded = async (force = false) => {
        if (ops === 0) return;
        if (!force && ops < 400) return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
      };

      for (const docSnap of productsSnap.docs) {
        const data = docSnap.data() || {};
        const barcode = String(data.barcode || '').trim();
        const variantId = String(data.shopifyVariantId || '').trim();
        let link = null;
        let via = '';
        if (barcode && byBarcode.has(barcode)) {
          link = byBarcode.get(barcode);
          via = 'barcode';
        } else if (variantId && byVariant.has(variantId)) {
          const matched = byVariant.get(variantId);
          link = { pid: matched.pid, vid: variantId, iid: matched.iid, status: matched.status };
          via = 'variant';
        }
        if (!link) continue;

        batch.set(docSnap.ref, {
          shopifyProductId: link.pid,
          shopifyVariantId: link.vid,
          shopifyInventoryItemId: link.iid,
          shopifyStatus: link.status,
          shopifyLinkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        ops += 1;
        if (via === 'barcode') linkedByBarcode += 1; else linkedByVariant += 1;
        await commitIfNeeded();
      }
      await commitIfNeeded(true);

      return sendJson(res, 200, {
        ok: true,
        statusScope,
        shopifyBarcodeCount: byBarcode.size,
        shopifyVariantCount: byVariant.size,
        scannedProducts: productsSnap.size,
        linked: linkedByBarcode + linkedByVariant,
        linkedByBarcode,
        linkedByVariant
      });
    } catch (error) {
      console.error('[syncShopifyProductLinks] failed', error);
      return sendJson(res, 400, { ok: false, error: { message: error.message || 'Shopify同期に失敗しました。' } });
    }
  }
);


// POS側の在庫変更(会計/手動調整/棚卸しfinalize)をShopifyの在庫(onHand)へ反映する。
// inventorySyncEnabled(=prodのみON想定)かつ shopifyInventoryItemId 紐付け済みの商品のみ。
// Firestoreの現在庫を「絶対値」でShopifyに set する(差分でなくsetで drift を防ぐ)。
export const pushInventoryToShopify = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }
      const authUser = await verifyRequestUser(req);
      const { storeId, productIds } = parseJsonBody(req);
      const normalizedStoreId = String(storeId || '').trim();
      const ids = Array.isArray(productIds)
        ? [...new Set(productIds.map((x) => String(x || '').trim()).filter(Boolean))]
        : [];
      if (!normalizedStoreId) {
        return sendJson(res, 400, { ok: false, error: { message: 'storeId が不足しています。' } });
      }
      if (ids.length === 0) {
        return sendJson(res, 200, { ok: true, pushed: 0, skipped: 'noProductIds' });
      }

      await fetchStoreMemberForRequest({ storeId: normalizedStoreId, uid: authUser.uid });

      const storeRef = db.collection('stores').doc(normalizedStoreId);
      const settingsSnap = await storeRef.collection('settings').doc('shopify').get();
      const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
      if (!settings.inventorySyncEnabled) {
        return sendJson(res, 200, { ok: true, pushed: 0, skipped: 'inventorySyncDisabled' });
      }
      const locationId = String(settings.locationId || '').trim();
      if (!locationId) {
        return sendJson(res, 200, { ok: true, pushed: 0, skipped: 'noLocationId' });
      }
      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(settings);

      const setQuantities = [];
      for (const id of ids) {
        const snap = await storeRef.collection('products').doc(id).get();
        if (!snap.exists) continue;
        const product = snap.data() || {};
        // 商品単位の在庫同期OFF(商品マスターのShopifyボタンで切替)はスキップ。
        if (product.shopifyInventorySyncDisabled === true) continue;
        const inventoryItemId = String(product.shopifyInventoryItemId || '').trim();
        if (!inventoryItemId) continue;
        const quantity = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
        setQuantities.push({ inventoryItemId, locationId, quantity });
      }
      if (setQuantities.length === 0) {
        return sendJson(res, 200, { ok: true, pushed: 0, skipped: 'noLinkedItems' });
      }

      const mutation = 'mutation($input: InventorySetOnHandQuantitiesInput!){ inventorySetOnHandQuantities(input:$input){ userErrors{ field message } } }';
      let pushed = 0;
      const userErrors = [];
      for (let i = 0; i < setQuantities.length; i += 250) {
        const chunk = setQuantities.slice(i, i + 250);
        const data = await callShopifyGraphql({
          shopDomain,
          accessToken,
          query: mutation,
          variables: { input: { reason: 'correction', setQuantities: chunk } }
        });
        const errs = data.inventorySetOnHandQuantities?.userErrors || [];
        if (errs.length) userErrors.push(...errs);
        pushed += chunk.length;
      }

      return sendJson(res, 200, { ok: true, pushed, userErrors: userErrors.slice(0, 20) });
    } catch (error) {
      console.error('[pushInventoryToShopify] failed', error);
      return sendJson(res, 400, { ok: false, error: { message: error.message || 'Shopify在庫反映に失敗しました。' } });
    }
  }
);


// Shopify inventory_levels/update Webhook 受信。Shopifyの在庫変動(売上/キャンセル/返品/手動編集)をPOSへミラーする。
// URLに ?storeId=... を含め、署名は当該店舗の clientSecret で HMAC-SHA256 検証する。
// available ではなく on_hand を都度問い合わせて採用(引当ノイズ回避)。値一致ならスキップ(自前pushの跳ね返り=ループ防止)。
// 純減(売れた)時のみ進行中棚卸しの店頭数を減算し1h以内なら数え直し。冪等は X-Shopify-Webhook-Id。
// ロケーションは settings.locationIds[](無ければ locationId) を対象とし合計on_handをミラー(複数ロケーション拡張可)。
export const shopifyInventoryWebhook = onRequest(
  { region: REGION, cors: false, invoker: 'public' },
  async (request, response) => {
    // 処理が途中失敗したら冪等記録を消して 500 を返し、Shopify に再送させる(取りこぼし防止)。
    let recordedWebhookRef = null;
    try {
      if (request.method !== 'POST') {
        return response.status(405).send('Method Not Allowed');
      }
      const storeId = String(request.query.storeId || '').trim();
      if (!storeId) {
        return response.status(400).send('storeId required');
      }

      const storeRef = db.collection('stores').doc(storeId);
      const settingsSnap = await storeRef.collection('settings').doc('shopify').get();
      const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
      const secret = String(settings.clientSecret || '').trim();

      const hmacHeader = String(request.get('X-Shopify-Hmac-Sha256') || '');
      if (!secret || !hmacHeader) {
        return response.status(401).send('unauthorized');
      }
      const digest = createHmac('sha256', secret).update(request.rawBody).digest('base64');
      const a = Buffer.from(digest);
      const b = Buffer.from(hmacHeader);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return response.status(401).send('invalid signature');
      }

      if (!settings.inventorySyncEnabled) {
        return response.status(200).send('inventory sync disabled');
      }

      // 冪等性: Webhook ID で二重処理防止
      const webhookId = String(request.get('X-Shopify-Webhook-Id') || '').replace(/[^A-Za-z0-9_-]/g, '_');
      if (webhookId) {
        const webhookRef = storeRef.collection('shopifyWebhookEvents').doc(webhookId);
        try {
          await webhookRef.create({ topic: 'inventory_levels/update', receivedAt: FieldValue.serverTimestamp() });
          recordedWebhookRef = webhookRef; // 失敗時にcatchで消して再送させるため保持
        } catch (e) {
          return response.status(200).send('already processed');
        }
      }

      const payload = JSON.parse(request.rawBody.toString('utf8'));
      const inventoryItemNumericId = String(payload.inventory_item_id || '').trim();
      const eventLocationId = String(payload.location_id || '').trim();
      if (!inventoryItemNumericId) {
        return response.status(200).send('no inventory item');
      }

      // 対象ロケーション(複数対応)。設定があればそのロケーションのイベントのみ処理。
      const configuredLocations = (Array.isArray(settings.locationIds) && settings.locationIds.length
        ? settings.locationIds
        : (settings.locationId ? [settings.locationId] : []))
        .map((l) => String(l || '').trim().split('/').pop())
        .filter(Boolean);
      if (configuredLocations.length && eventLocationId && !configuredLocations.includes(eventLocationId)) {
        return response.status(200).send('location not tracked');
      }

      const itemGid = `gid://shopify/InventoryItem/${inventoryItemNumericId}`;
      const matched = await storeRef.collection('products').where('shopifyInventoryItemId', '==', itemGid).limit(1).get();
      if (matched.empty) {
        return response.status(200).send('product not linked');
      }
      const productDoc = matched.docs[0];
      // 商品単位の在庫同期OFFは inbound(Shopify→POS) も取り込まない。
      if (productDoc.data()?.shopifyInventorySyncDisabled === true) {
        return response.status(200).send('product inventory sync disabled');
      }

      // on_hand を問い合わせ(対象ロケーション合計)。設定が無ければイベントのロケーションを使用。
      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(settings);
      const locationsToSum = configuredLocations.length ? configuredLocations : [eventLocationId];
      let onHandTotal = 0;
      for (const locNum of locationsToSum) {
        if (!locNum) continue;
        const query = `{ inventoryItem(id:"${itemGid}"){ inventoryLevel(locationId:"gid://shopify/Location/${locNum}"){ quantities(names:["on_hand"]){ name quantity } } } }`;
        const data = await callShopifyGraphql({ shopDomain, accessToken, query, variables: {} });
        const quantities = data.inventoryItem?.inventoryLevel?.quantities || [];
        const onHand = quantities.find((q) => q.name === 'on_hand');
        onHandTotal += onHand ? Number(onHand.quantity || 0) : 0;
      }
      onHandTotal = Math.max(onHandTotal, 0);

      const before = Math.max(Number(productDoc.data().inventoryQuantity ?? productDoc.data().quantity ?? 0), 0);
      const delta = before - onHandTotal; // >0 = 純減(売れた) / <0 = 純増(返品・補充)
      if (delta === 0) {
        return response.status(200).send('no change'); // 値一致=自前pushの跳ね返り等。ループ防止
      }

      const batch = db.batch();
      batch.set(productDoc.ref, {
        inventoryQuantity: onHandTotal,
        quantity: onHandTotal,
        inventorySource: 'shopify',
        inventoryUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      // 純減時のみ棚卸し連動
      if (delta > 0) {
        const stocktakeSnap = await storeRef.collection('stocktakes').where('status', '==', 'in_progress').limit(1).get();
        if (!stocktakeSnap.empty) {
          const itemRef = storeRef.collection('stocktakes').doc(stocktakeSnap.docs[0].id).collection('items').doc(productDoc.id);
          const itemSnap = await itemRef.get();
          if (itemSnap.exists && itemSnap.data().storefrontConfirmedAt) {
            const confirmedMs = typeof itemSnap.data().storefrontConfirmedAt?.toMillis === 'function' ? itemSnap.data().storefrontConfirmedAt.toMillis() : 0;
            const within = confirmedMs > 0 && (Date.now() - confirmedMs) <= 60 * 60 * 1000;
            const patch = { storefrontShelfQuantity: FieldValue.increment(-delta), updatedAt: FieldValue.serverTimestamp() };
            if (within) { patch.needsRecount = true; patch.status = 'needs_recount'; }
            batch.set(itemRef, patch, { merge: true });
          }
        }
      }

      batch.set(storeRef.collection('inventorySyncLog').doc(), {
        direction: 'shopify_to_pos',
        productId: productDoc.id,
        inventoryItemId: itemGid,
        before,
        after: onHandTotal,
        delta,
        at: FieldValue.serverTimestamp()
      });
      await batch.commit();

      return response.status(200).send('ok');
    } catch (error) {
      console.error('[shopifyInventoryWebhook] failed', error);
      // 冪等記録を消してから 500 を返す → Shopify が再送し、次回で再処理される(取りこぼし防止)。
      if (recordedWebhookRef) {
        try { await recordedWebhookRef.delete(); } catch (cleanupError) { console.error('[shopifyInventoryWebhook] cleanup failed', cleanupError?.message); }
      }
      return response.status(500).send('error, will retry');
    }
  }
);


// ── 在庫リコンサイル（差分レポート） ───────────────────────────────────
// 全紐付け商品(shopifyInventoryItemId)について Firestore現在庫 と Shopify on_hand を突合し、
// 不一致レポートを作成する。**自動修復はしない**(人が見て判断)。初期&定期の安全網。
// Shopify on_hand はバリアントをページングで一括取得(スロットル時はバックオフ)。
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callShopifyGraphqlWithRetry = async (args, maxRetries = 6) => {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callShopifyGraphql(args);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      if (!/throttle/i.test(message)) throw error; // スロットル以外は即時失敗
      await sleepMs(Math.min(8000, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
};

// 全バリアントを走査し inventoryItem gid → on_hand合計(対象ロケーション) のMapを作る。
const buildShopifyOnHandMap = async ({ shopDomain, accessToken, locationNumericSet }) => {
  const onHandByItemGid = new Map();
  const query = `query($cursor: String) {
    productVariants(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        inventoryItem {
          id
          inventoryLevels(first: 10) {
            nodes {
              location { id }
              quantities(names: ["on_hand"]) { name quantity }
            }
          }
        }
      }
    }
  }`;

  let cursor = null;
  let pages = 0;
  do {
    const data = await callShopifyGraphqlWithRetry({ shopDomain, accessToken, query, variables: { cursor } });
    const connection = data.productVariants || {};
    const nodes = connection.nodes || [];
    for (const node of nodes) {
      const itemGid = String(node?.inventoryItem?.id || '').trim();
      if (!itemGid) continue;
      const levels = node?.inventoryItem?.inventoryLevels?.nodes || [];
      let total = 0;
      for (const level of levels) {
        const locNum = String(level?.location?.id || '').trim().split('/').pop();
        if (locationNumericSet.size && (!locNum || !locationNumericSet.has(locNum))) continue;
        const onHand = (level?.quantities || []).find((q) => q.name === 'on_hand');
        total += onHand ? Number(onHand.quantity || 0) : 0;
      }
      onHandByItemGid.set(itemGid, total);
    }
    cursor = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    pages += 1;
    if (cursor) await sleepMs(500); // ペース調整(スロットル回避)
  } while (cursor && pages < 1000);

  return onHandByItemGid;
};

const runShopifyInventoryReconcile = async ({ storeId, source = 'manual', triggeredBy = '', autoApply = false }) => {
  const storeRef = db.collection('stores').doc(storeId);
  const settingsSnap = await storeRef.collection('settings').doc('shopify').get();
  const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};

  const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(settings);

  const locationNumericSet = new Set(
    (Array.isArray(settings.locationIds) && settings.locationIds.length
      ? settings.locationIds
      : (settings.locationId ? [settings.locationId] : []))
      .map((l) => String(l || '').trim().split('/').pop())
      .filter(Boolean)
  );

  const onHandByItemGid = await buildShopifyOnHandMap({ shopDomain, accessToken, locationNumericSet });

  // 紐付け済み(shopifyInventoryItemId が非空文字列)の商品のみ突合
  const linkedSnap = await storeRef.collection('products').where('shopifyInventoryItemId', '>', '').get();

  const MISMATCH_CAP = 1000;
  const mismatches = [];
  const corrections = []; // autoApply時に POS=Shopify on_hand へ補正する対象(uncapped)
  let totalLinked = 0;
  let matched = 0;
  let mismatchedCount = 0;
  let missingInShopify = 0;

  linkedSnap.forEach((docSnap) => {
    const product = docSnap.data() || {};
    const itemGid = String(product.shopifyInventoryItemId || '').trim();
    if (!itemGid) return;
    // 商品単位の在庫同期OFFは意図的な非同期なので差分レポートから除外(ノイズ防止)。
    if (product.shopifyInventorySyncDisabled === true) return;
    totalLinked += 1;

    const pos = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
    const hasShopify = onHandByItemGid.has(itemGid);
    const shopify = hasShopify ? Number(onHandByItemGid.get(itemGid) || 0) : null;

    if (!hasShopify) {
      missingInShopify += 1;
    } else if (pos === shopify) {
      matched += 1;
      return;
    } else {
      mismatchedCount += 1;
      // Shopify on_hand を正として POS を合わせる(webフック取りこぼしの追いつき)。missingInShopify(幽霊リンク)は対象外。
      corrections.push({ productId: docSnap.id, shopify: Math.max(shopify, 0) });
    }

    if (mismatches.length < MISMATCH_CAP) {
      mismatches.push({
        productId: docSnap.id,
        name: product.name || '',
        sku: product.sku || product.productCode || '',
        barcode: product.barcode || '',
        inventoryItemId: itemGid,
        pos,
        shopify: hasShopify ? shopify : null,
        diff: hasShopify ? pos - shopify : null,
        reason: hasShopify ? 'mismatch' : 'missingInShopify'
      });
    }
  });

  // autoApply時: Shopify on_hand を正として POS を一括補正(inbound同期の追いつき)。
  let appliedCount = 0;
  if (autoApply && corrections.length) {
    for (let i = 0; i < corrections.length; i += 250) {
      const batch = db.batch();
      for (const c of corrections.slice(i, i + 250)) {
        batch.set(storeRef.collection('products').doc(c.productId), {
          inventoryQuantity: c.shopify, quantity: c.shopify,
          inventorySource: 'shopify', inventoryUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        batch.set(storeRef.collection('inventory').doc(c.productId), {
          productId: c.productId, quantity: c.shopify, updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await batch.commit();
      appliedCount += Math.min(250, corrections.length - i);
    }
  }

  const summary = {
    at: FieldValue.serverTimestamp(),
    source,
    triggeredBy: triggeredBy || null,
    totalLinked,
    matched,
    mismatched: mismatchedCount,
    missingInShopify,
    reportedRows: mismatches.length,
    truncated: (mismatchedCount + missingInShopify) > mismatches.length,
    shopifyVariantsScanned: onHandByItemGid.size,
    autoResolved: appliedCount > 0,
    appliedCount,
    mismatches
  };

  const reportRef = await storeRef.collection('inventoryReconcileReports').add(summary);

  return {
    reportId: reportRef.id,
    totalLinked,
    matched,
    mismatched: mismatchedCount,
    missingInShopify,
    appliedCount,
    reportedRows: mismatches.length,
    truncated: summary.truncated,
    shopifyVariantsScanned: onHandByItemGid.size,
    // 不一致明細(上限MISMATCH_CAP件)。UIでリスト表示＋その場修正に使う。
    mismatches
  };
};

// 手動トリガー(EC連携「差分を確認」ボタン)。読み取りのみで Shopify には書き込まない。
export const reconcileShopifyInventory = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 540, memory: '1GiB' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }
      const authUser = await verifyRequestUser(req);
      const { storeId } = parseJsonBody(req);
      const normalizedStoreId = String(storeId || '').trim();
      if (!normalizedStoreId) {
        return sendJson(res, 400, { ok: false, error: { message: 'storeId が不足しています。' } });
      }
      await fetchStoreMemberForRequest({ storeId: normalizedStoreId, uid: authUser.uid });

      const result = await runShopifyInventoryReconcile({
        storeId: normalizedStoreId,
        source: 'manual',
        triggeredBy: authUser.uid
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      console.error('[reconcileShopifyInventory] failed', error);
      return sendJson(res, 400, { ok: false, error: { message: error.message || '在庫の差分確認に失敗しました。' } });
    }
  }
);

// 日次の自動リコンサイル。inventorySyncEnabled=true の店舗(=prodのみ想定)だけ実行する。
export const scheduledShopifyInventoryReconcile = onSchedule(
  { region: REGION, schedule: 'every day 03:00', timeZone: 'Asia/Tokyo', timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    try {
      // collectionGroup('settings') クエリは collection-group インデックスが必要で未整備のため失敗していた。
      // 店舗数は少ないので stores を走査し、各店の settings/shopify を直接読んで判定する(インデックス不要)。
      const storesSnap = await db.collection('stores').get();
      for (const storeDoc of storesSnap.docs) {
        const storeId = storeDoc.id;
        try {
          const shopifySettingsSnap = await storeDoc.ref.collection('settings').doc('shopify').get();
          const shopifySettings = shopifySettingsSnap.data() || {};
          if (shopifySettings.inventorySyncEnabled !== true) continue;
          // inventoryReconcileAutoApply=true の店舗は差分を自動補正(POS=Shopify on_hand)。既定OFFはレポートのみ。
          const result = await runShopifyInventoryReconcile({ storeId, source: 'scheduled', autoApply: shopifySettings.inventoryReconcileAutoApply === true });
          console.log('[scheduledShopifyInventoryReconcile] done', { storeId, ...result });
        } catch (error) {
          console.error('[scheduledShopifyInventoryReconcile] store failed', { storeId, message: error?.message });
        }
      }
    } catch (error) {
      console.error('[scheduledShopifyInventoryReconcile] failed', error);
    }
  }
);


// ── Shopify EC(オンラインストア)売上の取り込み ─────────────────────────────
// Shopify注文を updated_at 昇順でページング取得し stores/{id}/ecOrders/{orderId} に upsert する。
// 返金/編集/キャンセルは updated_at が動くので再取得され、current* の純額で上書きされる。
// **このコレクションは分析だけが読む**。transactions には入れないので、レジ締め/POS履歴/訂正には一切混ざらない。
const SHOPIFY_ORDERS_QUERY = `query($cursor: String, $q: String) {
  orders(first: 50, after: $cursor, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      processedAt
      createdAt
      updatedAt
      displayFinancialStatus
      cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalTaxSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 100) {
        nodes {
          quantity
          sku
          title
          name
          originalUnitPriceSet { shopMoney { amount } }
          discountedTotalSet { shopMoney { amount } }
          variant { id barcode }
        }
      }
    }
  }
}`;

// 商品マスターを1回だけ読み、EC明細を突合するための索引(variantId/barcode/sku → カテゴリ等)を作る。
const buildEcProductMatchIndex = async (storeRef) => {
  const snap = await storeRef.collection('products')
    .select('shopifyVariantId', 'barcode', 'sku', 'categoryId', 'categoryName', 'categoryGroupName', 'salesAreaId', 'gender', 'name')
    .get();
  const byVariantId = new Map();
  const byBarcode = new Map();
  const bySku = new Map();
  snap.forEach((docSnap) => {
    const p = docSnap.data() || {};
    const entry = {
      productId: docSnap.id,
      categoryId: String(p.categoryId || ''),
      categoryName: String(p.categoryName || ''),
      categoryGroupName: String(p.categoryGroupName || ''),
      salesAreaId: String(p.salesAreaId || ''),
      gender: String(p.gender || ''),
      name: String(p.name || '')
    };
    const vid = String(p.shopifyVariantId || '').trim().toLowerCase();
    const bc = String(p.barcode || '').trim().toLowerCase();
    const sku = String(p.sku || '').trim().toLowerCase();
    if (vid && !byVariantId.has(vid)) byVariantId.set(vid, entry);
    if (bc && !byBarcode.has(bc)) byBarcode.set(bc, entry);
    if (sku && !bySku.has(sku)) bySku.set(sku, entry);
  });
  return { byVariantId, byBarcode, bySku };
};

// variant.id → variant.barcode → sku の順でPOS商品にマッチ(無ければnull)。
const matchEcLineItem = (lineItem, index) => {
  const variantGid = String(lineItem?.variant?.id || '').trim().toLowerCase();
  const barcode = String(lineItem?.variant?.barcode || '').trim().toLowerCase();
  const sku = String(lineItem?.sku || '').trim().toLowerCase();
  return (variantGid && index.byVariantId.get(variantGid))
    || (barcode && index.byBarcode.get(barcode))
    || (sku && index.bySku.get(sku))
    || null;
};

const runShopifyEcOrdersSync = async ({ storeId, source = 'scheduled', triggeredBy = '', sinceOverride = null }) => {
  const storeRef = db.collection('stores').doc(storeId);
  const settingsSnap = await storeRef.collection('settings').doc('shopify').get();
  const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
  if (settings.ecSalesSyncEnabled !== true) {
    return { skipped: true, reason: 'ecSalesSyncEnabled=false' };
  }

  const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(settings);

  // cursor 決定: 明示override > 保存cursor > 既定72h前。updated_at フィルタで増分取得。
  const cursorRef = storeRef.collection('settings').doc('shopifyEcSync');
  const cursorSnap = await cursorRef.get();
  const savedCursor = cursorSnap.exists ? (cursorSnap.data() || {}).cursor : null;
  const defaultSince = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const since = String(sinceOverride || savedCursor || defaultSince);
  const queryFilter = `updated_at:>='${since}'`;

  const productIndex = await buildEcProductMatchIndex(storeRef);
  const EXCLUDED_STATUSES = new Set(['VOIDED', 'REFUNDED', 'EXPIRED']);

  let cursor = null;
  let pages = 0;
  let scanned = 0;
  let upserted = 0;
  let matchedItems = 0;
  let unmatchedItems = 0;
  let maxUpdatedAt = since;

  do {
    const data = await callShopifyGraphqlWithRetry({ shopDomain, accessToken, query: SHOPIFY_ORDERS_QUERY, variables: { cursor, q: queryFilter } });
    const connection = data.orders || {};
    const nodes = connection.nodes || [];

    for (let i = 0; i < nodes.length; i += 250) {
      const batch = db.batch();
      for (const order of nodes.slice(i, i + 250)) {
        const orderGid = String(order?.id || '');
        const numericId = orderGid.split('/').pop();
        if (!numericId) continue;
        scanned += 1;

        const updatedAtIso = order.updatedAt || order.processedAt || order.createdAt || null;
        if (updatedAtIso && updatedAtIso > maxUpdatedAt) maxUpdatedAt = updatedAtIso;

        const financialStatus = String(order.displayFinancialStatus || '');
        const cancelled = Boolean(order.cancelledAt);
        const totalAmount = Number(order.currentTotalPriceSet?.shopMoney?.amount || 0);
        const taxAmount = Number(order.currentTotalTaxSet?.shopMoney?.amount || 0);
        const totalRefunded = Number(order.totalRefundedSet?.shopMoney?.amount || 0);
        const currency = order.currentTotalPriceSet?.shopMoney?.currencyCode || 'JPY';
        // 全額返金/失効/キャンセルは売上から除外(部分返金は current* が純額なので計上したまま)。
        const isPaid = !cancelled && !EXCLUDED_STATUSES.has(financialStatus);

        const items = (order.lineItems?.nodes || []).map((li) => {
          const match = matchEcLineItem(li, productIndex);
          if (match) matchedItems += 1; else unmatchedItems += 1;
          const quantity = Number(li.quantity || 0);
          const unitPrice = Number(li.originalUnitPriceSet?.shopMoney?.amount || 0);
          const totalPrice = Number(li.discountedTotalSet?.shopMoney?.amount ?? (unitPrice * quantity));
          return {
            shopifyVariantId: String(li.variant?.id || ''),
            barcode: String(li.variant?.barcode || ''),
            sku: String(li.sku || ''),
            title: String(li.title || li.name || ''),
            quantity,
            unitPrice,
            totalPrice,
            matchedProductId: match ? match.productId : null,
            categoryId: match ? match.categoryId : '',
            categoryName: match ? match.categoryName : '',
            categoryGroupName: match ? match.categoryGroupName : '',
            salesAreaId: match ? match.salesAreaId : '',
            gender: match ? match.gender : ''
          };
        });

        const paidAtIso = order.processedAt || order.createdAt || null;
        batch.set(storeRef.collection('ecOrders').doc(numericId), {
          shopifyOrderId: numericId,
          shopifyOrderGid: orderGid,
          name: String(order.name || ''),
          paidAt: paidAtIso ? new Date(paidAtIso) : null,
          orderCreatedAt: order.createdAt ? new Date(order.createdAt) : null,
          orderUpdatedAt: order.updatedAt ? new Date(order.updatedAt) : null,
          financialStatus,
          cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
          isCancelled: cancelled,
          totalAmount,
          taxAmount,
          totalRefunded,
          currency,
          salesChannel: 'shopify',
          isPaid,
          items,
          syncedAt: FieldValue.serverTimestamp(),
          source
        }, { merge: true });
        upserted += 1;
      }
      await batch.commit();
    }

    cursor = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    pages += 1;
    if (cursor) await sleepMs(500); // ペース調整(スロットル回避)
  } while (cursor && pages < 1000);

  // cursor は前進のみ(空振り/過去バックフィルで巻き戻さない)。2分オーバーラップで境界の取りこぼしを防ぐ。
  const overlapMs = 2 * 60 * 1000;
  const candidateIso = scanned > 0 ? new Date(new Date(maxUpdatedAt).getTime() - overlapMs).toISOString() : null;
  let nextCursorIso = savedCursor || null;
  if (candidateIso && (!nextCursorIso || candidateIso > nextCursorIso)) nextCursorIso = candidateIso;
  if (!nextCursorIso) nextCursorIso = since;
  await cursorRef.set({
    cursor: nextCursorIso,
    lastRunAt: FieldValue.serverTimestamp(),
    lastSource: source,
    lastScanned: scanned,
    lastUpserted: upserted
  }, { merge: true });

  const result = { scanned, upserted, matchedItems, unmatchedItems, pages, since, cursor: nextCursorIso };
  await storeRef.collection('ecOrderSyncReports').add({ at: FieldValue.serverTimestamp(), source, triggeredBy: triggeredBy || null, ...result });
  return result;
};

// 手動トリガー(EC連携「今すぐ取り込む/バックフィル」)。sinceOverride を渡すと過去分を取り込む。
export const syncShopifyEcOrders = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 540, memory: '1GiB' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }
      const authUser = await verifyRequestUser(req);
      const { storeId, sinceOverride } = parseJsonBody(req);
      const normalizedStoreId = String(storeId || '').trim();
      if (!normalizedStoreId) {
        return sendJson(res, 400, { ok: false, error: { message: 'storeId が不足しています。' } });
      }
      await fetchStoreMemberForRequest({ storeId: normalizedStoreId, uid: authUser.uid });

      const result = await runShopifyEcOrdersSync({
        storeId: normalizedStoreId,
        source: 'manual',
        triggeredBy: authUser.uid,
        sinceOverride: sinceOverride ? String(sinceOverride) : null
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      console.error('[syncShopifyEcOrders] failed', error);
      return sendJson(res, 400, { ok: false, error: { message: error.message || 'EC売上の取り込みに失敗しました。' } });
    }
  }
);

// 毎時の自動取り込み。ecSalesSyncEnabled=true の店舗だけ実行する。
export const scheduledShopifyEcOrdersSync = onSchedule(
  { region: REGION, schedule: 'every 1 hours', timeZone: 'Asia/Tokyo', timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    try {
      const storesSnap = await db.collection('stores').get();
      for (const storeDoc of storesSnap.docs) {
        const storeId = storeDoc.id;
        try {
          const shopifySettingsSnap = await storeDoc.ref.collection('settings').doc('shopify').get();
          const shopifySettings = shopifySettingsSnap.data() || {};
          if (shopifySettings.ecSalesSyncEnabled !== true) continue;
          const result = await runShopifyEcOrdersSync({ storeId, source: 'scheduled' });
          console.log('[scheduledShopifyEcOrdersSync] done', { storeId, ...result });
        } catch (error) {
          console.error('[scheduledShopifyEcOrdersSync] store failed', { storeId, message: error?.message });
        }
      }
    } catch (error) {
      console.error('[scheduledShopifyEcOrdersSync] failed', error);
    }
  }
);


export const createPrepayOrder = onRequest({ region: REGION, cors: true }, async (req, res) => {
  try {
    const authUser = await verifyRequestUser(req);
    const {
      storeId,
      sessionId,
      tableId,
      cart,
      totalPrice,
      partySize,
      participantId
    } = parseJsonBody(req);

    const normalizedParticipantId = String(participantId || '').trim() || authUser.uid;

    const normalizedPartySize = Number(partySize || 0) > 0
      ? Math.min(20, Number(partySize))
      : null;

    if (!storeId || !sessionId || !tableId || !Array.isArray(cart)) {
      return sendAppError(res, 400, 'app/invite-invalid');
    }

    if (cart.length === 0) {
      return sendAppError(res, 400, 'app/cart-empty');
    }

    const storeRef = db.collection('stores').doc(storeId);
    const storeData = await getReceiptStoreData(storeRef);
    const tableDisplayName = await getTableDisplayName({ storeId, tableId });

    const menuSnapshots = await Promise.all(
      cart.map((item) => storeRef.collection('menuItems').doc(String(item.id || '')).get())
    );

    const orderRef = storeRef.collection('orders').doc();

    const orderItems = cart.map((item, index) => {
      const quantity = Math.max(Number(item.quantity || 0), 0);
      const unitPrice = Number(item.unitPrice || item.price || 0);
      const taxIncludedAmount = quantity * unitPrice;
      const menuData = menuSnapshots[index]?.exists ? menuSnapshots[index].data() || {} : {};

      return {
        id: String(item.id || ''),
        name: String(item.name || menuData.name || '商品'),
        quantity,
        unitPrice,
        taxIncludedAmount,
        category: String(item.category || item.categoryId || menuData.category || ''),
        categoryId: String(item.category || item.categoryId || menuData.category || ''),
        appliedPriceMode: item.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal',
        priceLabelText: String(item.priceLabelText || ''),
        originalPrice: item.originalPrice ?? null,
        originalPriceLabelText: String(item.originalPriceLabelText || ''),
        selectedOptions: Array.isArray(item.selectedOptions) ? item.selectedOptions : [],
        options: Array.isArray(item.selectedOptions)
          ? item.selectedOptions.map((option) => option.name).filter(Boolean)
          : [],
        serviceTiming: String(item.serviceTiming || ''),
        serviceTimingLabel: String(item.serviceTimingLabel || ''),
        ...resolveCostSnapshot({
          menuData,
          storeData,
          quantity,
          salesTaxIncludedAmount: taxIncludedAmount
        })
      };
    });

    const orderData = {
      tableId,
      tableDisplayName,
      tableName: tableDisplayName,
      sessionId,
      partySize: normalizedPartySize,
      timestamp: FieldValue.serverTimestamp(),
      status: 'pending',
      paymentStatus: 'paid',
      orderFlow: 'prepay',
      paymentMethod: 'prepay',
      customerId: normalizedParticipantId,
      userId: authUser.uid,
      participantId: normalizedParticipantId,
      items: orderItems,
      totalPrice: Number(totalPrice || 0)
    };

    await orderRef.set(orderData);

    // [createPrepayOrder] mark session hasOrders
    await storeRef.collection('sessions').doc(sessionId).set({
      hasOrders: true,
      lastActivityAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    const receipt = await issueReceiptForOrder({
      storeId,
      orderRef,
      orderData,
      storeData
    });

    return sendJson(res, 200, {
      ok: true,
      orderId: orderRef.id,
      receiptId: receipt.receiptId,
      receiptNo: receipt.receiptNo
    });

  } catch (error) {
    console.error('[createPrepayOrder] failed', error);
    return sendAppError(res, 500, 'app/order-failed');
  }
});

export const issuePostpayReceipt = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }

      await verifyRequestUser(req);

      const { storeId, sessionId, transactionId, recipientName } = parseJsonBody(req);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedSessionId = String(sessionId || '').trim();
      const normalizedTransactionId = String(transactionId || '').trim();
      const normalizedRecipientName = String(recipientName || '').trim();

      if (!normalizedStoreId || !normalizedSessionId || !normalizedTransactionId) {
        return sendAppError(res, 400, 'app/invite-invalid', '領収書の発行情報が不足しています。');
      }

      const storeRef = db.collection('stores').doc(normalizedStoreId);
      const storeData = await getReceiptStoreData(storeRef);

      const transactionRef = storeRef
        .collection('transactions')
        .doc(normalizedTransactionId);

      const transactionSnapshot = await transactionRef.get();

      if (!transactionSnapshot.exists) {
        return sendAppError(res, 404, 'app/invite-not-found', '会計データが見つかりませんでした。');
      }

      const transactionData = transactionSnapshot.data() || {};

      if (transactionData.receiptId) {
        return sendJson(res, 200, {
          ok: true,
          receiptId: transactionData.receiptId,
          receiptNo: transactionData.receiptNo || ''
        });
      }

      const transactionOrderIds = Array.isArray(transactionData.customerSummaries)
        ? transactionData.customerSummaries
            .flatMap((summary) => Array.isArray(summary.orderIds) ? summary.orderIds : [])
            .map((orderId) => String(orderId || '').trim())
            .filter(Boolean)
        : [];

      const uniqueTransactionOrderIds = [...new Set(transactionOrderIds)];

      if (uniqueTransactionOrderIds.length === 0) {
        return sendAppError(res, 400, 'app/invite-invalid', '領収書の対象注文が見つかりませんでした。');
      }

      const orderSnapshots = await Promise.all(
        uniqueTransactionOrderIds.map((orderId) => (
          storeRef.collection('orders').doc(orderId).get()
        ))
      );

      const paidOrders = orderSnapshots
        .filter((docSnap) => docSnap.exists)
        .map((docSnap) => ({
          id: docSnap.id,
          ref: docSnap.ref,
          data: docSnap.data() || {}
        }))
        .filter((order) => {
          const paymentStatus = String(order.data.paymentStatus || '');
          return (
            order.data.sessionId === normalizedSessionId
            && order.data.status !== 'cancelled'
            && paymentStatus !== 'cancelled'
            && (
              paymentStatus === 'paid'
              || paymentStatus === 'partial_paid'
            )
          );
        });

      if (paidOrders.length === 0) {
        return sendAppError(res, 400, 'app/invite-invalid', '領収書の対象注文が見つかりませんでした。');
      }

      const receiptRef = storeRef.collection('receipts').doc();
      const receiptNo = buildReceiptNo(normalizedTransactionId);

      const lineItems = Array.isArray(transactionData.items)
        ? transactionData.items
        : [];

      const receiptItems = normalizeReceiptItems(
        lineItems.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          status: item.status || '',
          kitchenStatus: item.kitchenStatus || '',
          options: item.options || item.optionNames || []
        }))
      );

      const taxSummaries = [];

      if (Number(transactionData.totalReducedIncl || 0) > 0) {
        taxSummaries.push({
          taxRate: Number(transactionData.taxRateReduced || 8),
          taxIncludedTotal: Number(transactionData.totalReducedIncl || 0),
          taxAmount: Number(transactionData.taxAmountReduced || 0)
        });
      }

      if (Number(transactionData.totalStandardIncl || 0) > 0) {
        taxSummaries.push({
          taxRate: Number(transactionData.taxRateStandard || 10),
          taxIncludedTotal: Number(transactionData.totalStandardIncl || 0),
          taxAmount: Number(transactionData.taxAmountStandard || 0)
        });
      }

      if (taxSummaries.length === 0) {
        taxSummaries.push(...buildSimpleTaxSummary({
          totalAmount: transactionData.totalAmount,
          taxRate: storeData.taxRate || 10
        }));
      }

      const totalTax = taxSummaries.reduce(
        (sum, row) => sum + Number(row.taxAmount || 0),
        0
      );

      const receiptItemsTotal = receiptItems.reduce((sum, item) => (
        sum + Number(item.taxIncludedAmount || 0)
      ), 0);

      const resolvedTotalAmount = Number(
        transactionData.totalAmount
        || transactionData.totalPrice
        || transactionData.amount
        || receiptItemsTotal
        || 0
      );

      const resolvedDiscountAmount = Number(
        transactionData.discountAmount
        || transactionData.discount
        || 0
      );

      const resolvedTaxAmount = Number(
        totalTax
        || transactionData.taxAmount
        || 0
      );

      const resolvedSubtotalAmount = Number(
        transactionData.subTotal
        || transactionData.subtotal
        || Math.max(resolvedTotalAmount - resolvedTaxAmount, 0)
      );

      const receiptCustomerIds = [
        ...(Array.isArray(transactionData.customerIds) ? transactionData.customerIds : []),

        ...(Array.isArray(transactionData.customerSummaries)
          ? transactionData.customerSummaries.flatMap((summary) => [
              summary.customerId,
              ...(Array.isArray(summary.customerIds) ? summary.customerIds : [])
            ])
          : []),

        ...paidOrders.flatMap((order) => [
          order.data.customerId,
          order.data.participantId,
          order.data.userId,
          order.data.createdBy,
          order.data.uid
        ])
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

      const uniqueReceiptCustomerIds = [...new Set(receiptCustomerIds)];
      const receiptData = {
        receiptId: receiptRef.id,
        receiptNo,

        transactionId: normalizedTransactionId,
        orderIds: paidOrders.map((order) => order.id),

        customerIds: uniqueReceiptCustomerIds,
        customerSummaries: Array.isArray(transactionData.customerSummaries)
          ? transactionData.customerSummaries
          : [],

        sessionId: normalizedSessionId,
        tableId: transactionData.tableId || '',

        type: 'receipt',
        status: 'issued',

        store: {
          storeId: normalizedStoreId,
          name: storeData.name || storeData.storeName || '店舗名',
          address: storeData.address || '',
          phone: storeData.tel || storeData.phone || '',
          registrationNumber: storeData.invoiceNumber || storeData.registrationNumber || ''
        },

        customer: {
          name: normalizedRecipientName || transactionData.recipientName || ''
        },

        items: receiptItems,

        taxSummaries,

totals: {
  subtotal: resolvedSubtotalAmount,
  discount: resolvedDiscountAmount,
  tax: resolvedTaxAmount,
  total: resolvedTotalAmount
},

payment: {
  method: transactionData.paymentMethod || transactionData.paymentMethodGroup || 'postpay',
  status: 'paid',
  paidAt: transactionData.paidAt || FieldValue.serverTimestamp(),
  amount: resolvedTotalAmount
},

        issuedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };

      const batch = db.batch();

      batch.set(receiptRef, receiptData);

      batch.set(transactionRef, {
        receiptId: receiptRef.id,
        receiptNo,
        receiptIssuedAt: FieldValue.serverTimestamp(),
        ...(normalizedRecipientName ? { recipientName: normalizedRecipientName } : {})
      }, { merge: true });

      paidOrders.forEach((order) => {
        batch.set(order.ref, {
          receiptId: receiptRef.id,
          receiptNo,
          receiptIssuedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();

      return sendJson(res, 200, {
        ok: true,
        receiptId: receiptRef.id,
        receiptNo
      });
    } catch (error) {
      console.error('[issuePostpayReceipt] failed', error);
      return sendAppError(res, 500, 'app/order-failed', '領収書の発行に失敗しました。');
    }
  }
);

export const createPostpayOrder = onRequest(
  { region: 'asia-northeast1' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({
          ok: false,
          error: { message: 'Method not allowed' }
        });
      }

      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : '';

      if (!idToken) {
        return res.status(401).json({
          ok: false,
          error: { message: 'ログイン状態を確認できませんでした。' }
        });
      }

      const decodedToken = await adminAuth.verifyIdToken(idToken);
      const uid = decodedToken.uid;

      const {
        storeId,
        sessionId,
        tableId,
        partySize,
        participantId,
        cart,
        totalPrice,
        externalCustomer,
        orderSource,
        isStaffOrder,
        createdByStaffUid,
        createdByStaffName
      } = req.body || {};

      const normalizedOrderSource = String(orderSource || '').trim();
      const shouldMarkStaffOrder = isStaffOrder === true || normalizedOrderSource === 'staff';
      const normalizedCreatedByStaffUid = String(createdByStaffUid || '').trim();
      const normalizedCreatedByStaffName = String(createdByStaffName || '').trim();

      const requestedPartySize = Number(partySize || 0);

      if (!storeId || !sessionId || !tableId || !participantId) {
        return res.status(400).json({
          ok: false,
          error: { message: '注文情報が不足しています。' }
        });
      }

      if (!Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({
          ok: false,
          error: { message: 'カートが空です。' }
        });
      }

      const normalizedCart = cart.map((item) => ({
        id: String(item.id || ''),
        name: String(item.name || ''),
        kitchenName: String(item.kitchenName || ''),
        quantity: Math.max(Number(item.quantity || 0), 0),
        unitPrice: Number(item.unitPrice || item.price || 0),
        category: String(item.category || item.categoryId || ''),
        categoryId: String(item.category || item.categoryId || ''),
        appliedPriceMode: item.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal',
        priceLabelText: String(item.priceLabelText || ''),
        originalPrice: item.originalPrice ?? null,
        originalPriceLabelText: String(item.originalPriceLabelText || ''),
        crossSellSourceKey: String(
          item.crossSellSourceKey ||
          item.sourceKey ||
          ''
        ),
        crossSellSourceFlowId: String(
          item.crossSellSourceFlowId ||
          item.sourceFlowId ||
          ''
        ),
        crossSellSourceStepId: String(
          item.crossSellSourceStepId ||
          item.sourceStepId ||
          ''
        ),
        crossSellSourceGroupKey: String(
          item.crossSellSourceGroupKey ||
          item.sourceGroupKey ||
          ''
        ),
        crossSellSourceCategoryIds: Array.isArray(item.crossSellSourceCategoryIds)
          ? item.crossSellSourceCategoryIds.map(String)
          : Array.isArray(item.sourceCategoryIds)
            ? item.sourceCategoryIds.map(String)
            : [],
        selectedOptions: Array.isArray(item.selectedOptions) ? item.selectedOptions : [],
        serviceTiming: String(item.serviceTiming || ''),
        serviceTimingLabel: String(item.serviceTimingLabel || ''),
        allowsTakeout: item.allowsTakeout !== false,
        allergens: Array.isArray(item.allergens) ? item.allergens : [],
        limitedQuantity: item.limitedQuantity ?? null
      }));

      const invalidItem = normalizedCart.find((item) => !item.id || item.quantity <= 0);

      if (invalidItem) {
        return res.status(400).json({
          ok: false,
          error: { message: 'カート内の商品情報が正しくありません。' }
        });
      }

      // 混雑時の hot-doc 競合対策(案1): session / table / settings はトランザクションの
      // read-set に含めず、素の get で事前検証する。これにより同一セッションへの同時注文が
      // session ドキュメントを read+write で奪い合って ABORTED になるのを防ぐ。
      // 在庫整合が必要な menuItem の read/write だけをトランザクション内に残す。
      const storeRef = db.collection('stores').doc(storeId);
      const normalizedTableId = String(tableId || '').trim();

      const sessionRef = storeRef.collection('sessions').doc(sessionId);
      const tableRef = storeRef.collection('tables').doc(normalizedTableId);
      const settingsRef = storeRef.collection('settings').doc('basic');

      const [sessionSnapshot, tableSnapshot, settingsSnapshot] = await Promise.all([
        sessionRef.get(),
        tableRef.get(),
        settingsRef.get()
      ]);

      if (!sessionSnapshot.exists) {
        throw new Error('セッション情報が見つかりません。');
      }

      const sessionData = sessionSnapshot.data() || {};
      const tableData = tableSnapshot.exists ? tableSnapshot.data() || {} : {};
      const storeData = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};

      if (
        sessionData.status === 'ended' ||
        sessionData.status === 'completed' ||
        sessionData.status === 'archived' ||
        sessionData.status === 'locked' ||
        sessionData.status === 'disabled'
      ) {
        throw new Error('このセッションでは注文できません。');
      }

      const tableDisplayName = String(
        tableData.tableDisplayName ||
        tableData.displayName ||
        tableData.name ||
        sessionData.tableDisplayName ||
        sessionData.tableName ||
        ''
      ).trim();

      const sessionPartySize = Number(sessionData.partySize || 0);
      const normalizedPartySize =
        sessionPartySize > 0
          ? Math.min(20, sessionPartySize)
          : requestedPartySize > 0
            ? Math.min(20, requestedPartySize)
            : null;

      const result = await db.runTransaction(async (transaction) => {
        const menuRefs = normalizedCart.map((item) => ({
          cartItem: item,
          ref: db
            .collection('stores')
            .doc(storeId)
            .collection('menuItems')
            .doc(item.id)
        }));

        const menuSnapshots = await Promise.all(
          menuRefs.map(({ ref }) => transaction.get(ref))
        );

        const orderItems = [];
        const menuUpdates = [];

        menuSnapshots.forEach((snapshot, index) => {
          const { cartItem, ref } = menuRefs[index];

          if (!snapshot.exists) {
            throw new Error(`${cartItem.name || '商品'} が見つかりません。`);
          }

          const menuData = snapshot.data() || {};
          const quantity = Number(cartItem.quantity || 0);

          if (menuData.isSoldOut) {
            throw new Error(`${cartItem.name || menuData.name || '商品'} は売り切れのため注文できません。`);
          }

          const limitedQuantity = Number(menuData.limitedQuantity);
          const shouldCheckStock = Number.isFinite(limitedQuantity) && limitedQuantity > 0;

          const hasRemainingQuantity =
            menuData.remainingQuantity !== null
            && menuData.remainingQuantity !== undefined
            && menuData.remainingQuantity !== ''
            && Number.isFinite(Number(menuData.remainingQuantity));

          const currentSoldQuantity = Number(menuData.soldQuantity || 0);

          const currentRemainingQuantity = hasRemainingQuantity
            ? Number(menuData.remainingQuantity)
            : Math.max(limitedQuantity - currentSoldQuantity, 0);

          // limitedQuantity が 1以上の商品だけ在庫管理する。
          // limitedQuantity が null / 空 / 0 以下の商品は remainingQuantity が 0 でも在庫制限なしとして扱う。
          if (shouldCheckStock) {
            if (quantity > currentRemainingQuantity) {
              throw new Error(`${cartItem.name || menuData.name || '商品'} の残りは ${currentRemainingQuantity} 点です。`);
            }

            const nextSoldQuantity = currentSoldQuantity + quantity;
            const nextRemainingQuantity = Math.max(currentRemainingQuantity - quantity, 0);

            menuUpdates.push({
              ref,
              data: {
                soldQuantity: nextSoldQuantity,
                remainingQuantity: nextRemainingQuantity,
                isSoldOut: nextRemainingQuantity <= 0,
                updatedAt: FieldValue.serverTimestamp()
              }
            });
          }

          const selectedOptions = Array.isArray(cartItem.selectedOptions)
            ? cartItem.selectedOptions
            : [];

          const unitPrice = Number(cartItem.unitPrice || menuData.price || 0);
          const taxIncludedAmount = quantity * unitPrice;

          orderItems.push({
            id: cartItem.id,
            name: cartItem.name || menuData.name || '商品',
            kitchenName: String(cartItem.kitchenName || menuData.kitchenName || '').trim(),
            quantity,
            unitPrice,
            taxIncludedAmount,
            category: String(cartItem.category || menuData.category || ''),
            categoryId: String(cartItem.categoryId || cartItem.category || menuData.category || ''),
            appliedPriceMode: cartItem.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal',
            priceLabelText: String(cartItem.priceLabelText || ''),
            originalPrice: cartItem.originalPrice ?? null,
            originalPriceLabelText: String(cartItem.originalPriceLabelText || ''),
            crossSellSourceKey: String(
              cartItem.crossSellSourceKey ||
              cartItem.sourceKey ||
              ''
            ),
            crossSellSourceFlowId: String(
              cartItem.crossSellSourceFlowId ||
              cartItem.sourceFlowId ||
              ''
            ),
            crossSellSourceStepId: String(
              cartItem.crossSellSourceStepId ||
              cartItem.sourceStepId ||
              ''
            ),
            crossSellSourceGroupKey: String(
              cartItem.crossSellSourceGroupKey ||
              cartItem.sourceGroupKey ||
              ''
            ),
            crossSellSourceCategoryIds: Array.isArray(cartItem.crossSellSourceCategoryIds)
              ? cartItem.crossSellSourceCategoryIds.map(String)
              : Array.isArray(cartItem.sourceCategoryIds)
                ? cartItem.sourceCategoryIds.map(String)
                : [],
            options: selectedOptions.map((option) => option.name).filter(Boolean),
            serviceTiming: String(cartItem.serviceTiming || ''),
            serviceTimingLabel: String(cartItem.serviceTimingLabel || ''),
            allowsTakeout: cartItem.allowsTakeout !== false,
            allergens: cartItem.allergens || [],
            limitedQuantity: menuData.limitedQuantity ?? null,
            ...resolveCostSnapshot({
              menuData,
              storeData,
              quantity,
              salesTaxIncludedAmount: taxIncludedAmount
            })
          });
        });

        const orderRef = db
          .collection('stores')
          .doc(storeId)
          .collection('orders')
          .doc();

        menuUpdates.forEach(({ ref, data }) => {
          transaction.set(ref, data, { merge: true });
        });

        transaction.set(orderRef, {
          tableId,
          tableNumber: tableId,
          tableDisplayName,
          tableName: tableDisplayName,

          sessionId,
          partySize: normalizedPartySize,
          timestamp: FieldValue.serverTimestamp(),
          status: 'pending',
          customerId: participantId,
          userId: uid,
          participantId,
          items: orderItems,
          totalPrice: Number(totalPrice || 0),
          orderFlow: 'postpay',
          paymentStatus: 'unpaid',
          ...(externalCustomer ? { externalCustomer } : {}),
          ...(shouldMarkStaffOrder
            ? {
                orderSource: 'staff',
                isStaffOrder: true,
                createdByStaffUid: normalizedCreatedByStaffUid || uid || '',
                createdByStaffName: normalizedCreatedByStaffName
              }
            : {})
        });

        return { orderId: orderRef.id };
      }, { maxAttempts: 10 });

      // 案1: session の活動状況更新はコミット後にトランザクション外で行う。
      // hasOrders は autoVacate 側が orders 実データを必ず再確認する設計のため、
      // ここでの厳密なトランザクション整合は不要。txn 外に出すことで session
      // ドキュメントの hot-doc 競合を避ける。失敗しても注文成立は妨げない。
      try {
        await sessionRef.set({
          hasOrders: true,
          lastActivityAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (markError) {
        console.warn('[createPostpayOrder] post-commit session activity update failed', markError);
      }

      return res.status(200).json({
        ok: true,
        orderId: result.orderId
      });
    } catch (error) {
      console.error('[createPostpayOrder] failed', error);

      return res.status(400).json({
        ok: false,
        error: {
          message: error.message || '注文の送信に失敗しました。'
        }
      });
    }
  }
);


const isCancelledOrderLineItem = (item) => (
  item?.status === 'cancelled' || item?.kitchenStatus === 'cancelled'
);

const isCrossSellPricedOrderItem = (item) => (
  item?.appliedPriceMode === 'crossSell' || item?.priceMode === 'crossSell'
);

const getActiveOrderLineItems = (items = []) => (
  Array.isArray(items)
    ? items.filter((item) => item && !isCancelledOrderLineItem(item))
    : []
);

const getOrderLineQuantity = (item) => (
  Math.max(Number(item?.quantity || 0), 0)
);

const getOrderItemIdentity = (item, index = 0) => (
  String(
    item?.id ||
    item?.itemId ||
    item?.cartId ||
    item?.menuItemId ||
    item?.productId ||
    item?.name ||
    `item-${index}`
  )
);

const isCancelledOrderItem = (item) => (
  item?.status === 'cancelled' ||
  item?.kitchenStatus === 'cancelled'
);

const isPreparedOrderItem = (item) => {
  const kitchenStatus = String(item?.kitchenStatus || item?.status || 'pending');

  return (
    item?.isPrepared === true ||
    item?.isStarted === true ||
    item?.isCooking === true ||
    item?.startedAt ||
    item?.startedAtMs ||
    item?.cookingStartedAtMs ||
    item?.preparedAt ||
    item?.preparedAtMs ||
    item?.servedAt ||
    item?.servedAtMs ||
    kitchenStatus === 'preparing' ||
    kitchenStatus === 'cooking' ||
    kitchenStatus === 'in_progress' ||
    kitchenStatus === 'started' ||
    kitchenStatus === 'prepared' ||
    kitchenStatus === 'served' ||
    kitchenStatus === 'completed'
  );
};

const calculateActiveItemsTotal = (items = []) => (
  items.reduce((sum, item) => {
    if (isCancelledOrderItem(item)) return sum;

    const quantity = Math.max(Number(item?.quantity || 0), 0);
    const unitPrice = Number(item?.unitPrice ?? item?.price ?? 0) || 0;

    return sum + (quantity * unitPrice);
  }, 0)
);

const isCrossSellOrderItem = (item) => (
  item?.appliedPriceMode === 'crossSell' || item?.priceMode === 'crossSell'
);

const getOrderItemQuantity = (item) => (
  Math.max(Number(item?.quantity || 0), 0)
);

const normalizeStringArray = (value) => (
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
);

const getOrderItemCategoryId = (item) => (
  String(item?.categoryId || item?.category || '').trim()
);

const getCrossSellFlowsFromSettings = (settings = {}) => {
  if (Array.isArray(settings.flows)) return settings.flows;
  if (Array.isArray(settings.items)) return settings.items;
  if (Array.isArray(settings.list)) return settings.list;
  if (Array.isArray(settings.crossSellFlows)) return settings.crossSellFlows;
  return [];
};

const getCrossSellFlowTriggerCategoryIds = (flow = {}, crossSellSettings = {}) => {
  const candidates = [
    flow.triggerCategoryIds,
    flow.triggerCategories,
    flow.sourceCategoryIds,
    flow.sourceCategories,
    flow.categoryIds
  ];

  for (const candidate of candidates) {
    const values = normalizeStringArray(candidate);
    if (values.length > 0) return values;
  }

  const singleCandidates = [
    flow.triggerCategoryId,
    flow.sourceCategoryId,
    flow.categoryId
  ];

  const singleValues = singleCandidates
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (singleValues.length > 0) return singleValues;

  // フロントの flowHasTriggerForItem と同じく、triggerGroupId からトリガーカテゴリを解決する。
  const triggerGroupId = String(
    flow.triggerGroupId ||
    flow.triggerGroupKey ||
    flow.sourceGroupId ||
    flow.sourceGroupKey ||
    ''
  ).trim();

  if (!triggerGroupId) return [];

  const group = getCrossSellGroupsFromSettings(crossSellSettings).find((candidate) => (
    String(candidate?.id || candidate?.key || candidate?.groupId || '').trim() === triggerGroupId
  ));

  return normalizeStringArray(group?.categoryIds);
};

const getCrossSellGroupsFromSettings = (settings = {}) => (
  Array.isArray(settings.groups)
    ? settings.groups
    : []
);

const getCrossSellStepOfferGroups = (step = {}, crossSellSettings = {}) => {
  if (Array.isArray(step.offerGroups)) return step.offerGroups;
  if (Array.isArray(step.groups)) return step.groups;
  if (Array.isArray(step.offers)) return step.offers;

  if (String(step?.type || '') === 'group') {
    const groupId = String(step?.groupId || step?.groupKey || '').trim();

    if (!groupId) return [];

    const matchedGroup = getCrossSellGroupsFromSettings(crossSellSettings).find((group) => (
      String(group?.id || group?.key || group?.groupId || '').trim() === groupId
    ));

    return matchedGroup ? [matchedGroup] : [];
  }

  if (String(step?.type || '') === 'category') {
    const categoryIds = normalizeStringArray(step?.categoryIds);
    const categoryId = String(step?.categoryId || '').trim();

    const resolvedCategoryIds = categoryIds.length > 0
      ? categoryIds
      : categoryId
        ? [categoryId]
        : [];

    return resolvedCategoryIds.length > 0
      ? [{
          id: step?.id || categoryId,
          key: step?.id || categoryId,
          categoryIds: resolvedCategoryIds
        }]
      : [];
  }

  return [];
};

const getCrossSellOfferGroupCategoryIds = (offerGroup = {}) => {
  const candidates = [
    offerGroup.categoryIds,
    offerGroup.categories,
    offerGroup.offerCategoryIds,
    offerGroup.targetCategoryIds
  ];

  for (const candidate of candidates) {
    const values = normalizeStringArray(candidate);
    if (values.length > 0) return values;
  }

  const singleCandidates = [
    offerGroup.categoryId,
    offerGroup.offerCategoryId,
    offerGroup.targetCategoryId
  ];

  return singleCandidates
    .map((value) => String(value || '').trim())
    .filter(Boolean);
};

const getCrossSellOfferSourceKey = (flow = {}, offerGroup = {}) => (
  [
    String(flow?.id || ''),
    String(offerGroup?.key || offerGroup?.groupId || offerGroup?.categoryId || ''),
    Array.isArray(offerGroup?.categoryIds)
      ? offerGroup.categoryIds.map(String).sort().join(',')
      : ''
  ].join('::')
);

const countItemsInCategoryIds = (items = [], categoryIds = []) => {
  const normalizedCategoryIds = normalizeStringArray(categoryIds);

  if (normalizedCategoryIds.length === 0) return 0;

  return items.reduce((total, item) => {
    const categoryId = getOrderItemCategoryId(item);
    if (!normalizedCategoryIds.includes(categoryId)) return total;
    return total + getOrderItemQuantity(item);
  }, 0);
};

const getCrossSellOfferGroupKey = (offerGroup = {}) => (
  String(
    offerGroup?.key ||
    offerGroup?.groupId ||
    offerGroup?.categoryId ||
    offerGroup?.offerCategoryId ||
    offerGroup?.targetCategoryId ||
    ''
  ).trim()
);

const isCrossSellItemFromOfferGroup = (item = {}, offerGroup = {}, flow = {}) => {
  const offerCategoryIds = getCrossSellOfferGroupCategoryIds(offerGroup);
  const itemCategoryId = getOrderItemCategoryId(item);

  if (!offerCategoryIds.includes(itemCategoryId)) {
    return false;
  }

  const expectedSourceKey = getCrossSellOfferSourceKey(flow, offerGroup);
  const itemSourceKey = String(item?.crossSellSourceKey || '').trim();

  if (expectedSourceKey && itemSourceKey && itemSourceKey === expectedSourceKey) {
    return true;
  }

  const expectedFlowId = String(flow?.id || '').trim();
  const itemFlowId = String(item?.crossSellSourceFlowId || '').trim();

  if (expectedFlowId && itemFlowId && expectedFlowId !== itemFlowId) {
    return false;
  }

  const expectedGroupKey = getCrossSellOfferGroupKey(offerGroup);
  const itemGroupKey = String(item?.crossSellSourceGroupKey || '').trim();

  if (expectedGroupKey && itemGroupKey && expectedGroupKey !== itemGroupKey) {
    return false;
  }

  const itemSourceCategoryIds = normalizeStringArray(item?.crossSellSourceCategoryIds);

  if (itemSourceCategoryIds.length > 0) {
    return itemSourceCategoryIds.some((categoryId) => offerCategoryIds.includes(categoryId));
  }

  // 古い注文など source 情報が足りない場合は、カテゴリ一致を優先して使用数に含める。
  // ここで漏らすと、トリガー商品だけを消せてセット価格商品が残るため。
  return true;
};

const countCrossSellItemsForOfferGroup = (crossSellItems = [], offerGroup = {}, flow = {}) => (
  crossSellItems
    .filter((item) => isCrossSellItemFromOfferGroup(item, offerGroup, flow))
    .reduce((total, item) => total + getOrderItemQuantity(item), 0)
);

const assertCrossSellBalance = (items = [], crossSellSettings = {}) => {
  const activeItems = Array.isArray(items)
    ? items.filter((item) => !isCancelledOrderItem(item))
    : [];

  const crossSellItems = activeItems.filter((item) => isCrossSellOrderItem(item));

  if (crossSellItems.length === 0) return;

  const flows = getCrossSellFlowsFromSettings(crossSellSettings)
    .filter((flow) => flow && flow.enabled !== false && flow.isActive !== false);

  if (flows.length === 0) {
    throw new Error('app/cross-sell-balance-required');
  }

  // トリガーになるのは「通常価格」かつ「その flow の triggerCategory に該当する商品」だけ。
  // セット価格の商品は、たとえカテゴリが一致しても次のクロスセル権利を発生させない。
  const triggerItems = activeItems.filter((item) => !isCrossSellOrderItem(item));

  flows.forEach((flow) => {
    const triggerCategoryIds = getCrossSellFlowTriggerCategoryIds(flow, crossSellSettings);
    const triggerQuantity = countItemsInCategoryIds(triggerItems, triggerCategoryIds);

    const steps = Array.isArray(flow.steps) ? flow.steps : [];

    steps.forEach((step) => {
      getCrossSellStepOfferGroups(step, crossSellSettings).forEach((offerGroup) => {
        const usedQuantity = countCrossSellItemsForOfferGroup(crossSellItems, offerGroup, flow);

        if (usedQuantity > triggerQuantity) {
          throw new Error('app/cross-sell-balance-required');
        }
      });
    });
  });
};

export const cancelCustomerOrderItem = onRequest(
  { region: REGION, cors: true },
  async (request, response) => {
    if (request.method !== 'POST') {
      return sendAppError(response, 405, 'app/method-not-allowed');
    }

    try {
      const authUser = await verifyRequestUser(request);
      const {
        storeId,
        sessionId,
        orderId,
        itemId,
        itemIndex,
        participantId
      } = parseJsonBody(request);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedSessionId = String(sessionId || '').trim();
      const normalizedOrderId = String(orderId || '').trim();
      const normalizedItemId = String(itemId || '').trim();
      const normalizedParticipantId = String(participantId || '').trim();
      const normalizedItemIndex = Number(itemIndex);

      if (
        !normalizedStoreId ||
        !normalizedSessionId ||
        !normalizedOrderId ||
        !normalizedItemId ||
        !normalizedParticipantId
      ) {
        return sendAppError(response, 400, 'app/order-invalid', '注文情報を確認してください。');
      }

      const result = await db.runTransaction(async (transaction) => {
        const storeRef = db.collection('stores').doc(normalizedStoreId);
        const orderRef = storeRef.collection('orders').doc(normalizedOrderId);
        const orderSnapshot = await transaction.get(orderRef);

        if (!orderSnapshot.exists) {
          throw new Error('app/order-not-found');
        }

        const order = orderSnapshot.data() || {};
        const items = Array.isArray(order.items) ? order.items : [];

        const crossSellSettingsRef = storeRef.collection('settings').doc('crossSell');
        const crossSellSettingsSnapshot = await transaction.get(crossSellSettingsRef);
        const crossSellSettings = crossSellSettingsSnapshot.exists
          ? (crossSellSettingsSnapshot.data() || {})
          : {};

        if (String(order.sessionId || '') !== normalizedSessionId) {
          throw new Error('app/order-not-found');
        }

        const isOwner =
          String(order.userId || '') === String(authUser.uid) ||
          String(order.participantId || '') === normalizedParticipantId ||
          String(order.customerId || '') === normalizedParticipantId;

        if (!isOwner) {
          throw new Error('app/permission-denied');
        }

        if (String(order.orderFlow || '') === 'prepay') {
          throw new Error('app/prepay-cancel-unavailable');
        }

        if (order.paymentStatus === 'paid') {
          throw new Error('app/paid-order-cancel-unavailable');
        }

        if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') {
          throw new Error('app/order-already-cancelled');
        }

        if (!items.length) {
          throw new Error('app/order-invalid');
        }

        let targetIndex = -1;

        if (
          Number.isInteger(normalizedItemIndex) &&
          normalizedItemIndex >= 0 &&
          normalizedItemIndex < items.length
        ) {
          const candidate = items[normalizedItemIndex];
          const candidateIdentity = getOrderItemIdentity(candidate, normalizedItemIndex);

          if (candidateIdentity === normalizedItemId) {
            targetIndex = normalizedItemIndex;
          }
        }

        if (targetIndex < 0) {
          targetIndex = items.findIndex((item, index) => (
            getOrderItemIdentity(item, index) === normalizedItemId
          ));
        }

        if (targetIndex < 0) {
          throw new Error('app/order-item-not-found');
        }

        const targetItem = items[targetIndex];

        if (isCancelledOrderItem(targetItem)) {
          throw new Error('app/order-item-already-cancelled');
        }

        if (isPreparedOrderItem(targetItem)) {
          throw new Error('app/order-already-started');
        }

        const targetKitchenStatus = String(targetItem?.kitchenStatus || 'pending');
        if (targetKitchenStatus !== 'pending') {
          throw new Error('app/order-already-started');
        }

        const cancelledAtMs = Date.now();

        const nextItems = items.map((item, index) => {
          if (index !== targetIndex) return item;

          return {
            ...item,
            status: 'cancelled',
            kitchenStatus: 'cancelled',
            cancelledBy: 'customer',
            cancelledByUid: authUser.uid,
            cancelledParticipantId: normalizedParticipantId,
            cancelledAtMs
          };
        });

        // セット価格商品そのもののキャンセルは、調理前なら素早く許可する。
        // バランスチェックは「通常価格のトリガー商品をキャンセルする時」だけ必要。
        // 例：パスタを消すならセットドリンクだけ残らないように制限する。
        // 例：セットドリンクを消すなら上限超過は起きないので制限しない。
        if (!isCrossSellOrderItem(targetItem)) {
          assertCrossSellBalance(nextItems, crossSellSettings);
        }

        const activeItems = nextItems.filter((item) => !isCancelledOrderItem(item));
        const nextTotalPrice = calculateActiveItemsTotal(nextItems);
        const isOrderFullyCancelled = activeItems.length === 0;

        const itemQuantity = Math.max(Number(targetItem?.quantity || 0), 0);
        const menuItemId = String(targetItem?.id || '').trim();

        if (menuItemId && itemQuantity > 0) {
          const menuRef = storeRef.collection('menuItems').doc(menuItemId);
          const menuSnapshot = await transaction.get(menuRef);

          if (menuSnapshot.exists) {
            const menuData = menuSnapshot.data() || {};

            const hasLimitedQuantity =
              menuData.limitedQuantity !== null &&
              menuData.limitedQuantity !== undefined &&
              menuData.limitedQuantity !== '';

            const hasRemainingQuantity =
              menuData.remainingQuantity !== null &&
              menuData.remainingQuantity !== undefined &&
              menuData.remainingQuantity !== '';

            if (hasLimitedQuantity || hasRemainingQuantity) {
              const currentSoldQuantity = Number(menuData.soldQuantity || 0);
              const currentRemainingQuantity = Number(menuData.remainingQuantity || 0);

              const nextSoldQuantity = Math.max(currentSoldQuantity - itemQuantity, 0);
              const nextRemainingQuantity = Math.max(currentRemainingQuantity + itemQuantity, 0);

              transaction.set(menuRef, {
                soldQuantity: nextSoldQuantity,
                remainingQuantity: nextRemainingQuantity,
                isSoldOut: nextRemainingQuantity <= 0 ? menuData.isSoldOut === true : false,
                updatedAt: FieldValue.serverTimestamp()
              }, { merge: true });
            }
          }
        }

        transaction.set(orderRef, {
          items: nextItems,
          totalPrice: nextTotalPrice,
          activeItemCount: activeItems.length,
          cancelledItemCount: nextItems.length - activeItems.length,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: cancelledAtMs,
          ...(isOrderFullyCancelled
            ? {
                status: 'cancelled',
                paymentStatus: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
                cancelledAtMs,
                cancelledBy: 'customer',
                cancelledByUid: authUser.uid,
                cancelledParticipantId: normalizedParticipantId
              }
            : {})
        }, { merge: true });

        return {
          orderId: normalizedOrderId,
          itemId: normalizedItemId,
          isOrderFullyCancelled,
          totalPrice: nextTotalPrice
        };
      });

      return response.status(200).json({
        ok: true,
        ...result
      });
    } catch (error) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/order-not-found': 404,
        'app/order-item-not-found': 404,
        'app/order-invalid': 400,
        'app/prepay-cancel-unavailable': 400,
        'app/paid-order-cancel-unavailable': 400,
        'app/order-already-cancelled': 400,
        'app/order-item-already-cancelled': 400,
        'app/order-already-started': 400,
        'app/cross-sell-balance-required': 400
      };

      const messageByCode = {
        'app/permission-denied': 'この商品をキャンセルする権限がありません。',
        'app/order-not-found': '注文情報が見つかりませんでした。',
        'app/order-item-not-found': '商品情報が見つかりませんでした。',
        'app/order-invalid': '注文情報を確認してください。',
        'app/prepay-cancel-unavailable': '決済済みの注文はアプリから変更できません。スタッフへお声がけください。',
        'app/paid-order-cancel-unavailable': '会計済みの注文はアプリから変更できません。',
        'app/order-already-cancelled': 'この注文はすでにキャンセルされています。',
        'app/order-item-already-cancelled': 'この商品はすでにキャンセルされています。',
        'app/order-already-started': '調理が開始されたため、アプリからは変更できません。スタッフへお声がけください。',
        'app/cross-sell-balance-required': 'この商品をキャンセルすると、セット商品の数が上限を超えます。先に対象のセット商品をキャンセルしてください。'
      };

      const code = error.message || 'app/order-item-cancel-failed';

      if (statusByCode[code]) {
        return sendAppError(
          response,
          statusByCode[code],
          code,
          messageByCode[code] || '商品のキャンセルに失敗しました。'
        );
      }

      console.error('[cancelCustomerOrderItem] failed', error);
      return sendAppError(response, 500, 'app/order-item-cancel-failed', '商品のキャンセルに失敗しました。');
    }
  }
);


export const cancelCustomerOrder = onRequest(
  { region: REGION, cors: true },
  async (request, response) => {
    if (request.method !== 'POST') {
      return sendAppError(response, 405, 'app/method-not-allowed');
    }

    try {
      const authUser = await verifyRequestUser(request);
      const {
        storeId,
        sessionId,
        orderId,
        participantId
      } = parseJsonBody(request);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedSessionId = String(sessionId || '').trim();
      const normalizedOrderId = String(orderId || '').trim();
      const normalizedParticipantId = String(participantId || '').trim();

      if (!normalizedStoreId || !normalizedSessionId || !normalizedOrderId || !normalizedParticipantId) {
        return sendAppError(response, 400, 'app/order-invalid', '注文情報を確認してください。');
      }

      const result = await db.runTransaction(async (transaction) => {
        const storeRef = db.collection('stores').doc(normalizedStoreId);
        const orderRef = storeRef.collection('orders').doc(normalizedOrderId);
        const orderSnapshot = await transaction.get(orderRef);

        if (!orderSnapshot.exists) {
          throw new Error('app/order-not-found');
        }

        const order = orderSnapshot.data() || {};
        const items = Array.isArray(order.items) ? order.items : [];

        if (String(order.sessionId || '') !== normalizedSessionId) {
          throw new Error('app/order-not-found');
        }

        const isOwner =
          String(order.userId || '') === String(authUser.uid) ||
          String(order.participantId || '') === normalizedParticipantId ||
          String(order.customerId || '') === normalizedParticipantId;

        if (!isOwner) {
          throw new Error('app/permission-denied');
        }

        if (String(order.orderFlow || '') === 'prepay') {
          throw new Error('app/prepay-cancel-unavailable');
        }

        if (order.paymentStatus === 'paid') {
          throw new Error('app/paid-order-cancel-unavailable');
        }

        if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') {
          throw new Error('app/order-already-cancelled');
        }

        if (!items.length) {
          throw new Error('app/order-invalid');
        }

        const hasStartedItem = items.some((item) => (
          !isCancelledOrderItem(item) && isPreparedOrderItem(item)
        ));

        if (hasStartedItem) {
          throw new Error('app/order-already-started');
        }

        const menuRefs = items
          .filter((item) => String(item?.id || '').trim())
          .map((item) => ({
            item,
            ref: storeRef.collection('menuItems').doc(String(item.id).trim())
          }));

        const menuSnapshots = await Promise.all(
          menuRefs.map(({ ref }) => transaction.get(ref))
        );

        menuSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) return;

          const { item, ref } = menuRefs[index];
          const menuData = snapshot.data() || {};
          const quantity = Math.max(Number(item.quantity || 0), 0);

          const hasLimitedQuantity =
            menuData.limitedQuantity !== null &&
            menuData.limitedQuantity !== undefined &&
            menuData.limitedQuantity !== '';

          const hasRemainingQuantity =
            menuData.remainingQuantity !== null &&
            menuData.remainingQuantity !== undefined &&
            menuData.remainingQuantity !== '';

          if (!hasLimitedQuantity && !hasRemainingQuantity) return;

          const currentSoldQuantity = Number(menuData.soldQuantity || 0);
          const currentRemainingQuantity = Number(menuData.remainingQuantity || 0);

          const nextSoldQuantity = Math.max(currentSoldQuantity - quantity, 0);
          const nextRemainingQuantity = Math.max(currentRemainingQuantity + quantity, 0);

          transaction.set(ref, {
            soldQuantity: nextSoldQuantity,
            remainingQuantity: nextRemainingQuantity,
            isSoldOut: nextRemainingQuantity <= 0 ? menuData.isSoldOut === true : false,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        });

        const cancelledAtMs = Date.now();
        const nextItems = items.map((item) => ({
          ...item,
          status: 'cancelled',
          kitchenStatus: 'cancelled',
          cancelledBy: 'customer',
          cancelledAtMs
        }));

        transaction.set(orderRef, {
          status: 'cancelled',
          paymentStatus: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledAtMs,
          cancelledBy: 'customer',
          cancelledByUid: authUser.uid,
          cancelledParticipantId: normalizedParticipantId,
          updatedAt: FieldValue.serverTimestamp(),
          items: nextItems
        }, { merge: true });

        return { orderId: normalizedOrderId };
      });

      return response.status(200).json({
        ok: true,
        orderId: result.orderId
      });
    } catch (error) {
      const statusByCode = {
        'app/unauthenticated': 401,
        'app/permission-denied': 403,
        'app/order-not-found': 404,
        'app/order-invalid': 400,
        'app/prepay-cancel-unavailable': 400,
        'app/paid-order-cancel-unavailable': 400,
        'app/order-already-cancelled': 400,
        'app/order-already-started': 400
      };

      const messageByCode = {
        'app/permission-denied': 'この注文をキャンセルする権限がありません。',
        'app/order-not-found': '注文情報が見つかりませんでした。',
        'app/order-invalid': '注文情報を確認してください。',
        'app/prepay-cancel-unavailable': '決済済みの注文はアプリからキャンセルできません。スタッフへお声がけください。',
        'app/paid-order-cancel-unavailable': '会計済みの注文はアプリからキャンセルできません。',
        'app/order-already-cancelled': 'この注文はすでにキャンセルされています。',
        'app/order-already-started': '調理が開始されたため、アプリからはキャンセルできません。スタッフへお声がけください。'
      };

      const code = error.message || 'app/order-cancel-failed';

      if (statusByCode[code]) {
        return sendAppError(
          response,
          statusByCode[code],
          code,
          messageByCode[code] || '注文のキャンセルに失敗しました。'
        );
      }

      console.error('[cancelCustomerOrder] failed', error);
      return sendAppError(response, 500, 'app/order-cancel-failed', '注文のキャンセルに失敗しました。');
    }
  }
);

export const autoVacateNoOrderSessions = onSchedule(
  {
    region: REGION,
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Tokyo'
  },
  async () => {
    const storeIds = new Set();

    const storesSnapshot = await db.collection('stores').get();
    storesSnapshot.docs.forEach((storeDoc) => {
      storeIds.add(storeDoc.id);
    });

    // 親 stores/{storeId} がなくてもサブコレクションだけ存在するケースがあるため、
    // users.storeId からも店舗IDを拾う。
    const usersSnapshot = await db.collection('users').get();
    usersSnapshot.docs.forEach((userDoc) => {
      const storeId = String(userDoc.data()?.storeId || '').trim();
      if (storeId) storeIds.add(storeId);
    });

    let checkedStoreCount = 0;
    let checkedSessionCount = 0;
    let skippedWithOrdersCount = 0;
    let patchedHasOrdersCount = 0;
    let archivedCount = 0;

    for (const storeId of storeIds) {
      checkedStoreCount += 1;

      const storeRef = db.collection('stores').doc(storeId);
      const basicSettingsSnapshot = await storeRef
        .collection('settings')
        .doc('basic')
        .get();

      const autoVacateMinutes = Number(
        basicSettingsSnapshot.data()?.noOrderAutoVacateMinutes || 0
      );

      if (!autoVacateMinutes || autoVacateMinutes <= 0) {
        continue;
      }

      const cutoffMs = Date.now() - autoVacateMinutes * 60 * 1000;

      const sessionsSnapshot = await storeRef
        .collection('sessions')
        .where('status', '==', 'active')
        .limit(100)
        .get();

      if (sessionsSnapshot.empty) {
        continue;
      }

      const batch = db.batch();
      let batchCount = 0;

      for (const sessionDoc of sessionsSnapshot.docs) {
        checkedSessionCount += 1;

        const sessionData = sessionDoc.data() || {};
        const tableId = String(sessionData.tableId || '').trim();

        const createdAtDate = sessionData.createdAt?.toDate?.() || null;
        const createdAtMs = createdAtDate?.getTime?.() || 0;

        if (!createdAtMs || createdAtMs > cutoffMs) {
          continue;
        }

        // 最終安全判定：
        // hasOrders フラグではなく、orders 実データを必ず確認する。
        const ordersSnapshot = await storeRef
          .collection('orders')
          .where('sessionId', '==', sessionDoc.id)
          .limit(1)
          .get();

        if (!ordersSnapshot.empty) {
          skippedWithOrdersCount += 1;

          if (sessionData.hasOrders !== true) {
            batch.set(sessionDoc.ref, {
              hasOrders: true,
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            patchedHasOrdersCount += 1;
            batchCount += 1;
          }

          continue;
        }

        batch.set(sessionDoc.ref, {
          status: 'archived',
          autoVacated: true,
          autoVacatedReason: 'no_order_timeout',
          autoVacatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        if (tableId) {
          const tableRef = storeRef.collection('tables').doc(tableId);
          const tableSessionRef = storeRef.collection('tableSessions').doc(tableId);
          const tableEntryGuardRef = storeRef.collection('tableEntryGuards').doc(tableId);

          batch.set(tableRef, {
            status: 'vacant',
            sessionId: null,
            lastClosedSessionId: sessionDoc.id,
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          batch.set(tableSessionRef, {
            tableId,
            sessionId: null,
            status: 'vacant',
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          batch.delete(tableEntryGuardRef);
        }

        archivedCount += 1;
        batchCount += 1;
      }

      if (batchCount > 0) {
        await batch.commit();
      }
    }

    console.log('[autoVacateNoOrderSessions] checked stores:', checkedStoreCount);
    console.log('[autoVacateNoOrderSessions] checked sessions:', checkedSessionCount);
    console.log('[autoVacateNoOrderSessions] skipped sessions with orders:', skippedWithOrdersCount);
    console.log('[autoVacateNoOrderSessions] patched hasOrders sessions:', patchedHasOrdersCount);
    console.log('[autoVacateNoOrderSessions] archived sessions:', archivedCount);
  }
);


// Auto-maintain product search keywords.
// This keeps product master keyword search working after UI edits, CSV imports, and script writes.
const PRODUCT_SEARCH_KEYWORDS_VERSION = 2;

const normalizeProductSearchKeywordText = (value) => (
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
);

const addProductSearchKeywordTerm = (terms, value) => {
  const normalized = normalizeProductSearchKeywordText(value);
  if (!normalized) return;

  terms.add(normalized);

  const parts = normalized
    .split(/[\s　/／・,，、.。_\-ー]+/)
    .map((part) => normalizeProductSearchKeywordText(part))
    .filter(Boolean);

  parts.forEach((part) => {
    terms.add(part);

    // Prefixes keep partial searches such as "mosco" -> "moscot" working.
    if (/^[a-z0-9]+$/.test(part) && part.length >= 2) {
      const maxPrefixLength = Math.min(part.length, 12);
      for (let index = 2; index <= maxPrefixLength; index += 1) {
        terms.add(part.slice(0, index));
      }
    }
  });

  const compact = normalized.replace(/[\s　/／・,，、.。_\-ー]+/g, '');
  if (compact) {
    terms.add(compact);

    if (/^[a-z0-9]+$/.test(compact) && compact.length >= 2) {
      const maxPrefixLength = Math.min(compact.length, 16);
      for (let index = 2; index <= maxPrefixLength; index += 1) {
        terms.add(compact.slice(0, index));
      }
    }

    // Small n-grams help Japanese partial searches without making the document too large.
    if (!/^[a-z0-9]+$/.test(compact) && compact.length >= 2) {
      const maxGramLength = Math.min(6, compact.length);
      for (let size = 2; size <= maxGramLength; size += 1) {
        for (let start = 0; start <= compact.length - size; start += 1) {
          terms.add(compact.slice(start, start + size));
          if (terms.size >= 120) return;
        }
      }
    }
  }
};

const buildProductSearchKeywordsForFunction = (product = {}) => {
  const terms = new Set();

  [
    product.name,
    product.productName,
    product.title,
    product.productGroupTitle,
    product.sku,
    product.productCode,
    product.code,
    product.barcode,
    product.janCode,
    product.brandName,
    product.vendor,
    product.categoryGroupName,
    product.categoryName,
    product.subCategoryName,
    product.salesAreaName,
    product.productType,
    product.colorName,
    product.color,
    product.colorCode,
    product.size,
    product.sizeName,
    product.option1,
    product.option2,
    product.option3
  ].forEach((value) => addProductSearchKeywordTerm(terms, value));

  return Array.from(terms)
    .filter(Boolean)
    .slice(0, 120);
};

const areStringArraysEqualIgnoreOrder = (left = [], right = []) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();

  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

export const syncProductSearchKeywords = onDocumentWritten(
  {
    region: 'asia-northeast1',
    database: FIRESTORE_DATABASE_ID,
    document: 'stores/{storeId}/products/{productId}'
  },
  async (event) => {
    const afterSnapshot = event.data?.after;

    if (!afterSnapshot?.exists) {
      return;
    }

    const product = afterSnapshot.data() || {};
    const nextSearchKeywords = buildProductSearchKeywordsForFunction(product);
    const currentSearchKeywords = Array.isArray(product.searchKeywords) ? product.searchKeywords : [];

    const alreadyCurrent = (
      product.searchKeywordsVersion === PRODUCT_SEARCH_KEYWORDS_VERSION
      && areStringArraysEqualIgnoreOrder(currentSearchKeywords, nextSearchKeywords)
    );

    if (alreadyCurrent) {
      return;
    }

    await afterSnapshot.ref.update({
      searchKeywords: nextSearchKeywords,
      searchKeywordsVersion: PRODUCT_SEARCH_KEYWORDS_VERSION,
      searchKeywordsUpdatedAt: FieldValue.serverTimestamp()
    });
  }
);


const parseProductCsvTextForWorker = (sourceText = '') => {
  const text = String(sourceText || '').replace(/^\uFEFF/, '');
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      row.push(current);
      current = '';
      if (row.some((value) => String(value || '').trim() !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((value) => String(value || '').trim() !== '')) {
    rows.push(row);
  }

  return rows;
};

const countMappedProductCsvRowsForWorker = (rows = []) => {
  if (!Array.isArray(rows) || rows.length <= 1) {
    return {
      headerCount: Array.isArray(rows?.[0]) ? rows[0].length : 0,
      dataRows: 0,
      importableRows: 0
    };
  }

  const headers = rows[0].map((header) => String(header || '').trim());
  const nameIndex = headers.findIndex((header) => ['name', '商品名', 'productName'].includes(header));
  const skuIndex = headers.findIndex((header) => ['sku', '品番', 'productCode', '商品コード'].includes(header));
  const barcodeIndex = headers.findIndex((header) => ['barcode', 'バーコード', 'JAN'].includes(header));

  const dataRows = rows.slice(1);
  const importableRows = dataRows.filter((row) => {
    const name = nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '';
    const sku = skuIndex >= 0 ? String(row[skuIndex] || '').trim() : '';
    const barcode = barcodeIndex >= 0 ? String(row[barcodeIndex] || '').trim() : '';
    return Boolean(name || sku || barcode);
  }).length;

  return {
    headerCount: headers.length,
    dataRows: dataRows.length,
    importableRows
  };
};


const normalizeWorkerHeader = (value = '') => String(value || '').trim();

const normalizeWorkerCell = (value = '') => String(value || '').trim();

const findWorkerHeaderIndex = (headers = [], candidates = []) => {
  const normalizedCandidates = candidates.map((candidate) => String(candidate || '').trim().toLowerCase());
  return headers.findIndex((header) => normalizedCandidates.includes(String(header || '').trim().toLowerCase()));
};

// クライアントUIの項目ID(fieldKey)と、ワーカーのindexキーの差異を吸収する別名。
const WORKER_INDEX_KEY_ALIASES = {
  priceTaxExcluded: ['priceTaxExcluded', 'price'],
  price: ['price', 'priceTaxExcluded'],
  inventoryQuantity: ['inventoryQuantity', 'stock'],
  stock: ['stock', 'inventoryQuantity']
};

// 手動の列マッピング(columnMapping=[{columnIndex, fieldKey}])が指定された場合、
// 自動判定(indexes)を破棄し、手動指定を正として indexes を再構築する(=手動マッピング優先)。
// 手動指定の無いフィールドは -1(未取込)。自動判定はそのまま、columnMapping 未指定時のみ使われる。
const applyManualColumnMappingToIndexes = (indexes = {}, manualColumnMapping = null) => {
  if (!Array.isArray(manualColumnMapping) || manualColumnMapping.length === 0) return indexes;

  const indexKeys = new Set(Object.keys(indexes));
  const next = {};
  indexKeys.forEach((key) => { next[key] = -1; });

  manualColumnMapping.forEach((entry) => {
    const fieldKey = String(entry?.fieldKey || '').trim();
    const columnIndex = Number(entry?.columnIndex);
    if (!fieldKey || !Number.isInteger(columnIndex) || columnIndex < 0) return;

    let targetKey = null;
    if (indexKeys.has(fieldKey)) {
      targetKey = fieldKey;
    } else {
      const aliases = WORKER_INDEX_KEY_ALIASES[fieldKey] || [];
      targetKey = aliases.find((alias) => indexKeys.has(alias)) || null;
    }
    if (targetKey) next[targetKey] = columnIndex;
  });

  return next;
};

const getWorkerCell = (row = [], index = -1) => {
  if (index < 0) return '';
  return normalizeWorkerCell(row[index]);
};



const calculateWorkerTaxIncludedPrice = (priceTaxExcluded, taxRate = 10) => {
  const excluded = Number(priceTaxExcluded);
  if (!Number.isFinite(excluded)) return null;

  const rate = Number(taxRate);
  const normalizedRate = Number.isFinite(rate) ? Math.max(rate, 0) : 10;

  return Math.floor(excluded * (100 + normalizedRate) / 100);
};

const normalizeWorkerTaxRateType = (value) => (
  ['inherit', 'standard', 'reduced', 'taxFree'].includes(value) ? value : ''
);

// そのマスター(売場/グループ/カテゴリー)が「自前で持つ税率」を返す。
// 'inherit'(親/既定を継承) や、型も明示税率も無い場合は null を返し、上位/既定へフォールバックさせる。
// ※ 'inherit' の場合に保存されている taxRate:0 は継承プレースホルダなので採用しない(これが0%バグの原因だった)。
const resolveWorkerMasterOwnTaxRate = (item = {}) => {
  const taxRateType = normalizeWorkerTaxRateType(item?.taxRateType);

  if (taxRateType === 'standard') return 10;
  if (taxRateType === 'reduced') return 8;
  if (taxRateType === 'taxFree') return 0;
  if (taxRateType === 'inherit') return null;

  // 型未設定: 明示税率があればそれを採用(0も明示値として有効)。
  const explicitTaxRate = toWorkerNumberOrNull(item?.taxRate);
  if (explicitTaxRate !== null && explicitTaxRate !== undefined) return explicitTaxRate;

  return null;
};

const findWorkerMasterById = (items = [], id = '') => {
  const key = String(id || '').trim();
  if (!key) return null;
  return (items || []).find((item) => String(item?.id || '').trim() === key) || null;
};

const findWorkerMasterByName = (items = [], name = '') => {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return (items || []).find((item) => String(item?.name || item?.categoryName || item?.groupName || '').trim().toLowerCase() === key) || null;
};

const resolveWorkerProductTaxRate = ({
  product = {},
  productCategoryGroups = [],
  productCategories = [],
  productSubCategories = [],
  defaultTaxRate = 10
} = {}) => {
  if (product.taxRate !== null && product.taxRate !== undefined) return product.taxRate;

  const matchedSubCategory = findWorkerMasterById(productSubCategories, product.subCategoryId)
    || findWorkerMasterByName(productSubCategories, product.subCategoryName);

  const matchedCategory = findWorkerMasterById(productCategories, product.categoryId)
    || findWorkerMasterByName(productCategories, product.categoryName);

  const matchedGroup = findWorkerMasterById(productCategoryGroups, product.categoryGroupId)
    || findWorkerMasterByName(productCategoryGroups, product.categoryGroupName)
    || findWorkerMasterById(productCategoryGroups, matchedCategory?.groupId || matchedCategory?.categoryGroupId)
    || findWorkerMasterByName(productCategoryGroups, matchedCategory?.groupName || matchedCategory?.categoryGroupName);

  // サブカテゴリー→カテゴリー→グループ の順に「自前の税率」を探し、最初に見つかったものを採用。
  // 'inherit'(継承)の階層はスキップして上位へ。どこにも無ければ店舗既定。
  for (const matched of [matchedSubCategory, matchedCategory, matchedGroup]) {
    if (!matched) continue;
    const ownTaxRate = resolveWorkerMasterOwnTaxRate(matched);
    if (ownTaxRate !== null && ownTaxRate !== undefined) return ownTaxRate;
  }

  return Number(defaultTaxRate) === 8 ? 8 : 10;
};

const buildProductCsvFunctionPreviewForWorker = (rows = [], manualColumnMapping = null) => {
  const headers = Array.isArray(rows?.[0])
    ? rows[0].map(normalizeWorkerHeader)
    : [];

  const dataRows = Array.isArray(rows) && rows.length > 1 ? rows.slice(1) : [];

  let indexes = {
    sku: findWorkerHeaderIndex(headers, ['sku', '品番', 'productCode', '商品コード']),
    barcode: findWorkerHeaderIndex(headers, ['barcode', 'バーコード', 'jan', 'JAN']),
    name: findWorkerHeaderIndex(headers, ['name', '商品名', 'productName']),
    categoryGroup: findWorkerHeaderIndex(headers, ['categoryGroup', 'categoryGroupName', 'カテゴリグループ', 'カテゴリーグループ']),
    category: findWorkerHeaderIndex(headers, ['category', 'categoryName', 'カテゴリ', 'カテゴリー']),
    subCategory: findWorkerHeaderIndex(headers, ['subCategory', 'subCategoryName', 'サブカテゴリ', 'サブカテゴリー']),
    brand: findWorkerHeaderIndex(headers, ['brand', 'brandName', 'ブランド']),
    supplier: findWorkerHeaderIndex(headers, ['supplier', 'supplierName', '仕入先']),
    price: findWorkerHeaderIndex(headers, ['price', 'sellPrice', 'sellingPrice', '売価', '販売価格', 'Variant Price']),
    stock: findWorkerHeaderIndex(headers, ['stock', 'stockQty', 'quantity', 'inventoryQuantity', '在庫', '在庫数'])
  };
  indexes = applyManualColumnMappingToIndexes(indexes, manualColumnMapping);

  const warnings = [];
  const groupKeys = new Set();
  const brandNames = new Set();
  const supplierNames = new Set();
  const sampleProducts = [];

  let importableRows = 0;
  let skippedRows = 0;

  dataRows.forEach((row, rowIndex) => {
    const lineNumber = rowIndex + 2;
    const sku = getWorkerCell(row, indexes.sku);
    const barcode = getWorkerCell(row, indexes.barcode);
    const name = getWorkerCell(row, indexes.name);
    const categoryGroup = getWorkerCell(row, indexes.categoryGroup);
    const category = getWorkerCell(row, indexes.category);
    const subCategory = getWorkerCell(row, indexes.subCategory);
    const brand = getWorkerCell(row, indexes.brand);
    const supplier = getWorkerCell(row, indexes.supplier);
    const price = getWorkerCell(row, indexes.price);
    const stock = getWorkerCell(row, indexes.stock);

    const isImportable = Boolean(name || sku || barcode);

    if (!isImportable) {
      skippedRows += 1;
      warnings.push({
        lineNumber,
        type: 'emptyProductIdentity',
        message: '商品名・品番・バーコードが空のためスキップ候補です。'
      });
      return;
    }

    importableRows += 1;

    const groupKey = [categoryGroup, category, subCategory].filter(Boolean).join(' / ');
    if (groupKey) groupKeys.add(groupKey);
    if (brand) brandNames.add(brand);
    if (supplier) supplierNames.add(supplier);

    if (!name) {
      warnings.push({
        lineNumber,
        type: 'missingName',
        message: '商品名が空です。'
      });
    }

    if (sampleProducts.length < 20) {
      sampleProducts.push({
        lineNumber,
        sku,
        barcode,
        name,
        categoryGroup,
        category,
        subCategory,
        brand,
        supplier,
        price,
        stock
      });
    }
  });

  return {
    headerCount: headers.length,
    dataRows: dataRows.length,
    importableRows,
    skippedRows,
    groupCandidateCount: groupKeys.size,
    brandCandidateCount: brandNames.size,
    supplierCandidateCount: supplierNames.size,
    warningCount: warnings.length,
    headers,
    mappedIndexes: indexes,
    sampleProducts,
    warnings: warnings.slice(0, 50)
  };
};



const toWorkerNumberOrNull = (value) => {
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (normalized === '') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const buildWorkerGroupKey = ({
  productGroupId,
  productGroupName,
  name
}) => {
  if (productGroupId) return `id:${productGroupId}`;
  if (productGroupName) return `name:${productGroupName}`;
  // 明示的なグループ指定が無い場合は「商品名」でグループ化する。
  // (=同じ商品名のものだけが同一グループ。商品名が違えば別グループ=実質単独)
  const normalizedName = String(name || '').trim().toLowerCase();
  if (normalizedName) return `pname:${normalizedName}`;
  return '';
};

const buildWorkerProductKey = ({
  productCode,
  sku,
  barcode,
  name,
  size,
  colorName
}) => {
  if (barcode) return `barcode:${barcode}`;
  if (productCode) return `productCode:${productCode}`;
  if (sku) return `sku:${sku}`;
  return ['name', name, size, colorName]
    .map((value) => String(value || '').trim())
    .join('|');
};

const buildProductCsvFunctionWritePlanForWorker = (rows = [], manualColumnMapping = null) => {
  const headers = Array.isArray(rows?.[0])
    ? rows[0].map(normalizeWorkerHeader)
    : [];
  const dataRows = Array.isArray(rows) && rows.length > 1 ? rows.slice(1) : [];

  let indexes = {
    productGroupId: findWorkerHeaderIndex(headers, ['productGroupId', '商品グループID', 'グループID']),
    productGroupRole: findWorkerHeaderIndex(headers, ['productGroupRole', 'グループ役割']),
    productGroupName: findWorkerHeaderIndex(headers, ['productGroupName', '商品グループ名', 'グループ名']),
    name: findWorkerHeaderIndex(headers, ['name', '商品名', 'productName']),
    sku: findWorkerHeaderIndex(headers, ['sku', '品番', 'productCode', '商品コード']),
    productCode: findWorkerHeaderIndex(headers, ['productCode', '商品コード']),
    barcode: findWorkerHeaderIndex(headers, ['barcode', 'バーコード', 'jan', 'JAN']),
    brand: findWorkerHeaderIndex(headers, ['brand', 'brandName', 'ブランド']),
    categoryGroupId: findWorkerHeaderIndex(headers, ['categoryGroupId', 'カテゴリーグループID']),
    categoryGroup: findWorkerHeaderIndex(headers, ['categoryGroup', 'categoryGroupName', 'カテゴリグループ', 'カテゴリーグループ']),
    categoryId: findWorkerHeaderIndex(headers, ['categoryId', 'カテゴリーID']),
    category: findWorkerHeaderIndex(headers, ['category', 'categoryName', 'カテゴリ', 'カテゴリー']),
    subCategoryId: findWorkerHeaderIndex(headers, ['subCategoryId', 'サブカテゴリーID']),
    subCategory: findWorkerHeaderIndex(headers, ['subCategory', 'subCategoryName', 'サブカテゴリ', 'サブカテゴリー']),
    salesAreaId: findWorkerHeaderIndex(headers, ['salesAreaId', '売場ID', '販売エリアID']),
    salesAreaName: findWorkerHeaderIndex(headers, ['salesAreaName', 'salesArea', '売場', '販売エリア']),
    size: findWorkerHeaderIndex(headers, ['size', 'サイズ']),
    colorName: findWorkerHeaderIndex(headers, ['colorName', 'color', 'カラー', '色']),
    priceTaxExcluded: findWorkerHeaderIndex(headers, ['priceTaxExcluded', '税抜価格', '税抜売価']),
    priceTaxIncluded: -1,
    taxRate: findWorkerHeaderIndex(headers, ['taxRate', '税率']),
    inventoryQuantity: findWorkerHeaderIndex(headers, ['inventoryQuantity', 'stock', 'stockQty', 'quantity', '在庫', '在庫数']),
    shopifyCreateEnabled: findWorkerHeaderIndex(headers, ['shopifyCreateEnabled', 'Shopify作成']),
    shopifyProductId: findWorkerHeaderIndex(headers, ['shopifyProductId']),
    shopifyVariantId: findWorkerHeaderIndex(headers, ['shopifyVariantId']),
    shopifyInventoryItemId: findWorkerHeaderIndex(headers, ['shopifyInventoryItemId'])
  };
  indexes = applyManualColumnMappingToIndexes(indexes, manualColumnMapping);

  const groupMap = new Map();
  const productCandidates = [];
  const warnings = [];

  dataRows.forEach((row, rowIndex) => {
    const lineNumber = rowIndex + 2;

    const productGroupId = getWorkerCell(row, indexes.productGroupId);
    const productGroupRole = getWorkerCell(row, indexes.productGroupRole);
    const productGroupName = getWorkerCell(row, indexes.productGroupName);
    const name = getWorkerCell(row, indexes.name);
    const sku = getWorkerCell(row, indexes.sku);
    const productCode = getWorkerCell(row, indexes.productCode);
    const barcode = getWorkerCell(row, indexes.barcode);
    const brand = getWorkerCell(row, indexes.brand);
    const categoryGroupId = getWorkerCell(row, indexes.categoryGroupId);
    const categoryGroup = getWorkerCell(row, indexes.categoryGroup);
    const categoryId = getWorkerCell(row, indexes.categoryId);
    const category = getWorkerCell(row, indexes.category);
    const subCategoryId = getWorkerCell(row, indexes.subCategoryId);
    const subCategory = getWorkerCell(row, indexes.subCategory);
    const salesAreaId = getWorkerCell(row, indexes.salesAreaId);
    const salesAreaName = getWorkerCell(row, indexes.salesAreaName);
    const size = getWorkerCell(row, indexes.size);
    const colorName = getWorkerCell(row, indexes.colorName);
    const genericPriceRaw = getWorkerCell(row, indexes.price);
    const priceTaxExcludedRaw = getWorkerCell(row, indexes.priceTaxExcluded) || genericPriceRaw;
    const priceTaxIncludedRaw = '';
    const taxRateRaw = getWorkerCell(row, indexes.taxRate);
    const inventoryQuantityRaw = getWorkerCell(row, indexes.inventoryQuantity);
    const shopifyCreateEnabled = getWorkerCell(row, indexes.shopifyCreateEnabled);
    const shopifyProductId = getWorkerCell(row, indexes.shopifyProductId);
    const shopifyVariantId = getWorkerCell(row, indexes.shopifyVariantId);
    const shopifyInventoryItemId = getWorkerCell(row, indexes.shopifyInventoryItemId);

    const isImportable = Boolean(name || sku || barcode || productCode);
    if (!isImportable) {
      warnings.push({
        lineNumber,
        type: 'emptyProductIdentity',
        message: '商品名・品番・バーコード・商品コードが空のため保存対象外です。'
      });
      return;
    }

    const groupKey = buildWorkerGroupKey({
      productGroupId,
      productGroupName,
      name
    });

    if (groupKey && !groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        key: groupKey,
        sourceProductGroupId: productGroupId || '',
        role: productGroupRole || '',
        name: productGroupName || name || '',
        categoryGroupId: categoryGroupId || '',
        categoryGroupName: categoryGroup || '',
        categoryId: categoryId || '',
        categoryName: category || '',
        subCategoryId: subCategoryId || '',
        subCategoryName: subCategory || '',
        salesAreaId: salesAreaId || '',
        salesAreaName: salesAreaName || '',
        brandName: brand || '',
        productCount: 0,
        sampleLineNumbers: []
      });
    }

    const group = groupMap.get(groupKey);
    if (group) {
      group.productCount += 1;
      if (group.sampleLineNumbers.length < 5) {
        group.sampleLineNumbers.push(lineNumber);
      }
    }

    const priceTaxIncluded = null;
    const priceTaxExcluded = toWorkerNumberOrNull(priceTaxExcludedRaw);
    const taxRate = toWorkerNumberOrNull(taxRateRaw);
    const inventoryQuantity = toWorkerNumberOrNull(inventoryQuantityRaw);

    productCandidates.push({
      key: buildWorkerProductKey({
        productCode,
        sku,
        barcode,
        name,
        size,
        colorName
      }),
      lineNumber,
      groupKey,
      sourceProductGroupId: productGroupId || '',
      productGroupName: productGroupName || '',
      productGroupRole: productGroupRole || '',
      name,
      sku,
      productCode,
      barcode,
      brandName: brand || '',
      categoryGroupId: categoryGroupId || '',
      categoryGroupName: categoryGroup || '',
      categoryId: categoryId || '',
      categoryName: category || '',
      subCategoryId: subCategoryId || '',
      subCategoryName: subCategory || '',
      salesAreaId: salesAreaId || '',
      salesAreaName: salesAreaName || '',
      size,
      colorName,
      priceTaxExcluded,
      priceTaxIncluded,
      taxRate,
      inventoryQuantity,
      shopifyCreateEnabled,
      shopifyProductId,
      shopifyVariantId,
      shopifyInventoryItemId
    });
  });

  const groupCandidates = Array.from(groupMap.values());

  const duplicateProductKeys = productCandidates
    .map((product) => product.key)
    .filter(Boolean)
    .filter((key, index, array) => array.indexOf(key) !== index);

  duplicateProductKeys.slice(0, 20).forEach((key) => {
    warnings.push({
      type: 'duplicateProductKey',
      key,
      message: 'CSV内で同じ商品キーが重複しています。保存前に確認してください。'
    });
  });

  return {
    mode: 'dryRun',
    groupCandidateCount: groupCandidates.length,
    productCandidateCount: productCandidates.length,
    barcodePrimaryKey: true,
    warningCount: warnings.length,
    mappedIndexes: indexes,
    groupCandidates,
    productCandidates,
    warnings
  };
};




const buildProductCsvFunctionWritePlanForJob = (writePlan = {}) => ({
  mode: writePlan.mode || 'dryRun',
  groupCandidateCount: Number(writePlan.groupCandidateCount || 0),
  productCandidateCount: Number(writePlan.productCandidateCount || 0),
  barcodePrimaryKey: writePlan.barcodePrimaryKey === true,
  warningCount: Number(writePlan.warningCount || 0),
  mappedIndexes: writePlan.mappedIndexes || {},
  groupCandidates: Array.isArray(writePlan.groupCandidates) ? writePlan.groupCandidates.slice(0, 50) : [],
  productCandidates: Array.isArray(writePlan.productCandidates) ? writePlan.productCandidates.slice(0, 50) : [],
  sampleGroups: Array.isArray(writePlan.groupCandidates) ? writePlan.groupCandidates.slice(0, 10) : [],
  sampleProducts: Array.isArray(writePlan.productCandidates) ? writePlan.productCandidates.slice(0, 20) : [],
  warnings: Array.isArray(writePlan.warnings) ? writePlan.warnings.slice(0, 50) : []
});


const normalizeWorkerBoolean = (value, fallback = false) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '') return fallback;
  return ['true', '1', 'yes', 'y', 'on', 'する', 'はい'].includes(normalized);
};

const buildWorkerSearchKeywords = (values = []) => {
  const tokens = new Set();
  values
    .flatMap((value) => String(value ?? '').split(/[\s　,、/／|｜\-ー_]+/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .forEach((value) => {
      tokens.add(value);
      if (/^[a-z0-9]+$/i.test(value)) tokens.add(value.toUpperCase());
    });
  return Array.from(tokens).slice(0, 80);
};

const chunkWorkerArray = (items = [], size = 10) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const collectExistingProductRefsForWorker = async ({ db, storeId, products = [] }) => {
  const productsRef = db.collection('stores').doc(storeId).collection('products');
  const keyMap = new Map();
  // 既存商品の中で同じ値が複数docに存在する照合キーは「曖昧」として無効化する。
  // sku / productCode はブランド名などで非ユニークになりがちで、これらで照合すると
  // barcodeが別の新規商品でも既存docに当たって上書き＝データ消失する事故が起きるため。
  const ambiguousKeys = new Set();

  const collectByField = async (fieldName) => {
    const values = Array.from(new Set(
      products
        .map((product) => String(product[fieldName] || '').trim())
        .filter(Boolean)
    ));

    for (const valuesChunk of chunkWorkerArray(values, 10)) {
      const snapshot = await productsRef.where(fieldName, 'in', valuesChunk).get();
      snapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        const value = String(data[fieldName] || '').trim();
        if (!value) return;
        const key = `${fieldName}:${value}`;
        if (ambiguousKeys.has(key)) return;
        if (keyMap.has(key)) {
          // 同一値が2件以上の既存docに該当 → 曖昧キーとして照合対象から除外（新規作成扱い）。
          keyMap.delete(key);
          ambiguousKeys.add(key);
          return;
        }
        keyMap.set(key, doc.ref);
      });
    }
  };

  await collectByField('productCode');
  await collectByField('sku');
  await collectByField('barcode');

  return keyMap;
};

const getExistingProductRefForWorker = ({ existingProductRefs, product }) => {
  const productCode = String(product.productCode || '').trim();
  const sku = String(product.sku || '').trim();
  const barcode = String(product.barcode || '').trim();

  return existingProductRefs.get(`barcode:${barcode}`)
    || existingProductRefs.get(`productCode:${productCode}`)
    || existingProductRefs.get(`sku:${sku}`)
    || null;
};

const executeProductCsvFunctionWritesForWorker = async ({
  db,
  storeId,
  jobId,
  writePlan,
  productCategoryGroups = [],
  productCategories = [],
  productSubCategories = [],
  defaultTaxRate = 10
}) => {
  const storeRef = db.collection('stores').doc(storeId);
  const groupCandidates = Array.isArray(writePlan?.groupCandidates) ? writePlan.groupCandidates : [];
  const productCandidates = Array.isArray(writePlan?.productCandidates) ? writePlan.productCandidates : [];

  const groupIdByKey = new Map();
  const existingProductRefs = await collectExistingProductRefsForWorker({
    db,
    storeId,
    products: productCandidates
  });

  let savedGroupCount = 0;
  let savedProductCount = 0;
  let batch = db.batch();
  let operationCount = 0;

  const commitIfNeeded = async (force = false) => {
    if (operationCount === 0) return;
    if (!force && operationCount < 400) return;
    await batch.commit();
    batch = db.batch();
    operationCount = 0;
  };

  for (const group of groupCandidates) {
    const preferredId = String(group.sourceProductGroupId || '').trim();

    // 同じ商品名が2件以上ある場合だけグループを作る。単独(1件)はグループにしない。
    // ただしCSVで明示的に商品グループIDが指定されている場合はその意思を尊重する。
    if (Number(group.productCount || 0) < 2 && !preferredId) {
      continue;
    }

    const groupRef = preferredId
      ? storeRef.collection('productGroups').doc(preferredId)
      : storeRef.collection('productGroups').doc();

    groupIdByKey.set(group.key, groupRef.id);

    const groupData = {
      id: groupRef.id,
      name: group.name || '',
      productGroupName: group.productGroupName || group.name || '',
      groupCode: group.groupCode || '',
      categoryGroupId: group.categoryGroupId || '',
      categoryGroupName: group.categoryGroupName || '',
      categoryId: group.categoryId || '',
      categoryName: group.categoryName || '',
      subCategoryId: group.subCategoryId || '',
      subCategoryName: group.subCategoryName || '',
      salesAreaId: group.salesAreaId || '',
      salesAreaName: group.salesAreaName || '',
      brandName: group.brandName || '',
      productCount: Number(group.productCount || 0),
      shopifyEnabled: false,
      shopifyProductId: '',
      importJobId: jobId,
      updatedAt: FieldValue.serverTimestamp()
    };

    batch.set(groupRef, groupData, { merge: true });
    operationCount += 1;
    savedGroupCount += 1;
    await commitIfNeeded();
  }

  const assignedPrimaryGroupIds = new Set();

  for (const product of productCandidates) {
    const existingRef = getExistingProductRefForWorker({
      existingProductRefs,
      product
    });

    const productRef = existingRef || storeRef.collection('products').doc();
    // 単独商品(同名が無い)は groupIdByKey に無いので productGroupId='' = 非グループになる。
    const productGroupId = groupIdByKey.get(product.groupKey)
      || product.sourceProductGroupId
      || '';

    // グループ内は先頭をprimary・以降をvariantに。単独商品は従来どおりprimary(=非グループ)。
    let resolvedProductGroupRole;
    if (productGroupId) {
      if (assignedPrimaryGroupIds.has(productGroupId)) {
        resolvedProductGroupRole = product.productGroupRole || 'variant';
      } else {
        resolvedProductGroupRole = product.productGroupRole || 'primary';
        assignedPrimaryGroupIds.add(productGroupId);
      }
    } else {
      resolvedProductGroupRole = product.productGroupRole || 'primary';
    }

    const searchKeywords = buildWorkerSearchKeywords([
      product.name,
      product.sku,
      product.productCode,
      product.barcode,
      product.brandName,
      product.categoryGroupName,
      product.categoryName,
      product.subCategoryName,
      product.salesAreaName,
      product.size,
      product.colorName
    ]);

    const resolvedTaxRate = resolveWorkerProductTaxRate({
      product,
      productCategoryGroups,
      productCategories,
      productSubCategories,
      defaultTaxRate
    });
    const resolvedPriceTaxIncluded = calculateWorkerTaxIncludedPrice(
      product.priceTaxExcluded ?? 0,
      resolvedTaxRate
    );

    const productData = {
      name: product.name || '',
      sku: product.sku || '',
      productCode: product.productCode || product.sku || '',
      barcode: product.barcode || '',
      brandId: '',
      brandName: product.brandName || '',
      supplierId: '',
      supplierName: '',
      categoryGroupId: product.categoryGroupId || '',
      categoryGroupName: product.categoryGroupName || '',
      categoryId: product.categoryId || '',
      categoryName: product.categoryName || '',
      subCategoryId: product.subCategoryId || '',
      subCategoryName: product.subCategoryName || '',
      salesAreaId: product.salesAreaId || '',
      salesAreaName: product.salesAreaName || '',
      departmentId: '',
      groupCode: product.groupCode || '',
      productGroupId,
      productGroupName: product.productGroupName || '',
      productGroupRole: resolvedProductGroupRole,
      productType: '',
      size: product.size || '',
      colorName: product.colorName || '',
      priceTaxExcluded: product.priceTaxExcluded ?? 0,
      priceTaxIncluded: resolvedPriceTaxIncluded,
      taxRate: resolvedTaxRate,
      taxRateType: '',
      inventoryQuantity: product.inventoryQuantity ?? 0,
      costTaxIncluded: null,
      costTaxExcluded: null,
      supplierCostRate: null,
      orderLot: null,
      reorderLot: null,
      reorderPoint: null,
      reorderQuantity: null,
      note: '',
      labelEnabled: false,
      isActive: true,
      isArchived: false,
      shopifyCreateEnabled: normalizeWorkerBoolean(product.shopifyCreateEnabled, false),
      shopifyProductId: product.shopifyProductId || '',
      shopifyVariantId: product.shopifyVariantId || '',
      shopifyInventoryItemId: product.shopifyInventoryItemId || '',
      searchKeywords,
      searchKeywordsVersion: 1,
      searchKeywordsUpdatedAt: FieldValue.serverTimestamp(),
      importJobId: jobId,
      updatedAt: FieldValue.serverTimestamp()
    };

    batch.set(productRef, productData, { merge: true });
    operationCount += 1;
    savedProductCount += 1;
    await commitIfNeeded();
  }

  await commitIfNeeded(true);

  return {
    savedGroupCount,
    savedProductCount,
    productCandidateCount: productCandidates.length,
    groupCandidateCount: groupCandidates.length
  };
};


export const processProductCsvImportJob = onDocumentWritten(
  {
    region: REGION,
    database: FIRESTORE_DATABASE_ID,
    document: 'stores/{storeId}/importJobs/{jobId}',
    timeoutSeconds: 540,
    memory: '1GiB'
  },
  async (event) => {
    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;

    if (!after) return;

    const { storeId, jobId } = event.params || {};

    if (after.type !== 'productCsvImport') return;
    if (after.processingMode !== 'function') return;
    if (after.status !== 'queued') return;

    if (before && before.status === after.status && before.processingMode === after.processingMode) {
      return;
    }

    const storagePath = String(after.storagePath || '').trim();
    const jobRef = getFirestore(FIRESTORE_DATABASE_ID)
      .collection('stores')
      .doc(storeId)
      .collection('importJobs')
      .doc(jobId);

    if (!storagePath) {
      await jobRef.set({
        status: 'failed',
        phase: 'failed',
        errorMessage: 'storagePath is required for function processing.',
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    try {
      await jobRef.set({
        status: 'running',
        phase: 'readingStorageCsv',
        workerStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      const storeRef = getFirestore(FIRESTORE_DATABASE_ID).collection('stores').doc(storeId);
      const [
        taxPriceSettingsDoc,
        categoryGroupSnapshot,
        categorySnapshot,
        subCategorySnapshot
      ] = await Promise.all([
        storeRef.collection('settings').doc('taxPrice').get(),
        storeRef.collection('productCategoryGroups').get(),
        storeRef.collection('productCategories').get(),
        storeRef.collection('productSubCategories').get()
      ]);

      const taxPriceSettings = taxPriceSettingsDoc.exists ? taxPriceSettingsDoc.data() : {};
      const defaultTaxRate = Number(taxPriceSettings.defaultTaxRate) === 8 ? 8 : 10;
      const productCategoryGroups = categoryGroupSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const productCategories = categorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const productSubCategories = subCategorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const [buffer] = await getStorage().bucket().file(storagePath).download();
      const csvText = buffer.toString('utf8');
      const rows = parseProductCsvTextForWorker(csvText);
      // 手動の列マッピング(あれば優先)。無ければ各ビルダーが従来の自動判定を使う。
      const manualColumnMapping = Array.isArray(after.columnMapping) ? after.columnMapping : null;
      const summary = countMappedProductCsvRowsForWorker(rows);
      const functionPreview = buildProductCsvFunctionPreviewForWorker(rows, manualColumnMapping);
      const functionWritePlan = buildProductCsvFunctionWritePlanForWorker(rows, manualColumnMapping);

      if (after.executeProductWrites === true) {
        await jobRef.set({
          phase: 'savingProducts',
          functionReadOnly: false,
          functionWritePlanOnly: false,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        const saveSummary = await executeProductCsvFunctionWritesForWorker({
          db: getFirestore(FIRESTORE_DATABASE_ID),
          storeId,
          jobId,
          writePlan: functionWritePlan,
          productCategoryGroups,
          productCategories,
          productSubCategories,
          defaultTaxRate
        });

        await jobRef.set({
          status: 'completed',
          phase: 'functionSaveCompleted',
          workerCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          functionReadOnly: false,
          functionWritePlanOnly: false,
          functionSaved: true,
          csvHeaderCount: summary.headerCount,
          csvDataRows: summary.dataRows,
          csvImportableRows: summary.importableRows,
          csvBytes: buffer.length,
          functionPreview,
          functionWritePlan: buildProductCsvFunctionWritePlanForJob(functionWritePlan),
          functionSaveSummary: saveSummary
        }, { merge: true });
        return;
      }

      await jobRef.set({
        status: 'completed',
        phase: 'functionWritePlanCompleted',
        workerCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        functionReadOnly: true,
        functionWritePlanOnly: true,
        csvHeaderCount: summary.headerCount,
        csvDataRows: summary.dataRows,
        csvImportableRows: summary.importableRows,
        csvBytes: buffer.length,
        functionPreview,
        functionWritePlan: buildProductCsvFunctionWritePlanForJob(functionWritePlan)
      }, { merge: true });
    } catch (error) {
      console.error('[processProductCsvImportJob] failed', {
        storeId,
        jobId,
        storagePath,
        message: error?.message
      });

      await jobRef.set({
        status: 'failed',
        phase: 'failed',
        errorMessage: error?.message || String(error),
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
  }
);

// ============================================================================
// 下げ札(値札タグ)のAI読み取り — SaaSオプション機能
// 画像を受け取り Claude(Haiku 4.5) で商品情報を構造化抽出して返す。
// APIキーは運営者1本をシークレット管理。テナント(store)ごとに会員判定＋オプション
// 判定＋月間上限＋使用量メータリングを行う(マルチテナント課金/暴走防止の土台)。
// ============================================================================
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const HANG_TAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brand: { type: ['string', 'null'] },
    productName: { type: ['string', 'null'] },
    productCode: { type: ['string', 'null'] },
    colorName: { type: ['string', 'null'] },
    colorCode: { type: ['string', 'null'] },
    size: { type: ['string', 'null'] },
    material: { type: ['string', 'null'] },
    priceTaxExcluded: { type: ['number', 'null'] },
    priceTaxIncluded: { type: ['number', 'null'] },
    barcode: { type: ['string', 'null'] },
    countryOfOrigin: { type: ['string', 'null'] },
    maker: { type: ['string', 'null'] }
  },
  required: [
    'brand', 'productName', 'productCode', 'colorName', 'colorCode', 'size',
    'material', 'priceTaxExcluded', 'priceTaxIncluded', 'barcode', 'countryOfOrigin', 'maker'
  ]
};

const HANG_TAG_PROMPT = `あなたはアパレル/バッグ/雑貨の下げ札(値札タグ)から商品情報を抽出するアシスタントです。
画像の下げ札を読み取り、指定のJSONスキーマで返してください。

厳守ルール:
- タグに実際に印字/記載されている情報だけを抽出する。書かれていない・読み取れない項目は必ず null。推測や補完で埋めない。
- 画像は複数枚のことがある(値札の下げ札＋ブランドのロゴ札/縫い付けラベル等)。全ての画像を総合して1商品として抽出する。
- brand: ブランド名。ブランドのロゴ札/ラベルがあればそこから優先的に読み取る。下げ札にロゴや商品名から明確に分かる場合も可。製造元/発売元の会社名は maker に入れ、brand には入れない。
- productName: 商品名。
- productCode: 品番/型番(例「NO.578-6153251」「品番 NPW22532」)。
- colorName: 色名(例 ブラック, HERB PIGMENT)。 colorCode: カラー番号/記号(例「COL.110」→110、「K」)。
- size: サイズ表記(例 M, S, 2, Ⅱ)。付随情報(バスト等)があれば括弧で補足可。
- material: 素材/組成(例「麻100%」「COTTON 95% LINEN 5%」)。
- priceTaxExcluded / priceTaxIncluded: 税抜/税込の価格を数値(円、カンマ無し)で。片方しか印字が無ければもう片方は null(逆算しない)。
- barcode: バーコード下部の数字列を全桁読む。UPC-A(12桁)は左端と右端にも1桁ずつ、バーの外側に離れて印字される(例「1 98707 00062 8」→198707000628)。JAN/EAN-13は13桁。中央のかたまりだけでなく、必ず両端の数字も含める。読めなければ null。
- countryOfOrigin: 原産国(例「日本製」→「日本」、「MADE IN VIETNAM」→「ベトナム」)。
- maker: 製造元/発売元の会社名(例「株式会社ゴールドウイン」)。`;

export const extractHangTag = onCall(
  {
    region: REGION,
    secrets: [ANTHROPIC_API_KEY],
    memory: '512MiB',
    timeoutSeconds: 60
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'ログインが必要です。');

    const storeId = String(request.data?.storeId || '').trim();
    // 複数画像対応: images:[{data,mediaType}] を優先。旧 imageBase64 も後方互換で受ける。
    // 下げ札(値札)＋ブランドタグ(ロゴ札)を一緒に渡すと、ブランドをロゴ側から補完できる。
    const rawImages = Array.isArray(request.data?.images) && request.data.images.length
      ? request.data.images
      : (request.data?.imageBase64 ? [{ data: request.data.imageBase64, mediaType: request.data.mediaType }] : []);
    const images = rawImages
      .map((im) => ({ data: String(im?.data || ''), mediaType: String(im?.mediaType || 'image/jpeg') }))
      .filter((im) => im.data);
    if (!storeId) throw new HttpsError('invalid-argument', 'storeId が必要です。');
    if (!images.length) throw new HttpsError('invalid-argument', '画像が必要です。');
    if (images.length > 3) throw new HttpsError('invalid-argument', '画像は最大3枚までです。');
    // ~4.5MB(base64)/枚 超はリクエスト過大。クライアント側で長辺~1600pxへ縮小して送る想定。
    if (images.some((im) => im.data.length > 4_500_000)) throw new HttpsError('invalid-argument', '画像が大きすぎます。縮小して再送してください。');

    // ① 会員判定: このテナント(store)のstaff以上のみ。
    const role = await getUserRoleForStore(uid, storeId);
    if (!role) throw new HttpsError('permission-denied', 'この店舗の権限がありません。');

    // ② エンタイトルメント(オプション契約)判定: stores/{id}/settings/ai の hangTagEnabled。
    //    ※プロトタイプ中はドキュメント/フラグ未設定なら許可。本番運用では既定を false にしてプランで開放する。
    const aiSettingsSnap = await db.collection('stores').doc(storeId).collection('settings').doc('ai').get();
    const aiSettings = aiSettingsSnap.exists ? aiSettingsSnap.data() : null;
    if (aiSettings && aiSettings.hangTagEnabled === false) {
      throw new HttpsError('permission-denied', '下げ札読み取りオプションが無効です。');
    }
    const monthlyCap = Number(aiSettings?.hangTagMonthlyCap ?? 2000); // 月間上限(既定2000枚/暴走防止)

    // ③ 月間使用量チェック(Asia/Tokyo の YYYYMM 単位)。
    const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' })
      .format(new Date()).replace('-', '');
    const usageRef = db.collection('stores').doc(storeId).collection('aiUsage').doc(`hangTag_${ym}`);
    const usageSnap = await usageRef.get();
    const usedCount = usageSnap.exists ? Number(usageSnap.data().count || 0) : 0;
    if (usedCount >= monthlyCap) {
      throw new HttpsError('resource-exhausted', `今月の下げ札読み取り上限(${monthlyCap}枚)に達しました。`);
    }

    // ④ Claude(Haiku 4.5)で構造化抽出。
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    let message;
    try {
      message = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })),
            { type: 'text', text: HANG_TAG_PROMPT }
          ]
        }],
        output_config: { format: { type: 'json_schema', schema: HANG_TAG_SCHEMA } }
      });
    } catch (error) {
      console.error('[extractHangTag] anthropic error', { storeId, message: error?.message });
      throw new HttpsError('internal', '読み取りに失敗しました。時間をおいて再試行してください。');
    }

    const textBlock = (message.content || []).find((block) => block.type === 'text');
    let fields;
    try {
      fields = JSON.parse(textBlock?.text || '{}');
    } catch (_) {
      throw new HttpsError('internal', '読み取り結果の解析に失敗しました。');
    }

    // ⑤ 使用量メータリング(課金/上限管理の土台)。best-effort。
    const inputTokens = Number(message.usage?.input_tokens || 0);
    const outputTokens = Number(message.usage?.output_tokens || 0);
    // Haiku 4.5 概算: 入力$1/Mtok, 出力$5/Mtok。
    const estimatedUsd = (inputTokens / 1e6) * 1 + (outputTokens / 1e6) * 5;
    try {
      await usageRef.set({
        count: FieldValue.increment(1),
        inputTokens: FieldValue.increment(inputTokens),
        outputTokens: FieldValue.increment(outputTokens),
        estimatedUsd: FieldValue.increment(estimatedUsd),
        lastUsedByUid: uid,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('[extractHangTag] usage record failed', { storeId, message: error?.message });
    }

    return {
      fields,
      usage: { inputTokens, outputTokens, estimatedUsd: Number(estimatedUsd.toFixed(6)) }
    };
  }
);

// ============================================================================
// モバイル引き継ぎ(QR) — PCで発行したワンタイムコードをスマホで引き換えて自動ログイン。
// createRegisterHandoff: PC(manager以上)がワンタイムコードを発行(5分有効・一度きり)。
// redeemRegisterHandoff: スマホ(未ログイン)がコードを引き換え→Firebaseカスタムトークンを取得。
// ============================================================================
export const createRegisterHandoff = onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'ログインが必要です。');
    const storeId = String(request.data?.storeId || '').trim();
    if (!storeId) throw new HttpsError('invalid-argument', 'storeId が必要です。');

    const role = await getUserRoleForStore(uid, storeId);
    if (role !== USER_ROLES.OWNER && role !== USER_ROLES.MANAGER) {
      throw new HttpsError('permission-denied', '商品登録の権限がありません(manager以上)。');
    }

    const code = randomBytes(24).toString('base64url');
    const expiresAtMs = Date.now() + 5 * 60 * 1000; // 5分有効
    await db.collection('registerHandoffs').doc(code).set({
      uid,
      storeId,
      role,
      used: false,
      createdAt: FieldValue.serverTimestamp(),
      expiresAtMs
    });
    return { code, expiresAtMs };
  }
);

export const redeemRegisterHandoff = onCall(
  { region: REGION },
  async (request) => {
    // 未ログインのスマホから呼ばれる(request.auth は無い)。コード自体が短命ワンタイムの資格情報。
    const code = String(request.data?.code || '').trim();
    if (!code) throw new HttpsError('invalid-argument', 'コードが必要です。');

    const ref = db.collection('registerHandoffs').doc(code);
    const handoff = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'QRが無効です。再発行してください。');
      const data = snap.data();
      if (data.used) throw new HttpsError('failed-precondition', 'このQRは使用済みです。再発行してください。');
      if (Date.now() > Number(data.expiresAtMs || 0)) {
        throw new HttpsError('deadline-exceeded', 'QRの有効期限が切れました。再発行してください。');
      }
      tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
      return data;
    });

    const token = await adminAuth.createCustomToken(handoff.uid, {
      storeId: handoff.storeId,
      registerHandoff: true
    });
    return { token, storeId: handoff.storeId };
  }
);


// ===== 発注書メール送信 =====
// 本文は purchaseOrders doc から組み立て、仕入先マスタに登録済みの email へだけ送る
// （クライアントから任意宛先・任意本文を渡せる口にしない）。

const formatPurchaseOrderYen = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `¥${Math.round(number).toLocaleString('ja-JP')}`;
};

const buildPurchaseOrderMailHtml = ({ storeName, supplier, purchaseOrder }) => {
  const activeLines = (purchaseOrder.lines || []).filter((line) => !line.canceled);

  // ブランドごとに束ね、合計金額の多い順に並べる（画面の発注書と同じ並び）。
  const groups = new Map();
  activeLines.forEach((line) => {
    const key = String(line.brandId || '');
    if (!groups.has(key)) {
      groups.set(key, { brandName: line.brandName || 'ブランド未設定', lines: [], subtotal: 0 });
    }
    const group = groups.get(key);
    group.lines.push(line);
    group.subtotal += Number(line.amount || 0);
  });
  const brandGroups = [...groups.values()].sort((a, b) => b.subtotal - a.subtotal);
  const totalAmount = brandGroups.reduce((sum, group) => sum + group.subtotal, 0);

  const orderedAtText = purchaseOrder.orderedAt
    ? getTokyoDateKey(new Date(purchaseOrder.orderedAt))
    : getTokyoDateKey();

  const rows = brandGroups.map((group) => `
    <tr>
      <td colspan="4" style="background:#e2e8f0;font-weight:700;border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(group.brandName)}</td>
      <td style="background:#e2e8f0;font-weight:700;border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${escapeHtml(formatPurchaseOrderYen(group.subtotal))}</td>
    </tr>
    ${group.lines.map((line) => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(line.productName || '')}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(line.sku || '-')}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${escapeHtml(String(line.qty || 0))}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${line.unitPrice === null || line.unitPrice === undefined ? '-' : escapeHtml(formatPurchaseOrderYen(line.unitPrice))}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${escapeHtml(formatPurchaseOrderYen(line.amount))}</td>
      </tr>
    `).join('')}
  `).join('');

  const html = `
  <div style="font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:#0f172a;max-width:720px;margin:0 auto;">
    <h1 style="font-size:22px;letter-spacing:0.3em;text-align:center;">発注書</h1>
    <table style="width:100%;margin-bottom:16px;font-size:13px;"><tr>
      <td>
        <strong style="font-size:15px;">${escapeHtml(supplier.name || '')} 御中</strong><br/>
        ${supplier.contactName ? `ご担当: ${escapeHtml(supplier.contactName)} 様<br/>` : ''}
      </td>
      <td style="text-align:right;">
        発注日: ${escapeHtml(orderedAtText)}<br/>
        発注元: ${escapeHtml(storeName || '')}
      </td>
    </tr></table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 8px;text-align:left;">商品名</th>
          <th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 8px;text-align:left;">SKU</th>
          <th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">数量</th>
          <th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">単価(税抜定価)</th>
          <th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">金額</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:right;font-size:15px;font-weight:700;margin-top:12px;">合計（税抜定価）: ${escapeHtml(formatPurchaseOrderYen(totalAmount))}</p>
    <p style="font-size:11px;color:#64748b;">※金額は税抜定価（上代）ベースです。仕入価格は貴社との取り決め（掛け率）に基づきます。<br/>本メールは ${escapeHtml(storeName || '')} の発注システムから自動送信されています。</p>
  </div>`;

  const text = [
    `発注書 (${orderedAtText})`,
    `${supplier.name || ''} 御中`,
    `発注元: ${storeName || ''}`,
    '',
    ...brandGroups.flatMap((group) => [
      `【${group.brandName}】 ${formatPurchaseOrderYen(group.subtotal)}`,
      ...group.lines.map((line) => `  ${line.productName} x${line.qty} ${formatPurchaseOrderYen(line.amount)}`)
    ]),
    '',
    `合計（税抜定価）: ${formatPurchaseOrderYen(totalAmount)}`
  ].join('\n');

  return { html, text, totalAmount, orderedAtText };
};

export const sendPurchaseOrderEmail = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return sendAppError(res, 405, 'app/method-not-allowed');
      }

      if (!isCustomMailConfigured()) {
        return sendAppError(res, 500, 'app/custom-mail-not-configured');
      }

      const authUser = await verifyRequestUser(req);
      const { storeId, purchaseOrderId } = parseJsonBody(req);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedPoId = String(purchaseOrderId || '').trim();

      if (!normalizedStoreId || !normalizedPoId) {
        return sendJson(res, 400, {
          ok: false,
          error: { message: 'storeId / purchaseOrderId が不足しています。' }
        });
      }

      // OWNER / MANAGER / SUPER_ADMIN のみ（Firestoreルールの purchaseOrders write と同等）。
      await fetchStoreMemberForRequest({ storeId: normalizedStoreId, uid: authUser.uid });

      const storeRef = db.collection('stores').doc(normalizedStoreId);
      const poSnapshot = await storeRef.collection('purchaseOrders').doc(normalizedPoId).get();
      if (!poSnapshot.exists) {
        return sendJson(res, 404, { ok: false, error: { message: '発注書が見つかりません。' } });
      }
      const purchaseOrder = poSnapshot.data();

      if (purchaseOrder.status === 'canceled') {
        return sendJson(res, 400, { ok: false, error: { message: '取消済みの発注書は送信できません。' } });
      }

      const supplierSnapshot = purchaseOrder.supplierId
        ? await storeRef.collection('suppliers').doc(String(purchaseOrder.supplierId)).get()
        : null;
      const supplier = supplierSnapshot?.exists ? supplierSnapshot.data() : null;
      const supplierEmail = String(supplier?.email || '').trim();

      if (!supplierEmail) {
        return sendJson(res, 400, {
          ok: false,
          error: { message: '仕入先マスタにメールアドレスが登録されていません。' }
        });
      }

      const basicSnapshot = await storeRef.collection('settings').doc('basic').get();
      const storeName = basicSnapshot.exists ? String(basicSnapshot.data().name || '') : '';

      const message = buildPurchaseOrderMailHtml({
        storeName,
        supplier: { ...supplier, name: supplier?.name || purchaseOrder.supplierName || '' },
        purchaseOrder
      });

      await resendClient.emails.send({
        from: MAIL_FROM,
        to: [supplierEmail],
        subject: `【発注書】${storeName || '店舗'}より (${message.orderedAtText})`,
        html: message.html,
        text: message.text
      });

      await poSnapshot.ref.set({
        mailStatus: 'sent',
        mailTo: supplierEmail,
        mailSentAt: FieldValue.serverTimestamp(),
        mailSentBy: authUser.uid,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return sendJson(res, 200, { ok: true, to: supplierEmail });
    } catch (error) {
      console.error('sendPurchaseOrderEmail failed', error);
      const known = APP_ERROR_MESSAGES[error.message];
      return sendJson(res, known ? 401 : 500, {
        ok: false,
        error: { message: known || '発注書メールの送信に失敗しました。' }
      });
    }
  }
);

// ===== 発注候補フラグ(needsReorder)の自動維持 =====
// 発注管理画面は「在庫が発注点以下」の商品だけを where(needsReorder==true) で読む(全商品スキャン廃止)。
// 在庫を変えるすべての経路(POS販売/取消/入庫/棚卸し/CSV取込/Shopify webhook)は商品docを
// 書くため、このトリガー1本で漏れなく追従できる。inventoryサブコレクションのみを更新して
// 商品docを書かない経路を今後作らないこと。
// フラグ値が変わらない時は書かない(自身の書き込みによる再トリガー連鎖の防止)。
export const syncProductNeedsReorder = onDocumentWritten(
  {
    region: 'asia-northeast1',
    database: FIRESTORE_DATABASE_ID,
    document: 'stores/{storeId}/products/{productId}'
  },
  async (event) => {
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) {
      return;
    }

    const product = afterSnapshot.data() || {};

    // reorderPoint 未設定(null/undefined/空)は発注管理の対象外。Number(null)=0 になるため明示判定する。
    const reorderPointRaw = product.reorderPoint;
    const hasReorderPoint = reorderPointRaw !== null && reorderPointRaw !== undefined && reorderPointRaw !== ''
      && Number.isFinite(Number(reorderPointRaw));
    const inventory = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
    const needsReorder = hasReorderPoint && inventory <= Number(reorderPointRaw);

    if (product.needsReorder === needsReorder) {
      return;
    }

    await afterSnapshot.ref.update({ needsReorder });
  }
);

// --- POS Terminal (Stripe Terminal 店頭カード決済 / Core への S2S 委譲) ---
export { startCardPayment, getCardPaymentStatus, cancelCardPayment, listCardReaders, registerCardReader, simulateCardPresentation, ensureCardTerminalLocation } from "./posTerminal.js";
