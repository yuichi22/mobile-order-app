import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';
import { TAX_ROUNDING_MODES, normalizeTaxRounding } from '../../../shared/utils/tax';

export const isValidStoreId = (storeId) => Boolean(storeId && typeof storeId === 'string');

const mapCollectionSnapshot = (snapshot) => snapshot.docs.map((snapshotDoc) => ({
  ...snapshotDoc.data(),
  id: snapshotDoc.id
}));

const storeCollectionRef = (storeId, collectionName) => collection(db, 'stores', storeId, collectionName);
const storeSettingsDocRef = (storeId, docName) => doc(db, 'stores', storeId, 'settings', docName);
const storeRootDocRef = (storeId) => doc(db, 'stores', storeId);

export const subscribeToMenuItems = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'menuItems'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveMenuItem = async (storeId, itemData) => {
  const docRef = itemData.id
    ? doc(db, 'stores', storeId, 'menuItems', itemData.id)
    : doc(storeCollectionRef(storeId, 'menuItems'));

  const { id: _id, ...payload } = itemData;
  await setDoc(docRef, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
};

export const deleteMenuItem = async (storeId, itemId) => {
  await deleteDoc(doc(db, 'stores', storeId, 'menuItems', itemId));
};

export const subscribeToStoreSettings = (storeId, onData, onError) => (
  onSnapshot(storeSettingsDocRef(storeId, 'basic'), (snapshot) => {
    if (!snapshot.exists()) {
      onData({
        name: 'My Store',
        taxRate: 10,
        taxRateReduced: 8,
        taxRounding: TAX_ROUNDING_MODES.FLOOR,
        menuPriceTaxMode: 'tax_included',
        defaultCostTaxMode: 'tax_included',
        defaultCostTaxRateType: 'standard',
        acceptedPaymentMethods: ['cash', 'card', 'qr'],
        allowSplitPayment: true,
        allowTakeout: true
      });
      return;
    }

    const data = snapshot.data();
    onData({
      ...data,
      taxRate: Number(data.taxRate ?? 10),
      taxRateReduced: Number(data.taxRateReduced ?? 8),
      taxRounding: normalizeTaxRounding(data.taxRounding),
      menuPriceTaxMode: ['tax_included', 'tax_excluded'].includes(data.menuPriceTaxMode)
        ? data.menuPriceTaxMode
        : 'tax_included',
      defaultCostTaxMode: ['tax_included', 'tax_excluded'].includes(data.defaultCostTaxMode)
        ? data.defaultCostTaxMode
        : 'tax_included',
      defaultCostTaxRateType: ['standard', 'reduced', 'exempt'].includes(data.defaultCostTaxRateType)
        ? data.defaultCostTaxRateType
        : 'standard',
      acceptedPaymentMethods: Array.isArray(data.acceptedPaymentMethods) && data.acceptedPaymentMethods.length > 0
        ? data.acceptedPaymentMethods
        : ['cash', 'card', 'qr'],
      allowSplitPayment: data.allowSplitPayment !== false,
      allowTakeout: data.allowTakeout !== false
    });
  }, onError)
);

export const saveStoreSettings = async (storeId, settings) => {
  await setDoc(storeSettingsDocRef(storeId, 'basic'), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
};

export const subscribeToBusinessSettings = (storeId, onData, onError) => (
  onSnapshot(storeSettingsDocRef(storeId, 'business'), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() : null);
  }, onError)
);

export const saveBusinessSettings = async (storeId, settings) => {
  await setDoc(storeSettingsDocRef(storeId, 'business'), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
};

export const subscribeToDiscounts = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'discounts'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveDiscount = async (storeId, discountData) => {
  const docRef = discountData.id
    ? doc(db, 'stores', storeId, 'discounts', discountData.id)
    : doc(storeCollectionRef(storeId, 'discounts'));

  const { id: _id, ...payload } = discountData;
  await setDoc(docRef, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
};

export const deleteDiscount = async (storeId, discountId) => {
  await deleteDoc(doc(db, 'stores', storeId, 'discounts', discountId));
};

export const subscribeToFloorLayout = (storeId, onData, onError) => (
  onSnapshot(storeSettingsDocRef(storeId, 'layout'), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data().items : []);
  }, onError)
);

