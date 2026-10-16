/**
 * 入庫ロット原価(先入先出)。
 *
 * 目的: 原価・掛け率を変えたとき「変更前に入庫した在庫」は変更前の原価で、「変更後に入庫した在庫」は
 *       変更後の原価で売上に載せる。売上明細に実際に消化したロットの原価を持たせ、粗利・原価率の根拠にする。
 *
 * データ:
 *   stores/{s}/products/{p}/costLayers/{layerId}   1入庫=1ロット
 *     { quantity, remainingQuantity, unitCostTaxIncluded, unitCostTaxExcluded, costSource, costRate,
 *       receivedAt, stockInId, purchaseOrderId, note }
 *   stores/{s}/costLayerProducts/{p}               { openQuantity } ロット残の合計(棚卸し確定時の対象抽出用)
 *   stores/{s}/costLayerAllocations/{txId}         取引ごとの消化記録(冪等・取消戻しの根拠)
 *     { allocations: [{ productId, layerId|null, quantity, unitCostTaxIncluded, unitCostTaxExcluded, costSource }],
 *       fallbackUnitCosts: { [productId]: { unitCostTaxIncluded, unitCostTaxExcluded, costSource } } }
 *
 * 流れ:
 *   - stockIns 作成(発注入庫・商品マスター入庫・棚卸し中入庫) → その時点の原価(商品原価>商品掛け率>ブランド>仕入先>売り場)でロットを作る。
 *   - transactions 作成/更新 → retail 明細の「売れたまま(返品・取消で在庫へ戻していない)」数量と消化記録の差分だけ
 *     古いロットから消化(増)/最後に消化した分から戻す(減)。明細の原価を消化ロットで書き直す。
 *     ロットが足りない分(在庫マイナス・ロットなし)は会計時の原価(無ければ現在の掛け率連鎖)で埋め、layerId=null で残す。
 *   - 在庫を絶対値で合わせた時(在庫調整の減少・Shopifyリコンサイルの減少・棚卸し確定) → ロット残が在庫を超える分を古い順に落とす。
 *     在庫が増える調整・CSV・Shopify は入庫ロットを作らない(ロットなし=上の不足分と同じ扱い)。
 *
 * ⚠ 会計(PosMain/PosRegister)のバッチには読み取りを足さない(2026-08-14 会計失敗事故)。ここで後追いする。
 * ⚠ この機能より前に作られた取引(消化記録なし)は、後から取消されてもロットへは戻さない(遡って消化しない)。
 */
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const REGION = 'asia-northeast1';
const DB_ID = 'main';
if (!getApps().length) initializeApp();
const getDb = () => getFirestore(DB_ID);

const toNum = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const pickRate = (value) => {
  const n = toNum(value);
  return n !== null && n > 0 ? n : null;
};
const normalizeProductId = (value) => String(value || '').replace(/^product:/, '');
const isRetailItem = (item) => item && item.sourceType === 'retail' && normalizeProductId(item.productId || item.id);

