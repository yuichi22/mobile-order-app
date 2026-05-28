import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../../shared/api/firebase/client';

const toStartOfDay = (date) => {
  const next = new Date(date || new Date());
  next.setHours(0, 0, 0, 0);
  return next;
};

const toEndOfDay = (date) => {
  const next = new Date(date || new Date());
  next.setHours(23, 59, 59, 999);
  return next;
};

const toDate = (value) => {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

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
  timestamp: toDate(order.timestamp) || toDate(transaction.timestamp) || new Date(),
  paidAt: toDate(order.paidAt) || toDate(transaction.paidAt) || null,
  totalAmount: Number(allocatedAmount || 0) || 0,
  guestCount: Number(transaction.guestCount || 0) || 0,
  items: Array.isArray(transactionItems) && transactionItems.length > 0
    ? transactionItems
    : Array.isArray(order.items)
      ? order.items
      : []
});

export const useDailyTransactions = ({ storeId, targetDate }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setTransactions([]);
      setLoading(false);
      return undefined;
    }

    let isActive = true;
    setLoading(true);

    const start = toStartOfDay(targetDate);
    const end = toEndOfDay(targetDate);

    const transactionsQuery = query(
      collection(db, 'stores', storeId, 'transactions'),
      where('timestamp', '>=', start),
      where('timestamp', '<=', end)
    );

    const unsubscribe = onSnapshot(
      transactionsQuery,
      async (snapshot) => {
        try {
          const fetched = snapshot.docs.map((transactionDoc) => {
            const data = transactionDoc.data();

            return {
              id: transactionDoc.id,
              ...data,
              timestamp: toDate(data.timestamp) || toDate(data.paidAt) || null,
              paidAt: toDate(data.paidAt) || null
            };
          });

          fetched.sort((left, right) => {
            const leftTime = left.timestamp?.getTime?.() || 0;
            const rightTime = right.timestamp?.getTime?.() || 0;
            return leftTime - rightTime;
          });

          const transactionsWithOrders = await Promise.all(
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

          if (!isActive) return;

          setTransactions(transactionsWithOrders);
          setLoading(false);
        } catch (error) {
          console.error('Firestore Error (DailyTransactions Linked Orders):', error);
          if (isActive) {
            setTransactions([]);
            setLoading(false);
          }
        }
      },
      (error) => {
        console.error('Firestore Error (DailyTransactions):', error);
        if (isActive) {
          setTransactions([]);
          setLoading(false);
        }
      }
    );

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [storeId, targetDate]);

  return { transactions, loading };
};
