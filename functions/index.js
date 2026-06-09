import { initializeApp } from 'firebase-admin/app';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import Stripe from 'stripe';


initializeApp();

const REGION = 'asia-northeast1';
const db = getFirestore();
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



const markSessionHasOrders = (transaction, sessionRef) => {
  transaction.set(sessionRef, {
    hasOrders: true,
    lastActivityAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
};



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

const normalizeShopifyText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};


const normalizeShopifyTag = (value = '') => (
  normalizeShopifyText(value, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const buildMergedShopifyTags = (...tagGroups) => {
  const tagMap = new Map();

  for (const tagGroup of tagGroups) {
    const tags = Array.isArray(tagGroup) ? tagGroup : [tagGroup];

    for (const tag of tags) {
      const normalized = normalizeShopifyTag(tag);
      if (!normalized) continue;

      const key = normalized.toLocaleLowerCase();
      if (!tagMap.has(key)) {
        tagMap.set(key, normalized);
      }
    }
  }

  return Array.from(tagMap.values());
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

const buildShopifyProductSetInput = ({ group, products, locationId }) => {
  const optionName = resolveShopifyOptionName(products);
  const usedOptionValues = new Set();

  const variants = products.map((product, index) => {
    const baseOptionValue = resolveShopifyOptionValue(product, optionName);
    const optionValue = usedOptionValues.has(baseOptionValue)
      ? `${baseOptionValue} ${index + 1}`
      : baseOptionValue;
    usedOptionValues.add(optionValue);

    return {
      optionValues: [
        {
          optionName,
          name: optionValue
        }
      ],
      sku: String(product.sku || product.productCode || '').trim(),
      barcode: String(product.barcode || '').trim(),
      price: normalizeShopifyMoney(product.priceTaxIncluded ?? product.price ?? 0),
      taxable: true,
      inventoryItem: {
        tracked: true
      },
      inventoryQuantities: [
        {
          locationId,
          name: 'available',
          quantity: Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0)
        }
      ],
      metafields: [
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
      ]
    };
  });

  const optionValues = variants.map((variant) => ({ name: variant.optionValues[0].name }));
  const tags = buildMergedShopifyTags(group.categoryName, group.subCategoryName, 'akuto-sync');

  return {
    title: normalizeShopifyText(group.name, group.baseProductName || 'Akuto Product'),
    ...(normalizeShopifyText(group.brandName, '') ? { vendor: normalizeShopifyText(group.brandName, '') } : {}),
    ...(normalizeShopifyText(group.categoryGroupName || group.categoryName, '') ? { productType: normalizeShopifyText(group.categoryGroupName || group.categoryName, '') } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    status: 'DRAFT',
    productOptions: [
      {
        name: optionName,
        values: optionValues
      }
    ],
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

      if (!shopifySettings.syncEnabled) {
        throw new Error('Shopify連携がOFFです。EC連携設定を確認してください。');
      }

      const locationId = String(shopifySettings.locationId || '').trim();
      if (!locationId) {
        throw new Error('Shopify locationId が未設定です。');
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

      const invalidSku = products.find((product) => !String(product.sku || product.productCode || '').trim());
      if (invalidSku) {
        throw new Error('SKU未入力の商品があります。');
      }

      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(shopifySettings);
      const input = buildShopifyProductSetInput({
        group,
        products,
        locationId
      });

      const graphqlData = await callShopifyGraphql({
        shopDomain,
        accessToken,
        query: productSetCreateDraftMutation,
        variables: {
          input,
          synchronous: true
        }
      });

      const shopifyProduct = extractShopifyProductSetResult(graphqlData);
      const shopifyVariants = Array.isArray(shopifyProduct.variants?.nodes)
        ? shopifyProduct.variants.nodes
        : [];

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
          const variant = variantsBySku.get(sku);

          if (!variant?.id) {
            throw new Error(`Shopify variant ID を取得できませんでした: ${sku}`);
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

          savedVariants.push({
            productId: product.id,
            sku,
            shopifyVariantId: variant.id,
            shopifyInventoryItemId: inventoryItemId
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
          createdBy: authUser.uid,
          createdAt: syncedAt
        });
      });

      return sendJson(res, 200, {
        ok: true,
        status: 'created',
        productGroupId: normalizedProductGroupId,
        shopifyProductId: shopifyProduct.id,
        shopifyProductHandle: shopifyProduct.handle || '',
        title: shopifyProduct.title || input.title,
        skuCount: products.length,
        variants: savedVariants
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

const buildShopifyProductUpdateInput = ({ group, products, existingTags = [] }) => {
  const optionName = resolveShopifyOptionName(products);
  const usedOptionValues = new Set();

  const variants = products.map((product, index) => {
    const baseOptionValue = resolveShopifyOptionValue(product, optionName);
    const optionValue = usedOptionValues.has(baseOptionValue)
      ? `${baseOptionValue} ${index + 1}`
      : baseOptionValue;
    usedOptionValues.add(optionValue);

    return {
      id: String(product.shopifyVariantId || '').trim(),
      optionValues: [
        {
          optionName,
          name: optionValue
        }
      ],
      sku: String(product.sku || product.productCode || '').trim(),
      barcode: String(product.barcode || '').trim(),
      price: normalizeShopifyMoney(product.priceTaxIncluded ?? product.price ?? 0)
    };
  });

  const optionValues = variants.map((variant) => ({ name: variant.optionValues[0].name }));

  const tags = buildMergedShopifyTags(existingTags, group.categoryName, group.subCategoryName);

  return {
    id: String(group.shopifyProductId || '').trim(),
    title: normalizeShopifyText(group.name, group.baseProductName || 'Akuto Product'),
    ...(normalizeShopifyText(group.brandName, '') ? { vendor: normalizeShopifyText(group.brandName, '') } : {}),
    ...(normalizeShopifyText(group.categoryGroupName || group.categoryName, '') ? { productType: normalizeShopifyText(group.categoryGroupName || group.categoryName, '') } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    productOptions: [
      {
        name: optionName,
        position: 1,
        values: optionValues
      }
    ],
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

      const invalidSku = products.find((product) => !String(product.sku || product.productCode || '').trim());
      if (invalidSku) {
        throw new Error('SKU未入力の商品があります。');
      }

      const { shopDomain, accessToken } = await getShopifyAccessTokenFromSettings(shopifySettings);
      const existingTags = await getShopifyProductTags({
        shopDomain,
        accessToken,
        productId: group.shopifyProductId
      });
      const input = buildShopifyProductUpdateInput({
        group,
        products,
        existingTags
      });

      const graphqlData = await callShopifyGraphql({
        shopDomain,
        accessToken,
        query: productSetUpdateMutation,
        variables: {
          input,
          synchronous: true
        }
      });

      const shopifyProduct = extractShopifyProductSetResult(graphqlData);
      const shopifyVariants = Array.isArray(shopifyProduct.variants?.nodes)
        ? shopifyProduct.variants.nodes
        : [];

      const variantsById = new Map(
        shopifyVariants.map((variant) => [String(variant.id || '').trim(), variant])
      );

      const syncedAt = FieldValue.serverTimestamp();
      const savedVariants = [];

      await db.runTransaction(async (transaction) => {
        transaction.set(groupRef, {
          shopifyProductId: shopifyProduct.id,
          shopifyProductHandle: shopifyProduct.handle || group.shopifyProductHandle || '',
          shopifySyncStatus: 'updated',
          shopifyLastSyncedAt: syncedAt,
          updatedAt: syncedAt
        }, { merge: true });

        for (const product of products) {
          const variantId = String(product.shopifyVariantId || '').trim();
          const variant = variantsById.get(variantId);

          const productRef = storeRef.collection('products').doc(product.id);
          const inventoryItemId = variant?.inventoryItem?.id || product.shopifyInventoryItemId || '';

          transaction.set(productRef, {
            shopifyProductId: shopifyProduct.id,
            shopifyVariantId: variantId,
            shopifyInventoryItemId: inventoryItemId,
            shopifySyncStatus: 'updated',
            shopifyLastSyncedAt: syncedAt,
            updatedAt: syncedAt
          }, { merge: true });

          savedVariants.push({
            productId: product.id,
            sku: String(product.sku || product.productCode || '').trim(),
            shopifyVariantId: variantId,
            shopifyInventoryItemId: inventoryItemId,
            price: normalizeShopifyMoney(product.priceTaxIncluded ?? product.price ?? 0),
            barcode: String(product.barcode || '').trim()
          });
        }

        const logRef = storeRef.collection('shopifySyncLogs').doc();
        transaction.set(logRef, {
          action: products.length > 1 ? 'updateShopifyProductMultiSku' : 'updateShopifyProduct',
          status: 'success',
          productGroupId: normalizedProductGroupId,
          productIds: products.map((product) => product.id),
          shopifyProductId: shopifyProduct.id,
          shopifyProductHandle: shopifyProduct.handle || group.shopifyProductHandle || '',
          title: shopifyProduct.title || input.title,
          skuCount: products.length,
          variants: savedVariants,
          createdBy: authUser.uid,
          createdAt: syncedAt
        });
      });

      return sendJson(res, 200, {
        ok: true,
        status: 'updated',
        productGroupId: normalizedProductGroupId,
        shopifyProductId: shopifyProduct.id,
        shopifyProductHandle: shopifyProduct.handle || group.shopifyProductHandle || '',
        title: shopifyProduct.title || input.title,
        skuCount: products.length,
        variants: savedVariants
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

      const result = await db.runTransaction(async (transaction) => {
        const storeRef = db.collection('stores').doc(storeId);

        const normalizedTableId = String(tableId || '').trim();

        const sessionRef = storeRef
          .collection('sessions')
          .doc(sessionId);

        const tableRef = storeRef
          .collection('tables')
          .doc(normalizedTableId);

        const settingsRef = storeRef.collection('settings').doc('basic');

        const sessionSnapshot = await transaction.get(sessionRef);
        const tableSnapshot = await transaction.get(tableRef);
        const settingsSnapshot = await transaction.get(settingsRef);
        const storeData = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};

        if (!sessionSnapshot.exists) {
          throw new Error('セッション情報が見つかりません。');
        }

        const sessionData = sessionSnapshot.data() || {};
        const tableData = tableSnapshot.exists ? tableSnapshot.data() || {} : {};

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

        if (
          sessionData.status === 'ended' ||
          sessionData.status === 'completed' ||
          sessionData.status === 'archived' ||
          sessionData.status === 'locked' ||
          sessionData.status === 'disabled'
        ) {
          throw new Error('このセッションでは注文できません。');
        }

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

                // [createPostpayOrder] mark session hasOrders
        markSessionHasOrders(transaction, sessionRef);

return { orderId: orderRef.id };
      });

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

