// 棚卸し在高の評価(Firestore 非依存の純粋関数)。
//
// 原価の決め方:
//   1. 確定時に functions(costLayers.js trimCostLayersOnStocktakeComplete)が明細へ控えた
//      入庫ロット残(costLayerSnapshot)を「新しいロットから」実数に割り当てる(先入先出なので残るのは新しい入庫分)。
//   2. ロットより多い分・原価なしロット・控えの無い商品(ロットなし/機能導入前の在庫/過去の棚卸し)は
//      現在の原価(商品原価 > 商品掛け率 > ブランド > 仕入先 > 売り場)で埋める。
//   3. それでも決まらない分は0円で「原価不明」に数える。

export const positiveRate = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 現在の原価(1個あたり)。null = 原価を決められない。
export const resolveCurrentUnitCost = (product, unitPrice, { taxMode, brandMap, supplierMap, areaRateMap }) => {
  const costField = taxMode === 'included' ? 'costTaxIncluded' : 'costTaxExcluded';
  const direct = Number(product[costField]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const brand = product.brandId ? brandMap.get(String(product.brandId)) : null;
  const supplier = brand?.supplierId ? supplierMap.get(String(brand.supplierId)) : null;
  let rate = positiveRate(product.supplierCostRate)
    ?? positiveRate(brand?.defaultCostRate)
    ?? positiveRate(supplier?.defaultCostRate);
  if (rate == null && product.salesAreaId) rate = areaRateMap.get(String(product.salesAreaId)) ?? null;
  if (rate != null && Number.isFinite(unitPrice)) return unitPrice * Math.min(100, rate) / 100;
  return null;
};

// 1商品の原価。戻り値 { cost, lotQty, currentQty, noCostQty }。
export const valueStocktakeItem = (item, product, qty, unitPrice, ctx) => {
  const lotField = ctx.taxMode === 'included' ? 'unitCostTaxIncluded' : 'unitCostTaxExcluded';
  const lots = (Array.isArray(item.costLayerSnapshot) ? item.costLayerSnapshot : [])
    .filter((l) => Number(l?.remainingQuantity) > 0)
    .sort((a, b) => (Number(b.receivedAtMs) || 0) - (Number(a.receivedAtMs) || 0) || String(b.layerId).localeCompare(String(a.layerId)));

  let cost = 0;
  let lotQty = 0;
  let rest = qty;
  for (const lot of lots) {
    if (rest <= 0) break;
    const unit = Number(lot[lotField]);
    if (lot[lotField] === null || lot[lotField] === undefined || !Number.isFinite(unit)) continue; // 原価なしロット → 現在原価へ
    const take = Math.min(Number(lot.remainingQuantity), rest);
    cost += unit * take;
    lotQty += take;
    rest -= take;
  }

  let currentQty = 0;
  let noCostQty = 0;
  if (rest > 0) {
    const current = resolveCurrentUnitCost(product, unitPrice, ctx);
    if (current === null) {
      noCostQty = rest;
    } else {
      cost += current * rest;
      currentQty = rest;
    }
  }
  return { cost, lotQty, currentQty, noCostQty };
};

// 売り場別集計。items は棚卸し明細(id=productId)、productMap は Map(productId → 商品)。
export const summarizeStocktakeValuation = (items, productMap, { taxMode = 'excluded', brandMap, supplierMap, areaNameMap, areaRateMap }) => {
  const ctx = { taxMode, brandMap, supplierMap, areaRateMap };
  const priceField = taxMode === 'included' ? 'priceTaxIncluded' : 'priceTaxExcluded';
  const emptyAgg = () => ({ qty: 0, retail: 0, cost: 0, noCostItems: 0, lotQty: 0, currentCostQty: 0 });
  const areaAgg = new Map();
  const total = emptyAgg();

  for (const it of items) {
    const qty = Math.max(Number(it.warehouseQuantity || 0) + Number(it.storefrontShelfQuantity || 0), 0);
    if (qty <= 0) continue; // マイナス在庫は在高に含めない
    const product = productMap.get(it.id) || {};
    const unitPrice = Number(it[priceField] ?? product[priceField] ?? 0) || 0;
    const areaId = String(product.salesAreaId || 'salesarea_999');
    const areaName = areaNameMap.get(areaId) || product.salesAreaName || '未設定';
    const { cost, lotQty, currentQty, noCostQty } = valueStocktakeItem(it, product, qty, unitPrice, ctx);

    if (!areaAgg.has(areaId)) areaAgg.set(areaId, { areaId, name: areaName, ...emptyAgg() });
    [areaAgg.get(areaId), total].forEach((agg) => {
      agg.qty += qty;
      agg.retail += unitPrice * qty;
      agg.cost += cost;
      agg.lotQty += lotQty;
      agg.currentCostQty += currentQty;
      if (noCostQty > 0) agg.noCostItems += 1;
    });
  }

  return {
    taxMode,
    areas: [...areaAgg.values()].sort((a, b) => b.retail - a.retail),
    total,
    itemCount: items.length
  };
};
