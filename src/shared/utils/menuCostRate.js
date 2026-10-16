import { applyTaxRounding, resolveModeTaxSettings } from './tax';

// ORDERモードのメニュー(店内価格)の原価率。分析と同じく「税抜原価 ÷ 税抜売価」。
// 原価の入力方式/税区分は品目の指定→無ければ基本設定(注文確定時の resolveCostSnapshot と同じ解決順)。
// 戻り値: { status: 'missing' | 'no_price' | 'ok', rate }  rate は小数1桁の%。
export const computeMenuCostRate = (item = {}, settings = {}) => {
  const rawCost = item?.costPrice;
  if (rawCost === null || rawCost === undefined || rawCost === '' || !Number.isFinite(Number(rawCost))) {
    return { status: 'missing', rate: null };
  }
  const price = Number(item?.price);
  if (!Number.isFinite(price) || price <= 0) return { status: 'no_price', rate: null };

  const tax = resolveModeTaxSettings(settings, 'order');
  const priceExcluded = tax.priceBase === 'taxExcluded'
    ? price
    : applyTaxRounding(price / (1 + tax.standardRate / 100), tax.rounding);
  if (priceExcluded <= 0) return { status: 'no_price', rate: null };

  const costTaxMode = item.costTaxMode && item.costTaxMode !== 'inherit'
    ? item.costTaxMode
    : settings?.defaultCostTaxMode;
  const costTaxRateType = item.costTaxRateType && item.costTaxRateType !== 'inherit'
    ? item.costTaxRateType
    : settings?.defaultCostTaxRateType;
  const costTaxRate = costTaxRateType === 'exempt'
    ? 0
    : costTaxRateType === 'reduced'
      ? Number(settings?.taxRateReduced ?? 8)
      : Number(settings?.taxRate ?? 10);
  const cost = Math.max(Number(rawCost), 0);
  const costExcluded = costTaxMode === 'tax_excluded'
    ? cost
    : applyTaxRounding(cost / (1 + costTaxRate / 100), settings?.taxRounding);

  return { status: 'ok', rate: Math.round((costExcluded / priceExcluded) * 1000) / 10 };
};
