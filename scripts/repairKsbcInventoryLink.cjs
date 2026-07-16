/**
 * KSBSCS02(Suvin Supima Tube Half-sleeve Tee) の壊れた在庫紐付けを barcode で再リンク＋在庫push。
 * 旧SKU共有バグで group ysP2HvlbASvip16VXQpg の5商品が同一 shopifyInventoryItemId に誤紐付け。
 * Shopify商品 8959011684550 の variant を barcode で突合し、正しい variantId/inventoryItemId に直す。
 *   node scripts/repairKsbcInventoryLink.cjs           # ドライラン
 *   node scripts/repairKsbcInventoryLink.cjs --apply   # 本実行
 */
const path = require('path');
const { createRequire } = require('module');
const requireFromFunctions = createRequire(path.join(__dirname, '../functions/index.js'));
const admin = requireFromFunctions('firebase-admin');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');

const STORE_ID = 'store_ar2y9';
const GROUP_ID = 'ysP2HvlbASvip16VXQpg';
const SHOPIFY_PRODUCT_ID = 'gid://shopify/Product/8959011684550';
const APPLY = process.argv.includes('--apply');

if (!admin.apps.length) admin.initializeApp({ projectId: 'mobile-order-prod' });
const db = getFirestore('main');
const store = db.collection('stores').doc(STORE_ID);

(async () => {
  console.log(`=== KSBSCS02 在庫紐付け修復 (${APPLY ? '本実行' : 'ドライラン'}) ===`);
  const s = (await store.collection('settings').doc('shopify').get()).data() || {};
  const shopDomain = String(s.shopDomain || '').trim().toLowerCase();
  const locationId = String(s.locationId || '').trim();
  const tr = await fetch(`https://${shopDomain}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: s.clientId, client_secret: s.clientSecret }) });
  const token = (await tr.json()).access_token;
  const gql = async (q, v) => { const r = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query: q, variables: v || {} }) }); const b = await r.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data; };

  // Shopify variant: barcode → {variantId, iid}
  const d = await gql(`{ product(id:"${SHOPIFY_PRODUCT_ID}"){ variants(first:100){ nodes{ id barcode inventoryItem{ id } } } } }`);
  const byBc = new Map();
  (d.product?.variants?.nodes || []).forEach((v) => { const bc = String(v.barcode || '').trim(); if (bc) byBc.set(bc, { vid: v.id, iid: v.inventoryItem?.id || '' }); });
  console.log('Shopify variant数:', byBc.size);

  const snap = await store.collection('products').where('productGroupId', '==', GROUP_ID).get();
  const relink = []; const setQ = [];
  snap.forEach((docSnap) => {
    const p = docSnap.data() || {};
    const bc = String(p.barcode || '').trim();
    const m = byBc.get(bc);
    const qty = Math.max(Number(p.inventoryQuantity ?? p.quantity ?? 0), 0);
    if (!m) { console.log(`  ⚠ barcode ${bc} が Shopify商品に無い: ${docSnap.id}`); return; }
    const wrong = String(p.shopifyInventoryItemId || '') !== m.iid;
    console.log(`  bc=${bc} inv=${qty} 現iid=${String(p.shopifyInventoryItemId||'').split('/').pop()} → 正iid=${m.iid.split('/').pop()} ${wrong ? '★修正' : 'OK'}`);
    relink.push({ id: docSnap.id, vid: m.vid, iid: m.iid });
    if (m.iid) setQ.push({ inventoryItemId: m.iid, locationId, quantity: qty });
  });

  if (!APPLY) { console.log('\n*** ドライラン。--apply で 再リンク＋在庫push ***'); process.exit(0); }

  // 再リンク
  const batch = db.batch();
  for (const r of relink) batch.set(store.collection('products').doc(r.id), { shopifyVariantId: r.vid, shopifyInventoryItemId: r.iid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  console.log(`\n再リンク: ${relink.length}件`);

  // 在庫push(絶対値set)
  if (setQ.length) {
    const res = await gql(`mutation($input: InventorySetOnHandQuantitiesInput!){ inventorySetOnHandQuantities(input:$input){ userErrors{ field message } } }`, { input: { reason: 'correction', setQuantities: setQ } });
    const errs = res.inventorySetOnHandQuantities?.userErrors || [];
    console.log(`在庫push: ${setQ.length}件 / userErrors: ${JSON.stringify(errs)}`);
  }
  console.log('完了。');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
