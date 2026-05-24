import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';


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
  'app/platform-admin-register-failed': '管理者アカウントの登録に失敗しました。'
};

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://haus-qr-order-system.web.app';
const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const TABLE_ENTRY_REUSE_GUARD_TTL_MS = 30 * 60 * 1000;

const normalizeUserRole = (role) => {
  if (role === 'admin') return USER_ROLES.OWNER;
  if (role === USER_ROLES.OWNER || role === USER_ROLES.MANAGER || role === USER_ROLES.STAFF) {
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

    const role = await getUserRoleForStore(authUser.uid, normalizedStoreId);
    const isStoreStaff = role === USER_ROLES.OWNER || role === USER_ROLES.MANAGER || role === USER_ROLES.STAFF;

    if (!isStoreStaff && !normalizedTableToken) {
      return sendAppError(response, 400, 'app/invite-invalid', 'テーブル情報を確認してください。');
    }

    const tableRef = db.collection('stores').doc(normalizedStoreId).collection('tables').doc(normalizedTableId);
    const tableSessionRef = db.collection('stores').doc(normalizedStoreId).collection('tableSessions').doc(normalizedTableId);
    const tableEntryGuardRef = db.collection('stores').doc(normalizedStoreId).collection('tableEntryGuards').doc(normalizedTableId);
    const sessionsRef = db.collection('stores').doc(normalizedStoreId).collection('sessions');
    const platformAccessRef = db.collection('stores').doc(normalizedStoreId).collection('settings').doc('platformAccess');
    const requestedTableTokenHash = normalizedTableToken ? hashToken(normalizedTableToken) : '';

    const result = await db.runTransaction(async (transaction) => {
      const now = Date.now();
      const accessSnapshot = await transaction.get(platformAccessRef);
      if (accessSnapshot.exists && accessSnapshot.data()?.storeStatus === 'stopped') {
        return { action: 'stopped' };
      }

      const tableSnapshot = await transaction.get(tableRef);
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

      const guardSnapshot = await transaction.get(tableEntryGuardRef);
      const guardData = guardSnapshot.exists ? guardSnapshot.data() : null;
      const guardExpiresAt = guardData?.expiresAt?.toDate?.() || null;

      let activeSession = null;
      const lockSnapshot = await transaction.get(tableSessionRef);
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
        const canRestoreByParticipant = Boolean(
          requestedParticipantTokenHash
          && matchedParticipant
          && requestedTableTokenHash
          && activeSession.data.tableTokenHash === requestedTableTokenHash
        );

        transaction.set(tableSessionRef, {
          tableId: normalizedTableId,
          sessionId: activeSession.id,
          status: 'active',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        if (canRestoreByParticipant) {
          const sessionRestorePayload = {
            members: FieldValue.arrayUnion(authUser.uid),
            participantsByTokenHash: {
              ...participantRecords,
              [requestedParticipantTokenHash]: {
                ...matchedParticipant,
                currentUserId: authUser.uid
              }
            },
            updatedAt: FieldValue.serverTimestamp()
          };

          if (matchedParticipant.role === 'host') {
            sessionRestorePayload.hostUserId = authUser.uid;
          }

          transaction.set(sessionsRef.doc(activeSession.id), sessionRestorePayload, { merge: true });

          return {
            action: 'restore',
            sessionId: activeSession.id,
            tableId: normalizedTableId,
            tableDisplayName: activeSession.data.tableDisplayName || activeSession.data.tableName || tableDisplayName || '',
            tableName: activeSession.data.tableName || activeSession.data.tableDisplayName || tableDisplayName || '',
            participantToken: normalizedParticipantToken,
            participantId: matchedParticipant.participantId || ''
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
  return items.map((item) => {
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

    const orderRef = storeRef.collection('orders').doc();

    const orderItems = cart.map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || '商品'),
      quantity: Math.max(Number(item.quantity || 0), 0),
      unitPrice: Number(item.unitPrice || item.price || 0),
      category: String(item.category || item.categoryId || ''),
      categoryId: String(item.category || item.categoryId || ''),
      appliedPriceMode: item.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal',
      priceLabelText: String(item.priceLabelText || ''),
      originalPrice: item.originalPrice ?? null,
      originalPriceLabelText: String(item.originalPriceLabelText || ''),
      selectedOptions: Array.isArray(item.selectedOptions) ? item.selectedOptions : [],
      options: Array.isArray(item.selectedOptions)
        ? item.selectedOptions.map((option) => option.name).filter(Boolean)
        : [],
      serviceTiming: String(item.serviceTiming || ''),
      serviceTimingLabel: String(item.serviceTimingLabel || '')
    }));

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

      const { storeId, sessionId, transactionId } = parseJsonBody(req);

      const normalizedStoreId = String(storeId || '').trim();
      const normalizedSessionId = String(sessionId || '').trim();
      const normalizedTransactionId = String(transactionId || '').trim();

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
        .filter((order) => (
          order.data.sessionId === normalizedSessionId
          && order.data.paymentStatus === 'paid'
        ));

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
          name: transactionData.recipientName || ''
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
        receiptIssuedAt: FieldValue.serverTimestamp()
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
        externalCustomer
      } = req.body || {};

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
        quantity: Math.max(Number(item.quantity || 0), 0),
        unitPrice: Number(item.unitPrice || item.price || 0),
        category: String(item.category || item.categoryId || ''),
        categoryId: String(item.category || item.categoryId || ''),
        appliedPriceMode: item.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal',
        priceLabelText: String(item.priceLabelText || ''),
        originalPrice: item.originalPrice ?? null,
        originalPriceLabelText: String(item.originalPriceLabelText || ''),
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

        const sessionSnapshot = await transaction.get(sessionRef);
        const tableSnapshot = await transaction.get(tableRef);

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

          const hasLimitedQuantity =
            menuData.limitedQuantity !== null
            && menuData.limitedQuantity !== undefined
            && menuData.limitedQuantity !== '';

          const hasRemainingQuantity =
            menuData.remainingQuantity !== null
            && menuData.remainingQuantity !== undefined
            && menuData.remainingQuantity !== '';

          const limitedQuantity = hasLimitedQuantity
            ? Number(menuData.limitedQuantity)
            : 0;

          const currentSoldQuantity = Number(menuData.soldQuantity || 0);

          const currentRemainingQuantity = hasRemainingQuantity
            ? Number(menuData.remainingQuantity)
            : Math.max(limitedQuantity - currentSoldQuantity, 0);

          // limitedQuantity / remainingQuantity が明示されている商品だけ在庫チェックする。
          // null は「在庫制限なし」として扱う。
          if (hasLimitedQuantity || hasRemainingQuantity) {
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

          orderItems.push({
            id: cartItem.id,
            name: cartItem.name || menuData.name || '商品',
            quantity,
            unitPrice: Number(cartItem.unitPrice || menuData.price || 0),
            category: String(cartItem.category || menuData.category || ''),
            categoryId: String(cartItem.categoryId || cartItem.category || menuData.category || ''),
            appliedPriceMode: cartItem.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal',
            priceLabelText: String(cartItem.priceLabelText || ''),
            originalPrice: cartItem.originalPrice ?? null,
            originalPriceLabelText: String(cartItem.originalPriceLabelText || ''),
            options: selectedOptions.map((option) => option.name).filter(Boolean),
            serviceTiming: String(cartItem.serviceTiming || ''),
            serviceTimingLabel: String(cartItem.serviceTimingLabel || ''),
            allowsTakeout: cartItem.allowsTakeout !== false,
            allergens: cartItem.allergens || [],
            limitedQuantity: menuData.limitedQuantity ?? null
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
          ...(externalCustomer ? { externalCustomer } : {})
        });

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
