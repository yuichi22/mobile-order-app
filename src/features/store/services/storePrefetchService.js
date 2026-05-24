import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';
import { DEFAULT_BUSINESS_SETTINGS } from '../../../shared/utils/businessHours';
import { normalizeTaxRounding, TAX_ROUNDING_MODES } from '../../../shared/utils/tax';

const STORE_PREFETCH_CACHE_PREFIX = 'pitto_store_prefetch::';
const STORE_PREFETCH_TTL_MS = 5 * 60 * 1000;

const safeSessionStorage = {
  getItem: (key) => {
    try {
      return window.sessionStorage ? window.sessionStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(key, value);
    } catch {
      return undefined;
    }
  }
};

const createPrefetchKey = (storeId) => `${STORE_PREFETCH_CACHE_PREFIX}${String(storeId || '').trim()}`;

const readPrefetchPayload = (storeId) => {
  const raw = safeSessionStorage.getItem(createPrefetchKey(storeId));
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw);
    if (!payload?.cachedAt || payload.cachedAt + STORE_PREFETCH_TTL_MS <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const writePrefetchPayload = (storeId, patch) => {
  const current = readPrefetchPayload(storeId) || {};
  safeSessionStorage.setItem(createPrefetchKey(storeId), JSON.stringify({
    ...current,
    ...patch,
    cachedAt: Date.now()
  }));
};

const normalizeStoreSettings = (data) => ({
  ...data,
  taxRounding: normalizeTaxRounding(data?.taxRounding),
  acceptedPaymentMethods: Array.isArray(data?.acceptedPaymentMethods) && data.acceptedPaymentMethods.length > 0
    ? data.acceptedPaymentMethods
    : ['cash', 'card', 'qr'],
  allowSplitPayment: data?.allowSplitPayment !== false,
  allowTakeout: data?.allowTakeout !== false
});

const normalizeBusinessSettings = (data) => (
  data ? { ...DEFAULT_BUSINESS_SETTINGS, ...data } : DEFAULT_BUSINESS_SETTINGS
);

const normalizePeriods = (list) => (
  Array.isArray(list) ? [...list].sort((left, right) => left.start.localeCompare(right.start)) : []
);

export const readPrefetchedStoreSettings = (storeId) => {
  const payload = readPrefetchPayload(storeId);
  if (!payload?.storeSettings) {
    return {
      name: 'My Store',
      taxRate: 10,
      taxRounding: TAX_ROUNDING_MODES.FLOOR,
      acceptedPaymentMethods: ['cash', 'card', 'qr'],
      allowSplitPayment: true,
      allowTakeout: true
    };
  }
  return payload.storeSettings;
};

export const readPrefetchedBusinessSettings = (storeId) => {
  const payload = readPrefetchPayload(storeId);
  return payload?.businessSettings || DEFAULT_BUSINESS_SETTINGS;
};

export const readPrefetchedCategories = (storeId) => {
  const payload = readPrefetchPayload(storeId);
  return Array.isArray(payload?.categories) ? payload.categories : [];
};

export const readPrefetchedMenuItems = (storeId) => {
  const payload = readPrefetchPayload(storeId);
  return Array.isArray(payload?.menuItems) ? payload.menuItems : [];
};

export const readPrefetchedPeriods = (storeId) => {
  const payload = readPrefetchPayload(storeId);
  return Array.isArray(payload?.periods) ? payload.periods : [];
};

export const hasPrefetchedStoreData = (storeId) => Boolean(readPrefetchPayload(storeId));

export const prefetchCustomerStoreData = async (storeId) => {
  const normalizedStoreId = String(storeId || '').trim();
  if (!normalizedStoreId) return;

  const [basicSnapshot, businessSnapshot, categoriesSnapshot, menuSnapshot, periodsSnapshot] = await Promise.allSettled([
    getDoc(doc(db, 'stores', normalizedStoreId, 'settings', 'basic')),
    getDoc(doc(db, 'stores', normalizedStoreId, 'settings', 'business')),
    getDoc(doc(db, 'stores', normalizedStoreId, 'settings', 'categories')),
    getDocs(collection(db, 'stores', normalizedStoreId, 'menuItems')),
    getDoc(doc(db, 'stores', normalizedStoreId, 'settings', 'periods'))
  ]);

  const patch = {};

  if (basicSnapshot.status === 'fulfilled') {
    patch.storeSettings = basicSnapshot.value.exists()
      ? normalizeStoreSettings(basicSnapshot.value.data())
      : {
        name: 'My Store',
        taxRate: 10,
        taxRounding: TAX_ROUNDING_MODES.FLOOR,
        acceptedPaymentMethods: ['cash', 'card', 'qr'],
        allowSplitPayment: true,
        allowTakeout: true
      };
  }

  if (businessSnapshot.status === 'fulfilled') {
    patch.businessSettings = normalizeBusinessSettings(
      businessSnapshot.value.exists() ? businessSnapshot.value.data() : null
    );
  }

  if (categoriesSnapshot.status === 'fulfilled') {
    const data = categoriesSnapshot.value.exists() ? categoriesSnapshot.value.data() : null;
    patch.categories = Array.isArray(data?.list) ? data.list : [];
  }

  if (menuSnapshot.status === 'fulfilled') {
    patch.menuItems = menuSnapshot.value.docs.map((snapshotDoc) => ({
      ...snapshotDoc.data(),
      id: snapshotDoc.id
    }));
  }

  if (periodsSnapshot.status === 'fulfilled') {
    const data = periodsSnapshot.value.exists() ? periodsSnapshot.value.data() : null;
    patch.periods = normalizePeriods(data?.list);
  }

  if (Object.keys(patch).length > 0) {
    writePrefetchPayload(normalizedStoreId, patch);
  }
};
