import React, { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarCheck,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ShoppingBag,
  Utensils
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useStoreSettings } from '../store/hooks';
import { getActiveRegisterContext, getAvailableRegisters, setActiveRegisterContext } from '../pos/utils/registerContext';

import { useAuth } from '../../app/providers/useAuth';
import { auth, db } from '../../shared/api/firebase/client';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import NotificationToast from '../../shared/components/feedback/NotificationToast';
import { lazyWithRetry, preloadOnIdle } from '../../shared/utils/lazyWithRetry';
import {
  canAccessAdminTab,
  canAccessAnalytics,
  canAccessSettings,
  normalizeUserRole
} from '../../shared/utils/roles';

const loadAnalyticsPage = () => import('./Analytics/pages/AnalyticsPage');
const loadStoreSettingsPage = () => import('./settings/pages/StoreSettingsPage');
const loadPosHomePage = () => import('../pos/pages/PosHomePage');
const loadPosRegisterPage = () => import('../pos/pages/PosRegisterPage');
const loadPosReceiptPage = () => import('../pos/pages/PosReceiptPage');

const AnalyticsPage = lazyWithRetry(loadAnalyticsPage, 'analytics-page');
const StoreSettingsPage = lazyWithRetry(loadStoreSettingsPage, 'store-settings-page');
const PosHomePage = lazyWithRetry(loadPosHomePage, 'pos-home-page');
const PosRegisterPage = lazyWithRetry(loadPosRegisterPage, 'pos-register-page');
const PosReceiptPage = lazyWithRetry(loadPosReceiptPage, 'pos-receipt-page');

const TabLoader = () => (
  <div className="flex h-full items-center justify-center">
    <LoadingSpinner />
  </div>
);