// 現在の原価(1個あたり)。会計時の掛け率連鎖(PosMain.resolveItemCost)と同じ優先順。
// 戻り値 null = 原価を決められない(原価未設定)。
export const resolveCurrentUnitCost = async (storeRef, product = {}) => {
  const taxRate = toNum(product.taxRate) ?? 10;
  const costIncl = toNum(product.costTaxIncluded);
  const costExcl = toNum(product.costTaxExcluded);
  if (costIncl !== null || costExcl !== null) {
    return {
      unitCostTaxIncluded: costIncl ?? Math.round(costExcl * (1 + taxRate / 100)),
      unitCostTaxExcluded: costExcl ?? Math.round(costIncl / (1 + taxRate / 100)),
      costSource: 'product_cost',
      costRate: null
    };
  }

  let rate = pickRate(product.supplierCostRate);
  let source = rate !== null ? 'product_rate' : null;
  if (rate === null && product.brandId) {
    const brandSnap = await storeRef.collection('brands').doc(String(product.brandId)).get();
    const brand = brandSnap.exists ? brandSnap.data() : null;
    rate = pickRate(brand?.defaultCostRate);
    if (rate !== null) source = 'brand_rate';
    if (rate === null && brand?.supplierId) {
      const supplierSnap = await storeRef.collection('suppliers').doc(String(brand.supplierId)).get();
      rate = pickRate(supplierSnap.exists ? supplierSnap.data()?.defaultCostRate : null);
      if (rate !== null) source = 'supplier_rate';
    }
  }
  if (rate === null && product.salesAreaId) {
    const areaSnap = await storeRef.collection('productSalesAreas').doc(String(product.salesAreaId)).get();
    rate = pickRate(areaSnap.exists ? areaSnap.data()?.costRate : null);
    if (rate !== null) source = 'sales_area_rate';
  }
  if (rate === null) return null;

  const priceIncl = toNum(product.priceTaxIncluded) ?? toNum(product.price) ?? 0;
  const priceExcl = toNum(product.priceTaxExcluded) ?? Math.round(priceIncl / (1 + taxRate / 100));
  const fraction = Math.min(rate, 100) / 100;
  return {
    unitCostTaxIncluded: Math.round(priceIncl * fraction),
    unitCostTaxExcluded: Math.round(priceExcl * fraction),
    costSource: source,
    costRate: rate
  };
};

const layerTime = (layer) => {
  const t = layer.receivedAt;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
};

// トランザクション内でロット残(>0)を古い順に読む。
const readOpenLayers = async (tx, storeRef, productId) => {
  const snap = await tx.get(
    storeRef.collection('products').doc(productId).collection('costLayers').where('remainingQuantity', '>', 0)
  );
  return snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .sort((a, b) => layerTime(a) - layerTime(b) || a.id.localeCompare(b.id));
};

// 取引で「売れたまま」の数量(商品別)。返品・取消で在庫に戻したぶんは除く(在庫を戻さない返品は残す)。
export const computeSoldQuantities = (txn = {}) => {
  const result = new Map();
  if (txn.isReversal === true || txn.reversalOf || txn.isMethodAdjustment === true) return result;
  const cancellations = Array.isArray(txn.cancellations) ? txn.cancellations : [];
  // 無会計退店の無効化は、明細を残したまま在庫を全数戻している。
  if (cancellations.some((log) => log?.source === 'abort_session')) return result;

  const add = (productId, qty) => {
    if (!productId || !qty) return;
    result.set(productId, (result.get(productId) || 0) + qty);
  };
  const items = Array.isArray(txn.items) ? txn.items : [];
  items.forEach((item) => {
    if (isRetailItem(item)) add(normalizeProductId(item.productId || item.id), Math.max(Number(item.quantity) || 0, 0));
  });
  // 当日のその場減額は明細から数量を引いている → 元の販売数へ足し戻し、在庫へ戻したぶんだけ引く。
  cancellations.forEach((log) => {
    (Array.isArray(log?.items) ? log.items : []).forEach((entry) => {
      if (entry?.sourceType !== 'retail') return;
      const productId = normalizeProductId(entry.productId);
      const qty = Math.max(Number(entry.quantity) || 0, 0);
      if (entry.stockRestored === false) add(productId, qty);
    });
  });
  // 締め後の反対仕訳は元明細を変えない → 在庫へ戻したぶんだけ引く。
  (Array.isArray(txn.reversalEntries) ? txn.reversalEntries : []).forEach((entry) => {
    if (entry?.stockRestored === false) return;
    const item = items[Number(entry?.itemIndex)];
    if (!isRetailItem(item)) return;
    add(normalizeProductId(item.productId || item.id), -Math.abs(Number(entry.quantity) || 0));
  });
  result.forEach((qty, productId) => {
    if (qty <= 0) result.delete(productId);
  });
  return result;
};

