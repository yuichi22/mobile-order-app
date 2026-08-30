/**
 * 原価スナップ書き戻し（prod / 名前付きDB "main"）。
 *
 * スナップ機能導入前(6月以前)の POS 物販明細は原価が無く、日計/分析の粗利に入らない。
 * 会計時(PosMain resolveItemCost)と同一の掛け率連鎖で原価を再計算し、明細に
 * costPrice/costRate/costSource/cost*Amount/grossProfit* を付与する。
 *
 * 触るのは「原価スナップが無い(costPrice 未設定)物販明細」だけ。売上・税・掛け率マスタは一切変更しない。
 * 掛け率(brands/suppliers/salesAreas.costRate)は読むだけ。
 *
 * 既定はドライラン(書込無し・集計＋サンプル)。本実行は --apply。
 *   node scripts/backfillCostSnapshotProd.cjs           # ドライラン
 *   node scripts/backfillCostSnapshotProd.cjs --apply   # 本実行(prod書込)
 */
const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore');

const PROJECT_ID = 'mobile-order-prod';
const STORE_ID = 'store_ar2y9';
const APPLY = process.argv.includes('--apply');
// 対象期間: prod開始(2026-05)〜6月末。スナップ済み明細は自動でスキップするので範囲は広めでも安全。
const START = new Date(2026, 4, 1, 0, 0, 0);   // 2026-05-01
const END = new Date(2026, 5, 30, 23, 59, 59); // 2026-06-30

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore('main');
const T = admin.firestore.Timestamp;

const pickRate = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const hasCostSnap = (it) => it.costPrice !== null && it.costPrice !== undefined && it.costPrice !== '' && Number.isFinite(Number(it.costPrice));
const isRetail = (it) => Boolean(String(it.salesAreaId || '').trim() || String(it.salesAreaName || '').trim());

