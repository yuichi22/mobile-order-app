import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';
import { isOrderOwnedByCustomer } from '../../../shared/utils/orderCustomerIdentity';
import { getActiveOrderItemsTotal } from '../../../shared/utils/orderItems';

// リロード(iOSのタブ回収など)直後は onSnapshot 到着まで履歴が空になり、
// 会計¥0・お会計ボタン非表示を「確定値」として見せてしまう(楽観反映はページ内の
// 空白しか塞げない)。直近の履歴をセッション単位で端末に控えておき、購読開始から
// 実データ到着までの間はキャッシュで即表示する。
const ORDER_CACHE_PREFIX = 'customer-order-cache:';
const ORDER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const buildOrderCacheKey = (storeId, sessionId) => (
  `${ORDER_CACHE_PREFIX}${storeId}:${sessionId}`
);

const readCachedOrders = (storeId, sessionId) => {
  try {
    const raw = window.localStorage.getItem(buildOrderCacheKey(storeId, sessionId));
    const parsed = raw ? JSON.parse(raw) : null;

    if (!Array.isArray(parsed?.orders)) return [];
    if (!Number.isFinite(parsed?.savedAt) || Date.now() - parsed.savedAt > ORDER_CACHE_TTL_MS) return [];

    return parsed.orders.map((order) => ({
      ...order,
      timestamp: order?.timestamp ? new Date(order.timestamp) : new Date(0)
    }));
  } catch {
    return [];
  }
};

const writeCachedOrders = (storeId, sessionId, orders) => {
  try {
    window.localStorage.setItem(
      buildOrderCacheKey(storeId, sessionId),
      JSON.stringify({ savedAt: Date.now(), orders })
    );
  } catch {
    // localStorage が使えない環境では控えない
  }
};

const pruneExpiredOrderCaches = () => {
  try {
    Object.keys(window.localStorage || {}).forEach((key) => {
      if (!key.startsWith(ORDER_CACHE_PREFIX)) return;

      try {
        const parsed = JSON.parse(window.localStorage.getItem(key));
        if (!Number.isFinite(parsed?.savedAt) || Date.now() - parsed.savedAt > ORDER_CACHE_TTL_MS) {
          window.localStorage.removeItem(key);
        }
      } catch {
        window.localStorage.removeItem(key);
      }
    });
  } catch {
    // localStorage inaccessible
  }
};

export const useCustomerOrderHistory = ({ sessionId, storeId, participantId }) => {
  const [orderHistory, setOrderHistory] = useState([]);
  // 注文成立(サーバ200)からクライアントの onSnapshot に反映されるまでの間、
  // 会計金額・注文履歴・お会計ボタンが一瞬「空(¥0)」になり、顧客が「注文が通っていない」
  // と誤認して二重注文してしまう。成立直後に楽観的な注文をここへ差し込み、実データが
  // 同じ orderId で届いたら破棄(リコンサイル)することで、その空白期間をなくす。
  const [optimisticOrders, setOptimisticOrders] = useState([]);
  const hasSessionContext = Boolean(sessionId && storeId && participantId);
  const [historyLoading, setHistoryLoading] = useState(() => hasSessionContext);

  useEffect(() => {
    if (!hasSessionContext) return undefined;

    pruneExpiredOrderCaches();

    // 実データ到着までの間、前回控えた履歴で即表示する(到着後は必ず実データで上書き)。
    const cachedOrders = readCachedOrders(storeId, sessionId);
    if (cachedOrders.length > 0) {
      setOrderHistory((current) => (current.length === 0 ? cachedOrders : current));
    }

    const ordersQuery = query(
      collection(db, 'stores', storeId, 'orders'),
      where('sessionId', '==', sessionId)
    );

    return onSnapshot(
      ordersQuery,
      (snapshot) => {
        const fetchedOrders = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
          timestamp: snapshotDoc.data().timestamp?.toDate
            ? snapshotDoc.data().timestamp.toDate()
            : new Date()
        })).sort((left, right) => right.timestamp - left.timestamp);

        setOrderHistory(fetchedOrders);
        setHistoryLoading(false);
      },
      () => {
        setOrderHistory([]);
        setHistoryLoading(false);
      }
    );
  }, [hasSessionContext, participantId, sessionId, storeId]);

  const serverOrderIds = useMemo(
    () => new Set(orderHistory.map((order) => order.id)),
    [orderHistory]
  );

  // 実データ(onSnapshot)に同じ orderId が現れた／セッションが変わった楽観注文は破棄。
  useEffect(() => {
    setOptimisticOrders((current) => {
      if (current.length === 0) return current;

      const next = current.filter((order) => (
        order
        && !serverOrderIds.has(order.id)
        && String(order.sessionId || '') === String(sessionId || '')
      ));

      return next.length === current.length ? current : next;
    });
  }, [serverOrderIds, sessionId]);

  const registerOptimisticOrder = useCallback((order) => {
    if (!order?.id) return;

    setOptimisticOrders((current) => (
      current.some((existing) => existing.id === order.id)
        ? current
        : [...current, { ...order, __optimistic: true }]
    ));
  }, []);

  // 表示・集計に使う履歴 = 実データ + 未反映の楽観注文(重複除去済み)。
  const mergedOrderHistory = useMemo(() => {
    const pending = optimisticOrders.filter((order) => (
      order
      && !serverOrderIds.has(order.id)
      && String(order.sessionId || '') === String(sessionId || '')
    ));

    if (pending.length === 0) return orderHistory;

    return [...pending, ...orderHistory].sort((left, right) => right.timestamp - left.timestamp);
  }, [optimisticOrders, orderHistory, serverOrderIds, sessionId]);

  // 表示中の履歴(楽観注文込み)を端末に控える。注文直後にリロードされても
  // 実データ到着を待たずに会計金額・お会計ボタンを出せるようにするため。
  // 初回購読中(historyLoading)はキャッシュ由来の内容しか無いので書き戻さない。
  useEffect(() => {
    if (!hasSessionContext || historyLoading) return;
    writeCachedOrders(storeId, sessionId, mergedOrderHistory);
  }, [hasSessionContext, historyLoading, mergedOrderHistory, sessionId, storeId]);

  const totals = useMemo(() => {
    if (!participantId) return { myTotal: 0, grandTotal: 0, myOrderHistory: [] };

    let myTotal = 0;
    let grandTotal = 0;
    const myOrderHistory = [];

    mergedOrderHistory.forEach((order) => {
      const isCancelledOrder = order?.status === 'cancelled' || order?.paymentStatus === 'cancelled';
      const items = Array.isArray(order?.items) ? order.items : [];

      if (isCancelledOrder) {
        if (isOrderOwnedByCustomer(order, participantId)) {
          myOrderHistory.push(order);
        }
        return;
      }

      const orderTotal = getActiveOrderItemsTotal(items);

      grandTotal += orderTotal;

      if (isOrderOwnedByCustomer(order, participantId)) {
        myTotal += orderTotal;
        myOrderHistory.push(order);
      }
    });

    return { myTotal, grandTotal, myOrderHistory };
  }, [mergedOrderHistory, participantId]);

  return {
    orderHistory: hasSessionContext ? mergedOrderHistory : [],
    historyLoading: hasSessionContext ? historyLoading : false,
    registerOptimisticOrder,
    ...totals
  };
};
