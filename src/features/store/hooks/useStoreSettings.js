import { useEffect, useState } from 'react';

import {
  isValidStoreId,
  saveStoreSettings,
  subscribeToStoreSettings
} from '../services/storeDataService';
import { TAX_ROUNDING_MODES, normalizeTaxRounding } from '../../../shared/utils/tax';

const DEFAULT_SETTINGS = {
  name: 'My Store',
  taxRate: 10,
  taxRounding: TAX_ROUNDING_MODES.FLOOR,
  acceptedPaymentMethods: ['cash', 'card', 'qr'],
  allowSplitPayment: true,
  allowTakeout: true
};

export const useStoreSettings = (storeId) => {
  const hasStoreId = isValidStoreId(storeId);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) return undefined;

    return subscribeToStoreSettings(
      storeId,
      (nextSettings) => {
        setSettings({
          ...DEFAULT_SETTINGS,
          ...nextSettings,
          taxRounding: normalizeTaxRounding(nextSettings?.taxRounding),
          acceptedPaymentMethods: Array.isArray(nextSettings?.acceptedPaymentMethods) && nextSettings.acceptedPaymentMethods.length > 0
            ? nextSettings.acceptedPaymentMethods
            : DEFAULT_SETTINGS.acceptedPaymentMethods,
          allowSplitPayment: nextSettings?.allowSplitPayment !== false,
          allowTakeout: nextSettings?.allowTakeout !== false
        });
        setLoading(false);
      },
      (error) => {
        console.error('Error subscribing to store settings:', error);
        setLoading(false);
      }
    );
  }, [hasStoreId, storeId]);

  const updateSettings = async (newSettings) => {
    if (!hasStoreId) return;
    await saveStoreSettings(storeId, {
      ...newSettings,
      taxRounding: normalizeTaxRounding(newSettings?.taxRounding),
      acceptedPaymentMethods: Array.isArray(newSettings?.acceptedPaymentMethods) && newSettings.acceptedPaymentMethods.length > 0
        ? newSettings.acceptedPaymentMethods
        : DEFAULT_SETTINGS.acceptedPaymentMethods,
      allowSplitPayment: newSettings?.allowSplitPayment !== false,
      allowTakeout: newSettings?.allowTakeout !== false
    });
  };

  return {
    settings: hasStoreId ? settings : DEFAULT_SETTINGS,
    updateSettings,
    loading: hasStoreId ? loading : false
  };
};
