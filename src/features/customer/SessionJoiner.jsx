import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';

import { auth, initializeAuth } from '../../shared/api/firebase/client';
import CustomerLoadingScreen from './components/CustomerLoadingScreen';
import { joinCustomerSession, preflightJoinCustomerSession } from './services/customerJoinService';
import { clearStoredTableEntryGuardsForSession } from './utils/entryGuards';
import {
  getStoredParticipantIdentityForSession,
  setStoredParticipantIdentityForSession
} from './utils/participantIdentity';

const SESSION_JOIN_TIMEOUT_MS = 12000;

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
};

const SessionJoiner = ({ sessionId, storeId, inviteToken, onJoin }) => {
  const hasRequiredParams = Boolean(sessionId && storeId && inviteToken);
  const [status, setStatus] = useState(() => (hasRequiredParams ? 'checking' : 'error'));
  const [errorMessage, setErrorMessage] = useState(() => (
    hasRequiredParams ? '' : '参加情報を確認できなかったため、このページは利用できません。'
  ));

  useEffect(() => {
    let isMounted = true;

    if (!hasRequiredParams) return undefined;

    const joinSession = async () => {
      if (isMounted) setStatus('checking');

      try {
        const storedParticipantIdentity = getStoredParticipantIdentityForSession(sessionId);

        const initializeAuthPromise = withTimeout(
          initializeAuth(),
          SESSION_JOIN_TIMEOUT_MS,
          '参加情報の確認に時間がかかっています。'
        );

        const preflightResult = await withTimeout(
          preflightJoinCustomerSession({
            storeId,
            sessionId,
            inviteToken
          }),
          SESSION_JOIN_TIMEOUT_MS,
          '参加情報の確認に時間がかかっています。'
        );

        if (preflightResult.action === 'stopped') {
          throw new Error('この店舗は現在利用停止中です。');
        }

        if (preflightResult.action !== 'open') {
          throw new Error('セッションに参加できません');
        }

        await initializeAuthPromise;

        let user = auth.currentUser;
        if (!user) {
          const credential = await withTimeout(
            signInAnonymously(auth),
            SESSION_JOIN_TIMEOUT_MS,
            '参加の準備に時間がかかっています。'
          );
          user = credential.user;
        }

        const idToken = await withTimeout(
          user.getIdToken(),
          SESSION_JOIN_TIMEOUT_MS,
          '認証情報の取得に時間がかかっています。'
        );

        const result = await withTimeout(
          joinCustomerSession({
            idToken,
            storeId,
            sessionId,
            inviteToken,
            participantToken: storedParticipantIdentity?.participantToken || ''
          }),
          SESSION_JOIN_TIMEOUT_MS,
          'セッションへの参加に時間がかかっています。'
        );

        if (isMounted) {
          if (result.participantToken && result.participantId) {
            setStoredParticipantIdentityForSession(result.sessionId || sessionId, {
              sessionId: result.sessionId || sessionId,
              participantToken: result.participantToken,
              participantId: result.participantId
            });
          }
          clearStoredTableEntryGuardsForSession(result.sessionId || sessionId);
          onJoin(result.sessionId || sessionId);
        }
      } catch (error) {
        console.error('Join error:', error);
        if (isMounted) {
          setStatus('error');
          setErrorMessage(error.message || 'セッションへの参加に失敗しました。');
        }
      }
    };

    joinSession();

    return () => {
      isMounted = false;
    };
  }, [hasRequiredParams, inviteToken, onJoin, sessionId, storeId]);

  if (status === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-white p-6 text-center animate-in fade-in">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-red-100 shadow-inner">
          <AlertCircle className="h-12 w-12 text-red-500" />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-gray-800">セッションに参加できません</h2>
        <p className="max-w-sm text-gray-500">{errorMessage}</p>
      </div>
    );
  }

  return <CustomerLoadingScreen message="読み込み中..." />;
};

export default SessionJoiner;
