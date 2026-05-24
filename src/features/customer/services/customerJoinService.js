export const preflightJoinCustomerSession = async ({ storeId, sessionId, inviteToken }) => {
  const response = await fetch('/api/preflightJoinCustomerSession', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      storeId,
      sessionId,
      inviteToken
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || '参加情報の確認に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-session-join-preflight-failed';
    throw error;
  }

  return payload;
};

export const joinCustomerSession = async ({
  idToken,
  storeId,
  sessionId,
  inviteToken,
  participantToken
}) => {
  const response = await fetch('/api/joinCustomerSession', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      storeId,
      sessionId,
      inviteToken,
      participantToken
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || '参加処理に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-session-join-failed';
    throw error;
  }

  return payload;
};
