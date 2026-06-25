/**
 * 棚卸し前の「初回だけ」の初期化スクリプト。
 * Shopify の現在 on_hand 在庫を取得し、バーコードで prod 商品と突合して、
 * 一致した prod 商品の在庫数(inventoryQuantity / quantity / inventory.quantity)を上書きする。
 *
 * 既定はドライラン(書き込み無し・一覧 + CSV 出力)。本実行は `--apply` を付与。
 *
 * 仕様(ユーザー確認済み 2026-06-24):
 *  - 未突合(barcode が Shopify に無い) → 据え置き(変更しない)
 *  - Shopify on_hand が 0/マイナス → 0 も上書き(マイナスは 0 に丸め)
 *  - 重複 barcode → prod 側重複は該当全商品に同値を適用 / Shopify 側重複は on_hand を合算
 *  - 監査ログ(stockMovements)は残さない。updatedAt のみ更新 + CSV に記録
 *  - 掛け率/原価/価格/カテゴリ/売場 等は一切触らない。在庫数のみ。
 *  - Shopify への push は一切しない(読み取り + Firestore 書き込みのみ)。
 *
 * 使い方:
 *   node scripts/importShopifyInventoryToProd.cjs            # ドライラン
 *   node scripts/importShopifyInventoryToProd.cjs --apply    # 本実行(prod 書き込み)
 */

const admin = require('../functions/node_modules/firebase-admin');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mobile-order-prod';
const STORE_ID = 'store_ar2y9';
const SHOPIFY_ADMIN_API_VERSION = '2026-01';

const APPLY = process.argv.includes('--apply');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const normalize = (v) => String(v ?? '').trim();
const numOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outDir = `local_exports/prod-shopify-inventory-import-${nowStamp()}`;

// ---- Shopify ----------------------------------------------------------------

const normalizeShopifyDomain = (domain) => normalize(domain).toLowerCase();

const getShopifyAccessToken = async (settings) => {
  const shopDomain = normalizeShopifyDomain(settings.shopDomain);
  const clientId = normalize(settings.clientId);
  const clientSecret = normalize(settings.clientSecret);
  if (!clientId || !clientSecret) {
    throw new Error('Shopify clientId/clientSecret が未設定です。');
  }
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || 'Shopify アクセストークン取得に失敗。');
  }
  return { shopDomain, accessToken: body.access_token };
};

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const callShopifyGraphql = async ({ shopDomain, accessToken, query, variables }) => {
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(body.errors?.[0]?.message || 'Shopify GraphQL 呼び出しに失敗。');
  }
  return body.data || {};
};

