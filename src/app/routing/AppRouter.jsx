import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../providers/useAuth';
import CustomerLoadingScreen from '../../features/customer/components/CustomerLoadingScreen';
import { lazyWithRetry, preloadOnIdle } from '../../shared/utils/lazyWithRetry';
import {
  canAccessAdminPanel,
  canAccessKitchen,
  normalizeUserRole
} from '../../shared/utils/roles';
import { isStoreStopped } from '../../shared/utils/storeAccess';
import { buildSessionUrl, buildPendingCustomerEntryUrl, getRouteState } from './appRouteState';

const loadLoginPage = () => import('../../features/auth/pages/LoginPage');
const loadRegisterPage = () => import('../../features/auth/pages/RegisterPage');
const loadResetPasswordPage = () => import('../../features/auth/pages/ResetPasswordPage');
const loadPasswordResetConfirmPage = () => import('../../features/auth/pages/PasswordResetConfirmPage');
const loadEmailActionPage = () => import('../../features/auth/pages/EmailActionPage');
const loadLauncherPage = () => import('../../features/launcher/pages/LauncherPage');
const loadSessionJoinPage = () => import('../../features/customer/pages/SessionJoinPage');
const loadSessionStartPage = () => import('../../features/customer/pages/SessionStartPage');
const loadCustomerPage = () => import('../../features/customer/pages/CustomerPage');
const loadKitchenPage = () => import('../../features/kitchen/pages/KitchenPage');
const loadAdminPage = () => import('../../features/admin/pages/AdminPage');
const loadPlatformAdminPage = () => import('../../features/platform/pages/PlatformAdminPage');
const loadPlatformSignupPage = () => import('../../features/platform/pages/PlatformSignupPage');
const loadServePage = () => import('../../features/serve/pages/ServePage');
const loadStaffOrderPage = () => import('../../features/staff-order/pages/StaffOrderPage');

const ServePage = lazyWithRetry(loadServePage, 'serve-page');
const StaffOrderPage = lazyWithRetry(loadStaffOrderPage, 'staff-order-page');

const LoginPage = lazyWithRetry(loadLoginPage, 'login-page');
const RegisterPage = lazyWithRetry(loadRegisterPage, 'register-page');
const ResetPasswordPage = lazyWithRetry(loadResetPasswordPage, 'reset-password-page');
const PasswordResetConfirmPage = lazyWithRetry(loadPasswordResetConfirmPage, 'reset-password-confirm-page');
const EmailActionPage = lazyWithRetry(loadEmailActionPage, 'email-action-page');
const LauncherPage = lazyWithRetry(loadLauncherPage, 'launcher-page');
const SessionJoinPage = lazyWithRetry(loadSessionJoinPage, 'session-join-page');
const SessionStartPage = lazyWithRetry(loadSessionStartPage, 'session-start-page');
const CustomerPage = lazyWithRetry(loadCustomerPage, 'customer-page');
const KitchenPage = lazyWithRetry(loadKitchenPage, 'kitchen-page');
const AdminPage = lazyWithRetry(loadAdminPage, 'admin-page');
const PlatformAdminPage = lazyWithRetry(loadPlatformAdminPage, 'platform-admin-page');
const PlatformSignupPage = lazyWithRetry(loadPlatformSignupPage, 'platform-signup-page');

const RouteLoader = () => <CustomerLoadingScreen message="読み込み中..." />;

const QR_NAVIGATION_TIMEOUT_MS = 1800;

