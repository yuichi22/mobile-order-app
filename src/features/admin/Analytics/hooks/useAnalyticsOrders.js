import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';

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
  timestamp: order.timestamp?.toDate
    ? order.timestamp.toDate()
    : toDate(order.timestamp) || toDate(transaction.timestamp) || new Date(),
  paidAt: order.paidAt?.toDate
    ? order.paidAt.toDate()
    : toDate(order.paidAt) || toDate(transaction.paidAt) || null,
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
  weeklyBaseDate
}) => {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    if (!storeId) {
      setOrders([]);
      return undefined;
    }

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

    const analyticsQuery = query(
      collection(db, 'stores', storeId, 'transactions'),
      where('timestamp', '>=', start),
      where('timestamp', '<=', end)
    );

    let isActive = true;

    const unsubscribe = onSnapshot(
      analyticsQuery,
      async (snapshot) => {
        try {
          const fetched = snapshot.docs
            .map((transactionDoc) => {
              const data = transactionDoc.data();

              return {
                id: transactionDoc.id,
                ...data,
                timestamp: data.timestamp?.toDate
                  ? data.timestamp.toDate()
                  : data.paidAt?.toDate
                    ? data.paidAt.toDate()
                    : new Date()
              };
            })
            .filter((transaction) => transaction.isPaid !== false);

          const withOrderAnalyticsRecords = await Promise.all(
            fetched.map(async (transaction) => {
              const orderIds = getLinkedOrderIds(transaction);

              if (orderIds.length === 0) {
                return {
                  ...transaction,
                  orderAnalyticsRecords: []
                };
              }

              const orderSnapshots = await Promise.all(
                orderIds.map((orderId) => getDoc(doc(db, 'stores', storeId, 'orders', orderId)))
              );

              const existingOrders = orderSnapshots
                .filter((orderSnapshot) => orderSnapshot.exists())
                .map((orderSnapshot) => ({ id: orderSnapshot.id, ...orderSnapshot.data() }));

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

              return {
                ...transaction,
                orderAnalyticsRecords
              };
            })
          );

          if (isActive) {
            setOrders(withOrderAnalyticsRecords);
          }
        } catch (error) {
          console.error('Firestore Error (Analytics Linked Orders):', error);
          if (isActive) setOrders([]);
        }
      },
      (error) => {
        console.error('Firestore Error (Analytics Transactions):', error);
        setOrders([]);
      }
    );

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [storeId, period, currentDate, customRange, weeklyBaseDate]);

  return orders;
};