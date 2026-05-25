import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
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

const toSafeIdSegment = (value, fallback = 'item') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  return normalized || `${fallback}_${Math.random().toString(36).substring(2, 7)}`;
};

const createOrganizationIdFromLead = (lead) => `org_${toSafeIdSegment(lead.companyName || lead.storeName, 'organization')}`;
const createStoreIdFromLead = (lead) => `store_${toSafeIdSegment(lead.storeName, 'store')}`;

const PLATFORM_LEAD_STATUSES = [
  { value: 'new', label: 'new' },
  { value: 'contacted', label: 'contacted' },
  { value: 'demo_scheduled', label: 'demo_scheduled' },
  { value: 'converted_to_store', label: 'converted_to_store' },
  { value: 'contract_created', label: 'contract_created' },
  { value: 'lost', label: 'lost' }
];

const getLeadStatusClassName = (status) => {
  if (status === 'new') return 'bg-emerald-50 text-emerald-700';
  if (status === 'contacted') return 'bg-blue-50 text-blue-700';
  if (status === 'demo_scheduled') return 'bg-purple-50 text-purple-700';
  if (status === 'converted_to_store') return 'bg-slate-100 text-slate-600';
  if (status === 'contract_created') return 'bg-indigo-50 text-indigo-700';
  if (status === 'lost') return 'bg-red-50 text-red-600';
  return 'bg-slate-100 text-slate-500';
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
  const [leads, setLeads] = useState([]);
  const [checkoutLoadingContractId, setCheckoutLoadingContractId] = useState('');
  const [portalLoadingContractId, setPortalLoadingContractId] = useState('');
  const [syncLoadingContractId, setSyncLoadingContractId] = useState('');
  const [organizationCreating, setOrganizationCreating] = useState(false);
  const [storeCreating, setStoreCreating] = useState(false);
  const [leadCreatingId, setLeadCreatingId] = useState('');
  const [leadUpdatingId, setLeadUpdatingId] = useState('');
  const [organizationForm, setOrganizationForm] = useState({
    organizationId: '',
    name: '',
    ownerEmail: '',
    type: 'single',
    status: 'active'
  });
  const [storeForm, setStoreForm] = useState({
    storeId: '',
    organizationId: '',
    name: '',
    address: '',
    tel: '',
    status: 'active'
  });
  const [contractCreating, setContractCreating] = useState(false);
  const [contractForm, setContractForm] = useState({
    organizationId: '',
    storeId: '',
    planId: 'standard',
    initialSetupFee: '100000',
    salesChannel: 'admin_created'
  });
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

  const handleUpdateLeadStatus = async (lead, nextStatus) => {
    if (!lead?.id || !nextStatus || lead.status === nextStatus) return;

    setLeadUpdatingId(lead.id);
    setError('');

    try {
      await setDoc(doc(db, 'platformSignupLeads', lead.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
        ...(nextStatus === 'contacted' ? { contactedAt: serverTimestamp() } : {}),
        ...(nextStatus === 'demo_scheduled' ? { demoScheduledAt: serverTimestamp() } : {}),
        ...(nextStatus === 'contract_created' ? { contractMarkedAt: serverTimestamp() } : {}),
        ...(nextStatus === 'lost' ? { lostAt: serverTimestamp() } : {})
      }, { merge: true });

      setLeads((current) => current.map((item) => (
        item.id === lead.id ? { ...item, status: nextStatus } : item
      )));
    } catch (updateError) {
      console.error('[PlatformAdminPage] lead status update failed', updateError);
      setError(updateError.message || 'リードステータスの更新に失敗しました。');
    } finally {
      setLeadUpdatingId('');
    }
  };

  const handleApplyLeadToForms = (lead) => {
    if (!lead) return;

    if (lead.organizationId || lead.storeId || lead.status === 'converted_to_store') {
      setError('このリードはすでに組織・店舗作成済みです。既存の組織・店舗カードを確認してください。');
      return;
    }

    const nextOrganizationId = createOrganizationIdFromLead(lead);
    const nextStoreId = createStoreIdFromLead(lead);

    setOrganizationForm({
      organizationId: nextOrganizationId,
      name: lead.companyName || lead.storeName || '',
      ownerEmail: lead.email || '',
      type: 'single',
      status: 'active'
    });

    setStoreForm({
      storeId: nextStoreId,
      organizationId: nextOrganizationId,
      name: lead.storeName || '',
      address: '',
      tel: lead.tel || '',
      status: 'active'
    });

    setContractForm((current) => ({
      ...current,
      organizationId: nextOrganizationId,
      storeId: nextStoreId,
      planId: current.planId || 'standard',
      salesChannel: lead.salesChannel || 'direct'
    }));

    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCreateOrganizationAndStoreFromLead = async (lead) => {
    if (!lead) return;

    const nextOrganizationId = createOrganizationIdFromLead(lead);
    const nextStoreId = createStoreIdFromLead(lead);
    const organizationName = lead.companyName || lead.storeName || '';
    const storeName = lead.storeName || '';

    if (!organizationName || !storeName) {
      setError('リードの会社名または店舗名が不足しています。');
      return;
    }

    if (lead.organizationId || lead.storeId || lead.status === 'converted_to_store') {
      setError('このリードはすでに組織・店舗作成済みです。必要な場合は既存の組織・店舗を確認してください。');
      return;
    }

    if (organizations.some((organization) => organization.id === nextOrganizationId)) {
      setError('同じ組織IDがすでに存在します。必要に応じてフォームへ反映してIDを手動調整してください。');
      return;
    }

    if (stores.some((store) => store.id === nextStoreId)) {
      setError('同じ店舗IDがすでに存在します。必要に応じてフォームへ反映してIDを手動調整してください。');
      return;
    }

    setLeadCreatingId(lead.id);
    setError('');

    try {
      await setDoc(doc(db, 'platformOrganizations', nextOrganizationId), {
        id: nextOrganizationId,
        name: organizationName,
        ownerEmail: lead.email || '',
        type: 'single',
        status: 'active',
        leadId: lead.id,
        createdBy: auth.currentUser?.uid || 'super_admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: false });

      await setDoc(doc(db, 'stores', nextStoreId), {
        id: nextStoreId,
        organizationId: nextOrganizationId,
        organizationName,
        organizationType: 'single',
        status: 'active',
        leadId: lead.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: false });

      await setDoc(doc(db, 'stores', nextStoreId, 'settings', 'basic'), {
        name: storeName,
        address: '',
        tel: lead.tel || '',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      await setDoc(doc(db, 'platformSignupLeads', lead.id), {
        status: 'converted_to_store',
        organizationId: nextOrganizationId,
        storeId: nextStoreId,
        convertedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      window.location.reload();
    } catch (createError) {
      console.error('[PlatformAdminPage] create organization/store from lead failed', createError);
      setError(createError.message || 'リードから組織・店舗の作成に失敗しました。');
    } finally {
      setLeadCreatingId('');
    }
  };

  const handleCreateOrganization = async (event) => {
    event.preventDefault();

    const organizationId = String(organizationForm.organizationId || '').trim();
    const name = String(organizationForm.name || '').trim();
    const ownerEmail = String(organizationForm.ownerEmail || '').trim();
    const type = String(organizationForm.type || 'single').trim();
    const status = String(organizationForm.status || 'active').trim();

    if (!organizationId || !name) {
      setError('組織IDと組織名を入力してください。');
      return;
    }

    if (organizations.some((organization) => organization.id === organizationId)) {
      setError('同じ組織IDがすでに存在します。');
      return;
    }

    setOrganizationCreating(true);
    setError('');

    try {
      await setDoc(doc(db, 'platformOrganizations', organizationId), {
        id: organizationId,
        name,
        ownerEmail,
        type,
        status,
        createdBy: auth.currentUser?.uid || 'super_admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: false });

      window.location.reload();
    } catch (createError) {
      console.error('[PlatformAdminPage] organization creation failed', createError);
      setError(createError.message || '組織作成に失敗しました。');
    } finally {
      setOrganizationCreating(false);
    }
  };

  const handleCreateStore = async (event) => {
    event.preventDefault();

    const storeId = String(storeForm.storeId || '').trim();
    const organizationId = String(storeForm.organizationId || '').trim();
    const name = String(storeForm.name || '').trim();
    const address = String(storeForm.address || '').trim();
    const tel = String(storeForm.tel || '').trim();
    const status = String(storeForm.status || 'active').trim();
    const organization = organizations.find((item) => item.id === organizationId);

    if (!storeId || !organizationId || !name || !organization) {
      setError('店舗ID・組織・店舗名を入力してください。');
      return;
    }

    if (stores.some((store) => store.id === storeId)) {
      setError('同じ店舗IDがすでに存在します。');
      return;
    }

    setStoreCreating(true);
    setError('');

    try {
      await setDoc(doc(db, 'stores', storeId), {
        id: storeId,
        organizationId,
        organizationName: organization.name,
        organizationType: organization.type || 'single',
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: false });

      await setDoc(doc(db, 'stores', storeId, 'settings', 'basic'), {
        name,
        address,
        tel,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      window.location.reload();
    } catch (createError) {
      console.error('[PlatformAdminPage] store creation failed', createError);
      setError(createError.message || '店舗作成に失敗しました。');
    } finally {
      setStoreCreating(false);
    }
  };

  const handleCreateContract = async (event) => {
    event.preventDefault();

    const organizationId = String(contractForm.organizationId || '').trim();
    const storeId = String(contractForm.storeId || '').trim();
    const planId = String(contractForm.planId || 'standard').trim();
    const selectedPlan = plans.find((plan) => plan.id === planId);
    const initialSetupFee = Math.max(Number(contractForm.initialSetupFee) || 0, 0);
    const salesChannel = String(contractForm.salesChannel || 'admin_created').trim();

    if (!organizationId || !storeId || !planId || !selectedPlan) {
      setError('組織・店舗・プランを選択してください。');
      return;
    }

    const contractId = `${organizationId}_${storeId}_${planId}`;

    setContractCreating(true);
    setError('');

    try {
      const existingContract = contracts.find((contract) => contract.contractId === contractId || contract.id === contractId);
      if (existingContract) {
        setError('この組織・店舗・プランの契約はすでに作成されています。');
        return;
      }

      await setDoc(doc(db, 'platformContracts', contractId), {
        contractId,
        organizationId,
        storeId,
        planId,
        planName: selectedPlan.name || planId,
        status: 'draft',
        billingStatus: 'not_started',
        monthlyAmount: Number(selectedPlan.monthlyAmount) || 0,
        initialSetupFee,
        currency: selectedPlan.currency || 'jpy',
        salesChannel,
        partnerId: '',
        referralCode: '',
        stripe: {
          customerId: '',
          subscriptionId: '',
          subscriptionItemId: '',
          productId: selectedPlan.stripeProductId || '',
          priceId: selectedPlan.stripePriceId || '',
          latestInvoiceId: '',
          checkoutSessionId: '',
          cancelAtPeriodEnd: false
        },
        commission: {
          eligible: false,
          partnerId: '',
          initialRate: 0,
          monthlyRate: 0,
          initialCommissionAmount: 0,
          monthlyCommissionAmount: 0,
          durationMonths: null
        },
        onboarding: {
          status: 'created',
          storeProfile: false,
          menuCreated: false,
          tableQrCreated: false,
          kitchenChecked: false,
          printerChecked: false,
          testOrderCompleted: false,
          billingConnected: false
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: false });

      window.location.reload();
    } catch (createError) {
      console.error('[PlatformAdminPage] contract creation failed', createError);
      setError(createError.message || '契約作成に失敗しました。');
    } finally {
      setContractCreating(false);
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
        const [organizationSnapshot, storeSnapshot, planSnapshot, contractSnapshot, leadSnapshot] = await Promise.all([
          getDocs(collection(db, 'platformOrganizations')),
          getDocs(collection(db, 'stores')),
          getDocs(collection(db, 'platformPlans')),
          getDocs(collection(db, 'platformContracts')),
          getDocs(collection(db, 'platformSignupLeads'))
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

        const leadRows = leadSnapshot.docs.map((leadDoc) => {
          const data = leadDoc.data() || {};
          const createdAt = data.createdAt?.toDate?.() || null;

          return {
            id: leadDoc.id,
            companyName: data.companyName || '',
            storeName: data.storeName || '',
            contactName: data.contactName || '',
            email: data.email || '',
            tel: data.tel || '',
            message: data.message || '',
            status: data.status || 'new',
            salesChannel: data.salesChannel || '',
            source: data.source || '',
            organizationId: data.organizationId || '',
            storeId: data.storeId || '',
            createdAt,
            createdAtText: createdAt
              ? createdAt.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
              : ''
          };
        }).sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));

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
          setLeads(leadRows);
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
              <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-500">
                  Leads
                </div>
                <div className="mt-1 text-2xl font-black text-emerald-700">
                  {leads.length}
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
              <h2 className="text-lg font-black text-slate-900">申込リード</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                /signup から送信された無料デモ・導入相談の申込です。
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">
              {leads.filter((lead) => lead.status === 'new').length}件 new
            </div>
          </div>

          <div className="grid gap-3">
            {leads.slice(0, 8).map((lead) => (
              <article key={lead.id} className="rounded-2xl border border-slate-100 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-slate-900">
                        {lead.storeName || '店舗名未入力'}
                      </h3>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${getLeadStatusClassName(lead.status)}`}>
                        {lead.status}
                      </span>
                    </div>

                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {lead.companyName || '会社名未入力'} / {lead.contactName || '担当者未入力'}
                    </p>

                    <div className="mt-3 grid gap-2 text-xs font-bold text-slate-500 md:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Email: {lead.email || '-'}
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Tel: {lead.tel || '-'}
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Source: {lead.source || '-'}
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        Created: {lead.createdAtText || '-'}
                      </div>
                    </div>

                    {lead.message && (
                      <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-700">
                        {lead.message}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-black text-slate-400">
                      {lead.salesChannel || 'direct'}
                    </div>

                    <select
                      value={lead.status}
                      onChange={(event) => handleUpdateLeadStatus(lead, event.target.value)}
                      disabled={leadUpdatingId === lead.id}
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 outline-none focus:border-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {PLATFORM_LEAD_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => handleApplyLeadToForms(lead)}
                      disabled={Boolean(lead.organizationId || lead.storeId) || lead.status === 'converted_to_store'}
                      className="inline-flex h-10 items-center justify-center rounded-2xl bg-slate-900 px-4 text-xs font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {(lead.organizationId || lead.storeId || lead.status === 'converted_to_store')
                        ? '反映済み'
                        : 'フォームへ反映'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCreateOrganizationAndStoreFromLead(lead)}
                      disabled={leadCreatingId === lead.id || Boolean(lead.organizationId || lead.storeId) || lead.status === 'converted_to_store'}
                      className="inline-flex h-10 items-center justify-center rounded-2xl bg-emerald-600 px-4 text-xs font-black text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {leadCreatingId === lead.id
                        ? '作成中...'
                        : (lead.organizationId || lead.storeId || lead.status === 'converted_to_store')
                          ? '作成済み'
                          : '組織・店舗を作成'}
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {!leads.length && (
              <div className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-400">
                申込リードはまだありません。
              </div>
            )}
          </div>
        </div>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 border-b border-slate-100 pb-4">
              <h2 className="text-lg font-black text-slate-900">組織作成</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                新しい運営組織を作成します。
              </p>
            </div>

            <form onSubmit={handleCreateOrganization} className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">組織ID</span>
                  <input
                    value={organizationForm.organizationId}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, organizationId: event.target.value.trim() }))}
                    placeholder="例: org_example"
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">組織名</span>
                  <input
                    value={organizationForm.name}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="例: TABLE HAUS"
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-xs font-black text-slate-400">オーナーメール</span>
                <input
                  value={organizationForm.ownerEmail}
                  onChange={(event) => setOrganizationForm((current) => ({ ...current, ownerEmail: event.target.value }))}
                  placeholder="owner@example.com"
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">種別</span>
                  <select
                    value={organizationForm.type}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, type: event.target.value }))}
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  >
                    <option value="single">single</option>
                    <option value="multi_store">multi_store</option>
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">ステータス</span>
                  <select
                    value={organizationForm.status}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, status: event.target.value }))}
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                disabled={organizationCreating}
                className="h-12 rounded-2xl bg-slate-900 px-6 text-sm font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {organizationCreating ? '組織作成中...' : '組織を作成する'}
              </button>
            </form>
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 border-b border-slate-100 pb-4">
              <h2 className="text-lg font-black text-slate-900">店舗作成</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                組織に紐づく店舗を作成します。
              </p>
            </div>

            <form onSubmit={handleCreateStore} className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">店舗ID</span>
                  <input
                    value={storeForm.storeId}
                    onChange={(event) => setStoreForm((current) => ({ ...current, storeId: event.target.value.trim() }))}
                    placeholder="例: store_example"
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">組織</span>
                  <select
                    value={storeForm.organizationId}
                    onChange={(event) => setStoreForm((current) => ({ ...current, organizationId: event.target.value }))}
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  >
                    <option value="">選択</option>
                    {organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-xs font-black text-slate-400">店舗名</span>
                <input
                  value={storeForm.name}
                  onChange={(event) => setStoreForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例: TABLE HAUS"
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">住所</span>
                  <input
                    value={storeForm.address}
                    onChange={(event) => setStoreForm((current) => ({ ...current, address: event.target.value }))}
                    placeholder="任意"
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-black text-slate-400">電話番号</span>
                  <input
                    value={storeForm.tel}
                    onChange={(event) => setStoreForm((current) => ({ ...current, tel: event.target.value }))}
                    placeholder="任意"
                    className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-xs font-black text-slate-400">ステータス</span>
                <select
                  value={storeForm.status}
                  onChange={(event) => setStoreForm((current) => ({ ...current, status: event.target.value }))}
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>

              <button
                type="submit"
                disabled={storeCreating}
                className="h-12 rounded-2xl bg-slate-900 px-6 text-sm font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {storeCreating ? '店舗作成中...' : '店舗を作成する'}
              </button>
            </form>
          </section>
        </div>

        <div className="mb-6 rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-black text-slate-900">契約作成</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                組織・店舗・プランを選択して、Mobile Orderの契約レコードを作成します。
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateContract} className="grid gap-3 md:grid-cols-5">
            <label className="grid gap-2">
              <span className="text-xs font-black text-slate-400">組織</span>
              <select
                value={contractForm.organizationId}
                onChange={(event) => setContractForm((current) => ({ ...current, organizationId: event.target.value }))}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
              >
                <option value="">選択</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-slate-400">店舗</span>
              <select
                value={contractForm.storeId}
                onChange={(event) => setContractForm((current) => ({ ...current, storeId: event.target.value }))}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
              >
                <option value="">選択</option>
                {stores
                  .filter((store) => !contractForm.organizationId || store.organizationId === contractForm.organizationId)
                  .map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-slate-400">プラン</span>
              <select
                value={contractForm.planId}
                onChange={(event) => {
                  const nextPlan = plans.find((plan) => plan.id === event.target.value);
                  setContractForm((current) => ({
                    ...current,
                    planId: event.target.value,
                    initialSetupFee: String(nextPlan?.initialSetupFeeDefault || current.initialSetupFee || '100000')
                  }));
                }}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-slate-400">初期設定費</span>
              <input
                type="number"
                min="0"
                value={contractForm.initialSetupFee}
                onChange={(event) => setContractForm((current) => ({ ...current, initialSetupFee: event.target.value }))}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-slate-400">販売経路</span>
              <select
                value={contractForm.salesChannel}
                onChange={(event) => setContractForm((current) => ({ ...current, salesChannel: event.target.value }))}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
              >
                <option value="admin_created">admin_created</option>
                <option value="direct">direct</option>
                <option value="partner">partner</option>
              </select>
            </label>

            <div className="md:col-span-5">
              <button
                type="submit"
                disabled={contractCreating}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-6 text-sm font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {contractCreating ? '契約作成中...' : '契約を作成する'}
              </button>
            </div>
          </form>
        </div>

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
                          <div className="mt-3 space-y-3">
                            <div className="flex flex-wrap gap-2 text-xs font-black">
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                                {store.contract.planName || store.contract.planId}
                              </span>
                              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                                ¥{store.contract.monthlyAmount.toLocaleString()} / 月
                              </span>
                              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                                billing: {store.contract.billingStatus}
                              </span>
                              <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                                onboarding: {store.contract.onboardingStatus || '未設定'}
                              </span>
                            </div>

                            <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 text-[11px] font-bold text-slate-500 md:grid-cols-2">
                              <div>
                                <span className="text-slate-400">Contract</span>
                                <div className="mt-0.5 break-all text-slate-700">
                                  {store.contract.contractId || store.contract.id}
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400">Status</span>
                                <div className="mt-0.5 text-slate-700">
                                  {store.contract.status} / {store.contract.billingStatus}
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400">Stripe Customer</span>
                                <div className="mt-0.5 break-all text-slate-700">
                                  {store.contract.stripeCustomerId || '-'}
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400">Subscription</span>
                                <div className="mt-0.5 break-all text-slate-700">
                                  {store.contract.stripeSubscriptionId || '-'}
                                </div>
                              </div>
                            </div>

                            {!store.contract.stripeSubscriptionId && (
                              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-black leading-5 text-amber-700">
                                次の状態：Checkout決済が完了するとSubscriptionが作成され、WebhookまたはStripe同期でactiveになります。
                              </div>
                            )}
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
