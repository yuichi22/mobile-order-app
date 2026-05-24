export const ensureSessionInvite = async ({ idToken, storeId, sessionId }) => {
  const response = await fetch('/api/ensureSessionInvite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      storeId,
      sessionId
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || '招待リンクの準備に失敗しました。');
    error.code = payload?.error?.code || 'app/customer-session-invite-failed';
    throw error;
  }

  return payload;
};
