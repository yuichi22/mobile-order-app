/**
 * 在庫アイテム共有バグの一括修復。
 * 旧SKU共有バグで、1つの shopifyInventoryItemId に複数商品が誤紐付け(在庫が分配されない)。
 * 対象の各 Shopify商品の variant を barcode で突合し、正しい variantId/inventoryItemId に再リンク＋在庫push。
 *
 *   node scripts/repairSharedInventoryLinks.cjs           # ドライラン
 *   node scripts/repairSharedInventoryLinks.cjs --apply   # 本実行
 * DB=main / 在庫数(inventoryQuantity)・掛け率等は不触(紐付けIDと Shopify on_hand のみ)。
 */
const path = require('path');
const { createRequire } = require('module');
const requireFromFunctions = createRequire(path.join(__dirname, '../functions/index.js'));
const admin = requireFromFunctions('firebase-admin');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');

const STORE_ID = 'store_ar2y9';
const APPLY = process.argv.includes('--apply');
if (!admin.apps.length) admin.initializeApp({ projectId: 'mobile-order-prod' });
const db = getFirestore('main');
const store = db.collection('stores').doc(STORE_ID);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`=== 在庫アイテム共有バグ 一括修復 (${APPLY ? '本実行' : 'ドライラン'}) ===`);
  const s = (await store.collection('settings').doc('shopify').get()).data() || {};
  const shopDomain = String(s.shopDomain || '').trim().toLowerCase();
  const locationId = String(s.locationId || '').trim();
  const tr = await fetch(`https://${shopDomain}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: s.clientId, client_secret: s.clientSecret }) });
  const token = (await tr.json()).access_token;
  const gql = async (q, v) => { const r = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query: q, variables: v || {} }) }); const b = await r.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data; };

  // 1) 共有 iid を検出
  const all = await store.collection('products').select('barcode', 'sku', 'name', 'inventoryQuantity', 'quantity', 'shopifyProductId', 'shopifyInventoryItemId', 'shopifyVariantId').get();
  const byIid = new Map();
  const prods = [];
  all.forEach((d) => { const p = { id: d.id, ...d.data() }; prods.push(p); const iid = String(p.shopifyInventoryItemId || '').trim(); if (iid) { if (!byIid.has(iid)) byIid.set(iid, []); byIid.get(iid).push(p); } });
  const sharedIids = [...byIid.entries()].filter(([, arr]) => arr.length > 1);
  // 影響する shopifyProductId(重複排除)
  const affectedSpids = new Set();
  sharedIids.forEach(([, arr]) => arr.forEach((p) => { const spid = String(p.shopifyProductId || '').trim(); if (spid) affectedSpids.add(spid); }));
  console.log(`共有iid: ${sharedIids.length}種 / 影響 Shopify商品: ${affectedSpids.size}件`);

  const prodsBySpid = new Map();
  prods.forEach((p) => { const spid = String(p.shopifyProductId || '').trim(); if (!spid) return; if (!prodsBySpid.has(spid)) prodsBySpid.set(spid, []); prodsBySpid.get(spid).push(p); });

  const relink = []; const setQ = []; const skipped = []; const clearLinks = [];
  for (const spid of affectedSpids) {
    const numId = spid.split('/').pop();
    let data; try { data = await gql(`{ product(id:"${spid}"){ title variants(first:100){ nodes{ id barcode inventoryItem{ id } } } } }`); } catch (e) { console.log(`  ⚠ ${numId} 取得失敗: ${e.message}`); continue; }
    // Shopify商品が削除済み(null) → その商品を指す紐付けを全てクリア(未連携に戻す)。
    if (!data.product) {
      const groupProds = prodsBySpid.get(spid) || [];
      groupProds.forEach((p) => clearLinks.push(p.id));
      console.log(`  ${numId}: ★削除済みListing → 紐付けクリア ${groupProds.length}商品`);
      await sleep(300);
      continue;
    }
    const byBc = new Map();
    (data.product?.variants?.nodes || []).forEach((v) => { const bc = String(v.barcode || '').trim(); if (bc) byBc.set(bc, { vid: v.id, iid: v.inventoryItem?.id || '' }); });
    const groupProds = prodsBySpid.get(spid) || [];
    let fixCount = 0;
    for (const p of groupProds) {
      const bc = String(p.barcode || '').trim();
      const m = byBc.get(bc);
      if (!m) { skipped.push(`${numId}/${bc}(Shopifyにbarcode無)`); continue; }
      const qty = Math.max(Number(p.inventoryQuantity ?? p.quantity ?? 0), 0);
      const needFix = String(p.shopifyInventoryItemId || '') !== m.iid || String(p.shopifyVariantId || '') !== m.vid;
      if (needFix) fixCount++;
      relink.push({ id: p.id, vid: m.vid, iid: m.iid, needFix });
      if (m.iid) setQ.push({ inventoryItemId: m.iid, locationId, quantity: qty });
    }
    console.log(`  ${data.product?.title?.slice(0, 30) || numId}: ${groupProds.length}商品 / 要修正 ${fixCount}`);
    await sleep(300);
  }

  console.log(`\n再リンク対象: ${relink.length}件(うち要修正 ${relink.filter((r) => r.needFix).length}) / 在庫push: ${setQ.length}件`);
  console.log(`削除済みListingの紐付けクリア: ${clearLinks.length}件 / skip: ${skipped.length}`);
  if (skipped.length) console.log('skip:', skipped.join(', '));

  if (!APPLY) { console.log('\n*** ドライラン。--apply で 再リンク＋push＋紐付けクリア ***'); process.exit(0); }

  // 削除済みListingの紐付けクリア(未連携に戻す)
  for (let i = 0; i < clearLinks.length; i += 250) {
    const batch = db.batch();
    for (const id of clearLinks.slice(i, i + 250)) {
      batch.set(store.collection('products').doc(id), {
        shopifyProductId: '', shopifyVariantId: '', shopifyInventoryItemId: '', shopifyStatus: '',
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
  }
  console.log(`紐付けクリア: ${clearLinks.length}件`);

  // 再リンク(要修正のみ)
  const toFix = relink.filter((r) => r.needFix);
  for (let i = 0; i < toFix.length; i += 250) {
    const batch = db.batch();
    for (const r of toFix.slice(i, i + 250)) batch.set(store.collection('products').doc(r.id), { shopifyVariantId: r.vid, shopifyInventoryItemId: r.iid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
  console.log(`再リンク: ${toFix.length}件`);

  // 在庫push(250件/バッチ)
  let pushed = 0;
  for (let i = 0; i < setQ.length; i += 250) {
    const chunk = setQ.slice(i, i + 250);
    const res = await gql(`mutation($input: InventorySetOnHandQuantitiesInput!){ inventorySetOnHandQuantities(input:$input){ userErrors{ field message } } }`, { input: { reason: 'correction', setQuantities: chunk } });
    const errs = res.inventorySetOnHandQuantities?.userErrors || [];
    if (errs.length) console.log('  push userErrors:', JSON.stringify(errs));
    pushed += chunk.length;
    await sleep(500);
  }
  console.log(`在庫push: ${pushed}件`);
  console.log('完了。');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
