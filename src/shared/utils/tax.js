export const TAX_ROUNDING_MODES = {
  FLOOR: 'floor',
  CEIL: 'ceil',
  ROUND: 'round'
};

export const TAX_ROUNDING_OPTIONS = [
  { value: TAX_ROUNDING_MODES.FLOOR, label: '切り捨て' },
  { value: TAX_ROUNDING_MODES.CEIL, label: '切り上げ' },
  { value: TAX_ROUNDING_MODES.ROUND, label: '四捨五入' }
];

export const normalizeTaxRounding = (value) => (
  Object.values(TAX_ROUNDING_MODES).includes(value) ? value : TAX_ROUNDING_MODES.FLOOR
);

const stabilizeDecimal = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(8));
};

export const applyTaxRounding = (value, mode = TAX_ROUNDING_MODES.FLOOR) => {
  const amount = stabilizeDecimal(value);

  const normalizedMode = normalizeTaxRounding(mode);
  if (normalizedMode === TAX_ROUNDING_MODES.CEIL) return Math.ceil(amount);
  if (normalizedMode === TAX_ROUNDING_MODES.ROUND) return Math.round(amount);
  return Math.floor(amount);
};

export const splitTaxIncludedAmount = (taxIncludedAmount, taxRate, roundingMode) => {
  const amount = stabilizeDecimal(taxIncludedAmount);
  const rate = stabilizeDecimal(taxRate);
  const divisor = 1 + (rate / 100);

  const baseAmount = applyTaxRounding(stabilizeDecimal(amount / divisor), roundingMode);
  return {
    baseAmount,
    taxAmount: stabilizeDecimal(amount - baseAmount)
  };
};

export const toTaxIncludedAmount = (baseAmount, taxRate, roundingMode) => {
  const amount = stabilizeDecimal(baseAmount);
  const rate = stabilizeDecimal(taxRate);
  return applyTaxRounding(stabilizeDecimal(amount * (1 + (rate / 100))), roundingMode);
};

// 会計モード(pos/order)別の税設定を settings(=settings/basic) から解決する。
// 未設定なら従来値(taxRate/taxRateReduced/taxRounding, ORDERは menuPriceTaxMode)へフォールバック。
export const resolveModeTaxSettings = (settings = {}, mode = 'pos') => {
  const key = mode === 'pos' ? 'posTax' : 'orderTax';
  const cfg = settings?.[key] || {};
  const fallbackPriceBase = mode === 'order'
    ? (settings?.menuPriceTaxMode === 'tax_excluded' ? 'taxExcluded' : 'taxIncluded')
    : 'taxIncluded';
  const priceBase = cfg.priceBase === 'taxExcluded' || cfg.priceBase === 'taxIncluded'
    ? cfg.priceBase
    : fallbackPriceBase;
  return {
    priceBase,
    standardRate: Number.isFinite(Number(cfg.standardRate)) ? Number(cfg.standardRate) : Number(settings?.taxRate ?? 10),
    reducedRate: Number.isFinite(Number(cfg.reducedRate)) ? Number(cfg.reducedRate) : Number(settings?.taxRateReduced ?? 8),
    rounding: normalizeTaxRounding(cfg.rounding || settings?.taxRounding)
  };
};

// 1行ぶんの税内訳。priceBase=taxIncluded なら lineAmount は税込、taxExcluded なら税抜(base)。
// includedAmount(=実際に請求する税込額)/baseAmount(税抜)/taxAmount を返す。
export const computeLineTaxBreakdown = (lineAmount, taxRate, priceBase, roundingMode) => {
  if (priceBase === 'taxExcluded') {
    const baseAmount = applyTaxRounding(stabilizeDecimal(lineAmount), roundingMode);
    const includedAmount = toTaxIncludedAmount(baseAmount, taxRate, roundingMode);
    return { includedAmount, baseAmount, taxAmount: stabilizeDecimal(includedAmount - baseAmount) };
  }
  const includedAmount = stabilizeDecimal(lineAmount);
  const { baseAmount, taxAmount } = splitTaxIncludedAmount(includedAmount, taxRate, roundingMode);
  return { includedAmount, baseAmount, taxAmount };
};
