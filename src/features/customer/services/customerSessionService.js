//customerSessionService.js
export const preflightCustomerEntry = async ({
  storeId,
  tableId,
  tableToken,
  participantToken
}) => {
  const response = await fetch('/api/preflightCustomerEntry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      storeId,
      tableId,
      tableToken,
      participantToken
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || 'テーブル情報の確認に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-entry-preflight-failed';
    throw error;
  }

  return payload;
};

export const preflightCustomerSession = async ({ storeId, sessionId }) => {
  const response = await fetch('/api/preflightCustomerSession', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      storeId,
      sessionId
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || 'セッション情報の確認に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-session-preflight-failed';
    throw error;
  }

  return payload;
};

export const bootstrapCustomerSession = async ({
  idToken,
  storeId,
  tableId,
  tableToken,
  participantToken
}) => {
  const response = await fetch('/api/bootstrapCustomerSession', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      storeId,
      tableId,
      tableToken,
      participantToken
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || 'セッションの開始に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-session-bootstrap-failed';
    throw error;
  }

  return payload;
};

export const restoreCustomerSessionMember = async ({
  idToken,
  storeId,
  sessionId,
  participantToken
}) => {
  const response = await fetch('/api/restoreCustomerSessionMember', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      storeId,
      sessionId,
      participantToken
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || 'セッションの復元に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-session-restore-failed';
    throw error;
  }

  return payload;
};