export const saveFloorLayout = async (storeId, items) => {
  await setDoc(storeSettingsDocRef(storeId, 'layout'), { items, updatedAt: serverTimestamp() });
};

export const subscribeToCategories = (storeId, onData, onError) => (
  onSnapshot(storeSettingsDocRef(storeId, 'categories'), (snapshot) => {
    onData(snapshot.exists() && snapshot.data().list ? snapshot.data().list : []);
  }, onError)
);

export const saveCategories = async (storeId, list) => {
  await setDoc(storeSettingsDocRef(storeId, 'categories'), { list, updatedAt: serverTimestamp() });
};

export const subscribeToPeriods = (storeId, onData, onError) => (
  onSnapshot(storeSettingsDocRef(storeId, 'periods'), (snapshot) => {
    if (snapshot.exists() && snapshot.data().list) {
      const sortedList = [...snapshot.data().list].sort((left, right) => left.start.localeCompare(right.start));
      onData(sortedList);
      return;
    }

    onData([]);
  }, onError)
);

export const savePeriods = async (storeId, list) => {
  await setDoc(storeSettingsDocRef(storeId, 'periods'), { list, updatedAt: serverTimestamp() });
};

export const subscribeToStoreConfig = (storeId, onData, onError) => (
  onSnapshot(storeRootDocRef(storeId), (snapshot) => {
    if (!snapshot.exists()) {
      onData(null);
      return;
    }

    const data = snapshot.data();
    onData({
      id: snapshot.id,
      name: data.name || '',
      layoutMode: data.layoutMode || 'grid',
      ...data
    });
  }, onError)
);

export const saveStoreConfig = async (storeId, config) => {
  await setDoc(storeRootDocRef(storeId), { ...config, updatedAt: serverTimestamp() }, { merge: true });
};

export const subscribeToProductMasterItems = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'products'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

const saveStoreCollectionDoc = async (storeId, collectionName, itemData) => {
  const docRef = itemData.id
    ? doc(db, 'stores', storeId, collectionName, itemData.id)
    : doc(storeCollectionRef(storeId, collectionName));

  const { id: _id, ...payload } = itemData;

  await setDoc(docRef, {
    ...payload,
    createdAt: payload.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return docRef.id;
};

export const saveProductMasterItem = async (storeId, itemData) => {
  const productId = await saveStoreCollectionDoc(storeId, 'products', itemData);

  if (!itemData.id) {
    await setDoc(
      doc(db, 'stores', storeId, 'inventory', productId),
      {
        productId,
        quantity: 0,
        availableQuantity: 0,
        reservedQuantity: 0,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  return productId;
};

export const subscribeToProductCategories = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productCategories'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductCategory = async (storeId, itemData) => {
  await saveStoreCollectionDoc(storeId, 'productCategories', itemData);
};

export const subscribeToProductCategoryGroups = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productCategoryGroups'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductCategoryGroup = async (storeId, itemData) => {
  await saveStoreCollectionDoc(storeId, 'productCategoryGroups', itemData);
};

export const subscribeToProductBrands = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'brands'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductBrand = async (storeId, itemData) => {
  await saveStoreCollectionDoc(storeId, 'brands', itemData);
};

export const subscribeToSuppliers = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'suppliers'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveSupplier = async (storeId, itemData) => {
  await saveStoreCollectionDoc(storeId, 'suppliers', itemData);
};

export const deleteProductMasterDoc = async (storeId, collectionName, itemId) => {
  await deleteDoc(doc(db, 'stores', storeId, collectionName, itemId));
};

