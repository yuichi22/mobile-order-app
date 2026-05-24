import { useEffect, useState } from 'react';

import {
  deleteMenuItem,
  isValidStoreId,
  saveMenuItem,
  subscribeToMenuItems
} from '../services/storeDataService';
import {
  hasPrefetchedStoreData,
  readPrefetchedMenuItems
} from '../services/storePrefetchService';

export const useMenuData = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [menuItems, setMenuItems] = useState(() => (hasStoreId ? readPrefetchedMenuItems(storeId) : []));
  const [loading, setLoading] = useState(() => hasStoreId && !hasPrefetchedStoreData(storeId));

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToMenuItems(
      storeId,
      (items) => {
        setMenuItems(items);
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to menu items:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const updateMenu = async (itemData) => {
    if (!hasStoreId) return;
    await saveMenuItem(storeId, itemData);
  };

  const deleteMenu = async (itemId) => {
    if (!hasStoreId || !itemId) return;
    await deleteMenuItem(storeId, itemId);
  };

  return {
    menuItems: hasStoreId ? menuItems : [],
    updateMenu,
    deleteMenu,
    loading: hasStoreId ? loading : false
  };
};
