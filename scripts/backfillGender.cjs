/**
 * 性別(gender)一本化 Phase 1: 分類ノードの性別設定付与 + products.gender バックフィル。
 * 設計: docs/gender-attribute-design.md
 *
 *  - 固定グループ: MEN(catgrp_002)/WOMEN(catgrp_001) → genderMode='fixed', genderFixedValue=同値
 *  - 選択カテゴリー: 眼鏡フレーム/サングラス/時計/その他BASIC + 生活雑貨 財布/ハンドバッグ → genderMode='select'
 *  - products.gender 解決(子優先): 選択カテゴリーなら現サブカテの性別値(無ければUNISEX) > 固定グループ値 > 空
 *  - 大文字 MEN/WOMEN/UNISEX/''。書き込みは gender と 分類ノード設定のみ(掛け率等は不触)。DB=main。
 *
 * 使い方:
 *   node scripts/backfillGender.cjs           # ドライラン
 *   node scripts/backfillGender.cjs --apply   # 本実行(prod main へ書込)
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

const FIXED_GROUPS = { catgrp_002: 'MEN', catgrp_001: 'WOMEN' };
const SELECT_CAT_IDS = new Set([
  'z6iD0wffQBWKZOZl2Pva', // 財布・マネークリップ
  'Ht8kiUsFGHvPoJk8L5Pl', // ハンドバッグ
  'cat_008_001', // フレーム
  'cat_008_002', // サングラス
  'cat_008_003', // 時計
  'cat_008_005'  // その他BASIC
]);
const GENDER = new Set(['MEN', 'WOMEN', 'UNISEX']);
const normGender = (v) => {
  const u = String(v || '').trim().toUpperCase();
  return GENDER.has(u) ? u : '';
};

// 商品の性別解決(子優先): 選択カテゴリー > 固定グループ > フォールバック
const resolveGender = (p) => {
  if (SELECT_CAT_IDS.has(String(p.categoryId || '').trim())) {
    return normGender(p.subCategoryName) || 'UNISEX';
  }
  const g = normGender(p.categoryGroupName);
  if (g) return g;
  return normGender(p.subCategoryName) || '';
};

(async () => {
  console.log(`=== gender Phase1 バックフィル (${APPLY ? '本実行' : 'ドライラン'}) DB=main ===`);

  // 1) 分類ノード設定
  const nodeWrites = [];
  for (const [id, val] of Object.entries(FIXED_GROUPS)) {
    nodeWrites.push({ col: 'productCategoryGroups', id, data: { genderMode: 'fixed', genderFixedValue: val } });
  }
  for (const id of SELECT_CAT_IDS) {
    nodeWrites.push({ col: 'productCategories', id, data: { genderMode: 'select', genderFixedValue: '' } });
  }
  console.log(`\n分類ノード設定: 固定${Object.keys(FIXED_GROUPS).length}グループ + 選択${SELECT_CAT_IDS.size}カテゴリー = ${nodeWrites.length}件`);

  // 2) 商品 gender 解決
  const snap = await store.collection('products').select('categoryId', 'categoryGroupName', 'subCategoryName', 'gender', 'isActive').get();
  const dist = { MEN: 0, WOMEN: 0, UNISEX: 0, '': 0 };
  const bySource = { fixed: 0, select: 0, none: 0 };
  const targets = [];
  snap.forEach((d) => {
    const p = d.data() || {};
    const g = resolveGender(p);
    dist[g] = (dist[g] || 0) + 1;
    if (SELECT_CAT_IDS.has(String(p.categoryId || '').trim())) bySource.select++;
    else if (normGender(p.categoryGroupName)) bySource.fixed++;
    else bySource.none++;
    if (String(p.gender || '') !== g) targets.push({ id: d.id, gender: g });
  });

  console.log(`\n商品総数: ${snap.size}`);
  console.log('gender分布:', JSON.stringify(dist));
  console.log('由来:', JSON.stringify(bySource), '(fixed=アパレル固定 / select=眼鏡バッグ / none=性別なし)');
  console.log('現状と異なり更新が要る商品:', targets.length);

  if (!APPLY) {
    console.log('\n*** ドライランです。書き込みなし。本実行は --apply ***');
    process.exit(0);
  }

  // 3) 書き込み: ノード設定
  const nodeBatch = db.batch();
  for (const w of nodeWrites) {
    nodeBatch.set(store.collection(w.col).doc(w.id), { ...w.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await nodeBatch.commit();
  console.log(`\n分類ノード設定 書込: ${nodeWrites.length}件`);

  // 4) 書き込み: products.gender (250件/バッチ)
  let written = 0;
  for (let i = 0; i < targets.length; i += 250) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + 250)) {
      batch.set(store.collection('products').doc(t.id), { gender: t.gender, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    written += Math.min(250, targets.length - i);
    if (written % 5000 < 250) console.log(`  gender書込 ${written}/${targets.length}`);
  }
  console.log(`\n完了: gender ${written}件 / ノード設定 ${nodeWrites.length}件`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
