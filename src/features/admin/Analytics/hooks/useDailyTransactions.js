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

const buildOrderAnalyticsRecord = (order, transaction) => ({
  id: order.id,
  transactionId: transaction.id,
  sessionId: order.sessionId || transaction.sessionId || '',
  tableId: order.tableId || transaction.tableId || '',
  timestamp: toDate(order.timestamp) || toDate(transaction.timestamp) || new Date(),
  paidAt: toDate(order.paidAt) || toDate(transaction.paidAt) || null,
  totalAmount: Number(order.totalPrice ?? order.totalAmount ?? 0) || 0,
  guestCount: Number(transaction.guestCount || 0) || 0,
  items: Array.isArray(order.items) ? order.items : []
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

              const orderAnalyticsRecords = orderSnapshots
                .filter((orderSnapshot) => orderSnapshot.exists())
                .map((orderSnapshot) => buildOrderAnalyticsRecord(
                  { id: orderSnapshot.id, ...orderSnapshot.data() },
                  transaction
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
