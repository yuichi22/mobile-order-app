/**
 * 過去取引(transactions)の明細スナップで salesAreaName(名前) と salesAreaId(実ID) が
 * 食い違うものを、「名前を正」として salesAreaId を名前一致の売り場IDへ補正する。
 *
 * 背景:
 *  - 商品マスターの name/id 不整合(修正済み: repairSalesAreaIdByName)により、当時の会計で
 *    明細スナップに誤った salesAreaId が焼き込まれた。名前は正しいがIDだけが別売り場を指す。
 *  - 日計の売り場別集計はID優先のため、過去日を見ると誤った売り場に計上される。
 *
 * 方針(承認済み):
 *  - 各取引の items[] のうち salesAreaName がマスターに存在し、かつ salesAreaId が
 *    その名前のIDと食い違う明細だけ、salesAreaId を名前一致IDへ書き換える。
 *  - 変更するのは items[].salesAreaId のみ。金額・数量・商品名・カテゴリー等は一切変更しない。
 *  - salesAreaName 空 / マスターに一致名なし / 既に一致 は対象外。
 *
 * 使い方:
 *   node scripts/repairTxSalesAreaIdByName.cjs --env prod            # ドライラン
 *   node scripts/repairTxSalesAreaIdByName.cjs --env prod --apply    # 適用(要承認)
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
  console.error('使い方: node scripts/repairTxSalesAreaIdByName.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main');

(async () => {
  const store = db.collection('stores').doc(target.storeId);

  const areaSnap = await store.collection('productSalesAreas').get();
  const idToName = new Map();
  const nameToId = new Map();
  areaSnap.forEach((doc) => {
    const name = String(doc.data()?.name || '').trim();
    idToName.set(doc.id, name);
    if (name && !nameToId.has(name)) nameToId.set(name, doc.id);
  });

  const txSnap = await store.collection('transactions').get();
  console.log(`env=${envName} store=${target.storeId} transactions=${txSnap.size} apply=${APPLY}\n`);

  const plan = [];          // { ref, id, nextItems, changes:[{name,nm,fromId,fromName,toId}] }
  const byMove = new Map();
  const skipNoMaster = new Map();

  txSnap.forEach((doc) => {
    const t = doc.data();
    const items = Array.isArray(t.items) ? t.items : [];
    if (items.length === 0) return;

    let changed = false;
    const changes = [];
    const nextItems = items.map((i) => {
      const nm = String(i.salesAreaName || '').trim();
      const id = String(i.salesAreaId || '').trim();
      if (!nm || !id) return i;
      const idName = String(idToName.get(id) || '');
      if (nm === idName) return i;
      const correctId = nameToId.get(nm);
      if (!correctId) { skipNoMaster.set(nm, (skipNoMaster.get(nm) || 0) + 1); return i; }
      if (correctId === id) return i;

      changed = true;
      const key = `name="${nm}" id=${id}(→${idName || '不明'}) ⇒ ${correctId}`;
      byMove.set(key, (byMove.get(key) || 0) + 1);
      changes.push({ name: i.name, nm, fromId: id, fromName: idName || '不明', toId: correctId });
      return { ...i, salesAreaId: correctId };
    });

    if (changed) plan.push({ ref: doc.ref, id: doc.id, nextItems, changes });
  });

  console.log('=== 過去取引の明細ID補正計画(名前を正) ===');
  [...byMove.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}点 : ${k}`));
  const totalItems = [...byMove.values()].reduce((a, b) => a + b, 0);
  console.log(`  --- 取引 ${plan.length}件 / 明細 ${totalItems}点 ---`);
  if (skipNoMaster.size > 0) {
    console.log('\n=== 対象外(名前がマスターに無い) ===');
    [...skipNoMaster.entries()].forEach(([k, v]) => console.log(`  "${k}": ${v}点`));
  }

  console.log('\n=== 明細(先頭20取引) ===');
  plan.slice(0, 20).forEach((p) => {
    p.changes.forEach((c) => console.log(`  tx=${p.id} "${c.name}" name="${c.nm}" id ${c.fromId}(→${c.fromName}) ⇒ ${c.toId}`));
  });
  if (plan.length > 20) console.log(`  ... ほか ${plan.length - 20}取引`);

  if (APPLY && plan.length > 0) {
    console.log('\n適用中...');
    let done = 0;
    for (let i = 0; i < plan.length; i += 300) {
      const chunk = plan.slice(i, i + 300);
      const batch = db.batch();
      chunk.forEach((p) => batch.update(p.ref, {
        items: p.nextItems,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }));
      await batch.commit();
      done += chunk.length;
      console.log(`  ${done}/${plan.length} 取引`);
    }
  }

  console.log(`\n${APPLY ? '適用' : 'ドライラン'}: 取引 ${plan.length}件 / 明細 ${totalItems}点`);
  process.exit(0);
})().catch((error) => {
  console.error('ERROR', error.message);
  process.exit(1);
});
