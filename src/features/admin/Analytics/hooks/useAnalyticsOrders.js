import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../../shared/api/firebase/client';
import { toDate } from '../utils/analyticsHelpers';

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

    const unsubscribe = onSnapshot(
      analyticsQuery,
      (snapshot) => {
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

        setOrders(fetched);
      },
      (error) => {
        console.error('Firestore Error (Analytics Transactions):', error);
        setOrders([]);
      }
    );

    return () => unsubscribe();
  }, [storeId, period, currentDate, customRange, weeklyBaseDate]);

  return orders;
};