const OperationTabButton = ({ active, icon: Icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-black shadow-sm transition-all active:scale-95 ${
      active
        ? 'border-orange-200 bg-orange-50 text-orange-600'
        : 'border-gray-100 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900'
    }`}
  >
    <Icon size={17} strokeWidth={2.7} />
    {label}
  </button>
);

const AdminApp = ({ onBack, onSwitchToKitchen, onSwitchToServe }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser: user, storeId, role } = useAuth();
  const { settings: storeSettings } = useStoreSettings(storeId);

  const initialParams = new URLSearchParams(location.search);

  const initialAdminTab = initialParams.get('admin_tab') === 'settings'
    ? 'settings'
    : 'pos';

  const [activeTab, setActiveTab] = useState(initialAdminTab);
  const [settingsReturnMode, setSettingsReturnMode] = useState(
    initialParams.get('return_to') === 'kitchen' ? 'kitchen' : 'pos'
  );
  const [activeSessions, setActiveSessions] = useState([]);
  const [toast, setToast] = useState(null);
  const [posView, setPosView] = useState('scan');
  const [registerMode, setRegisterMode] = useState('order');
  const [activeRegisterContext, setActiveRegisterContextState] = useState(() => getActiveRegisterContext(storeId));
  const [currentPosSessionId, setCurrentPosSessionId] = useState(null);
  const [lastPaymentData, setLastPaymentData] = useState(null);

  const normalizedRole = normalizeUserRole(role);
  const canViewAnalytics = canAccessAnalytics(normalizedRole);
  const canViewSettings = canAccessSettings(normalizedRole);
  const showAdminHeader = canViewAnalytics || canViewSettings;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const adminTab = params.get('admin_tab');
    const returnTo = params.get('return_to');

    if (adminTab === 'settings') {
      setActiveTab('settings');
      setSettingsReturnMode(returnTo === 'kitchen' ? 'kitchen' : 'pos');

      params.delete('admin_tab');
      params.delete('return_to');

      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : ''
        },
        { replace: true }
      );
    }
  }, [location.pathname, location.search, navigate]);

  const closeSettings = () => {
    if (settingsReturnMode === 'kitchen' && typeof onSwitchToKitchen === 'function') {
      setSettingsReturnMode('pos');
      onSwitchToKitchen();
      return;
    }

    setSettingsReturnMode('pos');
    setActiveTab('pos');
  };

  const switchFromSettingsToRegister = () => {
    setSettingsReturnMode('pos');
    setActiveTab('pos');
  };

  const activeAdminTab = (() => {
    if (activeTab === 'dailyClosing') {
      return canViewAnalytics ? 'dailyClosing' : 'pos';
    }

    return canAccessAdminTab(normalizedRole, activeTab) ? activeTab : 'pos';
  })();

  useEffect(() => {
    if (!storeId) return undefined;

    return preloadOnIdle([
      loadPosHomePage,
      loadPosRegisterPage,
      loadPosReceiptPage,
      ...(canViewAnalytics ? [loadAnalyticsPage] : []),
      ...(canViewSettings ? [loadStoreSettingsPage] : [])
    ]);
  }, [storeId, canViewAnalytics, canViewSettings]);

  useEffect(() => {
    if (!user || !storeId || activeAdminTab !== 'pos') return undefined;

    const sessionsCollectionRef = collection(db, 'stores', storeId, 'sessions');

    const unsubscribe = onSnapshot(sessionsCollectionRef, (snapshot) => {
      const allSessions = snapshot.docs
        .map((sessionDoc) => ({
          id: sessionDoc.id,
          ...sessionDoc.data(),
          createdAt: sessionDoc.data().createdAt?.toDate
            ? sessionDoc.data().createdAt.toDate()
            : new Date()
        }))
        .sort((left, right) => right.createdAt - left.createdAt);

      const latestByTable = new Map();

      allSessions.forEach((session) => {
        if (
          session.tableId &&
          !latestByTable.has(session.tableId) &&
          session.status !== 'archived'
        ) {
          latestByTable.set(session.tableId, session);
        }
      });

      setActiveSessions(Array.from(latestByTable.values()));
    });

    return () => unsubscribe();
  }, [user, storeId, activeAdminTab]);

  const handlePosScan = (id) => {
    setCurrentPosSessionId(id);
    setPosView('register');
  };

  const handlePosComplete = async (data) => {
    let nextData = data;

    try {
      const idToken = await auth.currentUser?.getIdToken();

      if (idToken && storeId && data?.sessionId && data?.transactionId) {
        const response = await fetch('/api/issuePostpayReceipt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            storeId,
            sessionId: data.sessionId,
            transactionId: data.transactionId
          })
        });

        const payload = await response.json().catch(() => ({}));

        if (response.ok && payload?.ok) {
          nextData = {
            ...data,
            receiptId: payload.receiptId,
            receiptNo: payload.receiptNo
          };
        } else {
          console.warn('[issuePostpayReceipt] failed', payload);
        }
      }
    } catch (error) {
      console.warn('[issuePostpayReceipt] failed', error);
    }

    setLastPaymentData(nextData);
    setPosView('receipt');
  };

  const handlePosNext = () => {
    setPosView('scan');
    setCurrentPosSessionId(null);
    setLastPaymentData(null);
  };

  useEffect(() => {
    setActiveRegisterContextState(getActiveRegisterContext(storeId));
  }, [storeId]);

  const handleSelectRegister = (register) => {
    const nextRegister = setActiveRegisterContext(storeId, register);
    setActiveRegisterContextState(nextRegister);
  };

  const switchRegisterMode = (nextMode) => {
    setRegisterMode(nextMode);

    // 設定画面を開いている時は、画面遷移せず設定内容だけ切り替える。
    // レジ画面上で押した時だけ、レジ画面に戻して選択モードを反映する。
    if (activeAdminTab !== 'settings') {
      setActiveTab('pos');

      if (posView !== 'scan') {
        setPosView('scan');
        setCurrentPosSessionId(null);
        setLastPaymentData(null);
      }
    }
  };

  const openSettingsForCurrentRegisterMode = () => {
    setSettingsReturnMode('pos');
    setActiveTab('settings');
  };

  const isFixedPosLayout = activeAdminTab === 'pos';

  const appShellClassName = 'flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-gray-100 font-sans text-gray-800 supports-[height:100svh]:h-[100svh] supports-[height:100svh]:max-h-[100svh]';

  const mainClassName = isFixedPosLayout
    ? showAdminHeader
      ? 'min-h-0 flex-grow overflow-hidden h-[calc(100dvh-72px)] max-h-[calc(100dvh-72px)] supports-[height:100svh]:h-[calc(100svh-72px)] supports-[height:100svh]:max-h-[calc(100svh-72px)]'
      : 'min-h-0 flex-grow overflow-hidden h-[100dvh] max-h-[100dvh] supports-[height:100svh]:h-[100svh] supports-[height:100svh]:max-h-[100svh]'
    : showAdminHeader
      ? 'min-h-0 flex-grow overflow-y-auto px-6 py-6 h-[calc(100dvh-72px)] max-h-[calc(100dvh-72px)] supports-[height:100svh]:h-[calc(100svh-72px)] supports-[height:100svh]:max-h-[calc(100svh-72px)]'
      : 'min-h-0 flex-grow overflow-y-auto px-6 py-6 h-[100dvh] max-h-[100dvh] supports-[height:100svh]:h-[100svh] supports-[height:100svh]:max-h-[100svh]';

  if (user && !storeId) {
    return <TabLoader />;
  }

  return (
    <div className={appShellClassName}>
      {toast && (
        <NotificationToast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {showAdminHeader && (
        <header className="sticky top-0 z-40 h-[72px] w-full border-b border-gray-100 bg-white/95 px-5 shadow-sm backdrop-blur-md print:hidden">
          <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {canViewSettings && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeAdminTab === 'settings') {
                      closeSettings();
                      return;
                    }

                    openSettingsForCurrentRegisterMode();
                  }}
                  className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white text-gray-700 shadow-sm transition-all hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 active:scale-95"
                  aria-label={activeAdminTab === 'settings' ? 'レジ画面に戻る' : '設定画面を開く'}
                  title={activeAdminTab === 'settings' ? 'レジ画面に戻る' : '設定画面を開く'}
                >
                  {activeAdminTab === 'settings' ? (
                    <ChevronLeft size={22} strokeWidth={3} />
                  ) : (
                    <ChevronRight size={22} strokeWidth={3} />
                  )}
                </button>
              )}

              <div className="flex h-11 items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm">
                {getAvailableRegisters().map((register) => {
                  const active = activeRegisterContext?.id === register.id;

                  return (
                    <button
                      key={register.id}
                      type="button"
                      onClick={() => handleSelectRegister(register)}
                      className={`flex h-9 items-center rounded-full px-3 text-xs font-black transition-all active:scale-95 ${
                        active
                          ? 'bg-slate-900 text-white shadow-md shadow-slate-300'
                          : 'text-gray-500 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                      aria-label={`${register.name}を使用`}
                      title={`${register.name}を使用`}
                    >
                      {register.label || register.name}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => switchRegisterMode(registerMode === 'order' ? 'pos' : 'order')}
                className="group flex h-11 items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm transition-all hover:border-gray-300 hover:shadow-md active:scale-[0.98]"
                aria-label={registerMode === 'order' ? 'POSレジへ切り替え' : 'ORDERレジへ切り替え'}
                title={registerMode === 'order' ? 'POSレジへ切り替え' : 'ORDERレジへ切り替え'}
              >
                <span
                  className={`flex h-9 items-center gap-2 rounded-full px-4 text-xs font-black transition-all ${
                    registerMode === 'order'
                      ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                      : 'text-gray-500 group-hover:text-orange-600'
                  }`}
                >
                  <CreditCard size={15} strokeWidth={2.7} />
                  ORDERレジ
                </span>

                <span
                  className={`flex h-9 items-center gap-2 rounded-full px-4 text-xs font-black transition-all ${
                    registerMode === 'pos'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'text-gray-500 group-hover:text-blue-700'
                  }`}
                >
                  <ShoppingBag size={15} strokeWidth={2.7} />
                  POSレジ
                </span>
              </button>

              {canViewAnalytics && (
                <>
                  <OperationTabButton
                    active={activeAdminTab === 'dailyClosing'}
                    icon={CalendarCheck}
                    label="日計"
                    onClick={() => setActiveTab('dailyClosing')}
                  />

                  <OperationTabButton
                    active={activeAdminTab === 'analytics'}
                    icon={BarChart3}
                    label="分析"
                    onClick={() => setActiveTab('analytics')}
                  />
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('pos')}
              className="flex min-w-0 flex-col items-center justify-center rounded-2xl px-5 py-2 transition-all hover:bg-gray-50 active:scale-95"
            >
              {storeSettings?.customerLogoUrl ? (
                <img
                  src={storeSettings.customerLogoUrl}
                  alt={storeSettings?.name || '店舗ロゴ'}
                  className="max-h-6 max-w-[120px] object-contain"
                />
              ) : (
                <div className="max-w-[160px] truncate text-sm font-black tracking-tight text-gray-900">
                  {storeSettings?.name || 'AKUTO'}
                </div>
              )}

              <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.18em] text-gray-300">
                Connected by AKUTO
              </div>
            </button>

            <div className="flex min-w-0 justify-end gap-3">
              {!(activeAdminTab === 'pos' && registerMode === 'pos') && (
                <button
                  type="button"
                  onClick={
                    activeAdminTab === 'settings' && settingsReturnMode === 'kitchen'
                      ? switchFromSettingsToRegister
                      : (onSwitchToKitchen || onBack)
                  }
                  className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-gray-900 px-5 text-sm font-black text-white shadow-lg transition-all hover:bg-gray-800 active:scale-95"
                >
                  {activeAdminTab === 'settings' && settingsReturnMode === 'kitchen' ? (
                    <CreditCard size={18} strokeWidth={2.8} />
                  ) : (
                    <ChefHat size={18} strokeWidth={2.8} />
                  )}
                  {activeAdminTab === 'settings' && settingsReturnMode === 'kitchen'
                    ? 'レジモードへ'
                    : 'キッチンモードへ'}
                </button>
              )}

              {typeof onSwitchToServe === 'function' && (
                <button
                  type="button"
                  onClick={onSwitchToServe}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-lg transition-all hover:bg-blue-700 active:scale-95"
                >
                  <Utensils size={18} strokeWidth={2.8} />
                  提供モードへ
                </button>
              )}
            </div>
          </div>
        </header>
      )}

      <main className={mainClassName}>
        {activeAdminTab === 'pos' && (
          <div className="h-full min-h-0 overflow-hidden">
            <Suspense fallback={<TabLoader />}>
              {posView === 'scan' && (
                <PosHomePage
                  activeSessions={activeSessions}
                  onScanSession={handlePosScan}
                  onSelectSession={handlePosScan}
                  storeId={storeId}
                  registerMode={registerMode}
                  onBack={!showAdminHeader ? onBack : undefined}
                />
              )}

              {posView === 'register' && currentPosSessionId && (
                <PosRegisterPage
                  sessionId={currentPosSessionId}
                  onBack={() => setPosView('scan')}
                  onComplete={handlePosComplete}
                  storeId={storeId}
                />
              )}

              {posView === 'receipt' && lastPaymentData && (
                <PosReceiptPage
                  data={lastPaymentData}
                  onNext={handlePosNext}
                  storeId={storeId}
                />
              )}
            </Suspense>
          </div>
        )}

        {activeAdminTab === 'dailyClosing' && canViewAnalytics && (
          <Suspense fallback={<TabLoader />}>
            <AnalyticsPage storeId={storeId} mode="dailyClosing" />
          </Suspense>
        )}

        {activeAdminTab === 'analytics' && canViewAnalytics && (
          <Suspense fallback={<TabLoader />}>
            <AnalyticsPage storeId={storeId} mode="analytics" />
          </Suspense>
        )}

        {activeAdminTab === 'settings' && canViewSettings && (
          <Suspense fallback={<TabLoader />}>
            <StoreSettingsPage
              user={user}
              storeId={storeId}
              initialSettingsMode={registerMode === 'pos' ? 'pos' : 'order'}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
};

export default AdminApp;