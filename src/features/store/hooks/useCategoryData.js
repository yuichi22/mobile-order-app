import { useEffect, useState } from 'react';

import {
  isValidStoreId,
  saveCategories,
  subscribeToCategories
} from '../services/storeDataService';
import {
  hasPrefetchedStoreData,
  readPrefetchedCategories
} from '../services/storePrefetchService';
import { useSubscriptionWatchdog } from './useSubscriptionWatchdog';

export const useCategoryData = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [categories, setCategories] = useState(() => (hasStoreId ? readPrefetchedCategories(storeId) : []));
  const [loading, setLoading] = useState(() => hasStoreId && !hasPrefetchedStoreData(storeId));

  const retryNonce = useSubscriptionWatchdog({ loading, active: hasStoreId, setLoading });

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToCategories(
      storeId,
      (items) => {
        setCategories(items);
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to categories:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId, retryNonce]);

  const updateCategories = async (newList) => {
    if (!hasStoreId) return;
    await saveCategories(storeId, newList);
  };

  return {
    categories: hasStoreId ? categories : [],
    updateCategories,
    loading: hasStoreId ? loading : false
  };
};
