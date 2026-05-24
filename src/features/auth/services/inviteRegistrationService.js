import { createAppAuthError } from '../../../shared/utils/authErrorMessages';

export const createInvitedMember = async ({ email, password, name, inviteCode, storeId }) => {
  const response = await fetch('/api/createInvitedMember', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      name,
      inviteCode,
      storeId
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw createAppAuthError(payload?.error?.code || 'app/invite-register-failed');
  }
  return payload;
};
