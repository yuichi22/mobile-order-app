import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

export const isValidStoreId = (storeId) => Boolean(storeId && typeof storeId === 'string');

const storeCollectionRef = (storeId, collectionName) => collection(db, 'stores', storeId, collectionName);

const stocktakesRef = (storeId) => storeCollectionRef(storeId, 'stocktakes');

const stocktakeDocRef = (storeId, stocktakeId) => doc(db, 'stores', storeId, 'stocktakes', stocktakeId);

const stocktakeItemsRef = (storeId, stocktakeId) => collection(db, 'stores', storeId, 'stocktakes', stocktakeId, 'items');

const stocktakeItemDocRef = (storeId, stocktakeId, productId) => (
  doc(db, 'stores', storeId, 'stocktakes', stocktakeId, 'items', productId)
);

const buildItemBaseFields = (product) => ({
  productId: product.id,
  name: product.name || '',
  sku: product.sku || product.productCode || '',
  barcode: product.barcode || '',
  productGroupName: product.productGroupName || '',
  size: product.size || '',
  colorName: product.colorName || '',
  priceTaxExcluded: product.priceTaxExcluded ?? product.price ?? null,
  priceTaxIncluded: product.priceTaxIncluded ?? null
});

export const getActiveStocktake = async (storeId) => {
  if (!isValidStoreId(storeId)) return null;

  const activeQuery = query(stocktakesRef(storeId), where('status', '==', 'in_progress'));
  const snapshot = await getDocs(activeQuery);

  if (snapshot.empty) return null;

  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
};

export const subscribeToActiveStocktake = (storeId, onData, onError) => {
  if (!isValidStoreId(storeId)) return () => {};

  const activeQuery = query(stocktakesRef(storeId), where('status', '==', 'in_progress'));

  return onSnapshot(activeQuery, (snapshot) => {
    if (snapshot.empty) {
      onData(null);
      return;
    }

    const docSnap = snapshot.docs[0];
    onData({ id: docSnap.id, ...docSnap.data() });
  }, onError);
};

export const startStocktake = async (storeId) => {
  if (!isValidStoreId(storeId)) throw new Error('invalid storeId');

  const existing = await getActiveStocktake(storeId);
  if (existing) return existing.id;

  const docRef = await addDoc(stocktakesRef(storeId), {
    status: 'in_progress',
    startedAt: serverTimestamp(),
    completedAt: null
  });

  return docRef.id;
};

export const subscribeToStocktakeItems = (storeId, stocktakeId, onData, onError) => {
  if (!isValidStoreId(storeId) || !stocktakeId) return () => {};

  return onSnapshot(stocktakeItemsRef(storeId, stocktakeId), (snapshot) => {
    onData(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
  }, onError);
};

export const getStocktakeItem = async (storeId, stocktakeId, productId) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !productId) return null;

  const snapshot = await getDoc(stocktakeItemDocRef(storeId, stocktakeId, productId));
  if (!snapshot.exists()) return null;

  return { id: snapshot.id, ...snapshot.data() };
};

export const findProductByBarcode = async (storeId, barcode) => {
  if (!isValidStoreId(storeId) || !barcode) return null;

  const normalizedBarcode = String(barcode).trim();
  if (!normalizedBarcode) return null;

  const productsQuery = query(
    storeCollectionRef(storeId, 'products'),
    where('barcode', '==', normalizedBarcode)
  );

  const snapshot = await getDocs(productsQuery);
  if (snapshot.empty) return null;

  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
};

