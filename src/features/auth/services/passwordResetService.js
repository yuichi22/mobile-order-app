import { sendPasswordResetEmail } from 'firebase/auth';

import { auth } from '../../../shared/api/firebase/client';

const requestCustomPasswordResetMail = async (email) => {
  const response = await fetch('/api/requestPasswordResetMail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      redirectUrl: `${window.location.origin}/auth/action`
    })
  });

  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.ok) {
    return data;
  }

  const error = new Error(data?.error?.message || '再設定メールの送信に失敗しました。');
  error.code = data?.error?.code || 'app/password-reset-mail-failed';
  throw error;
};

export const sendResetPasswordMail = async (email) => {
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) {
    const error = new Error('auth/missing-email');
    error.code = 'auth/missing-email';
    throw error;
  }

  try {
    await requestCustomPasswordResetMail(normalizedEmail);
    return;
  } catch (error) {
    const shouldFallbackToFirebase = (
      error?.code === 'app/custom-mail-not-configured'
      || error?.code === 'app/password-reset-mail-failed'
      || error?.name === 'TypeError'
    );

    if (!shouldFallbackToFirebase) {
      throw error;
    }
  }

  await sendPasswordResetEmail(auth, normalizedEmail, {
    url: `${window.location.origin}/auth/action`
  });
};