(async () => {
  const base = db.collection('stores').doc(STORE_ID);
  const [prodSnap, brandSnap, supSnap, areaSnap] = await Promise.all([
    base.collection('products').get(),
    base.collection('brands').get(),
    base.collection('suppliers').get(),
    base.collection('productSalesAreas').get()
  ]);
  const productById = new Map(prodSnap.docs.map((d) => [String(d.id), d.data()]));
  const brandById = new Map(brandSnap.docs.map((d) => [String(d.id), d.data()]));
  const supById = new Map(supSnap.docs.map((d) => [String(d.id), d.data()]));
  const areaRateById = new Map();
  const areaRateByName = new Map();
  areaSnap.docs.forEach((d) => {
    const a = d.data();
    const r = pickRate(a.costRate);
    if (r === null) return;
    areaRateById.set(String(d.id), r);
    if (a.name) areaRateByName.set(String(a.name), r);
  });
  console.log(`master: products=${productById.size} brands=${brandById.size} suppliers=${supById.size} areas(costRate)=${areaRateById.size}`);

  // 会計時 resolveItemCost と同じ優先度: 商品原価 > 商品率 > ブランド率 > 仕入先率 > 売り場率。
  // 6月明細は brandId/率を持たないため productId→商品マスターから解決する。
  const resolveCost = (item) => {
    const product = item.productId ? productById.get(String(item.productId)) : null;
    const unitIncl = pickRate(item.productCostTaxIncludedUnit) ?? pickRate(product?.costTaxIncluded);
    if (unitIncl !== null) {
      const unitExcl = pickRate(item.productCostTaxExcludedUnit) ?? pickRate(product?.costTaxExcluded) ?? unitIncl;
      return { source: 'product_cost', unitIncl, unitExcl, rate: null };
    }
    const brandId = String(item.brandId || product?.brandId || '').trim();
    const brand = brandId ? brandById.get(brandId) : null;
    const supplier = brand?.supplierId ? supById.get(String(brand.supplierId)) : null;
    const productRate = pickRate(item.productSupplierCostRate) ?? pickRate(product?.supplierCostRate);
    if (productRate !== null) return { source: 'product_rate', rate: productRate };
    const brandRate = pickRate(brand?.defaultCostRate);
    if (brandRate !== null) return { source: 'brand_rate', rate: brandRate };
    const supplierRate = pickRate(supplier?.defaultCostRate);
    if (supplierRate !== null) return { source: 'supplier_rate', rate: supplierRate };
    if (item.salesAreaId && areaRateById.has(String(item.salesAreaId))) return { source: 'sales_area_rate', rate: areaRateById.get(String(item.salesAreaId)) };
    if (item.salesAreaName && areaRateByName.has(String(item.salesAreaName))) return { source: 'sales_area_rate', rate: areaRateByName.get(String(item.salesAreaName)) };
    return { source: null, rate: null };
  };

  const buildCostFields = (item) => {
    const info = resolveCost(item);
    if (info.source === null) return null;
    const qty = Math.max(num(item.quantity), 0);
    const includedNet = num(item.salesTaxIncludedAmount ?? item.totalPrice ?? item.taxIncludedAmount);
    const baseNet = num(item.salesTaxExcludedAmount ?? includedNet);
    const unitPrice = num(item.unitPrice ?? item.takeoutPrice);
    // 原価は「定価(割引前)×掛け率」で固定。値引きが記録されていれば originalLineTotal(税込)を定価とみなす。
    // ※値引きをレジ打鍵せず売価を直接手打ちした明細は定価が残らずここでは救済不可(現状維持)。
    const includedRaw = Math.max(num(item.originalLineTotal), includedNet);
    const baseRaw = includedNet > 0 ? Math.round(baseNet * (includedRaw / includedNet)) : baseNet;
    let costTaxIncludedAmount; let costTaxExcludedAmount; let costPrice; let costRate = null;
    if (info.source === 'product_cost') {
      costTaxIncludedAmount = Math.round(info.unitIncl * qty);
      costTaxExcludedAmount = Math.round(info.unitExcl * qty);
      costPrice = info.unitIncl;
    } else {
      costRate = info.rate;
      const f = Math.max(0, Math.min(100, Number(info.rate))) / 100;
      costTaxIncludedAmount = Math.round(includedRaw * f);
      costTaxExcludedAmount = Math.round(baseRaw * f);
      costPrice = Math.round(unitPrice * f);
    }
    return {
      costPrice,
      costRate,
      costSource: info.source,
      costTaxIncludedAmount,
      costTaxExcludedAmount,
      grossProfitTaxIncluded: includedNet - costTaxIncludedAmount,
      grossProfitTaxExcluded: baseNet - costTaxExcludedAmount
    };
  };

  const txSnap = await base.collection('transactions')
    .where('paidAt', '>=', T.fromDate(START)).where('paidAt', '<=', T.fromDate(END)).get();

  let txScanned = 0; let txToUpdate = 0; let itemsFilled = 0; let itemsSkippedSnap = 0; let itemsUnresolved = 0;
  const bySource = {};
  const samples = [];
  let batch = db.batch(); let batchCount = 0; let committed = 0;

  for (const doc of txSnap.docs) {
    const t = doc.data();
    if (t.isPaid === false) continue;
    const ch = t.salesChannel || (t.registerMode === 'pos' ? 'pos_register' : '');
    if (ch !== 'pos_register') continue;
    txScanned += 1;
    const items = Array.isArray(t.items) ? t.items : [];
    let changed = false;
    const nextItems = items.map((it) => {
      if (!isRetail(it)) return it;
      if (hasCostSnap(it)) { itemsSkippedSnap += 1; return it; }
      const cost = buildCostFields(it);
      if (!cost) { itemsUnresolved += 1; return it; }
      itemsFilled += 1;
      bySource[cost.costSource] = (bySource[cost.costSource] || 0) + 1;
      if (samples.length < 8) samples.push(`${it.name}: 率${cost.costRate ?? '-'}%(${cost.costSource}) 原価¥${cost.costTaxExcluded_ ?? cost.costTaxExcludedAmount} 粗利¥${cost.grossProfitTaxExcluded}`);
      changed = true;
      return { ...it, ...cost };
    });
    if (changed) {
      txToUpdate += 1;
      if (APPLY) {
        batch.update(doc.ref, { items: nextItems, costBackfilledAt: admin.firestore.FieldValue.serverTimestamp() });
        batchCount += 1;
        if (batchCount >= 400) { await batch.commit(); committed += batchCount; batch = db.batch(); batchCount = 0; }
      }
    }
  }
  if (APPLY && batchCount > 0) { await batch.commit(); committed += batchCount; }

  console.log(`\n=== ${APPLY ? '本実行(APPLY)' : 'ドライラン'} 2026-05-01〜06-30 ===`);
  console.log(`POS取引 走査:${txScanned} / 更新対象取引:${txToUpdate}${APPLY ? ` / コミット:${committed}` : ''}`);
  console.log(`明細: 原価付与:${itemsFilled} / スナップ済スキップ:${itemsSkippedSnap} / 解決不可:${itemsUnresolved}`);
  console.log('原価の出所別:', JSON.stringify(bySource));
  console.log('サンプル:'); samples.forEach((s) => console.log('  ', s));
  process.exit(0);
})().catch((e) => { console.error('ERROR', e.code || '', e.message); process.exit(1); });
