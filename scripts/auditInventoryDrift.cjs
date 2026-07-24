/**
 * 在庫の「記録に無い増減(ドリフト)」を検出する監査スクリプト。
 *
 * 背景(2026-07-24):
 *  - saveProductMasterItem が画面の下書きにある古い inventoryQuantity を書き戻していたため、
 *    入庫後にブランド等を編集して保存すると在庫が巻き戻る事故が発生していた(履歴に残らない)。
 *  - 影響を受けた商品を洗い出すため、監査ログ(stockMovements)と実在庫を突き合わせる。
 *
 * 検出方法:
 *  - 各商品について stockMovements を時系列に並べ、最後の記録の afterQuantity を
 *    「記録上あるべき在庫」とする。
 *  - 実在庫(products.inventoryQuantity)がそれと異なり、かつ最後の記録以降に
 *    会計(transactions)での販売が無ければ「説明できないドリフト」として報告する。
 *  - ※販売はPOS会計で在庫を減らすが stockMovements には残らない構成のため、
 *    最後の記録以降の販売数を transactions から数えて差し引いて判定する。
 *
 * 使い方:
 *   node scripts/auditInventoryDrift.cjs --env prod              # レポート表示
 *   node scripts/auditInventoryDrift.cjs --env prod --csv out.csv # CSV出力
 */

const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');
const fs = require('fs');

const ENVS = {
  dev: { projectId: 'mobile-order-dev-5f7fd', storeId: 'store_0dtao' },
  prod: { projectId: 'mobile-order-prod', storeId: 'store_ar2y9' }
};

const argIndex = (name) => process.argv.indexOf(name);
const envName = argIndex('--env') >= 0 ? process.argv[argIndex('--env') + 1] : 'prod';
const csvPath = argIndex('--csv') >= 0 ? process.argv[argIndex('--csv') + 1] : '';
const target = ENVS[envName];
if (!target) { console.error('使い方: node scripts/auditInventoryDrift.cjs --env dev|prod [--csv path]'); process.exit(1); }

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const tsMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);

