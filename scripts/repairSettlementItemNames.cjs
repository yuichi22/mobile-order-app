/**
 * 販促費/金券の明細名が「全体割引名」で集約されてしまった取引を補修する。
 *
 * 背景(2026-07-17):
 *  - PosMain(テイクアウト/物販)の会計処理が、値引きを会計区分へ振り分けた後、各区分の明細を
 *    appliedDiscount(全体割引)の名前で1件に集約して保存していた(修正コミット b26e1a5)。
 *  - そのため
 *      例1) 商品の販促費30%(個別割引) ＋ 支払のおまっちぇ(金券) を併用 →
 *           販促費が「おまっちぇ」名義で日計の割引/金券欄に表示される。
 *      例2) 複数クーポン併用 → 「2種類 / 6枚」の1件に集約され、個々のクーポン名・枚数・券面が失われる。
 *
 * 補修内容:
 *  - promoExpenseItems / vouchers を、取引に残っている
 *      lineDiscountItems（個別割引） ＋ appliedDiscount.items / appliedDiscount（全体割引）
 *    から「その区分に実際に寄与した割引」の明細(名前/種別/券面/枚数)で作り直す。
 *  - 配分額は保存済みの promoExpenseAmount / voucherAmount に一致させる(端数は最終要素で吸収)。
 *  - 金額(totalAmount/promoExpenseAmount/voucherAmount 等)・区分・その他フィールドは一切変更しない。
 *  - 復元元が無い / 合計が一致しない取引はスキップ(手動確認)。
 *
 * 使い方:
 *   node scripts/repairSettlementItemNames.cjs --env prod --days 2            # ドライラン(表示のみ)
 *   node scripts/repairSettlementItemNames.cjs --env prod --days 2 --apply    # 適用(要承認)
 *   node scripts/repairSettlementItemNames.cjs --env prod --ids a,b --apply   # 対象txIdを限定
 */

const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');

const ENVS = {
  dev: { projectId: 'mobile-order-dev-5f7fd', storeId: 'store_0dtao' },
  prod: { projectId: 'mobile-order-prod', storeId: 'store_ar2y9' }
};

