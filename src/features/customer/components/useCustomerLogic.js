import { useEffect, useMemo, useRef, useState } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { useCustomerReceipts } from '../hooks/useCustomerReceipts';
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  getDoc,
  onSnapshot
} from 'firebase/firestore';

import { buildJoinUrl } from '../../../app/routing/appRouteState';
import { auth, db, initializeAuth } from '../../../shared/api/firebase/client';
import { getBusinessStatus } from '../../../shared/utils/businessHours';
import { decorateMenuItemAvailability } from '../../../shared/utils/menuAvailability';
import { useBusinessSettings, useCategoryData, useMenuData, usePeriodData } from '../../store/hooks';
import { prefetchCustomerStoreData } from '../../store/services/storePrefetchService';
import { useCustomerCart } from '../hooks/useCustomerCart';
import { useCustomerCurrentPeriod } from '../hooks/useCustomerCurrentPeriod';
import { useTableMenuOverride } from '../hooks/useTableMenuOverride';
import { useCustomerOrderHistory } from '../hooks/useCustomerOrderHistory';
import { useCustomerSessionState } from '../hooks/useCustomerSessionState';
import { ensureSessionInvite as ensureSessionInviteRequest } from '../services/customerInviteService';
import {
  bootstrapCustomerSession,
  restoreCustomerSessionMember
} from '../services/customerSessionService';
import {
  clearStoredTableEntryGuard,
  getStoredTableEntryGuard,
  setStoredTableEntryGuard
} from '../utils/entryGuards';
import {
  clearStoredParticipantIdentitiesForSession,
  getPreferredParticipantIdentity,
  linkStoredParticipantIdentityToTable,
  removeStoredParticipantIdentityForTable,
  setStoredParticipantIdentityForSession,
  setStoredParticipantIdentityForTable
} from '../utils/participantIdentity';
import {
  getStoredInviteToken,
  removeStoredInviteToken,
  setStoredInviteToken
} from '../utils/sessionInvite';

const BOOTSTRAP_TIMEOUT_MS = 12000;

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
  let timeoutId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .then((result) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      return result;
    })
    .catch((error) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      throw error;
    });
};

const safeCall = (fn, fallback = null, label = 'safeCall') => {
  try {
    return fn();
  } catch (error) {
    console.warn(`[useCustomerLogic] ${label} failed`, error);
    return fallback;
  }
};

const safeGetStoredTableEntryGuard = (tableContext) => (
  safeCall(() => getStoredTableEntryGuard(tableContext), null, 'getStoredTableEntryGuard')
);

const safeClearStoredTableEntryGuard = (tableContext) => {
  safeCall(() => clearStoredTableEntryGuard(tableContext), undefined, 'clearStoredTableEntryGuard');
};

const safeSetStoredTableEntryGuard = (tableContext, sessionId) => {
  safeCall(() => setStoredTableEntryGuard(tableContext, sessionId), undefined, 'setStoredTableEntryGuard');
};

const safeGetPreferredParticipantIdentity = (params) => (
  safeCall(() => getPreferredParticipantIdentity(params), null, 'getPreferredParticipantIdentity')
);

const safeGetStoredInviteToken = (sessionId) => (
  safeCall(() => getStoredInviteToken(sessionId), '', 'getStoredInviteToken') || ''
);

const safeSetStoredInviteToken = (sessionId, token) => {
  safeCall(() => setStoredInviteToken(sessionId, token), undefined, 'setStoredInviteToken');
};

const safeRemoveStoredInviteToken = (sessionId) => {
  safeCall(() => removeStoredInviteToken(sessionId), undefined, 'removeStoredInviteToken');
};

const safeClearStoredParticipantIdentitiesForSession = (sessionId) => {
  safeCall(
    () => clearStoredParticipantIdentitiesForSession(sessionId),
    undefined,
    'clearStoredParticipantIdentitiesForSession'
  );
};

const safeSetStoredParticipantIdentityForSession = (sessionId, identity) => {
  safeCall(
    () => setStoredParticipantIdentityForSession(sessionId, identity),
    undefined,
    'setStoredParticipantIdentityForSession'
  );
};

const safeSetStoredParticipantIdentityForTable = (params, identity) => {
  safeCall(
    () => setStoredParticipantIdentityForTable(params, identity),
    undefined,
    'setStoredParticipantIdentityForTable'
  );
};

