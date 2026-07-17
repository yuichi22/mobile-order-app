/**
 * ブランドの「既定売り場(defaultSalesArea)」を、売り場が空の商品へ書き戻す。
 *
 * 背景(2026-07-17):
 *  - ブランド既定売場は「新規登録時／分類モーダルを開いた時の初期選択」専用で、
 *    既存商品には保存されない(コード上も「保存はされず、決定時のみ反映」)。
 *  - そのため「TEMBEAはブランド既定で雑貨売場にしたのに、商品は売場が空＝要修正に出る」
 *    という取り残しが発生する(例: AZUMA BAG 3SKU)。
 *
 * 補修内容:
 *  - 商品の salesAreaId / salesAreaName が両方空で、その商品のブランドに
 *    defaultSalesAreaId(または defaultSalesAreaName)がある場合に埋める。
 *  - ブランド未設定・ブランドに既定売場が無い商品は対象外(手動で決めるしかないもの)。
 *  - 商品名・価格・在庫・バーコード・分類は一切変更しない(売り場のみ)。
 *
 * 使い方:
 *   node scripts/backfillSalesAreaFromBrandDefault.cjs --env dev            # ドライラン
 *   node scripts/backfillSalesAreaFromBrandDefault.cjs --env prod           # ドライラン(本番)
 *   node scripts/backfillSalesAreaFromBrandDefault.cjs --env prod --apply   # 本番適用(要承認)
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
  console.error('使い方: node scripts/backfillSalesAreaFromBrandDefault.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main'); // 実データは名前付きDB main

const norm = (v) => String(v || '').trim();
const key = (v) => norm(v).toLowerCase();

const main = async () => {
  console.log(`[brand-area] env=${envName} project=${target.projectId} store=${target.storeId} mode=${APPLY ? 'APPLY(書込あり)' : 'DRY-RUN(表示のみ)'}`);
  const storeRef = db.collection('stores').doc(target.storeId);

  // 売り場マスター: id集合と name→id
  const areaNameToId = new Map();
  const areaIdToName = new Map();
  {
    const snap = await storeRef.collection('productSalesAreas').get();
    snap.docs.forEach((d) => {
      const name = norm((d.data() || {}).name);
      areaIdToName.set(d.id, name);
      if (name && !areaNameToId.has(key(name))) areaNameToId.set(key(name), d.id);
    });
    console.log(`[brand-area] 売り場マスター: ${areaIdToName.size}件`);
  }

  // ブランド: id → {name, 既定売場id/name}
  const brands = new Map();
  {
    const snap = await storeRef.collection('brands').get();
    snap.docs.forEach((d) => {
      const b = d.data() || {};
      let areaId = norm(b.defaultSalesAreaId);
      let areaName = norm(b.defaultSalesAreaName);
      // ID が無く名前だけの場合はマスターから引く。名前が無くIDだけなら名前を引く。
      if (!areaId && areaName) areaId = areaNameToId.get(key(areaName)) || '';
      if (areaId && !areaName) areaName = areaIdToName.get(areaId) || '';
      brands.set(d.id, { name: norm(b.name), areaId, areaName });
    });
    const withDefault = [...brands.values()].filter((b) => b.areaId || b.areaName).length;
    console.log(`[brand-area] ブランド: ${brands.size}件(うち既定売場あり ${withDefault}件)`);
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
  console.log(`[brand-area] 走査商品数: ${products.length}`);

  const plans = [];
  const skipped = { noBrand: 0, brandNoDefault: 0 };
  const byArea = new Map();

  for (const p of products) {
    if (p.data.isArchived === true || p.data.isActive === false) continue;
    const hasArea = norm(p.data.salesAreaId) || norm(p.data.salesAreaName);
    if (hasArea) continue; // 売り場が入っているものは対象外

    const brandId = norm(p.data.brandId);
    if (!brandId) { skipped.noBrand += 1; continue; }
    const brand = brands.get(brandId);
    if (!brand || (!brand.areaId && !brand.areaName)) { skipped.brandNoDefault += 1; continue; }

    plans.push({
      id: p.id,
      name: norm(p.data.name),
      brand: brand.name,
      areaId: brand.areaId,
      areaName: brand.areaName
    });
    const k = `${brand.areaName || brand.areaId}`;
    byArea.set(k, (byArea.get(k) || 0) + 1);
  }

  console.log(`\n[brand-area] 売り場を補完できる商品: ${plans.length}件`);
  console.log('  補完先の売り場別:');
  [...byArea.entries()].sort((a, b) => b[1] - a[1]).forEach(([a, c]) => console.log(`    - ${a}: ${c}件`));
  console.log('\n  例(先頭12):');
  plans.slice(0, 12).forEach((pl) => console.log(`    - ${pl.name} [${pl.brand}] → ${pl.areaName}`));

  console.log(`\n[brand-area] 対象外: ブランド未設定 ${skipped.noBrand}件 / ブランドに既定売場なし ${skipped.brandNoDefault}件 (=手動で決めるしかない)`);

  if (!APPLY) {
    console.log('\n[brand-area] DRY-RUN のため書き込みしていません。適用は --apply を付けてください。');
    return;
  }

  let done = 0;
  for (let i = 0; i < plans.length; i += 400) {
    const batch = db.batch();
    for (const pl of plans.slice(i, i + 400)) {
      const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (pl.areaId) patch.salesAreaId = pl.areaId;
      if (pl.areaName) patch.salesAreaName = pl.areaName;
      batch.set(storeRef.collection('products').doc(pl.id), patch, { merge: true });
    }
    await batch.commit();
    done += Math.min(400, plans.length - i);
  }
  console.log(`\n[brand-area] 適用完了: ${done}件の売り場を補完`);
};

main().then(() => process.exit(0)).catch((e) => { console.error('[brand-area] 失敗:', e); process.exit(1); });
