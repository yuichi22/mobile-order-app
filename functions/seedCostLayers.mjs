/**
 * 入庫ロット原価(costLayers)の初期化。今ある在庫を「在庫数ぶん・現在の原価」の1ロットとして作る。
 *
 * いつ: costLayers.js の関数をデプロイした直後に1回。以降の入庫は関数が自動でロットを作る。
 * 冪等: ロットIDは固定の 'initial'。既にロットがある商品は飛ばすので、何度流しても二重にならない。
 * 原価: 関数と同じ優先順(商品原価 > 商品掛け率 > ブランド > 仕入先 > 売り場)。決まらない商品は原価なしロット。
 *
 * 使い方(既定はドライラン。書き込むときだけ --apply):
 *   node functions/seedCostLayers.mjs dev <storeId>
 *   node functions/seedCostLayers.mjs dev <storeId> --apply
 *   node functions/seedCostLayers.mjs prod <storeId> --apply
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECTS = { dev: 'mobile-order-dev-5f7fd', prod: 'mobile-order-prod' };
const [env, storeId, flag] = process.argv.slice(2);
if (!PROJECTS[env] || !storeId) {
  console.error('使い方: node functions/seedCostLayers.mjs <dev|prod> <storeId> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';

// 先に既定アプリを初期化してから読み込む(costLayers.js は既存アプリがあれば初期化しない)。
initializeApp({ credential: applicationDefault(), projectId: PROJECTS[env] });
const { resolveCurrentUnitCost } = await import('./costLayers.js');
const db = getFirestore('main');
const storeRef = db.collection('stores').doc(storeId);

let scanned = 0, seeded = 0, skipped = 0, noCost = 0, last = null;
for (;;) {
  let q = storeRef.collection('products').orderBy('__name__').limit(300);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  for (const d of snap.docs) {
    scanned += 1;
    const product = d.data() || {};
    const inventory = Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);
    if (product.inventoryUnmanaged || inventory <= 0) continue;
    const existing = await d.ref.collection('costLayers').limit(1).get();
    if (!existing.empty) { skipped += 1; continue; }

    const unitCost = await resolveCurrentUnitCost(storeRef, product);
    if (!unitCost) noCost += 1;
    seeded += 1;
    if (!apply) continue;

    const batch = db.batch();
    batch.set(d.ref.collection('costLayers').doc('initial'), {
      productId: d.id,
      quantity: inventory,
      remainingQuantity: inventory,
      unitCostTaxIncluded: unitCost?.unitCostTaxIncluded ?? null,
      unitCostTaxExcluded: unitCost?.unitCostTaxExcluded ?? null,
      costSource: unitCost?.costSource ?? null,
      costRate: unitCost?.costRate ?? null,
      // 既存在庫は「いちばん古いロット」として先に消化させる。
      receivedAt: new Date(0),
      stockInId: null,
      purchaseOrderId: null,
      note: '初期化(既存在庫)',
      createdAt: FieldValue.serverTimestamp()
    });
    batch.set(storeRef.collection('costLayerProducts').doc(d.id), {
      openQuantity: FieldValue.increment(inventory),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();
  }
  last = snap.docs[snap.docs.length - 1];
}

console.log(`${apply ? '書き込み' : 'ドライラン'}: 商品${scanned}件中 ロット作成${seeded}件(うち原価なし${noCost}件) / 既存ロットありで飛ばした${skipped}件`);
