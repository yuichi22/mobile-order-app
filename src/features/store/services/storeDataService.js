import {
  collection,
  addDoc,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { db, firebaseProjectId } from '../../../shared/api/firebase/client';
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

export const subscribeToShopifySettings = (storeId, onData, onError) => (
  onSnapshot(doc(db, 'stores', storeId, 'settings', 'shopify'), (snapshot) => {
    onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
  }, onError)
);

export const saveShopifySettings = async (storeId, settings = {}) => {
  const payload = {
    shopDomain: String(settings.shopDomain || '').trim(),
    clientId: String(settings.clientId || '').trim(),
    clientSecret: String(settings.clientSecret || '').trim(),
    locationId: String(settings.locationId || '').trim(),
    syncEnabled: Boolean(settings.syncEnabled),
    authMode: settings.authMode || 'devDashboard',
    accessToken: deleteField(),
    updatedAt: serverTimestamp()
  };

  await setDoc(storeSettingsDocRef(storeId, 'shopify'), payload, { merge: true });
};


export const subscribeToProductMasterItems = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'products'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const subscribeToProductGroups = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productGroups'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);


const normalizeGroupCodeSegment = (value) => (
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18)
);

const createShortGroupCode = () => {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PG-${random}`;
};

const normalizeProductGroupName = (itemData = {}) => {
  const brandName = String(itemData.brandName || '').trim();
  const productName = String(itemData.name || itemData.baseProductName || '').trim();
  if (brandName && productName) return `${brandName}｜${productName}`;
  return productName || brandName || '名称未設定';
};

const buildProductGroupPayloadFromProduct = (itemData = {}, productId = '') => {
  const groupCode = itemData.groupCode || createShortGroupCode();
  const brandName = String(itemData.brandName || '').trim();
  const baseProductName = String(itemData.baseProductName || itemData.name || '').trim();
  const groupName = normalizeProductGroupName({ ...itemData, baseProductName });

  return {
    name: groupName,
    baseProductName,
    brandId: String(itemData.brandId || '').trim(),
    brandName,
    categoryId: String(itemData.categoryId || '').trim(),
    categoryName: String(itemData.categoryName || '').trim(),
    categoryGroupId: String(itemData.categoryGroupId || '').trim(),
    supplierId: String(itemData.supplierId || '').trim(),
    groupCode,
    productGroupKey: [
      normalizeGroupCodeSegment(brandName || itemData.brandId),
      normalizeGroupCodeSegment(baseProductName || itemData.name),
      groupCode
    ].filter(Boolean).join('-'),
    createdFromProductId: productId || '',
    shopifyEnabled: Boolean(itemData.shopifyCreateEnabled || itemData.shopifyEnabled),
    shopifyProductId: String(itemData.shopifyProductId || '').trim(),
    isActive: itemData.isActive !== false,
    isArchived: Boolean(itemData.isArchived)
  };
};


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

  return itemData.id || payload.id || docRef.id;
};

export const saveProductGroup = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'productGroups', itemData);
};

export const saveProductMasterItem = async (storeId, itemData) => {
  const productId = itemData.id || doc(storeCollectionRef(storeId, 'products')).id;
  const productGroupId = itemData.productGroupId || itemData.groupId || '';

  const stockInQuantity = Math.max(Number(itemData.stockInQuantityDraft || 0), 0);
  const currentInventoryQuantity = Math.max(Number(itemData.inventoryQuantity ?? itemData.quantity ?? 0), 0);
  const nextInventoryQuantity = stockInQuantity > 0
    ? currentInventoryQuantity + stockInQuantity
    : currentInventoryQuantity;

  let nextProductGroupId = productGroupId;

  if (!nextProductGroupId) {
    const groupRef = doc(storeCollectionRef(storeId, 'productGroups'));
    nextProductGroupId = groupRef.id;

    await setDoc(groupRef, {
      id: nextProductGroupId,
      name: itemData.productGroupName || itemData.name || '',
      baseProductName: itemData.name || '',
      brandId: itemData.brandId || '',
      categoryId: itemData.categoryId || '',
      categoryGroupId: itemData.categoryGroupId || '',
      departmentId: itemData.departmentId || 'retail',
      labelEnabled: Boolean(itemData.labelEnabled),
      shopifyEnabled: Boolean(itemData.shopifyCreateEnabled || itemData.shopifyEnabled),
      shopifyProductId: String(itemData.shopifyProductId || '').trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    await setDoc(
      doc(db, 'stores', storeId, 'productGroups', nextProductGroupId),
      {
        name: itemData.productGroupName || itemData.name || '',
        baseProductName: itemData.productGroupName || itemData.name || '',
        brandId: itemData.brandId || '',
        categoryId: itemData.categoryId || '',
        categoryGroupId: itemData.categoryGroupId || '',
        departmentId: itemData.departmentId || 'retail',
        labelEnabled: Boolean(itemData.labelEnabled),
        shopifyEnabled: Boolean(itemData.shopifyCreateEnabled || itemData.shopifyEnabled),
        shopifyProductId: String(itemData.shopifyProductId || '').trim(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  const {
    stockInQuantityDraft,
    ...rawProductPayload
  } = itemData;

  const productPayload = {
    ...rawProductPayload,
    id: productId,
    productGroupId: nextProductGroupId,
    groupId: nextProductGroupId,
    productGroupName: itemData.productGroupName || itemData.name || '',
    productGroupRole: itemData.productGroupRole || 'primary',
    inventoryQuantity: nextInventoryQuantity,
    quantity: nextInventoryQuantity,
    ...(stockInQuantity > 0 ? {
      lastStockInQuantity: stockInQuantity,
      lastStockInAt: serverTimestamp()
    } : {})
  };

  const savedProductId = await saveStoreCollectionDoc(storeId, 'products', productPayload);

  await setDoc(
    doc(db, 'stores', storeId, 'inventory', savedProductId),
    {
      productId: savedProductId,
      productGroupId: nextProductGroupId,
      quantity: nextInventoryQuantity,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  if (stockInQuantity > 0) {
    const movementPayload = {
      productId: savedProductId,
      productGroupId: nextProductGroupId,
      type: 'stock_in',
      quantity: stockInQuantity,
      beforeQuantity: currentInventoryQuantity,
      afterQuantity: nextInventoryQuantity,
      note: '商品マスター入庫',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await addDoc(storeCollectionRef(storeId, 'stockIns'), {
      ...movementPayload,
      status: 'completed'
    });

    await addDoc(storeCollectionRef(storeId, 'stockMovements'), movementPayload);
  }

  return savedProductId;
};



export const subscribeToProductCategories = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productCategories'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductCategory = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'productCategories', itemData);
};

export const subscribeToProductCategoryGroups = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productCategoryGroups'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductCategoryGroup = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'productCategoryGroups', itemData);
};

export const subscribeToProductSubCategories = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productSubCategories'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductSubCategory = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'productSubCategories', itemData);
};

export const subscribeToProductBrands = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'brands'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductBrand = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'brands', itemData);
};

export const subscribeToSuppliers = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'suppliers'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveSupplier = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'suppliers', itemData);
};

export const deleteProductMasterDoc = async (storeId, collectionName, itemId) => {
  await deleteDoc(doc(db, 'stores', storeId, collectionName, itemId));
};


export const createShopifyDraftProductFromGroup = async ({ storeId, productGroupId, idToken }) => {
  const normalizedStoreId = String(storeId || '').trim();
  const normalizedProductGroupId = String(productGroupId || '').trim();
  const token = String(idToken || '').trim();

  if (!normalizedStoreId || !normalizedProductGroupId) {
    throw new Error('Shopify同期に必要な商品グループ情報が不足しています。');
  }

  if (!token) {
    throw new Error('ログイン状態を確認してください。');
  }

  const endpoint = `https://asia-northeast1-${firebaseProjectId}.cloudfunctions.net/createShopifyDraftProduct`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      storeId: normalizedStoreId,
      productGroupId: normalizedProductGroupId
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || body?.message || 'Shopify下書き商品の作成に失敗しました。';
    throw new Error(message);
  }

  return body;
};



export const updateShopifyProductFromGroup = async ({ storeId, productGroupId, idToken }) => {
  const normalizedStoreId = String(storeId || '').trim();
  const normalizedProductGroupId = String(productGroupId || '').trim();

  if (!normalizedStoreId || !normalizedProductGroupId) {
    throw new Error('Shopify更新に必要な商品グループ情報が不足しています。');
  }

  if (!idToken) {
    throw new Error('Shopify更新にはログインが必要です。');
  }

  const endpoint = `https://asia-northeast1-${firebaseProjectId}.cloudfunctions.net/updateShopifyProduct`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      storeId: normalizedStoreId,
      productGroupId: normalizedProductGroupId
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || body?.message || 'Shopify商品の更新に失敗しました。';
    throw new Error(message);
  }

  return body;
};

export const subscribeToProductSalesAreas = (storeId, onData, onError) => (
  onSnapshot(storeCollectionRef(storeId, 'productSalesAreas'), (snapshot) => onData(mapCollectionSnapshot(snapshot)), onError)
);

export const saveProductSalesArea = async (storeId, itemData) => {
  return await saveStoreCollectionDoc(storeId, 'productSalesAreas', itemData);
};

