const AUTH_ERROR_MESSAGES = {
  'auth/email-already-in-use': 'そのアカウントは既に存在しています。',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/missing-email': 'メールアドレスを入力してください。',
  'auth/weak-password': 'パスワードは6文字以上で入力してください。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/invalid-action-code': '再設定リンクの有効期限が切れているか、すでに利用されています。',
  'auth/expired-action-code': '再設定リンクの有効期限が切れています。再度メールを送信してください。',
  'auth/user-disabled': 'このアカウントは現在利用できません。必要な場合はオーナーに再招待を依頼してください。',
  'auth/too-many-requests': '試行回数が多すぎます。時間をおいて再度お試しください。',
  'auth/network-request-failed': '通信に失敗しました。ネットワーク環境を確認してください。',
  'app/invite-invalid': '招待情報を確認してください。',
  'app/invite-not-found': '招待リンクが見つかりません。',
  'app/invite-unavailable': 'この招待リンクは現在利用できません。',
  'app/invite-role-invalid': '招待ロールに問題があります。オーナーへ確認してください。',
  'app/invite-mismatch': '招待情報が一致しません。リンクを開き直して再度お試しください。',
  'app/account-removed': 'このアカウントは現在利用できません。必要な場合はオーナーに再招待を依頼してください。',
  'app/account-already-registered': 'そのアカウントは既に存在しています。',
  'app/invite-register-failed': 'アカウント登録に失敗しました。',
  'app/member-not-found': '対象のメンバーが見つかりません。',
  'app/member-delete-forbidden': 'このメンバーは削除できません。',
  'app/member-delete-failed': 'メンバー削除に失敗しました。',
  'app/permission-denied': 'この操作を行う権限がありません。',
  'app/unauthenticated': 'ログイン状態を確認してください。'
};

export const createAppAuthError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const resolveErrorCode = (error) => (
  error?.details?.appCode
  || error?.customData?.details?.appCode
  || error?.code
  || error?.message
  || null
);

export const getAuthErrorMessage = (error, fallback = '処理に失敗しました。') => {
  if (!error) return fallback;

  const resolvedCode = resolveErrorCode(error);
  if (resolvedCode && AUTH_ERROR_MESSAGES[resolvedCode]) {
    return AUTH_ERROR_MESSAGES[resolvedCode];
  }

  return fallback;
};