// 棚卸しカウントを加算する。location は 'warehouse' | 'storefront'。
// storefront は確定タイミング(storefrontConfirmedAt)をその都度更新し、
// 数え直し済みであれば needsRecount を解除する。
export const recordStocktakeCount = async (storeId, stocktakeId, product, { location, quantity }) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !product?.id) {
    throw new Error('invalid arguments');
  }

  const addQuantity = Math.max(Number(quantity || 0), 0);
  if (addQuantity <= 0) return;

  const itemRef = stocktakeItemDocRef(storeId, stocktakeId, product.id);
  const snapshot = await getDoc(itemRef);
  const current = snapshot.exists() ? snapshot.data() : {};
  const base = buildItemBaseFields(product);

  if (location === 'warehouse') {
    await setDoc(itemRef, {
      ...base,
      warehouseQuantity: increment(addQuantity),
      warehouseCountedAt: serverTimestamp(),
      status: current.status === 'needs_recount' ? 'needs_recount' : 'warehouse_counted',
      createdAt: current.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return;
  }

  if (location === 'storefront') {
    await setDoc(itemRef, {
      ...base,
      storefrontShelfQuantity: increment(addQuantity),
      storefrontConfirmedAt: serverTimestamp(),
      needsRecount: false,
      status: 'storefront_counted',
      createdAt: current.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return;
  }

  throw new Error(`invalid location: ${location}`);
};

// 品出し(倉庫→店頭移動)。
// 店頭が確定済みなら倉庫を減らして店頭バックグラウンド棚数を増やす。
// 店頭が未確定なら倉庫を減らすだけ(カウント時に自然に反映される)。
export const recordWarehouseToStorefrontTransfer = async (storeId, stocktakeId, product, quantity) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !product?.id) {
    throw new Error('invalid arguments');
  }

  const moveQuantity = Math.max(Number(quantity || 0), 0);
  if (moveQuantity <= 0) return;

  const itemRef = stocktakeItemDocRef(storeId, stocktakeId, product.id);
  const snapshot = await getDoc(itemRef);
  const current = snapshot.exists() ? snapshot.data() : {};
  const base = buildItemBaseFields(product);
  const isStorefrontConfirmed = Boolean(current.storefrontConfirmedAt);

  if (isStorefrontConfirmed) {
    await setDoc(itemRef, {
      ...base,
      warehouseQuantity: increment(-moveQuantity),
      storefrontShelfQuantity: increment(moveQuantity),
      transferToStorefront: increment(moveQuantity),
      createdAt: current.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return;
  }

  await setDoc(itemRef, {
    ...base,
    warehouseQuantity: increment(-moveQuantity),
    transferToStorefront: increment(moveQuantity),
    status: current.status || 'pending',
    createdAt: current.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
};

// 売上検知がまだ無いため、スタッフが手動で「もう一度数える」対象に追加できるようにする。
export const addToRecountList = async (storeId, stocktakeId, product) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !product?.id) return;

  const itemRef = stocktakeItemDocRef(storeId, stocktakeId, product.id);
  const snapshot = await getDoc(itemRef);
  if (!snapshot.exists()) return;

  const base = buildItemBaseFields(product);

  await setDoc(itemRef, {
    ...base,
    needsRecount: true,
    status: 'needs_recount',
    updatedAt: serverTimestamp()
  }, { merge: true });
};

export const getStocktakeRecountItems = async (storeId, stocktakeId) => {
  if (!isValidStoreId(storeId) || !stocktakeId) return [];

  const recountQuery = query(stocktakeItemsRef(storeId, stocktakeId), where('needsRecount', '==', true));
  const snapshot = await getDocs(recountQuery);

  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

// 棚卸し終了処理。
// カウント済み商品 = 倉庫数 + 店頭バックグラウンド棚数 を在庫に反映。
// 一度もカウントされなかった商品は在庫を0に更新。
// 反映結果(商品ごとの前後在庫数)を配列で返す(CSV出力用)。
export const finalizeStocktake = async (storeId, stocktakeId) => {
  if (!isValidStoreId(storeId) || !stocktakeId) throw new Error('invalid arguments');

  const itemsSnapshot = await getDocs(stocktakeItemsRef(storeId, stocktakeId));
  const allProductsSnapshot = await getDocs(storeCollectionRef(storeId, 'products'));
  const countedItemIds = new Set(itemsSnapshot.docs.map((docSnap) => docSnap.id));
  const results = [];

  for (const docSnap of itemsSnapshot.docs) {
    const item = docSnap.data();
    const warehouseQuantity = Math.max(Number(item.warehouseQuantity || 0), 0);
    const storefrontQuantity = Math.max(Number(item.storefrontShelfQuantity || 0), 0);
    const finalQuantity = warehouseQuantity + storefrontQuantity;

    const productRef = doc(db, 'stores', storeId, 'products', docSnap.id);
    const productSnap = await getDoc(productRef);
    const productData = productSnap.exists() ? productSnap.data() : {};
    const beforeQuantity = Math.max(Number(productData.inventoryQuantity ?? productData.quantity ?? 0), 0);

    await setDoc(productRef, {
      inventoryQuantity: finalQuantity,
      quantity: finalQuantity,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(
      doc(db, 'stores', storeId, 'inventory', docSnap.id),
      { productId: docSnap.id, quantity: finalQuantity, updatedAt: serverTimestamp() },
      { merge: true }
    );

    results.push({
      productId: docSnap.id,
      name: item.name || productData.name || '',
      sku: item.sku || productData.sku || productData.productCode || '',
      barcode: item.barcode || productData.barcode || '',
      warehouseQuantity,
      storefrontQuantity,
      beforeQuantity,
      finalQuantity
    });
  }

  for (const productDoc of allProductsSnapshot.docs) {
    if (countedItemIds.has(productDoc.id)) continue;

    const productData = productDoc.data();
    const beforeQuantity = Math.max(Number(productData.inventoryQuantity ?? productData.quantity ?? 0), 0);

    if (beforeQuantity === 0) continue;

    await setDoc(doc(db, 'stores', storeId, 'products', productDoc.id), {
      inventoryQuantity: 0,
      quantity: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(
      doc(db, 'stores', storeId, 'inventory', productDoc.id),
      { productId: productDoc.id, quantity: 0, updatedAt: serverTimestamp() },
      { merge: true }
    );

    results.push({
      productId: productDoc.id,
      name: productData.name || '',
      sku: productData.sku || productData.productCode || '',
      barcode: productData.barcode || '',
      warehouseQuantity: 0,
      storefrontQuantity: 0,
      beforeQuantity,
      finalQuantity: 0
    });
  }

  await setDoc(stocktakeDocRef(storeId, stocktakeId), {
    status: 'completed',
    completedAt: serverTimestamp()
  }, { merge: true });

  return results;
};
