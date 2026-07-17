/**
 * 「名前は入っているが ID が空」の孤立分類を補修する。
 *
 * 背景(2026-07-17):
 *  - CSV取込み等で salesAreaName / brandName / categoryGroupName は入ったのに
 *    対応する salesAreaId / brandId / categoryGroupId が空のままの商品が多数。
 *  - 見た目は設定済みだが、マスターへのID紐付けが切れており、売り場別集計・掛け率・
 *    税率継承(categoryGroupId 依存)が正しく効かない。
 *
 * 補修内容:
 *  - マスター(brands / productSalesAreas / productCategoryGroups)の name→id 表を作り、
 *    「名前あり×ID空」の商品について、名前一致でIDを引き当てて埋める。
 *  - 名前がマスターに無い(一致しない)ものは対象外(手動確認リストに出す)。
 *  - 商品名・価格・在庫・バーコード等は一切変更しない。ID(と念のため正規化名)だけ。
 *
 * 使い方:
 *   node scripts/repairOrphanClassificationIds.cjs --env dev            # ドライラン(表示のみ)
 *   node scripts/repairOrphanClassificationIds.cjs --env dev --apply    # dev へ適用
 *   node scripts/repairOrphanClassificationIds.cjs --env prod --apply   # prod へ適用(要承認)
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
  console.error('使い方: node scripts/repairOrphanClassificationIds.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main'); // 実データは名前付きDB main

const norm = (v) => String(v || '').trim();
const key = (v) => norm(v).toLowerCase();

// 対象フィールド定義: 商品側の {name欄, id欄} と、参照するマスターcollection。
const SPECS = [
  { label: 'ブランド', nameField: 'brandName', idField: 'brandId', collection: 'brands' },
  { label: '売り場', nameField: 'salesAreaName', idField: 'salesAreaId', collection: 'productSalesAreas' },
  { label: '分類グループ', nameField: 'categoryGroupName', idField: 'categoryGroupId', collection: 'productCategoryGroups' }
];

const main = async () => {
  console.log(`[repair-ids] env=${envName} project=${target.projectId} store=${target.storeId} mode=${APPLY ? 'APPLY(書込あり)' : 'DRY-RUN(表示のみ)'}`);
  const storeRef = db.collection('stores').doc(target.storeId);

  // マスターの name(小文字)→id 表を作る。
  const nameToId = {};
  for (const spec of SPECS) {
    const snap = await storeRef.collection(spec.collection).get();
    const map = new Map();
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      const n = key(data.name);
      if (n && !map.has(n)) map.set(n, d.id);
    });
    nameToId[spec.collection] = map;
    console.log(`[repair-ids] マスター ${spec.collection}: ${map.size}件`);
  }

  // 全商品を走査。
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
  console.log(`[repair-ids] 走査商品数: ${products.length}`);

  const plans = [];        // {id, patch, notes[]}
  const unresolved = { ブランド: [], 売り場: [], 分類グループ: [] }; // 名前がマスターに無い

  for (const p of products) {
    const patch = {};
    const notes = [];
    for (const spec of SPECS) {
      const name = norm(p.data[spec.nameField]);
      const id = norm(p.data[spec.idField]);
      if (name && !id) {
        const resolved = nameToId[spec.collection].get(key(name));
        if (resolved) {
          patch[spec.idField] = resolved;
          notes.push(`${spec.label}:「${name}」→ ${resolved}`);
        } else {
          unresolved[spec.label].push({ id: p.id, name, product: norm(p.data.name) });
        }
      }
    }
    if (Object.keys(patch).length) plans.push({ id: p.id, name: norm(p.data.name), patch, notes });
  }

  console.log(`\n[repair-ids] ID補修対象: ${plans.length}件`);
  const perField = { brandId: 0, salesAreaId: 0, categoryGroupId: 0 };
  plans.forEach((pl) => Object.keys(pl.patch).forEach((k) => { perField[k] += 1; }));
  console.log(`  内訳: brandId ${perField.brandId} / salesAreaId ${perField.salesAreaId} / categoryGroupId ${perField.categoryGroupId}`);
  plans.slice(0, 15).forEach((pl) => console.log(`   - ${pl.name}: ${pl.notes.join(' , ')}`));

  for (const spec of SPECS) {
    const list = unresolved[spec.label];
    if (list.length) {
      console.log(`\n[repair-ids] ⚠ ${spec.label}: 名前がマスターに無く補修不可 ${list.length}件(手動確認)`);
      [...new Set(list.map((x) => x.name))].slice(0, 15).forEach((n) => console.log(`   - 「${n}」`));
    }
  }

  if (!APPLY) {
    console.log('\n[repair-ids] DRY-RUN のため書き込みしていません。適用は --apply を付けてください。');
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
  console.log(`\n[repair-ids] 適用完了: ${done}件のIDを補修`);
};

main().then(() => process.exit(0)).catch((e) => { console.error('[repair-ids] 失敗:', e); process.exit(1); });
