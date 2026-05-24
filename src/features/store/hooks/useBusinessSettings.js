import { useEffect, useState } from 'react';

import {
  DEFAULT_BUSINESS_SETTINGS,
  normalizeBusinessSettings
} from '../../../shared/utils/businessHours';
import {
  isValidStoreId,
  saveBusinessSettings,
  subscribeToBusinessSettings
} from '../services/storeDataService';
import {
  hasPrefetchedStoreData,
  readPrefetchedBusinessSettings
} from '../services/storePrefetchService';

export const useBusinessSettings = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [settings, setSettings] = useState(() => (hasStoreId ? readPrefetchedBusinessSettings(storeId) : DEFAULT_BUSINESS_SETTINGS));
  const [loading, setLoading] = useState(() => hasStoreId && !hasPrefetchedStoreData(storeId));

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToBusinessSettings(
      storeId,
      (nextSettings) => {
        setSettings(nextSettings ? { ...DEFAULT_BUSINESS_SETTINGS, ...nextSettings } : DEFAULT_BUSINESS_SETTINGS);
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to business settings:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const updateSettings = async (newSettings) => {
    if (!hasStoreId) return;
    await saveBusinessSettings(storeId, normalizeBusinessSettings(newSettings));
  };

  return {
    settings: hasStoreId ? settings : DEFAULT_BUSINESS_SETTINGS,
    updateSettings,
    loading: hasStoreId ? loading : false
  };
};