const safeLinkStoredParticipantIdentityToTable = (params) => {
  safeCall(
    () => linkStoredParticipantIdentityToTable(params),
    undefined,
    'linkStoredParticipantIdentityToTable'
  );
};

const safeRemoveStoredParticipantIdentityForTable = (params) => {
  safeCall(
    () => removeStoredParticipantIdentityForTable(params),
    undefined,
    'removeStoredParticipantIdentityForTable'
  );
};

export const useCustomerLogic = (
  sessionId,
  storeId,
  entryTableId = null,
  entryTableToken = null,
  onSessionCreated = null
) => {
  const isEntryPreview = Boolean(!sessionId && storeId && entryTableId);

  const entryTableContext = useMemo(() => (
    isEntryPreview
      ? { storeId, tableId: entryTableId, tableToken: entryTableToken }
      : null
  ), [entryTableId, entryTableToken, isEntryPreview, storeId]);

  // iPhone / Safari / WebView 対策：
  // useState 初期化中に localStorage 系を読まない。
  const [entryBootstrapStatus, setEntryBootstrapStatus] = useState('preparing');
  const [entryBootstrapError, setEntryBootstrapError] = useState('');
  const onSessionCreatedRef = useRef(onSessionCreated);

  const {
    user,
    loading,
    tableNumber,
    tableDisplayName,
    sessionStatus,
    sessionHostId,
    isSessionEnded,
    sessionError,
    isCurrentUserSessionMember
  } = useCustomerSessionState({ sessionId, storeId });

  const [sessionParticipantIdentity, setSessionParticipantIdentity] = useState(null);

  const storedParticipantIdentity = useMemo(() => (
    safeGetPreferredParticipantIdentity({
      sessionId,
      storeId,
      tableId: entryTableId || tableNumber || null
    })
  ), [entryTableId, sessionId, storeId, tableNumber]);

  const preferredParticipantIdentity = sessionParticipantIdentity || storedParticipantIdentity;

  const { menuItems = [], loading: menuLoading } = useMenuData(storeId);
  const { categories = [], loading: categoryLoading } = useCategoryData(storeId);
  const { periods = [], loading: periodsLoading } = usePeriodData(storeId);
  const { settings: businessSettings, loading: businessLoading } = useBusinessSettings(storeId);

  const [view, setView] = useState('welcome');
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [optionSelections, setOptionSelections] = useState({});
  const [optionQuantity, setOptionQuantity] = useState(1);
  const [toast, setToast] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [isMembershipRestoring, setIsMembershipRestoring] = useState(false);

  const [basicSettings, setBasicSettings] = useState(null);

  // 人数モーダル判定の正規ソース。
  // sessions/{sessionId}.partySize があるかどうかを見る。
  const [sessionPartySize, setSessionPartySize] = useState(null);
  const [sessionPartySizeLoaded, setSessionPartySizeLoaded] = useState(false);
  const [crossSellSettings, setCrossSellSettings] = useState(null);

  useEffect(() => {
    if (!storeId) return undefined;

    let isMounted = true;

    const loadBasicSettings = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'stores', storeId, 'settings', 'basic'));
        if (!isMounted) return;

        setBasicSettings(snapshot.exists() ? snapshot.data() : null);
      } catch (error) {
        console.error('Error loading basic settings:', error);
        if (isMounted) setBasicSettings(null);
      }
    };

    loadBasicSettings();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return undefined;

    let isMounted = true;

    const loadCrossSellSettings = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'stores', storeId, 'settings', 'crossSell'));

        if (!isMounted) return;

        setCrossSellSettings(snapshot.exists() ? snapshot.data() : null);
      } catch (error) {
        console.error('Error loading cross sell settings:', error);
        if (isMounted) setCrossSellSettings(null);
      }
    };

    loadCrossSellSettings();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !sessionId) {
      setSessionPartySize(null);
      setSessionPartySizeLoaded(false);
      return undefined;
    }

    setSessionPartySizeLoaded(false);

    const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);

    const unsubscribe = onSnapshot(
      sessionRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        const partySizeValue = data?.partySize;
        const numericPartySize = Number(partySizeValue);

        setSessionPartySize(
          Number.isFinite(numericPartySize) && numericPartySize > 0
            ? numericPartySize
            : null
        );

        setSessionPartySizeLoaded(true);
      },
      (error) => {
        console.error('Error loading customer session party size:', error);
        setSessionPartySize(null);
        setSessionPartySizeLoaded(true);
      }
    );

    return () => unsubscribe();
  }, [storeId, sessionId]);

  useEffect(() => {
    onSessionCreatedRef.current = onSessionCreated;
  }, [onSessionCreated]);

  useEffect(() => {
    if (!isEntryPreview || !entryTableContext) return undefined;

    let isMounted = true;

    const bootstrapEntrySession = async () => {
      setEntryBootstrapStatus('preparing');
      setEntryBootstrapError('');
      prefetchCustomerStoreData(storeId).catch(() => {});

      try {
        await withTimeout(
          initializeAuth(),
          BOOTSTRAP_TIMEOUT_MS,
          '認証情報の確認に時間がかかっています。'
        );

        let nextUser = auth.currentUser;

        if (!nextUser) {
          const credential = await withTimeout(
            signInAnonymously(auth),
            BOOTSTRAP_TIMEOUT_MS,
            '認証情報の取得に時間がかかっています。'
          );

          nextUser = credential.user;
        }

        const idToken = await withTimeout(
          nextUser.getIdToken(),
          BOOTSTRAP_TIMEOUT_MS,
          '認証情報の取得に時間がかかっています。'
        );

        const result = await withTimeout(
          bootstrapCustomerSession({
            idToken,
            storeId,
            tableId: entryTableId,
            tableToken: entryTableToken,

            // タブを閉じた本人の復元を可能にするため participantToken は送る。
            // ただしサーバー側で「現在テーブルの active session と一致する token だけ restore」する前提。
            participantToken: preferredParticipantIdentity?.participantToken || ''
          }),
          BOOTSTRAP_TIMEOUT_MS,
          'セッション開始に時間がかかっています。'
        );

        if (!isMounted) return;

        if (result.action === 'restore' || result.action === 'created') {
          if (result.participantToken && result.participantId) {
            const identity = {
              sessionId: result.sessionId,
              participantToken: result.participantToken,
              participantId: result.participantId
            };

            safeSetStoredParticipantIdentityForSession(result.sessionId, identity);
            safeSetStoredParticipantIdentityForTable(
              { storeId, tableId: entryTableId },
              identity
            );
            setSessionParticipantIdentity(identity);
          }

          safeClearStoredTableEntryGuard(entryTableContext);

          const resolvedInviteToken = result.inviteToken || safeGetStoredInviteToken(result.sessionId);

          if (resolvedInviteToken) {
            safeSetStoredInviteToken(result.sessionId, resolvedInviteToken);
          }

          onSessionCreatedRef.current?.(result.sessionId, entryTableId, entryTableToken);
          return;
        }

        if (result.action === 'occupied' || result.action === 'blocked_reuse') {
          safeRemoveStoredParticipantIdentityForTable({
            storeId,
            tableId: entryTableId
          });

          safeClearStoredTableEntryGuard(entryTableContext);

          setEntryBootstrapStatus('locked');
          return;
        }

        if (result.action === 'disabled') {
          setEntryBootstrapStatus('disabled');
          return;
        }

        if (result.action === 'stopped') {
          setEntryBootstrapStatus('stopped');
          return;
        }

        setEntryBootstrapStatus('error');
        setEntryBootstrapError('テーブル情報の確認に失敗しました。');
      } catch (error) {
        console.error('Customer entry bootstrap error:', error);

        if (!isMounted) return;

        setEntryBootstrapStatus('error');
        setEntryBootstrapError(error.message || 'テーブル情報の確認に失敗しました。');
      }
    };

    bootstrapEntrySession();

    return () => {
      isMounted = false;
    };
  }, [
    entryTableContext,
    entryTableId,
    entryTableToken,
    isEntryPreview,
    preferredParticipantIdentity?.participantToken,
    storeId
  ]);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const {
    cart,
    setCart,
    cartTotal,
    confirmAddToCart,
    decreaseCartItem,
    removeCartItem,
    normalizeCartItems
  } = useCustomerCart(showToast);

  const safeCart = Array.isArray(cart) ? cart : [];
  const customerParticipantId = preferredParticipantIdentity?.participantId || '';
  const resolvedTableNumber = tableNumber || entryTableId || null;
  const baseCurrentPeriod = useCustomerCurrentPeriod(periods);
  const tableMenuOverride = useTableMenuOverride({
    storeId,
    tableId: resolvedTableNumber,
    periods
  });
  const currentPeriod = tableMenuOverride?.period || baseCurrentPeriod;
  const businessStatus = useMemo(() => getBusinessStatus(businessSettings), [businessSettings]);

  const {
    orderHistory,
    historyLoading,
    myTotal,
    grandTotal,
    myOrderHistory
  } = useCustomerOrderHistory({
    sessionId,
    storeId,
    user,
    participantId: customerParticipantId
  });

