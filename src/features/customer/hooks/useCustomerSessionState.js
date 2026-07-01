import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db, initializeAuth } from '../../../shared/api/firebase/client';
import { hashToken } from '../../../shared/utils/tableAccess';
import { preflightCustomerSession } from '../services/customerSessionService';
import { getStoredParticipantIdentityForSession } from '../utils/participantIdentity';
import { useSubscriptionWatchdog } from '../../store/hooks/useSubscriptionWatchdog';

export const useCustomerSessionState = ({ sessionId, storeId }) => {
  const hasSessionContext = Boolean(sessionId && storeId);
  const [user, setUser] = useState(undefined);
  const [loading, setLoading] = useState(() => hasSessionContext);
  const [tableNumber, setTableNumber] = useState(null);
  const [tableDisplayName, setTableDisplayName] = useState('');
  const [sessionStatus, setSessionStatus] = useState('initializing');
  const [sessionHostId, setSessionHostId] = useState(null);
  // 「終了(ended)」は boolean ではなく "どの sessionId が終了したか" で保持する。
  // こうすると sessionId が別セッションへ変わった瞬間に isSessionEnded が自動的に
  // false になり(派生値)、前セッションの「ご利用ありがとうございました」画面が
  // 新セッションに残って挟まる/固まる問題を、remount 無し(＝通常入場の速度を保ったまま)で防げる。
  const [endedSessionId, setEndedSessionId] = useState(null);
  const [sessionError, setSessionError] = useState('');
  const [shouldSubscribeSession, setShouldSubscribeSession] = useState(() => hasSessionContext);
  const [participantTokenHash, setParticipantTokenHash] = useState('');
  const [isCurrentUserSessionMember, setIsCurrentUserSessionMember] = useState(null);

  // 現在の sessionId が終了状態のときだけ true（前セッションの ended 値は自動で無効化）。
  const isSessionEnded = Boolean(endedSessionId && endedSessionId === sessionId);

  // セッション購読(onSnapshot)が宙吊りで loading が張り付いたときの保険。
  // 一定時間で loading を解除し、retryNonce を進めて購読を張り直す。
  const sessionRetryNonce = useSubscriptionWatchdog({
    loading,
    active: hasSessionContext && shouldSubscribeSession,
    setLoading
  });

  useEffect(() => {
    let isMounted = true;

    const syncParticipantTokenHash = async () => {
      if (!hasSessionContext) {
        setParticipantTokenHash('');
        return;
      }

      const identity = getStoredParticipantIdentityForSession(sessionId);
      if (!identity?.participantToken) {
        setParticipantTokenHash('');
        return;
      }

      const nextHash = await hashToken(identity.participantToken);
      if (!isMounted) return;
      setParticipantTokenHash(nextHash || '');
    };

    syncParticipantTokenHash();

    return () => {
      isMounted = false;
    };
  }, [hasSessionContext, sessionId]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe = () => {};

    const setupAuth = async () => {
      try {
        if (!hasSessionContext) {
          if (isMounted) {
            setUser(null);
            setLoading(false);
            setShouldSubscribeSession(false);
            setIsCurrentUserSessionMember(null);
          }
          return;
        }

        const authPromise = initializeAuth();
        const preflightPromise = preflightCustomerSession({ storeId, sessionId }).catch(() => null);

        const preflightResult = await preflightPromise;
        if (!isMounted) return;

        if (preflightResult?.action === 'missing') {
          setUser(null);
          setSessionError('');
          setEndedSessionId(sessionId);
          setSessionStatus('invalid');
          setShouldSubscribeSession(false);
          setIsCurrentUserSessionMember(false);
          setLoading(false);
          return;
        }

        if (preflightResult?.action === 'ended') {
          setUser(null);
          setTableNumber(preflightResult.tableId || null);
          setTableDisplayName(
            preflightResult.tableDisplayName ||
            preflightResult.tableName ||
            ''
          );
          setSessionError('');
          setEndedSessionId(sessionId);
          setSessionStatus('ended');
          setShouldSubscribeSession(false);
          setIsCurrentUserSessionMember(false);
          setLoading(false);
          return;
        }

        if (preflightResult?.action === 'active') {
          setTableNumber(preflightResult.tableId || null);
          setTableDisplayName(
            preflightResult.tableDisplayName ||
            preflightResult.tableName ||
            ''
          );
          setSessionHostId(preflightResult.hostUserId || null);
          setSessionStatus('active');
          setShouldSubscribeSession(true);
        }

        await authPromise;
        let nextUser = auth.currentUser;

        if (!nextUser) {
          const credential = await signInAnonymously(auth);
          nextUser = credential.user;
          await nextUser.getIdToken();
        }

        if (!isMounted) return;
        setUser(nextUser ?? null);

        unsubscribe = onAuthStateChanged(auth, (resolvedUser) => {
          if (!isMounted) return;
          setUser(resolvedUser ?? null);
          if (!resolvedUser) setIsCurrentUserSessionMember(false);
        });
      } catch (error) {
        if (!isMounted) return;
        console.error('Customer auth setup error:', error);
        setUser(null);
        setLoading(false);
        setShouldSubscribeSession(false);
        setSessionStatus('error');
        setIsCurrentUserSessionMember(false);
        setSessionError('セッション情報の取得に失敗しました。QRコードを読み直してください。');
      }
    };

    setupAuth();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [hasSessionContext, sessionId, storeId]);

  useEffect(() => {
    if (user === undefined) return undefined;
    if (!hasSessionContext || !shouldSubscribeSession) return undefined;

    return onSnapshot(
      doc(db, 'stores', storeId, 'sessions', sessionId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setSessionError('');
          setEndedSessionId(sessionId);
          setIsCurrentUserSessionMember(false);
          setLoading(false);
          return;
        }

        const data = snapshot.data();
        const members = Array.isArray(data.members) ? data.members : [];
        const participantRecords = data.participantsByTokenHash && typeof data.participantsByTokenHash === 'object'
          ? data.participantsByTokenHash
          : {};
        setIsCurrentUserSessionMember(Boolean(user && members.includes(user.uid)));
        const isKnownParticipantByToken = Boolean(
          participantTokenHash && participantRecords[participantTokenHash]
        );
        if (user && participantTokenHash && !isKnownParticipantByToken) {
          setSessionStatus('locked');
          setSessionError('');
          setLoading(false);
          return;
        }

        setSessionStatus(data.status);
        setSessionError('');
        setEndedSessionId(data.status !== 'active' ? sessionId : null);
        setSessionHostId(data.hostUserId);

        if (data.tableId) {
          setTableNumber(data.tableId);
        }

        setTableDisplayName(
          data.tableDisplayName ||
          data.tableName ||
          data.displayName ||
          ''
        );

        setLoading(false);
      },
      (error) => {
        setLoading(false);
        setEndedSessionId(null);
        setSessionStatus('error');
        setIsCurrentUserSessionMember(false);
        setSessionError(
          error.code === 'permission-denied'
            ? 'セッション情報の取得に失敗しました。QRコードを読み直してください。'
            : 'セッション情報の取得に失敗しました。'
        );
      }
    );
  }, [hasSessionContext, participantTokenHash, sessionId, sessionRetryNonce, shouldSubscribeSession, storeId, user]);

  return {
    user,
    loading: hasSessionContext ? loading : false,
    tableNumber: hasSessionContext ? tableNumber : null,
    tableDisplayName: hasSessionContext ? tableDisplayName : '',
    sessionStatus: hasSessionContext ? sessionStatus : 'invalid',
    sessionHostId,
    isSessionEnded,
    sessionError,
    isCurrentUserSessionMember: hasSessionContext ? isCurrentUserSessionMember : false
  };
};
