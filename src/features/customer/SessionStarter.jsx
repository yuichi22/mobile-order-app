import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Lock } from 'lucide-react';

import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { prefetchCustomerStoreData } from '../store/services/storePrefetchService';
import { preflightCustomerEntry } from './services/customerSessionService';
import {
  clearStoredTableEntryGuard,
  getStoredTableEntryGuard,
  setStoredTableEntryGuard
} from './utils/entryGuards';
import { getStoredParticipantIdentityForTable } from './utils/participantIdentity';

const ENTRY_PREFLIGHT_TIMEOUT_MS = 12000;

const safeGetStoredTableEntryGuard = (tableContext) => {
  try {
    return getStoredTableEntryGuard(tableContext);
  } catch (error) {
    console.warn('[SessionStarter] getStoredTableEntryGuard failed', error);
    return null;
  }
};

const safeSetStoredTableEntryGuard = (tableContext, sessionId) => {
  try {
    setStoredTableEntryGuard(tableContext, sessionId);
  } catch (error) {
    console.warn('[SessionStarter] setStoredTableEntryGuard failed', error);
  }
};

const safeClearStoredTableEntryGuard = (tableContext) => {
  try {
    clearStoredTableEntryGuard(tableContext);
  } catch (error) {
    console.warn('[SessionStarter] clearStoredTableEntryGuard failed', error);
  }
};

const safeGetStoredParticipantIdentityForTable = ({ storeId, tableId }) => {
  try {
    return getStoredParticipantIdentityForTable({ storeId, tableId });
  } catch (error) {
    console.warn('[SessionStarter] getStoredParticipantIdentityForTable failed', error);
    return null;
  }
};

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .then((result) => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      return result;
    })
    .catch((error) => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      throw error;
    });
};

const LoadingSurface = ({ children = null }) => (
  <div className="relative flex h-screen items-center justify-center bg-white">
    <LoadingSpinner size={28} colorClass="text-gray-300" />
    {children}
  </div>
);

const StatusModal = ({ icon, title, children }) => (
  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6">
    <div className="w-full max-w-sm rounded-[2rem] border border-gray-100 bg-white p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-50 shadow-sm ring-1 ring-gray-100">
        {icon}
      </div>

      <h2 className="mb-3 text-2xl font-black tracking-tight text-gray-900">
        {title}
      </h2>

      <div className="text-sm font-medium leading-relaxed text-gray-500">
        {children}
      </div>
    </div>
  </div>
);

const SessionStarter = ({ tableId, storeId, tableToken, onEntryReady }) => {
  const tableContext = useMemo(
    () => ({ storeId, tableId, tableToken }),
    [storeId, tableId, tableToken]
  );

  const hasRequiredParams = Boolean(storeId && tableId);

  // iPhone/Safari/WebView対策：
  // useState 初期化中に localStorage / sessionStorage 系を読まない。
  const [status, setStatus] = useState('checking');

  const startedRef = useRef(false);

  useEffect(() => {
    if (!hasRequiredParams) {
      setStatus('error');
      return undefined;
    }

    if (startedRef.current) return undefined;
    startedRef.current = true;

    let isMounted = true;

    const safeSetStatus = (nextStatus) => {
      if (!isMounted) return;
      setStatus(nextStatus);
    };

    const startEntry = async () => {
      try {
        const existingGuard = safeGetStoredTableEntryGuard(tableContext);

        if (existingGuard) {
          safeSetStatus('occupied');
          return;
        }

        const storedParticipantIdentity = safeGetStoredParticipantIdentityForTable({
          storeId,
          tableId
        });

        if (!tableToken) {
          prefetchCustomerStoreData(storeId).catch(() => {});

          if (isMounted && typeof onEntryReady === 'function') {
            onEntryReady();
          }

          return;
        }

        safeSetStatus('checking');
        prefetchCustomerStoreData(storeId).catch(() => {});

        const result = await withTimeout(
          preflightCustomerEntry({
            storeId,
            tableId,
            tableToken,
            participantToken: storedParticipantIdentity?.participantToken || ''
          }),
          ENTRY_PREFLIGHT_TIMEOUT_MS,
          'テーブル情報の確認に時間がかかっています。'
        );

        if (!isMounted) return;

        if (result?.action === 'open' || result?.action === 'restore') {
          safeClearStoredTableEntryGuard(tableContext);

          if (typeof onEntryReady === 'function') {
            onEntryReady();
          }

          return;
        }

        if (result?.action === 'occupied') {
          safeSetStoredTableEntryGuard(tableContext, result.sessionId);
          safeSetStatus('occupied');
          return;
        }

        if (result?.action === 'disabled') {
          safeSetStatus('disabled');
          return;
        }

        if (result?.action === 'stopped') {
          safeSetStatus('stopped');
          return;
        }

        safeSetStatus('error');
      } catch (error) {
        console.error('Session start preflight error:', error);

        if (!isMounted) return;

        startedRef.current = false;
        safeSetStatus('error');
      }
    };

    startEntry();

    return () => {
      isMounted = false;
    };
  }, [hasRequiredParams, onEntryReady, storeId, tableContext, tableId, tableToken]);

  if (!hasRequiredParams || status === 'error') {
    return (
      <LoadingSurface>
        <StatusModal
          icon={<AlertCircle className="h-10 w-10 text-red-500" />}
          title="読み込みエラー"
        >
          <p>
            テーブル情報の確認に失敗しました。
            <br />
            QRコードを読み直して再度お試しください。
          </p>
        </StatusModal>
      </LoadingSurface>
    );
  }

  if (status === 'disabled') {
    return (
      <LoadingSurface>
        <StatusModal
          icon={<Lock className="h-10 w-10 text-red-500" />}
          title="このテーブルは利用できません"
        >
          <p>
            別のテーブルをご利用いただくか、
            <br />
            スタッフへお声がけください。
          </p>
        </StatusModal>
      </LoadingSurface>
    );
  }

  if (status === 'stopped') {
    return (
      <LoadingSurface>
        <StatusModal
          icon={<Lock className="h-10 w-10 text-red-500" />}
          title="この店舗は利用停止中です"
        >
          <p>店舗スタッフへお問い合わせください。</p>
        </StatusModal>
      </LoadingSurface>
    );
  }

  if (status === 'occupied') {
    return (
      <LoadingSurface>
        <StatusModal
          icon={<Lock className="h-10 w-10 text-gray-700" />}
          title="利用中のテーブルです"
        >
          <p>
            先にQRコードを読まれた方の画面右上の
            <br />
            <span className="font-black text-gray-800">一緒に注文</span>
            {' '}ボタンから表示されるQRをご利用ください。
          </p>
        </StatusModal>
      </LoadingSurface>
    );
  }

  return <LoadingSurface />;
};

export default SessionStarter;