import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, doc, getDocs, increment, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';

import { getActiveRegisterContext } from '../utils/registerContext';
import { auth, db } from '../../../shared/api/firebase/client';
import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';
import {
  applyTaxRounding,
  normalizeTaxRounding,
  splitTaxIncludedAmount,
  toTaxIncludedAmount
} from '../../../shared/utils/tax';
import { groupOrdersByCustomer, resolveOrderCustomerId } from '../../../shared/utils/orderCustomerIdentity';
import {
  useCategoryData,
  useDiscountData,
  useMenuData,
  usePeriodData,
  useProductMasterData,
  useStoreSettings
} from '../../store/hooks';

import { PosRegisterLeft } from './components/PosRegisterLeft';
import { PosRegisterRight } from './components/PosRegisterRight';
import { PosModals } from './components/PosModals';
import { computePaymentSplit, getSplitMethodLabel } from '../utils/paymentSplit';
import { useTerminalCardPayment } from '../terminal/useTerminalCardPayment';
import { useCrmMember, CRM_MEMBER_SCAN_PATTERN } from '../hooks/useCrmMember';
import TerminalPaymentModal from '../terminal/TerminalPaymentModal';
import { getActiveStocktake, applyStocktakeSaleAdjustment } from '../../inventory/services/stocktakeDataService';
import { pushInventoryToShopify } from '../../store/services/storeDataService';
import { getAuth } from 'firebase/auth';

const getJstBusinessDate = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(date);
};

const isCancelledPosItem = (item) => (
  item?.status === 'cancelled' || item?.kitchenStatus === 'cancelled'
);

const getActivePosItems = (items = []) => (
  Array.isArray(items)
    ? items.filter((item) => !isCancelledPosItem(item))
    : []
);

const allocateAmountByWeight = (targetAmount, weights) => {
  const normalizedTarget = Math.max(Math.round(Number(targetAmount) || 0), 0);
  const normalizedWeights = weights.map((weight, index) => ({
    index,
    weight: Math.max(Number(weight) || 0, 0)
  }));
  const totalWeight = normalizedWeights.reduce((sum, entry) => sum + entry.weight, 0);

  if (normalizedTarget === 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const baseAllocations = normalizedWeights.map((entry) => {
    const exact = (normalizedTarget * entry.weight) / totalWeight;
    return {
      index: entry.index,
      value: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      weight: entry.weight
    };
  });

  let remaining = normalizedTarget - baseAllocations.reduce((sum, entry) => sum + entry.value, 0);

  baseAllocations
    .sort((left, right) => (
      right.remainder - left.remainder
      || right.weight - left.weight
      || left.index - right.index
    ))
    .forEach((entry) => {
      if (remaining <= 0) return;
      entry.value += 1;
      remaining -= 1;
    });

  return baseAllocations
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.value);
};

