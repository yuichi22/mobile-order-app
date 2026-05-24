import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '../../../../shared/api/firebase/client';

const createYesterday = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  return date;
};

const parseDateKey = (dateKey) => {
  if (!dateKey || typeof dateKey !== 'string') return null;

  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateKey = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export const useWeeklyTrendBaseDate = (storeId) => {
  const [latestClosedDate, setLatestClosedDate] = useState(null);
  const [loading, setLoading] = useState(Boolean(storeId));

  useEffect(() => {
    if (!storeId) {
      setLatestClosedDate(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const closingCollectionRef = collection(db, 'stores', storeId, 'dailyClosings');

    const unsubscribe = onSnapshot(
      closingCollectionRef,
      (snapshot) => {
        const closedDates = snapshot.docs
          .map((closingDoc) => {
            const data = closingDoc.data();
            const dateKey = data.dateKey || closingDoc.id;
            const date = parseDateKey(dateKey);

            return {
              id: closingDoc.id,
              dateKey,
              date,
              status: data.status
            };
          })
          .filter((entry) => entry.date && entry.status === 'closed')
          .sort((left, right) => right.date.getTime() - left.date.getTime());

        setLatestClosedDate(closedDates[0]?.date || null);
        setLoading(false);
      },
      (error) => {
        console.error('Firestore Error (WeeklyTrendBaseDate):', error);
        setLatestClosedDate(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [storeId]);

  return useMemo(() => {
    const fallbackDate = createYesterday();
    const baseDate = latestClosedDate || fallbackDate;

    return {
      weeklyBaseDate: baseDate,
      weeklyBaseDateKey: formatDateKey(baseDate),
      latestClosedDate,
      latestClosedDateKey: latestClosedDate ? formatDateKey(latestClosedDate) : null,
      isFallbackYesterday: !latestClosedDate,
      loading
    };
  }, [latestClosedDate, loading]);
};