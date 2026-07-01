import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';

import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import AppLoading from '../../shared/components/feedback/AppLoading';
import { auth, initializeAuth } from '../../shared/api/firebase/client';
import { prefetchCustomerStoreData } from '../store/services/storePrefetchService';
import { getStoredTableEntryGuard } from './utils/entryGuards';

const safeGetStoredTableEntryGuard = (tableContext) => {
  try {
    return getStoredTableEntryGuard(tableContext);
  } catch (error) {
    console.warn('[SessionStarter] getStoredTableEntryGuard failed', error);
    return null;
  }
};

// QR 読み込み直後に匿名認証を先行ウォームアップしておく。
// 従来は preflight 完了後、customer 画面の bootstrap で初めて認証していたため
// 直列に数百ms〜1秒積み上がっていた。preflight と並列に進めて体感待ちを短縮する。
let authWarmUpPromise = null;
const warmUpCustomerAuth = () => {
  if (authWarmUpPromise) return authWarmUpPromise;

  authWarmUpPromise = (async () => {
    await initializeAuth();
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  })().catch((error) => {
    // 失敗しても後続の bootstrap 側で再度認証を試みるので握りつぶす。
    authWarmUpPromise = null;
    console.warn('[SessionStarter] auth warm-up failed', error);
  });

  return authWarmUpPromise;
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

    const startEntry = () => {
      try {
        // QR直後に匿名認証を先行ウォームアップ（await しない）。
        // customer 画面の bootstrap 到達時に認証済み状態を再利用できる。
        warmUpCustomerAuth();

        // 以前は tableToken があると preflightCustomerEntry で占有/無効/停止を
        // 事前判定してから進んでいたが、bootstrapCustomerSession が
        // open(created)/restore/occupied/disabled/stopped/error を返す上位互換のため、
        // preflight を廃止して直接 customer 画面へ進み、bootstrap を単一の判定源にする。
        // Cloud Function 1往復＋コールドスタート源(preflight)を削減できる。
        // 占有・無効・停止・エラーの画面は customer 側(entryBootstrapStatus)で表示される。
        const existingGuard = safeGetStoredTableEntryGuard(tableContext);
        if (existingGuard) {
          safeSetStatus('occupied');
          return;
        }

        prefetchCustomerStoreData(storeId).catch(() => {});

        if (isMounted && typeof onEntryReady === 'function') {
          onEntryReady();
        }
      } catch (error) {
        console.error('Session start entry error:', error);

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

  return <AppLoading />;
};

export default SessionStarter;