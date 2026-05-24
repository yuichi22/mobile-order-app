import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
};

export const useTableMenuOverrides = (storeId) => {
  const [items, setItems] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (!storeId) {
      setItems([]);
      return undefined;
    }

    const ref = collection(db, 'stores', storeId, 'tableMenuOverrides');

    return onSnapshot(ref, (snapshot) => {
      setItems(snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data()
      })));
    });
  }, [storeId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    const activeItems = items
      .map((item) => {
        const expiresAtMs = toMillis(item.expiresAt);
        const remainingMs = expiresAtMs - nowTick;
        const remainingMinutes = Math.max(Math.ceil(remainingMs / 60000), 0);

        return {
          ...item,
          tableId: String(item.tableId || item.id || '').trim(),
          periodName: String(item.periodName || item.periodId || ''),
          expiresAtMs,
          remainingMinutes
        };
      })
      .filter((item) => item.tableId && item.expiresAtMs > nowTick);

    return Object.fromEntries(
      activeItems.map((item) => [String(item.tableId), item])
    );
  }, [items, nowTick]);
};

export default useTableMenuOverrides;
