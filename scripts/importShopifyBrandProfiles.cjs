/**
 * Shopify 商品メタフィールド my_fields._brand(ブランドプロフィール)を
 * POS ブランドマスター(brands/{id}.note = UIの「ブランドプロフィール」欄)へ取り込む。
 *
 * ルール(2026-07-13 ユーザー指示):
 *  - Shopify 全商品から vendor ごとにプロフィール文を収集(複数ある場合は最長を採用)。
 *  - POS ブランドと名前(正規化)で突合し、**Shopifyの方が長い場合のみ note を上書き**。
 *  - 書き込みは note + updatedAt のみ(掛け率・仕入先等は不触)。実DB = named DB「main」。
 *
 * 使い方:
 *   node scripts/importShopifyBrandProfiles.cjs           # ドライラン(CSV出力のみ)
 *   node scripts/importShopifyBrandProfiles.cjs --apply   # 本実行(prod main へ書き込み)
 */

const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

// firebase-admin は functions/node_modules を使う(サブパスはパッケージ名解決が必要)。
const requireFromFunctions = createRequire(path.join(__dirname, '../functions/index.js'));
const admin = requireFromFunctions('firebase-admin');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');

const PROJECT_ID = 'mobile-order-prod';
const STORE_ID = 'store_ar2y9';
const API_VERSION = '2026-01';
const APPLY = process.argv.includes('--apply');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = getFirestore('main'); // ⚠実DBは named DB「main」。(default)は旧・放置

const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outDir = `local_exports/shopify-brand-profiles-${nowStamp()}`;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ブランド名の突合キー: 前後空白除去・小文字化・空白(半/全角)圧縮。
const nameKey = (v) => String(v || '').trim().toLowerCase().replace(/[\s　]+/g, ' ');

const getToken = async (settings) => {
  const shopDomain = String(settings.shopDomain || '').trim().toLowerCase();
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: String(settings.clientId || '').trim(),
      client_secret: String(settings.clientSecret || '').trim()
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('Shopifyアクセストークン取得に失敗。');
  return { shopDomain, accessToken: body.access_token };
};

const gql = async ({ shopDomain, accessToken, query, variables }, retries = 6) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query, variables })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.errors) return body.data || {};
    const msg = JSON.stringify(body.errors || res.status);
    if (/throttl/i.test(msg) && attempt < retries) {
      await sleepMs(Math.min(8000, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(msg);
  }
  throw new Error('unreachable');
};

const writeCsv = (filePath, rows, header) => {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(filePath, [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n'), 'utf8');
};

(async () => {
  console.log(`=== Shopifyブランドプロフィール → POS brands.note (${APPLY ? '本実行(APPLY)' : 'ドライラン'}) ===`);
  console.log(`project=${PROJECT_ID} db=main store=${STORE_ID}`);

  const storeRef = db.collection('stores').doc(STORE_ID);
  const settings = (await storeRef.collection('settings').doc('shopify').get()).data() || {};
  const { shopDomain, accessToken } = await getToken(settings);
  console.log(`shopDomain=${shopDomain}`);

  // 1) Shopify 全商品: vendor + my_fields._brand → vendor別に最長プロフィールを採用
  console.log('Shopify 商品を走査中...');
  const profileByVendor = new Map(); // key -> { vendor, text, count, variants:Set(異なる文面数) }
  const query = `query($cursor:String){ products(first:100, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes{ vendor metafield(namespace:"my_fields",key:"_brand"){ value } } } }`;
  let cursor = null;
  let scanned = 0;
  let withProfile = 0;
  do {
    const d = await gql({ shopDomain, accessToken, query, variables: { cursor } });
    const c = d.products;
    for (const p of c.nodes) {
      scanned += 1;
      const vendor = String(p.vendor || '').trim();
      const text = String(p.metafield?.value || '').trim();
      if (!vendor || !text) continue;
      withProfile += 1;
      const key = nameKey(vendor);
      const cur = profileByVendor.get(key);
      if (!cur) {
        profileByVendor.set(key, { vendor, text, count: 1, texts: new Set([text]) });
      } else {
        cur.count += 1;
        cur.texts.add(text);
        if (text.length > cur.text.length) cur.text = text; // 最長採用
      }
    }
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
    if (scanned % 2000 < 100) console.log(`  ...${scanned}件走査`);
  } while (cursor);
  console.log(`Shopify: 商品${scanned}件 / プロフィール付き${withProfile}件 / vendor数${profileByVendor.size}`);

  // 2) POS ブランド全件(main)
  const brandsSnap = await storeRef.collection('brands').get();
  console.log(`POS brands: ${brandsSnap.size}件`);

  // 3) 突合・判定
  const rows = [];
  let overwrite = 0, keepLonger = 0, same = 0, noShopify = 0;
  const targets = [];
  brandsSnap.forEach((d) => {
    const b = d.data() || {};
    const key = nameKey(b.name);
    const hit = profileByVendor.get(key);
    const posNote = String(b.note || '').trim();
    if (!hit) { noShopify += 1; return; }
    const shopifyText = hit.text;
    if (shopifyText === posNote) {
      same += 1;
      rows.push({ action: '同一', brand: b.name, posLen: posNote.length, shopifyLen: shopifyText.length, textVariants: hit.texts.size, preview: '' });
      return;
    }
    if (shopifyText.length > posNote.length) {
      overwrite += 1;
      targets.push({ id: d.id, name: b.name, note: shopifyText });
      rows.push({ action: '上書き', brand: b.name, posLen: posNote.length, shopifyLen: shopifyText.length, textVariants: hit.texts.size, preview: shopifyText.slice(0, 60).replace(/\n/g, ' ') });
    } else {
      keepLonger += 1;
      rows.push({ action: '据え置き(POSの方が長い)', brand: b.name, posLen: posNote.length, shopifyLen: shopifyText.length, textVariants: hit.texts.size, preview: '' });
    }
  });

  console.log('\n===== 判定サマリ =====');
  console.log(`上書き(Shopifyの方が長い) : ${overwrite}件 ← ${APPLY ? '書き込む' : 'ドライラン'}`);
  console.log(`据え置き(POSの方が長い)   : ${keepLonger}件`);
  console.log(`同一                      : ${same}件`);
  console.log(`Shopifyに該当vendor無し    : ${noShopify}件`);

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `plan-${APPLY ? 'applied' : 'dryrun'}.csv`);
  writeCsv(csvPath, rows, ['action', 'brand', 'posLen', 'shopifyLen', 'textVariants', 'preview']);
  console.log(`\nCSV: ${csvPath}`);

  if (!APPLY) {
    console.log('\n*** ドライランです。書き込みは行っていません。本実行は --apply ***');
    process.exit(0);
  }

  console.log(`\n本実行: ${targets.length}件の note を上書きします...`);
  let written = 0;
  for (let i = 0; i < targets.length; i += 250) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + 250)) {
      batch.set(storeRef.collection('brands').doc(t.id), {
        note: t.note,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    written += Math.min(250, targets.length - i);
    console.log(`  ${written}/${targets.length}`);
  }
  console.log(`\n完了: ${written}件 上書きしました。`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
