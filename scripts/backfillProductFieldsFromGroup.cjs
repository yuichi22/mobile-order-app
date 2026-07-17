/**
 * 商品グループ(productGroups)が持つ分類/ブランドを、商品(products)へ書き戻す。
 *
 * 背景(2026-07-17):
 *  - 商品マスターの一覧はグルーピング時に
 *      brandId: product.brandId || group.brandId
 *      categoryId / categoryGroupId も同様
 *    と「グループ側の値で補完して表示」している。
 *  - しかし商品doc自身のフィールドは空のままなので、
 *    「画面にはブランドが出ているのに、要修正(ブランド未設定)に上がる」食い違いが起きる。
 *  - 掛け率(brandId経由)・税率継承(categoryGroupId)・分析もdocの値を使うため、
 *    docへ書き戻すのが正。表示は既にグループ値なので、見た目は変わらない。
 *
 * 補修内容:
 *  - 商品の brandId / categoryId / categoryGroupId が空で、所属グループに値がある場合に埋める。
 *  - IDを埋めたら対応する名前(brandName / categoryName / categoryGroupName)も
 *    マスターから引いて併せて埋める(空の場合のみ)。
 *  - 商品名・価格・在庫・バーコードは一切変更しない。
 *
 * 使い方:
 *   node scripts/backfillProductFieldsFromGroup.cjs --env dev            # ドライラン
 *   node scripts/backfillProductFieldsFromGroup.cjs --env dev --apply    # dev 適用
 *   node scripts/backfillProductFieldsFromGroup.cjs --env prod --apply   # prod 適用(要承認)
 */

const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');

const ENVS = {
  dev: { projectId: 'mobile-order-dev-5f7fd', storeId: 'store_0dtao' },
  prod: { projectId: 'mobile-order-prod', storeId: 'store_ar2y9' }
};

const envArgIndex = process.argv.indexOf('--env');
const envName = envArgIndex >= 0 ? process.argv[envArgIndex + 1] : 'dev';
const APPLY = process.argv.includes('--apply');
const target = ENVS[envName];

if (!target) {
  console.error('使い方: node scripts/backfillProductFieldsFromGroup.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main'); // 実データは名前付きDB main

const norm = (v) => String(v || '').trim();

// 商品側のID欄 → {グループ側のID欄, 名前欄, 名前を引くマスター}
const SPECS = [
  { label: 'ブランド', idField: 'brandId', groupIdField: 'brandId', nameField: 'brandName', master: 'brands' },
  { label: 'カテゴリー', idField: 'categoryId', groupIdField: 'categoryId', nameField: 'categoryName', master: 'productCategories' },
  { label: '分類グループ', idField: 'categoryGroupId', groupIdField: 'categoryGroupId', nameField: 'categoryGroupName', master: 'productCategoryGroups' }
];

const main = async () => {
  console.log(`[backfill] env=${envName} project=${target.projectId} store=${target.storeId} mode=${APPLY ? 'APPLY(書込あり)' : 'DRY-RUN(表示のみ)'}`);
  const storeRef = db.collection('stores').doc(target.storeId);

  // マスター id→name
  const idToName = {};
  for (const master of [...new Set(SPECS.map((s) => s.master))]) {
    const snap = await storeRef.collection(master).get();
    const map = new Map();
    snap.docs.forEach((d) => map.set(d.id, norm((d.data() || {}).name)));
    idToName[master] = map;
    console.log(`[backfill] マスター ${master}: ${map.size}件`);
  }

  // グループ id→doc
  const groups = new Map();
  {
    const snap = await storeRef.collection('productGroups').get();
    snap.docs.forEach((d) => groups.set(d.id, d.data() || {}));
    console.log(`[backfill] productGroups: ${groups.size}件`);
  }

  // 全商品走査
  const products = [];
  let lastDoc = null;
  for (;;) {
    let q = storeRef.collection('products').orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => products.push({ id: d.id, data: d.data() || {} }));
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }
  console.log(`[backfill] 走査商品数: ${products.length}`);

  const plans = [];
  const perField = { brandId: 0, categoryId: 0, categoryGroupId: 0 };

  for (const p of products) {
    const group = groups.get(norm(p.data.productGroupId) || norm(p.data.groupId));
    if (!group) continue;

    const patch = {};
    const notes = [];
    for (const spec of SPECS) {
      const own = norm(p.data[spec.idField]);
      const fromGroup = norm(group[spec.groupIdField]);
      if (!own && fromGroup) {
        patch[spec.idField] = fromGroup;
        perField[spec.idField] += 1;
        const name = idToName[spec.master].get(fromGroup);
        if (name && !norm(p.data[spec.nameField])) patch[spec.nameField] = name;
        notes.push(`${spec.label}→${name || fromGroup}`);
      }
    }
    if (Object.keys(patch).length) plans.push({ id: p.id, name: norm(p.data.name), patch, notes });
  }

  console.log(`\n[backfill] 補完対象: ${plans.length}件`);
  console.log(`  内訳: brandId ${perField.brandId} / categoryId ${perField.categoryId} / categoryGroupId ${perField.categoryGroupId}`);
  plans.slice(0, 15).forEach((pl) => console.log(`   - ${pl.name}: ${pl.notes.join(' , ')}`));

  if (!APPLY) {
    console.log('\n[backfill] DRY-RUN のため書き込みしていません。適用は --apply を付けてください。');
    return;
  }

  let done = 0;
  for (let i = 0; i < plans.length; i += 400) {
    const batch = db.batch();
    for (const pl of plans.slice(i, i + 400)) {
      batch.set(storeRef.collection('products').doc(pl.id), {
        ...pl.patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    done += Math.min(400, plans.length - i);
  }
  console.log(`\n[backfill] 適用完了: ${done}件を補完`);
};

main().then(() => process.exit(0)).catch((e) => { console.error('[backfill] 失敗:', e); process.exit(1); });
