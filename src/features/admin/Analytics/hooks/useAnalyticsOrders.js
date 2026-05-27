import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../../shared/api/firebase/client';
import { toDate } from '../utils/analyticsHelpers';

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
  timestamp: order.timestamp?.toDate
    ? order.timestamp.toDate()
    : toDate(order.timestamp) || toDate(transaction.timestamp) || new Date(),
  paidAt: order.paidAt?.toDate
    ? order.paidAt.toDate()
    : toDate(order.paidAt) || toDate(transaction.paidAt) || null,
  totalAmount: Number(order.totalPrice ?? order.totalAmount ?? 0) || 0,
  guestCount: Number(transaction.guestCount || 0) || 0,
  items: Array.isArray(order.items) ? order.items : []
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