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
  runTransaction,
  writeBatch
} from 'firebase/firestore';

import { db, firebaseProjectId } from '../../../shared/api/firebase/client';
import { decorateMenuItemAvailability } from '../../../shared/utils/menuAvailability';
import { TAX_ROUNDING_MODES, normalizeTaxRounding } from '../../../shared/utils/tax';
import { getActiveStocktake, recordStocktakeStockIn } from '../../inventory/services/stocktakeDataService';

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

// EAN-13 のチェックデジット(末尾1桁)を計算する。digits12 は先頭12桁の数字文字列。
const ean13CheckDigit = (digits12) => {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = Number(digits12[i]) || 0;
    sum += i % 2 === 0 ? n : n * 3;
  }
  return String((10 - (sum % 10)) % 10);
};

// 店内(インストア)コードを採番する。GS1の店内用枠「先頭2」を使い、実商品JANと衝突しない。
// 形式: EAN-13 = "2" + 連番(11桁ゼロ埋め) + チェックデジット。カウンタはトランザクションで原子的に加算。
export const issueInstoreBarcode = async (storeId) => {
  if (!isValidStoreId(storeId)) throw new Error('storeId が不正です');
  const counterRef = doc(db, 'stores', storeId, 'counters', 'instoreBarcode');
  const next = await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(counterRef);
    const current = snapshot.exists() ? Number(snapshot.data().next || 0) : 0;
    const value = current + 1;
    tx.set(counterRef, { next: value, updatedAt: serverTimestamp() }, { merge: true });
    return value;
  });
  const body = `2${String(next).padStart(11, '0')}`; // 12桁
  return `${body}${ean13CheckDigit(body)}`;
};

