import {
  collection,
  addDoc,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  query,
  orderBy,
  where,
  limit,
  writeBatch
} from 'firebase/firestore';

import { db, firebaseProjectId } from '../../../shared/api/firebase/client';
import { decorateMenuItemAvailability } from '../../../shared/utils/menuAvailability';
import { TAX_ROUNDING_MODES, normalizeTaxRounding } from '../../../shared/utils/tax';

export const isValidStoreId = (storeId) => Boolean(storeId && typeof storeId === 'string');

const mapCollectionSnapshot = (snapshot) => snapshot.docs.map((snapshotDoc) => ({
  ...snapshotDoc.data(),
  id: snapshotDoc.id
}));

const storeCollectionRef = (storeId, collectionName) => collection(db, 'stores', storeId, collectionName);

const PRODUCT_MASTER_INITIAL_LIMIT = 200;
const PRODUCT_GROUP_INITIAL_LIMIT = 500;

const subscribeToLimitedStoreCollection = (
  storeId,
  collectionName,
  onData,
  onError,
  { limitCount = 200, orderField = 'name', orderDirection = 'asc' } = {}
) => {
  const baseRef = storeCollectionRef(storeId, collectionName);
  const limitedQuery = query(baseRef, orderBy(orderField, orderDirection), limit(limitCount));

  return onSnapshot(
    limitedQuery,
    (snapshot) => onData(mapCollectionSnapshot(snapshot)),
    onError
  );
};
const storeSettingsDocRef = (storeId, docName) => doc(db, 'stores', storeId, 'settings', docName);
const storeRootDocRef = (storeId) => doc(db, 'stores', storeId);

export const subscribeToMenuItems = (storeId, onData, onError) => (
  onSnapshot(
    storeCollectionRef(storeId, 'menuItems'),
    (snapshot) => {
      const items = mapCollectionSnapshot(snapshot).map((item) => decorateMenuItemAvailability(item));
      onData(items);
    },
    onError
  )
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
    inventorySyncEnabled: Boolean(settings.inventorySyncEnabled),
    authMode: settings.authMode || 'devDashboard',
    accessToken: deleteField(),
    updatedAt: serverTimestamp()
  };

  await setDoc(storeSettingsDocRef(storeId, 'shopify'), payload, { merge: true });
};


export const subscribeToProductMasterItems = (storeId, onData, onError) => (
  subscribeToLimitedStoreCollection(
    storeId,
    'products',
    onData,
    onError,
    {
      limitCount: PRODUCT_MASTER_INITIAL_LIMIT,
      orderField: 'updatedAt',
      orderDirection: 'desc'
    }
  )
);

export const subscribeToProductGroups = (storeId, onData, onError) => (
  subscribeToLimitedStoreCollection(
    storeId,
    'productGroups',
    onData,
    onError,
    {
      limitCount: PRODUCT_GROUP_INITIAL_LIMIT,
      orderField: 'updatedAt',
      orderDirection: 'desc'
    }
  )
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

export const getProductStockInHistory = async (storeId, productId, { limitCount = 50 } = {}) => {
  if (!isValidStoreId(storeId) || !productId) return [];

  const historyQuery = query(
    storeCollectionRef(storeId, 'stockIns'),
    where('productId', '==', productId)
  );

  const snapshot = await getDocs(historyQuery);
  const records = mapCollectionSnapshot(snapshot);

  records.sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return bTime - aTime;
  });

  return records.slice(0, limitCount);
};

