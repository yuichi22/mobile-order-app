/**
 * 商品マスターの salesAreaName(表示名) と salesAreaId(実ID) の不整合を、
 * 「名前を正」として salesAreaId を名前に一致する売り場IDへ付け替える。
 *
 * 背景(2026-07 現場報告):
 *  - 日計の売り場別売上は salesAreaId 優先で集計するため、名前は「雑貨売場」でも
 *    IDが salesarea_004(眼鏡売場) を指す商品(例: GUNSOKU)が「眼鏡売場」に計上されていた。
 *  - CSV取込等で name と id がズレて登録された不整合が 180件 存在。
 *
 * 方針(承認済み):
 *  - salesAreaName に一致する売り場マスターの id を求め、salesAreaId をそれに合わせる。
 *  - 変更するのは salesAreaId のみ。名前・価格・在庫・カテゴリー・ブランド等は変更しない。
 *  - 過去の取引データ(transactions のスナップショット)は変更しない。
 *  - salesAreaName が空 / マスターに一致名が無い商品は対象外(手動確認として一覧表示)。
 *
 * 使い方:
 *   node scripts/repairSalesAreaIdByName.cjs --env prod            # ドライラン(表示のみ)
 *   node scripts/repairSalesAreaIdByName.cjs --env prod --apply    # 適用(要承認)
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
  console.error('使い方: node scripts/repairSalesAreaIdByName.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main'); // 実データは名前付きDB main

(async () => {
  const store = db.collection('stores').doc(target.storeId);

  // 売り場マスター
  const areaSnap = await store.collection('productSalesAreas').get();
  const idToName = new Map();
  const nameToId = new Map();
  areaSnap.forEach((doc) => {
    const name = String(doc.data()?.name || '').trim();
    idToName.set(doc.id, name);
    if (name && !nameToId.has(name)) nameToId.set(name, doc.id); // 同名複数は先勝ち(通常一意)
  });

  const prodSnap = await store.collection('products').get();
  console.log(`env=${envName} store=${target.storeId} products=${prodSnap.size} apply=${APPLY}\n`);

  const plan = [];
  const noNameOrMaster = new Map();

  prodSnap.forEach((doc) => {
    const p = doc.data();
    const nm = String(p.salesAreaName || '').trim();
    const id = String(p.salesAreaId || '').trim();
    if (!id) return;                       // ID未設定はこのスクリプトの対象外(別問題)
    const idName = String(idToName.get(id) || '');
    if (!nm || nm === idName) return;      // 名前空 or 既に一致 → 触らない

    const correctId = nameToId.get(nm);
    if (!correctId) {
      // 表示名がマスターに存在しない → 手動確認
      noNameOrMaster.set(nm, (noNameOrMaster.get(nm) || 0) + 1);
      return;
    }
    if (correctId === id) return;

    plan.push({
      ref: doc.ref,
      id: doc.id,
      name: p.name || '',
      brand: p.brandName || '',
      group: p.categoryGroupName || '',
      nm,
      fromId: id,
      fromIdName: idName || '(不明ID)',
      toId: correctId
    });
  });

  // 集計表示
  const byMove = new Map();
  plan.forEach((r) => {
    const k = `name="${r.nm}"  id ${r.fromId}(→${r.fromIdName}) ⇒ ${r.toId}`;
    byMove.set(k, (byMove.get(k) || 0) + 1);
  });
  console.log('=== 付け替え計画(名前を正としてIDを合わせる) ===');
  [...byMove.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}件 : ${k}`));
  console.log(`  --- 合計 ${plan.length}件 ---`);

  if (noNameOrMaster.size > 0) {
    console.log('\n=== 対象外(表示名がマスターに無い・要手動確認) ===');
    [...noNameOrMaster.entries()].forEach(([k, v]) => console.log(`  "${k}": ${v}件`));
  }

  console.log('\n=== 明細(先頭25件) ===');
  plan.slice(0, 25).forEach((r) => {
    console.log(`  ${r.id} "${r.name}" [${r.brand}/${r.group}] name="${r.nm}" id ${r.fromId}(→${r.fromIdName}) ⇒ ${r.toId}`);
  });
  if (plan.length > 25) console.log(`  ... ほか ${plan.length - 25}件`);

  if (APPLY && plan.length > 0) {
    console.log('\n適用中...');
    let done = 0;
    for (let i = 0; i < plan.length; i += 400) {
      const chunk = plan.slice(i, i + 400);
      const batch = db.batch();
      chunk.forEach((r) => {
        batch.update(r.ref, {
          salesAreaId: r.toId,
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
