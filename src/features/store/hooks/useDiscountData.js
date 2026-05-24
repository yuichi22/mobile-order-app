import { useEffect, useState } from 'react';

import {
  deleteDiscount,
  isValidStoreId,
  saveDiscount,
  subscribeToDiscounts
} from '../services/storeDataService';

export const useDiscountData = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToDiscounts(
      storeId,
      (items) => {
        setDiscounts(items);
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to discounts:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const save = async (data) => {
    if (!hasStoreId) return;
    await saveDiscount(storeId, data);
  };

  const remove = async (id) => {
    if (!hasStoreId || !id) return;
    await deleteDiscount(storeId, id);
  };

  return {
    discounts: hasStoreId ? discounts : [],
    saveDiscount: save,
    deleteDiscount: remove,
    loading: hasStoreId ? loading : false
  };
};
