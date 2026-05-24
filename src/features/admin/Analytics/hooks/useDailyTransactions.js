import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

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

export const useDailyTransactions = ({ storeId, targetDate }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setTransactions([]);
      setLoading(false);
      return undefined;
    }

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
      (snapshot) => {
        const fetched = snapshot.docs.map((transactionDoc) => {
          const data = transactionDoc.data();

          return {
            id: transactionDoc.id,
            ...data,
            timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : null
          };
        });

        fetched.sort((left, right) => {
          const leftTime = left.timestamp?.getTime?.() || 0;
          const rightTime = right.timestamp?.getTime?.() || 0;
          return leftTime - rightTime;
        });

        setTransactions(fetched);
        setLoading(false);
      },
      (error) => {
        console.error('Firestore Error (DailyTransactions):', error);
        setTransactions([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [storeId, targetDate]);

  return { transactions, loading };
};