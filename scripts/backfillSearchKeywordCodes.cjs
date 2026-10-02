#!/usr/bin/env node
/**
 * searchKeywords にバーコード/SKU/品番が入っていない商品のキーワードを再生成する。
 *
 * 背景: キーワードは120語上限で、旧ロジックは商品名を先に積んでいたため、
 *   長い/記号入りの商品名だとコード類が切り捨てられ、管理画面のスキャン検索で出なかった。
 *   functions の syncProductSearchKeywords はコード類を先頭に積むよう修正済み。
 *   ⚠ 必ず修正版の関数をデプロイしてから実行する(旧関数だと書き戻される)。
 *
 * 書き込むのは searchKeywords / searchKeywordsVersion / searchKeywordsUpdatedAt のみ
 * (在庫・価格は触らない → 発注点/Shopify在庫pushのトリガーは発火しない)。
 *
 * 使い方:
 *   node scripts/backfillSearchKeywordCodes.cjs <dev|prod> [storeId]          # dry-run
 *   node scripts/backfillSearchKeywordCodes.cjs <dev|prod> [storeId] --apply
 */
const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore, FieldValue } = require('../functions/node_modules/firebase-admin/lib/firestore');

const PROJECTS = { dev: 'mobile-order-dev-5f7fd', prod: 'mobile-order-prod' };
const [envArg, storeArg] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const APPLY = process.argv.includes('--apply');
const PROJECT_ID = PROJECTS[envArg];
if (!PROJECT_ID) {
  console.error('usage: node scripts/backfillSearchKeywordCodes.cjs <dev|prod> [storeId] [--apply]');
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore('main');

// ---- functions/index.js の buildProductSearchKeywordsForFunction と同一ロジック ----
const PRODUCT_SEARCH_KEYWORDS_VERSION = 2;
const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const addTerm = (terms, value) => {
  const normalized = normalize(value);
  if (!normalized) return;
  terms.add(normalized);
  const parts = normalized.split(/[\s　/／・,，、.。_\-ー]+/).map((part) => normalize(part)).filter(Boolean);
  parts.forEach((part) => {
    terms.add(part);
    if (/^[a-z0-9]+$/.test(part) && part.length >= 2) {
      const max = Math.min(part.length, 12);
      for (let index = 2; index <= max; index += 1) terms.add(part.slice(0, index));
    }
  });
  const compact = normalized.replace(/[\s　/／・,，、.。_\-ー]+/g, '');
  if (compact) {
    terms.add(compact);
    if (/^[a-z0-9]+$/.test(compact) && compact.length >= 2) {
      const max = Math.min(compact.length, 16);
      for (let index = 2; index <= max; index += 1) terms.add(compact.slice(0, index));
    }
    if (!/^[a-z0-9]+$/.test(compact) && compact.length >= 2) {
      const maxGram = Math.min(6, compact.length);
      for (let size = 2; size <= maxGram; size += 1) {
        for (let start = 0; start <= compact.length - size; start += 1) {
          terms.add(compact.slice(start, start + size));
          if (terms.size >= 120) return;
        }
      }
    }
  }
};
const buildKeywords = (p = {}) => {
  const terms = new Set();
  [
    p.sku, p.productCode, p.code, p.barcode, p.janCode,
    p.name, p.productName, p.title, p.productGroupTitle,
    p.brandName, p.vendor, p.categoryGroupName, p.categoryName, p.subCategoryName,
    p.salesAreaName, p.productType, p.colorName, p.color, p.colorCode,
    p.size, p.sizeName, p.option1, p.option2, p.option3
  ].forEach((value) => addTerm(terms, value));
  return Array.from(terms).filter(Boolean).slice(0, 120);
};
// ------------------------------------------------------------------------------

const CODE_FIELDS = ['barcode', 'sku', 'productCode'];

const run = async () => {
  const storeIds = storeArg
    ? [storeArg]
    : (await db.collection('stores').get()).docs.map((doc) => doc.id);

  let totalTargets = 0;
  for (const storeId of storeIds) {
    const snap = await db.collection('stores').doc(storeId).collection('products').get();
    const targets = [];
    snap.forEach((doc) => {
      const product = doc.data();
      const current = new Set((product.searchKeywords || []).map((value) => normalize(value)));
      const missing = CODE_FIELDS
        .map((field) => normalize(product[field]))
        .filter((code) => code && !current.has(code));
      if (missing.length) targets.push({ ref: doc.ref, name: product.name, missing, next: buildKeywords(product) });
    });

    console.log(`${storeId}: products=${snap.size} codeMissing=${targets.length}`);
    targets.slice(0, 5).forEach((target) => console.log(`  e.g. ${target.ref.id} ${target.name} missing=${target.missing.join(',')}`));
    totalTargets += targets.length;

    if (!APPLY || !targets.length) continue;
    for (let index = 0; index < targets.length; index += 400) {
      const batch = db.batch();
      targets.slice(index, index + 400).forEach((target) => batch.update(target.ref, {
        searchKeywords: target.next,
        searchKeywordsVersion: PRODUCT_SEARCH_KEYWORDS_VERSION,
        searchKeywordsUpdatedAt: FieldValue.serverTimestamp()
      }));
      await batch.commit();
    }
    console.log(`  updated ${targets.length}`);
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} total=${totalTargets} project=${PROJECT_ID}`);
};

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
