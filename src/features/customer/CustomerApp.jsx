import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../shared/api/firebase/client';
import {
  Barcode,
  CheckCircle,
  Lock,
  Minus,
  Plus,
  Share,
  ShieldAlert,
  ShoppingCart,
  Store,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';

import NotificationToast from '../../shared/components/feedback/NotificationToast';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import InviteModal from '../../shared/components/modals/InviteModal';
import CustomerHeader from './components/CustomerHeader';
import MenuLayoutRenderer from './components/MenuLayoutRenderer';
import CrossSellPrompt from './components/CrossSellPrompt';
import { useCrossSellFlow } from './hooks/useCrossSellFlow';
import { useCustomerLogic } from './components/useCustomerLogic';

const formatOrderTime = (value) => {
  try {
    const date = value instanceof Date
      ? value
      : typeof value?.toDate === 'function'
        ? value.toDate()
        : null;

    return date
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '--:--';
  } catch {
    return '--:--';
  }
};

const formatReceiptPaymentMethod = (method) => {
  if (method === 'cash') return '現金';
  if (method === 'card' || method === 'credit') return 'カード';
  if (method === 'qr' || method === 'paypay') return 'QR決済';
  if (method === 'prepay') return '事前決済';
  if (method === 'postpay') return '店頭決済';
  return method || '-';
};

const formatInvoiceNumber = (value) => {
  const normalized = String(value || '').trim();

  if (!normalized) return '';

  if (normalized.toUpperCase().startsWith('T')) {
    return normalized.toUpperCase();
  }

  return `T${normalized}`;
};

const SERVICE_TIMING_OPTIONS = [
  { id: 'before_meal', label: '食前' },
  { id: 'with_meal', label: '食事と一緒に' },
  { id: 'after_meal', label: '食後' }
];

const getServiceTimingLabel = (serviceTiming) => (
  SERVICE_TIMING_OPTIONS.find((option) => option.id === serviceTiming)?.label || ''
);

const isCategoryNormallyVisible = (category) => {
  const visibility = category?.customerTabVisibility || 'always';
  return visibility === 'always';
};

const CustomerApp = ({
  sessionId,
  storeId,
  entryTableId = null,
  entryTableToken = null,
  onSessionCreated = null
}) => {
  const {
    user,
    loading,
    contentLoading,
    basicSettings,
    sessionPartySize,
    sessionPartySizeLoaded,
    allMenuItems,
    menuItems,
    menuItemsById,
    categories,
    view,
    setView,
    tableNumber,
    tableDisplayName,
    activeCategory,
    setActiveCategory,
    cart,
    myOrderHistory,

    // ここに追加
    customerReceipts,
    latestReceipt,
    receiptsLoading,

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
    sessionStatus,
    sessionHostId,
    isSessionEnded,
    sessionError,
    cartTotal,
    myTotal,
    grandTotal,
    inviteUrl,
    inviteQrUrl,
    crossSellSettings,
    confirmAddToCart,
    decreaseCartItem,
    removeCartItem,
    normalizeCartItems,
    placeOrder,
    handleCallStaff
  } = useCustomerLogic(
    sessionId,
    storeId,
    entryTableId,
    entryTableToken,
    onSessionCreated
  );

  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeMenuItems = Array.isArray(menuItems) ? menuItems : [];
  const safeAllMenuItems = Array.isArray(allMenuItems) ? allMenuItems : [];
  const safeCart = Array.isArray(cart) ? cart : [];
  const safeMyOrderHistory = Array.isArray(myOrderHistory) ? myOrderHistory : [];
  const orderedCrossSellItems = safeMyOrderHistory.flatMap((order) => (
    Array.isArray(order?.items)
      ? order.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity || 0),
          category: item.category || item.categoryId || item.menuCategory || '',
          appliedPriceMode: item.appliedPriceMode || item.priceMode || ''
        }))
      : []
  ));

  const crossSellAccountingItems = [
    ...orderedCrossSellItems,
    ...safeCart
  ];
  const safeMenuItemsById = menuItemsById && typeof menuItemsById === 'object'
    ? menuItemsById
    : {};

const visibleCategoryIds = useMemo(() => {
  const ids = new Set();

  safeAllMenuItems.forEach((item) => {
    if (!item?.category) return;

    const periods = Array.isArray(item.periods) ? item.periods : [];
    const isTimeAllowed = periods.length === 0
      || (currentPeriod && periods.includes(currentPeriod.id));

    if (isTimeAllowed) {
      ids.add(item.category);
    }
  });

  return ids;
}, [safeAllMenuItems, currentPeriod]);

const orderedCategories = useMemo(() => (
  [...safeCategories].sort((left, right) => {
    const leftHasOrder = left?.order !== undefined || left?.sortOrder !== undefined;
    const rightHasOrder = right?.order !== undefined || right?.sortOrder !== undefined;

    if (!leftHasOrder && !rightHasOrder) {
      return 0;
    }

    const leftOrder = Number(left?.order ?? left?.sortOrder ?? 9999);
    const rightOrder = Number(right?.order ?? right?.sortOrder ?? 9999);

    return leftOrder - rightOrder;
  })
), [safeCategories]);

const normallyVisibleCategories = useMemo(() => (
  orderedCategories.filter((category) => (
    visibleCategoryIds.has(category.id)
    && isCategoryNormallyVisible(category)
  ))
), [orderedCategories, visibleCategoryIds]);

const visibleCategories = useMemo(() => (
  orderedCategories.filter((category) => visibleCategoryIds.has(category.id))
), [orderedCategories, visibleCategoryIds]);

const customerThemeColor = basicSettings?.customerThemeColor || '#0f172a';

const menuScrollRef = useRef(null);
const cartSheetDragControls = useDragControls();
const historySheetDragControls = useDragControls();


//  const layoutMode = visibleCategories.find((category) => category.id === activeCategory)?.layoutType || 'grid';
  

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [hasRenderedCustomerSurface, setHasRenderedCustomerSurface] = useState(false);
  const [partySize, setPartySize] = useState(null);
  const [cartBubbleMessage, setCartBubbleMessage] = useState('');
  const [shouldPersistPartySize, setShouldPersistPartySize] = useState(false);
  const [allowDefaultWelcomeAfterDelay, setAllowDefaultWelcomeAfterDelay] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [localConfirmedPartySizeSessionId, setLocalConfirmedPartySizeSessionId] = useState('');
  const [partySizeCheckTimedOut, setPartySizeCheckTimedOut] = useState(false);
  const [sessionStartTimedOut, setSessionStartTimedOut] = useState(false);
  const [returnToOriginalTabAfterCartClose, setReturnToOriginalTabAfterCartClose] = useState(false);
  const [crossSellAddedMessage, setCrossSellAddedMessage] = useState('');
  const [crossSellCartCount, setCrossSellCartCount] = useState(0);
  const [optionSelections, setOptionSelections] = useState({});
  const [optionQuantity, setOptionQuantity] = useState(1);
  const [serviceTiming, setServiceTiming] = useState('with_meal');
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [pendingOpenReceiptId, setPendingOpenReceiptId] = useState('');
  const [cancellingOrderId, setCancellingOrderId] = useState('');
  const [hasInteractedWithCrossSellTab, setHasInteractedWithCrossSellTab] = useState(false);
  const returnCategoryIdAfterCrossSellRef = useRef('');
  const crossSellAddedMessageTimerRef = useRef(null);
  

const clearCrossSellAddedMessage = () => {
  if (crossSellAddedMessageTimerRef.current) {
    window.clearTimeout(crossSellAddedMessageTimerRef.current);
    crossSellAddedMessageTimerRef.current = null;
  }

  setCrossSellAddedMessage('');
};

