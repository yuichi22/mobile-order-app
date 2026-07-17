/**
 * Shopify on_hand を正として POS 在庫を合わせる(inbound リコンサイル手動実行)。
 * webフック取りこぼしで POS>Shopify にドリフトした商品を、POS=Shopify on_hand に修正する。
 * DB=main。書込= products.inventoryQuantity/quantity + inventory/{id}.quantity + inventorySource='shopify' + updatedAt。
 * 掛け率/価格/分類等は不触。紐付け(shopifyInventoryItemId)済みかつ在庫同期OFFでない商品のみ対象。
 *
 *   node scripts/reconcileShopifyToPos.cjs           # ドライラン(CSV出力)
 *   node scripts/reconcileShopifyToPos.cjs --apply   # 本実行
 */
const path = require('path');
const { createRequire } = require('module');
const fs = require('fs');
const requireFromFunctions = createRequire(path.join(__dirname, '../functions/index.js'));
const admin = requireFromFunctions('firebase-admin');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');

const STORE_ID = 'store_ar2y9';
const APPLY = process.argv.includes('--apply');
if (!admin.apps.length) admin.initializeApp({ projectId: 'mobile-order-prod' });
const db = getFirestore('main');
const store = db.collection('stores').doc(STORE_ID);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

(async () => {
  console.log(`=== Shopify→POS リコンサイル (${APPLY ? '本実行' : 'ドライラン'}) DB=main ===`);
  const s = (await store.collection('settings').doc('shopify').get()).data() || {};
  const shopDomain = String(s.shopDomain || '').trim().toLowerCase();
  const locNum = String(s.locationId || '').split('/').pop();
  const tr = await fetch(`https://${shopDomain}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: s.clientId, client_secret: s.clientSecret }) });
  const token = (await tr.json()).access_token;
  const gql = async (q) => { for (let a = 0; a < 6; a += 1) { const r = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query: q }) }); const b = await r.json(); if (b.errors && /throttl/i.test(JSON.stringify(b.errors))) { await sleep(1500); continue; } return b.data; } throw new Error('throttled'); };

  // iid → on_hand
  const onHand = new Map();
  let cursor = null; let pages = 0;
  do {
    const q = `{ productVariants(first:100${cursor ? `,after:"${cursor}"` : ''}){ pageInfo{hasNextPage endCursor} nodes{ inventoryItem{ id inventoryLevels(first:5){ nodes{ location{id} quantities(names:["on_hand"]){name quantity} } } } } } }`;
    const d = await gql(q); const c = d.productVariants;
    for (const n of c.nodes) { const iid = n.inventoryItem?.id; if (!iid) continue; let t = 0; (n.inventoryItem.inventoryLevels?.nodes || []).forEach((l) => { if (String(l.location?.id || '').split('/').pop() === locNum) { const oh = (l.quantities || []).find((x) => x.name === 'on_hand'); t += oh ? Number(oh.quantity || 0) : 0; } }); onHand.set(iid, t); }
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null; pages += 1; if (cursor) await sleep(300);
  } while (cursor && pages < 400);
  console.log(`Shopify on_hand取得: ${onHand.size} (${pages}ページ)`);

  const snap = await store.collection('products').where('shopifyInventoryItemId', '>', '').get();
  const targets = []; let matched = 0; let missing = 0; let disabled = 0;
  snap.forEach((d) => {
    const p = d.data(); const iid = String(p.shopifyInventoryItemId || '').trim(); if (!iid) return;
    if (p.shopifyInventorySyncDisabled === true) { disabled += 1; return; }
    if (!onHand.has(iid)) { missing += 1; return; }
    const pos = Math.max(Number(p.inventoryQuantity ?? p.quantity ?? 0), 0);
    const sh = Math.max(Number(onHand.get(iid)), 0);
    if (pos === sh) { matched += 1; return; }
    targets.push({ id: d.id, name: String(p.name || ''), barcode: String(p.barcode || ''), pos, sh });
  });

  console.log(`\n一致:${matched} / 修正対象(不一致):${targets.length} / Shopify側に無い(除外):${missing} / 在庫同期OFF(除外):${disabled}`);
  const dir = `local_exports/reconcile-shopify-to-pos-${nowStamp()}`;
  fs.mkdirSync(dir, { recursive: true });
  const esc = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  fs.writeFileSync(`${dir}/plan.csv`, '﻿' + ['name,barcode,POS_before,Shopify_after,diff', ...targets.map((t) => [t.name, t.barcode, t.pos, t.sh, t.pos - t.sh].map(esc).join(','))].join('\n'), 'utf8');
  console.log(`CSV: ${dir}/plan.csv`);
  console.log('\n先頭12:'); targets.slice(0, 12).forEach((t) => console.log(`  ${t.name.slice(0, 24)} | POS ${t.pos}→${t.sh}`));

  if (!APPLY) { console.log('\n*** ドライラン。--apply で POS を Shopify に合わせる ***'); process.exit(0); }

  let written = 0;
  for (let i = 0; i < targets.length; i += 250) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + 250)) {
      batch.set(store.collection('products').doc(t.id), { inventoryQuantity: t.sh, quantity: t.sh, inventorySource: 'shopify', inventoryUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      batch.set(store.collection('inventory').doc(t.id), { productId: t.id, quantity: t.sh, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    written += Math.min(250, targets.length - i);
  }
  console.log(`\n完了: ${written}件 POS を Shopify on_hand に合わせました。`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
