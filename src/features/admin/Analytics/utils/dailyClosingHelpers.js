export const formatDailyClosingDateKey = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString()}`;

export const getPaymentMethodGroup = (method) => {
  const normalized = String(method || '').toLowerCase();

  if (normalized === 'cash') return 'cash';

  if (
    normalized === 'card' ||
    normalized === 'credit' ||
    normalized === 'credit_card' ||
    normalized === 'stripe'
  ) {
    return 'card';
  }

  if (
    normalized === 'qr' ||
    normalized === 'qrpay' ||
    normalized === 'qr_payment' ||
    normalized === 'paypay' ||
    normalized === 'linepay' ||
    normalized === 'rakutenpay' ||
    normalized === 'd払い' ||
    normalized === 'dbarai'
  ) {
    return 'qr';
  }

  return 'other';
};

export const getPaymentMethodLabel = (method) => {
  const group = getPaymentMethodGroup(method);

  if (group === 'cash') return '現金';
  if (group === 'card') return 'カード';
  if (group === 'qr') return 'QR決済';
  return 'その他';
};

const addCustomers = (summary, transaction) => {
  if (Array.isArray(transaction.customerIds)) {
    transaction.customerIds.forEach((customerId) => {
      const normalizedCustomerId = String(customerId || '').trim();
      if (normalizedCustomerId) {
        summary.customerIdSet.add(normalizedCustomerId);
      }
    });
    return;
  }

  if (Array.isArray(transaction.customerSummaries)) {
    transaction.customerSummaries.forEach((entry) => {
      const normalizedCustomerId = String(entry?.customerId || '').trim();
      if (normalizedCustomerId) {
        summary.customerIdSet.add(normalizedCustomerId);
      }
    });
  }
};

const addPaymentMethod = (summary, rawMethod, amount) => {
  const method = getPaymentMethodGroup(rawMethod);

  if (!summary.paymentMethods[method]) {
    summary.paymentMethods[method] = {
      method,
      label: getPaymentMethodLabel(method),
      count: 0,
      total: 0
    };
  }

  summary.paymentMethods[method].count += 1;
  summary.paymentMethods[method].total += amount;

  if (method === 'cash') summary.cashSales += amount;
  else if (method === 'card') summary.cardSales += amount;
  else if (method === 'qr') summary.qrSales += amount;
  else summary.otherSales += amount;
};

const addTaxBreakdown = (summary, taxKey, rate, sales, tax, baseAmount = 0) => {
  const normalizedKey = taxKey || 'unknown';
  const normalizedRate = Number(rate || 0);
  const normalizedSales = Number(sales || 0);
  const normalizedTax = Number(tax || 0);
  const normalizedBaseAmount = Number(baseAmount || 0);

  if (!summary.taxBreakdown[normalizedKey]) {
    summary.taxBreakdown[normalizedKey] = {
      key: normalizedKey,
      rate: normalizedRate,
      sales: 0,
      baseAmount: 0,
      tax: 0
    };
  }

  summary.taxBreakdown[normalizedKey].rate = normalizedRate;
  summary.taxBreakdown[normalizedKey].sales += normalizedSales;
  summary.taxBreakdown[normalizedKey].baseAmount += normalizedBaseAmount;
  summary.taxBreakdown[normalizedKey].tax += normalizedTax;
};

const addTaxSummary = (summary, transaction) => {
  const taxSummary = transaction.taxSummary || null;

  if (taxSummary) {
    const reducedTaxIncluded = Number(taxSummary.reducedTaxIncluded || 0);
    const reducedTaxExcluded = Number(taxSummary.reducedTaxExcluded || 0);
    const reducedTaxAmount = Number(taxSummary.reducedTaxAmount || 0);
    const reducedTaxRate = Number(taxSummary.reducedTaxRate || 8);

    const standardTaxIncluded = Number(taxSummary.standardTaxIncluded || 0);
    const standardTaxExcluded = Number(taxSummary.standardTaxExcluded || 0);
    const standardTaxAmount = Number(taxSummary.standardTaxAmount || 0);
    const standardTaxRate = Number(taxSummary.standardTaxRate || 10);

    if (reducedTaxIncluded > 0 || reducedTaxAmount > 0) {
      addTaxBreakdown(
        summary,
        'reduced',
        reducedTaxRate,
        reducedTaxIncluded,
        reducedTaxAmount,
        reducedTaxExcluded
      );
    }

    if (standardTaxIncluded > 0 || standardTaxAmount > 0) {
      addTaxBreakdown(
        summary,
        'standard',
        standardTaxRate,
        standardTaxIncluded,
        standardTaxAmount,
        standardTaxExcluded
      );
    }

    return;
  }

  const taxBreakdown = transaction.taxBreakdown || {};

  if (taxBreakdown.reduced || taxBreakdown.standard) {
    if (taxBreakdown.reduced) {
      addTaxBreakdown(
        summary,
        'reduced',
        taxBreakdown.reduced.rate,
        taxBreakdown.reduced.sales,
        taxBreakdown.reduced.tax,
        taxBreakdown.reduced.baseAmount
      );
    }

    if (taxBreakdown.standard) {
      addTaxBreakdown(
        summary,
        'standard',
        taxBreakdown.standard.rate,
        taxBreakdown.standard.sales,
        taxBreakdown.standard.tax,
        taxBreakdown.standard.baseAmount
      );
    }

    return;
  }

  const reducedTax = Number(transaction.taxAmountReduced || 0);
  const standardTax = Number(transaction.taxAmountStandard || 0);

  if (reducedTax > 0) {
    addTaxBreakdown(
      summary,
      'reduced',
      transaction.taxRateReduced || 8,
      Number(transaction.totalReducedIncl || 0),
      reducedTax
    );
  }

  if (standardTax > 0) {
    addTaxBreakdown(
      summary,
      'standard',
      transaction.taxRateStandard || 10,
      Number(transaction.totalStandardIncl || 0),
      standardTax
    );
  }

  if (reducedTax <= 0 && standardTax <= 0) {
    addTaxBreakdown(
      summary,
      'unknown',
      0,
      Number(transaction.totalAmount || 0),
      Number(transaction.taxAmount || 0)
    );
  }
};

const addDiscountEntry = (summary, discount, fallbackIndex = 0) => {
  const amount = Number(discount?.amount || 0);
  if (amount <= 0) return;

  const quantity = Math.max(
    1,
    Number(discount?.quantity ?? discount?.count ?? 1) || 1
  );

  const id =
    discount.id ||
    discount.discountId ||
    discount.name ||
    discount.label ||
    `discount_${fallbackIndex}`;

  const name =
    discount.name ||
    discount.label ||
    discount.discountName ||
    '値引き';

  if (!summary.discounts[id]) {
    summary.discounts[id] = {
      id,
      name,
      count: 0,
      quantity: 0,
      amount: 0,
      expectedAmount: 0,
      value: Number(discount.value || 0),
      type: discount.type || ''
    };
  }

  summary.discounts[id].count += 1;
  summary.discounts[id].quantity += quantity;
  summary.discounts[id].amount += amount;

  if (summary.discounts[id].value > 0 && summary.discounts[id].type === 'amount') {
    summary.discounts[id].expectedAmount =
      summary.discounts[id].quantity * summary.discounts[id].value;
  }
};

const addDiscounts = (summary, transaction) => {
  const transactionDiscountTotal = Number(transaction.discountAmount || 0);

  if (transactionDiscountTotal > 0) {
    summary.discountTotal += transactionDiscountTotal;
  }

  const addDiscountItems = (discountItems = []) => {
    discountItems.forEach((discount, index) => {
      addDiscountEntry(summary, discount, index);
    });
  };

  if (Array.isArray(transaction.appliedDiscounts) && transaction.appliedDiscounts.length > 0) {
    const expandedDiscounts = [];

    transaction.appliedDiscounts.forEach((discount, index) => {
      if (Array.isArray(discount?.items) && discount.items.length > 0) {
        discount.items.forEach((item, itemIndex) => {
          expandedDiscounts.push({
            ...item,
            id: item.id || item.discountId || `${discount.id || 'discount'}_${itemIndex}`,
            name: item.name || item.label || discount.name || '値引き',
            type: item.type || discount.type || '',
            value: Number(item.value ?? discount.value ?? 0),
            count: Number(item.count ?? item.quantity ?? 1),
            quantity: Number(item.quantity ?? item.count ?? 1),
            amount: Number(item.amount || 0)
          });
        });
      } else {
        expandedDiscounts.push({
          ...discount,
          id: discount.id || discount.discountId || discount.name || `discount_${index}`,
          name: discount.name || discount.label || '値引き',
          count: Number(discount.count ?? discount.quantity ?? 1),
          quantity: Number(discount.quantity ?? discount.count ?? 1),
          amount: Number(discount.amount || 0)
        });
      }
    });

    addDiscountItems(expandedDiscounts);
    return;
  }

  if (transaction.appliedDiscount) {
    if (Array.isArray(transaction.appliedDiscount.items) && transaction.appliedDiscount.items.length > 0) {
      addDiscountItems(transaction.appliedDiscount.items.map((item, index) => ({
        ...item,
        id: item.id || item.discountId || `discount_item_${index}`,
        name: item.name || item.label || '値引き',
        type: item.type || transaction.appliedDiscount.type || '',
        value: Number(item.value ?? transaction.appliedDiscount.value ?? 0),
        count: Number(item.count ?? item.quantity ?? 1),
        quantity: Number(item.quantity ?? item.count ?? 1),
        amount: Number(item.amount || 0)
      })));
      return;
    }

    addDiscountEntry(summary, transaction.appliedDiscount, 0);
    return;
  }

  if (transaction.discountDetail) {
    addDiscountEntry(summary, {
      ...transaction.discountDetail,
      amount: transactionDiscountTotal
    }, 0);
    return;
  }

  if (transactionDiscountTotal > 0) {
    addDiscountEntry(summary, {
      id: transaction.discountId || transaction.discountName || 'discount',
      name: transaction.discountName || '値引き',
      type: transaction.discountType || '',
      value: transaction.discountValue || 0,
      count: 1,
      quantity: 1,
      amount: transactionDiscountTotal
    }, 0);
  }
};

const addItems = (summary, transaction) => {
  if (!Array.isArray(transaction.items)) return;

  transaction.items.forEach((item) => {
    const name = item.name || '商品名未設定';
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const itemTotal = Number(item.totalPrice ?? unitPrice * quantity);

    summary.itemCount += quantity;

    if (!summary.items[name]) {
      summary.items[name] = {
        name,
        quantity: 0,
        total: 0
      };
    }

    summary.items[name].quantity += quantity;
    summary.items[name].total += itemTotal;
  });
};

const addCategorySales = (summary, transaction) => {
  if (!Array.isArray(transaction.items)) return;

  transaction.items.forEach((item) => {
    const categoryId =
      item.categoryId ||
      item.category ||
      'uncategorized';

    const categoryName =
      item.categoryName ||
      'カテゴリー未設定';

    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const amount = Number(item.totalPrice ?? unitPrice * quantity);

    if (!summary.categories[categoryId]) {
      summary.categories[categoryId] = {
        id: categoryId,
        name: categoryName,
        quantity: 0,
        total: 0
      };
    }

    summary.categories[categoryId].quantity += quantity;
    summary.categories[categoryId].total += amount;
  });
};

const addPeriodSales = (summary, transaction) => {
  const periodId =
    transaction.periodId ||
    transaction.businessPeriodId ||
    'unknown';

  const periodName =
    transaction.periodName ||
    transaction.businessPeriodName ||
    '時間帯未設定';

  const amount = Number(transaction.totalAmount || 0);

  if (!summary.periods[periodId]) {
    summary.periods[periodId] = {
      id: periodId,
      name: periodName,
      count: 0,
      total: 0
    };
  }

  summary.periods[periodId].count += 1;
  summary.periods[periodId].total += amount;
};

export const buildDailyClosingSummary = (transactions = []) => {
  const summary = {
    transactionCount: 0,
    customerCount: 0,
    totalSales: 0,

    customerCount: 0,
    customerIdSet: new Set(),

    cashSales: 0,
    cardSales: 0,
    qrSales: 0,
    otherSales: 0,

    discountTotal: 0,
    itemCount: 0,

    paymentMethods: {},
    taxBreakdown: {},
    discounts: {},
    items: {},
    categories: {},
    periods: {}
  };

  transactions.forEach((transaction) => {
    if (transaction.isPaid === false) return;

    const totalAmount = Number(transaction.totalAmount || 0);

    summary.transactionCount += 1;
    summary.totalSales += totalAmount;

    summary.customerCount += Number(
    transaction.guestCount ??
    transaction.numberOfGuests ??
    transaction.partySize ??
    transaction.customerCount ??
    0
    ) || 0;

    addCustomers(summary, transaction);

    addPaymentMethod(summary, transaction.paymentMethodGroup || transaction.paymentMethod, totalAmount);
    addDiscounts(summary, transaction);
    addTaxSummary(summary, transaction);
    addItems(summary, transaction);
    addCategorySales(summary, transaction);
    addPeriodSales(summary, transaction);
  });

    const paymentOrder = ['cash', 'card', 'qr', 'other'];

    const guestCustomerCount = Number(summary.customerCount || 0);
    const fallbackCustomerCount = summary.customerIdSet?.size || 0;
    const customerCount = guestCustomerCount > 0 ? guestCustomerCount : fallbackCustomerCount;

    return {
    ...summary,
    customerCount,

    paymentMethodList: paymentOrder.map((method) => (
      summary.paymentMethods[method] || {
        method,
        label: getPaymentMethodLabel(method),
        count: 0,
        total: 0
      }
    )),

    taxBreakdownList: Object.values(summary.taxBreakdown)
      .sort((left, right) => {
        if (left.key === 'reduced') return -1;
        if (right.key === 'reduced') return 1;
        if (left.key === 'standard') return -1;
        if (right.key === 'standard') return 1;
        return Number(left.rate || 0) - Number(right.rate || 0);
      }),

    discountList: Object.values(summary.discounts)
      .sort((left, right) => right.amount - left.amount),

    itemList: Object.values(summary.items)
      .sort((left, right) => right.total - left.total),

    categoryList: Object.values(summary.categories)
      .sort((left, right) => right.total - left.total),

    timeSlotList: Object.values(summary.periods)
      .sort((left, right) => right.total - left.total)
  };
};