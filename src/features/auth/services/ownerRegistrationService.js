import { createAppAuthError } from '../../../shared/utils/authErrorMessages';

export const createOwnerAccount = async ({ email, password, name }) => {
  const response = await fetch('/api/createOwnerAccount', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      name
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw createAppAuthError(payload?.error?.code || 'app/invite-register-failed');
  }

  return payload;
};
