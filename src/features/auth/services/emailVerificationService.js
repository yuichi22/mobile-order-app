import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from 'firebase/auth';

import { auth, ensureSessionPersistence } from '../../../shared/api/firebase/client';

const actionCodeSettings = () => ({
  url: `${window.location.origin}/auth/action`
});

const requestCustomVerificationMail = async () => {
  if (!auth.currentUser) {
    const error = new Error('auth/no-current-user');
    error.code = 'auth/no-current-user';
    throw error;
  }

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch('/api/requestEmailVerificationMail', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      redirectUrl: `${window.location.origin}/auth/action`
    })
  });

  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.ok) {
    return data;
  }

  const error = new Error(data?.error?.message || '確認メールの送信に失敗しました。');
  error.code = data?.error?.code || 'app/email-verification-mail-failed';
  throw error;
};

export const sendCurrentUserVerificationMail = async () => {
  if (!auth.currentUser) return false;

  try {
    await requestCustomVerificationMail();
  } catch (error) {
    const shouldFallbackToFirebase = (
      error?.code === 'app/custom-mail-not-configured'
      || error?.code === 'app/email-verification-mail-failed'
      || error?.name === 'TypeError'
    );

    if (!shouldFallbackToFirebase) {
      throw error;
    }

    await sendEmailVerification(auth.currentUser, actionCodeSettings());
  }

  return true;
};

export const sendVerificationMailForCredentials = async (email, password) => {
  await ensureSessionPersistence();
  const result = await signInWithEmailAndPassword(auth, email, password);

  try {
    try {
      await requestCustomVerificationMail();
    } catch (error) {
      const shouldFallbackToFirebase = (
        error?.code === 'app/custom-mail-not-configured'
        || error?.code === 'app/email-verification-mail-failed'
        || error?.name === 'TypeError'
      );

      if (!shouldFallbackToFirebase) {
        throw error;
      }

      await sendEmailVerification(result.user, actionCodeSettings());
    }
  } finally {
    await firebaseSignOut(auth);
  }

  return true;
};
