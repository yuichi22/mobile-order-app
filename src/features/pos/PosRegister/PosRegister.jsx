import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, writeBatch, doc, serverTimestamp, getDocs } from 'firebase/firestore';

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
  useStoreSettings
} from '../../store/hooks';

import { PosRegisterLeft } from './components/PosRegisterLeft';
import { PosRegisterRight } from './components/PosRegisterRight';
import { PosModals } from './components/PosModals';

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

export const PosRegister = ({ sessionId, onBack, onComplete, storeId }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkoutSelectionMode, setCheckoutSelectionMode] = useState('all');
  const [selectedItemKeys, setSelectedItemKeys] = useState(new Set());

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');

  const [takeoutItemKeys, setTakeoutItemKeys] = useState(new Set());
  const [paidItemKeys, setPaidItemKeys] = useState(new Set());

  const [discountType, setDiscountType] = useState('none');
  const [discountValue, setDiscountValue] = useState(0);
  const [selectedDiscount, setSelectedDiscount] = useState(null);

  const [discountQuantities, setDiscountQuantities] = useState({});

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [issueReceipt, setIssueReceipt] = useState(false);
  const [recipientName, setRecipientName] = useState('');

  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastTransaction, setLastTransaction] = useState({ total: 0, change: 0, method: 'cash' });
  const [showAbortModal, setShowAbortModal] = useState(false);
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [processingAction, setProcessingAction] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [isCancelSubmitting, setIsCancelSubmitting] = useState(false);

  const [tableId, setTableId] = useState(null);
  const [tableDisplayName, setTableDisplayName] = useState('');
  const [guestCount, setGuestCount] = useState(0);

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
    : availablePaymentMethods[0];

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
        if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') return false;
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

  const selectedItemCount = activeSelectedItemKeys.size;
  const totalPayableItemCount = allPayableItemEntries.length;

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
    return items;
  }, [orders, paidItemKeys, currentPayTargetItemKeys, menuItemSnapshotMap]);

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
    discountAmount,
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
        discountAmount: 0,
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
    let discount = 0;
    if (discountType === 'percent') discount = Math.floor(rawTotalIncl * (Number(discountValue) / 100));
    if (discountType === 'amount') discount = Number(discountValue);

    const finalTotalAmount = Math.max(0, rawTotalIncl - discount);
    const [reducedDiscountAmount, standardDiscountAmount] = allocateAmountByWeight(
      discount,
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
      discountAmount: Number(discount),
      taxAmountReduced: Number(reducedBreakdown.taxAmount),
      taxAmountStandard: Number(standardBreakdown.taxAmount),
      taxRateReduced: reducedRate,
      taxRateStandard: standardRate
    };
  }, [activeTakeoutItemKeys, allowTakeout, consolidatedItems, discountType, discountValue, settings]);

  const changeAmount = useMemo(() => {
    const paid = Number(paymentAmount) || 0;
    return Math.max(0, paid - totalAmount);
  }, [paymentAmount, totalAmount]);

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
        !isCancelledPosItem(item) &&
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

      if (!item || isCancelledPosItem(item) || paidItemKeys.has(key) || item.paymentStatus === 'paid') {
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

  const handleRequestCancelTarget = (payload) => {
    const target = buildCancelTarget(payload || {});

    if (!target || !Array.isArray(target.entries) || target.entries.length === 0) {
      return;
    }

    setCancelTarget(target);
  };

  const executeCancelTarget = async () => {
    if (!cancelTarget || isCancelSubmitting) return;

    const entries = Array.isArray(cancelTarget.entries) ? cancelTarget.entries : [];
    if (entries.length === 0) {
      setCancelTarget(null);
      return;
    }

    setIsCancelSubmitting(true);
    setProcessingAction('cancel');
    setLoading(true);

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

      entriesByOrderId.forEach((orderEntries, orderId) => {
        const order = orders.find((targetOrder) => targetOrder.id === orderId);
        if (!order?.items || !Array.isArray(order.items)) return;

        const cancelIndexSet = new Set(orderEntries.map((entry) => Number(entry.index)));

        const nextItems = order.items.map((item, index) => {
          if (!cancelIndexSet.has(index)) return item;

          if (!item || isCancelledPosItem(item) || item.paymentStatus === 'paid') {
            return item;
          }

          return {
            ...item,
            status: 'cancelled',
            kitchenStatus: 'cancelled',
            cancelledBy: 'pos',
            cancelReason: 'pos_manual_cancel',
            cancelledAtClient,
            cancelledAtMs
          };
        });

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
          ...(isOrderFullyCancelled
            ? {
                status: 'cancelled',
                paymentStatus: 'cancelled',
                cancelledAt: serverTimestamp(),
                cancelledAtMs,
                cancelledBy: 'pos',
                closeReason: 'pos_manual_cancel'
              }
            : {})
        });
      });

      await batch.commit();

      const cancelledKeys = new Set(entries.map((entry) => entry.key));

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
    } catch (error) {
      console.error('レジ取消エラー:', error);
      alert('取消に失敗しました');
    } finally {
      setLoading(false);
      setProcessingAction(null);
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

      await clearSessionAccess(batch);
      await batch.commit();

      setShowAbortModal(false);

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
  const isEmptyCheckout = !hasOrderItems && !hasCheckoutAmount;

  const handleAbortSession = () => {
    if (isEmptyCheckout) {
      executeAbortSession({ reason: 'empty_exit' });
      return;
    }

    setShowAbortModal(true);
  };

  const handlePayment = async () => {
    if (isPaymentSubmitting) return;
    if (consolidatedItems.length === 0) return;

    if (resolvedPaymentMethod === 'cash' && (Number(paymentAmount) || 0) < totalAmount) {
      alert('お預かり金額が不足しています');
      return;
    }

    setIsPaymentSubmitting(true);

    try {
      const batch = writeBatch(db);
      const newlyPaidKeys = new Set();
      consolidatedItems.forEach((item) => item.details.forEach((detail) => newlyPaidKeys.add(detail.key)));

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
          paymentMethod: resolvedPaymentMethod,
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

      const transactionTaxSummary = orderSummaries.reduce(
        (summaryAcc, summary, index) => {
          const orderDiscountAmount = orderDiscountAllocations[index] || 0;
          const [reducedDiscountAmount, standardDiscountAmount] = allocateAmountByWeight(
            orderDiscountAmount,
            [summary.rawOrderReducedIncl, summary.rawOrderStandardIncl]
          );

          const reducedIncl = Math.max(0, summary.rawOrderReducedIncl - reducedDiscountAmount);
          const standardIncl = Math.max(0, summary.rawOrderStandardIncl - standardDiscountAmount);

          const reducedBreakdown = splitTaxIncludedAmount(reducedIncl, reducedTax, taxRounding);
          const standardBreakdown = splitTaxIncludedAmount(standardIncl, standardTax, taxRounding);

          summaryAcc.reducedTaxIncluded += Number(reducedIncl);
          summaryAcc.reducedTaxExcluded += Number(reducedBreakdown.baseAmount);
          summaryAcc.reducedTaxAmount += Number(reducedBreakdown.taxAmount);

          summaryAcc.standardTaxIncluded += Number(standardIncl);
          summaryAcc.standardTaxExcluded += Number(standardBreakdown.baseAmount);
          summaryAcc.standardTaxAmount += Number(standardBreakdown.taxAmount);

          return summaryAcc;
        },
        {
          reducedTaxRate: Number(taxRateReduced),
          standardTaxRate: Number(taxRateStandard),
          reducedTaxIncluded: 0,
          reducedTaxExcluded: 0,
          reducedTaxAmount: 0,
          standardTaxIncluded: 0,
          standardTaxExcluded: 0,
          standardTaxAmount: 0
        }
      );

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
          value: Number(selectedDiscount?.value ?? discountValue) || 0,
          count: selectedDiscount?.type === 'amount'
            ? Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)
            : 1,
          quantity: selectedDiscount?.type === 'amount'
            ? Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)
            : 1,
          amount: Number(discountAmount),
          items: Array.isArray(selectedDiscount?.items) ? selectedDiscount.items : [],
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
      batch.set(transactionRef, {
        sessionId,
        tableId,
        customerIds,
        customerSummaries,
        items: transactionItems,

        guestCount: Number(guestCount || 0),

        periodId: currentPeriodSnapshot.periodId,
        periodName: currentPeriodSnapshot.periodName,

        subTotal: Number(subTotal),
        discountAmount: Number(discountAmount),
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

        paymentMethod: resolvedPaymentMethod,
        paymentMethodGroup: resolvedPaymentMethod,

        timestamp: serverTimestamp(),
        paidAt: serverTimestamp(),
        businessDate: new Date().toISOString().slice(0, 10),

        isPaid: true
      });

      if (isSessionComplete) {
        batch.update(doc(db, 'stores', storeId, 'sessions', sessionId), { status: 'paid', closedAt: serverTimestamp() });
        const requestQuery = query(collection(db, 'stores', storeId, 'serviceRequests'), where('sessionId', '==', sessionId), where('status', '==', 'pending'));
        const requestSnapshot = await getDocs(requestQuery);
        requestSnapshot.forEach((docSnap) => batch.update(docSnap.ref, { status: 'completed' }));
        await clearSessionAccess(batch);
      }

      await batch.commit();

      let issuedReceipt = null;

      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (idToken && storeId && sessionId && transactionRef.id) {


          const response = await fetch('/api/issuePostpayReceipt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
              storeId,
              sessionId,
              transactionId: transactionRef.id
            })
          });


          const payload = await response.json().catch(() => ({}));

          if (response.ok && payload?.ok) {
            issuedReceipt = {
              receiptId: payload.receiptId || '',
              receiptNo: payload.receiptNo || ''
            };
          } else {
            console.warn('[issuePostpayReceipt] failed', payload);
          }
        }
      } catch (receiptError) {
        console.warn('[issuePostpayReceipt] failed', receiptError);
      }

      if (isSessionComplete) {
        onComplete({
          totalAmount: Number(totalAmount),
          changeAmount: Number(changeAmount),
          subTotal: Number(subTotal),
          taxAmount: Number(taxAmount),
          taxAmountReduced: Number(taxAmountReduced),
          taxAmountStandard: Number(taxAmountStandard),
          taxRateReduced: Number(taxRateReduced),
          taxRateStandard: Number(taxRateStandard),
          discountAmount: Number(discountAmount),
          customerIds,
          customerSummaries,
          lineItems: consolidatedItems,
          paymentMethod: resolvedPaymentMethod,
          issueReceipt,
          recipientName,
          sessionId,
          transactionId: transactionRef.id,
          receiptId: issuedReceipt?.receiptId || '',
          receiptNo: issuedReceipt?.receiptNo || '',
          isSessionComplete: true
        });
      } else {
        setLastTransaction({
          total: Number(totalAmount),
          change: Number(changeAmount),
          method: resolvedPaymentMethod,
          receiptId: issuedReceipt?.receiptId || '',
          receiptNo: issuedReceipt?.receiptNo || '',
          transactionId: transactionRef.id
        });

        setPaidItemKeys(new Set([...paidItemKeys, ...newlyPaidKeys]));
        setShowSuccessModal(true);
        setPaymentAmount('');
        setSelectedItemKeys(new Set());
        setCheckoutSelectionMode('all');
        setDiscountType('none');
        setDiscountValue(0);
        setSelectedDiscount(null);
        setDiscountQuantities({});
      }
    } catch (error) {
      console.error(error);
      alert('会計に失敗しました');
    } finally {
      window.setTimeout(() => {
        setIsPaymentSubmitting(false);
      }, 1200);
    }
  };

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

  const isInitialLoading = loading && !processingAction && !isPaymentSubmitting;
  const showProcessingOverlay = isInitialLoading || Boolean(processingAction) || isPaymentSubmitting || isCancelSubmitting;
  const processingTitle = isPaymentSubmitting
    ? '会計処理中です'
    : processingAction === 'exit'
      ? '退店処理中です'
      : processingAction === 'cancel'
        ? '取消処理中です'
        : '読み込み中です';
  const processingMessage = isPaymentSubmitting
    ? '会計を確定しています。画面を閉じずにお待ちください。'
    : processingAction === 'exit'
      ? '注文と席情報を整理しています。画面を閉じずにお待ちください。'
      : processingAction === 'cancel'
        ? '注文内容を更新しています。画面を閉じずにお待ちください。'
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
        showSuccessModal={showSuccessModal}
        setShowSuccessModal={setShowSuccessModal}
        lastTransaction={lastTransaction}
        setPaymentAmount={setPaymentAmount}
        showSplitModal={showSplitModal}
        setShowSplitModal={setShowSplitModal}
        totalAmount={totalAmount}
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
        onAbortSession={handleAbortSession}
        onConfirmAbort={executeAbortSession}
        tableId={tableId}
        tableDisplayName={tableDisplayName}
      />

      <PosRegisterLeft
        orders={orders}
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
      />
      <PosRegisterRight
        orders={orders}
        subTotal={subTotal}
        discountAmount={discountAmount}
        taxAmount={taxAmount}
        totalAmount={totalAmount}
        discountType={discountType}
        discountValue={discountValue}
        selectedDiscount={selectedDiscount}
        selectedDiscountQuantity={Number(selectedDiscount?.quantity || selectedDiscount?.count || 1)}
        paymentAmount={paymentAmount}
        setPaymentAmount={setPaymentAmount}
        paymentMethod={resolvedPaymentMethod}
        setPaymentMethod={setPaymentMethod}
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
        totalPayableItemCount={totalPayableItemCount}
        settings={settings}
        consolidatedItems={consolidatedItems}
        takeoutItemKeys={activeTakeoutItemKeys}
        setShowDiscountModal={setShowDiscountModal}
        handleBulkTakeout={handleBulkTakeout}
        showSuccessModal={showSuccessModal}
        showAbortModal={showAbortModal}
        isPaymentSubmitting={isPaymentSubmitting}
        handlePayment={handlePayment}
        handleAbortSession={handleAbortSession}
        tableId={tableId}
        tableDisplayName={tableDisplayName}
      />
      <style>{'input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}'}</style>
    </div>
  );
};