// 明細の原価を消化記録から作り直す。同一商品の明細が複数あれば明細順に古いロットから割り当てる。
export const buildCostedItems = (items = [], allocations = []) => {
  const queues = new Map();
  allocations.forEach((a) => {
    if (!queues.has(a.productId)) queues.set(a.productId, []);
    queues.get(a.productId).push({ ...a });
  });
  let changed = false;
  const nextItems = items.map((item) => {
    if (!isRetailItem(item)) return item;
    const queue = queues.get(normalizeProductId(item.productId || item.id));
    let need = Math.max(Number(item.quantity) || 0, 0);
    if (!queue || need <= 0) return item;
    const parts = [];
    while (need > 0 && queue.length) {
      const head = queue[0];
      const take = Math.min(head.quantity, need);
      parts.push({ ...head, quantity: take });
      head.quantity -= take;
      need -= take;
      if (head.quantity <= 0) queue.shift();
    }
    if (need > 0 || parts.some((p) => p.unitCostTaxIncluded === null || p.unitCostTaxIncluded === undefined)) {
      return item; // 原価を決められない分がある → 会計時の原価のまま
    }
    const costIncl = parts.reduce((s, p) => s + p.unitCostTaxIncluded * p.quantity, 0);
    const costExcl = parts.reduce((s, p) => s + p.unitCostTaxExcluded * p.quantity, 0);
    const qty = Math.max(Number(item.quantity) || 0, 1);
    const salesIncl = toNum(item.salesTaxIncludedAmount);
    const salesExcl = toNum(item.salesTaxExcludedAmount);
    const exact = parts.every((p) => p.costSource === 'product_cost');
    const next = {
      ...item,
      costPrice: Math.round(costIncl / qty),
      costRate: null,
      costSource: exact ? 'stock_layer' : 'stock_layer_estimated',
      costTaxIncludedAmount: costIncl,
      costTaxExcludedAmount: costExcl,
      ...(salesIncl !== null ? { grossProfitTaxIncluded: salesIncl - costIncl } : {}),
      ...(salesExcl !== null ? { grossProfitTaxExcluded: salesExcl - costExcl } : {}),
      costLayers: parts.map((p) => ({
        layerId: p.layerId,
        quantity: p.quantity,
        unitCostTaxIncluded: p.unitCostTaxIncluded,
        unitCostTaxExcluded: p.unitCostTaxExcluded
      }))
    };
    if (JSON.stringify(next) !== JSON.stringify(item)) changed = true;
    return next;
  });
  return { items: nextItems, changed };
};

// 会計時に明細へ保存された原価(1個あたり)。ロット不足分の穴埋めに使う(=売れた時点の原価)。
const checkoutUnitCostOf = (items, productId) => {
  const item = items.find((it) => isRetailItem(it) && normalizeProductId(it.productId || it.id) === productId);
  const qty = Number(item?.quantity) || 0;
  const incl = toNum(item?.costTaxIncludedAmount);
  if (!item || qty <= 0 || incl === null) return null;
  const excl = toNum(item.costTaxExcludedAmount) ?? incl;
  return {
    unitCostTaxIncluded: Math.round(incl / qty),
    unitCostTaxExcluded: Math.round(excl / qty),
    costSource: item.costSource || 'checkout'
  };
};

const bumpOpenQuantity = (tx, storeRef, productId, delta) => {
  if (!delta) return;
  tx.set(storeRef.collection('costLayerProducts').doc(productId), {
    openQuantity: FieldValue.increment(delta),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
};

// 入庫 → ロット作成。stockIns の doc ID をロットIDにして二重起動でも1件にする。
export const createCostLayerOnStockIn = onDocumentCreated(
  { region: REGION, database: DB_ID, document: 'stores/{storeId}/stockIns/{stockInId}' },
  async (event) => {
    const data = event.data?.data() || {};
    const { storeId, stockInId } = event.params;
    const productId = normalizeProductId(data.productId);
    const quantity = Math.max(Number(data.quantity) || 0, 0);
    if (!productId || quantity <= 0) return;

    const db = getDb();
    const storeRef = db.collection('stores').doc(storeId);
    const productRef = storeRef.collection('products').doc(productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) return;
    const product = productSnap.data() || {};
    if (product.inventoryUnmanaged) return;
    const unitCost = await resolveCurrentUnitCost(storeRef, product);

    const layerRef = productRef.collection('costLayers').doc(stockInId);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(layerRef);
      if (existing.exists) return;
      tx.set(layerRef, {
        productId,
        quantity,
        remainingQuantity: quantity,
        unitCostTaxIncluded: unitCost?.unitCostTaxIncluded ?? null,
        unitCostTaxExcluded: unitCost?.unitCostTaxExcluded ?? null,
        costSource: unitCost?.costSource ?? null,
        costRate: unitCost?.costRate ?? null,
        receivedAt: data.createdAt || FieldValue.serverTimestamp(),
        stockInId,
        purchaseOrderId: data.purchaseOrderId || null,
        note: data.note || '',
        createdAt: FieldValue.serverTimestamp()
      });
      bumpOpenQuantity(tx, storeRef, productId, quantity);
    });
  }
);

