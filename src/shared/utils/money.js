export const calculateItemTotal = (basePrice, selectedOptions) => {
  const optionsTotal = selectedOptions.reduce((sum, opt) => sum + (Number(opt.price) || 0), 0);
  return (Number(basePrice) || 0) + optionsTotal;
};
