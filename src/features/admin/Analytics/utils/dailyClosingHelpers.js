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

const toDate = (value) => {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === 'function') {
    const converted = value.toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }

  const converted = new Date(value);
  return Number.isNaN(converted.getTime()) ? null : converted;
};

const toMinutesFromTimeText = (timeText) => {
  const [hourText, minuteText = '0'] = String(timeText || '00:00').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;

  return Math.min(Math.max(hour, 0), 23) * 60 + Math.min(Math.max(minute, 0), 59);
};

const normalizeDailyClosingPeriods = (periods = []) => (
  Array.isArray(periods)
    ? periods
      .map((period, index) => {
        const id = String(period?.id || '').trim();
        const name = String(period?.name || period?.label || id || '').trim();
        const start = period?.start;
        const end = period?.end;

        if (!id || !name || !start || !end) return null;

        return {
          id,
          name,
          start,
          end,
          startMinutes: toMinutesFromTimeText(start),
          endMinutes: toMinutesFromTimeText(end),
          index
        };
      })
      .filter(Boolean)
    : []
);

const isMinutesWithinPeriod = (targetMinutes, period) => {
  if (!period) return false;

  if (period.startMinutes <= period.endMinutes) {
    return targetMinutes >= period.startMinutes && targetMinutes <= period.endMinutes;
  }

  return targetMinutes >= period.startMinutes || targetMinutes <= period.endMinutes;
};

const resolvePeriodByDate = (dateValue, periods = []) => {
  const targetDate = toDate(dateValue) || new Date();
  const targetMinutes = targetDate.getHours() * 60 + targetDate.getMinutes();

  return periods.find((period) => isMinutesWithinPeriod(targetMinutes, period)) || null;
};

