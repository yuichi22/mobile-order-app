import { useEffect, useState } from 'react';

import {
  isValidStoreId,
  savePeriods,
  subscribeToPeriods
} from '../services/storeDataService';
import {
  hasPrefetchedStoreData,
  readPrefetchedPeriods
} from '../services/storePrefetchService';

export const usePeriodData = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [periods, setPeriods] = useState(() => (hasStoreId ? readPrefetchedPeriods(storeId) : []));
  const [loading, setLoading] = useState(() => hasStoreId && !hasPrefetchedStoreData(storeId));

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToPeriods(
      storeId,
      (items) => {
        setPeriods(items);
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to periods:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const updatePeriods = async (newList) => {
    if (!hasStoreId) return;
    await savePeriods(storeId, newList);
  };

  return {
    periods: hasStoreId ? periods : [],
    updatePeriods,
    loading: hasStoreId ? loading : false
  };
};