export const adjustProductInventory = async (storeId, productId, { quantity, note = '' } = {}) => {
  if (!isValidStoreId(storeId) || !productId) {
    throw new Error('invalid storeId or productId');
  }

  const productRef = doc(db, 'stores', storeId, 'products', productId);
  const productSnap = await getDoc(productRef);

  if (!productSnap.exists()) {
    throw new Error('product not found');
  }

  const productData = productSnap.data();
  const beforeQuantity = Math.max(Number(productData.inventoryQuantity ?? productData.quantity ?? 0), 0);
  const afterQuantity = Math.max(Number(quantity ?? 0), 0);

  await setDoc(productRef, {
    inventoryQuantity: afterQuantity,
    quantity: afterQuantity,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await setDoc(
    doc(db, 'stores', storeId, 'inventory', productId),
    {
      productId,
      quantity: afterQuantity,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await addDoc(storeCollectionRef(storeId, 'stockMovements'), {
    productId,
    productGroupId: productData.productGroupId || productData.groupId || '',
    type: 'adjustment',
    quantity: afterQuantity - beforeQuantity,
    beforeQuantity,
    afterQuantity,
    note: note || '商品マスター在庫調整',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return afterQuantity;
};

export const getProductInventoryAdjustmentHistory = async (storeId, productId, { limitCount = 50 } = {}) => {
  if (!isValidStoreId(storeId) || !productId) return [];

  const historyQuery = query(
    storeCollectionRef(storeId, 'stockMovements'),
    where('productId', '==', productId)
  );

  const snapshot = await getDocs(historyQuery);
  const records = mapCollectionSnapshot(snapshot)
    .filter((record) => record.type === 'adjustment');

  records.sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return bTime - aTime;
  });

  return records.slice(0, limitCount);
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


export const syncShopifyProductLinks = async ({ storeId, statuses = ['ACTIVE'], idToken }) => {
  const normalizedStoreId = String(storeId || '').trim();
  const token = String(idToken || '').trim();

  if (!normalizedStoreId) {
    throw new Error('店舗情報が不足しています。');
  }
  if (!token) {
    throw new Error('ログイン状態を確認してください。');
  }

  const endpoint = `https://asia-northeast1-${firebaseProjectId}.cloudfunctions.net/syncShopifyProductLinks`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      storeId: normalizedStoreId,
      statuses: Array.isArray(statuses) ? statuses : ['ACTIVE']
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || body?.message || 'Shopify同期に失敗しました。';
    throw new Error(message);
  }

  return body;
};


export const pushInventoryToShopify = async ({ storeId, productIds = [], idToken }) => {
  const normalizedStoreId = String(storeId || '').trim();
  const ids = Array.isArray(productIds) ? productIds.filter(Boolean) : [];
  const token = String(idToken || '').trim();

  if (!normalizedStoreId || ids.length === 0 || !token) return undefined;

  const endpoint = `https://asia-northeast1-${firebaseProjectId}.cloudfunctions.net/pushInventoryToShopify`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ storeId: normalizedStoreId, productIds: ids })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error?.message || body?.message || 'Shopify在庫反映に失敗しました。');
  }

  return body;
};


// Firestore現在庫 と Shopify on_hand を突合し、不一致レポートを作成する(自動修復なし)。
export const reconcileShopifyInventory = async ({ storeId, idToken }) => {
  const normalizedStoreId = String(storeId || '').trim();
  const token = String(idToken || '').trim();

  if (!normalizedStoreId || !token) {
    throw new Error('在庫の差分確認にはログインが必要です。');
  }

  const endpoint = `https://asia-northeast1-${firebaseProjectId}.cloudfunctions.net/reconcileShopifyInventory`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ storeId: normalizedStoreId })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error?.message || body?.message || '在庫の差分確認に失敗しました。');
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

// 売場名変更時に products コレクションの salesAreaName を一括カスケード更新する。
// salesAreaId ベースで検索するため、salesAreaName の値に依存しない。
export const saveProductSalesAreaWithCascade = async (storeId, itemData) => {
  const newName = String(itemData.name || '').trim();
  const savedId = await saveStoreCollectionDoc(storeId, 'productSalesAreas', itemData);

  if (!itemData.id || !newName) return savedId;

  // salesAreaId が一致する全商品の salesAreaName を newName に更新する。
  const productsSnap = await getDocs(
    query(storeCollectionRef(storeId, 'products'), where('salesAreaId', '==', itemData.id))
  );

  if (productsSnap.empty) return savedId;

  const BATCH_SIZE = 400;
  const docs = productsSnap.docs;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    docs.slice(i, i + BATCH_SIZE).forEach((docSnap) => {
      batch.update(docSnap.ref, { salesAreaName: newName, updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }

  return savedId;
};

