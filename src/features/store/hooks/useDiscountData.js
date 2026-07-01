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
        // 並び順(sortOrder)昇順。未設定は末尾へ。安定ソートで同値は元の順序を維持。
        const sorted = [...(items || [])].sort((a, b) => {
          const ao = Number.isFinite(Number(a?.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
          const bo = Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
          return ao - bo;
        });
        setDiscounts(sorted);
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
