/**
 * 「眼鏡売場」に誤登録されたアパレル/雑貨商品を正しい売り場へ付け替える。
 *
 * 背景(2026-07-21 現場報告):
 *  - 日計の売り場別売上で「眼鏡売場とHOWELL売場が混在している」との報告。
 *  - 調査の結果、日計の集計は正しく、商品マスター側で salesArea が誤っていた。
 *    眼鏡売場に眼鏡グループ以外(MEN/WOMEN)の商品が 135件 登録されていた。
 *
 * 付け替え方針(承認済み):
 *  - ザイノウエブラザーズジャパン / THE INOUE BROTHERS...  → HOWELL売場
 *  - TEMBEA                                              → 雑貨売場(バッグ等)
 *  - categoryGroupName === '眼鏡' の商品は対象外(眼鏡売場のまま)
 *
 * 変更するのは salesAreaId / salesAreaName のみ。
 * 商品名・価格・在庫・カテゴリー・ブランド等は一切変更しない。
 * 過去の取引データ(transactions の明細スナップショット)は変更しない。
 *
 * 使い方:
 *   node scripts/repairEyewearAreaMisassign.cjs --env prod            # ドライラン(表示のみ)
 *   node scripts/repairEyewearAreaMisassign.cjs --env prod --apply    # 適用(要承認)
 */

const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');

const ENVS = {
  dev: { projectId: 'mobile-order-dev-5f7fd', storeId: 'store_0dtao' },
  prod: { projectId: 'mobile-order-prod', storeId: 'store_ar2y9' }
};

const argValue = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const envName = argValue('--env', 'dev');
const APPLY = process.argv.includes('--apply');
const target = ENVS[envName];

if (!target) {
  console.error('使い方: node scripts/repairEyewearAreaMisassign.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main'); // 実データは名前付きDB main

const FROM_AREA_NAME = '眼鏡売場';
const KEEP_GROUP = '眼鏡'; // このグループは付け替えない

// ブランド名 → 移動先の売り場名
const BRAND_TO_AREA = {
  'ザイノウエブラザーズジャパン': 'HOWELL売場',
  'THE INOUE BROTHERS...': 'HOWELL売場',
  'TEMBEA': '雑貨売場'
};

(async () => {
  const store = db.collection('stores').doc(target.storeId);

  // 売り場マスター(名前 → id)
  const areaSnap = await store.collection('productSalesAreas').get();
  const areaByName = new Map();
  areaSnap.forEach((doc) => {
    const name = String(doc.data()?.name || '').trim();
    if (name) areaByName.set(name, { id: doc.id, name });
  });

  for (const areaName of new Set(Object.values(BRAND_TO_AREA))) {
    if (!areaByName.has(areaName)) {
      console.error(`ERROR: 売り場「${areaName}」がマスターに見つかりません`);
      process.exit(1);
    }
  }

  const prodSnap = await store.collection('products').get();
  console.log(`env=${envName} store=${target.storeId} products=${prodSnap.size} apply=${APPLY}\n`);

  const plan = [];
  const skippedBrands = new Map();

  prodSnap.forEach((doc) => {
    const p = doc.data();
    if (String(p.salesAreaName || '').trim() !== FROM_AREA_NAME) return;
    if (String(p.categoryGroupName || '').trim() === KEEP_GROUP) return; // 眼鏡はそのまま

    const brand = String(p.brandName || '').trim();
    const toName = BRAND_TO_AREA[brand];
    if (!toName) {
      // 想定外ブランドは触らない(手動確認)
      skippedBrands.set(brand || '(ブランド未設定)', (skippedBrands.get(brand || '(ブランド未設定)') || 0) + 1);
      return;
    }

    const to = areaByName.get(toName);
    if (String(p.salesAreaId || '') === to.id) return; // 既に正しい

    plan.push({
      ref: doc.ref,
      id: doc.id,
      name: p.name || '',
      brand,
      group: p.categoryGroupName || '',
      category: p.categoryName || '',
      fromId: p.salesAreaId || '',
      fromName: p.salesAreaName || '',
      toId: to.id,
      toName: to.name
    });
  });

  // 移動先ごとに集計表示
  const byTo = new Map();
  plan.forEach((row) => {
    const e = byTo.get(row.toName) || { n: 0, brands: new Map() };
    e.n += 1;
    e.brands.set(row.brand, (e.brands.get(row.brand) || 0) + 1);
    byTo.set(row.toName, e);
  });

  console.log('=== 付け替え計画 ===');
  [...byTo.entries()].forEach(([toName, v]) => {
    console.log(`  ${FROM_AREA_NAME} → ${toName} : ${v.n}件`);
    [...v.brands.entries()].forEach(([b, n]) => console.log(`      - ${b}: ${n}件`));
  });
  if (skippedBrands.size > 0) {
    console.log('\n=== 対象外(想定外ブランド・要手動確認) ===');
    [...skippedBrands.entries()].forEach(([b, n]) => console.log(`  ${b}: ${n}件`));
  }

  console.log('\n=== 明細(先頭20件) ===');
  plan.slice(0, 20).forEach((r) => {
    console.log(`  ${r.id} "${r.name}" [${r.brand}/${r.group}/${r.category}] ${r.fromName} → ${r.toName}`);
  });
  if (plan.length > 20) console.log(`  ... ほか ${plan.length - 20}件`);

  if (APPLY && plan.length > 0) {
    console.log('\n適用中...');
    let done = 0;
    // Firestore の一括書き込み上限(500)に合わせて分割
    for (let i = 0; i < plan.length; i += 400) {
      const chunk = plan.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach((row) => {
        batch.update(row.ref, {
          salesAreaId: row.toId,
          salesAreaName: row.toName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      done += chunk.length;
      console.log(`  ${done}/${plan.length} 件`);
    }
  }

  console.log(`\n${APPLY ? '適用' : 'ドライラン'}: 対象 ${plan.length}件`);
  process.exit(0);
})().catch((error) => {
  console.error('ERROR', error.message);
  process.exit(1);
});
