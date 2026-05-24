import { auth } from '../../../../shared/api/firebase/client';
import { createAppAuthError } from '../../../../shared/utils/authErrorMessages';

export const deleteStoreMember = async (memberId) => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw createAppAuthError('app/unauthenticated');
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/deleteStoreMember', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ memberId })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw createAppAuthError(payload?.error?.code || 'app/member-delete-failed');
  }

  return payload;
};