// 売上 → ロット消化(差分)。取消/返品で在庫へ戻したぶんは最後に消化したロットへ戻す。
export const allocateTransactionCostLayers = onDocumentWritten(
  { region: REGION, database: DB_ID, document: 'stores/{storeId}/transactions/{transactionId}' },
  async (event) => {
    const { storeId, transactionId } = event.params;
    const isCreate = !event.data?.before?.exists;
    const db = getDb();
    const storeRef = db.collection('stores').doc(storeId);
    const txnRef = storeRef.collection('transactions').doc(transactionId);
    const ledgerRef = storeRef.collection('costLayerAllocations').doc(transactionId);

    await db.runTransaction(async (tx) => {
      const ledgerSnap = await tx.get(ledgerRef);
      // この機能より前の取引は対象外(作成イベントで記録を始めたものだけ追う)。
      if (!ledgerSnap.exists && !isCreate) return;
      const txnSnap = await tx.get(txnRef);
      const txn = txnSnap.exists ? txnSnap.data() : {};
      const items = Array.isArray(txn.items) ? txn.items : [];

      const target = txnSnap.exists ? computeSoldQuantities(txn) : new Map();
      const ledger = ledgerSnap.exists ? ledgerSnap.data() : { allocations: [], fallbackUnitCosts: {} };
      if (!ledgerSnap.exists && target.size === 0) return; // retail の無い取引は記録しない

      const allocations = Array.isArray(ledger.allocations) ? ledger.allocations.map((a) => ({ ...a })) : [];
      const fallbackUnitCosts = { ...(ledger.fallbackUnitCosts || {}) };
      if (!ledgerSnap.exists) {
        // 初回: 会計時に明細へ保存された原価(=売れた時点の原価)を控えておく。後で明細を書き直しても残る。
        target.forEach((_, productId) => {
          const unit = checkoutUnitCostOf(items, productId);
          if (unit) fallbackUnitCosts[productId] = unit;
        });
      }
      const currentByProduct = new Map();
      allocations.forEach((a) => currentByProduct.set(a.productId, (currentByProduct.get(a.productId) || 0) + a.quantity));

      const productIds = new Set([...target.keys(), ...currentByProduct.keys()]);
      const deltas = [...productIds]
        .map((productId) => ({ productId, delta: (target.get(productId) || 0) - (currentByProduct.get(productId) || 0) }))
        .filter((d) => d.delta !== 0);

      // ---- 読み取り(トランザクションは読み→書きの順) ----
      const productSnaps = new Map();
      const openLayers = new Map();
      const layerSnaps = new Map();
      for (const { productId, delta } of deltas) {
        const productSnap = await tx.get(storeRef.collection('products').doc(productId));
        productSnaps.set(productId, productSnap);
        if (delta > 0) {
          openLayers.set(productId, await readOpenLayers(tx, storeRef, productId));
        } else {
          for (const a of allocations) {
            if (a.productId !== productId || !a.layerId || layerSnaps.has(`${productId}/${a.layerId}`)) continue;
            const ref = storeRef.collection('products').doc(productId).collection('costLayers').doc(a.layerId);
            layerSnaps.set(`${productId}/${a.layerId}`, await tx.get(ref));
          }
        }
      }

      // ---- 計算 ----
      const layerRemaining = new Map(); // ref.path -> { ref, before, remaining, productId }
      const setRemaining = (ref, before, remaining, productId) => {
        const prev = layerRemaining.get(ref.path);
        layerRemaining.set(ref.path, { ref, before: prev ? prev.before : before, remaining, productId });
      };
      for (const { productId, delta } of deltas) {
        const product = productSnaps.get(productId)?.data() || {};
        if (delta > 0) {
          if (product.inventoryUnmanaged) continue; // 在庫を持たない商品は会計時の原価のまま
          let need = delta;
          for (const layer of openLayers.get(productId) || []) {
            if (need <= 0) break;
            const take = Math.min(Number(layer.remainingQuantity) || 0, need);
            if (take <= 0) continue;
            setRemaining(layer.ref, Number(layer.remainingQuantity) || 0, Number(layer.remainingQuantity) - take, productId);
            allocations.push({
              productId,
              layerId: layer.id,
              quantity: take,
              unitCostTaxIncluded: layer.unitCostTaxIncluded ?? null,
              unitCostTaxExcluded: layer.unitCostTaxExcluded ?? null,
              costSource: layer.costSource ?? null
            });
            need -= take;
          }
          if (need > 0) {
            // ロット不足: 売れた時点(会計時)の原価で埋める。無ければ現在の掛け率連鎖。
            if (!fallbackUnitCosts[productId]) {
              fallbackUnitCosts[productId] = await resolveCurrentUnitCost(storeRef, product)
                || { unitCostTaxIncluded: null, unitCostTaxExcluded: null, costSource: null };
            }
            const fb = fallbackUnitCosts[productId];
            allocations.push({
              productId,
              layerId: null,
              quantity: need,
              unitCostTaxIncluded: fb.unitCostTaxIncluded ?? null,
              unitCostTaxExcluded: fb.unitCostTaxExcluded ?? null,
              costSource: fb.costSource ?? null
            });
          }
        } else {
          // 戻し: 最後に消化した分から戻す。
          let give = -delta;
          for (let i = allocations.length - 1; i >= 0 && give > 0; i -= 1) {
            const a = allocations[i];
            if (a.productId !== productId) continue;
            const back = Math.min(a.quantity, give);
            if (a.layerId) {
              const snap = layerSnaps.get(`${productId}/${a.layerId}`);
              if (snap?.exists) {
                const stored = Number(snap.data().remainingQuantity) || 0;
                const prev = layerRemaining.has(snap.ref.path) ? layerRemaining.get(snap.ref.path).remaining : stored;
                setRemaining(snap.ref, stored, prev + back, productId);
              }
            }
            a.quantity -= back;
            give -= back;
            if (a.quantity <= 0) allocations.splice(i, 1);
          }
        }
      }

      // ---- 書き込み ----
      const openDelta = new Map();
      layerRemaining.forEach(({ ref, before, remaining, productId }) => {
        tx.update(ref, { remainingQuantity: remaining, updatedAt: FieldValue.serverTimestamp() });
        openDelta.set(productId, (openDelta.get(productId) || 0) + (remaining - before));
      });
      openDelta.forEach((delta, productId) => bumpOpenQuantity(tx, storeRef, productId, delta));

      if (deltas.length > 0 || !ledgerSnap.exists) {
        tx.set(ledgerRef, {
          transactionId,
          allocations,
          fallbackUnitCosts,
          updatedAt: FieldValue.serverTimestamp(),
          ...(ledgerSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
        }, { merge: true });
      }

      if (txnSnap.exists) {
        const { items: nextItems, changed } = buildCostedItems(items, allocations);
        if (changed) tx.update(txnRef, { items: nextItems });
      }
    });
  }
);

// 在庫を絶対値で合わせた結果、ロット残が在庫を超えたら古い順に落とす(ロス・EC販売などで消えた分)。
// snapshotItemRef(棚卸し明細)を渡すと、落とした後のロット残を明細の costLayerSnapshot に控える(在高レポートの根拠)。
const trimLayersToInventory = async (storeRef, productId, { snapshotItemRef = null } = {}) => {
  const db = getDb();
  await db.runTransaction(async (tx) => {
    const productSnap = await tx.get(storeRef.collection('products').doc(productId));
    if (!productSnap.exists) return;
    const itemSnap = snapshotItemRef ? await tx.get(snapshotItemRef) : null;
    const product = productSnap.data() || {};
    const inventory = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
    const layers = await readOpenLayers(tx, storeRef, productId);
    let excess = layers.reduce((s, l) => s + (Number(l.remainingQuantity) || 0), 0) - inventory;
    let trimmed = 0;
    for (const layer of layers) {
      if (excess <= 0) break;
      const cut = Math.min(Number(layer.remainingQuantity) || 0, excess);
      layer.remainingQuantity = (Number(layer.remainingQuantity) || 0) - cut;
      tx.update(layer.ref, {
        remainingQuantity: layer.remainingQuantity,
        trimmedQuantity: FieldValue.increment(cut),
        updatedAt: FieldValue.serverTimestamp()
      });
      excess -= cut;
      trimmed += cut;
    }
    bumpOpenQuantity(tx, storeRef, productId, -trimmed);

    // カウントされた商品だけ控える(未カウント=在庫0にした商品へ明細を作らない)。
    if (itemSnap?.exists) {
      tx.set(snapshotItemRef, {
        costLayerSnapshot: layers
          .filter((l) => (Number(l.remainingQuantity) || 0) > 0)
          .map((l) => ({
            layerId: l.id,
            remainingQuantity: Number(l.remainingQuantity) || 0,
            unitCostTaxIncluded: l.unitCostTaxIncluded ?? null,
            unitCostTaxExcluded: l.unitCostTaxExcluded ?? null,
            costSource: l.costSource ?? null,
            receivedAtMs: layerTime(l)
          }))
      }, { merge: true });
    }
  });
};

// 在庫調整(減)・Shopifyリコンサイル(減)。
export const trimCostLayersOnStockMovement = onDocumentCreated(
  { region: REGION, database: DB_ID, document: 'stores/{storeId}/stockMovements/{movementId}' },
  async (event) => {
    const data = event.data?.data() || {};
    if (!['adjustment', 'shopify_reconcile'].includes(data.type)) return;
    if (!(Number(data.quantity) < 0)) return;
    const productId = normalizeProductId(data.productId);
    if (!productId) return;
    await trimLayersToInventory(getDb().collection('stores').doc(event.params.storeId), productId);
  }
);

// 棚卸し確定(在庫を数えた数で上書き) → ロット残のある商品だけ在庫に合わせ、確定時点のロット残を明細へ控える。
// 在高レポート(stocktakeValuation.js)は控えたロット原価で評価し、ロットより多い分・控えの無い商品
// (ロットなし・この機能より前の棚卸し)は現在の原価で埋める。
// 最後に stocktake.costLayerSnapshotAt を立てる(=控えの書き込み完了。画面の「反映待ち」表示に使う)。
export const trimCostLayersOnStocktakeComplete = onDocumentWritten(
  { region: REGION, database: DB_ID, document: 'stores/{storeId}/stocktakes/{stocktakeId}', timeoutSeconds: 540 },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (after.status !== 'completed' || before.status === 'completed') return;
    const storeRef = getDb().collection('stores').doc(event.params.storeId);
    const stocktakeRef = storeRef.collection('stocktakes').doc(event.params.stocktakeId);
    const snap = await storeRef.collection('costLayerProducts').where('openQuantity', '>', 0).get();
    for (const d of snap.docs) {
      await trimLayersToInventory(storeRef, d.id, { snapshotItemRef: stocktakeRef.collection('items').doc(d.id) });
    }
    await stocktakeRef.set({ costLayerSnapshotAt: FieldValue.serverTimestamp() }, { merge: true });
  }
);
