/**
 * POSスキャン用の軽量バーコード索引(scanIndex/bucket_0..11)を全量構築する。
 *
 * 用途: 初回構築、CSV一括取込後の治癒、夜間の定期再構築(スケジュール化するまで手動)。
 * 差分更新(商品保存時)とロジックを揃えること:
 *   - 対象項目は src/shared/api/firebase/scanIndex.js の ENTRY_FIELDS と同じ
 *   - バケットは productId の djb2ハッシュ % 48 (バーコード基準にしない)
 *   - isArchived/isActive=false は除外
 *
 * 使い方:
 *   node functions/buildScanIndex.mjs dev <storeId>
 *   node functions/buildScanIndex.mjs prod <storeId>
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECTS = { dev: 'mobile-order-dev-5f7fd', prod: 'mobile-order-prod' };
const BUCKETS = 48; // ⚠src/shared/api/firebase/scanIndex.js の SCAN_INDEX_BUCKET_COUNT と一致させること
const ENTRY_FIELDS = [
  'barcode', 'sku', 'productCode', 'name',
  'price', 'priceTaxIncluded', 'taxRate',
  'categoryId', 'categoryName', 'categoryGroupId', 'categoryGroupName',
  'salesAreaId', 'salesAreaName', 'brandId', 'brandName',
  'costTaxExcluded', 'costTaxIncluded', 'supplierCostRate',
  'inventoryQuantity', 'quantity', 'inventoryUnmanaged'
];
const bucketOf = (id) => {
  let h = 5381; const s = String(id);
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `bucket_${h % BUCKETS}`;
};

const [env, storeId] = process.argv.slice(2);
if (!PROJECTS[env] || !storeId) {
  console.error('使い方: node functions/buildScanIndex.mjs <dev|prod> <storeId>');
  process.exit(1);
}
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: PROJECTS[env] }), 'main');

const buckets = Object.fromEntries(Array.from({ length: BUCKETS }, (_, i) => [`bucket_${i}`, {}]));
let scanned = 0, indexed = 0, last = null;
const col = db.collection('stores').doc(storeId).collection('products');
for (;;) {
  let q = col.orderBy('__name__').limit(2000);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  for (const d of snap.docs) {
    scanned += 1;
    const o = d.data();
    if (o.isArchived === true || o.isActive === false) continue;
    const entry = {};
    for (const k of ENTRY_FIELDS) {
      const v = o[k];
      if (v !== undefined && v !== null && v !== '') entry[k] = v;
    }
    buckets[bucketOf(d.id)][d.id] = entry;
    indexed += 1;
  }
  last = snap.docs[snap.docs.length - 1];
  if (snap.size < 2000) break;
}

// 分割数変更などで残った旧バケットdocを掃除する(残すと重複ヒットの原因になる)。
const existing = await db.collection(`stores/${storeId}/scanIndex`).get();
for (const d of existing.docs) {
  if (!(d.id in buckets)) {
    await d.ref.delete();
    console.log(`  旧バケット削除: ${d.id}`);
  }
}

let total = 0;
for (const [bid, entries] of Object.entries(buckets)) {
  const bytes = Buffer.byteLength(JSON.stringify(entries));
  total += bytes;
  if (bytes > 900_000) {
    console.error(`❌ ${bid} が ${(bytes/1024).toFixed(0)}KB で上限に接近。BUCKETS を増やして再構築してください`);
    process.exit(1);
  }
  await db.doc(`stores/${storeId}/scanIndex/${bid}`).set({
    entries,
    count: Object.keys(entries).length,
    rebuiltAt: FieldValue.serverTimestamp()
  });
}
console.log(`✅ ${env}/${storeId}: 走査${scanned}件 → 索引${indexed}件 / 合計${(total/1048576).toFixed(2)}MB / 48バケット書込完了`);
