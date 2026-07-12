/**
 * CSVインポートの productGroupId 列ミスで「別商品が1グループに混在」したデータの補修。
 *
 * 背景(2026-07-11 調査):
 *  - 例:「●伍魚福 オニオンチーズ」等14商品が、どの商品とも無関係な
 *    pg_shopify_gid_shopify_Product_6721646461126_... を共有していた。
 *  - 各商品の shopifyProductId は正しく別々 → Shopify上は最初から別商品。
 *    CSVの productGroupId 列に同一値が誤って入っていたのが原因。
 *
 * 補修基準(名前推測に頼らずIDで判定):
 *  - 同一 productGroupId 内を shopifyProductId でクラスタ化(空は商品単位)。
 *  - クラスタが2つ以上あり、かつクラスタ間で正規化した商品名が異なるグループのみ対象。
 *    (同名で Shopify商品だけ分かれているグループ=意図的なPOS側まとめ、は触らない)
 *  - 対象グループの各クラスタへ新しい productGroups doc を発行し、
 *    productGroupId / productGroupName / productGroupRole(先頭=primary) を付け替える。
 *    商品名・バーコード・価格・在庫・Shopify紐付けは一切変更しない。
 *  - 旧グループdocは全員が離脱するため削除する。
 *
 * 使い方:
 *   node scripts/repairShopifyGroupPollution.cjs --env dev            # ドライラン(一覧表示のみ)
 *   node scripts/repairShopifyGroupPollution.cjs --env dev --apply    # dev へ適用
 *   node scripts/repairShopifyGroupPollution.cjs --env prod --apply   # prod へ適用(要承認)
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
  console.error('使い方: node scripts/repairShopifyGroupPollution.cjs --env dev|prod [--apply]');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: target.projectId });
}
// 実データは名前付きDB「main」。(default) ではない。
const db = getFirestore('main');

const normalizeName = (value) => String(value || '')
  .replace(/[●【】\s　]/g, '')
  .toLowerCase();

const main = async () => {
  console.log(`[repair] env=${envName} project=${target.projectId} store=${target.storeId} mode=${APPLY ? 'APPLY(書き込みあり)' : 'DRY-RUN(表示のみ)'}`);

  const productsRef = db.collection('stores').doc(target.storeId).collection('products');

  // 全商品を productGroupId 付きで走査
  const all = [];
  let lastDoc = null;
  for (;;) {
    let query = productsRef.orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      all.push({
        id: docSnap.id,
        name: String(data.name || ''),
        productGroupId: String(data.productGroupId || ''),
        shopifyProductId: String(data.shopifyProductId || ''),
        brandId: String(data.brandId || ''),
        categoryId: String(data.categoryId || ''),
        categoryGroupId: String(data.categoryGroupId || ''),
        departmentId: String(data.departmentId || 'retail'),
        labelEnabled: Boolean(data.labelEnabled)
      });
    });
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 1000) break;
  }
  console.log(`[repair] 走査商品数: ${all.length}`);

  const byPgid = new Map();
  for (const product of all) {
    if (!product.productGroupId) continue;
    if (!byPgid.has(product.productGroupId)) byPgid.set(product.productGroupId, []);
    byPgid.get(product.productGroupId).push(product);
  }

  // 対象グループ抽出
  // 汚染の証拠 = 同一グループ内に「空でない異なる shopifyProductId」が2つ以上あること。
  // shopifyProductId を持たない商品(CSV由来のメガネ等)は判定に使わない。
  const plans = [];
  const skippedManual = [];
  for (const [pgid, members] of byPgid.entries()) {
    if (members.length < 2) continue;

    const nonEmptySpids = new Set(members.map((m) => m.shopifyProductId).filter(Boolean));
    if (nonEmptySpids.size < 2) continue;

    // spid が空のメンバーが混ざるグループは機械判定できないため対象外(手動確認リストへ)。
    if (members.some((m) => !m.shopifyProductId)) {
      skippedManual.push({ pgid, members });
      continue;
    }

    // shopifyProductId でクラスタ化
    const clusters = new Map();
    for (const member of members) {
      if (!clusters.has(member.shopifyProductId)) clusters.set(member.shopifyProductId, []);
      clusters.get(member.shopifyProductId).push(member);
    }

    // クラスタ間で名前が異なる場合のみ対象(同名クラスタ同士のまとめは意図的とみなし温存)
    const clusterNameKeys = new Set(
      [...clusters.values()].map((items) => normalizeName(items[0].name))
    );
    if (clusterNameKeys.size < 2) continue;

    plans.push({ pgid, clusters: [...clusters.values()] });
  }

  if (skippedManual.length > 0) {
    console.log(`[repair] spid空混在のためスキップ(要手動確認): ${skippedManual.length}グループ`);
    skippedManual.forEach((g) => console.log(`   - ${g.pgid} (${g.members.length}件)`));
  }

  console.log(`[repair] 対象グループ数: ${plans.length} / 対象商品数: ${plans.reduce((sum, p) => sum + p.clusters.flat().length, 0)}`);
  console.log();

  for (const plan of plans) {
    console.log(`■ ${plan.pgid}`);
    plan.clusters.forEach((items, index) => {
      console.log(`   → 新グループ${index + 1}: 「${items[0].name}」 x ${items.length}件`);
      items.forEach((item) => console.log(`        - ${item.name} (${item.id})`));
    });
  }

  if (!APPLY) {
    console.log('\n[repair] DRY-RUN のため書き込みしていません。適用するには --apply を付けてください。');
    return;
  }

  // 適用: クラスタごとに新グループ発行 → 商品を付け替え → 旧グループdoc削除
  let updatedProducts = 0;
  let createdGroups = 0;
  for (const plan of plans) {
    for (const items of plan.clusters) {
      const groupRef = db.collection('stores').doc(target.storeId).collection('productGroups').doc();
      const name = String(items[0].name || '').trim() || '(名称未設定)';
      const first = items[0];

      const batch = db.batch();
      batch.set(groupRef, {
        id: groupRef.id,
        name,
        baseProductName: name,
        brandId: first.brandId,
        categoryId: first.categoryId,
        categoryGroupId: first.categoryGroupId,
        departmentId: first.departmentId,
        labelEnabled: first.labelEnabled,
        shopifyEnabled: false,
        shopifyProductId: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      items.forEach((item, index) => {
        batch.set(productsRef.doc(item.id), {
          productGroupId: groupRef.id,
          productGroupName: name,
          productGroupRole: index === 0 ? 'primary' : 'variant',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
      createdGroups += 1;
      updatedProducts += items.length;
    }

    // 旧グループdocが存在すれば削除(全メンバーが離脱済み)
    const oldGroupRef = db.collection('stores').doc(target.storeId).collection('productGroups').doc(plan.pgid);
    const oldSnap = await oldGroupRef.get();
    if (oldSnap.exists) await oldGroupRef.delete();
  }

  console.log(`\n[repair] 適用完了: 新グループ ${createdGroups}件 / 商品 ${updatedProducts}件を付け替え`);
};

main().then(() => process.exit(0)).catch((error) => {
  console.error('[repair] 失敗:', error);
  process.exit(1);
});
