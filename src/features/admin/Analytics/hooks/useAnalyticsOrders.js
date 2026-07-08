import { useEffect, useState } from 'react';
import { collection, documentId, getDocs, query, where, Timestamp } from 'firebase/firestore';

import { db } from '../../../../shared/api/firebase/client';
import { toDate } from '../utils/analyticsHelpers';

const getItemQuantity = (item) => {
  const quantity = Number(item?.quantity ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const getItemBaseTotal = (item) => {
  const directTotal = Number(item?.totalPrice ?? item?.totalAmount);
  if (Number.isFinite(directTotal) && directTotal > 0) return directTotal;

  const unitPrice = Number(item?.unitPrice || 0) || 0;
  return unitPrice * getItemQuantity(item);
};

const getTransactionOrderWeights = (transaction) => {
  const weights = {};

  if (!Array.isArray(transaction?.items)) return weights;

  transaction.items.forEach((item) => {
    const details = Array.isArray(item?.details) ? item.details : [];

    if (details.length > 0) {
      details.forEach((detail) => {
        const key = String(detail?.key || '');
        const orderId = key.includes('-') ? key.split('-').slice(0, -1).join('-') : '';
        if (!orderId) return;

        const quantity = getItemQuantity(detail);
        const unitPrice = Number(detail?.unitPrice ?? item?.unitPrice ?? 0) || 0;
        weights[orderId] = (weights[orderId] || 0) + (unitPrice * quantity);
      });
      return;
    }

    const orderId =
      String(item?.orderId || item?.sourceOrderId || '').trim();

    if (!orderId) return;

    weights[orderId] = (weights[orderId] || 0) + getItemBaseTotal(item);
  });

  return weights;
};

const getTransactionItemsForOrder = (transaction, orderId) => {
  if (!Array.isArray(transaction?.items)) return [];

  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) return [];

  return transaction.items
    .map((item) => {
      const details = Array.isArray(item?.details)
        ? item.details.filter((detail) => {
            const key = String(detail?.key || '');
            return key.startsWith(`${normalizedOrderId}-`);
          })
        : [];

      if (details.length === 0) {
        const itemOrderId = String(item?.orderId || item?.sourceOrderId || '').trim();
        return itemOrderId === normalizedOrderId ? item : null;
      }

      const quantity = details.reduce((sum, detail) => sum + getItemQuantity(detail), 0);
      const totalPrice = details.reduce((sum, detail) => {
        const detailQuantity = getItemQuantity(detail);
        const detailUnitPrice = Number(detail?.unitPrice ?? item?.unitPrice ?? 0) || 0;
        return sum + (detailUnitPrice * detailQuantity);
      }, 0);

      return {
        ...item,
        details,
        quantity,
        totalPrice
      };
    })
    .filter(Boolean);
};

const allocateTransactionAmountByOrder = (transaction, orderIds) => {
  const normalizedOrderIds = (orderIds || [])
    .map((orderId) => String(orderId || '').trim())
    .filter(Boolean);

  const weights = getTransactionOrderWeights(transaction);
  const transactionTotal = Number(transaction?.totalAmount ?? transaction?.totalPrice ?? 0) || 0;
  const totalWeight = normalizedOrderIds.reduce((sum, orderId) => sum + Number(weights[orderId] || 0), 0);

  if (transactionTotal <= 0 || totalWeight <= 0) {
    return normalizedOrderIds.reduce((acc, orderId) => {
      acc[orderId] = 0;
      return acc;
    }, {});
  }

  let allocated = 0;
  const allocations = {};

  normalizedOrderIds.forEach((orderId, index) => {
    if (index === normalizedOrderIds.length - 1) {
      allocations[orderId] = Math.max(0, transactionTotal - allocated);
      return;
    }

    const amount = Math.round((transactionTotal * Number(weights[orderId] || 0)) / totalWeight);
    allocations[orderId] = amount;
    allocated += amount;
  });

  return allocations;
};


const getLinkedOrderIds = (transaction) => {
  if (!Array.isArray(transaction?.customerSummaries)) return [];

  return [
    ...new Set(
      transaction.customerSummaries
        .flatMap((summary) => Array.isArray(summary?.orderIds) ? summary.orderIds : [])
        .map((orderId) => String(orderId || '').trim())
        .filter(Boolean)
    )
  ];
};

const buildOrderAnalyticsRecord = (order, transaction, allocatedAmount = 0, transactionItems = []) => ({
  id: order.id,
  transactionId: transaction.id,
  sessionId: order.sessionId || transaction.sessionId || '',
  tableId: order.tableId || transaction.tableId || '',
  timestamp:
    (order.paidAt?.toDate ? order.paidAt.toDate() : toDate(order.paidAt)) ||
    (transaction.paidAt?.toDate ? transaction.paidAt.toDate() : toDate(transaction.paidAt)) ||
    (transaction.timestamp?.toDate ? transaction.timestamp.toDate() : toDate(transaction.timestamp)) ||
    (order.timestamp?.toDate ? order.timestamp.toDate() : toDate(order.timestamp)) ||
    new Date(),
  paidAt:
    (order.paidAt?.toDate ? order.paidAt.toDate() : toDate(order.paidAt)) ||
    (transaction.paidAt?.toDate ? transaction.paidAt.toDate() : toDate(transaction.paidAt)) ||
    null,
  // 時間帯・時間軸の集計は「注文時刻(提供時刻)」で行う。会計(paidAt)ではなく注文時刻を使い、
  // 遅い時間にまとめて会計した過去の注文が支払時間帯に誤計上されるのを防ぐ(日計と同一)。
  orderedAt:
    toDate(order.timestamp) ||
    toDate(order.createdAt) ||
    toDate(transaction.timestamp) ||
    toDate(order.paidAt) ||
    toDate(transaction.paidAt) ||
    new Date(),
  totalAmount: Number(allocatedAmount || 0) || 0,
  guestCount: Number(transaction.guestCount || 0) || 0,
  items: Array.isArray(transactionItems) && transactionItems.length > 0
    ? transactionItems
    : Array.isArray(order.items)
      ? order.items
      : []
});

export const useAnalyticsOrders = ({
  storeId,
  period,
  currentDate,
  customRange,
  weeklyBaseDate,
  selectedPeriodId = 'all'
}) => {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    if (!storeId) {
      setOrders([]);
      return undefined;
    }

    let isActive = true;

    const loadAnalyticsOrders = async () => {
      let start = toDate(currentDate) || new Date();
      let end = toDate(currentDate) || new Date();

      if (period === 'daily') {
        start.setHours(0, 0, 0, 0);

        end = new Date(start);
        end.setHours(23, 59, 59, 999);
      } else if (period === 'monthly') {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);

        end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
      } else if (period === 'weekly') {
        end = toDate(weeklyBaseDate || currentDate) || new Date();
        end.setHours(23, 59, 59, 999);

        start = new Date(end);
        start.setDate(start.getDate() - (53 * 7) + 1);
        start.setHours(0, 0, 0, 0);
      } else if (period === 'custom') {
        start = toDate(customRange.start) || new Date();
        start.setHours(0, 0, 0, 0);

        end = toDate(customRange.end) || new Date();
        end.setHours(23, 59, 59, 999);
      }

      const startTimestamp = Timestamp.fromDate(start);
      const endTimestamp = Timestamp.fromDate(end);
      const transactionsCollection = collection(db, 'stores', storeId, 'transactions');

      const mapTransactionDoc = (transactionDoc) => {
        const data = transactionDoc.data();

        const paidAt = data.paidAt?.toDate
          ? data.paidAt.toDate()
          : toDate(data.paidAt);

        const timestamp = paidAt ||
          (data.timestamp?.toDate ? data.timestamp.toDate() : toDate(data.timestamp)) ||
          new Date();

        return {
          id: transactionDoc.id,
          ...data,
          timestamp,
          paidAt
        };
      };

      try {
        // 取引は paidAt(売上日時) の単一レンジクエリで取得する。会計取引は必ず
        // paidAt を持つ(POSの会計時に serverTimestamp で付与)ため、旧来の timestamp 併用
        // (paidAt 欠落の保険)は不要。クエリを1本にして読み取り量を約半減させる。
        const paidAtQuery = query(
          transactionsCollection,
          where('paidAt', '>=', startTimestamp),
          where('paidAt', '<=', endTimestamp)
        );

        const paidAtSnapshot = await getDocs(paidAtQuery);

        if (!isActive) return;

        const fetched = paidAtSnapshot.docs
          .map(mapTransactionDoc)
          .filter((transaction) => transaction.isPaid !== false);

        // 月次・週次・任意期間（かつ提供時間帯フィルタ無し）は、グラフの粒度が日/週/月のため
        // order単位の「時刻」配分が不要。注文の取得を丸ごと省いて表示を高速化する。
        // 集計(buildAnalyticsSummary)は orderAnalyticsRecords が空なら取引レベル
        // (totalAmount/items/取引日時)で同値に集計する。order取得が要るのは日次の
        // 時間帯グラフと、提供時間帯フィルタ(selectedPeriodId)使用時のみ。
        const needsOrderRecords =
          period === 'daily'
          || (Boolean(selectedPeriodId) && String(selectedPeriodId) !== 'all');

        if (!needsOrderRecords) {
          if (isActive) {
            setOrders(fetched.map((transaction) => ({ ...transaction, orderAnalyticsRecords: [] })));
          }
          return;
        }

        // 紐づく注文を一括取得(N+1回避)。全取引の注文IDをまとめ、documentId in の
        // 30件チャンクでバッチ取得する。日次(useDailyTransactions)と同じ最適化で、
        // 月次・週次のように取引が多い期間の往復回数を大幅に削減する。
        const allOrderIds = Array.from(new Set(
          fetched.flatMap((transaction) => getLinkedOrderIds(transaction))
        )).filter(Boolean);

        const orderMap = new Map();
        if (allOrderIds.length > 0) {
          const ordersCollection = collection(db, 'stores', storeId, 'orders');
          const chunks = [];
          for (let i = 0; i < allOrderIds.length; i += 30) {
            chunks.push(allOrderIds.slice(i, i + 30));
          }
          const orderSnapshots = await Promise.all(
            chunks.map((chunk) => getDocs(query(ordersCollection, where(documentId(), 'in', chunk))))
          );

          if (!isActive) return;

          orderSnapshots.forEach((snapshot) => {
            snapshot.forEach((orderDoc) => {
              orderMap.set(orderDoc.id, { id: orderDoc.id, ...orderDoc.data() });
            });
          });
        }

        const withOrderAnalyticsRecords = fetched.map((transaction) => {
          const orderIds = getLinkedOrderIds(transaction);

          if (orderIds.length === 0) {
            return { ...transaction, orderAnalyticsRecords: [] };
          }

          const existingOrders = orderIds
            .map((orderId) => orderMap.get(orderId))
            .filter(Boolean);

          const amountByOrderId = allocateTransactionAmountByOrder(
            transaction,
            existingOrders.map((order) => order.id)
          );

          const orderAnalyticsRecords = existingOrders.map((order) => buildOrderAnalyticsRecord(
            order,
            transaction,
            amountByOrderId[order.id] || 0,
            getTransactionItemsForOrder(transaction, order.id)
          ));

          return { ...transaction, orderAnalyticsRecords };
        });

        if (isActive) {
          setOrders(withOrderAnalyticsRecords);
        }
      } catch (error) {
        console.error('Firestore Error (Analytics Transactions):', error);
        if (isActive) setOrders([]);
      }
    };

    loadAnalyticsOrders();

    return () => {
      isActive = false;
    };
  }, [storeId, period, currentDate, customRange, weeklyBaseDate, selectedPeriodId]);

  return orders;
};