export const saveProductMasterItem = async (storeId, itemData) => {
  const productId = itemData.id || doc(storeCollectionRef(storeId, 'products')).id;

  // バーコードはユニーク制約。同じバーコードを持つ別商品が既にあれば登録/更新を弾く。
  // (空バーコードは対象外＝複数許可)
  const barcode = String(itemData.barcode || '').trim();
  if (barcode) {
    const dupSnapshot = await getDocs(query(
      storeCollectionRef(storeId, 'products'),
      where('barcode', '==', barcode),
      limit(5)
    ));
    const conflict = dupSnapshot.docs.find((snapshotDoc) => snapshotDoc.id !== productId);
    if (conflict) {
      const conflictName = conflict.data()?.name || '別の商品';
      const error = new Error(`このバーコード（${barcode}）は既に「${conflictName}」で登録されています。バーコードは商品ごとに固有である必要があります。`);
      error.code = 'duplicate-barcode';
      throw error;
    }
  }

  const productGroupId = itemData.productGroupId || itemData.groupId || '';

  const stockInQuantity = Math.max(Number(itemData.stockInQuantityDraft || 0), 0);
  const currentInventoryQuantity = Math.max(Number(itemData.inventoryQuantity ?? itemData.quantity ?? 0), 0);

  // 棚卸し進行中の入庫は live 在庫に加算せず、棚卸しカウント側へ反映する。
  // (finalizeStocktake が在庫を上書きするため、live加算では確定時に消える)
  const activeStocktake = stockInQuantity > 0 ? await getActiveStocktake(storeId) : null;
  const routeStockInToStocktake = Boolean(activeStocktake);

  const nextInventoryQuantity = (stockInQuantity > 0 && !routeStockInToStocktake)
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

  if (stockInQuantity > 0 && routeStockInToStocktake) {
    // 棚卸し中: live在庫は加算済みでない。棚卸しカウントへ反映する。
    // 監査ログ(stockIns/stockMovements)は recordStocktakeStockIn 側で記録する。
    await recordStocktakeStockIn(
      storeId,
      activeStocktake.id,
      { ...productPayload, id: savedProductId },
      { quantity: stockInQuantity, isNewProduct: !itemData.id }
    );
  } else if (stockInQuantity > 0) {
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

// ラベル印刷キューへ積む。プリンタに繋がらない端末(モバイル下げ札登録)から使う。
// プリンタのあるPC(商品マスタ画面)が labelPrintQueue を購読し、枚数分を自動印刷して削除する。
export const enqueueLabelPrint = async (storeId, { product, copies, source = 'mobile' } = {}) => {
  if (!isValidStoreId(storeId)) return null;
  const qty = Math.max(1, Math.min(999, Math.floor(Number(copies) || 1)));
  const p = product || {};
  const item = {
    barcode: String(p.barcode || '').trim(),
    sku: String(p.sku || p.productCode || '').trim(),
    productCode: String(p.productCode || p.sku || '').trim(),
    name: String(p.name || p.productGroupName || '').trim(),
    priceTaxIncluded: p.priceTaxIncluded ?? null,
    priceTaxExcluded: p.priceTaxExcluded ?? null,
    colorName: String(p.colorName || '').trim(),
    size: String(p.size || '').trim()
  };
  const ref = await addDoc(storeCollectionRef(storeId, 'labelPrintQueue'), {
    status: 'pending',
    source: String(source || 'mobile'),
    copies: qty,
    product: item,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
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

// ===== 発注管理 (purchaseOrders) =====
// 発注書は stores/{id}/purchaseOrders に発注書単位で保存する。
// 明細(lines)は配列のため serverTimestamp が使えない。明細内の日時(orderedAt/receivedAt)と
// ETA は ISO/日付文字列で持つ。商品docには表示用キャッシュ
// (orderStatus/orderedAt/activePoId/orderEta) を書き戻し、正は purchaseOrders 側とする。

// 発注候補の読み込み方式。true = needsReorder フラグで候補だけ読む(軽量)。
// 体感が悪化した場合は false に戻して再デプロイするだけで旧フルスキャンに復帰できる。
// (フラグは functions の syncProductNeedsReorder が維持し続けるので戻しても壊れない)
const USE_NEEDS_REORDER_FLAG = true;

// 旧方式: 発注点(reorderPoint)が設定された全商品をフルスキャンする。
// フラグ未移行ストアの初回読み込みとバックフィル、およびフラグ方式からの切り戻しに使う。
const fetchProductsForReorderFullScan = async (storeId) => {
  const snapshot = await getDocs(query(
    storeCollectionRef(storeId, 'products'),
    where('reorderPoint', '>=', 0)
  ));
  return mapCollectionSnapshot(snapshot);
};

// 既存商品への needsReorder 一括付与。needsReorder フィールドのみ update し他フィールドに触れない。
// 完了マーカーは settings/purchase.needsReorderBackfilledAt。
const backfillNeedsReorderFlags = async (storeId, products) => {
  for (let index = 0; index < products.length; index += 450) {
    const batch = writeBatch(db);
    products.slice(index, index + 450).forEach((product) => {
      const reorderPoint = Number(product.reorderPoint);
      const inventory = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
      batch.update(doc(db, 'stores', storeId, 'products', product.id), {
        needsReorder: Number.isFinite(reorderPoint) && inventory <= reorderPoint
      });
    });
    await batch.commit();
  }

  await setDoc(storeSettingsDocRef(storeId, 'purchase'), {
    needsReorderBackfilledAt: serverTimestamp()
  }, { merge: true });
};

// 発注候補の取得。移行済みストアは「在庫が発注点以下」の商品だけを読む。
// 未移行ストアは初回のみ旧フルスキャンで読みつつフラグを書いて自動移行する。
export const fetchProductsForReorder = async (storeId) => {
  if (!USE_NEEDS_REORDER_FLAG) return fetchProductsForReorderFullScan(storeId);

  const [markerSnapshot, flaggedSnapshot] = await Promise.all([
    getDoc(storeSettingsDocRef(storeId, 'purchase')),
    getDocs(query(storeCollectionRef(storeId, 'products'), where('needsReorder', '==', true)))
  ]);

  if (markerSnapshot.exists() && markerSnapshot.data().needsReorderBackfilledAt) {
    return mapCollectionSnapshot(flaggedSnapshot);
  }

  const products = await fetchProductsForReorderFullScan(storeId);
  try {
    await backfillNeedsReorderFlags(storeId, products);
  } catch (error) {
    // 権限不足などで失敗しても画面はフルスキャン結果で動く。マーカー未設定のため次回再試行される。
    console.warn('needsReorder のバックフィルに失敗しました(次回再試行)', error);
  }
  return products;
};

// 発注書への手動追加(商品一覧ブラウズ)用に全商品を取得する。発注点未設定の商品も含む。
// ※現在は fetchScopedProductsForPurchase(絞り込み版)を使用。切り戻し用に残している。
export const fetchAllProductsForPurchase = async (storeId) => {
  const snapshot = await getDocs(storeCollectionRef(storeId, 'products'));
  return mapCollectionSnapshot(snapshot);
};

// 「その他の商品」モーダル用: 仕入先/ブランドに絞って商品を取得する(全商品スキャン廃止)。
// 商品の仕入先は 商品.supplierId 直指定 と ブランド経由(brandId→brand.supplierId) の2系統が
// あるため、supplierId一致とブランドID群('in'は30件ずつ)の和集合を返す。
// スコープの最終判定(resolvedSupplierId)は呼び出し側が行う。
export const fetchScopedProductsForPurchase = async (storeId, { supplierId = '', brandIds = [] } = {}) => {
  const requests = [];
  if (supplierId) {
    requests.push(getDocs(query(storeCollectionRef(storeId, 'products'), where('supplierId', '==', supplierId))));
  }
  for (let index = 0; index < brandIds.length; index += 30) {
    requests.push(getDocs(query(storeCollectionRef(storeId, 'products'), where('brandId', 'in', brandIds.slice(index, index + 30)))));
  }

  const snapshots = await Promise.all(requests);
  const byId = new Map();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((snapshotDoc) => byId.set(snapshotDoc.id, { ...snapshotDoc.data(), id: snapshotDoc.id }));
  });
  return [...byId.values()];
};

// 発注管理画面のセッション内キャッシュ(stale-while-revalidate)。
// 画面側はキャッシュがあれば即描画し、裏で最新を取得して置き換える。
export const purchaseReorderCache = new Map();
// 「その他の商品」モーダルで取得済みの商品プール(storeId -> Map(productId -> product))と、
// 取得済みスコープ(storeId -> Set(scopeKey))。スコープ単位で読み込み済みかを判定する。
export const purchaseProductPoolCache = new Map();
export const purchaseLoadedScopesCache = new Map();

// 設定画面を開いた時点で発注候補を裏読みしてキャッシュを温める。
// 未キャッシュ時のみ実行（最新化は発注管理画面を開いたときのSWRが担う）。失敗は握りつぶす。
export const prefetchPurchaseReorderProducts = (storeId) => {
  if (!isValidStoreId(storeId) || purchaseReorderCache.has(storeId)) return;
  fetchProductsForReorder(storeId)
    .then((products) => purchaseReorderCache.set(storeId, products))
    .catch(() => {});
};

// 発注リストから発注点・発注数・LOTなどを単項目更新する
// （saveProductMasterItem はグループ作成や入庫処理を伴うため使わない）。
export const updateProductPurchaseSettings = async (storeId, productId, patch) => {
  await setDoc(doc(db, 'stores', storeId, 'products', productId), {
    ...patch,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

export const subscribeToPurchaseOrders = (storeId, onData, onError) => (
  onSnapshot(
    query(storeCollectionRef(storeId, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(200)),
    (snapshot) => onData(mapCollectionSnapshot(snapshot)),
    onError
  )
);

const normalizePurchaseOrderLine = (line) => ({
  productId: String(line.productId || ''),
  productName: String(line.productName || ''),
  sku: String(line.sku || ''),
  brandId: String(line.brandId || ''),
  brandName: String(line.brandName || ''),
  qty: Math.max(Number(line.qty || 0), 0),
  // 発注書の表記は税抜定価。仕入概算(掛け率or原価)は estimated* に記録して後の実績と比較する。
  unitPrice: Number.isFinite(Number(line.unitPrice)) ? Number(line.unitPrice) : null,
  amount: Math.max(Number(line.amount || 0), 0),
  estimatedUnitCost: Number.isFinite(Number(line.estimatedUnitCost)) ? Number(line.estimatedUnitCost) : null,
  estimatedAmount: Math.max(Number(line.estimatedAmount || 0), 0),
  eta: line.eta || null,
  receivedQty: Math.max(Number(line.receivedQty || 0), 0),
  receivedAt: line.receivedAt || null,
  canceled: Boolean(line.canceled)
});

export const derivePurchaseOrderStatus = (lines, fallback = 'ordered') => {
  const activeLines = (lines || []).filter((line) => !line.canceled);
  if (!activeLines.length) return 'canceled';
  const isLineReceived = (line) => Number(line.receivedQty || 0) >= Number(line.qty || 0);
  if (activeLines.every(isLineReceived)) return 'received';
  if (activeLines.some((line) => Number(line.receivedQty || 0) > 0)) return 'partiallyReceived';
  return fallback;
};

// 発注確定。発注書を作成し、明細商品へ「発注済み」キャッシュを書き戻す。
// supersede: 欠品自動キャンセル仕入先で判定日数超過のため再発注する場合、
// 旧発注書の該当明細を canceled にする [{ poId, productId }]。
export const createPurchaseOrder = async (storeId, poData) => {
  if (!isValidStoreId(storeId)) throw new Error('storeId が不正です');

  const lines = (poData.lines || []).map(normalizePurchaseOrderLine).filter((line) => line.productId && line.qty > 0);
  if (!lines.length) throw new Error('発注明細がありません');

  const poRef = doc(storeCollectionRef(storeId, 'purchaseOrders'));
  const orderedAtIso = new Date().toISOString();

  const batch = writeBatch(db);
  batch.set(poRef, {
    supplierId: String(poData.supplierId || ''),
    supplierName: String(poData.supplierName || ''),
    status: 'ordered',
    method: poData.method || null,
    eta: poData.eta || null,
    note: String(poData.note || ''),
    totalAmount: lines.reduce((sum, line) => sum + line.amount, 0),
    estimatedCostTotal: lines.reduce((sum, line) => sum + line.estimatedAmount, 0),
    excludedBrandIds: Array.isArray(poData.excludedBrandIds) ? poData.excludedBrandIds : [],
    lines,
    orderedAt: orderedAtIso,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  lines.forEach((line) => {
    batch.set(
      doc(db, 'stores', storeId, 'products', line.productId),
      {
        orderStatus: 'ordered',
        orderedAt: orderedAtIso,
        activePoId: poRef.id,
        orderEta: line.eta || poData.eta || null,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  await batch.commit();

  const supersede = (poData.supersede || []).filter((entry) => entry?.poId && entry?.productId);
  if (supersede.length) {
    await cancelPurchaseOrderLines(storeId, supersede);
  }

  return poRef.id;
};

// 旧発注書の明細を欠品キャンセル扱いにする（未入庫分のみ）。
const cancelPurchaseOrderLines = async (storeId, entries) => {
  const byPoId = entries.reduce((map, entry) => {
    const poId = String(entry.poId);
    if (!map[poId]) map[poId] = new Set();
    map[poId].add(String(entry.productId));
    return map;
  }, {});

  await Promise.all(Object.entries(byPoId).map(async ([poId, productIds]) => {
    const poRef = doc(db, 'stores', storeId, 'purchaseOrders', poId);
    const poSnapshot = await getDoc(poRef);
    if (!poSnapshot.exists()) return;

    const poCurrent = poSnapshot.data();
    const nextLines = (poCurrent.lines || []).map((line) => (
      productIds.has(String(line.productId)) && Number(line.receivedQty || 0) === 0
        ? { ...line, canceled: true }
        : line
    ));

    await setDoc(poRef, {
      lines: nextLines,
      status: derivePurchaseOrderStatus(nextLines, poCurrent.status || 'ordered'),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }));
};

// 発注書の部分更新（ETA・メモ・明細ETA等）。lines を渡すと全明細を置き換え status を再導出する。
export const updatePurchaseOrder = async (storeId, poId, patch) => {
  const poRef = doc(db, 'stores', storeId, 'purchaseOrders', poId);
  const payload = { ...patch, updatedAt: serverTimestamp() };

  if (Array.isArray(patch.lines)) {
    payload.lines = patch.lines.map(normalizePurchaseOrderLine);
    payload.status = patch.status || derivePurchaseOrderStatus(payload.lines);
  }

  await setDoc(poRef, payload, { merge: true });
};

// 発注書ごと取消。未入庫明細を canceled にし、商品側キャッシュも解除する
// （商品が既に別の発注書で発注済みになっている場合は触らない）。
export const cancelPurchaseOrder = async (storeId, purchaseOrder) => {
  const poId = purchaseOrder.id;
  const nextLines = (purchaseOrder.lines || []).map((line) => (
    Number(line.receivedQty || 0) === 0 ? { ...line, canceled: true } : line
  ));

  await setDoc(doc(db, 'stores', storeId, 'purchaseOrders', poId), {
    lines: nextLines,
    status: 'canceled',
    updatedAt: serverTimestamp()
  }, { merge: true });

  await Promise.all(nextLines.filter((line) => line.canceled).map(async (line) => {
    const productRef = doc(db, 'stores', storeId, 'products', line.productId);
    const productSnapshot = await getDoc(productRef);
    if (!productSnapshot.exists()) return;
    if (String(productSnapshot.data().activePoId || '') !== poId) return;

    await setDoc(productRef, {
      orderStatus: null,
      orderedAt: null,
      activePoId: null,
      orderEta: null,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }));
};

// 発注入庫の消し込み。receipts: [{ productId, quantity }] (quantity=今回入庫数)。
// 在庫加算＋監査ログ(stockIns/stockMovements)を商品マスター入庫と同じ形式で記録し、
// 明細の receivedQty を進める。満了した明細は商品側の「発注済み」キャッシュを解除する。
export const receivePurchaseOrderLines = async (storeId, purchaseOrder, receipts) => {
  const validReceipts = (receipts || [])
    .map((receipt) => ({
      productId: String(receipt.productId || ''),
      quantity: Math.max(Number(receipt.quantity || 0), 0)
    }))
    .filter((receipt) => receipt.productId && receipt.quantity > 0);

  if (!validReceipts.length) return;

  // 棚卸し中の入庫は finalizeStocktake の在庫上書きと競合するため弾く（商品マスター入庫と同じ理由）。
  const activeStocktake = await getActiveStocktake(storeId);
  if (activeStocktake) {
    throw new Error('棚卸しが進行中です。棚卸しを確定してから発注入庫を行ってください。');
  }

  const poId = purchaseOrder.id;
  const receivedAtIso = new Date().toISOString();
  const receiptByProductId = new Map(validReceipts.map((receipt) => [receipt.productId, receipt.quantity]));

  const nextLines = (purchaseOrder.lines || []).map((line) => {
    const quantity = receiptByProductId.get(String(line.productId));
    if (!quantity || line.canceled) return line;
    return {
      ...line,
      receivedQty: Number(line.receivedQty || 0) + quantity,
      receivedAt: receivedAtIso
    };
  });

  // 在庫加算と監査ログ。商品ごとに現在庫を読み、加算後の値を products / inventory 両方へ書く。
  for (const receipt of validReceipts) {
    const productRef = doc(db, 'stores', storeId, 'products', receipt.productId);
    const productSnapshot = await getDoc(productRef);
    if (!productSnapshot.exists()) continue;

    const product = productSnapshot.data();
    const beforeQuantity = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
    const afterQuantity = beforeQuantity + receipt.quantity;

    const line = nextLines.find((nextLine) => String(nextLine.productId) === receipt.productId) || null;
    const lineFulfilled = line ? Number(line.receivedQty || 0) >= Number(line.qty || 0) : true;
    const isActivePo = String(product.activePoId || '') === poId;

    const batch = writeBatch(db);
    batch.set(productRef, {
      inventoryQuantity: afterQuantity,
      quantity: afterQuantity,
      lastStockInQuantity: receipt.quantity,
      lastStockInAt: serverTimestamp(),
      ...(isActivePo && lineFulfilled ? {
        orderStatus: null,
        orderedAt: null,
        activePoId: null,
        orderEta: null
      } : {}),
      updatedAt: serverTimestamp()
    }, { merge: true });

    batch.set(doc(db, 'stores', storeId, 'inventory', receipt.productId), {
      productId: receipt.productId,
      quantity: afterQuantity,
      updatedAt: serverTimestamp()
    }, { merge: true });

    const movementPayload = {
      productId: receipt.productId,
      productGroupId: product.productGroupId || product.groupId || '',
      type: 'stock_in',
      quantity: receipt.quantity,
      beforeQuantity,
      afterQuantity,
      note: `発注入庫 (PO: ${poId})`,
      purchaseOrderId: poId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    batch.set(doc(storeCollectionRef(storeId, 'stockIns')), { ...movementPayload, status: 'completed' });
    batch.set(doc(storeCollectionRef(storeId, 'stockMovements')), movementPayload);

    await batch.commit();
  }

  await setDoc(doc(db, 'stores', storeId, 'purchaseOrders', poId), {
    lines: nextLines,
    status: derivePurchaseOrderStatus(nextLines, purchaseOrder.status || 'ordered'),
    updatedAt: serverTimestamp()
  }, { merge: true });
};

// 発注書メール送信。本文は Functions 側が purchaseOrders doc から組み立てて
// 仕入先登録の email へ Resend で送る（任意宛先・任意本文を送れる口にしない）。
export const sendPurchaseOrderEmail = async ({ storeId, purchaseOrderId, idToken }) => {
  const normalizedStoreId = String(storeId || '').trim();
  const normalizedPoId = String(purchaseOrderId || '').trim();
  const token = String(idToken || '').trim();

  if (!normalizedStoreId || !normalizedPoId) {
    throw new Error('発注書メール送信に必要な情報が不足しています。');
  }
  if (!token) {
    throw new Error('ログイン状態を確認してください。');
  }

  const endpoint = `https://asia-northeast1-${firebaseProjectId}.cloudfunctions.net/sendPurchaseOrderEmail`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      storeId: normalizedStoreId,
      purchaseOrderId: normalizedPoId
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || body?.message || '発注書メールの送信に失敗しました。';
    throw new Error(message);
  }

  return body;
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

