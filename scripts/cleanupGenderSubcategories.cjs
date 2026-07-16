/**
 * 性別(gender)一本化 Phase 2c: 性別サブカテゴリーの廃止。
 * 設計: docs/gender-attribute-design.md
 *
 * 性別は products.gender へ移行済み(Phase1)。眼鏡・バッグで性別に転用していたサブカテゴリー
 * (subCategoryName = MEN/WOMEN/UNISEX)を持つ商品の subCategoryName/Id を空にし、
 * 性別サブカテゴリー(名前が MEN/WOMEN/UNISEX)18個を削除する。
 *
 * 安全策: サブカテを空にする前に、その商品の gender が空なら旧サブカテ値から補完(念のため)。
 * 削除は「参照商品0」を確認してから。DB=main。掛け率/カテゴリー等は不触。
 *
 *   node scripts/cleanupGenderSubcategories.cjs           # ドライラン
 *   node scripts/cleanupGenderSubcategories.cjs --apply   # 本実行
 */
const path = require('path');
const { createRequire } = require('module');
const requireFromFunctions = createRequire(path.join(__dirname, '../functions/index.js'));
const admin = requireFromFunctions('firebase-admin');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');

const PROJECT_ID = 'mobile-order-prod';
const STORE_ID = 'store_ar2y9';
const APPLY = process.argv.includes('--apply');

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore('main');
const store = db.collection('stores').doc(STORE_ID);

const GENDER = new Set(['MEN', 'WOMEN', 'UNISEX']);
const normGender = (v) => {
  const u = String(v || '').trim().toUpperCase();
  return GENDER.has(u) ? u : '';
};

(async () => {
  console.log(`=== gender Phase2c 性別サブカテ廃止 (${APPLY ? '本実行' : 'ドライラン'}) DB=main ===`);

  // 1) 性別サブカテゴリー(名前が MEN/WOMEN/UNISEX)を特定
  const subSnap = await store.collection('productSubCategories').get();
  const genderSubs = subSnap.docs.filter((d) => normGender(d.data().name || d.data().subCategoryName));
  console.log(`\n削除対象 性別サブカテゴリー: ${genderSubs.length}個`);

  // 2) subCategoryName が性別値の商品を特定
  const prodSnap = await store.collection('products').select('subCategoryName', 'subCategoryId', 'gender').get();
  const targets = [];
  let genderMissing = 0;
  prodSnap.forEach((d) => {
    const p = d.data() || {};
    const g = normGender(p.subCategoryName);
    if (!g) return; // subCategoryName が性別値の商品のみ対象
    const fix = {};
    if (String(p.subCategoryName || '')) fix.subCategoryName = '';
    if (String(p.subCategoryId || '')) fix.subCategoryId = '';
    // 安全: gender が空なら旧サブカテ値で補完
    if (!normGender(p.gender)) { fix.gender = g; genderMissing++; }
    targets.push({ id: d.id, fix });
  });

  console.log(`subCategoryName が性別値の商品: ${targets.length}件 (これらの subCategoryName/Id を空に)`);
  console.log(`  うち gender 未設定→旧値で補完: ${genderMissing}件`);

  if (!APPLY) {
    console.log('\n*** ドライランです。書き込みなし。本実行は --apply ***');
    process.exit(0);
  }

  // 3) 商品の subCategoryName/Id を空に
  let written = 0;
  for (let i = 0; i < targets.length; i += 250) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + 250)) {
      batch.set(store.collection('products').doc(t.id), { ...t.fix, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    written += Math.min(250, targets.length - i);
    if (written % 5000 < 250) console.log(`  商品更新 ${written}/${targets.length}`);
  }
  console.log(`\n商品 subCategory クリア: ${written}件`);

  // 4) 参照0を再確認してから性別サブカテを削除
  const recheck = await store.collection('products').where('subCategoryName', 'in', ['MEN', 'WOMEN', 'UNISEX']).limit(1).get();
  if (!recheck.empty) {
    console.log('⚠ まだ性別サブカテを参照する商品があります。削除を中止しました。');
    process.exit(1);
  }
  const delBatch = db.batch();
  for (const d of genderSubs) delBatch.delete(d.ref);
  await delBatch.commit();
  console.log(`性別サブカテゴリー削除: ${genderSubs.length}個`);
  console.log('\n完了。');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