export const PosRegister = ({ sessionId, onBack, onComplete, onPaymentResult, onCheckoutAmountEntered, storeId }) => {
  const { settings: storeSettings } = useStoreSettings(storeId);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkoutSelectionMode, setCheckoutSelectionMode] = useState('all');
  const [selectedItemKeys, setSelectedItemKeys] = useState(new Set());

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  // カード会計をこの端末に割り当てた Stripe リーダーへ送る待機フロー。
  const term = useTerminalCardPayment(storeId);

  const [takeoutItemKeys, setTakeoutItemKeys] = useState(new Set());
  const [paidItemKeys, setPaidItemKeys] = useState(new Set());

  const [discountType, setDiscountType] = useState('none');
  const [discountValue, setDiscountValue] = useState(0);
  const [selectedDiscount, setSelectedDiscount] = useState(null);

  const [discountQuantities, setDiscountQuantities] = useState({});
  // 全額売掛のワンタップ会計用。全額売掛stateを反映させた後にhandlePaymentを発火する。

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [issueReceipt, setIssueReceipt] = useState(false);
  const [recipientName, setRecipientName] = useState('');

  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastTransaction, setLastTransaction] = useState({ total: 0, change: 0, method: 'cash' });
  const [showAbortModal, setShowAbortModal] = useState(false);
  const [abortReason, setAbortReason] = useState('manual_abort');
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [isPaymentFlowLocked, setIsPaymentFlowLocked] = useState(false);
  const [processingAction, setProcessingAction] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [isCancelSubmitting, setIsCancelSubmitting] = useState(false);
  const [quantityPicker, setQuantityPicker] = useState(null);

  const [tableId, setTableId] = useState(null);
  const [tableDisplayName, setTableDisplayName] = useState('');
  const [guestCount, setGuestCount] = useState(0);

  // CRM会員(ポイント)。POS/テイクアウト(PosMain)と同じ共有フックを使う。
  const {
    member: crmMember,
    busy: crmMemberBusy,
    message: crmMemberMsg,
    codeInput: crmCodeInput,
    setCodeInput: setCrmCodeInput,
    lookupByCode: lookupCrmMemberByCode,
    clearMember: clearCrmMember
  } = useCrmMember(storeId);

  // 会員バーコード(Code128 "MB"+番号)のスキャナ取り込み。
  // イートインの会計画面には商品スキャン欄が無いため、キーボードウェッジの打鍵を直接拾う。
  // ⚠人の手入力を壊さないため (1)"MB"+数字の並びのみ (2)打鍵間隔が速い(=スキャナ)場合のみ を条件にする。
  //   先頭の "M" だけは判定材料が無いので素通しする(フォーカス中の入力欄に1文字残ることがある)。
  const crmScanRef = useRef({ buffer: '', lastAt: 0 });
  useEffect(() => {
    const SCAN_GAP_MS = 80;

    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const state = crmScanRef.current;
      const now = event.timeStamp || 0;
      const isFast = state.buffer.length > 0 && (now - state.lastAt) <= SCAN_GAP_MS;

      if (event.key === 'Enter') {
        const buffer = state.buffer;
        state.buffer = '';
        if (isFast && CRM_MEMBER_SCAN_PATTERN.test(buffer)) {
          event.preventDefault();
          event.stopPropagation();
          lookupCrmMemberByCode(buffer);
        }
        return;
      }

      if (event.key.length !== 1) return;

      const candidate = (isFast ? state.buffer : '') + event.key;
      // "M" / "MB" / "MB123..." だけを会員コードの途中とみなす。
      if (!/^M$|^MB$|^MB\d{1,13}$/i.test(candidate)) {
        state.buffer = /^m$/i.test(event.key) ? event.key : '';
        state.lastAt = now;
        return;
      }

      state.buffer = candidate;
      state.lastAt = now;
      // 先頭の "M" 以外(=スキャナ確定後)は入力欄に流さない。
      if (candidate.length >= 2) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [lookupCrmMemberByCode]);

  const {
    products: productMasterProducts = [],
    productCategories: productMasterCategories = [],
    loading: productMasterLoading
  } = useProductMasterData(storeId);
  const [orderRetailKeyword, setOrderRetailKeyword] = useState('');
  const [orderRetailCart, setOrderRetailCart] = useState([]);
  const [orderRetailMessage, setOrderRetailMessage] = useState(null);

  const { discounts } = useDiscountData(storeId) || { discounts: [] };
  const { settings } = useStoreSettings(storeId);
  const { menuItems = [] } = useMenuData(storeId);
  const { categories = [] } = useCategoryData(storeId);
  const { periods = [] } = usePeriodData(storeId);

  const categoryNameMap = useMemo(() => {
    const map = {};

    if (Array.isArray(categories)) {
      categories.forEach((category) => {
        if (!category?.id) return;
        map[category.id] = category.name || 'カテゴリー未設定';
      });
    }

    return map;
  }, [categories]);

  const menuItemSnapshotMap = useMemo(() => {
    const byId = {};
    const byName = {};

    if (Array.isArray(menuItems)) {
      menuItems.forEach((menuItem) => {
        const categoryId = menuItem.category || menuItem.categoryId || '';
        const categoryName = categoryNameMap[categoryId] || menuItem.categoryName || 'カテゴリー未設定';

        const snapshot = {
          categoryId,
          categoryName
        };

        if (menuItem.id) byId[menuItem.id] = snapshot;
        if (menuItem.name) byName[menuItem.name] = snapshot;
      });
    }

    return { byId, byName };
  }, [menuItems, categoryNameMap]);

  const toMinutesFromTimeText = (timeText) => {
    const [hourText, minuteText] = String(timeText || '00:00').split(':');
    const hour = Number(hourText) || 0;
    const minute = Number(minuteText) || 0;
    return hour * 60 + minute;
  };

  const isTimeWithinPeriod = (targetMinutes, period) => {
    const startMinutes = toMinutesFromTimeText(period.start);
    const endMinutes = toMinutesFromTimeText(period.end);

    if (startMinutes <= endMinutes) {
      return targetMinutes >= startMinutes && targetMinutes <= endMinutes;
    }

    return targetMinutes >= startMinutes || targetMinutes <= endMinutes;
  };

  const resolveCurrentPeriodSnapshot = () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const matchedPeriods = Array.isArray(periods)
      ? periods.filter((period) => isTimeWithinPeriod(currentMinutes, period))
      : [];

    const matchedPeriod = matchedPeriods[0] || null;

    return {
      periodId: matchedPeriod?.id || 'unknown',
      periodName: matchedPeriod?.name || '時間帯未設定'
    };
  };

  const configuredPaymentMethods = Array.isArray(settings?.acceptedPaymentMethods) ? settings.acceptedPaymentMethods : [];
  const allowedPaymentMethods = configuredPaymentMethods.filter((method) => ['cash', 'card', 'qr'].includes(method));
  const availablePaymentMethods = allowedPaymentMethods.length > 0 ? allowedPaymentMethods : ['cash', 'card', 'qr'];
  const allowTakeout = settings?.allowTakeout !== false;
  const resolvedPaymentMethod = availablePaymentMethods.includes(paymentMethod)
    ? paymentMethod
    : (paymentMethod === 'credit' ? 'credit' : '');

  const clearSessionAccess = async (batch) => {
    const normalizedTableId = String(tableId ?? '').trim();

    if (normalizedTableId) {
      batch.set(doc(db, 'stores', storeId, 'tables', normalizedTableId), {
        tableId: normalizedTableId,
        currentSessionId: null,
        currentSessionStatus: 'idle',
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableSessions', normalizedTableId), {
        tableId: normalizedTableId,
        sessionId: null,
        status: 'idle',
        updatedAt: serverTimestamp(),
        lastClosedSessionId: sessionId,
        lastClosedAt: serverTimestamp()
      }, { merge: true });

      batch.delete(doc(db, 'stores', storeId, 'tableEntryGuards', normalizedTableId));
    }

    const inviteQuery = query(
      collection(db, 'stores', storeId, 'sessionInvites'),
      where('sessionId', '==', sessionId)
    );

    const inviteSnapshot = await getDocs(inviteQuery);
    inviteSnapshot.forEach((inviteDoc) => batch.delete(inviteDoc.ref));
  };

  useEffect(() => {
    if (!sessionId || !storeId) return undefined;
    const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
    const unsubSession = onSnapshot(sessionRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const sessionData = snapshot.data();

      setTableId(sessionData.tableId || null);
      setTableDisplayName(
        String(
          sessionData.tableDisplayName ||
          sessionData.tableName ||
          sessionData.displayName ||
          ''
        ).trim()
      );
      setGuestCount(
        Number(
          sessionData.guestCount ??
          sessionData.numberOfGuests ??
          sessionData.partySize ??
          sessionData.peopleCount ??
          0
        ) || 0
      );
    });

    const ordersQuery = query(collection(db, 'stores', storeId, 'orders'), where('sessionId', '==', sessionId));
    const unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
      if (!snapshot) return;
      const fetched = snapshot.docs.map((orderDoc) => ({ id: orderDoc.id, ...orderDoc.data() }));
      const unpaidOrders = fetched.filter((order) => {
        if (!order) return false;
        const isPosCancelledOrder =
          order.cancelledBy === 'pos' ||
          order.closeReason === 'pos_manual_cancel';

        if ((order.status === 'cancelled' || order.paymentStatus === 'cancelled') && !isPosCancelledOrder) {
          return false;
        }

        return order.paymentStatus !== 'paid';
      });
      setOrders(unpaidOrders);
      setLoading(false);

      const nextPaidKeys = new Set();
      fetched.forEach((order) => {
        if (!order?.items || !Array.isArray(order.items)) return;

        order.items.forEach((item, idx) => {
          if (item?.status === 'cancelled' || item?.kitchenStatus === 'cancelled') return;

          if (order.paymentStatus === 'paid' || item?.paymentStatus === 'paid') {
            nextPaidKeys.add(`${order.id}-${idx}`);
          }
        });
      });
      setPaidItemKeys(nextPaidKeys);

    });

    return () => {
      unsubscribe();
      unsubSession();
    };
  }, [sessionId, storeId]);

  const allPayableItemEntries = useMemo(() => {
    if (!Array.isArray(orders)) return [];

    return orders.flatMap((order) => {
      if (!order?.items || !Array.isArray(order.items)) return [];

      return order.items
        .map((item, index) => ({
          order,
          item,
          index,
          key: `${order.id}-${index}`
        }))
        .filter(({ item, key }) => (
          item &&
          !isCancelledPosItem(item) &&
          !paidItemKeys.has(key) &&
          item.paymentStatus !== 'paid'
        ));
    });
  }, [orders, paidItemKeys]);

  const allPayableItemKeys = useMemo(
    () => new Set(allPayableItemEntries.map((entry) => entry.key)),
    [allPayableItemEntries]
  );

  const activeSelectedItemKeys = useMemo(() => {
    const next = new Set();

    selectedItemKeys.forEach((key) => {
      if (allPayableItemKeys.has(key)) next.add(key);
    });

    return next;
  }, [allPayableItemKeys, selectedItemKeys]);

  const currentPayTargetItemKeys = useMemo(() => {
    if (checkoutSelectionMode === 'custom') return activeSelectedItemKeys;
    return allPayableItemKeys;
  }, [activeSelectedItemKeys, allPayableItemKeys, checkoutSelectionMode]);

  const currentPayTargetSignature = useMemo(() => (
    Array.from(currentPayTargetItemKeys).sort().join('|')
  ), [currentPayTargetItemKeys]);

  const selectedItemCount = activeSelectedItemKeys.size;
  const totalPayableItemCount = allPayableItemEntries.length;


  const orderRetailCategoryNameMap = useMemo(() => {
    const map = {};
    if (Array.isArray(productMasterCategories)) {
      productMasterCategories.forEach((category) => {
        if (!category?.id) return;
        map[category.id] = category.name || 'カテゴリー';
      });
    }
    return map;
  }, [productMasterCategories]);

  const getOrderRetailStockQuantity = (product) => {
    const stockValue = product?.inventoryQuantity ?? product?.quantity ?? 0;
    const stockNumber = Number(stockValue);
    return Number.isFinite(stockNumber) ? Math.max(Math.floor(stockNumber), 0) : 0;
  };

  const activeOrderRetailProducts = useMemo(() => (
    Array.isArray(productMasterProducts)
      ? productMasterProducts
        .filter((product) => product && product.isArchived !== true && product.isActive !== false)
        .map((product) => ({
          ...product,
          resolvedPrice: Number(product.priceTaxIncluded ?? product.price ?? 0) || 0,
          resolvedStock: getOrderRetailStockQuantity(product),
          resolvedCategoryName: orderRetailCategoryNameMap[product.categoryId] || product.categoryName || 'カテゴリー'
        }))
        .filter((product) => Number(product.resolvedPrice || 0) >= 0)
        .sort((left, right) => (
          String(left.resolvedCategoryName || '').localeCompare(String(right.resolvedCategoryName || ''), 'ja')
          || String(left.brandName || '').localeCompare(String(right.brandName || ''), 'ja')
          || String(left.name || '').localeCompare(String(right.name || ''), 'ja')
        ))
      : []
  ), [orderRetailCategoryNameMap, productMasterProducts]);

  const filteredOrderRetailProducts = useMemo(() => {
    const normalizedKeyword = orderRetailKeyword.trim().toLowerCase();

    return activeOrderRetailProducts.filter((product) => {
      if (!normalizedKeyword) return true;

      return [
        product.name,
        product.sku,
        product.productCode,
        product.barcode,
        product.resolvedCategoryName
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [activeOrderRetailProducts, orderRetailKeyword]);

  const getOrderRetailCartQuantity = (productId) => (
    orderRetailCart
      .filter((item) => item.sourceType === 'retail' && item.productId === productId)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  );

  const setOrderRetailStatusMessage = (message, type = 'info') => {
    setOrderRetailMessage({ message, type, key: Date.now() });
  };

  const addOrderRetailProduct = (product) => {
    if (!product?.id) return false;

    const stockQuantity = Number(product.resolvedStock ?? getOrderRetailStockQuantity(product));
    const currentQuantity = getOrderRetailCartQuantity(product.id);

    if (stockQuantity <= 0) {
      setOrderRetailStatusMessage(`${product.name || '商品'} は在庫がありません。`, 'error');
      return false;
    }

    if (currentQuantity >= stockQuantity) {
      setOrderRetailStatusMessage(`${product.name || '商品'} は在庫数 ${stockQuantity} 点を超えて追加できません。`, 'error');
      return false;
    }

    const payload = {
      id: `order-retail:${product.id}`,
      productId: product.id,
      sourceType: 'retail',
      isOrderRetailExtra: true,
      name: product.name || '商品',
      categoryId: product.categoryId || '',
      categoryName: product.resolvedCategoryName || 'カテゴリー',
      unitPrice: Number(product.resolvedPrice || 0),
      takeoutPrice: Number(product.resolvedPrice || 0),
      priceTaxIncluded: Number(product.resolvedPrice || 0),
      barcode: product.barcode || '',
      sku: product.sku || product.productCode || '',
      stockQuantity,
      quantity: 1
    };

    setOrderRetailCart((current) => {
      const existing = current.find((item) => item.id === payload.id);
      if (existing) {
        return current.map((item) => (
          item.id === payload.id
            ? { ...item, quantity: Number(item.quantity || 0) + 1 }
            : item
        ));
      }
      return [...current, payload];
    });

    setOrderRetailStatusMessage(`${product.name || '商品'} を会計に追加しました。`, 'success');
    return true;
  };

  const updateOrderRetailCartQuantity = (itemId, delta) => {
    setOrderRetailCart((current) => (
      current
        .map((item) => {
          if (item.id !== itemId) return item;

          const currentQuantity = Number(item.quantity || 0);
          const nextQuantity = Math.max(currentQuantity + delta, 0);

          if (
            item.sourceType === 'retail' &&
            delta > 0 &&
            nextQuantity > Number(item.stockQuantity || 0)
          ) {
            setOrderRetailStatusMessage(`${item.name || '商品'} は在庫数 ${Number(item.stockQuantity || 0)} 点を超えて追加できません。`, 'error');
            return item;
          }

          return { ...item, quantity: nextQuantity };
        })
        .filter((item) => Number(item.quantity || 0) > 0)
    ));
  };

  const removeOrderRetailCartItem = (itemId) => {
    setOrderRetailCart((current) => current.filter((item) => item.id !== itemId));
  };

  const consolidatedItems = useMemo(() => {
    if (!orders || !Array.isArray(orders)) return [];
    const items = [];

    orders.forEach((order) => {
      if (!order?.items || !Array.isArray(order.items)) return;
      order.items.forEach((item, idx) => {
        if (!item) return;
        if (item.status === 'cancelled' || item.kitchenStatus === 'cancelled') return;

        const itemKey = `${order.id}-${idx}`;
        if (paidItemKeys.has(itemKey) || item.paymentStatus === 'paid') return;
        if (!currentPayTargetItemKeys.has(itemKey)) return;

        const name = item.name || '未設定商品';
        const unitPrice = Number(item.unitPrice) || 0;
        const quantity = Number(item.quantity) || 0;
        const optionsKey = Array.isArray(item.options) ? item.options.join('|') : '';
        const key = `${item.id || name}-${unitPrice}-${optionsKey}`;
        const existing = items.find((target) => target._key === key);
        const menuSnapshot =
          menuItemSnapshotMap.byId[item.id] ||
          menuItemSnapshotMap.byName[name] ||
          {};

        const categoryId =
          item.categoryId ||
          item.category ||
          menuSnapshot.categoryId ||
          '';

        const categoryName =
          item.categoryName ||
          menuSnapshot.categoryName ||
          'カテゴリー未設定';

        const detail = {
          key: itemKey,
          unitPrice,
          quantity,
          allowsTakeout: item.allowsTakeout !== false,
          categoryId,
          categoryName
        };

        if (existing) {
          existing.quantity += quantity;
          existing.totalPrice += unitPrice * quantity;
          existing.itemKeys.push(itemKey);
          existing.details.push(detail);
        } else {
          items.push({
            ...item,
            name,
            unitPrice,
            quantity,
            totalPrice: unitPrice * quantity,
            allowsTakeout: item.allowsTakeout !== false,
            categoryId,
            categoryName,
            _key: key,
            itemKeys: [itemKey],
            details: [detail]
          });
        }
      });
    });
    orderRetailCart.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice ?? item.takeoutPrice ?? 0);
      if (quantity <= 0) return;

      const detailKey = `order-retail-extra:${item.productId || item.id}`;

      items.push({
        ...item,
        id: item.id,
        menuItemId: item.id,
        productId: item.productId || '',
        sourceType: item.sourceType || 'retail',
        isOrderRetailExtra: true,
        name: item.name || '物販商品',
        unitPrice,
        quantity,
        totalPrice: unitPrice * quantity,
        allowsTakeout: false,
        isTakeout: false,
        categoryId: item.categoryId || '',
        categoryName: item.categoryName || '物販',
        _key: detailKey,
        itemKeys: [detailKey],
        details: [{
          key: detailKey,
          unitPrice,
          quantity,
          allowsTakeout: false,
          categoryId: item.categoryId || '',
          categoryName: item.categoryName || '物販',
          sourceType: item.sourceType || 'retail',
          isOrderRetailExtra: true,
          productId: item.productId || '',
          stockQuantity: item.stockQuantity ?? null
        }]
      });
    });

    return items;
  }, [orders, paidItemKeys, currentPayTargetItemKeys, menuItemSnapshotMap, orderRetailCart]);

  const ordersByCustomer = useMemo(
    () => groupOrdersByCustomer(orders),
    [orders]
  );

  const takeoutEligibleKeys = useMemo(() => {
    const keys = new Set();
    consolidatedItems.forEach((item) => {
      item.details.forEach((detail) => {
        if (allowTakeout && detail.allowsTakeout !== false) {
          keys.add(detail.key);
        }
      });
    });
    return keys;
  }, [allowTakeout, consolidatedItems]);

  const activeTakeoutItemKeys = useMemo(() => {
    const next = new Set();
    takeoutItemKeys.forEach((key) => {
      if (takeoutEligibleKeys.has(key)) next.add(key);
    });
    return next;
  }, [takeoutEligibleKeys, takeoutItemKeys]);

  const isEverythingTakeout = useMemo(() => {
    if (!consolidatedItems || consolidatedItems.length === 0) return false;
    const allDetails = consolidatedItems
      .flatMap((item) => item.details || [])
      .filter((detail) => allowTakeout && detail.allowsTakeout !== false);
    return allDetails.length > 0 && allDetails.every((detail) => activeTakeoutItemKeys.has(detail.key));
  }, [activeTakeoutItemKeys, allowTakeout, consolidatedItems]);

  const {
    subTotal,
    taxAmount,
    totalAmount,
    rawTotalAmount,
    discountAmount,
    promoExpenseAmount,
    voucherAmount,
    voucherChangeAmount,
    settlementAdjustmentTotal,
    salesAmountBeforeSettlementAdjustments,
    taxAmountReduced,
    taxAmountStandard,
    taxRateReduced,
    taxRateStandard
  } = useMemo(() => {
    if (!consolidatedItems || consolidatedItems.length === 0) {
      return {
        subTotal: 0,
        taxAmount: 0,
        totalAmount: 0,
        rawTotalAmount: 0,
        discountAmount: 0,
        promoExpenseAmount: 0,
        voucherAmount: 0,
        voucherChangeAmount: 0,
        settlementAdjustmentTotal: 0,
        salesAmountBeforeSettlementAdjustments: 0,
        taxAmountReduced: 0,
        taxAmountStandard: 0,
        taxRateReduced: Number(settings?.taxRateReduced ?? 8),
        taxRateStandard: Number(settings?.taxRate ?? 10)
      };
    }

    const standardRate = Number(settings?.taxRate ?? 10);
    const reducedRate = Number(settings?.taxRateReduced ?? 8);
    const taxRounding = normalizeTaxRounding(settings?.taxRounding);

    let totalReducedIncl = 0;
    let totalStandardIncl = 0;

    consolidatedItems.forEach((item) => {
      item.details.forEach((detail) => {
        const menuInclPrice = Number(detail.unitPrice);
        const qty = Number(detail.quantity);
        const netUnitPrice = applyTaxRounding(menuInclPrice / (1 + standardRate / 100), taxRounding);

        if (allowTakeout && detail.allowsTakeout !== false && activeTakeoutItemKeys.has(detail.key)) {
          const takeoutInclPrice = toTaxIncludedAmount(netUnitPrice, reducedRate, taxRounding);
          totalReducedIncl += takeoutInclPrice * qty;
        } else {
          totalStandardIncl += menuInclPrice * qty;
        }
      });
    });

    const rawTotalIncl = totalReducedIncl + totalStandardIncl;

    let salesDiscountRaw = 0;
    let promoExpenseRaw = 0;
    let voucherRaw = 0;

    const addAccountingAdjustment = (category, amount) => {
      const normalizedAmount = Math.max(Number(amount) || 0, 0);
      if (normalizedAmount <= 0) return;

      if (category === 'promo_expense') {
        promoExpenseRaw += normalizedAmount;
        return;
      }

      if (category === 'voucher_payment') {
        voucherRaw += normalizedAmount;
        return;
      }

      salesDiscountRaw += normalizedAmount;
    };

    if (discountType === 'percent') {
      const percentAmount = Math.floor(rawTotalIncl * (Number(discountValue) / 100));
      addAccountingAdjustment(selectedDiscount?.accountingCategory || 'sales_discount', percentAmount);
    }

    if (discountType === 'amount') {
      if (Array.isArray(selectedDiscount?.items) && selectedDiscount.items.length > 0) {
        selectedDiscount.items.forEach((item) => {
          addAccountingAdjustment(item.accountingCategory || 'sales_discount', Number(item.amount || 0));
        });
      } else {
        addAccountingAdjustment(selectedDiscount?.accountingCategory || 'sales_discount', Number(discountValue || 0));
      }
    }

    const salesDiscountAmount = Math.min(salesDiscountRaw, rawTotalIncl);
    const salesAmountBeforeSettlement = Math.max(0, rawTotalIncl - salesDiscountAmount);
    const promoExpenseAmountValue = Math.min(promoExpenseRaw, salesAmountBeforeSettlement);
    const voucherAmountValue = Math.min(voucherRaw, Math.max(0, salesAmountBeforeSettlement - promoExpenseAmountValue));
    const settlementAdjustmentTotalValue = promoExpenseAmountValue + voucherAmountValue;

    // お釣りON金券(voucher_payment×定型金額×allowsChange)の額面が支払残額を超えた分を現金お釣りで返す。
    // お釣りはON金券の額面合計が上限(OFF金券・手入力由来の超過は従来どおり切り捨て)。
    const changeSourceItems = discountType === 'amount'
      ? (Array.isArray(selectedDiscount?.items) && selectedDiscount.items.length > 0
          ? selectedDiscount.items
          : selectedDiscount ? [selectedDiscount] : [])
      : [];
    const voucherChangeEligibleFace = changeSourceItems
      .filter((item) => (
        item?.accountingCategory === 'voucher_payment' &&
        item?.allowsChange === true &&
        (item?.type || 'amount') === 'amount'
      ))
      .reduce((sum, item) => sum + Math.max(0, Number(item.amount ?? item.value) || 0), 0);
    const voucherChangeAmountValue = Math.min(
      Math.max(0, voucherRaw - voucherAmountValue),
      voucherChangeEligibleFace
    );

    const finalTotalAmount = Math.max(0, salesAmountBeforeSettlement - settlementAdjustmentTotalValue);
    // 全額方式(A): 売上値引き＋販促費は課税対象を減らす。金券/売掛は充当(満額課税)なので含めない。
    const taxableReducingAmount = salesDiscountAmount + promoExpenseAmountValue;
    const [reducedDiscountAmount, standardDiscountAmount] = allocateAmountByWeight(
      taxableReducingAmount,
      [totalReducedIncl, totalStandardIncl]
    );
    const currentReducedIncl = totalReducedIncl - reducedDiscountAmount;
    const currentStandardIncl = totalStandardIncl - standardDiscountAmount;

    const reducedBreakdown = splitTaxIncludedAmount(currentReducedIncl, reducedRate, taxRounding);
    const standardBreakdown = splitTaxIncludedAmount(currentStandardIncl, standardRate, taxRounding);

    return {
      subTotal: Number(reducedBreakdown.baseAmount + standardBreakdown.baseAmount),
      taxAmount: Number(reducedBreakdown.taxAmount + standardBreakdown.taxAmount),
      totalAmount: Number(finalTotalAmount),
      rawTotalAmount: Number(rawTotalIncl),
      discountAmount: Number(salesDiscountAmount),
      promoExpenseAmount: Number(promoExpenseAmountValue),
      voucherAmount: Number(voucherAmountValue),
      voucherChangeAmount: Number(voucherChangeAmountValue),
      settlementAdjustmentTotal: Number(settlementAdjustmentTotalValue),
      salesAmountBeforeSettlementAdjustments: Number(salesAmountBeforeSettlement),
      taxAmountReduced: Number(reducedBreakdown.taxAmount),
      taxAmountStandard: Number(standardBreakdown.taxAmount),
      taxRateReduced: reducedRate,
      taxRateStandard: standardRate
    };
  }, [activeTakeoutItemKeys, allowTakeout, consolidatedItems, discountType, discountValue, selectedDiscount, settings]);

  const changeAmount = useMemo(() => {
    const paid = Number(paymentAmount) || 0;
    return Math.max(0, paid - totalAmount);
  }, [paymentAmount, totalAmount]);

  // 割引・金券・売掛で支払額が0になった会計。支払い方法の選択は不要になり、
  // 「会計を確定」ボタン1つで確定する(内部的には売掛系(credit)として記録=従来の全額売掛と同じ)。
  const isZeroPayableCheckout = Array.isArray(consolidatedItems)
    && consolidatedItems.length > 0
    && Number(rawTotalAmount) > 0
    && Number(totalAmount) === 0;

  // reset stale payment input when checkout target changes
  useEffect(() => {
    setPaymentAmount('');
    setPaymentMethod('');
  }, [checkoutSelectionMode, currentPayTargetSignature, totalAmount]);

  // 次の会計を右ペインで開始したら、前回の会計完了トーストを親に閉じてもらう。
  // お支払額(paymentAmount)は現金のみで立つため、全支払方法で立つ paymentMethod を
  // トリガーにする。会計完了時 paymentMethod は値が変わらない(現金/カード等はそのまま)ので
  // effect が再実行されず誤爆しない。会計対象が変わると paymentMethod は '' にリセットされ
  // (上の reset 用 effect)、次の会計で支払方法を選び直した時に発火する。
  useEffect(() => {
    if (paymentMethod !== '') {
      onCheckoutAmountEntered?.();
    }
  }, [paymentMethod]);

  const getCancellableOrderItemEntries = (order) => {
    if (!order?.items || !Array.isArray(order.items)) return [];

    return order.items
      .map((item, index) => ({
        order,
        item,
        index,
        key: `${order.id}-${index}`
      }))
      .filter(({ item, key }) => (
        item &&
        !paidItemKeys.has(key) &&
        item.paymentStatus !== 'paid'
      ));
  };

  const buildCancelTarget = ({ type, customerId, orderId, itemKey }) => {
    if (type === 'item') {
      const [targetOrderId, indexText] = String(itemKey || '').split(/-(?=[^-]+$)/);
      const itemIndex = Number(indexText);
      const order = orders.find((targetOrder) => targetOrder.id === targetOrderId);

      if (!order || !Number.isInteger(itemIndex)) return null;

      const item = Array.isArray(order.items) ? order.items[itemIndex] : null;
      const key = `${order.id}-${itemIndex}`;

      if (!item || paidItemKeys.has(key) || item.paymentStatus === 'paid') {
        return null;
      }

      return {
        type: 'item',
        title: '商品を取消しますか？',
        description: `${item.name || '商品'} x${Number(item.quantity || 0) || 1}`,
        entries: [{ order, item, index: itemIndex, key }]
      };
    }

    if (type === 'order') {
      const order = orders.find((targetOrder) => targetOrder.id === orderId);
      const entries = getCancellableOrderItemEntries(order);

      if (!order || entries.length === 0) return null;

      return {
        type: 'order',
        title: '注文を取消しますか？',
        description: `注文 #${String(order.id || '').slice(-4)} の未会計商品 ${entries.length}点を取消します。`,
        entries
      };
    }

    if (type === 'customer') {
      const targetOrders = ordersByCustomer[customerId] || [];
      const entries = targetOrders.flatMap((order) => getCancellableOrderItemEntries(order));

      if (entries.length === 0) return null;

      return {
        type: 'customer',
        title: '注文者の未会計商品を取消しますか？',
        description: `${entries.length}点の未会計商品を取消します。`,
        entries
      };
    }

    return null;
  };


  const resolveItemEntryByKey = (itemKey) => {
    const [targetOrderId, indexText] = String(itemKey || '').split(/-(?=[^-]+$)/);
    const itemIndex = Number(indexText);
    const order = orders.find((targetOrder) => targetOrder.id === targetOrderId);

    if (!order || !Number.isInteger(itemIndex) || !Array.isArray(order.items)) return null;

    const item = order.items[itemIndex];
    const key = `${order.id}-${itemIndex}`;

    if (!item || paidItemKeys.has(key) || item.paymentStatus === 'paid') return null;

    return {
      order,
      item,
      index: itemIndex,
      key
    };
  };

  const getSelectableQuantity = (item) => {
    const quantity = Number(item?.quantity || 0) || 1;
    return Math.max(1, Math.floor(quantity));
  };

  const closeQuantityPicker = () => {
    setQuantityPicker(null);
  };

  const splitOrderItemForQuantitySelection = async ({ itemKey, quantity }) => {
    const entry = resolveItemEntryByKey(itemKey);
    if (!entry || isCancelledPosItem(entry.item)) return null;

    const maxQuantity = getSelectableQuantity(entry.item);
    const selectedQuantity = Math.max(1, Math.min(Number(quantity) || 1, maxQuantity));

    if (selectedQuantity >= maxQuantity) {
      return entry.key;
    }

    const remainingQuantity = maxQuantity - selectedQuantity;
    const splitAtClient = new Date().toISOString();
    const splitAtMs = Date.now();

    const nextItems = entry.order.items.flatMap((item, index) => {
      if (index !== entry.index) return [item];

      const selectedItem = {
        ...item,
        quantity: selectedQuantity,
        splitFromItemKey: entry.key,
        splitReason: 'pos_quantity_select',
        splitAtClient,
        splitAtMs
      };

      const remainingItem = {
        ...item,
        quantity: remainingQuantity,
        splitFromItemKey: entry.key,
        splitReason: 'pos_quantity_remaining',
        splitAtClient,
        splitAtMs
      };

      return [selectedItem, remainingItem];
    });

    const activeItems = nextItems.filter((item) => item && !isCancelledPosItem(item));
    const remainingTotalPrice = activeItems.reduce((sum, item) => {
      const unitPrice = Number(item.unitPrice || 0) || 0;
      const qty = Number(item.quantity || 0) || 0;
      return sum + (unitPrice * qty);
    }, 0);

    const batch = writeBatch(db);
    batch.update(doc(db, 'stores', storeId, 'orders', entry.order.id), {
      items: nextItems,
      totalPrice: remainingTotalPrice,
      activeItemCount: activeItems.length,
      cancelledItemCount: nextItems.length - activeItems.length,
      updatedAt: serverTimestamp(),
      updatedAtMs: splitAtMs
    });

    await batch.commit();

    // 分割後も、選択対象は元index側に残す。
    return entry.key;
  };

  const requestQuantityForItemSelection = (itemKey) => {
    const entry = resolveItemEntryByKey(itemKey);
    if (!entry || isCancelledPosItem(entry.item)) return false;

    const maxQuantity = getSelectableQuantity(entry.item);
    if (maxQuantity <= 1) return false;

    setQuantityPicker({
      mode: 'select',
      itemKey,
      title: '数量を選択',
      description: `${entry.item.name || '商品'} をいくつ選択しますか？`,
      maxQuantity,
      quantity: 1
    });

    return true;
  };

  const requestQuantityForItemCancel = (payload, target) => {
    if (!payload || payload.type !== 'item') return false;

    const entry = Array.isArray(target?.entries) ? target.entries[0] : null;
    if (!entry || isCancelledPosItem(entry.item)) return false;

    const maxQuantity = getSelectableQuantity(entry.item);
    if (maxQuantity <= 1) return false;

    setQuantityPicker({
      mode: 'cancel',
      payload,
      target,
      itemKey: entry.key,
      title: '取消数量を選択',
      description: `${entry.item.name || '商品'} をいくつ取消しますか？`,
      maxQuantity,
      quantity: 1
    });

    return true;
  };

  const updateQuantityPickerValue = (nextQuantity) => {
    setQuantityPicker((previous) => {
      if (!previous) return previous;

      const maxQuantity = Math.max(1, Number(previous.maxQuantity || 1) || 1);
      const quantity = Math.max(1, Math.min(Number(nextQuantity) || 1, maxQuantity));

      return {
        ...previous,
        quantity
      };
    });
  };

  const confirmQuantityPicker = async () => {
    if (!quantityPicker || isCancelSubmitting) return;

    const picker = quantityPicker;
    const quantity = Math.max(1, Math.min(Number(picker.quantity || 1) || 1, Number(picker.maxQuantity || 1) || 1));

    setQuantityPicker(null);

    if (picker.mode === 'select') {
      try {
        const selectedKey = await splitOrderItemForQuantitySelection({
          itemKey: picker.itemKey,
          quantity
        });

        if (selectedKey) {
          toggleItemKeyGroup([selectedKey]);
        }
      } catch (error) {
        console.error('レジ数量選択エラー:', error);
        alert('数量選択に失敗しました');
      }

      return;
    }

    if (picker.mode === 'cancel') {
      const target = picker.target || buildCancelTarget(picker.payload || {});
      if (!target || !Array.isArray(target.entries) || target.entries.length === 0) return;

      const activeEntries = target.entries
        .filter(({ item }) => !isCancelledPosItem(item))
        .map((entry) => ({
          ...entry,
          cancelQuantity: quantity
        }));

      if (activeEntries.length === 0) return;

      setCancelTarget({
        ...target,
        description: `${activeEntries[0]?.item?.name || '商品'} x${quantity}`,
        entries: activeEntries
      });
    }
  };

  const executeRestoreCancelledTarget = async (payload) => {
    if (!payload || isCancelSubmitting) return;

    const target = buildCancelTarget(payload);
    const entries = Array.isArray(target?.entries) ? target.entries : [];

    if (entries.length === 0) return;

    const cancelledEntries = entries.filter(({ item }) => isCancelledPosItem(item));
    if (cancelledEntries.length === 0) return;

    // 復旧は確認なし・モーダルなしで即時反映する。
    // 取消処理用のオーバーレイを出さないため、processingAction/loading は触らない。
    try {
      const batch = writeBatch(db);
      const restoredAtClient = new Date().toISOString();
      const restoredAtMs = Date.now();

      const entriesByOrderId = cancelledEntries.reduce((map, entry) => {
        if (!entry?.order?.id) return map;
        const list = map.get(entry.order.id) || [];
        list.push(entry);
        map.set(entry.order.id, list);
        return map;
      }, new Map());

      entriesByOrderId.forEach((orderEntries, orderId) => {
        const order = orders.find((targetOrder) => targetOrder.id === orderId);
        if (!order?.items || !Array.isArray(order.items)) return;

        const restoreIndexSet = new Set(orderEntries.map((entry) => Number(entry.index)));

        const nextItems = order.items.map((item, index) => {
          if (!restoreIndexSet.has(index)) return item;
          if (!item || item.paymentStatus === 'paid') return item;

          const {
            cancelledBy,
            cancelReason,
            cancelledAtClient,
            cancelledAtMs,
            ...rest
          } = item;

          return {
            ...rest,
            status: 'pending',
            kitchenStatus: 'pending',
            restoredBy: 'pos',
            restoredAtClient,
            restoredAtMs
          };
        });

        const activeItems = nextItems.filter((item) => item && !isCancelledPosItem(item));
        const remainingTotalPrice = activeItems.reduce((sum, item) => {
          const unitPrice = Number(item.unitPrice || 0) || 0;
          const quantity = Number(item.quantity || 0) || 0;
          return sum + (unitPrice * quantity);
        }, 0);

        batch.update(doc(db, 'stores', storeId, 'orders', orderId), {
          items: nextItems,
          totalPrice: remainingTotalPrice,
          activeItemCount: activeItems.length,
          cancelledItemCount: nextItems.length - activeItems.length,
          status: 'pending',
          paymentStatus: order.paymentStatus === 'cancelled' ? 'unpaid' : order.paymentStatus,
          updatedAt: serverTimestamp(),
          updatedAtMs: restoredAtMs,
          restoredAt: serverTimestamp(),
          restoredAtMs
        });
      });

      await batch.commit();
    } catch (error) {
      console.error('レジ取消復旧エラー:', error);
      alert('復旧に失敗しました');
    } finally {
      // 復旧では画面全体の処理中モーダルを使わない。
    }
  };

  const handleRequestCancelTarget = (payload) => {
    const target = buildCancelTarget(payload || {});

    if (!target || !Array.isArray(target.entries) || target.entries.length === 0) {
      return;
    }

    const hasCancelledEntry = target.entries.some(({ item }) => isCancelledPosItem(item));
    const hasActiveEntry = target.entries.some(({ item }) => !isCancelledPosItem(item));

    // 取消済みだけを長押しした場合は、確認なしで即復旧。
    // 未取消が含まれる場合は、従来通り確認モーダルで取消。
    if (hasCancelledEntry && !hasActiveEntry) {
      executeRestoreCancelledTarget(payload || {});
      return;
    }

    if (requestQuantityForItemCancel(payload || {}, target)) {
      return;
    }

    setCancelTarget({
      ...target,
      entries: target.entries.filter(({ item }) => !isCancelledPosItem(item))
    });
  };

  const executeCancelTarget = async () => {
    if (!cancelTarget || isCancelSubmitting) return;

    const entries = Array.isArray(cancelTarget.entries) ? cancelTarget.entries : [];
    if (entries.length === 0) {
      setCancelTarget(null);
      return;
    }

    setIsCancelSubmitting(true);

    try {
      const batch = writeBatch(db);
      const cancelledAtClient = new Date().toISOString();
      const cancelledAtMs = Date.now();

      const entriesByOrderId = entries.reduce((map, entry) => {
        if (!entry?.order?.id) return map;
        const list = map.get(entry.order.id) || [];
        list.push(entry);
        map.set(entry.order.id, list);
        return map;
      }, new Map());

      const plannedItemsByOrderId = new Map();

      entriesByOrderId.forEach((orderEntries, orderId) => {
        const order = orders.find((targetOrder) => targetOrder.id === orderId);
        if (!order?.items || !Array.isArray(order.items)) return;

        const cancelEntryByIndex = new Map(
          orderEntries.map((entry) => [Number(entry.index), entry])
        );

        const nextItems = order.items.flatMap((item, index) => {
          const cancelEntry = cancelEntryByIndex.get(index);

          if (!cancelEntry) return [item];

          if (!item || isCancelledPosItem(item) || item.paymentStatus === 'paid') {
            return [item];
          }

          const currentQuantity = getSelectableQuantity(item);
          const cancelQuantity = Math.max(
            1,
            Math.min(Number(cancelEntry.cancelQuantity || currentQuantity) || currentQuantity, currentQuantity)
          );

          const cancelledItem = {
            ...item,
            quantity: cancelQuantity,
            status: 'cancelled',
            kitchenStatus: 'cancelled',
            cancelledBy: 'pos',
            cancelReason: 'pos_manual_cancel',
            cancelledAtClient,
            cancelledAtMs
          };

          if (cancelQuantity >= currentQuantity) {
            return [cancelledItem];
          }

          const remainingItem = {
            ...item,
            quantity: currentQuantity - cancelQuantity,
            splitFromItemKey: cancelEntry.key,
            splitReason: 'pos_cancel_remaining',
            splitAtClient: cancelledAtClient,
            splitAtMs: cancelledAtMs
          };

          return [cancelledItem, remainingItem];
        });

        plannedItemsByOrderId.set(orderId, nextItems);

        const activeItems = nextItems.filter((item) => item && !isCancelledPosItem(item));
        const isOrderFullyCancelled = activeItems.length === 0;
        const remainingTotalPrice = activeItems.reduce((sum, item) => {
          const unitPrice = Number(item.unitPrice || 0) || 0;
          const quantity = Number(item.quantity || 0) || 0;
          return sum + (unitPrice * quantity);
        }, 0);

        batch.update(doc(db, 'stores', storeId, 'orders', orderId), {
          items: nextItems,
          totalPrice: remainingTotalPrice,
          activeItemCount: activeItems.length,
          cancelledItemCount: nextItems.length - activeItems.length,
          updatedAt: serverTimestamp(),
          updatedAtMs: cancelledAtMs,

          // POSの個別取消では注文ドキュメント自体は消さない。
          // 全商品取消でもレジ上に「取消済み」として残し、長押し復旧できるようにする。
          status: 'pending',
          paymentStatus: order.paymentStatus === 'partial_paid' ? 'partial_paid' : 'unpaid',

          ...(isOrderFullyCancelled
            ? {
                allItemsCancelledByPos: true,
                cancelledAt: serverTimestamp(),
                cancelledAtMs,
                cancelledBy: 'pos',
                closeReason: 'pos_manual_cancel'
              }
            : {
                allItemsCancelledByPos: false
              })
        });
      });

      await batch.commit();

      const cancelledKeys = new Set(entries.map((entry) => entry.key));

      const isPayableAfterCancel = (item, key) => (
        item &&
        !isCancelledPosItem(item) &&
        item.paymentStatus !== 'paid' &&
        !paidItemKeys.has(key)
      );

      const hasRemainingPayableItems = orders.some((order) => {
        const plannedItems = plannedItemsByOrderId.get(order.id) || order.items;
        if (!Array.isArray(plannedItems)) return false;

        return plannedItems.some((item, index) => {
          const key = `${order.id}-${index}`;
          return isPayableAfterCancel(item, key);
        });
      });

      setSelectedItemKeys((previous) => {
        const next = new Set(previous);
        cancelledKeys.forEach((key) => next.delete(key));
        return next;
      });

      setTakeoutItemKeys((previous) => {
        const next = new Set(previous);
        cancelledKeys.forEach((key) => next.delete(key));
        return next;
      });

      setCancelTarget(null);

      if (!hasRemainingPayableItems) {
        setAbortReason('all_items_cancelled');
        window.setTimeout(() => {
          setShowAbortModal(true);
        }, 120);
      }
    } catch (error) {
      console.error('レジ取消エラー:', error);
      alert('取消に失敗しました');
    } finally {
      setIsCancelSubmitting(false);
    }
  };

  const executeAbortSession = async ({ reason = 'manual_abort' } = {}) => {
    setProcessingAction('exit');
    setLoading(true);

    try {
      const batch = writeBatch(db);
      const cancelledAt = serverTimestamp();

      batch.update(doc(db, 'stores', storeId, 'sessions', sessionId), {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        cancelledAt,
        closedAt: cancelledAt,
        closeReason: reason,
        updatedAt: cancelledAt
      });

      const ordersQuery = query(
        collection(db, 'stores', storeId, 'orders'),
        where('sessionId', '==', sessionId)
      );

      const ordersSnap = await getDocs(ordersQuery);

      ordersSnap.forEach((orderDoc) => {
        batch.update(orderDoc.ref, {
          status: 'cancelled',
          paymentStatus: 'cancelled',
          cancelledAt,
          closeReason: reason,
          updatedAt: cancelledAt
        });
      });

      const requestQuery = query(
        collection(db, 'stores', storeId, 'serviceRequests'),
        where('sessionId', '==', sessionId)
      );

      const requestSnap = await getDocs(requestQuery);

      requestSnap.forEach((requestDoc) => {
        batch.update(requestDoc.ref, {
          status: 'completed',
          completedAt: cancelledAt,
          closeReason: reason,
          updatedAt: cancelledAt
        });
      });

      // 会計済みのトランザクションも無効化する。
      // （無会計退店でも注文だけキャンセルされ売上が残り、日計・締めで二重計上されるバグ対策）
      const sessionTxnQuery = query(
        collection(db, 'stores', storeId, 'transactions'),
        where('sessionId', '==', sessionId)
      );
      const sessionTxnSnap = await getDocs(sessionTxnQuery);
      const restoreByProduct = new Map();
      sessionTxnSnap.forEach((txnDoc) => {
        const txn = txnDoc.data() || {};
        if (txn.isPaid === false) return; // 既に取消済みはスキップ
        // retail商品は会計時に在庫を減らしているため取消時に戻す。
        (Array.isArray(txn.items) ? txn.items : []).forEach((item) => {
          if (item?.sourceType !== 'retail' || !item?.productId) return;
          const qty = Math.max(Number(item.quantity || 0), 0);
          if (qty > 0) {
            restoreByProduct.set(item.productId, (restoreByProduct.get(item.productId) || 0) + qty);
          }
        });
        const cancellationLog = {
          cancelledAt: new Date().toISOString(),
          reason,
          amount: Number(txn.totalAmount || 0),
          type: 'full',
          source: 'abort_session'
        };
        batch.update(txnDoc.ref, {
          status: 'cancelled',
          paymentStatus: 'cancelled',
          isPaid: false,
          voidedAt: cancelledAt,
          closeReason: reason,
          hasCancellations: true,
          cancellations: [
            ...(Array.isArray(txn.cancellations) ? txn.cancellations : []),
            cancellationLog
          ],
          updatedAt: cancelledAt
        });
      });
      restoreByProduct.forEach((qty, productId) => {
        batch.update(doc(db, 'stores', storeId, 'products', productId), {
          inventoryQuantity: increment(qty),
          quantity: increment(qty),
          updatedAt: cancelledAt
        });
      });

      await clearSessionAccess(batch);
      await batch.commit();

      setShowAbortModal(false);
      setAbortReason('manual_abort');
      clearCrmMember(); // 退店(破棄)でも会員を持ち越さない

      // 退店処理は会計処理ではないので、会計完了モーダルへ流さない。
      onBack?.();
    } catch (error) {
      console.error('退店処理エラー:', error);
      alert('退店処理に失敗しました');
    } finally {
      setLoading(false);
      setProcessingAction(null);
    }
  };

  const hasOrderItems = Array.isArray(consolidatedItems) && consolidatedItems.length > 0;
  const hasCheckoutAmount = Number(totalAmount || 0) > 0;
  const effectiveTotalPayableItemCount = Number(totalPayableItemCount || 0) + Number(orderRetailCart.length || 0);
  const isEmptyCheckout = !hasOrderItems && !hasCheckoutAmount;

  const handleAbortSession = () => {
    if (isEmptyCheckout) {
      executeAbortSession({ reason: 'empty_exit' });
      return;
    }

    setAbortReason('manual_abort');
    setShowAbortModal(true);
  };
  const handlePayment = async () => {
    if (isPaymentSubmitting) return;
    if (consolidatedItems.length === 0) return;

    // 支払額0(全額充当)の会計は支払い方法を選ばず「会計を確定」で確定するため、
    // 記録上は売掛系(credit)に寄せる(従来の全額売掛ワンタップと同じ扱い)。
    const paymentMethodForCheckout = isZeroPayableCheckout ? 'credit' : resolvedPaymentMethod;
    const isFullCredit = paymentMethodForCheckout === 'credit';
    const checkoutTotalAmount = Number(totalAmount || 0);
    // 全額売掛・全額充当は支払総額0が正常。値引き前の総額があれば許可する。
    if (isFullCredit) {
      if (Number(rawTotalAmount || 0) <= 0) {
        alert('会計金額が正しくありません。会計対象を選び直してください。');
        return;
      }
    } else if (checkoutTotalAmount <= 0) {
      alert('会計金額が正しくありません。会計対象を選び直してください。');
      return;
    }

    if (paymentMethodForCheckout === 'cash' && (Number(paymentAmount) || 0) < checkoutTotalAmount) {
      alert('お預かり金額が不足しています');
      return;
    }

    // 現金＋カード/QR の分割会計。成立時は payments[] に現金/カードの内訳を持たせて記録する。
    const paymentSplit = computePaymentSplit(paymentMethodForCheckout, paymentAmount, checkoutTotalAmount);
    const resolvedPaymentMethodLabel = paymentSplit.isSplit
      ? `現金＋${getSplitMethodLabel(paymentSplit.otherMethod)}`
      : '';

    // 金券お釣りは現金ドロワーから出るため、現金マイナスの入金内訳として記録する。
    // 日計の入金内訳は payments[] を優先合算するので、現金内訳・ドロワー突合に自動で効く。
    const paymentsForRecord = Number(voucherChangeAmount) > 0
      ? [
          // お釣りが出る=金券が支払残額を全て充当した状態なので通常 totalAmount は 0 だが、
          // 万一残額があれば選択中の支払方法の入金として保持する(payments[]は日計で排他的に使われるため)。
          ...(paymentSplit.isSplit
            ? paymentSplit.payments
            : Number(totalAmount) > 0
              ? [{ method: paymentMethodForCheckout, amount: Number(totalAmount) }]
              : []),
          { method: 'cash', amount: -Number(voucherChangeAmount), isVoucherChange: true }
        ]
      : (paymentSplit.isSplit ? paymentSplit.payments : null);

    setIsPaymentSubmitting(true);
    setIsPaymentFlowLocked(true);

    try {
      const batch = writeBatch(db);
      const newlyPaidKeys = new Set();
      consolidatedItems.forEach((item) => {
        if (item.isOrderRetailExtra) return;
        item.details.forEach((detail) => newlyPaidKeys.add(detail.key));
      });

      const isSessionComplete = orders.every((order) => {
        if (!order.items || !Array.isArray(order.items)) return true;

        const activeItemEntries = order.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => (
            item?.status !== 'cancelled' &&
            item?.kitchenStatus !== 'cancelled'
          ));

        if (activeItemEntries.length === 0) return true;

        return activeItemEntries.every(({ index }) => {
          const key = `${order.id}-${index}`;
          return paidItemKeys.has(key) || newlyPaidKeys.has(key);
        });
      });

      const standardTax = Number(settings?.taxRate ?? 10);
      const reducedTax = Number(settings?.taxRateReduced ?? 8);
      const taxRounding = normalizeTaxRounding(settings?.taxRounding);
      const standardDivider = 1 + (standardTax / 100);

      const paidAtClient = new Date().toISOString();
      const selectedOrders = orders.filter((order) => (
        order &&
        Array.isArray(order.items) &&
        order.items.some((item, index) => (
          item &&
          !isCancelledPosItem(item) &&
          !paidItemKeys.has(`${order.id}-${index}`) &&
          item.paymentStatus !== 'paid' &&
          currentPayTargetItemKeys.has(`${order.id}-${index}`)
        ))
      ));

      const orderSummaries = selectedOrders.map((order) => {
        let rawOrderReducedIncl = 0;
        let rawOrderStandardIncl = 0;

        const activeItemIndexSet = new Set(
          order.items
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => !isCancelledPosItem(item))
            .map(({ index }) => index)
        );

        const updatedItems = order.items.map((item, index) => {
          const itemKey = `${order.id}-${index}`;
          const isCancelledItem =
            item?.status === 'cancelled' ||
            item?.kitchenStatus === 'cancelled' ||
            !activeItemIndexSet.has(index);

          if (isCancelledItem) {
            return {
              ...item,
              allowsTakeout: item?.allowsTakeout !== false,
              isTakeout: false
            };
          }

          const isPayTarget = currentPayTargetItemKeys.has(itemKey);

          if (!isPayTarget) {
            return item;
          }

          const allowsTakeout = item.allowsTakeout !== false;
          const isTakeout = allowTakeout && allowsTakeout && activeTakeoutItemKeys.has(itemKey);
          const menuPrice = Number(item.unitPrice) || 0;
          const qty = Number(item.quantity) || 1;
          const netUnitPrice = applyTaxRounding(menuPrice / standardDivider, taxRounding);

          let lineIncl = 0;
          if (isTakeout) {
            lineIncl = toTaxIncludedAmount(netUnitPrice, reducedTax, taxRounding) * qty;
            rawOrderReducedIncl += lineIncl;
          } else {
            lineIncl = menuPrice * qty;
            rawOrderStandardIncl += lineIncl;
          }

          return {
            ...item,
            allowsTakeout,
            isTakeout,
            taxRate: isTakeout ? reducedTax : standardTax,
            paymentStatus: 'paid',
            paidAtClient
          };
        });

        return {
          id: order.id,
          customerId: resolveOrderCustomerId(order),
          updatedItems,
          rawOrderReducedIncl,
          rawOrderStandardIncl,
          rawOrderTotalIncl: rawOrderReducedIncl + rawOrderStandardIncl,
          orderHasTakeoutItem: updatedItems.some((targetItem) => (
            targetItem.isTakeout === true &&
            targetItem.status !== 'cancelled' &&
            targetItem.kitchenStatus !== 'cancelled'
          ))
        };
      });

      const orderDiscountAllocations = allocateAmountByWeight(
        discountAmount,
        orderSummaries.map((summary) => summary.rawOrderTotalIncl)
      );
      const customerSummaryMap = new Map();

      orderSummaries.forEach((summary, index) => {
        const orderDiscountAmount = orderDiscountAllocations[index] || 0;
        const [reducedDiscountAmount, standardDiscountAmount] = allocateAmountByWeight(
          orderDiscountAmount,
          [summary.rawOrderReducedIncl, summary.rawOrderStandardIncl]
        );

        const orderTotalReducedIncl = summary.rawOrderReducedIncl - reducedDiscountAmount;
        const orderTotalStandardIncl = summary.rawOrderStandardIncl - standardDiscountAmount;
        const finalOrderTotal = Number(orderTotalReducedIncl + orderTotalStandardIncl);
        const reducedBreakdown = splitTaxIncludedAmount(orderTotalReducedIncl, reducedTax, taxRounding);
        const standardBreakdown = splitTaxIncludedAmount(orderTotalStandardIncl, standardTax, taxRounding);

        const existingCustomerSummary = customerSummaryMap.get(summary.customerId) || {
          customerId: summary.customerId,
          orderIds: [],
          orderCount: 0,
          totalAmount: 0
        };
        existingCustomerSummary.orderIds.push(summary.id);
        existingCustomerSummary.orderCount += 1;
        existingCustomerSummary.totalAmount += finalOrderTotal;
        customerSummaryMap.set(summary.customerId, existingCustomerSummary);

        const isOrderCompleteAfterPayment = summary.updatedItems
          .map((item, itemIndex) => ({ item, itemIndex }))
          .filter(({ item }) => item && !isCancelledPosItem(item))
          .every(({ item }) => item.paymentStatus === 'paid');

        batch.update(doc(db, 'stores', storeId, 'orders', summary.id), {
          paymentStatus: isOrderCompleteAfterPayment ? 'paid' : 'partial_paid',
          paymentMethod: paymentMethodForCheckout,
          paidAt: isOrderCompleteAfterPayment ? serverTimestamp() : null,
          partialPaidAt: serverTimestamp(),
          isTakeout: summary.orderHasTakeoutItem,
          subtotal: Number(reducedBreakdown.baseAmount + standardBreakdown.baseAmount),
          taxAmountReduced: Number(reducedBreakdown.taxAmount),
          taxAmountStandard: Number(standardBreakdown.taxAmount),
          lastPaidAmount: finalOrderTotal,
          discountAmount: Number(orderDiscountAmount),
          sessionDiscountAmount: Number(discountAmount),
          items: summary.updatedItems
        });
      });

      const customerSummaries = Array.from(customerSummaryMap.values()).map((entry) => ({
        ...entry,
        totalAmount: Number(entry.totalAmount)
      }));
      const customerIds = customerSummaries.map((entry) => entry.customerId);

      let rawTransactionReducedIncl = 0;
      let rawTransactionStandardIncl = 0;

      consolidatedItems.forEach((item) => {
        (item.details || []).forEach((detail) => {
          const detailUnitPrice = Number(detail.unitPrice || 0);
          const detailQuantity = Number(detail.quantity || 0);
          const detailNetUnitPrice = applyTaxRounding(detailUnitPrice / standardDivider, taxRounding);

          if (allowTakeout && detail.allowsTakeout !== false && activeTakeoutItemKeys.has(detail.key)) {
            rawTransactionReducedIncl += toTaxIncludedAmount(detailNetUnitPrice, reducedTax, taxRounding) * detailQuantity;
          } else {
            rawTransactionStandardIncl += detailUnitPrice * detailQuantity;
          }
        });
      });

      // 全額方式(A): 売上値引き＋販促費を課税対象から控除。金券/売掛は満額課税(非控除)。
      const [transactionReducedDiscountAmount, transactionStandardDiscountAmount] = allocateAmountByWeight(
        Number(discountAmount) + Number(promoExpenseAmount),
        [rawTransactionReducedIncl, rawTransactionStandardIncl]
      );

      const transactionReducedIncl = Math.max(0, rawTransactionReducedIncl - transactionReducedDiscountAmount);
      const transactionStandardIncl = Math.max(0, rawTransactionStandardIncl - transactionStandardDiscountAmount);
      const transactionReducedBreakdown = splitTaxIncludedAmount(transactionReducedIncl, reducedTax, taxRounding);
      const transactionStandardBreakdown = splitTaxIncludedAmount(transactionStandardIncl, standardTax, taxRounding);

      const transactionTaxSummary = {
        reducedTaxRate: Number(taxRateReduced),
        standardTaxRate: Number(taxRateStandard),
        reducedTaxIncluded: Number(transactionReducedIncl),
        reducedTaxExcluded: Number(transactionReducedBreakdown.baseAmount),
        reducedTaxAmount: Number(transactionReducedBreakdown.taxAmount),
        standardTaxIncluded: Number(transactionStandardIncl),
        standardTaxExcluded: Number(transactionStandardBreakdown.baseAmount),
        standardTaxAmount: Number(transactionStandardBreakdown.taxAmount)
      };

    const selectedAccountingAdjustmentItems = Array.isArray(selectedDiscount?.items) && selectedDiscount.items.length > 0
      ? selectedDiscount.items
      : selectedDiscount
        ? [{
            id: selectedDiscount.id || null,
            name: selectedDiscount.name || '',
            type: selectedDiscount.type || discountType,
            value: Number(selectedDiscount.value ?? discountValue) || 0,
            accountingCategory: selectedDiscount.accountingCategory || 'sales_discount',
            allowsChange: selectedDiscount.allowsChange === true,
            count: selectedDiscount.type === 'amount'
              ? Number(selectedDiscount.quantity || selectedDiscount.count || 1)
              : 1,
            quantity: selectedDiscount.type === 'amount'
              ? Number(selectedDiscount.quantity || selectedDiscount.count || 1)
              : 1,
            amount: Number(discountType === 'percent' ? discountAmount : discountValue || 0)
          }]
        : [];

    const promoExpenseItems = selectedAccountingAdjustmentItems
      .filter((item) => item.accountingCategory === 'promo_expense')
      .map((item) => ({ ...item, type: item.type || 'amount', accountingCategory: 'promo_expense' }));

    // お釣りON金券は「額面(faceAmount)・充当(appliedAmount)・お釣り(changeAmount)」を明細に残す。
    // ダインインの vouchers は従来から額面(amount)で保存しており、日計側も額面回収として読む。
    let voucherChangeRemaining = Math.max(0, Number(voucherChangeAmount) || 0);
    const voucherItems = selectedAccountingAdjustmentItems
      .filter((item) => item.accountingCategory === 'voucher_payment')
      .map((item) => {
        const normalized = { ...item, type: item.type || 'amount', accountingCategory: 'voucher_payment' };
        const isChangeEligible = item.allowsChange === true && (item.type || 'amount') === 'amount';
        if (voucherChangeRemaining > 0 && isChangeEligible) {
          const face = Math.max(0, Number(item.amount) || 0);
          const change = Math.min(face, voucherChangeRemaining);
          voucherChangeRemaining -= change;
          return { ...normalized, faceAmount: face, appliedAmount: face - change, changeAmount: change };
        }
        return normalized;
      });

    const appliedDiscount = Number(discountAmount) > 0
      ? {
          id: selectedDiscount?.id || null,
          name:
            selectedDiscount?.name ||
            (
              discountType === 'percent'
                ? `${Number(discountValue) || 0}%割引`
                : `${Number(discountValue || 0).toLocaleString()}円割引`
            ),
          type: selectedDiscount?.type || discountType,
          accountingCategory: 'sales_discount',
          value: Number(selectedDiscount?.value ?? discountValue) || 0,
          count: selectedDiscount?.type === 'amount'
            ? Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)
            : 1,
          quantity: selectedDiscount?.type === 'amount'
            ? Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)
            : 1,
          amount: Number(discountAmount),
          includesRetailItems: orderRetailCart.length > 0,
          retailItemCount: orderRetailCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          retailItemAmount: orderRetailCart.reduce((sum, item) => (
            sum + (Number(item.unitPrice || item.takeoutPrice || 0) * Number(item.quantity || 0))
          ), 0),
          items: selectedAccountingAdjustmentItems.filter((item) => (item.accountingCategory || 'sales_discount') === 'sales_discount'),
          label:
            selectedDiscount?.type === 'amount' && selectedDiscount?.name
              ? `${selectedDiscount.name} × ${Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)}枚`
              : selectedDiscount?.name ||
                (
                  discountType === 'percent'
                    ? `${Number(discountValue) || 0}%割引`
                    : `${Number(discountValue || 0).toLocaleString()}円割引`
                )
        }
      : null;

      const transactionTaxBreakdown = {
        reduced: {
          rate: Number(transactionTaxSummary.reducedTaxRate || reducedTax || 8),
          sales: Number(transactionTaxSummary.reducedTaxIncluded || 0),
          baseAmount: Number(transactionTaxSummary.reducedTaxExcluded || 0),
          tax: Number(transactionTaxSummary.reducedTaxAmount || 0)
        },
        standard: {
          rate: Number(transactionTaxSummary.standardTaxRate || standardTax || 10),
          sales: Number(transactionTaxSummary.standardTaxIncluded || 0),
          baseAmount: Number(transactionTaxSummary.standardTaxExcluded || 0),
          tax: Number(transactionTaxSummary.standardTaxAmount || 0)
        }
      };

      const currentPeriodSnapshot = resolveCurrentPeriodSnapshot();
      const registerContext = getActiveRegisterContext(storeId, storeSettings?.registers, storeSettings?.departments);
      const hasOrderRetailExtras = orderRetailCart.length > 0;

      const transactionItems = consolidatedItems.map((item) => {
        const categoryId =
          item.categoryId ||
          item.category ||
          item.details?.find((detail) => detail.categoryId)?.categoryId ||
          '';

        const categoryName =
          item.categoryName ||
          item.details?.find((detail) => detail.categoryName)?.categoryName ||
          categoryNameMap[categoryId] ||
          'カテゴリー未設定';

        return {
          ...item,
          categoryId,
          categoryName
        };
      });


      const transactionRef = doc(collection(db, 'stores', storeId, 'transactions'));

      // --- カード会計: この端末に割り当てた Stripe リーダーで決済 ---
      // reader 割当があり支払いにカードが含まれる時のみ端末へ。未割当/現金/QR/売掛は従来どおり。
      // 分割はカード分のみ。batch はまだ未 commit なので失敗時 return で売上は記録されない。
      let stripePaymentIntentId = null;
      const registerCardAmount = paymentSplit.isSplit
        ? (paymentSplit.otherMethod === 'card' ? Number(paymentSplit.otherPortion) : 0)
        : (paymentMethodForCheckout === 'card' ? Number(checkoutTotalAmount) : 0);
      if (registerCardAmount > 0 && registerContext.stripeReaderId) {
        try {
          const cardResult = await term.runCardPayment({
            orderId: transactionRef.id,
            amount: registerCardAmount,
            registerId: registerContext.id,
          });
          stripePaymentIntentId = cardResult?.paymentIntentId || null;
        } catch (paymentError) {
          // 失敗/中止。モーダルが理由を表示済み。会計を中断しロックを解除。
          setIsPaymentSubmitting(false);
          setIsPaymentFlowLocked(false);
          return;
        }
      }

      batch.set(transactionRef, {
        sessionId,
        tableId,

        registerId: registerContext.id,
        registerName: registerContext.name,
        departmentId: registerContext.departmentId || 'retail',
        departmentName: registerContext.departmentName || '物販',
        registerMode: registerContext.registerMode || 'order',
        salesChannel: registerContext.registerMode === 'pos' ? 'pos_register' : 'order_register',
        salesChannelLabel: registerContext.registerMode === 'pos' ? 'POSレジ' : 'ORDERレジ',
        salesSubChannel: hasOrderRetailExtras ? 'order_table_with_retail' : 'order_table',
        salesSubChannelLabel: hasOrderRetailExtras ? '店内注文会計 + 物販' : '店内注文会計',

        customerIds,
        customerSummaries,
        items: transactionItems,

        guestCount: Number(guestCount || 0),

        periodId: currentPeriodSnapshot.periodId,
        periodName: currentPeriodSnapshot.periodName,

        subTotal: Number(subTotal),
        discountAmount: Number(discountAmount),
        promoExpenseAmount: Number(promoExpenseAmount),
        voucherAmount: Number(voucherAmount),
        voucherChangeAmount: Number(voucherChangeAmount),
        // 履歴からの再印字でレシートにお預かり/おつりを出すため保存する(現金以外は釣銭0)。
        paymentAmount: Number(paymentMethodForCheckout === 'cash' ? (Number(paymentAmount) || 0) : totalAmount),
        receivedAmount: Number(paymentMethodForCheckout === 'cash' ? (Number(paymentAmount) || 0) : totalAmount),
        changeAmount: Number(paymentMethodForCheckout === 'cash' ? changeAmount : 0),
        settlementAdjustmentTotal: Number(settlementAdjustmentTotal),
        salesAmountBeforeSettlementAdjustments: Number(salesAmountBeforeSettlementAdjustments),
        totalAmount: Number(totalAmount),

        taxAmount: Number(taxAmount),
        taxAmountReduced: Number(taxAmountReduced),
        taxAmountStandard: Number(taxAmountStandard),
        taxRateReduced: Number(taxRateReduced),
        taxRateStandard: Number(taxRateStandard),

        totalReducedIncl: Number(transactionTaxSummary.reducedTaxIncluded || 0),
        totalStandardIncl: Number(transactionTaxSummary.standardTaxIncluded || 0),

        taxSummary: transactionTaxSummary,
        taxBreakdown: transactionTaxBreakdown,

        discountType: discountType || 'none',
        discountValue: Number(discountValue) || 0,
        discountName: appliedDiscount?.name || '',
        discountDetail: appliedDiscount,

        appliedDiscount,
        appliedDiscounts: appliedDiscount ? [appliedDiscount] : [],

        promoExpenseItems,
        vouchers: voucherItems,
        accountingAdjustments: selectedAccountingAdjustmentItems,

        paymentMethod: paymentMethodForCheckout,
        paymentMethodGroup: paymentMethodForCheckout,
        ...(resolvedPaymentMethodLabel ? { paymentMethodLabel: resolvedPaymentMethodLabel } : {}),
        ...(paymentsForRecord ? { payments: paymentsForRecord } : {}),
        ...(paymentSplit.isSplit ? { isSplitPayment: true } : {}),
        ...(stripePaymentIntentId ? { stripePaymentIntentId, cardPaymentProvider: 'stripe_terminal' } : {}),

        timestamp: serverTimestamp(),
        paidAt: serverTimestamp(),
        businessDate: getJstBusinessDate(),

        // 会員(ポイント)。personId が乗った伝票だけ Core の付与トリガーが拾う。
        ...(crmMember?.personId ? { personId: crmMember.personId, crmSource: 'member_code' } : {}),

        isPaid: true
      });

      const orderRetailQuantityByProductId = new Map();
      const orderRetailMetaByProductId = new Map();
      orderRetailCart.forEach((item) => {
        if (item.sourceType !== 'retail' || !item.productId) return;
        const quantity = Math.max(Number(item.quantity || 0), 0);
        if (quantity <= 0) return;
        orderRetailQuantityByProductId.set(
          item.productId,
          (orderRetailQuantityByProductId.get(item.productId) || 0) + quantity
        );
        if (!orderRetailMetaByProductId.has(item.productId)) {
          orderRetailMetaByProductId.set(item.productId, {
            name: item.name || item.productName || '',
            productGroupId: item.productGroupId || item.groupId || ''
          });
        }
      });

      orderRetailQuantityByProductId.forEach((quantity, productId) => {
        const productRef = doc(db, 'stores', storeId, 'products', productId);
        batch.update(productRef, {
          inventoryQuantity: increment(-quantity),
          quantity: increment(-quantity),
          lastOrderRegisterSoldAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      if (isSessionComplete) {
        batch.update(doc(db, 'stores', storeId, 'sessions', sessionId), { status: 'paid', closedAt: serverTimestamp() });
      }

      const runPostPaymentCleanup = async () => {
        if (!isSessionComplete) return;

        try {
          const cleanupBatch = writeBatch(db);

          const requestQuery = query(
            collection(db, 'stores', storeId, 'serviceRequests'),
            where('sessionId', '==', sessionId),
            where('status', '==', 'pending')
          );
          const requestSnapshot = await getDocs(requestQuery);
          requestSnapshot.forEach((docSnap) => cleanupBatch.update(docSnap.ref, { status: 'completed' }));

          await clearSessionAccess(cleanupBatch);
          await cleanupBatch.commit();
        } catch (cleanupError) {
          console.error('会計後片付け処理エラー:', cleanupError);
        }
      };

      await batch.commit();

      if (isSessionComplete) {
        void runPostPaymentCleanup();
      }

      // 棚卸し進行中なら、販売した店頭在庫を棚卸しカウントへ反映する。
      // 店頭確定から1時間以内の販売は「数え直しリスト」に自動掲載される。
      if (orderRetailQuantityByProductId.size > 0) {
        const soldProductIds = [...orderRetailQuantityByProductId.keys()];

        void (async () => {
          try {
            const activeStocktake = await getActiveStocktake(storeId);
            if (activeStocktake?.id) {
              const soldItems = [...orderRetailQuantityByProductId.entries()]
                .map(([productId, quantity]) => ({ productId, quantity }));
              await applyStocktakeSaleAdjustment(storeId, activeStocktake.id, soldItems);
            }
          } catch (stocktakeError) {
            console.error('棚卸し連動エラー:', stocktakeError);
          }
        })();

        // 在庫連携ON(prodのみ)なら、販売後の在庫をShopifyへ反映する(関数側でゲート)。
        void (async () => {
          try {
            const idToken = await getAuth().currentUser?.getIdToken?.();
            if (idToken) {
              await pushInventoryToShopify({ storeId, productIds: soldProductIds, idToken });
            }
          } catch (shopifyError) {
            console.error('Shopify在庫反映エラー:', shopifyError);
          }
        })();

        // 販売による在庫減の監査ログ(stockMovements type=sale)。会計バッチには同梱しない:
        // ルール拒否や通信断で会計まで失敗した事故(2026-08-14)の再発防止で、commit成立後の
        // fire-and-forget とする(記録欠落は許容し、会計を人質にしない)。
        void (async () => {
          try {
            const movementBatch = writeBatch(db);
            orderRetailQuantityByProductId.forEach((quantity, productId) => {
              const meta = orderRetailMetaByProductId.get(productId) || {};
              movementBatch.set(doc(collection(db, 'stores', storeId, 'stockMovements')), {
                productId,
                productGroupId: meta.productGroupId || '',
                type: 'sale',
                quantity: -quantity,
                transactionId: transactionRef.id,
                registerId: registerContext.id,
                note: meta.name ? `ORDER販売(${meta.name})` : 'ORDER販売',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              });
            });
            await movementBatch.commit();
          } catch (movementError) {
            console.warn('販売履歴(stockMovements)の記録に失敗:', movementError);
          }
        })();
      }

      const issuedReceipt = null;

      setOrderRetailCart([]);
      setOrderRetailKeyword('');
      setOrderRetailMessage(null);

      setLastTransaction({
        total: Number(totalAmount),
        change: Number(changeAmount),
        method: paymentMethodForCheckout,
        receiptId: issuedReceipt?.receiptId || '',
        receiptNo: issuedReceipt?.receiptNo || '',
        transactionId: transactionRef.id,
        promoExpenseAmount: Number(promoExpenseAmount),
        voucherAmount: Number(voucherAmount),
        voucherChangeAmount: Number(voucherChangeAmount),
        settlementAdjustmentTotal: Number(settlementAdjustmentTotal),
        salesAmountBeforeSettlementAdjustments: Number(salesAmountBeforeSettlementAdjustments)
      });

      setPaidItemKeys(new Set([...paidItemKeys, ...newlyPaidKeys]));
      setPaymentAmount('');
      setSelectedItemKeys(new Set());
      setCheckoutSelectionMode('all');
      setDiscountType('none');
      setDiscountValue(0);
      setDiscountQuantities({});
      setSelectedDiscount(null);
      clearCrmMember(); // 会員は会計ごとに解除(次のお客様に持ち越さない)
      if (isFullCredit) setPaymentMethod('');
      setIsPaymentFlowLocked(false);

      onPaymentResult?.({
        totalAmount: Number(totalAmount),
        total: Number(totalAmount),
        paymentAmount: Number(paymentAmount) || Number(totalAmount),
        changeAmount: Number(changeAmount),
        change: Number(changeAmount),
        voucherChangeAmount: Number(voucherChangeAmount),
        method: paymentMethodForCheckout,
        paymentMethod: paymentMethodForCheckout,
        ...(resolvedPaymentMethodLabel ? { paymentMethodLabel: resolvedPaymentMethodLabel } : {}),
        payments: paymentsForRecord,
        isSplitPayment: paymentSplit.isSplit,
        receiptId: issuedReceipt?.receiptId || '',
        receiptNo: issuedReceipt?.receiptNo || '',
        transactionId: transactionRef.id,
        sessionId,
        isSessionComplete,
        canPrintReceipt: true,
        receiptType: isSessionComplete ? 'final' : 'partial',
        receiptScopeLabel: isSessionComplete ? '最終会計' : '個別会計',
        title: '領収書',
        // レシートに使用レジ名・割引内訳を出すため、会計データと同じ値を渡す。
        registerName: registerContext.name,
        registerMode: registerContext.registerMode || 'order',
        appliedDiscounts: appliedDiscount ? [appliedDiscount] : [],
        items: consolidatedItems,
        subTotal: Number(subTotal),
        taxAmount: Number(taxAmount),
        taxAmountReduced: Number(taxAmountReduced),
        taxAmountStandard: Number(taxAmountStandard),
        // レシートに税率別の税込対象額を出すため、会計伝票と同じ税内訳を渡す。
        taxBreakdown: transactionTaxBreakdown,
        taxSummary: transactionTaxSummary,
        discountAmount: Number(discountAmount),
        promoExpenseAmount: Number(promoExpenseAmount),
        voucherAmount: Number(voucherAmount),
        settlementAdjustmentTotal: Number(settlementAdjustmentTotal),
        salesAmountBeforeSettlementAdjustments: Number(salesAmountBeforeSettlementAdjustments),
        promoExpenseItems,
        vouchers: voucherItems,
        accountingAdjustments: selectedAccountingAdjustmentItems,
        customerIds,
        customerSummaries,
        lineItems: consolidatedItems,
        issuedAt: new Date().toISOString()
      });

      // 会計完了後の確認画面は出さない。
      // 個別会計・部分会計はこの画面に残し、最終会計だけ前画面へ戻す。
      if (isSessionComplete) {
        onBack?.();
      }
      return;
    } catch (error) {
      console.error(error);
      alert('会計に失敗しました');
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  // 全額売掛/全額手入力の即会計フローは廃止。モーダルで「適用」した後、
  // 支払額0の会計は「会計を確定」ボタン(isZeroPayableCheckout)で確定する。

  const toggleItemTakeout = (event, itemKey) => {
    if (!allowTakeout) return;
    event.preventDefault();
    event.stopPropagation();
    const keysToToggle = Array.isArray(itemKey) ? itemKey : [itemKey];
    setTakeoutItemKeys((previous) => {
      const next = new Set(previous);
      keysToToggle.forEach((key) => {
        if (!takeoutEligibleKeys.has(key)) return;
        if (next.has(key)) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  };

  const handleBulkTakeout = () => {
    if (!allowTakeout) return;
    const nextState = !isEverythingTakeout;
    setTakeoutItemKeys((previous) => {
      const next = new Set(previous);
      const allDetails = consolidatedItems.flatMap((item) => item.details || []).filter((detail) => detail.allowsTakeout !== false);
      allDetails.forEach((detail) => (nextState ? next.add(detail.key) : next.delete(detail.key)));
      return next;
    });
  };

  const getOrderItemKeys = (order) => {
    if (!order?.items || !Array.isArray(order.items)) return [];

    return order.items
      .map((item, index) => ({ item, key: `${order.id}-${index}` }))
      .filter(({ item, key }) => (
        item &&
        !isCancelledPosItem(item) &&
        !paidItemKeys.has(key) &&
        item.paymentStatus !== 'paid'
      ))
      .map(({ key }) => key);
  };

  const toggleItemKeyGroup = (itemKeys) => {
    const targetKeys = (itemKeys || []).filter((key) => allPayableItemKeys.has(key));
    if (targetKeys.length === 0) return;

    setCheckoutSelectionMode('custom');
    setSelectedItemKeys((previous) => {
      const next = new Set(previous);
      const areAllSelected = targetKeys.every((key) => next.has(key));

      targetKeys.forEach((key) => {
        if (areAllSelected) next.delete(key);
        else next.add(key);
      });

      if (next.size === 0) {
        window.setTimeout(() => setCheckoutSelectionMode('all'), 0);
      }

      return next;
    });
  };

  const toggleSelect = (id) => {
    const order = orders.find((targetOrder) => targetOrder.id === id);
    toggleItemKeyGroup(getOrderItemKeys(order));
  };

  const toggleSelectItem = (itemKey) => {
    if (requestQuantityForItemSelection(itemKey)) return;
    toggleItemKeyGroup([itemKey]);
  };

  const toggleSelectAll = () => {
    if (checkoutSelectionMode === 'custom' && activeSelectedItemKeys.size === allPayableItemKeys.size) {
      setSelectedItemKeys(new Set());
      setCheckoutSelectionMode('all');
      return;
    }

    setCheckoutSelectionMode('custom');
    setSelectedItemKeys(new Set(allPayableItemKeys));
  };

  const clearCustomSelection = () => {
    setSelectedItemKeys(new Set());
    setCheckoutSelectionMode('all');
  };

  const toggleSelectCustomer = (customerId) => {
    const targetOrders = ordersByCustomer[customerId] || [];
    if (targetOrders.length === 0) return;

    const targetItemKeys = targetOrders.flatMap((order) => getOrderItemKeys(order));
    toggleItemKeyGroup(targetItemKeys);
  };

  const isInitialLoading = loading && !processingAction;
  // 会計表示への切替時、先読み済み(キャッシュ)で即座に読み込めるケースまで全画面ローディングを
  // 一瞬出すと「ちらつき」になる。読み込みが一定時間続く時だけオーバーレイを出す。
  // (ユーザー操作起点の processingAction=退店/取消 は即時表示のまま。)
  const [showInitialLoadingOverlay, setShowInitialLoadingOverlay] = useState(false);
  useEffect(() => {
    if (!isInitialLoading) {
      setShowInitialLoadingOverlay(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowInitialLoadingOverlay(true), 220);
    return () => window.clearTimeout(timer);
  }, [isInitialLoading]);
  const showProcessingOverlay = showInitialLoadingOverlay || Boolean(processingAction);
  const processingTitle = processingAction === 'exit'
    ? '退店処理中です'
    : processingAction === 'cancel'
      ? '取消・復旧処理中です'
      : '読み込み中です';
  const processingMessage = processingAction === 'exit'
    ? '注文と席情報を整理しています。画面を閉じずにお待ちください。'
    : processingAction === 'cancel'
      ? '取消・復旧処理中です。画面を閉じずにお待ちください。'
      : 'レジ情報を読み込んでいます。';

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-gray-100 font-sans">
      {showProcessingOverlay && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/35 p-6 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center rounded-[2rem] border border-gray-100 bg-white px-8 py-7 text-center shadow-2xl">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
              <LoadingSpinner size={30} className="text-blue-600" />
            </div>
            <h3 className="text-xl font-black tracking-tight text-gray-900">
              {processingTitle}
            </h3>
            <p className="mt-2 text-sm font-bold leading-relaxed text-gray-500">
              {processingMessage}
            </p>
          </div>
        </div>
      )}

      {quantityPicker && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-[2rem] border border-blue-100 bg-white p-8 text-center shadow-2xl">
            <h3 className="text-xl font-black tracking-tight text-gray-900">
              {quantityPicker.title}
            </h3>

            <p className="mt-3 text-sm font-bold leading-relaxed text-gray-500">
              {quantityPicker.description}
            </p>

            <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="mb-3 text-[11px] font-black text-gray-400">
                数量
              </p>

              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: Number(quantityPicker.maxQuantity || 1) }, (_, index) => index + 1).map((quantity) => (
                  <button
                    key={quantity}
                    type="button"
                    onClick={() => updateQuantityPickerValue(quantity)}
                    className={`h-11 rounded-xl border text-sm font-black transition-all ${
                      Number(quantityPicker.quantity || 1) === quantity
                        ? 'border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-100'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    {quantity}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-7 flex gap-3">
              <button
                type="button"
                onClick={closeQuantityPicker}
                disabled={isCancelSubmitting}
                className="flex-1 rounded-2xl bg-gray-100 py-4 text-sm font-black text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                やめる
              </button>

              <button
                type="button"
                onClick={confirmQuantityPicker}
                disabled={isCancelSubmitting}
                className={`flex-1 rounded-2xl py-4 text-sm font-black text-white shadow-lg transition-colors disabled:opacity-50 ${
                  quantityPicker.mode === 'cancel'
                    ? 'bg-red-500 shadow-red-100 hover:bg-red-600'
                    : 'bg-blue-600 shadow-blue-100 hover:bg-blue-700'
                }`}
              >
                {quantityPicker.mode === 'cancel' ? '取消へ進む' : '選択する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-[2rem] border border-red-100 bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
              <span className="text-3xl font-black">!</span>
            </div>

            <h3 className="text-xl font-black tracking-tight text-gray-900">
              {cancelTarget.title}
            </h3>

            <p className="mt-3 text-sm font-bold leading-relaxed text-gray-500">
              {cancelTarget.description}
              <br />
              この操作は未会計の商品だけを対象にします。
            </p>

            <div className="mt-7 flex gap-3">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                disabled={isCancelSubmitting}
                className="flex-1 rounded-2xl bg-gray-100 py-4 text-sm font-black text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                やめる
              </button>

              <button
                type="button"
                onClick={executeCancelTarget}
                disabled={isCancelSubmitting}
                className="flex-1 rounded-2xl bg-red-500 py-4 text-sm font-black text-white shadow-lg shadow-red-100 transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                取消する
              </button>
            </div>
          </div>
        </div>
      )}

      <PosModals
        showSuccessModal={false}
        setShowSuccessModal={setShowSuccessModal}
        lastTransaction={lastTransaction}
        setPaymentAmount={setPaymentAmount}
        showSplitModal={showSplitModal}
        setShowSplitModal={setShowSplitModal}
        totalAmount={totalAmount}
        rawTotalAmount={rawTotalAmount}
        splitCount={splitCount}
        setSplitCount={setSplitCount}
        showDiscountModal={showDiscountModal}
        setShowDiscountModal={setShowDiscountModal}
        discounts={discounts}
        setDiscountType={setDiscountType}
        setDiscountValue={setDiscountValue}
        setSelectedDiscount={setSelectedDiscount}
        discountQuantities={discountQuantities}
        setDiscountQuantities={setDiscountQuantities}
        showAbortModal={showAbortModal}
        setShowAbortModal={setShowAbortModal}
        abortReason={abortReason}
        setAbortReason={setAbortReason}
        onAbortSession={handleAbortSession}
        onConfirmAbort={executeAbortSession}
        tableId={tableId}
        tableDisplayName={tableDisplayName}
      />

      <PosRegisterLeft
        orders={orders}
        tableDisplayName={tableDisplayName}
        checkoutSelectionMode={checkoutSelectionMode}
        selectedItemKeys={activeSelectedItemKeys}
        paidItemKeys={paidItemKeys}
        takeoutItemKeys={activeTakeoutItemKeys}
        totalAmount={totalAmount}
        allowTakeout={allowTakeout}
        onBack={onBack}
        toggleSelect={toggleSelect}
        toggleSelectItem={toggleSelectItem}
        toggleSelectAll={toggleSelectAll}
        toggleSelectCustomer={toggleSelectCustomer}
        clearCustomSelection={clearCustomSelection}
        onRequestCancelTarget={handleRequestCancelTarget}
        setShowSplitModal={setShowSplitModal}
        toggleItemTakeout={toggleItemTakeout}
        productMasterLoading={productMasterLoading}
        orderRetailProducts={filteredOrderRetailProducts}
        orderRetailKeyword={orderRetailKeyword}
        setOrderRetailKeyword={setOrderRetailKeyword}
        orderRetailCart={orderRetailCart}
        orderRetailMessage={orderRetailMessage}
        addOrderRetailProduct={addOrderRetailProduct}
        updateOrderRetailCartQuantity={updateOrderRetailCartQuantity}
        removeOrderRetailCartItem={removeOrderRetailCartItem}
        getOrderRetailCartQuantity={getOrderRetailCartQuantity}
        crmMember={crmMember}
        crmMemberBusy={crmMemberBusy}
        crmMemberMsg={crmMemberMsg}
        crmCodeInput={crmCodeInput}
        setCrmCodeInput={setCrmCodeInput}
        onLookupCrmMember={lookupCrmMemberByCode}
        onClearCrmMember={clearCrmMember}
      />
      <PosRegisterRight
        orders={orders}
        loading={isInitialLoading}
        subTotal={subTotal}
        discountAmount={discountAmount}
        promoExpenseAmount={promoExpenseAmount}
        voucherAmount={voucherAmount}
        voucherChangeAmount={voucherChangeAmount}
        isZeroPayable={isZeroPayableCheckout}
        settlementAdjustmentTotal={settlementAdjustmentTotal}
        salesAmountBeforeSettlementAdjustments={salesAmountBeforeSettlementAdjustments}
        taxAmount={taxAmount}
        totalAmount={totalAmount}
        discountType={discountType}
        discountValue={discountValue}
        selectedDiscount={selectedDiscount}
        selectedDiscountQuantity={Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)}
        paymentAmount={paymentAmount}
        setPaymentAmount={setPaymentAmount}
        paymentMethod={resolvedPaymentMethod}
        setPaymentMethod={(nextMethod) => {
          onPaymentResult?.(null);
          setPaymentMethod(nextMethod);
        }}
        allowedPaymentMethods={availablePaymentMethods}
        changeAmount={changeAmount}
        isEverythingTakeout={isEverythingTakeout}
        allowTakeout={allowTakeout}
        issueReceipt={issueReceipt}
        setIssueReceipt={setIssueReceipt}
        recipientName={recipientName}
        setRecipientName={setRecipientName}
        checkoutSelectionMode={checkoutSelectionMode}
        selectedItemCount={selectedItemCount}
        totalPayableItemCount={effectiveTotalPayableItemCount}
        settings={settings}
        consolidatedItems={consolidatedItems}
        takeoutItemKeys={activeTakeoutItemKeys}
        setShowDiscountModal={setShowDiscountModal}
        handleBulkTakeout={handleBulkTakeout}
        showSuccessModal={false}
        showAbortModal={showAbortModal}
        isPaymentSubmitting={isPaymentSubmitting}
        isPaymentFlowLocked={isPaymentFlowLocked}
        handlePayment={handlePayment}
        handleAbortSession={handleAbortSession}
        tableId={tableId}
        tableDisplayName={tableDisplayName}
        onClose={onBack}
      />

      <TerminalPaymentModal state={term.modal} onCancel={term.cancel} onClose={term.close} onSimulate={term.simulate} />

      <style>{'input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}'}</style>
    </div>
  );
};