const main = async () => {
  console.log(`[audit] env=${envName} store=${target.storeId}`);
  const storeRef = db.collection('stores').doc(target.storeId);

  // 1) 在庫変動ログを商品ごとに集約
  const movementsByProduct = new Map();
  {
    const snap = await storeRef.collection('stockMovements').get();
    snap.docs.forEach((d) => {
      const m = d.data() || {};
      const pid = String(m.productId || '');
      if (!pid) return;
      if (!movementsByProduct.has(pid)) movementsByProduct.set(pid, []);
      movementsByProduct.get(pid).push({
        at: tsMs(m.createdAt),
        type: String(m.type || ''),
        before: num(m.beforeQuantity),
        after: num(m.afterQuantity),
        qty: num(m.quantity)
      });
    });
    console.log(`[audit] stockMovements: ${snap.size}件 / 対象商品 ${movementsByProduct.size}件`);
  }

  // 2) 会計(transactions)から商品別の販売数を「時刻つき」で集計
  const salesByProduct = new Map(); // pid -> [{at, qty}]
  {
    const snap = await storeRef.collection('transactions').get();
    snap.docs.forEach((d) => {
      const t = d.data() || {};
      const at = tsMs(t.createdAt) || tsMs(t.paidAt) || 0;
      const items = Array.isArray(t.items) ? t.items : [];
      items.forEach((it) => {
        const pid = String(it.productId || '');
        if (!pid) return;
        if (!salesByProduct.has(pid)) salesByProduct.set(pid, []);
        salesByProduct.get(pid).push({ at, qty: num(it.quantity) });
      });
    });
    console.log(`[audit] transactions: ${snap.size}件 / 販売のある商品 ${salesByProduct.size}件`);
  }

  // 3) 商品を走査してドリフト判定
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
  console.log(`[audit] 商品: ${products.length}件\n`);

  const drifts = [];
  for (const p of products) {
    const moves = movementsByProduct.get(p.id);
    if (!moves || !moves.length) continue; // 記録が無い商品は判定不能
    moves.sort((a, b) => a.at - b.at);
    const last = moves[moves.length - 1];

    // 最後の記録以降の販売数を差し引く
    const soldAfter = (salesByProduct.get(p.id) || [])
      .filter((s) => s.at > last.at)
      .reduce((sum, s) => sum + s.qty, 0);

    const expected = last.after - soldAfter;
    const actual = Math.max(num(p.data.inventoryQuantity ?? p.data.quantity), 0);
    const diff = actual - expected;
    if (diff === 0) continue;

    // Shopify連携商品は webhook/棚卸同期(functions)が履歴を残さず在庫を上書きするため、
    // 「バグ由来」と断定できない。切り分けのため印をつける。
    const shopifyLinked = Boolean(
      p.data.shopifyProductId || p.data.shopifyVariantId || p.data.shopifyInventoryItemId
    );

    drifts.push({
      id: p.id,
      name: String(p.data.name || ''),
      brand: String(p.data.brandName || ''),
      barcode: String(p.data.barcode || ''),
      lastType: last.type,
      lastAt: new Date(last.at).toISOString().slice(0, 19),
      expected,
      actual,
      diff,
      soldAfter,
      shopifyLinked
    });
  }

  drifts.sort((a, b) => a.diff - b.diff);
  const lost = drifts.filter((d) => d.diff < 0);
  const gained = drifts.filter((d) => d.diff > 0);

  console.log(`[audit] 説明できない差異: ${drifts.length}件 (在庫が減っている ${lost.length} / 増えている ${gained.length})`);
  console.log(`  減少分の合計: ${lost.reduce((s, d) => s + d.diff, 0)}個\n`);

  const sum = (arr) => arr.reduce((s, d) => s + d.diff, 0);
  const lostPure = lost.filter((d) => !d.shopifyLinked);
  const lostShopify = lost.filter((d) => d.shopifyLinked);
  console.log('=== 切り分け ===');
  console.log(`  Shopify連携なし(バグ由来の疑い濃厚): ${lostPure.length}件 / ${sum(lostPure)}個`);
  console.log(`  Shopify連携あり(同期上書きの可能性) : ${lostShopify.length}件 / ${sum(lostShopify)}個`);
  const byMonth = {};
  lostPure.forEach((d) => {
    const m = d.lastAt.slice(0, 7);
    byMonth[m] = byMonth[m] || { n: 0, q: 0 };
    byMonth[m].n += 1;
    byMonth[m].q += d.diff;
  });
  console.log('  ↑うちShopify連携なしの月別(最終記録日基準):');
  Object.keys(byMonth).sort().forEach((m) => console.log(`    ${m}: ${byMonth[m].n}件 ${byMonth[m].q}個`));

  console.log('\n=== 在庫が記録より少ない商品(Shopify連携なし・上位30) ===');
  lostPure.slice(0, 30).forEach((d) => console.log(
    `  ${d.name} [${d.brand}] JAN=${d.barcode} : 記録上=${d.expected} 実際=${d.actual} (差${d.diff}) 最終記録=${d.lastType}@${d.lastAt} 以降販売=${d.soldAfter}`
  ));

  if (csvPath) {
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cols = ['productId', '商品名', 'ブランド', 'JAN', '記録上の在庫', '実際の在庫', '差', '最終記録種別', '最終記録日時', '最終記録以降の販売数', 'Shopify連携'];
    const rows = drifts.map((d) => [d.id, d.name, d.brand, d.barcode, d.expected, d.actual, d.diff, d.lastType, d.lastAt, d.soldAfter, d.shopifyLinked ? 'あり' : 'なし'].map(esc).join(','));
    fs.writeFileSync(csvPath, '﻿' + cols.join(',') + '\n' + rows.join('\n') + '\n');
    console.log(`\n[audit] CSV出力: ${csvPath} (${drifts.length}件)`);
  }
};

main().then(() => process.exit(0)).catch((e) => { console.error('[audit] 失敗:', e); process.exit(1); });