const AppRouter = () => {
  const { currentUser, storeId: contextStoreId, role, storeAccessStatus, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = useMemo(() => getRouteState(location), [location]);
  const navigationState = location.state || {};
  const urlStoreId = routeState.storeId;
  const urlInviteToken = routeState.inviteToken;
  const normalizedRole = normalizeUserRole(role);
  const isSuperAdmin = normalizedRole === 'super_admin';
  const activeStoreId = currentUser && !currentUser.isAnonymous
    ? (isSuperAdmin && urlStoreId ? urlStoreId : contextStoreId)
    : (urlStoreId || contextStoreId);
  const isMobileViewport = useMemo(() => {
    if (typeof window === 'undefined') return false;

    return window.matchMedia('(max-width: 767px)').matches;
  }, []);

  const [mode, setMode] = useState(() => {
    if (routeState.mode !== 'launcher') return routeState.mode;

    if (isMobileViewport) return 'serve';

    return 'admin';
  });

  const switchMode = (nextMode) => {
    setMode(nextMode);

    const params = new URLSearchParams(location.search);

    params.delete('start_table');
    params.delete('table_token');
    params.delete('session');
    params.delete('action');
    params.delete('customer_entry');
    params.delete('invite');

    if (nextMode === 'admin') {
      params.delete('mode');
    } else {
      params.delete('admin_tab');
      params.set('mode', nextMode);
    }

    const nextSearch = params.toString();
    navigate(
      {
        pathname: '/',
        search: nextSearch ? `?${nextSearch}` : ''
      },
      { replace: true }
    );
  };

  const [pendingSessionNavigation, setPendingSessionNavigation] = useState(null);
  const pendingSessionNavigationRef = useRef(null);

  const resolvedMode = routeState.mode !== 'launcher' ? routeState.mode : mode;
  const resolvedTableId = routeState.tableId || navigationState.entryTableId || null;
  const resolvedTableToken = routeState.tableToken || navigationState.entryTableToken || null;
  const resolvedSessionId = routeState.sessionId;

  const effectiveMode = useMemo(() => {
    if (resolvedMode === 'kitchen' && !canAccessKitchen(normalizedRole)) return 'launcher';
    if (resolvedMode === 'serve' && !canAccessKitchen(normalizedRole)) return 'launcher';
    if (resolvedMode === 'staffOrder' && !canAccessKitchen(normalizedRole)) return 'launcher';
    if (resolvedMode === 'platform' && !isSuperAdmin) return 'launcher';
    if (resolvedMode === 'admin' && !canAccessAdminPanel(normalizedRole)) return 'launcher';
    return resolvedMode;
  }, [resolvedMode, isSuperAdmin, normalizedRole]);

  useEffect(() => {
    if (!currentUser) return undefined;

    return preloadOnIdle([
      loadLauncherPage,
      loadAdminPage,
      ...(isSuperAdmin ? [loadPlatformAdminPage] : []),
      ...(canAccessKitchen(normalizedRole) ? [loadKitchenPage, loadServePage, loadStaffOrderPage] : []),
      ...(currentUser.isAnonymous ? [loadCustomerPage] : [])
    ]);
  }, [currentUser, isSuperAdmin, normalizedRole]);

  useEffect(() => {
    if (effectiveMode !== 'entry' && effectiveMode !== 'joining') return undefined;

    loadCustomerPage().catch(() => {});
    return undefined;
  }, [effectiveMode]);

  const finalizeEntry = (sessionId, targetStoreId, tableId = null, tableToken = null) => {
    const targetUrl = buildSessionUrl(sessionId, targetStoreId);
    const pendingState = {
      sessionId,
      storeId: targetStoreId,
      tableId,
      tableToken,
      targetUrl
    };

    loadCustomerPage().catch(() => {});
    pendingSessionNavigationRef.current = pendingState;
    setPendingSessionNavigation(pendingState);
    navigate(targetUrl, {
      replace: true,
      state: {
        entryTableId: tableId || null,
        entryTableToken: tableToken || null
      }
    });
  };

  useEffect(() => {
    if (!pendingSessionNavigation) return undefined;

    const isReady = effectiveMode === 'customer'
      && resolvedSessionId === pendingSessionNavigation.sessionId
      && urlStoreId === pendingSessionNavigation.storeId;

    if (!isReady) return undefined;

    pendingSessionNavigationRef.current = null;
    const clearTimer = window.setTimeout(() => {
      setPendingSessionNavigation(null);
    }, 0);

    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [effectiveMode, pendingSessionNavigation, resolvedSessionId, urlStoreId]);

  useEffect(() => {
    if (!pendingSessionNavigation) return undefined;

    const fallbackTimer = window.setTimeout(() => {
      if (pendingSessionNavigationRef.current?.sessionId === pendingSessionNavigation.sessionId) {
        window.location.replace(pendingSessionNavigation.targetUrl);
      }
    }, QR_NAVIGATION_TIMEOUT_MS);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [pendingSessionNavigation]);

  if (loading) {
    return <RouteLoader />;
  }

  if (location.pathname === '/signup') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <PlatformSignupPage />
      </Suspense>
    );
  }

  if (location.pathname === '/reset-password/confirm') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <PasswordResetConfirmPage />
      </Suspense>
    );
  }

  if (location.pathname === '/auth/action') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <EmailActionPage />
      </Suspense>
    );
  }

  if (location.pathname === '/reset-password') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <ResetPasswordPage />
      </Suspense>
    );
  }

  if (location.pathname === '/staff-order') {
    if (!currentUser) {
      const redirectPath = `${location.pathname}${location.search || ''}`;

      return (
        <Suspense fallback={<RouteLoader />}>
          <LoginPage redirectTo={redirectPath} />
        </Suspense>
      );
    }

    if (!activeStoreId) {
      return (
        <Suspense fallback={<RouteLoader />}>
          <LoginPage />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<RouteLoader />}>
        <StaffOrderPage storeId={activeStoreId} />
      </Suspense>
    );
  }

  if (currentUser && !currentUser.isAnonymous && isStoreStopped(storeAccessStatus)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6 text-center">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-sm">
          <ShieldAlert className="h-12 w-12 text-gray-300" />
        </div>
        <h2 className="mb-2 text-2xl font-black text-slate-900">この店舗は現在利用停止中です</h2>
        <p className="max-w-md text-sm leading-relaxed text-slate-600">
          利用停止中のため、このアカウントでは利用できません。再開されるまでしばらくお待ちください。
        </p>
      </div>
    );
  }

  if (effectiveMode === 'joining') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <SessionJoinPage
          sessionId={resolvedSessionId}
          storeId={urlStoreId}
          inviteToken={urlInviteToken}
          onJoin={(sessionId) => finalizeEntry(sessionId, urlStoreId)}
        />
      </Suspense>
    );
  }

  if (effectiveMode === 'entry') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <SessionStartPage
          key={`entry:${urlStoreId || ''}:${resolvedTableId || ''}:${resolvedTableToken || ''}`}
          tableId={resolvedTableId}
          storeId={urlStoreId}
          tableToken={resolvedTableToken}
          onEntryReady={() => navigate(
            buildPendingCustomerEntryUrl(resolvedTableId, urlStoreId, resolvedTableToken),
            {
              replace: true,
              state: {
                entryTableId: resolvedTableId,
                entryTableToken: resolvedTableToken
              }
            }
          )}
        />
      </Suspense>
    );
  }

  if (effectiveMode === 'customer') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <CustomerPage
          sessionId={resolvedSessionId}
          storeId={activeStoreId}
          entryTableId={resolvedTableId || pendingSessionNavigation?.tableId || null}
          entryTableToken={resolvedTableToken || pendingSessionNavigation?.tableToken || null}
          onSessionCreated={(sessionId, createdTableId, createdTableToken) => finalizeEntry(
            sessionId,
            urlStoreId,
            createdTableId || resolvedTableId || pendingSessionNavigation?.tableId || null,
            createdTableToken || resolvedTableToken || pendingSessionNavigation?.tableToken || null
          )}
          onBack={() => { window.location.href = '/login'; }}
        />
      </Suspense>
    );
  }

  if (!currentUser) {
    if (location.pathname === '/register') {
      return (
        <Suspense fallback={<RouteLoader />}>
          <RegisterPage />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<RouteLoader />}>
        <LoginPage />
      </Suspense>
    );
  }

  const switchToSettings = () => {
    setMode('admin');

    const params = new URLSearchParams(location.search);

    params.delete('mode');
    params.delete('start_table');
    params.delete('table_token');
    params.delete('session');
    params.delete('action');
    params.delete('customer_entry');
    params.delete('invite');
    params.set('admin_tab', 'settings');
    params.set('return_to', 'kitchen');

    navigate(
      {
        pathname: '/',
        search: `?${params.toString()}`
      },
      { replace: true }
    );
  };

  if (!activeStoreId) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <LoginPage />
      </Suspense>
    );
  }

    switch (effectiveMode) {
      case 'kitchen':
        return (
          <Suspense fallback={<RouteLoader />}>
            <KitchenPage
              storeId={activeStoreId}
              onBack={() => switchMode('launcher')}
              onSwitchToRegister={() => switchMode('admin')}
              onSwitchToSettings={switchToSettings}
            />
          </Suspense>
        );

      case 'serve':
        return (
          <Suspense fallback={<RouteLoader />}>
            <ServePage storeId={activeStoreId} />
          </Suspense>
        );

      case 'staffOrder':
        return (
          <Suspense fallback={<RouteLoader />}>
            <StaffOrderPage storeId={activeStoreId} />
          </Suspense>
        );

      case 'admin':
        return (
          <Suspense fallback={<RouteLoader />}>
            <AdminPage
              onBack={() => switchMode('launcher')}
              onSwitchToKitchen={() => switchMode('kitchen')}
            />
          </Suspense>
        );

      case 'platform':
        return (
          <Suspense fallback={<RouteLoader />}>
            <PlatformAdminPage
              onOpenStoreAdmin={(targetStoreId) => {
                const params = new URLSearchParams(location.search);
                params.set('store_id', targetStoreId);
                params.delete('start_table');
                params.delete('table_token');
                params.delete('session');
                params.delete('action');
                params.delete('customer_entry');
                params.delete('invite');
                params.delete('mode');

                navigate(
                  {
                    pathname: '/',
                    search: `?${params.toString()}`
                  },
                  { replace: true }
                );

                setMode('admin');
              }}
            />
          </Suspense>
        );

      case 'launcher':
      default:
        return (
          <Suspense fallback={<RouteLoader />}>
            <LauncherPage
              onModeSelect={switchMode}
              onStartCustomer={() => {
                const tableId = prompt('テーブル番号を入力してください');
                if (tableId) {
                  navigate(`/?start_table=${tableId}&store_id=${activeStoreId}`, { replace: true });
                }
              }}
            />
          </Suspense>
        );
    }
};

export default AppRouter;
