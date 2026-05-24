import { useEffect, useState } from 'react';

import {
  isValidStoreId,
  saveStoreConfig,
  subscribeToStoreConfig
} from '../services/storeDataService';

export const useStoreConfig = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToStoreConfig(
      storeId,
      (nextConfig) => {
        setConfig(nextConfig);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching store config:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const updateConfig = async (newConfig) => {
    if (!hasStoreId) return;
    await saveStoreConfig(storeId, newConfig);
  };

  return {
    config: hasStoreId ? config : null,
    updateConfig,
    loading: hasStoreId ? loading : false
  };
};
