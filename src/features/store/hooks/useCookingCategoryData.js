import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

const DEFAULT_COOKING_CATEGORIES = [];

const normalizeCookingCategories = (items = []) => (
  Array.isArray(items)
    ? items
        .map((item, index) => ({
          id: item.id || `cook_${Date.now()}_${index}`,
          name: String(item.name || '').trim(),
          sortOrder: Number(item.sortOrder ?? ((index + 1) * 1000))
        }))
        .filter((item) => item.name)
        .sort((left, right) => {
          const leftOrder = Number(left.sortOrder ?? 999999);
          const rightOrder = Number(right.sortOrder ?? 999999);
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
        })
    : DEFAULT_COOKING_CATEGORIES
);

export const useCookingCategoryData = (storeId) => {
  const [cookingCategories, setCookingCategories] = useState(DEFAULT_COOKING_CATEGORIES);
  const [loading, setLoading] = useState(Boolean(storeId));

  useEffect(() => {
    if (!storeId) {
      setCookingCategories(DEFAULT_COOKING_CATEGORIES);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const ref = doc(db, 'stores', storeId, 'settings', 'cookingCategories');

    return onSnapshot(
      ref,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setCookingCategories(normalizeCookingCategories(data.items || data.cookingCategories || []));
        setLoading(false);
      },
      (error) => {
        console.error('Failed to load cooking categories:', error);
        setCookingCategories(DEFAULT_COOKING_CATEGORIES);
        setLoading(false);
      }
    );
  }, [storeId]);

  const updateCookingCategories = async (nextItems = []) => {
    if (!storeId) return;

    const normalizedItems = normalizeCookingCategories(nextItems);

    await setDoc(
      doc(db, 'stores', storeId, 'settings', 'cookingCategories'),
      {
        items: normalizedItems,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  };

  return {
    cookingCategories,
    loading,
    updateCookingCategories
  };
};