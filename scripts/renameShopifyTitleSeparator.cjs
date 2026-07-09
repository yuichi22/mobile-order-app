/**
 * Shopify 既存商品タイトルの区切りを「/」→「｜」(全角縦棒) に一括変更するスクリプト。
 *
 * ルール(ユーザー確認済み 2026-07-06):
 *  - タイトル中で最初に現れる 半角「/」または全角「／」1個だけを、前後の空白(半角/全角)ごと「｜」に置換。
 *  - 2個目以降の「/」(色コード col.BG/RD や T/C 等)は触らない。
 *  - カテゴリ接頭辞(例「ペット用品 - 」)はそのまま残す。
 *  - 既に「｜」を含むタイトルはスキップ(二重置換防止)。
 *  - 「最初の/が区切りでない可能性」があるものは suspicious フラグを付け、--apply 時は対象から外す
 *    (確認して問題なければ --include-suspicious で含められる)。
 *
 * 使い方:
 *   node scripts/renameShopifyTitleSeparator.cjs                       # ドライラン(CSV出力のみ)
 *   node scripts/renameShopifyTitleSeparator.cjs --apply               # 本実行(suspicious除く)
 *   node scripts/renameShopifyTitleSeparator.cjs --apply --include-suspicious
 *
 * 対象: prod (mobile-order-prod / store_ar2y9) の settings/shopify に紐づく Shopify ストア。
 * 資格情報はログに出さない。
 */

const admin = require('../functions/node_modules/firebase-admin');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mobile-order-prod';
const STORE_ID = 'store_ar2y9';
const API_VERSION = '2026-01';

const APPLY = process.argv.includes('--apply');
const INCLUDE_SUSPICIOUS = process.argv.includes('--include-suspicious');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outDir = `local_exports/shopify-title-separator-${nowStamp()}`;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- タイトル変換 ------------------------------------------------------------

// 最初の / または ／ を、前後の空白(半角/全角)ごと ｜ に置換。
const SEP_RE = /[\s　]*[/／][\s　]*/; // 非グローバル=最初の1個だけ

// スラッシュが名前の一部であるブランド等(区切りとして扱わない)。
// 例: F/CE. → 「F/CE./　RUCKSACK」は F/CE. の後の / が区切り。
const PROTECTED_TOKENS = ['F/CE.'];
const PLACEHOLDER = '\u0000';

// 保護: PROTECTED_TOKENS 内と 【...】内(再入荷日付等)の / を一時的に置換して区切り判定から外す。
const protectTitle = (title) => {
  let t = title;
  for (const tok of PROTECTED_TOKENS) {
    t = t.split(tok).join(tok.replace(/[/／]/g, PLACEHOLDER));
  }
  t = t.replace(/【[^】]*】/g, (m) => m.replace(/[/／]/g, PLACEHOLDER));
  return t;
};
const restoreTitle = (t) => t.split(PLACEHOLDER).join('/');

const buildNewTitle = (title) => {
  const prot = protectTitle(title);
  if (!SEP_RE.test(prot)) return null;
  const replaced = restoreTitle(prot.replace(SEP_RE, '｜'));
  return replaced === title ? null : replaced;
};

// 性別等、区切りの右側として正当な既知トークン(短くてもsuspicious扱いしない)。
const KNOWN_RIGHT_TOKENS = new Set(['MEN', 'WOMEN', 'UNISEX', 'KIDS', 'MENS', 'WOMENS']);

// 「最初の/が区切りでない可能性」の検出(保護後のタイトルで判定)。
// - 最初の / が括弧 () （） 内にある (例: "... (Sサイズ / col.NT)")
// - 最初の / の直前が "col." 等の色表記 (単語境界つき: COLDBREAKER/récolte誤検知防止)
// - 最初の / の両側が短い英大文字コード (T/C, L/S, R/S 等) かつ前後に空白が無い
//   ※右側が MEN/WOMEN 等の既知トークンなら正当な区切りとみなす
const isSuspicious = (title) => {
  const prot = protectTitle(title);
  const m = prot.match(/[/／]/);
  if (!m) return false;
  const idx = m.index;

  // 括弧内か: / より前の未クローズ括弧
  const before = prot.slice(0, idx);
  const opens = (before.match(/[(（]/g) || []).length;
  const closes = (before.match(/[)）]/g) || []).length;
  if (opens > closes) return true;

  // 直前が col. 系(ドット必須・前が英字でない位置から col が始まる場合のみ。
  // COLDBREAKER/récolte/COLOVE 等「colで始まる単語」の誤検知を防ぐ)
  if (/(^|[^A-Za-z])col\.\s*[A-Za-z0-9]*$/i.test(before.trim())) return true;

  // 両側が短い英数大文字コードで空白無し (T/C, L/S, R/S)
  const prevChar = prot[idx - 1] || '';
  const nextChar = prot[idx + 1] || '';
  const noSpace = !/[\s　]/.test(prevChar) && !/[\s　]/.test(nextChar);
  if (noSpace) {
    const leftWord = (before.match(/[A-Za-z0-9]+$/) || [''])[0];
    const rightWord = (prot.slice(idx + 1).match(/^[A-Za-z0-9]+/) || [''])[0];
    if (KNOWN_RIGHT_TOKENS.has(rightWord.toUpperCase())) return false;
    if (
      leftWord && rightWord &&
      leftWord.length <= 3 && rightWord.length <= 3 &&
      leftWord === leftWord.toUpperCase() && rightWord === rightWord.toUpperCase()
    ) return true;
  }

  return false;
};