const showCrossSellAddedMessage = (message) => {
  if (!message) {
    clearCrossSellAddedMessage();
    return;
  }

  setCrossSellAddedMessage(message);

  if (crossSellAddedMessageTimerRef.current) {
    window.clearTimeout(crossSellAddedMessageTimerRef.current);
  }

  crossSellAddedMessageTimerRef.current = window.setTimeout(() => {
    setCrossSellAddedMessage('');
    crossSellAddedMessageTimerRef.current = null;
  }, 3000);
};

  const moveToCategory = (categoryId) => {
    setActiveCategory(categoryId);

    requestAnimationFrame(() => {
      menuScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
  };

  const restoreCategoryBeforeCrossSell = () => {
  const returnCategoryId = returnCategoryIdAfterCrossSellRef.current;

  if (!returnCategoryId) return;

  const canReturnToCategory = normallyVisibleCategories.some(
    (category) => category.id === returnCategoryId
  );

  if (canReturnToCategory) {
    moveToCategory(returnCategoryId);
  } else {
    const fallbackCategoryId = normallyVisibleCategories[0]?.id;
    if (fallbackCategoryId) {
      moveToCategory(fallbackCategoryId);
    }
  }

  returnCategoryIdAfterCrossSellRef.current = '';
};

  const {
    isCrossSellActive,
    activeCrossSellPrompt,
    activeCrossSellStepIndex,
    allowedCrossSellCategoryIds,
    activeCrossSellOfferCategoryIds,
    activeCrossSellOfferGroups,
    isCategoryAllowed,
    handleCartItemAdded,
    skipCurrentCrossSellStep,
    cancelCrossSellFlow
  } = useCrossSellFlow({
    crossSellSettings,
    categories: orderedCategories,
    onMoveCategory: moveToCategory,

  onStartFlow: () => {
    clearCrossSellAddedMessage();
    setCrossSellCartCount(1);

    const canReturnToActiveCategory = normallyVisibleCategories.some(
      (category) => category.id === activeCategory
    );

    returnCategoryIdAfterCrossSellRef.current = canReturnToActiveCategory
      ? activeCategory
      : normallyVisibleCategories[0]?.id || '';
  },

      onCompleteFlow: () => {
        window.setTimeout(() => {
          clearCrossSellAddedMessage();
          setCrossSellCartCount(0);

          setReturnToOriginalTabAfterCartClose(true);
          setIsCartOpen(true);
        }, 220);
      }
  });

const activeCrossSellAvailableCategoryIds = useMemo(() => {
  if (!Array.isArray(activeCrossSellOfferGroups) || activeCrossSellOfferGroups.length === 0) {
    return [];
  }

  const triggerQuantity = crossSellAccountingItems
    .filter((cartItem) => cartItem?.appliedPriceMode !== 'crossSell')
    .filter((cartItem) => !activeCrossSellOfferCategoryIds.includes(String(cartItem?.category || '')))
    .reduce((total, cartItem) => total + Number(cartItem?.quantity || 0), 0);

  if (triggerQuantity <= 0) return [];

  return activeCrossSellOfferGroups.flatMap((group) => {
    const categoryIds = Array.isArray(group?.categoryIds)
      ? group.categoryIds.map(String)
      : [];

    if (categoryIds.length === 0) return [];

    const usedQuantity = crossSellAccountingItems
      .filter((cartItem) => cartItem?.appliedPriceMode === 'crossSell')
      .filter((cartItem) => categoryIds.includes(String(cartItem?.category || '')))
      .reduce((total, cartItem) => total + Number(cartItem?.quantity || 0), 0);

    return usedQuantity < triggerQuantity ? categoryIds : [];
  });
}, [activeCrossSellOfferCategoryIds, activeCrossSellOfferGroups, crossSellAccountingItems]);

const headerCategories = useMemo(() => {
  if (isCrossSellActive) {
    return orderedCategories.filter((category) => (
      visibleCategoryIds.has(category.id)
      && allowedCrossSellCategoryIds.includes(category.id)
      && category?.customerTabVisibility !== 'hidden'
    ));
  }

  const availableIds = new Set(activeCrossSellAvailableCategoryIds.map(String));

  return orderedCategories.filter((category) => (
    visibleCategoryIds.has(category.id)
    && (
      isCategoryNormallyVisible(category)
      || (
        category?.customerTabVisibility === 'crossSellOnly'
        && availableIds.has(String(category.id))
      )
    )
  ));
}, [
  activeCrossSellAvailableCategoryIds,
  allowedCrossSellCategoryIds,
  isCrossSellActive,
  orderedCategories,
  visibleCategoryIds
]);

const handleCloseCart = () => {
  setIsCartOpen(false);

  if (returnToOriginalTabAfterCartClose) {
    setReturnToOriginalTabAfterCartClose(false);

    requestAnimationFrame(() => {
      restoreCategoryBeforeCrossSell();
    });
  }
};

const layoutMode = headerCategories.find((category) => category.id === activeCategory)?.layoutType || 'grid';

  useEffect(() => {
    if (headerCategories.length === 0) return;

    const activeCategoryStillVisible = headerCategories.some(
      (category) => category.id === activeCategory
    );

    if (!activeCategory || !activeCategoryStillVisible) {
      setActiveCategory(headerCategories[0].id);
    }
  }, [activeCategory, headerCategories, setActiveCategory]);

  useEffect(() => {
    setPartySizeCheckTimedOut(false);

    if (!storeId || !sessionId || sessionPartySizeLoaded) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setPartySizeCheckTimedOut(true);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [storeId, sessionId, sessionPartySizeLoaded]);

  useEffect(() => {
    setSessionStartTimedOut(false);

    if (!storeId || !entryTableId || sessionId || sessionStatus !== 'preparing') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setSessionStartTimedOut(true);
    }, 10000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [storeId, entryTableId, sessionId, sessionStatus]);


  useEffect(() => {
    setLocalConfirmedPartySizeSessionId('');
  }, [sessionId]);

  const isHost = user?.uid === sessionHostId;
  const isHistoryOpen = view === 'history';
  const tableTitle = tableDisplayName || tableNumber || entryTableId || 'テーブル未設定';

  const keepInviteVisibleDuringSessionSwitch = Boolean(
    sessionId
      && hasRenderedCustomerSurface
      && !sessionHostId
      && !isSessionEnded
      && sessionStatus !== 'locked'
      && sessionStatus !== 'disabled'
      && sessionStatus !== 'stopped'
      && sessionStatus !== 'error'
  );

  const canInviteFromCurrentScreen = Boolean(
    isHost
      || (!sessionId && storeId && entryTableId)
      || keepInviteVisibleDuringSessionSwitch
      || Boolean(sessionId && inviteUrl)
  );

  const shouldWaitForSessionBeforeWelcome = Boolean(
    storeId
      && entryTableId
      && !sessionId
      && sessionStatus === 'preparing'
      && !sessionStartTimedOut
  );

  const hasLocallyConfirmedPartySize = Boolean(
    sessionId && localConfirmedPartySizeSessionId === sessionId
  );

  const partySizeCheckReady = Boolean(
    sessionPartySizeLoaded || partySizeCheckTimedOut
  );

  const shouldWaitForPartySizeCheck = Boolean(
    storeId
      && sessionId
      && !sessionPartySizeLoaded
      && !partySizeCheckTimedOut
      && !hasLocallyConfirmedPartySize
      && !isSessionEnded
      && sessionStatus !== 'locked'
      && sessionStatus !== 'disabled'
      && sessionStatus !== 'stopped'
      && sessionStatus !== 'error'
      && sessionStatus !== 'invalid'
  );

  const canAskPartySize = Boolean(
    storeId
      && sessionId
      && partySizeCheckReady
      && !sessionPartySize
      && !hasLocallyConfirmedPartySize
      && !isSessionEnded
      && sessionStatus !== 'locked'
      && sessionStatus !== 'disabled'
      && sessionStatus !== 'stopped'
      && sessionStatus !== 'error'
      && sessionStatus !== 'invalid'
  );

  const shouldHideCustomerSurface = Boolean(
    shouldWaitForSessionBeforeWelcome
      || shouldWaitForPartySizeCheck
      || isWelcomeOpen
  );

  const shouldWaitForWelcomeSettings = Boolean(
    canAskPartySize
      && isWelcomeOpen
      && !basicSettings
      && !allowDefaultWelcomeAfterDelay
  );

  useEffect(() => {
    setIsWelcomeOpen(canAskPartySize);
  }, [canAskPartySize]);

  useEffect(() => {
    if (!canAskPartySize || !isWelcomeOpen || basicSettings) {
      setAllowDefaultWelcomeAfterDelay(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setAllowDefaultWelcomeAfterDelay(true);
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canAskPartySize, isWelcomeOpen, basicSettings]);

  const handleWelcomeStart = () => {
    const normalizedPartySize = Number(partySize || 0);

    if (normalizedPartySize < 1) return;

    if (sessionId) {
      setLocalConfirmedPartySizeSessionId(sessionId);
    }

    setShouldPersistPartySize(true);
    setIsWelcomeOpen(false);
  };

  useEffect(() => {
    if (!shouldPersistPartySize || !storeId || !sessionId) return;

    setShouldPersistPartySize(false);

    const normalizedPartySize = Math.min(20, Math.max(1, Number(partySize || 1)));

    setDoc(
      doc(db, 'stores', storeId, 'sessions', sessionId),
      {
        partySize: normalizedPartySize,
        partySizeConfirmedAt: serverTimestamp()
      },
      { merge: true }
    ).catch((error) => {
      console.warn('[CustomerApp] failed to save partySize', {
        error,
        storeId,
        sessionId,
        path: `stores/${storeId}/sessions/${sessionId}`,
        partySize: normalizedPartySize
      });
    });
  }, [partySize, sessionId, shouldPersistPartySize, storeId]);

  useEffect(() => {
    if (!isCrossSellActive) {
      setCrossSellAddedMessage('');
    }
  }, [isCrossSellActive]);

  useEffect(() => {
    if (isCrossSellActive) {
      setHasInteractedWithCrossSellTab(false);
    }
  }, [isCrossSellActive, activeCrossSellStepIndex]);

  useEffect(() => {
    if (!isWelcomeOpen || !safeAllMenuItems.length || !visibleCategories.length) return;

    const preloadImage = (src) => {
      if (!src) return;
      const img = new Image();
      img.src = src;
    };

    const activeItems = safeAllMenuItems.filter((item) => item.category === activeCategory);
    const otherItems = visibleCategories
      .filter((category) => category.id !== activeCategory)
      .flatMap((category) => safeAllMenuItems.filter((item) => item.category === category.id));

    const preloadTargets = [...activeItems, ...otherItems]
      .map((item) => item.image)
      .filter(Boolean);

    preloadTargets.forEach((src, index) => {
      window.setTimeout(() => preloadImage(src), index * 60);
    });
  }, [isWelcomeOpen, safeAllMenuItems, visibleCategories, activeCategory]);

  useEffect(() => {
    return () => {
      if (crossSellAddedMessageTimerRef.current) {
        window.clearTimeout(crossSellAddedMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCartOpen && !isHistoryOpen) return undefined;

    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const htmlStyle = document.documentElement.style;

    const previousBody = {
      overflow: bodyStyle.overflow,
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width,
      overscrollBehavior: bodyStyle.overscrollBehavior
    };

    const previousHtml = {
      overflow: htmlStyle.overflow,
      overscrollBehavior: htmlStyle.overscrollBehavior
    };

    bodyStyle.overflow = 'hidden';
    bodyStyle.position = 'fixed';
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.left = '0';
    bodyStyle.right = '0';
    bodyStyle.width = '100%';
    bodyStyle.overscrollBehavior = 'none';
    htmlStyle.overflow = 'hidden';
    htmlStyle.overscrollBehavior = 'none';

    return () => {
      bodyStyle.overflow = previousBody.overflow;
      bodyStyle.position = previousBody.position;
      bodyStyle.top = previousBody.top;
      bodyStyle.left = previousBody.left;
      bodyStyle.right = previousBody.right;
      bodyStyle.width = previousBody.width;
      bodyStyle.overscrollBehavior = previousBody.overscrollBehavior;
      htmlStyle.overflow = previousHtml.overflow;
      htmlStyle.overscrollBehavior = previousHtml.overscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [isCartOpen, isHistoryOpen]);

  useEffect(() => {
    const canKeepVisibleSurface = !loading
      && !contentLoading
      && sessionStatus !== 'locked'
      && sessionStatus !== 'error'
      && sessionStatus !== 'disabled'
      && sessionStatus !== 'stopped';

    if (!canKeepVisibleSurface || hasRenderedCustomerSurface) return undefined;

    const rememberSurfaceTimer = window.setTimeout(() => {
      setHasRenderedCustomerSurface(true);
    }, 0);

    return () => {
      window.clearTimeout(rememberSurfaceTimer);
    };
  }, [contentLoading, hasRenderedCustomerSurface, loading, sessionStatus]);

  const keepVisibleDuringSessionHydration = Boolean(
    sessionId && hasRenderedCustomerSurface
  );

  const handleCategoryChange = (categoryId) => {
    if (!isCategoryAllowed(categoryId)) return;

    moveToCategory(categoryId);
  };

  const handleChangeView = (nextView) => {
    setIsCartOpen(false);
    setView(nextView);
  };

  const handleToastClose = () => {
    setToast(null);
  };

  const handleSheetDragEnd = (_, info, closeSheet) => {
    const shouldClose = info.offset.y > 56 || info.velocity.y > 360;
    if (shouldClose) closeSheet();
  };
    
  const getCrossSellCategoryId = (item) => (
    String(
      item?.category ||
      item?.categoryId ||
      item?.menuCategoryId ||
      ''
    )
  );

  const normalizeCrossSellIds = (values = []) => (
    Array.isArray(values)
      ? values.map((value) => String(value || '').trim()).filter(Boolean)
      : []
  );

  const getCrossSellGroupById = (groupId) => {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return null;

    return (Array.isArray(crossSellSettings?.groups) ? crossSellSettings.groups : [])
      .find((group) => String(group?.id || '').trim() === normalizedGroupId) || null;
  };

  const getCrossSellGroupCategoryIds = (group) => (
    normalizeCrossSellIds(group?.categoryIds)
  );

  const getStepOfferGroups = (step) => {
    if (!step) return [];

    if (step.type === 'group' && step.groupId) {
      const group = getCrossSellGroupById(step.groupId);
      const categoryIds = getCrossSellGroupCategoryIds(group);

      if (categoryIds.length === 0) return [];

      return [{
        key: `group:${String(step.groupId)}`,
        type: 'group',
        groupId: String(step.groupId),
        categoryIds
      }];
    }

    const categoryId = String(step.categoryId || '').trim();
    if (!categoryId) return [];

    return [{
      key: `category:${categoryId}`,
      type: 'category',
      categoryId,
      categoryIds: [categoryId]
    }];
  };

  const isItemInCategoryIds = (item, categoryIds = []) => (
    categoryIds.map(String).includes(getCrossSellCategoryId(item))
  );

  const getFlowTriggerCategoryIds = (flow) => {
    if (!flow) return [];

    if (flow.triggerGroupId) {
      const group = getCrossSellGroupById(flow.triggerGroupId);
      return getCrossSellGroupCategoryIds(group);
    }

    const categoryId = String(flow.triggerCategoryId || '').trim();
    return categoryId ? [categoryId] : [];
  };

  const getCrossSellAccountingItems = (cartItems = safeCart) => ([
    ...orderedCrossSellItems,
    ...(Array.isArray(cartItems) ? cartItems : [])
  ]);

  const getFlowTriggerQuantity = (flow, cartItems = safeCart) => {
    const triggerCategoryIds = getFlowTriggerCategoryIds(flow);
    if (triggerCategoryIds.length === 0) return 0;

    return getCrossSellAccountingItems(cartItems)
      .filter((cartItem) => cartItem?.appliedPriceMode !== 'crossSell')
      .filter((cartItem) => isItemInCategoryIds(cartItem, triggerCategoryIds))
      .reduce((total, cartItem) => total + Number(cartItem?.quantity || 0), 0);
  };

  const getCrossSellOfferSourceKey = (flow, offerGroup) => (
    [
      String(flow?.id || ''),
      String(offerGroup?.key || offerGroup?.groupId || offerGroup?.categoryId || ''),
      Array.isArray(offerGroup?.categoryIds) ? offerGroup.categoryIds.map(String).sort().join(',') : ''
    ].join('::')
  );

  const getUsedCrossSellQuantityForOfferGroup = (offerGroup, cartItems = safeCart, flow = null) => {
    const categoryIds = Array.isArray(offerGroup?.categoryIds)
      ? offerGroup.categoryIds.map(String)
      : [];

    if (categoryIds.length === 0) return 0;

    const expectedSourceKey = flow ? getCrossSellOfferSourceKey(flow, offerGroup) : '';

    const accountingItems = [
      ...orderedCrossSellItems,
      ...(Array.isArray(cartItems) ? cartItems : [])
    ];

    return accountingItems
      .filter((cartItem) => cartItem?.appliedPriceMode === 'crossSell')
      .filter((cartItem) => categoryIds.includes(getCrossSellCategoryId(cartItem)))
      .filter((cartItem) => {
        if (expectedSourceKey && cartItem?.crossSellSourceKey) {
          return String(cartItem.crossSellSourceKey) === expectedSourceKey;
        }

        return true;
      })
      .reduce((total, cartItem) => total + Number(cartItem?.quantity || 0), 0);
  };

  const resolveCrossSellOfferForItem = (item, cartItems = safeCart) => {
    const itemCategoryId = getCrossSellCategoryId(item);
    if (!itemCategoryId) return null;

    const flows = Array.isArray(crossSellSettings?.flows)
      ? crossSellSettings.flows.filter((flow) => flow?.enabled !== false)
      : [];

    let bestOffer = null;

    flows.forEach((flow) => {
      const triggerQuantity = getFlowTriggerQuantity(flow, cartItems);
      if (triggerQuantity <= 0) return;

      const steps = Array.isArray(flow?.steps) ? flow.steps : [];

      steps.forEach((step) => {
        const offerGroups = getStepOfferGroups(step);

        offerGroups.forEach((offerGroup) => {
          if (!isItemInCategoryIds(item, offerGroup.categoryIds)) return;

          const usedQuantity = getUsedCrossSellQuantityForOfferGroup(offerGroup, cartItems, flow);
          const remainingQuantity = Math.max(triggerQuantity - usedQuantity, 0);

          if (remainingQuantity <= 0) return;

          const sourceKey = getCrossSellOfferSourceKey(flow, offerGroup);

          if (!bestOffer || remainingQuantity > bestOffer.remainingQuantity) {
            bestOffer = {
              flow,
              step,
              offerGroup,
              sourceKey,
              triggerQuantity,
              usedQuantity,
              remainingQuantity
            };
          }
        });
      });
    });

    return bestOffer;
  };

  const getRemainingCrossSellQuantityForItem = (item, cartItems = safeCart) => {
    const offer = resolveCrossSellOfferForItem(item, cartItems);
    return Math.max(Number(offer?.remainingQuantity || 0), 0);
  };

  const shouldUseCrossSellPriceForItem = (item) => {
    const remainingQuantity = getRemainingCrossSellQuantityForItem(item);
    const result = Boolean(
      item?.crossSellPrice !== null
      && item?.crossSellPrice !== undefined
      && item?.crossSellPrice !== ''
      && Number.isFinite(Number(item?.crossSellPrice))
      && Number(item?.crossSellPrice) >= 0
      && remainingQuantity > 0
    );

    console.log('[cross sell remaining]', {
      id: item?.id,
      name: item?.name,
      category: getCrossSellCategoryId(item),
      crossSellPrice: item?.crossSellPrice,
      remainingQuantity,
      result
    });

    return result;
  };

  const wouldExceedCrossSellLimit = (nextCart) => {
    if (!Array.isArray(nextCart)) return false;

    const nextHasCrossSellItems = nextCart.some((cartItem) => (
      cartItem?.appliedPriceMode === 'crossSell'
    ));

    if (!nextHasCrossSellItems) return false;

    const flows = Array.isArray(crossSellSettings?.flows)
      ? crossSellSettings.flows.filter((flow) => flow?.enabled !== false)
      : [];

    if (flows.length === 0) {
      return true;
    }

    return flows.some((flow) => {
      const triggerQuantity = getFlowTriggerQuantity(flow, nextCart);
      const steps = Array.isArray(flow?.steps) ? flow.steps : [];

      return steps.some((step) => (
        getStepOfferGroups(step).some((offerGroup) => (
          getUsedCrossSellQuantityForOfferGroup(offerGroup, nextCart, flow) > triggerQuantity
        ))
      ));
    });
  };

  const showCrossSellLimitToast = () => {
    setToast({
      message: '先にセット商品を減らしてください。',
      description: 'セット価格の商品数が、セット対象数を超えています。',
      type: 'info',
      autoCloseMs: 2600
    });
  };

  const resolveOrderItemForCurrentMode = (item) => {
    const crossSellOffer = resolveCrossSellOfferForItem(item);

    if (shouldUseCrossSellPriceForItem(item) && crossSellOffer) {
      return {
        ...item,
        price: Number(item.crossSellPrice),
        priceLabelText: item.crossSellPriceLabelText || 'セット価格',
        originalPrice: Number(item.price || 0),
        originalPriceLabelText: item.priceLabelText || '',
        appliedPriceMode: 'crossSell',
        crossSellSourceKey: crossSellOffer.sourceKey,
        crossSellSourceFlowId: String(crossSellOffer.flow?.id || ''),
        crossSellSourceStepId: String(crossSellOffer.step?.id || ''),
        crossSellSourceGroupKey: String(
          crossSellOffer.offerGroup?.key ||
          crossSellOffer.offerGroup?.groupId ||
          crossSellOffer.offerGroup?.categoryId ||
          ''
        ),
        crossSellServiceTimingEnabled: crossSellOffer.flow?.serviceTimingEnabled === true,
        crossSellSourceCategoryIds: Array.isArray(crossSellOffer.offerGroup?.categoryIds)
          ? crossSellOffer.offerGroup.categoryIds.map(String)
          : []
      };
    }

    return item;
  };


  const buildAddedMessage = (item, quantity = 1) => {
    const name = item?.name || '商品';
    const normalizedQuantity = Number(quantity || 1);

    if (normalizedQuantity > 1) {
      return `${name}を${normalizedQuantity}点追加しました。`;
    }

    return `${name}を追加しました。`;
  };

const handleConfirmedCartAdd = (item, quantity = 1, selectedOptions = [], extraPayload = {}) => {
  confirmAddToCart(item, quantity, selectedOptions, extraPayload);

  const wasCrossSellActive = isCrossSellActive;
  const handledByCrossSell = handleCartItemAdded(item);

  if (handledByCrossSell) {
    if (wasCrossSellActive) {
      setCrossSellCartCount((current) => Math.max(current, 1) + Number(quantity || 1));
    }

    setCartBubbleMessage('');
    return;
  }

  setCartBubbleMessage(`${item?.name || '商品'}を追加`);

  window.clearTimeout(window.__cartBubbleTimer);
  window.__cartBubbleTimer = window.setTimeout(() => {
    setCartBubbleMessage('');
  }, 2200);
};

const handleSkipCrossSellStep = () => {
  clearCrossSellAddedMessage();
  skipCurrentCrossSellStep();
};

const hasSelectableOptionGroups = (item) => (
  Array.isArray(item?.optionGroups)
  && item.optionGroups.some((group) => (
    Array.isArray(group?.options)
    && group.options.some((option) => String(option?.name || '').trim())
  ))
);

const shouldShowServiceTimingForItem = (item) => {
  const category = safeCategories.find((candidate) => (
    String(candidate.id) === String(item?.category)
  ));

  const result = Boolean(
    isCrossSellActive
    && activeCrossSellPrompt?.serviceTimingEnabled
    && category?.serviceTimingEnabled
  );
  return result;
};

const getServiceTimingDefaultForItem = (item) => {
  const category = safeCategories.find((candidate) => (
    String(candidate.id) === String(item?.category)
  ));

  const defaultValue = String(category?.serviceTimingDefault || 'with_meal');

  return SERVICE_TIMING_OPTIONS.some((option) => option.id === defaultValue)
    ? defaultValue
    : 'with_meal';
};

const handleAddToCartClick = (item) => {
  if (!businessStatus?.isTakingOrders) {
    setToast({
      message: businessStatus?.message || 'ただいま注文を受け付けていません',
      type: 'error'
    });
    return;
  }

  const orderItem = resolveOrderItemForCurrentMode(item);

  const shouldAttachServiceTiming = shouldShowServiceTimingForItem(orderItem);

  if (hasSelectableOptionGroups(orderItem) || shouldAttachServiceTiming) {
    setOptionSelections(buildDefaultOptionSelections(orderItem));
    setOptionQuantity(1);
    setServiceTiming(getServiceTimingDefaultForItem(orderItem));
    setModalItem({
      ...orderItem,
      shouldAttachServiceTiming
    });
    return;
  }

  handleConfirmedCartAdd(orderItem, 1, []);
};

const handleConfirmOptionsAddToCart = (item, quantity, selectedOptions) => {
  const orderItem = resolveOrderItemForCurrentMode(item);
  const shouldAttachServiceTiming = Boolean(
    item?.shouldAttachServiceTiming || shouldShowServiceTimingForItem(orderItem)
  );
  const serviceTimingLabel = shouldAttachServiceTiming ? getServiceTimingLabel(serviceTiming) : '';

  handleConfirmedCartAdd(
    orderItem,
    quantity,
    selectedOptions,
    shouldAttachServiceTiming
      ? {
          serviceTiming,
          serviceTimingLabel
        }
      : {}
  );

  closeOptionModal();
};

const closeOptionModal = () => {
  setModalItem(null);
  setOptionSelections({});
  setOptionQuantity(1);
  setServiceTiming('with_meal');
};

const getSortedOptionGroups = (item) => (
  Array.isArray(item?.optionGroups)
    ? [...item.optionGroups]
        .filter((group) => Array.isArray(group.options) && group.options.length > 0)
        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
        .map((group) => ({
          ...group,
          options: [...(group.options || [])]
            .filter((option) => String(option.name || '').trim())
            .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
        }))
    : []
);

const toggleOptionSelection = (group, option) => {
  const groupId = group.id || group.name;
  const optionId = option.id || option.name;
  const isMultiple = group.selectionType === 'multiple';

  setOptionSelections((current) => {
    const currentGroupSelections = Array.isArray(current[groupId])
      ? current[groupId]
      : [];

    if (!isMultiple) {
      return {
        ...current,
        [groupId]: [{
          groupId,
          groupName: group.name || 'オプション',
          optionId,
          name: option.name,
          price: Number(option.price || 0)
        }]
      };
    }

    const exists = currentGroupSelections.some((entry) => String(entry.optionId) === String(optionId));

    return {
      ...current,
      [groupId]: exists
        ? currentGroupSelections.filter((entry) => String(entry.optionId) !== String(optionId))
        : [
            ...currentGroupSelections,
            {
              groupId,
              groupName: group.name || 'オプション',
              optionId,
              name: option.name,
              price: Number(option.price || 0)
            }
          ]
    };
  });
};

const flattenSelectedOptions = (selections) => (
  Object.values(selections || {})
    .flat()
    .filter((option) => option && option.name)
);

const buildDefaultOptionSelections = (item) => {
  const groups = getSortedOptionGroups(item);

  return groups.reduce((result, group) => {
    const groupId = group.id || group.name;
    const firstOption = Array.isArray(group.options) ? group.options[0] : null;

    if (!groupId || !firstOption) return result;

    const shouldDefaultSelect =
      group.selectionType !== 'multiple'
      || group.required === true;

    if (!shouldDefaultSelect) return result;

    const optionId = firstOption.id || firstOption.name;

    return {
      ...result,
      [groupId]: [{
        groupId,
        groupName: group.name || 'オプション',
        optionId,
        name: firstOption.name,
        price: Number(firstOption.price || 0)
      }]
    };
  }, {});
};

const isOptionSelected = (group, option) => {
  const groupId = group.id || group.name;
  const optionId = option.id || option.name;
  const currentGroupSelections = Array.isArray(optionSelections[groupId])
    ? optionSelections[groupId]
    : [];

  return currentGroupSelections.some((entry) => String(entry.optionId) === String(optionId));
};

const getMissingRequiredOptionGroups = (item) => {
  const groups = getSortedOptionGroups(item);

  return groups.filter((group) => {
    if (group.required !== true) return false;

    const groupId = group.id || group.name;
    const selectedCount = Array.isArray(optionSelections[groupId])
      ? optionSelections[groupId].length
      : 0;

    return selectedCount < Math.max(Number(group.minSelect || 1), 1);
  });
};

const handlePlaceOrder = async () => {
  cancelCrossSellFlow?.();

  setReturnToOriginalTabAfterCartClose(false);
  clearCrossSellAddedMessage();
  setCrossSellCartCount(0);
  restoreCategoryBeforeCrossSell();

  await placeOrder();
};

const buildCartAfterDecrease = (cartId) => (
  safeCart.flatMap((cartItem) => {
    if (cartItem.cartId !== cartId) return [cartItem];

    if (cartItem?.appliedPriceMode === 'crossSell') {
      return [cartItem];
    }

    const nextQuantity = Number(cartItem.quantity || 0) - 1;

    return nextQuantity <= 0
      ? []
      : [{ ...cartItem, quantity: nextQuantity }];
  })
);

const buildCartAfterRemove = (cartId) => (
  safeCart.filter((cartItem) => cartItem.cartId !== cartId)
);

const handleDecreaseCartItem = (cartId) => {
  const nextCart = buildCartAfterDecrease(cartId);

  if (wouldExceedCrossSellLimit(nextCart)) {
    showCrossSellLimitToast();
    return;
  }

  decreaseCartItem(cartId);
};

const handleRemoveCartItem = (cartId) => {
  const nextCart = buildCartAfterRemove(cartId);

  if (wouldExceedCrossSellLimit(nextCart)) {
    showCrossSellLimitToast();
    return;
  }

  if (isCrossSellActive) {
    cancelCrossSellFlow?.();
    clearCrossSellAddedMessage();
    setCrossSellCartCount(0);
    setReturnToOriginalTabAfterCartClose(false);
    restoreCategoryBeforeCrossSell();
  }

  removeCartItem(cartId);
};

const isReceiptPrintable = (receipt) => (
  Boolean(
    receipt?.receiptNo
      && receipt?.totals
      && Array.isArray(receipt?.items)
      && receipt.items.length > 0
  )
);

const canCancelCustomerOrder = (order) => {
  if (!order) return false;
  if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') return false;
  if (order.paymentStatus === 'paid') return false;
  if (order.orderFlow === 'prepay') return false;

  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return false;

  return items.every((item) => {
    const status = String(item?.kitchenStatus || 'pending');
    return status === 'pending' && item?.isPrepared !== true;
  });
};

const handleCancelCustomerOrder = async (order) => {
  if (!order?.id || cancellingOrderId) return;

  const confirmed = window.confirm('この注文をキャンセルしますか？\n調理開始前の注文のみキャンセルできます。');
  if (!confirmed) return;

  setCancellingOrderId(order.id);

  try {
    const idToken = await auth.currentUser?.getIdToken();

    if (!idToken) {
      throw new Error('ログイン状態を確認できませんでした。');
    }

    const response = await fetch('/api/cancelCustomerOrder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        storeId,
        sessionId,
        orderId: order.id,
        participantId: order.participantId || order.customerId
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || '注文のキャンセルに失敗しました。');
    }

    setToast({
      message: '注文をキャンセルしました。',
      type: 'success'
    });
  } catch (cancelError) {
    console.error('[CustomerApp] cancel order failed', cancelError);
    setToast({
      message: cancelError.message || '注文のキャンセルに失敗しました。',
      type: 'error'
    });
  } finally {
    setCancellingOrderId('');
  }
};

const openReceiptSafely = (receipt) => {
  if (!receipt) {
    setToast({
      message: '領収書を準備しています。少し待ってからもう一度お試しください。',
      type: 'info'
    });
    return;
  }

  if (isReceiptPrintable(receipt)) {
    setSelectedReceipt(receipt);
    setShowReceiptModal(true);
    return;
  }

  const receiptKey = receipt.receiptId || receipt.id || receipt.receiptNo;

  if (receiptKey) {
    setPendingOpenReceiptId(receiptKey);
    setToast({
      message: '領収書データを読み込んでいます。少し待ってから自動で開きます。',
      type: 'info',
      autoCloseMs: 1800
    });
    return;
  }

  setToast({
    message: '領収書を準備しています。少し待ってからもう一度お試しください。',
    type: 'info'
  });
};

useEffect(() => {
  if (!pendingOpenReceiptId) return;
  if (!Array.isArray(customerReceipts) || customerReceipts.length === 0) return;

  const matchedReceipt = customerReceipts.find((receipt) => (
    receipt?.receiptId === pendingOpenReceiptId
      || receipt?.id === pendingOpenReceiptId
      || receipt?.receiptNo === pendingOpenReceiptId
  ));

  if (!matchedReceipt) return;

  if (!isReceiptPrintable(matchedReceipt)) return;

  setSelectedReceipt(matchedReceipt);
  setShowReceiptModal(true);
  setPendingOpenReceiptId('');
}, [customerReceipts, pendingOpenReceiptId]);

const RECEIPT_DETAIL_LIMIT = 8;

const shouldCompactReceiptItems = (receipt) => (
  Array.isArray(receipt?.items) && receipt.items.length > RECEIPT_DETAIL_LIMIT
);

  const receiptModalContent = showReceiptModal && selectedReceipt ? (
    <div className="receipt-print-layer fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] bg-white text-left shadow-2xl">
        <div className="shrink-0 border-b border-gray-100 p-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-gray-900">
                電子領収書
              </h3>
              {selectedReceipt.receiptNo && (
                <p className="mt-1 text-[11px] font-black tracking-wide text-gray-700">
                  No. {selectedReceipt.receiptNo}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowReceiptModal(false);
                setSelectedReceipt(null);
              }}
              className="receipt-print-hidden flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xl font-bold text-gray-500"
              aria-label="領収書を閉じる"
            >
              ×
            </button>
          </div>
        </div>

        <div className="receipt-print-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <div className="receipt-print-area font-mono text-sm text-gray-900">
            <div className="mb-4 text-center">
              <p className="text-base font-black">
                {selectedReceipt.store?.name || '店舗名'}
              </p>

              {selectedReceipt.store?.address && (
                <p className="mt-1 text-xs">
                  {selectedReceipt.store.address}
                </p>
              )}

              {selectedReceipt.store?.phone && (
                <p className="text-xs">
                  TEL: {selectedReceipt.store.phone}
                </p>
              )}

              {formatInvoiceNumber(selectedReceipt.store?.registrationNumber) && (
                <p className="mt-1 text-xs">
                  登録番号: {formatInvoiceNumber(selectedReceipt.store?.registrationNumber)}
                </p>
              )}
            </div>

            <div className="mb-3 border-b border-dashed border-gray-300 pb-3 text-xs">
              <div className="flex justify-between gap-3">
                <span>領収書番号</span>
                <span className="text-right">{selectedReceipt.receiptNo || '-'}</span>
              </div>

              <div className="mt-1 flex justify-between gap-3">
                <span>発行日時</span>
                <span className="text-right">
                  {selectedReceipt.issuedAt
                    ? selectedReceipt.issuedAt.toLocaleString('ja-JP')
                    : '-'}
                </span>
              </div>

              <div className="mt-1 flex justify-between gap-3">
                <span>テーブル</span>
                <span>{selectedReceipt.tableDisplayName || selectedReceipt.tableName || selectedReceipt.tableId || '-'}</span>
              </div>

              <div className="mt-1 flex justify-between gap-3">
                <span>支払い方法</span>
                <span>{formatReceiptPaymentMethod(selectedReceipt.payment?.method)}</span>
              </div>
            </div>

            <div className="mb-3 border-b border-dashed border-gray-300 pb-3">
              {shouldCompactReceiptItems(selectedReceipt) ? (
                <div className="py-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <span>ご注文明細</span>
                    <span>{selectedReceipt.items.length}点</span>
                  </div>

                  <p className="mt-2 leading-relaxed text-gray-500">
                    明細が多いため、商品ごとの詳細表示を省略しています。
                  </p>
                </div>
              ) : (
                (selectedReceipt.items || []).map((item, index) => (
                  <div key={`${item.id || item.name}-${index}`} className="mb-2">
                    <div className="flex justify-between gap-3">
                      <span>
                        {item.name} x{Number(item.quantity || 0)}
                      </span>
                      <span>
                        ¥{Number(item.taxIncludedAmount || 0).toLocaleString()}
                      </span>
                    </div>

                    {Array.isArray(item.options) && item.options.length > 0 && (
                      <p className="text-xs text-gray-500">
                        {item.options.join(' / ')}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="mb-3 space-y-1 border-b border-dashed border-gray-300 pb-3">
              {(selectedReceipt.taxSummaries || []).map((taxRow, index) => (
                <div
                  key={`${taxRow.taxRate}-${index}`}
                  className="flex justify-between text-xs"
                >
                  <span>消費税 {taxRow.taxRate}%</span>
                  <span>¥{Number(taxRow.taxAmount || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>小計</span>
                <span>¥{Number(selectedReceipt.totals?.subtotal || 0).toLocaleString()}</span>
              </div>

              {Number(selectedReceipt.totals?.discount || 0) > 0 && (
                <div className="flex justify-between text-xs text-red-600">
                  <span>値引き</span>
                  <span>-¥{Number(selectedReceipt.totals.discount || 0).toLocaleString()}</span>
                </div>
              )}

              <div className="flex justify-between text-xs">
                <span>消費税</span>
                <span>¥{Number(selectedReceipt.totals?.tax || 0).toLocaleString()}</span>
              </div>

              <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-lg font-black">
                <span>合計</span>
                <span>¥{Number(selectedReceipt.totals?.total || 0).toLocaleString()}</span>
              </div>
            </div>

            <p className="mt-5 text-center text-xs text-gray-500">
              ご利用ありがとうございました。
            </p>
          </div>
        </div>

        <div className="receipt-print-hidden shrink-0 border-t border-gray-100 bg-white p-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 text-sm font-black text-white"
          >
            <Share size={18} />
            PDF保存・共有
          </button>

          <p className="mt-2 text-center text-[11px] leading-relaxed text-gray-400">
            PDF保存やメモ保存をご利用いただけます。
          </p>
        </div>
      </div>
    </div>
  ) : null;

const receiptModal = receiptModalContent;

if (shouldWaitForSessionBeforeWelcome) {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <LoadingSpinner size={24} colorClass="text-gray-300" />
    </div>
  );
}

  if (sessionStartTimedOut && storeId && entryTableId && !sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-center">
        <div className="w-full max-w-sm rounded-[2rem] border border-gray-100 bg-white p-8 shadow-2xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-50">
            <ShieldAlert className="h-8 w-8 text-gray-500" />
          </div>

          <h2 className="text-xl font-black text-gray-900">
            読み込みに時間がかかっています
          </h2>

          <p className="mt-3 text-sm font-bold leading-relaxed text-gray-400">
            通信状況を確認し、もう一度QRコードを読み直してください。
          </p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-8 h-14 w-full rounded-[1.6rem] bg-gray-900 font-black text-white shadow-lg"
          >
            もう一度読み込む
          </button>
        </div>
      </div>
    );
  }


  if (shouldWaitForPartySizeCheck) {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <LoadingSpinner size={24} colorClass="text-gray-300" />
    </div>
  );
}
/*
  if (shouldWaitForWelcomeSettings) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <LoadingSpinner size={24} colorClass="text-gray-300" />
      </div>
    );
  }
*/
  if (loading && !keepVisibleDuringSessionHydration && !isWelcomeOpen) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <LoadingSpinner size={28} colorClass="text-gray-300" />
      </div>
    );
  }

  if (contentLoading && !keepVisibleDuringSessionHydration && !isWelcomeOpen) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <LoadingSpinner size={28} colorClass="text-gray-300" />
      </div>
    );
  }

  if (sessionStatus === 'stopped') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-red-50 p-6 text-center animate-in fade-in">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-sm">
          <Lock className="h-12 w-12 text-red-500" />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-gray-800">この店舗は現在利用停止中です</h2>
        <p className="max-w-sm leading-relaxed text-gray-600">
          店舗の利用が停止されているため、この端末からは利用できません。
        </p>
      </div>
    );
  }

  if (sessionStatus === 'disabled') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-red-50 p-6 text-center animate-in fade-in">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-sm">
          <Lock className="h-12 w-12 text-red-500" />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-gray-800">このテーブルは現在利用できません</h2>
        <p className="max-w-sm leading-relaxed text-gray-600">
          別のテーブルをご利用いただくか、スタッフへお声がけください。
        </p>
      </div>
    );
  }

  if (sessionStatus === 'locked') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center animate-in fade-in">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-gray-100 bg-white shadow-sm">
          <Lock className="h-12 w-12 text-orange-500" />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-gray-800">このテーブルは利用中です</h2>
        <p className="mx-auto mb-8 max-w-sm leading-relaxed text-gray-600">
          セキュリティのため、QRコードの使い回しはできません。
          <br />
          利用中の場合は画面に表示された
          <br />
          <span className="font-bold text-orange-600">参加用QRコード</span>
          {' '}を読み取ってください。
        </p>
      </div>
    );
  }

  if (sessionStatus === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6 text-center animate-in fade-in">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-red-100 shadow-inner">
          <ShieldAlert className="h-12 w-12 text-red-500" />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-gray-800">接続エラー</h2>
        <p className="text-gray-500">{sessionError || 'セッション情報の取得に失敗しました。'}</p>
      </div>
    );
  }

  if (isSessionEnded || sessionStatus === 'invalid') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6 text-center animate-in fade-in">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-green-100 shadow-inner">
          <CheckCircle className="h-12 w-12 text-green-600" />
        </div>

        <div className="receipt-print-hidden">
          <h2 className="mb-2 text-2xl font-bold text-gray-800">
            ご利用ありがとうございました
          </h2>

          <p className="text-gray-500">
            会計が完了しました。
            <br />
            またのご来店をお待ちしております。
          </p>
        </div>

        {latestReceipt && (
          <button
            type="button"
            onClick={() => openReceiptSafely(latestReceipt)}
            className="mt-8 rounded-2xl bg-blue-600 px-7 py-4 text-base font-black text-white shadow-lg shadow-blue-100 transition-transform hover:bg-blue-700 active:scale-95"
          >
            領収書を見る
          </button>
        )}

        {receiptModal}
      </div>
    );
  }

  const statusNotice = businessStatus?.isTakingOrders
    ? null
    : (
      <div className="rounded-3xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white">
            <ShieldAlert size={22} />
          </div>
          <div className="min-w-0">
            <p className="font-black text-amber-700">
              {businessStatus?.message || 'ただいま注文を受け付けていません'}
            </p>
            {businessStatus?.detail && (
              <p className="mt-1 text-sm leading-relaxed text-amber-700/80">
                {businessStatus.detail}
              </p>
            )}
          </div>
        </div>
      </div>
    );

  const filteredOrderHistory = safeMyOrderHistory;

  const historyPanel = isHistoryOpen ? (
    <>
      <motion.button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => handleChangeView('menu')}
      />

      <motion.div
        drag="y"
        dragListener={false}
        dragControls={historySheetDragControls}
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.26 }}
        dragMomentum={false}
        onDragEnd={(event, info) => handleSheetDragEnd(event, info, () => handleChangeView('menu'))}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[88vh] flex-col overflow-hidden rounded-t-[2.25rem] bg-white shadow-2xl"
      >
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center bg-white px-6 pb-3 pt-3 active:cursor-grabbing"
          onPointerDown={(event) => historySheetDragControls.start(event)}
        >
          <div className="h-1.5 w-14 rounded-full bg-gray-200" />
        </div>

        <div className="shrink-0 border-b border-gray-100 px-6 pb-4 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div>
            <h2 className="text-2xl font-black leading-tight text-gray-900">
              会計伝票
              {tableTitle && (
                <span className="ml-3 text-3xl text-gray-700">
                  {tableTitle}
                </span>
              )}
            </h2>
              <p className="mt-1 text-sm text-gray-400">
                注文履歴と会計用バーコードを確認できます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleChangeView('menu')}
              className="-mt-[22px] translate-x-1 flex h-10 w-10 items-center justify-center self-start rounded-full text-2xl font-semibold leading-none text-gray-400 transition-colors hover:bg-gray-50"
              aria-label="履歴を閉じる"
            >
              ×
            </button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="mb-6 rounded-3xl border-b-4 border-orange-100 bg-white p-6 text-center shadow-sm">
            <p className="mb-1 text-sm text-gray-500">あなたの注文金額</p>
            <p className="text-4xl font-bold text-gray-900">¥{Number(myTotal || 0).toLocaleString()}</p>

            {Number(grandTotal || 0) > Number(myTotal || 0) && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400">テーブル合計</p>
                <p className="text-xl font-bold text-gray-600">¥{Number(grandTotal || 0).toLocaleString()}</p>
              </div>
            )}
            {latestReceipt && (
            <button
              type="button"
              onClick={() => openReceiptSafely(latestReceipt)}
              className="mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-blue-600 text-base font-black text-white shadow-sm shadow-blue-100 transition-transform hover:bg-blue-700 active:scale-95"
            >
              領収書を見る
            </button>
            )}

            <div className="mt-6 border-t border-dashed border-gray-200 pt-6">
              <p className="mb-2 flex items-center justify-center gap-1 text-xs text-gray-400">
                <Barcode size={16} />
                会計用バーコード
              </p>
              <div className="relative h-24 w-full overflow-hidden rounded border border-gray-100 bg-white">
                {sessionId ? (
                  <img
                    src={`https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(sessionId)}&code=Code128&translate-esc=on`}
                    alt={sessionId}
                    className="h-32 w-full object-fill mix-blend-multiply"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-bold text-gray-300">
                    バーコード準備中
                  </div>
                )}
              </div>
              <p className="mt-2 text-center text-[10px] text-gray-400">
                レジでこちらのバーコードをお見せください
              </p>
            </div>
          </div>

          <h3 className="mb-4 px-1 font-bold text-gray-700">注文履歴</h3>

          <div className="space-y-4">
            {filteredOrderHistory.map((order) => {
              const orderItems = Array.isArray(order.items) ? order.items : [];
              const isCancelledOrder = order.status === 'cancelled' || order.paymentStatus === 'cancelled';
              const isCancelable = canCancelCustomerOrder(order);
              const isCancelling = cancellingOrderId === order.id;

              const displayStatus = isCancelledOrder
                ? 'キャンセル済み'
                : order.status === 'pending'
                  ? '受付済み'
                  : '提供中';

              const statusClassName = isCancelledOrder
                ? 'bg-gray-100 text-gray-500'
                : order.status === 'pending'
                  ? 'bg-orange-100 text-orange-600'
                  : 'bg-green-100 text-green-600';

              return (
                <div
                  key={order.id}
                  className={`rounded-xl border-l-4 bg-white p-4 shadow-sm ${
                    isCancelledOrder ? 'border-gray-300 opacity-70' : 'border-orange-500'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-400">
                    <span>{formatOrderTime(order.timestamp)}</span>
                    <span className={`shrink-0 rounded px-2 py-0.5 font-bold ${statusClassName}`}>
                      {displayStatus}
                    </span>
                  </div>

                  {orderItems.map((item, index) => {
                    const isCancelledItem =
                      isCancelledOrder ||
                      item?.status === 'cancelled' ||
                      item?.kitchenStatus === 'cancelled';

                    return (
                      <div
                        key={`${order.id}-${index}`}
                        className={`flex justify-between border-b border-gray-50 py-1 text-sm last:border-0 ${
                          isCancelledItem ? 'text-gray-400 line-through' : ''
                        }`}
                      >
                        <span className={isCancelledItem ? 'text-gray-400' : 'text-gray-800'}>
                          {item.name} x{Number(item.quantity || 0)}
                          {item.serviceTimingLabel && (
                            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                              {item.serviceTimingLabel}
                            </span>
                          )}
                        </span>
                        <span>
                          ¥{(Number(item.unitPrice || 0) * Number(item.quantity || 0)).toLocaleString()}
                        </span>
                      </div>
                    );
                  })}

                  {isCancelable && (
                    <button
                      type="button"
                      onClick={() => handleCancelCustomerOrder(order)}
                      disabled={isCancelling}
                      className="mt-3 flex h-10 w-full items-center justify-center rounded-xl border border-red-100 bg-red-50 text-xs font-black text-red-500 transition-all hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isCancelling ? 'キャンセル中...' : 'この注文をキャンセル'}
                    </button>
                  )}

                  {!isCancelledOrder && !isCancelable && order.status === 'pending' && (
                    <p className="mt-3 text-center text-[10px] font-bold text-gray-400">
                      調理開始後の変更・キャンセルはスタッフへお声がけください
                    </p>
                  )}
                </div>
              );
            })}

            {filteredOrderHistory.length === 0 && (
              <div className="rounded-xl border border-dashed bg-white py-10 text-center text-gray-400">
                まだ注文履歴はありません
              </div>
            )}
          </div>
        </div>

        <div
          className="shrink-0 border-t border-gray-100 bg-white px-4 pt-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          <button
            onClick={() => handleCallStaff('accounting')}
            className="h-14 w-full rounded-[1.6rem] bg-gray-800 font-bold text-white shadow-lg transition-transform active:scale-95"
          >
            会計をお願いする
          </button>
        </div>
      </motion.div>
    </>
  ) : null;

  const actionModal = activeModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-sm rounded-[1.75rem] bg-white p-6 text-center shadow-2xl animate-in zoom-in duration-200">
        {activeModal === 'accounting_instruction' ? (
          <>
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
              <Store className="h-10 w-10 text-green-600" />
            </div>
            <h3 className="mb-2 text-xl font-bold">レジでこの画面をご提示ください</h3>
            <p className="mb-8 text-sm text-gray-500">
              スタッフへ会計依頼を送りました。
              <br />
              このバーコードをご提示ください。
            </p>
            <button
              onClick={() => setActiveModal(null)}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[1.4rem] bg-green-600 px-6 text-base font-bold text-white shadow-lg"
            >
              <CheckCircle size={20} />
              OK
            </button>
          </>
        ) : (
          <>
            <h3 className="mb-6 text-lg font-bold">スタッフを呼び出しますか？</h3>
            {activeModal === 'call' && (
              <p className="mb-6 text-sm text-gray-500">スタッフがお席まで伺います。</p>
            )}
            <div className="flex gap-4">
              <button
                onClick={() => setActiveModal(null)}
                className="flex-1 rounded-lg bg-gray-100 py-3 font-bold"
              >
                戻る
              </button>
              <button
                onClick={() => handleCallStaff(activeModal)}
                className="flex-1 rounded-lg bg-orange-500 py-3 font-bold text-white"
              >
                送信する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;


  const sortedMenuItems = [...safeMenuItems].sort((left, right) => {
    const leftOrder = Number(left.sortOrder ?? 999999);
    const rightOrder = Number(right.sortOrder ?? 999999);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.isSoldOut !== right.isSoldOut) {
      return left.isSoldOut ? 1 : -1;
    }

    const leftCreated = left.createdAt?.toMillis?.() || 0;
    const rightCreated = right.createdAt?.toMillis?.() || 0;

    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
  });

  return (
    <div className="fixed inset-0 overflow-hidden bg-gray-50">
      {toast && (
        <NotificationToast
          message={toast.message}
          description={toast.description}
          type={toast.type}
          dismissible={toast.dismissible}
          autoCloseMs={toast.autoCloseMs}
          onClose={handleToastClose}
        />
      )}

      {isWelcomeOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white p-6">
          <div className="w-full max-w-sm rounded-[2rem] border border-gray-100 bg-white p-8 text-center shadow-2xl">
            {basicSettings?.customerLogoUrl && (
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center">
                <img
                  src={basicSettings.customerLogoUrl}
                  alt="店舗ロゴ"
                  className="max-h-20 max-w-20 object-contain"
                />
              </div>
            )}

            <h2 className="text-2xl font-black text-gray-900">いらっしゃいませ</h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-gray-400">
              ご利用人数を選択してください
            </p>

            <div className="mt-8 grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6].map((count) => {
                const isSelected = Number(partySize) === count;

                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setPartySize(count)}
                    className={`h-14 rounded-2xl border-2 text-base font-black transition-all active:scale-[0.98] ${
                      isSelected
                        ? 'text-white shadow-lg'
                        : 'bg-white shadow-sm hover:scale-[1.02]'
                    }`}
                    style={
                      isSelected
                        ? {
                            backgroundColor: customerThemeColor,
                            borderColor: customerThemeColor
                          }
                        : {
                            color: customerThemeColor,
                            borderColor: customerThemeColor
                          }
                    }
                  >
                    {count}人
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-center text-xs font-bold text-gray-400">
                7人以上はこちら
              </label>

              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="20"
                value={Number(partySize) >= 7 ? partySize : ''}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPartySize(value >= 1 ? Math.min(20, value) : null);
                }}
                className="h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-center text-base font-black text-gray-800 outline-none transition-all focus:border-gray-400"
                placeholder="人数を入力"
              />
            </div>

            <button
              type="button"
              disabled={Number(partySize || 0) < 1}
              onClick={handleWelcomeStart}
              className={`mt-8 h-14 w-full rounded-[1.6rem] font-black transition-all ${
                Number(partySize || 0) >= 1
                  ? 'text-white shadow-lg active:scale-[0.98]'
                  : 'cursor-not-allowed bg-gray-200 text-gray-400'
              }`}
              style={Number(partySize || 0) >= 1 ? { backgroundColor: customerThemeColor } : undefined}
            >
              メニューを見る
            </button>
          </div>
        </div>
      )}

      {!shouldHideCustomerSurface && (
        <CustomerHeader
          tableNumber={tableNumber}
          view="menu"
          categories={headerCategories}
          activeCategory={activeCategory}
          setActiveCategory={(categoryId) => {
            if (isCrossSellActive) {
              setHasInteractedWithCrossSellTab(true);
            }

            handleCategoryChange(categoryId);
          }}
          currentPeriod={currentPeriod}
          businessStatus={businessStatus}
          onViewChange={handleChangeView}
          onCallStaff={() => setActiveModal('call')}
          isHost={canInviteFromCurrentScreen}
          onInvite={() => setIsInviteModalOpen(true)}
          statusNotice={statusNotice}
          customerThemeColor={customerThemeColor}
          isCrossSellActive={isCrossSellActive && !hasInteractedWithCrossSellTab}
          allowedCrossSellCategoryIds={allowedCrossSellCategoryIds}
        />
      )}

      {modalItem && (hasSelectableOptionGroups(modalItem) || shouldShowServiceTimingForItem(modalItem)) && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
            <div className="shrink-0 border-b border-gray-100 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-xl font-black text-gray-900">
                    {modalItem.name}
                  </h3>
                  <p className="mt-1 text-sm font-bold text-gray-400">
                    オプションを選択してください
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeOptionModal}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400"
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-6">
                {shouldShowServiceTimingForItem(modalItem) && (
                  <section>
                    <div className="mb-3">
                      <h4 className="text-sm font-black text-gray-900">
                        ドリンクの提供タイミング
                      </h4>
                      <p className="mt-0.5 text-[11px] font-bold text-gray-400">
                        食事に合わせたタイミングをお選びください
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {SERVICE_TIMING_OPTIONS.map((option) => {
                        const selected = serviceTiming === option.id;

                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setServiceTiming(option.id)}
                            className={`h-12 rounded-2xl border text-xs font-black transition-all ${
                              selected
                                ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm'
                                : 'border-gray-100 bg-gray-50 text-gray-500'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {getSortedOptionGroups(modalItem).map((group) => (
                  <section key={group.id || group.name}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-black text-gray-900">
                          {group.name || 'オプション'}
                        </h4>
                        <p className="mt-0.5 text-[11px] font-bold text-gray-400">
                          {group.selectionType === 'multiple' ? '複数選択できます' : '1つ選択してください'}
                        </p>
                      </div>

                      {group.required === true && (
                        <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black text-orange-600">
                          必須
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      {group.options.map((option) => {
                        const selected = isOptionSelected(group, option);

                        return (
                          <button
                            key={option.id || option.name}
                            type="button"
                            onClick={() => toggleOptionSelection(group, option)}
                            className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                              selected
                                ? 'border-orange-300 bg-orange-50 text-orange-700'
                                : 'border-gray-100 bg-gray-50 text-gray-700'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black">
                                {option.name}
                              </div>
                              {Number(option.price || 0) > 0 && (
                                <div className="mt-0.5 text-xs font-bold text-gray-400">
                                  +¥{Number(option.price || 0).toLocaleString()}
                                </div>
                              )}
                            </div>

                            <div
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-black ${
                                selected
                                  ? 'border-orange-500 bg-orange-500 text-white'
                                  : 'border-gray-300 bg-white text-transparent'
                              }`}
                            >
                              ✓
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <div
              className="shrink-0 border-t border-gray-100 bg-white px-6 pt-4"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-500">数量</span>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setOptionQuantity((current) => Math.max(1, Number(current || 1) - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-700"
                  >
                    −
                  </button>

                  <span className="w-8 text-center font-black text-gray-900">
                    {optionQuantity}
                  </span>

                  <button
                    type="button"
                    onClick={() => setOptionQuantity((current) => Math.min(99, Number(current || 1) + 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white"
                  >
                    +
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const missingGroups = getMissingRequiredOptionGroups(modalItem);

                  if (missingGroups.length > 0) {
                    setToast({
                      message: `${missingGroups[0].name || '必須オプション'}を選択してください`,
                      type: 'error'
                    });
                    return;
                  }

                  handleConfirmOptionsAddToCart(
                    modalItem,
                    optionQuantity,
                    flattenSelectedOptions(optionSelections)
                  );
                }}
                className="flex h-14 w-full items-center justify-center rounded-[1.6rem] font-black text-white shadow-lg"
                style={{ backgroundColor: customerThemeColor }}
              >
                カートに追加
              </button>
            </div>
          </div>
        </div>
      )}


      {!shouldHideCustomerSurface && (
        <div
          ref={menuScrollRef}
          className="h-[calc(100vh-120px)] overflow-y-auto overflow-x-hidden pb-28"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            touchAction: 'pan-y'
          }}
        >
          <div key={activeCategory}>
            {isCrossSellActive && activeCrossSellPrompt && (
              <CrossSellPrompt
                title={activeCrossSellPrompt.title}
                description={activeCrossSellPrompt.description}
                skipLabel={activeCrossSellPrompt.skipLabel}
                cartItemCount={crossSellCartCount}
                customerThemeColor={customerThemeColor}
                onSkip={handleSkipCrossSellStep}
              />
            )}
<MenuLayoutRenderer
  layoutMode={layoutMode}
  items={sortedMenuItems}
  onAdd={handleAddToCartClick}
  orderingDisabled={!businessStatus?.isTakingOrders}
  priceMode={isCrossSellActive ? 'crossSell' : 'normal'}
  priceModeResolver={(item) => (
    shouldUseCrossSellPriceForItem(item) ? 'crossSell' : 'normal'
  )}
/>
          </div>

          {basicSettings?.customerLogoUrl && (
            <div className="mt-8 border-t border-gray-200 pb-10 pt-8">
              <div className="flex flex-col items-center">
                <img
                  src={basicSettings.customerLogoUrl}
                  alt="店舗ロゴ"
                  className="max-h-7 max-w-[110px] object-contain grayscale opacity-50"
                />

                <div className="mt-4 h-px w-16 bg-gray-200" />

                <p className="mt-3 text-[9px] font-semibold tracking-[0.18em] text-gray-400">
                  Connected by AKUTO
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {!shouldHideCustomerSurface && !isHistoryOpen && (safeCart.length > 0 || safeMyOrderHistory.length > 0) && (
        <div
          className="fixed left-0 right-0 z-40 px-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          {safeCart.length > 0 ? (
          <button
            onClick={() => setIsCartOpen(true)}
            className="flex h-14 w-full items-center justify-between rounded-[1.6rem] px-6 font-bold text-white shadow-lg"
            style={{ backgroundColor: customerThemeColor }}
          >
            <div className="relative">
              {cartBubbleMessage && (
                <div className="absolute bottom-full left-0 mb-2 whitespace-nowrap rounded-2xl bg-gray-900 px-4 py-2 text-xs font-black text-white shadow-lg ring-2 ring-white">
                  {cartBubbleMessage}
                  <span className="absolute left-4 top-full h-2.5 w-2.5 -translate-y-1 rotate-45 border-b-2 border-r-2 border-white bg-gray-900" />
                </div>
              )}

              <span className="rounded bg-white/20 px-2 py-0.5 text-sm">
                {safeCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}点
              </span>
            </div>

            <span className="flex items-center gap-2">
              <ShoppingCart size={18} strokeWidth={3} />
              カートを確認
            </span>

            <span>¥{Number(cartTotal || 0).toLocaleString()}</span>
          </button>
          ) : (
            <button
              onClick={() => handleChangeView('history')}
              className="flex h-14 w-full items-center justify-center rounded-[1.6rem] bg-gray-800 px-6 font-bold text-white shadow-lg"
            >
              会計伝票を表示する
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {historyPanel}
      </AnimatePresence>

      <AnimatePresence>
        {isCartOpen && view === 'menu' && safeCart.length > 0 && (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseCart}
            />

            <motion.div
              drag="y"
              dragListener={false}
              dragControls={cartSheetDragControls}
              dragDirectionLock
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.26 }}
              dragMomentum={false}
              onDragEnd={(event, info) => handleSheetDragEnd(event, info, handleCloseCart)}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[84vh] flex-col overflow-hidden rounded-t-[2.25rem] bg-white shadow-2xl"
            >
              <div
                className="flex shrink-0 cursor-grab touch-none justify-center bg-white px-6 pb-3 pt-3 active:cursor-grabbing"
                onPointerDown={(event) => cartSheetDragControls.start(event)}
              >
                <div className="h-1.5 w-14 rounded-full bg-gray-200" />
              </div>

              <div className="shrink-0 border-b border-gray-100 px-6 pb-3 pt-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black text-gray-900">カートを確認</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      内容を確認して、そのまま注文できます。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseCart}
                    className="-mt-[16px] translate-x-[2px] flex h-10 w-10 items-center justify-center self-start rounded-full text-2xl font-semibold leading-none text-gray-400 transition-colors hover:bg-gray-50"
                    aria-label="カートを閉じる"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
                style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
              >
                <div className="space-y-4">
                  {safeCart.map((item) => {
                    const latestItem = safeMenuItemsById[item.id] || item;
                    const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
                    const isCrossSellCartItem = item.appliedPriceMode === 'crossSell';
                    const selectedOptionsLabel = selectedOptions
                      .map((option) => (
                        option.groupName
                          ? `${option.groupName}：${option.name}`
                          : option.name
                      ))
                      .join(' / ');

                    return (
                      <div
                        key={item.cartId || item.id}
                        className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-grow">
                            <h4 className="text-sm font-black text-gray-900">{item.name}</h4>

                            {selectedOptionsLabel && (
                              <div className="mt-1 text-xs text-gray-500">{selectedOptionsLabel}</div>
                            )}

                            {item.serviceTimingLabel && (
                              <div className="mt-1 text-xs font-black text-blue-600">
                                提供タイミング：{item.serviceTimingLabel}
                              </div>
                            )}

                            {!latestItem.isSoldOut
                              && latestItem.remainingQuantity !== null
                              && latestItem.remainingQuantity !== undefined
                              && latestItem.remainingQuantity !== ''
                              && Number.isFinite(Number(latestItem.remainingQuantity)) && (
                                <div>
                                  {Number(latestItem.remainingQuantity) > 0
                                    ? `本日の残り ${Number(latestItem.remainingQuantity)} 点`
                                    : '売り切れ'}
                                </div>
                              )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveCartItem(item.cartId)}
                            className="rounded-2xl border border-gray-100 p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                          <div className="mt-4 flex items-center justify-between gap-4">
                            <span className="text-base font-black text-gray-900">
                              ¥{(Number(item.unitPrice || 0) * Number(item.quantity || 0)).toLocaleString()}
                            </span>

                            {isCrossSellCartItem ? (
                              <div className="flex items-center gap-2 rounded-full bg-orange-50 px-3 py-2 text-xs font-black text-orange-600">
                                <span>セット追加分</span>
                                <span>×{Number(item.quantity || 1)}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleDecreaseCartItem(item.cartId)}
                                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition-colors hover:bg-gray-50"
                                >
                                  <Minus size={16} />
                                </button>

                                <span className="w-6 text-center font-black text-gray-900">
                                  {Number(item.quantity || 0)}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => {
                                    confirmAddToCart(item, 1, selectedOptions);
                                  }}
                                  disabled={latestItem.isSoldOut}
                                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 disabled:bg-gray-300"
                                >
                                  <Plus size={16} />
                                </button>
                              </div>
                            )}
                          </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className="shrink-0 border-t border-gray-100 bg-white px-4 pt-4"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
              >
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="font-bold text-gray-500">合計</span>
                  <span className="text-xl font-black text-gray-900">
                    ¥{Number(cartTotal || 0).toLocaleString()}
                  </span>
                </div>

                <button
                  onClick={handlePlaceOrder}
                  disabled={isProcessing || !businessStatus?.isTakingOrders || safeCart.length === 0}
                  className={`flex h-14 w-full items-center justify-center gap-2 rounded-[1.6rem] font-bold shadow-lg transition-transform active:scale-95 ${
                    businessStatus?.isTakingOrders && safeCart.length > 0
                      ? 'text-white'
                      : 'bg-gray-300 text-gray-500 shadow-none'
                  }`}
                  style={
                    businessStatus?.isTakingOrders && safeCart.length > 0
                      ? { backgroundColor: customerThemeColor }
                      : undefined
                  }
                >
                  {isProcessing ? <LoadingSpinner size={24} /> : <CheckCircle size={20} />}
                  {isProcessing
                    ? '注文を送信しています...'
                    : `注文を確定する (¥${Number(cartTotal || 0).toLocaleString()})`}
                </button>
              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>

      {isInviteModalOpen && (
        <InviteModal
          inviteUrl={inviteUrl}
          qrApiUrl={inviteQrUrl}
          onClose={() => setIsInviteModalOpen(false)}
        />
      )}

      {actionModal}
      {receiptModal}
    </div>
  );
};

export default CustomerApp;