const argValue = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const envName = argValue('--env', 'dev');
const days = Number(argValue('--days', 2));
const onlyIds = String(argValue('--ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const APPLY = process.argv.includes('--apply');
const target = ENVS[envName];

if (!target) {
  console.error('使い方: node scripts/repairSettlementItemNames.cjs --env dev|prod [--days N] [--ids a,b] [--apply]');
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main'); // 実データは名前付きDB main

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const categoryOf = (entry) => (
  entry?.accountingCategory === 'promo_expense' || entry?.accountingCategory === 'voucher_payment'
    ? entry.accountingCategory
    : 'sales_discount'
);

const defaultNameOf = (category) => (
  category === 'promo_expense' ? '販促費' : category === 'voucher_payment' ? '金券/売掛' : '値引き'
);

// 取引に残っている「実際の割引明細」を集める(個別割引 ＋ 全体割引の内訳/本体)。
const collectSourceItems = (transaction) => {
  const lineItems = Array.isArray(transaction.lineDiscountItems) ? transaction.lineDiscountItems : [];
  const applied = Array.isArray(transaction.appliedDiscounts) && transaction.appliedDiscounts.length > 0
    ? transaction.appliedDiscounts
    : (transaction.appliedDiscount ? [transaction.appliedDiscount] : []);

  const appliedItems = [];
  applied.forEach((discount) => {
    if (Array.isArray(discount?.items) && discount.items.length > 0) {
      discount.items.forEach((item) => appliedItems.push(item));
    } else if (discount) {
      appliedItems.push(discount);
    }
  });

  return [...lineItems, ...appliedItems];
};

// 区分ごとに、実際の割引明細から保存用エントリを作る。合計は storedTotal に合わせる。
const buildItemsForCategory = (sourceItems, category, storedTotal) => {
  const picked = sourceItems.filter((item) => categoryOf(item) === category && num(item.amount) > 0);
  if (picked.length === 0) return null;

  const rawTotal = picked.reduce((sum, item) => sum + num(item.amount), 0);
  if (rawTotal <= 0) return null;

  let allocated = 0;
  return picked.map((item, index) => {
    const isLast = index === picked.length - 1;
    const portion = isLast
      ? storedTotal - allocated
      : Math.floor(storedTotal * (num(item.amount) / rawTotal));
    allocated += portion;

    return {
      id: item.id || category,
      name: item.name || item.label || defaultNameOf(category),
      type: item.type || '',
      value: num(item.value ?? portion),
      amount: portion,
      count: Math.max(1, num(item.count ?? 1)),
      quantity: Math.max(1, num(item.quantity ?? item.count ?? 1)),
      accountingCategory: category
    };
  });
};

const sameItems = (left = [], right = []) => JSON.stringify(left) === JSON.stringify(right);

// 補修対象は「今回のバグで壊れたもの」だけに限定する。
// 他経路で正しく保存された明細(例: 「おまっちぇ × 1枚」「社員割引 20%引き × 1枚」)は触らない。
//  (1) 複数クーポンが1件に集約され、個々のクーポン名・枚数・券面が失われている(id=multiple_coupons)
//  (2) 全体割引の名前が「別区分」の明細に付いている(例: 販促費の明細名が金券の「おまっちぇ」)
const isSuspect = (storedItems, applied, category) => {
  if (!Array.isArray(storedItems) || storedItems.length === 0) return false;

  if (storedItems.some((item) => String(item?.id || '') === 'multiple_coupons')) return true;

  const appliedName = String(applied?.name || '').trim();
  if (!appliedName) return false;
  if (categoryOf(applied) === category) return false; // 同じ区分の名前なら取り違えではない

  return storedItems.some((item) => String(item?.name || '').trim() === appliedName);
};

(async () => {
  const col = db.collection('stores').doc(target.storeId).collection('transactions');

  let docs = [];
  if (onlyIds.length > 0) {
    const snaps = await Promise.all(onlyIds.map((id) => col.doc(id).get()));
    docs = snaps.filter((s) => s.exists);
  } else {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const snap = await col.where('paidAt', '>=', admin.firestore.Timestamp.fromDate(since)).get();
    docs = snap.docs;
  }

  console.log(`env=${envName} store=${target.storeId} 対象候補=${docs.length}件 apply=${APPLY}\n`);

  let fixed = 0;
  let skipped = 0;

  for (const doc of docs) {
    const t = doc.data();
    const promoTotal = num(t.promoExpenseAmount);
    const voucherTotal = num(t.voucherAmount);
    if (promoTotal <= 0 && voucherTotal <= 0) continue;

    const applied = (Array.isArray(t.appliedDiscounts) && t.appliedDiscounts[0]) || t.appliedDiscount || null;
    const curPromo = Array.isArray(t.promoExpenseItems) ? t.promoExpenseItems : [];
    const curVoucher = Array.isArray(t.vouchers) ? t.vouchers : [];

    // 今回のバグに該当する区分だけを対象にする(正常な明細は触らない)。
    const promoSuspect = promoTotal > 0 && isSuspect(curPromo, applied, 'promo_expense');
    const voucherSuspect = voucherTotal > 0 && isSuspect(curVoucher, applied, 'voucher_payment');
    if (!promoSuspect && !voucherSuspect) continue;

    const sourceItems = collectSourceItems(t);
    const nextPromo = promoSuspect ? buildItemsForCategory(sourceItems, 'promo_expense', promoTotal) : null;
    const nextVoucher = voucherSuspect ? buildItemsForCategory(sourceItems, 'voucher_payment', voucherTotal) : null;

    // 復元元が見つからない区分があればスキップ(手動確認)。
    if ((promoSuspect && !nextPromo) || (voucherSuspect && !nextVoucher)) {
      console.log(`SKIP ${doc.id}: 復元元の割引明細が見つからない (promo=${promoTotal}, voucher=${voucherTotal})`);
      skipped += 1;
      continue;
    }

    const promoChanged = promoSuspect && !sameItems(curPromo, nextPromo);
    const voucherChanged = voucherSuspect && !sameItems(curVoucher, nextVoucher);
    if (!promoChanged && !voucherChanged) continue;

    // 合計が保存済み金額と一致するか検算(不一致なら触らない)。
    const promoSum = (nextPromo || []).reduce((s, i) => s + num(i.amount), 0);
    const voucherSum = (nextVoucher || []).reduce((s, i) => s + num(i.amount), 0);
    if ((promoSuspect && promoSum !== promoTotal) || (voucherSuspect && voucherSum !== voucherTotal)) {
      console.log(`SKIP ${doc.id}: 合計不一致 promo ${promoSum}/${promoTotal}, voucher ${voucherSum}/${voucherTotal}`);
      skipped += 1;
      continue;
    }

    console.log(`--- ${doc.id} | ${t.registerName || t.registerId || '-'}`);
    if (promoChanged) {
      console.log('  promoExpenseItems BEFORE:', JSON.stringify(curPromo));
      console.log('  promoExpenseItems AFTER :', JSON.stringify(nextPromo));
    }
    if (voucherChanged) {
      console.log('  vouchers BEFORE:', JSON.stringify(curVoucher));
      console.log('  vouchers AFTER :', JSON.stringify(nextVoucher));
    }

    if (APPLY) {
      const payload = {};
      if (promoChanged) payload.promoExpenseItems = nextPromo;
      if (voucherChanged) payload.vouchers = nextVoucher;
      await doc.ref.update(payload);
      console.log('  => 適用しました');
    }
    fixed += 1;
  }

  console.log(`\n${APPLY ? '適用' : 'ドライラン'}: 対象 ${fixed}件 / スキップ ${skipped}件`);
  process.exit(0);
})().catch((error) => {
  console.error('ERROR', error.message);
  process.exit(1);
});
