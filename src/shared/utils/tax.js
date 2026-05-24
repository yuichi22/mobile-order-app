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