const addTimeSlotAmount = (summary, periodId, periodName, amount) => {
  const normalizedPeriodId = String(periodId || 'unknown');
  const normalizedPeriodName = String(periodName || normalizedPeriodId || '時間帯未設定');

  if (!summary.periods[normalizedPeriodId]) {
    summary.periods[normalizedPeriodId] = {
      id: normalizedPeriodId,
      name: normalizedPeriodName,
      count: 0,
      total: 0
    };
  }

  summary.periods[normalizedPeriodId].count += 1;
  summary.periods[normalizedPeriodId].total += Number(amount || 0);
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

const addDepartmentAmount = (summary, transaction = {}) => {
  const departmentId = String(transaction.departmentId || 'unassigned').trim() || 'unassigned';
  const departmentName = String(
    transaction.departmentName ||
    (departmentId === 'unassigned' ? '部門未設定' : departmentId)
  ).trim() || '部門未設定';

  if (!summary.departments[departmentId]) {
    summary.departments[departmentId] = {
      id: departmentId,
      departmentId,
      name: departmentName,
      departmentName,
      count: 0,
      total: 0
    };
  }

  const amount = Number(transaction.totalAmount || 0);
  summary.departments[departmentId].count += 1;
  summary.departments[departmentId].total += amount;
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

  // 売上値引の内訳には売上値引きのみを載せる。販促費/金券は
  // addSettlementAdjustments(promoExpenses/vouchers)側で別集計するため除外する。
  // (区分未設定の旧データ・手入力等は売上値引きとして扱う)
  const category = discount?.accountingCategory;
  if (category === 'promo_expense' || category === 'voucher_payment') return;

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

const bumpDiscountCount = (summary, category) => {
  if (category === 'promo_expense') summary.promoExpenseCount += 1;
  else if (category === 'voucher_payment') summary.voucherCount += 1;
  else summary.discountCount += 1;
};

// 区分ごとの割引「適用延べ件数」を数える(金額には触れない)。
// 商品個別割引(lineDiscountItems)と会計全体割引(appliedDiscount(s))の両方を、
// それぞれの会計区分で集計する。源泉が分かれているので二重計上にはならない。
const addDiscountCounts = (summary, transaction) => {
  if (Array.isArray(transaction.lineDiscountItems)) {
    transaction.lineDiscountItems.forEach((item) => {
      if (Number(item?.amount || 0) > 0) bumpDiscountCount(summary, item.accountingCategory);
    });
  }

  const applied = Array.isArray(transaction.appliedDiscounts) && transaction.appliedDiscounts.length > 0
    ? transaction.appliedDiscounts
    : (transaction.appliedDiscount ? [transaction.appliedDiscount] : []);

  applied.forEach((discount) => {
    if (Array.isArray(discount?.items) && discount.items.length > 0) {
      discount.items.forEach((item) => {
        if (Number(item?.amount || 0) > 0) {
          bumpDiscountCount(summary, item.accountingCategory || discount.accountingCategory);
        }
      });
    } else if (Number(discount?.amount || 0) > 0) {
      bumpDiscountCount(summary, discount.accountingCategory);
    }
  });
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

const addAdjustmentEntry = (summary, key, entry, fallbackIndex = 0) => {
  const amount = Number(entry?.amount || 0);
  if (amount <= 0) return;

  const quantity = Math.max(1, Number(entry?.quantity ?? entry?.count ?? 1) || 1);
  const id = entry.id || entry.name || entry.label || `${key}_${fallbackIndex}`;
  const name = entry.name || entry.label || (key === 'promoExpenses' ? '販促費' : '金券/売掛');

  if (!summary[key][id]) {
    summary[key][id] = {
      id,
      name,
      count: 0,
      quantity: 0,
      amount: 0,
      value: Number(entry.value || 0),
      type: entry.type || 'amount',
      accountingCategory: key === 'promoExpenses' ? 'promo_expense' : 'voucher_payment'
    };
  }

  summary[key][id].count += 1;
  summary[key][id].quantity += quantity;
  summary[key][id].amount += amount;
};

const addSettlementAdjustments = (summary, transaction) => {
  const promoExpenseAmount = Number(transaction.promoExpenseAmount || 0);
  const voucherAmount = Number(transaction.voucherAmount || 0);

  if (promoExpenseAmount > 0) summary.promoExpenseTotal += promoExpenseAmount;
  if (voucherAmount > 0) summary.voucherTotal += voucherAmount;

  if (Array.isArray(transaction.promoExpenseItems) && transaction.promoExpenseItems.length > 0) {
    transaction.promoExpenseItems.forEach((item, index) => addAdjustmentEntry(summary, 'promoExpenses', item, index));
  } else if (promoExpenseAmount > 0) {
    addAdjustmentEntry(summary, 'promoExpenses', {
      id: 'promo_expense',
      name: '販促費',
      amount: promoExpenseAmount,
      value: promoExpenseAmount,
      count: 1,
      quantity: 1
    }, 0);
  }

  if (Array.isArray(transaction.vouchers) && transaction.vouchers.length > 0) {
    transaction.vouchers.forEach((item, index) => addAdjustmentEntry(summary, 'vouchers', item, index));
  } else if (voucherAmount > 0) {
    addAdjustmentEntry(summary, 'vouchers', {
      id: 'voucher_payment',
      name: '金券/売掛',
      amount: voucherAmount,
      value: voucherAmount,
      count: 1,
      quantity: 1
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

const toSafeDailyNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const hasCostSnapshot = (item) => (
  item?.costTaxIncludedAmount !== null &&
  item?.costTaxIncludedAmount !== undefined &&
  item?.costTaxExcludedAmount !== null &&
  item?.costTaxExcludedAmount !== undefined
);

const addGrossProfitSummary = (summary, transaction) => {
  if (!Array.isArray(transaction.items)) return;

  transaction.items.forEach((item) => {
    if (!item) return;

    const quantity = Math.max(Number(item.quantity || 0), 0);
    const unitPrice = Number(item.unitPrice || item.price || 0);
    const fallbackSalesIncluded = unitPrice * quantity;

    const salesTaxIncludedAmount = Number(
      item.totalPrice ??
      item.salesTaxIncludedAmount ??
      item.taxIncludedAmount ??
      fallbackSalesIncluded
    ) || 0;

    const salesTaxExcludedAmount = Number(
      item.salesTaxExcludedAmount ??
      salesTaxIncludedAmount
    ) || 0;

    const hasCost =
      item.costPrice !== null &&
      item.costPrice !== undefined &&
      item.costPrice !== '' &&
      Number.isFinite(Number(item.costPrice));

    if (!hasCost) {
      summary.costMissingItemCount += quantity;
      summary.costMissingSalesTaxIncluded += salesTaxIncludedAmount;
      summary.costMissingSalesTaxExcluded += salesTaxExcludedAmount;
      return;
    }

    const costTaxIncludedAmount = Number(item.costTaxIncludedAmount || 0);
    const costTaxExcludedAmount = Number(item.costTaxExcludedAmount ?? costTaxIncludedAmount) || 0;

    const grossProfitTaxIncluded = Number(
      item.grossProfitTaxIncluded ??
      (salesTaxIncludedAmount - costTaxIncludedAmount)
    ) || 0;

    const grossProfitTaxExcluded = Number(
      item.grossProfitTaxExcluded ??
      (salesTaxExcludedAmount - costTaxExcludedAmount)
    ) || 0;

    summary.costConfiguredItemCount += quantity;

    summary.costConfiguredSalesTaxIncluded += salesTaxIncludedAmount;
    summary.costConfiguredSalesTaxExcluded += salesTaxExcludedAmount;

    summary.grossProfitTrackedSalesTaxIncluded += salesTaxIncludedAmount;
    summary.grossProfitTrackedSalesTaxExcluded += salesTaxExcludedAmount;

    summary.costTaxIncludedTotal += costTaxIncludedAmount;
    summary.costTaxExcludedTotal += costTaxExcludedAmount;

    summary.grossProfitTaxIncluded += grossProfitTaxIncluded;
    summary.grossProfitTaxExcluded += grossProfitTaxExcluded;

    // 正確な個別原価ではなく「原価率(掛け率)で推計」した分を別途集計(粗利には含まれている)。
    if (item.costSource && item.costSource !== 'product_cost') {
      summary.estimatedCostItemCount += quantity;
      summary.estimatedCostSalesTaxIncluded += salesTaxIncludedAmount;
      summary.estimatedCostSalesTaxExcluded += salesTaxExcludedAmount;
      summary.estimatedCostTaxIncluded += costTaxIncludedAmount;
      summary.estimatedCostTaxExcluded += costTaxExcludedAmount;
    }
  });
};


const addPeriodSales = (summary, transaction, periods = []) => {
  const orderAnalyticsRecords = Array.isArray(transaction.orderAnalyticsRecords)
    ? transaction.orderAnalyticsRecords
    : [];

  // 注文データが取引に紐づいている場合は、注文ごとの提供時刻で時間帯別売上を集計する。
  // これにより、会計時刻ではなく「いつ提供・注文された売上か」で日計を見られる。
  if (orderAnalyticsRecords.length > 0 && periods.length > 0) {
    orderAnalyticsRecords.forEach((orderRecord) => {
      const matchedPeriod = resolvePeriodByDate(
        orderRecord.paidAt || orderRecord.timestamp || transaction.paidAt || transaction.timestamp,
        periods
      );

      addTimeSlotAmount(
        summary,
        matchedPeriod?.id || 'unknown',
        matchedPeriod?.name || '時間帯未設定',
        Number(orderRecord.totalAmount || 0)
      );
    });

    return;
  }

  // 旧データ・注文紐付けがないデータは、従来通り取引に保存された periodId で集計する。
  const periodId =
    transaction.periodId ||
    transaction.businessPeriodId ||
    'unknown';

  const periodName =
    transaction.periodName ||
    transaction.businessPeriodName ||
    '時間帯未設定';

  addTimeSlotAmount(summary, periodId, periodName, Number(transaction.totalAmount || 0));
};

const getTransactionGuestCount = (transaction) => {
  const value = Number(
    transaction.guestCount ??
    transaction.numberOfGuests ??
    transaction.partySize ??
    transaction.customerCount ??
    0
  );

  return Number.isFinite(value) && value > 0 ? value : 0;
};

const getTransactionSessionKey = (transaction) => (
  String(
    transaction?.sessionId ||
    transaction?.tableSessionId ||
    transaction?.tableKey ||
    transaction?.id ||
    ''
  )
);

const upsertSessionGuestCount = (map, sessionKey, guestCount) => {
  if (!sessionKey) return;
  const current = Number(map.get(sessionKey) || 0);
  map.set(sessionKey, Math.max(current, Number(guestCount || 0)));
};

const sumSessionGuestCounts = (map) => (
  Array.from(map.values()).reduce((sum, value) => sum + Number(value || 0), 0)
);

export const buildDailyClosingSummary = (transactions = [], periods = []) => {
  const normalizedPeriods = normalizeDailyClosingPeriods(periods);

  const summary = {
    transactionCount: 0,
    customerCount: 0,
    posCustomerCount: 0,
    totalSales: 0,

    sessionGuestCounts: new Map(),
    customerIdSet: new Set(),

    cashSales: 0,
    cardSales: 0,
    qrSales: 0,
    otherSales: 0,

    discountTotal: 0,
    promoExpenseTotal: 0,
    voucherTotal: 0,
    // 区分ごとの割引「適用延べ件数」(個別割引は1行=1件、全体割引も1適用=1件)。
    discountCount: 0,
    promoExpenseCount: 0,
    voucherCount: 0,
    settlementAdjustmentTotal: 0,
    itemCount: 0,

    costConfiguredItemCount: 0,
    costConfiguredItemTypes: 0,
    costMissingItemCount: 0,
    costMissingItemTypes: 0,
    costTaxIncludedTotal: 0,
    costTaxExcludedTotal: 0,
    costTaxTotal: 0,
    grossProfitTaxIncluded: 0,
    grossProfitTaxExcluded: 0,
    grossProfitTrackedSalesTaxIncluded: 0,
    grossProfitTrackedSalesTaxExcluded: 0,
    grossProfitUntrackedSalesTaxIncluded: 0,
    grossProfitUntrackedSalesTaxExcluded: 0,

    costConfiguredSalesTaxIncluded: 0,
    costConfiguredSalesTaxExcluded: 0,
    costMissingSalesTaxIncluded: 0,
    costMissingSalesTaxExcluded: 0,

    // 原価率で「推計」した(正確な個別原価が無い)売上。粗利には含めるが但し書きで明示する。
    estimatedCostItemCount: 0,
    estimatedCostSalesTaxIncluded: 0,
    estimatedCostSalesTaxExcluded: 0,
    estimatedCostTaxIncluded: 0,
    estimatedCostTaxExcluded: 0,

    paymentMethods: {},
    departments: {},
    taxBreakdown: {},
    discounts: {},
    promoExpenses: {},
    vouchers: {},
    items: {},
    categories: {},
    periods: {}
  };

  transactions.forEach((transaction) => {
    if (transaction.isPaid === false) return;

    const totalAmount = Number(transaction.totalAmount || 0);
    const settlementAdjustmentTotal = Number(transaction.settlementAdjustmentTotal || 0);

    summary.transactionCount += 1;
    summary.totalSales += totalAmount + settlementAdjustmentTotal;
    summary.settlementAdjustmentTotal += settlementAdjustmentTotal;

    // POSレジは「一会計＝一客」で来客数に加算（人数・顧客IDを持たないため）。
    if (transaction.registerMode === 'pos' || transaction.salesChannel === 'pos_register') {
      summary.posCustomerCount += 1;
    }

    const guestCount = getTransactionGuestCount(transaction);
    const sessionKey = getTransactionSessionKey(transaction);

    upsertSessionGuestCount(summary.sessionGuestCounts, sessionKey, guestCount);

    addCustomers(summary, transaction);

    // 現金＋カード/QR の分割会計は payments[] の内訳を手段ごとに加算する。
    // 単一手段の会計(payments無し)は従来通り会計総額を1手段に加算する。
    if (Array.isArray(transaction.payments) && transaction.payments.length > 0) {
      transaction.payments.forEach((payment) => {
        addPaymentMethod(summary, payment.method, Number(payment.amount || 0));
      });
    } else {
      addPaymentMethod(summary, transaction.paymentMethodGroup || transaction.paymentMethod, totalAmount);
    }
    addDepartmentAmount(summary, transaction);
    addDiscounts(summary, transaction);
    addDiscountCounts(summary, transaction);
    addSettlementAdjustments(summary, transaction);
    addTaxSummary(summary, transaction);
    addItems(summary, transaction);
    addCategorySales(summary, transaction);
    addGrossProfitSummary(summary, transaction);
    addPeriodSales(summary, transaction, normalizedPeriods);
  });

    const paymentOrder = ['cash', 'card', 'qr', 'other'];

    const guestCustomerCount = sumSessionGuestCounts(summary.sessionGuestCounts);
    const fallbackCustomerCount = summary.customerIdSet?.size || 0;
    // ORDER(テーブル人数) ＋ POS(一会計一客)。どちらも0なら顧客ID数で代替。
    const combinedCustomerCount = guestCustomerCount + (summary.posCustomerCount || 0);
    const customerCount = combinedCustomerCount > 0 ? combinedCustomerCount : fallbackCustomerCount;

    const { sessionGuestCounts, posCustomerCount, ...publicSummary } = summary;

    // 粗利率は会計・経営管理で見やすいように税抜同士で算出する。
    const grossProfitRate = summary.grossProfitTrackedSalesTaxExcluded > 0
      ? Math.round((summary.grossProfitTaxExcluded / summary.grossProfitTrackedSalesTaxExcluded) * 1000) / 10
      : null;

    const totalSalesTaxExcluded = Object.values(summary.taxBreakdown || {})
      .reduce((sum, entry) => sum + Number(entry.baseAmount || 0), 0);

    const totalTaxAmount = Object.values(summary.taxBreakdown || {})
      .reduce((sum, entry) => sum + Number(entry.tax || 0), 0);

    const costMissingSalesRate = summary.totalSales > 0
      ? Math.round((summary.costMissingSalesTaxIncluded / summary.totalSales) * 1000) / 10
      : 0;

    return {
    ...publicSummary,
    customerCount,
    totalSalesTaxExcluded: totalSalesTaxExcluded > 0 ? totalSalesTaxExcluded : summary.totalSales,
    totalTaxAmount,
    grossProfitRate,
    costMissingSalesRate,

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

    promoExpenseList: Object.values(summary.promoExpenses)
      .sort((left, right) => right.amount - left.amount),

    voucherList: Object.values(summary.vouchers)
      .sort((left, right) => right.amount - left.amount),

    itemList: Object.values(summary.items)
      .sort((left, right) => right.total - left.total),

    departmentList: Object.values(summary.departments)
      .sort((left, right) => right.total - left.total),

    categoryList: Object.values(summary.categories)
      .sort((left, right) => right.total - left.total),

    timeSlotList: Object.values(summary.periods)
      .sort((left, right) => {
        const leftPeriod = normalizedPeriods.find((period) => String(period.id) === String(left.id));
        const rightPeriod = normalizedPeriods.find((period) => String(period.id) === String(right.id));

        if (leftPeriod && rightPeriod) return leftPeriod.index - rightPeriod.index;
        if (leftPeriod) return -1;
        if (rightPeriod) return 1;

        return right.total - left.total;
      })
  };
};