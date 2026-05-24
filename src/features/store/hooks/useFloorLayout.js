import { useEffect, useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

import {
  isValidStoreId,
  saveFloorLayout,
  subscribeToFloorLayout
} from '../services/storeDataService';

const syncTableDisplayNames = async (storeId, items) => {
  const tableItems = Array.isArray(items)
    ? items.filter((item) => item?.type === 'table')
    : [];

  if (!storeId || tableItems.length === 0) return;

  const batch = writeBatch(db);

  tableItems.forEach((item) => {
    const tableId = String(item.label || '').trim();
    if (!tableId) return;

    const tableDisplayName = String(item.displayName || '').trim();

    batch.set(
      doc(db, 'stores', storeId, 'tables', tableId),
      {
        tableId,
        tableDisplayName,
        displayName: tableDisplayName,
        seats: Number(item.seats || 0) || null,
        isDisabled: Boolean(item.isDisabled),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  await batch.commit();
};

export const useFloorLayout = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [layoutItems, setLayoutItems] = useState([]);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToFloorLayout(
      storeId,
      (items) => {
        setLayoutItems(items);
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to floor layout:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const saveLayout = async (items) => {
    if (!hasStoreId) return;

    await saveFloorLayout(storeId, items);
    await syncTableDisplayNames(storeId, items);
  };

  return {
    layoutItems: hasStoreId ? layoutItems : [],
    saveLayout,
    loading: hasStoreId ? loading : false
  };
};
