import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  Building2,
  ChevronRight,
  Layers3,
  ShieldCheck,
  Store,
  TriangleAlert
} from 'lucide-react';

import { useAuth } from '../../../app/providers/useAuth';
import { auth, db } from '../../../shared/api/firebase/client';
import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';
import { USER_ROLES, normalizeUserRole } from '../../../shared/utils/roles';

const PLATFORM_ADMIN_SESSION_STORAGE_KEY = 'akuto_platform_admin_session_token';

const getStoreId = (storeDoc) => {
  const data = storeDoc.data() || {};
  return data.id || storeDoc.id;
};

const callPlatformAdminApi = async (path, body = {}) => {
  const idToken = await auth.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('app/unauthenticated');
  }

  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || '認証に失敗しました。');
    error.code = payload?.error?.code || 'app/request-failed';
    throw error;
  }

  return payload;
};

const PlatformAdminPage = ({ onOpenStoreAdmin }) => {
  const { role, storeId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [authVerified, setAuthVerified] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeVerifying, setCodeVerifying] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [organizations, setOrganizations] = useState([]);
  const [stores, setStores] = useState([]);
  const [plans, setPlans] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [checkoutLoadingContractId, setCheckoutLoadingContractId] = useState('');
  const [portalLoadingContractId, setPortalLoadingContractId] = useState('');
  const [syncLoadingContractId, setSyncLoadingContractId] = useState('');
  const [error, setError] = useState('');

  const isSuperAdmin = normalizeUserRole(role) === USER_ROLES.SUPER_ADMIN;

  useEffect(() => {
    let cancelled = false;

    const verifyStoredSession = async () => {
      if (!isSuperAdmin) {
        setAuthChecking(false);
        setAuthVerified(false);
        return;
      }

      const storedToken = window.localStorage.getItem(PLATFORM_ADMIN_SESSION_STORAGE_KEY);
      if (!storedToken) {
        setAuthChecking(false);
        setAuthVerified(false);
        return;
      }

      setAuthChecking(true);
      setAuthError('');

      try {
        await callPlatformAdminApi('/api/verifyPlatformAdminSession', {
          sessionToken: storedToken
        });

        if (!cancelled) {
          setAuthVerified(true);
        }
      } catch (sessionError) {
        console.warn('[PlatformAdminPage] stored session invalid', sessionError);
        window.localStorage.removeItem(PLATFORM_ADMIN_SESSION_STORAGE_KEY);

        if (!cancelled) {
          setAuthVerified(false);
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    };

    verifyStoredSession();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, authVerified]);

  const handleSendCode = async () => {
    setCodeSending(true);
    setAuthError('');

    try {
      await callPlatformAdminApi('/api/requestPlatformAdminAccessCode');
      setCodeSent(true);
    } catch (sendError) {
      console.error('[PlatformAdminPage] code request failed', sendError);
      setAuthError(sendError.message || '確認コードの送信に失敗しました。');
    } finally {
      setCodeSending(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setAuthError('6桁の確認コードを入力してください。');
      return;
    }

    setCodeVerifying(true);
    setAuthError('');

    try {
      const payload = await callPlatformAdminApi('/api/verifyPlatformAdminAccessCode', {
        code: normalizedCode
      });

      window.localStorage.setItem(PLATFORM_ADMIN_SESSION_STORAGE_KEY, payload.sessionToken);
      setAuthVerified(true);
      setCode('');
    } catch (verifyError) {
      console.error('[PlatformAdminPage] code verification failed', verifyError);
      setAuthError(verifyError.message || '確認コードが正しくありません。');
    } finally {
      setCodeVerifying(false);
    }
  };

  const handleCreateCheckout = async (contractId) => {
    if (!contractId) return;

    setCheckoutLoadingContractId(contractId);
    setError('');

    try {
      const payload = await callPlatformAdminApi('/api/createMobileOrderCheckoutSession', {
        contractId,
        planId: 'standard',
        includeInitialSetup: true,
        successUrl: `${window.location.origin}/?mode=platform&checkout=success&contract_id=${encodeURIComponent(contractId)}`,
        cancelUrl: `${window.location.origin}/?mode=platform&checkout=cancel&contract_id=${encodeURIComponent(contractId)}`
      });

      if (payload?.url) {
        window.open(payload.url, '_blank', 'noopener,noreferrer');
      } else {
        setError('Checkout URLを取得できませんでした。');
      }
    } catch (checkoutError) {
      console.error('[PlatformAdminPage] checkout creation failed', checkoutError);
      setError(checkoutError.message || 'Checkoutの作成に失敗しました。');
    } finally {
      setCheckoutLoadingContractId('');
    }
  };

  const handleOpenBillingPortal = async (contractId) => {
    if (!contractId) return;

    setPortalLoadingContractId(contractId);
    setError('');

    try {
      const payload = await callPlatformAdminApi('/api/createMobileOrderBillingPortal', {
        contractId,
        returnUrl: `${window.location.origin}/?mode=platform&contract_id=${encodeURIComponent(contractId)}`
      });

      if (payload?.url) {
        window.open(payload.url, '_blank', 'noopener,noreferrer');
      } else {
        setError('Billing Portal URLを取得できませんでした。');
      }
    } catch (portalError) {
      console.error('[PlatformAdminPage] billing portal creation failed', portalError);
      setError(portalError.message || 'Billing Portalの作成に失敗しました。');
    } finally {
      setPortalLoadingContractId('');
    }
  };

  const handleSyncContract = async (contractId) => {
    if (!contractId) return;

    setSyncLoadingContractId(contractId);
    setError('');

    try {
      const payload = await callPlatformAdminApi('/api/syncMobileOrderContract', {
        contractId
      });

      if (payload?.synced) {
        window.location.reload();
      } else {
        setError('Stripe上のサブスクリプションがまだ見つかりません。Checkout完了後に再度同期してください。');
      }
    } catch (syncError) {
      console.error('[PlatformAdminPage] contract sync failed', syncError);
      setError(syncError.message || '契約情報の同期に失敗しました。');
    } finally {
      setSyncLoadingContractId('');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadPlatformData = async () => {
      if (!isSuperAdmin || !authVerified) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const [organizationSnapshot, storeSnapshot, planSnapshot, contractSnapshot] = await Promise.all([
          getDocs(collection(db, 'platformOrganizations')),
          getDocs(collection(db, 'stores')),
          getDocs(collection(db, 'platformPlans')),
          getDocs(collection(db, 'platformContracts'))
        ]);

        const organizationRows = organizationSnapshot.docs.map((organizationDoc) => {
          const data = organizationDoc.data() || {};
          return {
            id: data.id || organizationDoc.id,
            name: data.name || organizationDoc.id,
            type: data.type || 'single',
            status: data.status || 'active',
            ownerEmail: data.ownerEmail || ''
          };
        });

        const planRows = planSnapshot.docs.map((planDoc) => {
          const data = planDoc.data() || {};
          return {
            id: planDoc.id,
            name: data.name || planDoc.id,
            status: data.status || 'inactive',
            planType: data.planType || '',
            monthlyAmount: Number(data.monthlyAmount) || 0,
            initialSetupFeeDefault: Number(data.initialSetupFeeDefault) || 0,
            currency: data.currency || 'jpy',
            stripeProductId: data.stripeProductId || '',
            stripePriceId: data.stripePriceId || '',
            stripeLookupKey: data.stripeLookupKey || ''
          };
        });

        const contractRows = contractSnapshot.docs.map((contractDoc) => {
          const data = contractDoc.data() || {};
          return {
            id: contractDoc.id,
            contractId: data.contractId || contractDoc.id,
            organizationId: data.organizationId || '',
            storeId: data.storeId || '',
            planId: data.planId || '',
            planName: data.planName || '',
            status: data.status || 'draft',
            billingStatus: data.billingStatus || 'not_started',
            monthlyAmount: Number(data.monthlyAmount) || 0,
            initialSetupFee: Number(data.initialSetupFee) || 0,
            currency: data.currency || 'jpy',
            salesChannel: data.salesChannel || '',
            partnerId: data.partnerId || '',
            stripeCustomerId: data.stripe?.customerId || '',
            stripeSubscriptionId: data.stripe?.subscriptionId || '',
            onboardingStatus: data.onboarding?.status || ''
          };
        });

        const contractByStoreId = new Map(contractRows.map((contract) => [contract.storeId, contract]));

        const storeRows = await Promise.all(
          storeSnapshot.docs.map(async (storeDoc) => {
            const storeData = storeDoc.data() || {};
            const id = getStoreId(storeDoc);
            let basic = {};

            try {
              const basicSnapshot = await getDoc(doc(db, 'stores', id, 'settings', 'basic'));
              if (basicSnapshot.exists()) {
                basic = basicSnapshot.data() || {};
              }
            } catch (basicError) {
              console.warn('[PlatformAdminPage] basic settings load failed', id, basicError);
            }

            return {
              id,
              organizationId: storeData.organizationId || '',
              organizationName: storeData.organizationName || '',
              organizationType: storeData.organizationType || '',
              name: basic.name || id,
              address: basic.address || '',
              tel: basic.tel || '',
              logoUrl: basic.customerLogoUrl || '',
              status: storeData.status || 'active',
              contract: contractByStoreId.get(id) || null
            };
          })
        );

        if (!cancelled) {
          setOrganizations(organizationRows.sort((a, b) => a.name.localeCompare(b.name, 'ja')));
          setStores(storeRows.sort((a, b) => a.name.localeCompare(b.name, 'ja')));
          setPlans(planRows.sort((a, b) => a.name.localeCompare(b.name, 'ja')));
          setContracts(contractRows.sort((a, b) => a.contractId.localeCompare(b.contractId, 'ja')));
        }
      } catch (loadError) {
        console.error('[PlatformAdminPage] load failed', loadError);
        if (!cancelled) {
          setError('プラットフォーム情報の読み込みに失敗しました。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPlatformData();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, authVerified]);

  const organizationCards = useMemo(() => {
    const knownOrganizationIds = new Set(organizations.map((organization) => organization.id));
    const orphanStores = stores.filter((store) => !store.organizationId || !knownOrganizationIds.has(store.organizationId));

    const cards = organizations.map((organization) => ({
      ...organization,
      stores: stores.filter((store) => store.organizationId === organization.id)
    }));

    if (orphanStores.length) {
      cards.push({
        id: 'unassigned',
        name: '未所属の店舗',
        type: 'unassigned',
        status: 'attention',
        ownerEmail: '',
        stores: orphanStores
      });
    }

    return cards;
  }, [organizations, stores]);

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <TriangleAlert className="mx-auto mb-4 h-12 w-12 text-orange-400" />
          <h1 className="text-xl font-black text-slate-900">アクセス権限がありません</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
            この画面はスーパーアドミン専用です。
          </p>
        </div>
      </div>
    );
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (!authVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <ShieldCheck size={26} strokeWidth={3} />
          </div>

          <h1 className="text-2xl font-black text-slate-900">
            スーパーアドミン確認
          </h1>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
            登録メールアドレスに6桁の確認コードを送信し、本人確認を行います。
          </p>

          <div className="mt-6 space-y-4">
            <button
              type="button"
              onClick={handleSendCode}
              disabled={codeSending}
              className="h-12 w-full rounded-2xl bg-slate-900 text-sm font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {codeSending ? '送信中...' : codeSent ? '確認コードを再送する' : '確認コードを送信する'}
            </button>

            {codeSent && (
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-14 w-full rounded-2xl border-2 border-slate-100 px-5 text-center text-xl font-black tracking-[0.3em] text-slate-900 outline-none focus:border-slate-900"
                  placeholder="000000"
                />

                <button
                  type="submit"
                  disabled={codeVerifying}
                  className="h-12 w-full rounded-2xl bg-emerald-600 text-sm font-black text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {codeVerifying ? '確認中...' : '確認して入室する'}
                </button>
              </form>
            )}

            {authError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
                {authError}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-3xl bg-white p-6 shadow-sm">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-black text-white">
            <ShieldCheck size={15} strokeWidth={3} />
            SUPER ADMIN
          </div>

          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight md:text-3xl">
                Akuto プラットフォーム管理
              </h1>
              <p className="mt-2 text-sm font-bold text-slate-500">
                チェーン・運営組織ごとに店舗を管理します。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Organizations
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {organizations.length}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Stores
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {stores.length}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Plans
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {plans.length}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Contracts
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {contracts.length}
                </div>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-600">
            {error}
          </div>
        )}

        <div className="mb-6 rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-black text-slate-900">料金プラン</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                Stripeと紐づくMobile Orderのプラン設定です。
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {plans.map((plan) => (
              <article key={plan.id} className="rounded-2xl border border-slate-100 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-slate-900">{plan.name}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {plan.id} / {plan.status} / {plan.planType}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white">
                    ¥{plan.monthlyAmount.toLocaleString()} / 月
                  </div>
                </div>

                <div className="grid gap-2 text-xs font-bold text-slate-500">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    初期設定費: ¥{plan.initialSetupFeeDefault.toLocaleString()}
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    Product: {plan.stripeProductId || '-'}
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    Price: {plan.stripePriceId || '-'}
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    Lookup: {plan.stripeLookupKey || '-'}
                  </div>
                </div>
              </article>
            ))}

            {!plans.length && (
              <div className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-400">
                料金プランがまだ登録されていません。
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {organizationCards.map((organization) => (
            <section key={organization.id} className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100">
                    <Layers3 className="h-6 w-6 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black text-slate-900">
                      {organization.name}
                    </h2>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {organization.id} / {organization.type} / {organization.status}
                    </p>
                    {organization.ownerEmail && (
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        {organization.ownerEmail}
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                  {organization.stores.length}店舗
                </div>
              </div>

              <div className="grid gap-3">
                {organization.stores.map((store) => (
                  <article
                    key={store.id}
                    className="flex flex-col gap-4 rounded-2xl border border-slate-100 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
                        {store.logoUrl ? (
                          <img src={store.logoUrl} alt={store.name} className="h-full w-full object-contain p-2" />
                        ) : (
                          <Building2 className="h-6 w-6 text-slate-400" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate text-base font-black text-slate-900">
                          {store.name}
                        </h3>
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {store.id}
                        </p>
                        {(store.address || store.tel) && (
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {[store.address, store.tel].filter(Boolean).join(' / ')}
                          </p>
                        )}

                        {store.contract ? (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                              {store.contract.planName || store.contract.planId}
                            </span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                              ¥{store.contract.monthlyAmount.toLocaleString()} / 月
                            </span>
                            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                              {store.contract.billingStatus}
                            </span>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                              {store.contract.onboardingStatus || 'onboarding未設定'}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-3 inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">
                            契約未作成
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:items-end">
                      {store.contract && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCreateCheckout(store.contract.contractId || store.contract.id)}
                            disabled={checkoutLoadingContractId === (store.contract.contractId || store.contract.id)}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {checkoutLoadingContractId === (store.contract.contractId || store.contract.id)
                              ? 'Checkout作成中...'
                              : 'Checkoutを作成'}
                            <ChevronRight size={16} strokeWidth={3} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSyncContract(store.contract.contractId || store.contract.id)}
                            disabled={syncLoadingContractId === (store.contract.contractId || store.contract.id)}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-amber-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {syncLoadingContractId === (store.contract.contractId || store.contract.id)
                              ? 'Stripe同期中...'
                              : 'Stripe同期'}
                            <ChevronRight size={16} strokeWidth={3} />
                          </button>

                          {store.contract.stripeCustomerId ? (
                            <button
                              type="button"
                              onClick={() => handleOpenBillingPortal(store.contract.contractId || store.contract.id)}
                              disabled={portalLoadingContractId === (store.contract.contractId || store.contract.id)}
                              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {portalLoadingContractId === (store.contract.contractId || store.contract.id)
                                ? 'Portal作成中...'
                                : 'Billing Portalを開く'}
                              <ChevronRight size={16} strokeWidth={3} />
                            </button>
                          ) : (
                            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-xs font-black text-slate-400">
                              Billing PortalはCheckout作成後に利用できます
                            </div>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => onOpenStoreAdmin?.(store.id)}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95"
                      >
                        <Store size={16} strokeWidth={3} />
                        店舗管理を開く
                        <ChevronRight size={16} strokeWidth={3} />
                      </button>
                    </div>
                  </article>
                ))}

                {!organization.stores.length && (
                  <div className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-400">
                    この組織に紐づく店舗はまだありません。
                  </div>
                )}
              </div>
            </section>
          ))}

          {!organizationCards.length && !error && (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <p className="text-sm font-bold text-slate-500">
                組織・店舗がまだ登録されていません。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlatformAdminPage;
