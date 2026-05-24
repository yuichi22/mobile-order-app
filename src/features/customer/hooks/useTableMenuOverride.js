import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
};

export const useTableMenuOverride = ({ storeId, tableId, periods = [] }) => {
  const [override, setOverride] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (!storeId || !tableId) {
      setOverride(null);
      return undefined;
    }

    const ref = doc(db, 'stores', storeId, 'tableMenuOverrides', String(tableId));

    return onSnapshot(ref, (snapshot) => {
      if (!snapshot.exists()) {
        setOverride(null);
        return;
      }

      setOverride({
        id: snapshot.id,
        ...snapshot.data()
      });
    });
  }, [storeId, tableId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    if (!override) return null;

    const expiresAtMs = toMillis(override.expiresAt);

    if (!expiresAtMs || expiresAtMs <= nowTick) {
      return null;
    }

    const period = periods.find((item) => String(item.id) === String(override.periodId));

    if (!period) return null;

    return {
      ...override,
      expiresAtMs,
      period
    };
  }, [override, periods, nowTick]);
};

export default useTableMenuOverride;