const {
  receipts: customerReceipts,
  latestReceipt,
  receiptsLoading
} = useCustomerReceipts({
  sessionId,
  storeId,
  participantId: customerParticipantId,
  userId: user?.uid || ''
});

  const contentLoading = menuLoading || categoryLoading || periodsLoading || businessLoading;

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0].id);
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    if (resolvedTableNumber) {
      setView((currentView) => (currentView === 'welcome' ? 'menu' : currentView));
    }
  }, [resolvedTableNumber]);

  useEffect(() => {
    setInviteToken(safeGetStoredInviteToken(sessionId));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionParticipantIdentity?.sessionId || !sessionId) return;

    if (String(sessionParticipantIdentity.sessionId) !== String(sessionId)) {
      setSessionParticipantIdentity(null);
    }
  }, [sessionId, sessionParticipantIdentity?.sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    if (sessionStatus !== 'active' || isSessionEnded) {
      safeRemoveStoredInviteToken(sessionId);
      setInviteToken('');
      setSessionParticipantIdentity(null);

      if (isSessionEnded) {
        safeClearStoredParticipantIdentitiesForSession(sessionId);

        if (storeId && resolvedTableNumber) {
          safeRemoveStoredParticipantIdentityForTable({
            storeId,
            tableId: resolvedTableNumber
          });
        }

        if (storeId && entryTableId) {
          safeRemoveStoredParticipantIdentityForTable({
            storeId,
            tableId: entryTableId
          });
        }
      }
    }
  }, [
    entryTableId,
    resolvedTableNumber,
    sessionId,
    sessionStatus,
    isSessionEnded,
    storeId
  ]);

  useEffect(() => {
    if (
      !sessionId
      || !storeId
      || !user
      || sessionStatus !== 'active'
      || !preferredParticipantIdentity?.participantToken
      || isCurrentUserSessionMember !== false
    ) {
      setIsMembershipRestoring(false);
      return undefined;
    }

    let isMounted = true;

    const restoreMembership = async () => {
      setIsMembershipRestoring(true);

      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;

        const result = await restoreCustomerSessionMember({
          idToken,
          storeId,
          sessionId,
          participantToken: preferredParticipantIdentity.participantToken
        });

        if (!isMounted) return;

        if (result.participantToken && result.participantId) {
          const identity = {
            sessionId,
            participantToken: result.participantToken,
            participantId: result.participantId
          };

          safeSetStoredParticipantIdentityForSession(sessionId, identity);

          if (resolvedTableNumber) {
            safeSetStoredParticipantIdentityForTable(
              { storeId, tableId: resolvedTableNumber },
              identity
            );
          }

          setSessionParticipantIdentity(identity);
        }
      } catch (error) {
        console.error('Customer session membership restore error:', error);
      } finally {
        if (isMounted) setIsMembershipRestoring(false);
      }
    };

    restoreMembership();

    return () => {
      isMounted = false;
    };
  }, [
    isCurrentUserSessionMember,
    preferredParticipantIdentity?.participantToken,
    resolvedTableNumber,
    sessionId,
    sessionStatus,
    storeId,
    user
  ]);

  useEffect(() => {
    if (!sessionId || !storeId || !resolvedTableNumber || !preferredParticipantIdentity) return;

    safeLinkStoredParticipantIdentityToTable({
      sessionId,
      storeId,
      tableId: resolvedTableNumber
    });
  }, [preferredParticipantIdentity, resolvedTableNumber, sessionId, storeId]);

  useEffect(() => {
    if (
      sessionStatus !== 'active' ||
      !sessionId ||
      !storeId ||
      !resolvedTableNumber ||
      !user ||
      user.uid !== sessionHostId ||
      inviteToken
    ) {
      return undefined;
    }

    let isMounted = true;

    const ensureInviteToken = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;

        const result = await ensureSessionInviteRequest({
          idToken,
          storeId,
          sessionId
        });

        if (!isMounted) return;

        safeSetStoredInviteToken(sessionId, result.inviteToken);
        setInviteToken(result.inviteToken);
      } catch {
        // 招待トークンの取得に失敗しても表示は維持する
      }
    };

    ensureInviteToken();

    return () => {
      isMounted = false;
    };
  }, [sessionId, storeId, resolvedTableNumber, user, sessionHostId, inviteToken, sessionStatus]);

  const getLocalDateKey = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isMenuItemCustomerVisible = (item, todayKey = getLocalDateKey()) => {
    const visibility = item?.customerVisibility || 'visible';

    if (visibility === 'hidden') {
      return false;
    }

    if (visibility !== 'scheduled') {
      return true;
    }

    const fromDate = String(item?.visibleFromDate || '').trim();
    const toDate = String(item?.visibleToDate || '').trim();

    if (fromDate && todayKey < fromDate) {
      return false;
    }

    if (toDate && todayKey > toDate) {
      return false;
    }

    return true;
  };

  const availableMenuItems = useMemo(
    () => menuItems.map((item) => decorateMenuItemAvailability(item)),
    [menuItems]
  );

  const customerVisibleMenuItems = useMemo(() => {
    const todayKey = getLocalDateKey();
    return availableMenuItems.filter((item) => isMenuItemCustomerVisible(item, todayKey));
  }, [availableMenuItems]);

  const filteredMenuItems = useMemo(() => {
    if (!activeCategory) return [];

    const timeAllowedItems = customerVisibleMenuItems.filter((item) => {
      if (!item.periods || item.periods.length === 0) return true;
      if (!currentPeriod) return false;
      return item.periods.includes(currentPeriod.id);
    });

    return timeAllowedItems.filter((item) => item.category === activeCategory);
  }, [customerVisibleMenuItems, currentPeriod, activeCategory]);

  const menuItemsById = useMemo(
    () => Object.fromEntries(customerVisibleMenuItems.map((item) => [item.id, item])),
    [customerVisibleMenuItems]
  );

  const inviteUrl = useMemo(() => {
    if (!sessionId || !storeId || !inviteToken) return '';
    return `${window.location.origin}${buildJoinUrl(sessionId, storeId, inviteToken)}`;
  }, [sessionId, storeId, inviteToken]);

  const inviteQrUrl = useMemo(() => {
    if (!inviteUrl) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(inviteUrl)}`;
  }, [inviteUrl]);

  const placeOrder = async () => {
    if (!sessionId) {
      showToast('セッション準備中です。少し待ってからお試しください。', 'error');
      return;
    }

    if (isProcessing || safeCart.length === 0 || !user || !resolvedTableNumber) return;

    if (isMembershipRestoring || isCurrentUserSessionMember === false) {
      showToast('接続を復元中です。少し待ってからお試しください。', 'error');
      return;
    }

    if (!customerParticipantId) {
      showToast('参加情報を準備中です。少し待ってからお試しください。', 'error');
      return;
    }

    if (!businessStatus.isTakingOrders) {
      showToast(businessStatus.message, 'error');
      return;
    }

    const unavailableItem = safeCart.find((item) => !menuItemsById[item.id]);
    if (unavailableItem) {
      showToast(`${unavailableItem.name} は現在注文できません`, 'error');
      return;
    }

    const soldOutItem = safeCart.find((item) => menuItemsById[item.id]?.isSoldOut);
    if (soldOutItem) {
      showToast(`${soldOutItem.name} は売り切れのため注文できません`, 'error');
      return;
    }

    const exceededLimitedItem = safeCart.find((item) => {
      const latestItem = menuItemsById[item.id];
      if (!latestItem || !Number.isFinite(latestItem.remainingQuantity)) return false;
      return item.quantity > latestItem.remainingQuantity;
    });

    if (exceededLimitedItem) {
      const latestItem = menuItemsById[exceededLimitedItem.id];
      showToast(`${exceededLimitedItem.name} の残りは ${latestItem.remainingQuantity} 点です`, 'error');
      return;
    }

    const externalCustomer = user?.spaceOsCustomerUid
      ? {
          provider: 'spaceos',
          tenantId: user.spaceOsTenantId || '',
          uid: user.spaceOsCustomerUid
        }
      : null;

    setIsProcessing(true);

    try {

      const resolvedPartySize = Number(sessionPartySize || 0);
      const orderPartySize = resolvedPartySize > 0 ? resolvedPartySize : null;


      if (businessSettings?.orderFlow === 'prepay') {
        const idToken = await auth.currentUser?.getIdToken();

        if (!idToken) {
          showToast('ログイン状態を確認できませんでした。', 'error');
          return;
        }

        const response = await fetch('/api/createPrepayOrder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
            body: JSON.stringify({
              storeId,
              sessionId,
              tableId: resolvedTableNumber,
              partySize: orderPartySize,
              participantId: customerParticipantId,
              cart: safeCart,
              totalPrice: cartTotal,
              externalCustomer
            })
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error?.message || '事前決済注文に失敗しました。');
        }
          } else {
            const idToken = await auth.currentUser?.getIdToken();

            if (!idToken) {
              showToast('ログイン状態を確認できませんでした。', 'error');
              return;
            }

            const response = await fetch('/api/createPostpayOrder', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`
              },
              body: JSON.stringify({
                storeId,
                sessionId,
                tableId: resolvedTableNumber,
                partySize: orderPartySize,
                participantId: customerParticipantId,
                cart: safeCart,
                totalPrice: cartTotal,
                externalCustomer
              })
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok || !payload?.ok) {
              throw new Error(payload?.error?.message || '注文の送信に失敗しました。');
            }
          }
          
      setCart([]);
      setView('history');
      setToast(null);
    } catch (error) {
      showToast(error.message || '注文の送信に失敗しました', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCallStaff = async (type) => {
    if (!sessionId) {
      showToast('セッション準備中のため、少し待ってからお試しください。', 'error');
      return;
    }

    if (!user || !resolvedTableNumber) return;

    if (isMembershipRestoring || isCurrentUserSessionMember === false) {
      showToast('接続を復元中です。少し待ってからお試しください。', 'error');
      return;
    }

    const requestType = type === 'accounting' ? 'check' : 'call';

    try {
      await addDoc(collection(db, 'stores', storeId, 'serviceRequests'), {
        tableId: resolvedTableNumber,
        sessionId,
        type: requestType,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      if (requestType === 'check') {
        setView('history');
        setActiveModal('accounting_instruction');
      } else {
        showToast('スタッフをお呼びしました');
        setActiveModal(null);
      }
    } catch {
      showToast('送信に失敗しました', 'error');
    }
  };

  const effectiveSessionStatus = isEntryPreview
    ? (entryBootstrapStatus === 'preparing' ? 'preparing' : entryBootstrapStatus)
    : sessionStatus;

  return {
    user,
    loading,
    contentLoading,
    menuItems: filteredMenuItems,
    allMenuItems: customerVisibleMenuItems,
    menuItemsById,
    categories,
    view,
    setView,
    basicSettings,
    sessionPartySize,
    sessionPartySizeLoaded,
    tableNumber: resolvedTableNumber,
    tableDisplayName,
    activeCategory,
    setActiveCategory,
    cart,
    setCart,
    orderHistory,
    customerReceipts,
    latestReceipt,
    receiptsLoading,
    myOrderHistory,
    historyLoading,
    activeModal,
    setActiveModal,
    isInviteModalOpen,
    setIsInviteModalOpen,
    modalItem,
    setModalItem,
    toast,
    setToast,
    currentPeriod,
    businessStatus,
    isProcessing,
    sessionStatus: effectiveSessionStatus,
    sessionHostId,
    isSessionEnded: isEntryPreview ? false : isSessionEnded,
    sessionError: isEntryPreview ? entryBootstrapError : sessionError,
    cartTotal,
    myTotal,
    grandTotal,
    inviteUrl,
    inviteQrUrl,
    isMembershipRestoring,
    crossSellSettings,
    confirmAddToCart,
    decreaseCartItem,
    removeCartItem,
    normalizeCartItems,
    placeOrder,
    handleCallStaff
  };
};