// ---- Shopify ----------------------------------------------------------------

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

// ---- CSV --------------------------------------------------------------------

const writeCsv = (filePath, rows, header) => {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(','));
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
};

// ---- main -------------------------------------------------------------------

(async () => {
  console.log(`=== Shopifyタイトル区切り「/」→「｜」 (${APPLY ? `本実行(APPLY${INCLUDE_SUSPICIOUS ? '+suspicious込み' : ''})` : 'ドライラン'}) ===`);

  const settings = (await db.collection('stores').doc(STORE_ID).collection('settings').doc('shopify').get()).data() || {};
  const { shopDomain, accessToken } = await getToken(settings);
  console.log(`shopDomain=${shopDomain}`);

  // 全商品タイトル取得
  const query = `query($cursor:String){ products(first:100, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes{ id title status } } }`;
  const all = [];
  let cursor = null;
  do {
    const d = await gql({ shopDomain, accessToken, query, variables: { cursor } });
    const c = d.products;
    all.push(...c.nodes);
    cursor = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
    if (all.length % 2000 < 100) console.log(`  ...${all.length}件取得`);
  } while (cursor);
  console.log(`総商品数: ${all.length}`);

  // 変換計画
  const rows = [];
  let planned = 0, skippedBar = 0, skippedNoSep = 0, suspiciousCount = 0;
  for (const p of all) {
    const title = String(p.title || '');
    if (title.includes('｜') || title.includes('|')) { skippedBar++; continue; }
    const newTitle = buildNewTitle(title);
    if (!newTitle || newTitle === title) { skippedNoSep++; continue; }
    const sus = isSuspicious(title);
    if (sus) suspiciousCount++;
    else planned++;
    rows.push({
      flag: sus ? 'SUSPICIOUS(要確認)' : 'change',
      status: p.status,
      id: p.id,
      before: title,
      after: newTitle
    });
  }

  console.log('\n===== 計画サマリ =====');
  console.log(`変更予定(通常)        : ${planned}件`);
  console.log(`要確認(suspicious)    : ${suspiciousCount}件 ${APPLY && !INCLUDE_SUSPICIOUS ? '(今回は対象外)' : ''}`);
  console.log(`スキップ(｜既存)      : ${skippedBar}件`);
  console.log(`スキップ(区切り無し)  : ${skippedNoSep}件`);

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `plan-${APPLY ? 'applied' : 'dryrun'}.csv`);
  writeCsv(csvPath, rows, ['flag', 'status', 'id', 'before', 'after']);
  console.log(`\nCSV: ${csvPath}`);

  if (!APPLY) {
    console.log('\n*** ドライランです。Shopifyには書き込んでいません。 ***');
    process.exit(0);
  }

  // 本実行
  const targets = rows.filter((r) => r.flag === 'change' || (INCLUDE_SUSPICIOUS && r.flag !== 'change'));
  console.log(`\n本実行: ${targets.length}件のタイトルを更新します...`);
  const mutation = `mutation($input: ProductInput!){ productUpdate(input:$input){ userErrors{ field message } } }`;
  let done = 0; const errors = [];
  for (const t of targets) {
    try {
      const d = await gql({ shopDomain, accessToken, query: mutation, variables: { input: { id: t.id, title: t.after } } });
      const errs = d.productUpdate?.userErrors || [];
      if (errs.length) errors.push({ id: t.id, before: t.before, error: errs.map((e) => e.message).join('; ') });
    } catch (e) {
      errors.push({ id: t.id, before: t.before, error: e.message });
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${targets.length}`);
    await sleepMs(120); // スロットル回避
  }
  console.log(`\n完了: ${done}件処理 / エラー ${errors.length}件`);
  if (errors.length) {
    writeCsv(path.join(outDir, 'errors.csv'), errors, ['id', 'before', 'error']);
    console.log(`エラーCSV: ${path.join(outDir, 'errors.csv')}`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