const callShopifyGraphqlWithRetry = async (args, maxRetries = 6) => {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callShopifyGraphql(args);
    } catch (error) {
      lastError = error;
      if (!/throttle/i.test(String(error?.message || ''))) throw error;
      await sleepMs(Math.min(8000, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
};

// barcode -> { onHand合計, variants件数 } のMapを作る(対象ロケーションのみ集計)。
// 同一 barcode の複数 variant は on_hand を合算。barcode 空の variant は無視。
const buildShopifyOnHandByBarcode = async ({ shopDomain, accessToken, locationNumericSet }) => {
  const byBarcode = new Map();
  const query = `query($cursor: String) {
    productVariants(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        barcode
        inventoryItem {
          inventoryLevels(first: 10) {
            nodes {
              location { id }
              quantities(names: ["on_hand"]) { name quantity }
            }
          }
        }
      }
    }
  }`;

  let cursor = null;
  let pages = 0;
  let variantsScanned = 0;
  let variantsWithBarcode = 0;
  do {
    const data = await callShopifyGraphqlWithRetry({ shopDomain, accessToken, query, variables: { cursor } });
    const conn = data.productVariants || {};
    const nodes = conn.nodes || [];
    for (const node of nodes) {
      variantsScanned += 1;
      const barcode = normalize(node?.barcode);
      if (!barcode) continue;
      variantsWithBarcode += 1;
      const levels = node?.inventoryItem?.inventoryLevels?.nodes || [];
      let total = 0;
      for (const level of levels) {
        const locNum = normalize(level?.location?.id).split('/').pop();
        if (locationNumericSet.size && (!locNum || !locationNumericSet.has(locNum))) continue;
        const onHand = (level?.quantities || []).find((q) => q.name === 'on_hand');
        total += onHand ? numOrZero(onHand.quantity) : 0;
      }
      const prev = byBarcode.get(barcode) || { onHand: 0, variantCount: 0 };
      prev.onHand += total;
      prev.variantCount += 1;
      byBarcode.set(barcode, prev);
    }
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    pages += 1;
    if (pages % 20 === 0) console.log(`  ...Shopify ${pages} ページ走査 (variants=${variantsScanned})`);
    if (cursor) await sleepMs(500);
  } while (cursor && pages < 2000);

  return { byBarcode, variantsScanned, variantsWithBarcode, pages };
};

// ---- main -------------------------------------------------------------------

const writeCsv = (filePath, rows) => {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['status', 'productId', 'name', 'barcode', 'currentQty', 'newQty', 'shopifyOnHand', 'note'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => esc(r[h])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
};

(async () => {
  console.log(`=== Shopify在庫 → prod 取込 (${APPLY ? '本実行(APPLY)' : 'ドライラン'}) ===`);
  console.log(`project=${PROJECT_ID} store=${STORE_ID}`);

  const storeRef = db.collection('stores').doc(STORE_ID);

  // 1) Shopify 設定 + トークン
  const settingsSnap = await storeRef.collection('settings').doc('shopify').get();
  if (!settingsSnap.exists) throw new Error('settings/shopify が存在しません。');
  const settings = settingsSnap.data() || {};
  const { shopDomain, accessToken } = await getShopifyAccessToken(settings);
  const locationNumericSet = new Set(
    (Array.isArray(settings.locationIds) && settings.locationIds.length
      ? settings.locationIds
      : (settings.locationId ? [settings.locationId] : []))
      .map((l) => normalize(l).split('/').pop())
      .filter(Boolean)
  );
  console.log(`shopDomain=${shopDomain} locations=[${[...locationNumericSet].join(',')}]`);

  // 2) Shopify 在庫(barcode -> on_hand合計)
  console.log('Shopify 在庫を取得中...');
  const { byBarcode, variantsScanned, variantsWithBarcode, pages } =
    await buildShopifyOnHandByBarcode({ shopDomain, accessToken, locationNumericSet });
  const shopifyDupBarcodes = [...byBarcode.entries()].filter(([, v]) => v.variantCount > 1);
  console.log(`Shopify: variant ${variantsScanned}件(barcode付 ${variantsWithBarcode}) / 一意barcode ${byBarcode.size}件 / 重複barcode ${shopifyDupBarcodes.length}件 / ${pages}ページ`);

  // 3) prod 全商品取得 → barcode -> products
  console.log('prod 全商品を取得中...');
  const productsSnap = await storeRef.collection('products').get();
  const prodByBarcode = new Map(); // barcode -> [{id, name, currentQty}]
  let prodNoBarcode = 0;
  productsSnap.forEach((docSnap) => {
    const p = docSnap.data() || {};
    const barcode = normalize(p.barcode);
    const currentQty = numOrZero(p.inventoryQuantity ?? p.quantity ?? 0);
    const entry = { id: docSnap.id, name: p.name || '', currentQty };
    if (!barcode) { prodNoBarcode += 1; return; }
    const arr = prodByBarcode.get(barcode) || [];
    arr.push(entry);
    prodByBarcode.set(barcode, arr);
  });
  const prodDupBarcodes = [...prodByBarcode.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`prod: 商品 ${productsSnap.size}件 / barcode付 一意 ${prodByBarcode.size}件 / barcode無し ${prodNoBarcode}件 / prod側重複barcode ${prodDupBarcodes.length}件`);

  // 4) 突合
  const rows = [];        // CSV 全行
  const writeTargets = []; // 実際に書き込む {id, newQty}
  let matchedProducts = 0;
  let changed = 0;
  let unchanged = 0;
  let dupProductsSkipped = 0; // prod側重複は据え置きで「全部に同値」適用→今回ユーザー指定: 全部に同値を適用
  let unmatchedInShopify = 0; // barcode付きだが Shopify に無い

  for (const [barcode, arr] of prodByBarcode.entries()) {
    const shop = byBarcode.get(barcode);
    if (!shop) {
      unmatchedInShopify += arr.length;
      for (const e of arr) {
        rows.push({ status: '据え置き(Shopify無)', productId: e.id, name: e.name, barcode, currentQty: e.currentQty, newQty: e.currentQty, shopifyOnHand: '', note: 'barcode が Shopify に無い' });
      }
      continue;
    }
    const newQty = Math.max(numOrZero(shop.onHand), 0); // マイナスは0
    const isProdDup = arr.length > 1;
    const isShopifyDup = shop.variantCount > 1;
    // ユーザー指定: 重複は「全部に同値を適用」
    for (const e of arr) {
      matchedProducts += 1;
      const note = [
        isProdDup ? `prod重複${arr.length}件` : '',
        isShopifyDup ? `Shopify重複${shop.variantCount}variant合算` : ''
      ].filter(Boolean).join(' / ');
      if (e.currentQty === newQty) {
        unchanged += 1;
        rows.push({ status: '変更なし', productId: e.id, name: e.name, barcode, currentQty: e.currentQty, newQty, shopifyOnHand: shop.onHand, note });
      } else {
        changed += 1;
        if (isProdDup) dupProductsSkipped += 0; // (集計用ダミー: 重複も書く)
        writeTargets.push({ id: e.id, newQty });
        rows.push({ status: '変更', productId: e.id, name: e.name, barcode, currentQty: e.currentQty, newQty, shopifyOnHand: shop.onHand, note });
      }
    }
  }

  // Shopify にあるが prod に無い barcode
  let shopifyOnlyBarcodes = 0;
  for (const barcode of byBarcode.keys()) {
    if (!prodByBarcode.has(barcode)) shopifyOnlyBarcodes += 1;
  }

  // 5) サマリ
  console.log('\n===== 突合サマリ =====');
  console.log(`一致した prod 商品           : ${matchedProducts}件`);
  console.log(`  └ 変更(在庫が変わる)       : ${changed}件  ← ${APPLY ? '今回書き込む' : 'ドライラン(書き込まない)'}`);
  console.log(`  └ 変更なし(在庫が同じ)     : ${unchanged}件`);
  console.log(`据え置き(barcodeはあるがShopify無): ${unmatchedInShopify}件`);
  console.log(`barcode 無しの prod 商品     : ${prodNoBarcode}件 (対象外)`);
  console.log(`prod 側 重複 barcode         : ${prodDupBarcodes.length}種 (全該当商品に同値適用)`);
  console.log(`Shopify 側 重複 barcode      : ${shopifyDupBarcodes.length}種 (on_hand合算)`);
  console.log(`Shopify のみ(prodに無いbarcode): ${shopifyOnlyBarcodes}件 (無視)`);

  // 6) CSV 出力
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `match-${APPLY ? 'applied' : 'dryrun'}.csv`);
  writeCsv(csvPath, rows);
  // 重複 barcode 詳細も別 CSV
  const dupRows = [];
  for (const [barcode, arr] of prodDupBarcodes) {
    for (const e of arr) dupRows.push({ status: 'prod重複', productId: e.id, name: e.name, barcode, currentQty: e.currentQty, newQty: '', shopifyOnHand: byBarcode.get(barcode)?.onHand ?? '', note: `prod重複${arr.length}件` });
  }
  if (dupRows.length) writeCsv(path.join(outDir, 'prod-duplicate-barcodes.csv'), dupRows);
  console.log(`\nCSV: ${csvPath}${dupRows.length ? `\nCSV: ${path.join(outDir, 'prod-duplicate-barcodes.csv')}` : ''}`);

  // 7) 書き込み(本実行のみ)
  if (!APPLY) {
    console.log('\n*** ドライランです。書き込みは行っていません。本実行は --apply を付けてください。 ***');
    process.exit(0);
  }

  console.log(`\n本実行: ${writeTargets.length}件を書き込みます...`);
  const inventoryCol = storeRef.collection('inventory');
  const productsCol = storeRef.collection('products');
  let written = 0;
  // 1商品あたり2 write(product + inventory) → 250商品/バッチ
  const CHUNK = 250;
  for (let i = 0; i < writeTargets.length; i += CHUNK) {
    const batch = db.batch();
    const slice = writeTargets.slice(i, i + CHUNK);
    for (const t of slice) {
      batch.set(productsCol.doc(t.id), {
        inventoryQuantity: t.newQty,
        quantity: t.newQty,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      batch.set(inventoryCol.doc(t.id), {
        productId: t.id,
        quantity: t.newQty,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    written += slice.length;
    console.log(`  書き込み ${written}/${writeTargets.length}`);
  }
  console.log(`\n完了: ${written}件 更新しました。`);
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
