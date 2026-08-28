import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
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

const toMillis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

// この棚卸し(startedAt)より後に作成された商品か = 棚卸し中に新規登録された商品か。
// 商品登録と入庫を別保存で行うと itemData.id が既に付くため呼び出し側の id 有無では
// 新規判定できない。商品の createdAt と棚卸しの startedAt の比較で堅牢に判定する。
const wasProductCreatedDuringStocktake = async (storeId, stocktakeId, productId) => {
  try {
    const [stSnap, prodSnap] = await Promise.all([
      getDoc(stocktakeDocRef(storeId, stocktakeId)),
      getDoc(doc(db, 'stores', storeId, 'products', productId))
    ]);
    const startedMs = toMillis(stSnap.data()?.startedAt);
    const createdMs = toMillis(prodSnap.data()?.createdAt);
    if (!startedMs || !createdMs) return false;
    return createdMs >= startedMs;
  } catch (error) {
    console.warn('wasProductCreatedDuringStocktake failed', error);
    return false;
  }
};

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
    // 確定時のカウント値をスナップショットし、確定後の販売累計をリセットする。
    // (現在数 = storefrontConfirmedQuantity - soldDuringStocktake を画面で内訳表示するため)
    const confirmedTotal = Math.max(Number(current.storefrontShelfQuantity || 0), 0) + addQuantity;
    await setDoc(itemRef, {
      ...base,
      storefrontShelfQuantity: increment(addQuantity),
      storefrontConfirmedQuantity: confirmedTotal,
      soldDuringStocktake: 0,
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

// 数え直し(店頭)。入力された実数で storefrontShelfQuantity を「上書き」確定する。
// recordStocktakeCount は加算(増分カウント)用なので流用すると二重計上になるため分離。
// 数え直しリスト(needsRecount=true)の商品は、既存値(確定値から販売分を減算した値)を
// 持っているため、棚を数えた実数で置き換えるのが正しい。
export const recordStocktakeRecount = async (storeId, stocktakeId, product, { quantity }) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !product?.id) {
    throw new Error('invalid arguments');
  }

  const countedQuantity = Math.max(Number(quantity || 0), 0);
  if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
    throw new Error('invalid quantity');
  }

  const itemRef = stocktakeItemDocRef(storeId, stocktakeId, product.id);
  const snapshot = await getDoc(itemRef);
  const current = snapshot.exists() ? snapshot.data() : {};
  const base = buildItemBaseFields(product);

  await setDoc(itemRef, {
    ...base,
    storefrontShelfQuantity: countedQuantity, // 加算ではなく実数で上書き
    storefrontConfirmedQuantity: countedQuantity, // 確定時スナップショット
    soldDuringStocktake: 0, // 確定後の販売累計をリセット
    storefrontConfirmedAt: serverTimestamp(),
    needsRecount: false,
    status: 'storefront_counted',
    createdAt: current.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
};

// 倉庫カウントの上書き訂正。入力された実数で warehouseQuantity を「上書き」する。
// recordStocktakeCount('warehouse') は加算用のため、打ち間違いを直せるよう分離。
export const recordStocktakeWarehouseOverwrite = async (storeId, stocktakeId, product, { quantity }) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !product?.id) {
    throw new Error('invalid arguments');
  }

  const countedQuantity = Math.max(Number(quantity || 0), 0);
  if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
    throw new Error('invalid quantity');
  }

  const itemRef = stocktakeItemDocRef(storeId, stocktakeId, product.id);
  const snapshot = await getDoc(itemRef);
  const current = snapshot.exists() ? snapshot.data() : {};
  const base = buildItemBaseFields(product);

  await setDoc(itemRef, {
    ...base,
    warehouseQuantity: countedQuantity, // 加算ではなく実数で上書き
    warehouseCountedAt: serverTimestamp(),
    // status は recordStocktakeCount('warehouse') と同じ規則で更新(店頭の数え直しフラグは維持)。
    status: current.status === 'needs_recount' ? 'needs_recount' : 'warehouse_counted',
    createdAt: current.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
};

// 棚卸し中の入庫(受け入れ)。
// live在庫には一切触れず、棚卸しの店頭カウントへ反映する。
// 理由: finalizeStocktake が在庫を warehouse+storefront で上書きするため、
//       通常の入庫(live在庫加算)では確定時に消えてしまう。
//
// 分岐は店頭基準・アイテムの storefrontConfirmedAt で自動判定する:
//  - isNewProduct: 入庫数をそのまま店頭確定カウントにする
//      (入庫数 = 確定在庫)。
//  - 既存 & 店頭確定済み(storefrontConfirmedAt あり):
//      storefrontShelfQuantity に加算し、確定を維持(recountは立てない)。
//  - 既存 & 未確定(item 無し / storefrontConfirmedAt 無し):
//      数量は加えず店頭数え直しリストに載せる(needsRecount=true)。
//      後で棚を数えれば物理的に入庫分が含まれるため。
// 倉庫分は従来どおり recordStocktakeCount('warehouse') を使う。
// 監査ログは通常入庫と同様 stockIns / stockMovements に必ず記録する。
export const recordStocktakeStockIn = async (
  storeId,
  stocktakeId,
  product,
  { quantity, isNewProduct = false } = {}
) => {
  if (!isValidStoreId(storeId) || !stocktakeId || !product?.id) {
    throw new Error('invalid arguments');
  }

  const addQuantity = Math.max(Number(quantity || 0), 0);
  if (addQuantity <= 0) return { mode: 'none', quantityApplied: 0 };

  const itemRef = stocktakeItemDocRef(storeId, stocktakeId, product.id);
  const snapshot = await getDoc(itemRef);
  const current = snapshot.exists() ? snapshot.data() : {};
  const base = buildItemBaseFields(product);

  const isStorefrontConfirmed = Boolean(current.storefrontConfirmedAt);

  // 新規判定: 呼び出し側の明示フラグ、または「この棚卸し開始後に登録された商品」なら新規扱い。
  // (登録と入庫が別保存だと呼び出し側の isNewProduct は false になるため createdAt で補完する)
  let isNew = isNewProduct;
  if (!isNew && !isStorefrontConfirmed) {
    isNew = await wasProductCreatedDuringStocktake(storeId, stocktakeId, product.id);
  }

  let mode;
  let quantityApplied;

  if (isNew || isStorefrontConfirmed) {
    // 新規商品 = 入庫数がそのまま確定在庫。
    // 既存確定済み = 確定カウントに入庫分を上乗せ(確定は維持)。
    const confirmedTotal = Math.max(Number(current.storefrontShelfQuantity || 0), 0) + addQuantity;
    await setDoc(itemRef, {
      ...base,
      storefrontShelfQuantity: increment(addQuantity),
      storefrontConfirmedQuantity: confirmedTotal,
      soldDuringStocktake: 0,
      storefrontConfirmedAt: serverTimestamp(),
      needsRecount: false,
      status: 'storefront_counted',
      createdAt: current.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    mode = isNew ? 'new_product_confirmed' : 'storefront_confirmed';
    quantityApplied = addQuantity;
  } else {
    // 既存・未確定: 数量は加えず数え直しリストへ載せるだけ。
    await setDoc(itemRef, {
      ...base,
      needsRecount: true,
      status: 'needs_recount',
      createdAt: current.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    mode = 'needs_recount';
    quantityApplied = 0;
  }

  // 監査ログ(live在庫は触らないが、入庫の事実は必ず残す)。
  const movementPayload = {
    productId: product.id,
    productGroupId: product.productGroupId || product.groupId || '',
    type: 'stock_in',
    quantity: addQuantity,
    note: '棚卸し中入庫',
    stocktakeId,
    stocktakeStockIn: true,
    stocktakeStockInMode: mode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await addDoc(storeCollectionRef(storeId, 'stockIns'), {
    ...movementPayload,
    status: 'completed'
  });

  await addDoc(storeCollectionRef(storeId, 'stockMovements'), movementPayload);

  return { mode, quantityApplied };
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

  // 倉庫でカウントしていない商品への出庫は受け付けない。
  const isWarehouseCounted = Boolean(current.warehouseCountedAt);
  if (!isWarehouseCounted) {
    throw new Error('warehouse_not_counted');
  }

  // 出庫数が倉庫カウント済み数(出庫済み分を差し引いた残り)を超えていたら弾く。
  const warehouseQuantity = Number(current.warehouseQuantity || 0);
  if (moveQuantity > warehouseQuantity) {
    throw new Error('transfer_exceeds_warehouse');
  }

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

// 販売(POS会計/EC)時に、進行中棚卸しの店頭カウントへ販売分を反映する。
// 店頭確定済み(storefrontConfirmedAt あり)の商品のみ対象:
//   - storefrontShelfQuantity を販売数だけ減算してカウントを最新に保つ
//   - 確定から recountWindowMs(既定1時間)以内の販売なら needsRecount=true(数え直しリスト入り)
// soldItems: [{ productId, quantity }]
export const applyStocktakeSaleAdjustment = async (
  storeId,
  stocktakeId,
  soldItems = [],
  { recountWindowMs = 60 * 60 * 1000 } = {}
) => {
  const result = { adjusted: 0, flaggedForRecount: 0 };
  if (!isValidStoreId(storeId) || !stocktakeId || !Array.isArray(soldItems)) return result;

  for (const sold of soldItems) {
    const productId = String(sold?.productId || '').trim();
    const quantity = Math.max(Number(sold?.quantity || 0), 0);
    if (!productId || quantity <= 0) continue;

    const itemRef = stocktakeItemDocRef(storeId, stocktakeId, productId);
    const snapshot = await getDoc(itemRef);
    if (!snapshot.exists()) continue; // 未カウント商品は対象外
    const current = snapshot.data();
    if (!current.storefrontConfirmedAt) continue; // 店頭未確定は対象外

    const confirmedMs = typeof current.storefrontConfirmedAt?.toMillis === 'function'
      ? current.storefrontConfirmedAt.toMillis()
      : 0;
    const withinWindow = confirmedMs > 0 && (Date.now() - confirmedMs) <= recountWindowMs;

    const patch = {
      storefrontShelfQuantity: increment(-quantity),
      soldDuringStocktake: increment(quantity), // 確定後の販売累計(内訳表示用)
      updatedAt: serverTimestamp()
    };
    if (withinWindow) {
      patch.needsRecount = true;
      patch.status = 'needs_recount';
      result.flaggedForRecount += 1;
    }

    await setDoc(itemRef, patch, { merge: true });
    result.adjusted += 1;
  }

  return result;
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
// 大規模店(数万商品)でも実用的になるよう writeBatch でまとめ書きし、
// onProgress(done, total) で進捗を通知する(per-item getDoc はせず全商品スナップから引く)。
export const finalizeStocktake = async (storeId, stocktakeId, onProgress) => {
  if (!isValidStoreId(storeId) || !stocktakeId) throw new Error('invalid arguments');

  const reportProgress = (done, total) => {
    if (typeof onProgress === 'function') onProgress(done, total);
  };

  const itemsSnapshot = await getDocs(stocktakeItemsRef(storeId, stocktakeId));
  const allProductsSnapshot = await getDocs(storeCollectionRef(storeId, 'products'));
  const countedItemIds = new Set(itemsSnapshot.docs.map((docSnap) => docSnap.id));
  // 商品データは全商品スナップから引く(per-item getDoc を排除)。
  const productMap = new Map(allProductsSnapshot.docs.map((docSnap) => [docSnap.id, docSnap.data()]));
  const results = [];

  // 書き込み対象を組み立てる(カウント済み + 未カウントで在庫>0)。
  const tasks = [];
  for (const docSnap of itemsSnapshot.docs) {
    const item = docSnap.data();
    const warehouseQuantity = Math.max(Number(item.warehouseQuantity || 0), 0);
    const storefrontQuantity = Math.max(Number(item.storefrontShelfQuantity || 0), 0);
    tasks.push({ productId: docSnap.id, item, warehouseQuantity, storefrontQuantity, finalQuantity: warehouseQuantity + storefrontQuantity });
  }
  for (const productDoc of allProductsSnapshot.docs) {
    if (countedItemIds.has(productDoc.id)) continue;
    const productData = productDoc.data();
    // 正・負どちらも 0 にそろえる(マイナス在庫の自動修正を含む)。0 のままは書き込み不要。
    const rawBefore = Number(productData.inventoryQuantity ?? productData.quantity ?? 0);
    if (rawBefore === 0) continue;
    tasks.push({ productId: productDoc.id, item: null, warehouseQuantity: 0, storefrontQuantity: 0, finalQuantity: 0 });
  }

  const total = tasks.length;
  reportProgress(0, total);

  const MAX_OPS = 480; // Firestore batch 上限500。1商品=2書き込み。
  let batch = writeBatch(db);
  let ops = 0;
  let processed = 0;

  for (const task of tasks) {
    const productData = productMap.get(task.productId) || {};
    // 生の値(マイナスも含む)。Shopify push の変更判定(before≠final)で負→0を拾うため。
    const beforeQuantity = Number(productData.inventoryQuantity ?? productData.quantity ?? 0);

    batch.set(doc(db, 'stores', storeId, 'products', task.productId), {
      inventoryQuantity: task.finalQuantity,
      quantity: task.finalQuantity,
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, 'stores', storeId, 'inventory', task.productId), {
      productId: task.productId,
      quantity: task.finalQuantity,
      updatedAt: serverTimestamp()
    }, { merge: true });
    ops += 2;

    results.push({
      productId: task.productId,
      name: task.item?.name || productData.name || '',
      sku: task.item?.sku || productData.sku || productData.productCode || '',
      barcode: task.item?.barcode || productData.barcode || '',
      warehouseQuantity: task.warehouseQuantity,
      storefrontQuantity: task.storefrontQuantity,
      storefrontConfirmedQuantity: task.item?.storefrontConfirmedQuantity != null
        ? Math.max(Number(task.item.storefrontConfirmedQuantity), 0)
        : null,
      // 販売数は「確定数 − 現在の店頭数」で導出(集計フィールド非依存)。
      soldDuringStocktake: task.item?.storefrontConfirmedQuantity != null
        ? Math.max(Math.max(Number(task.item.storefrontConfirmedQuantity), 0) - task.storefrontQuantity, 0)
        : 0,
      beforeQuantity,
      finalQuantity: task.finalQuantity
    });

    processed += 1;

    if (ops >= MAX_OPS) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
      reportProgress(processed, total);
    }
  }

  if (ops > 0) await batch.commit();
  reportProgress(processed, total);

  await setDoc(stocktakeDocRef(storeId, stocktakeId), {
    status: 'completed',
    completedAt: serverTimestamp()
  }, { merge: true });

  return results;
};

// マイナス在庫(inventoryQuantity<0)の商品をすべて0に修正する。
// 棚卸しと無関係にいつでも実行できるメンテナンス用。修正した productId 配列を返す
// (Shopify push 用)。
export const zeroNegativeInventory = async (storeId) => {
  if (!isValidStoreId(storeId)) throw new Error('invalid storeId');

  const negQuery = query(storeCollectionRef(storeId, 'products'), where('inventoryQuantity', '<', 0));
  const snapshot = await getDocs(negQuery);
  const fixedIds = snapshot.docs.map((docSnap) => docSnap.id);
  if (fixedIds.length === 0) return [];

  let batch = writeBatch(db);
  let ops = 0;
  for (const docSnap of snapshot.docs) {
    batch.set(doc(db, 'stores', storeId, 'products', docSnap.id), {
      inventoryQuantity: 0, quantity: 0, updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, 'stores', storeId, 'inventory', docSnap.id), {
      productId: docSnap.id, quantity: 0, updatedAt: serverTimestamp()
    }, { merge: true });
    ops += 2;
    if (ops >= 480) { await batch.commit(); batch = writeBatch(db); ops = 0; }
  }
  if (ops > 0) await batch.commit();

  return fixedIds;
};

// 完了した棚卸しの一覧(完了日の新しい順)。
export const getCompletedStocktakes = async (storeId) => {
  if (!isValidStoreId(storeId)) return [];
  const snapshot = await getDocs(query(stocktakesRef(storeId), where('status', '==', 'completed')));
  return snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));
};

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const positiveRate = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 完了棚卸しの「売り場別 在高(上代/原価)集計」を算出する(棚卸し完了日時点の数量を使用)。
// 数量=warehouse+storefront、上代=アイテムのスナップ売価、原価=掛け率連鎖
// (商品原価 > 商品掛け率 > ブランド > 仕入先 > 売り場)。原価未解決の商品は0扱いで件数を返す。
// taxMode: 'excluded'(税抜, 既定) | 'included'(税込)。
export const computeStocktakeValuation = async (storeId, stocktakeId, { taxMode = 'excluded' } = {}) => {
  if (!isValidStoreId(storeId) || !stocktakeId) throw new Error('invalid arguments');

  const itemsSnapshot = await getDocs(stocktakeItemsRef(storeId, stocktakeId));
  const items = itemsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

  // カウント済み商品だけ取得(documentId in, 30件ずつ並列)。
  const productMap = new Map();
  await Promise.all(chunkArray(items.map((it) => it.id), 30).map(async (idsChunk) => {
    if (idsChunk.length === 0) return;
    const snap = await getDocs(query(storeCollectionRef(storeId, 'products'), where(documentId(), 'in', idsChunk)));
    snap.docs.forEach((d) => productMap.set(d.id, d.data()));
  }));

  const [brandsSnap, suppliersSnap, areasSnap] = await Promise.all([
    getDocs(storeCollectionRef(storeId, 'brands')),
    getDocs(storeCollectionRef(storeId, 'suppliers')),
    getDocs(storeCollectionRef(storeId, 'productSalesAreas'))
  ]);
  const brandMap = new Map(brandsSnap.docs.map((d) => [d.id, d.data()]));
  const supplierMap = new Map(suppliersSnap.docs.map((d) => [d.id, d.data()]));
  const areaNameMap = new Map(areasSnap.docs.map((d) => [d.id, d.data().name || d.id]));
  const areaRateMap = new Map(areasSnap.docs.map((d) => [d.id, positiveRate(d.data().defaultCostRate)]));

  const priceField = taxMode === 'included' ? 'priceTaxIncluded' : 'priceTaxExcluded';
  const costField = taxMode === 'included' ? 'costTaxIncluded' : 'costTaxExcluded';

  const resolveUnitCost = (product, unitPrice) => {
    const direct = Number(product[costField]);
    if (Number.isFinite(direct) && direct > 0) return { cost: direct, has: true };
    const brand = product.brandId ? brandMap.get(String(product.brandId)) : null;
    const supplier = brand?.supplierId ? supplierMap.get(String(brand.supplierId)) : null;
    let rate = positiveRate(product.supplierCostRate)
      ?? positiveRate(brand?.defaultCostRate)
      ?? positiveRate(supplier?.defaultCostRate);
    if (rate == null && product.salesAreaId) rate = areaRateMap.get(String(product.salesAreaId)) ?? null;
    if (rate != null && Number.isFinite(unitPrice)) return { cost: unitPrice * Math.min(100, rate) / 100, has: true };
    return { cost: 0, has: false };
  };

  const areaAgg = new Map();
  let totalRetail = 0;
  let totalCost = 0;
  let totalQty = 0;
  let totalNoCost = 0;

  for (const it of items) {
    const qty = Math.max(Number(it.warehouseQuantity || 0) + Number(it.storefrontShelfQuantity || 0), 0);
    if (qty <= 0) continue; // マイナス在庫は在高に含めない
    const product = productMap.get(it.id) || {};
    const unitPrice = Number(it[priceField] ?? product[priceField] ?? 0) || 0;
    const areaId = String(product.salesAreaId || 'salesarea_999');
    const areaName = areaNameMap.get(areaId) || product.salesAreaName || '未設定';
    const { cost, has } = resolveUnitCost(product, unitPrice);

    if (!areaAgg.has(areaId)) areaAgg.set(areaId, { areaId, name: areaName, qty: 0, retail: 0, cost: 0, noCostItems: 0 });
    const agg = areaAgg.get(areaId);
    agg.qty += qty;
    agg.retail += unitPrice * qty;
    agg.cost += cost * qty;
    if (!has) agg.noCostItems += 1;

    totalRetail += unitPrice * qty;
    totalCost += cost * qty;
    totalQty += qty;
    if (!has) totalNoCost += 1;
  }

  return {
    taxMode,
    areas: [...areaAgg.values()].sort((a, b) => b.retail - a.retail),
    total: { qty: totalQty, retail: totalRetail, cost: totalCost, noCostItems: totalNoCost },
    itemCount: items.length
  };
};
