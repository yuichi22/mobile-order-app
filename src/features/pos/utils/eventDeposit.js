// イベント入金（店外イベントの売上をまとめて1回で入金する）。
// 仕様: https://claude.ai/artifact/XdD9dQZyZQYH6DwinGSmtp
//
// 位置づけ: 時間帯の中ではなく、テイクアウトと並ぶ別枠（販路）。
//  - 売上の記録は通常の会計と同じ stores/{storeId}/transactions に1件書く（日計・ドロワー突合・取消をそのまま使う）。
//  - 日計の売上は「入金した日」、分析のイベント別表は「開催日(eventDate)」で見る。
//  - 客数・客単価には含めない（guestCount 0・isEvent で除外）。
//  - テイクアウト判定(isTakeout / tableId:'takeout' / salesSubChannel:'order_takeout')には引っかけない。
// Firestore に触れない純粋関数だけを置く（画面と集計で同じ判定を使うため）。
import { splitTaxIncludedAmount } from '../../../shared/utils/tax';

export const EVENT_SUB_CHANNEL = 'event_deposit';
export const EVENT_SUB_CHANNEL_LABEL = 'イベント入金';
export const EVENT_PERIOD_ID = 'event';
export const EVENT_PERIOD_NAME = 'イベント';
export const EVENT_ITEM_SOURCE_TYPE = 'event';
export const EVENT_ITEM_CATEGORY_PREFIX = 'event:';

// 取引（または注文レコード）がイベント入金か。
export const isEventDepositRecord = (record = {}) => (
  record?.isEvent === true
  || record?.orderType === 'event'
  || record?.salesSubChannel === EVENT_SUB_CHANNEL
);

const toText = (value) => String(value ?? '').trim();

// settings/basic.eventCategories を正規化する。並び順 → 名前順。
export const normalizeEventCategories = (list) => (
  (Array.isArray(list) ? list : [])
    .map((entry, index) => ({
      id: toText(entry?.id),
      name: toText(entry?.name),
      departmentId: toText(entry?.departmentId),
      defaultTaxRate: Number(entry?.defaultTaxRate) === 8 ? 8 : 10,
      active: entry?.active !== false,
      sortOrder: Number.isFinite(Number(entry?.sortOrder)) ? Number(entry.sortOrder) : index
    }))
    .filter((entry) => entry.id && entry.name)
    .sort((left, right) => (left.sortOrder - right.sortOrder) || left.name.localeCompare(right.name, 'ja'))
);

// ローカル日付の YYYY-MM-DD。
export const toLocalDateKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 「11/15」形式の短い日付。
export const formatEventDateShort = (dateKey) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toText(dateKey));
  if (!match) return toText(dateKey);
  return `${Number(match[2])}/${Number(match[3])}`;
};

// 電卓キーの入力を金額文字列に反映する。先頭0を許さない・最大9桁。
export const applyCalculatorKey = (current, key) => {
  const value = toText(current);
  if (key === 'clear') return '';
  if (key === 'back') return value.slice(0, -1);
  if (!/^\d+$/.test(String(key))) return value;
  const next = `${value}${key}`.replace(/^0+/, '');
  return next.length > 9 ? value : next;
};

// 入金の取引レコード（serverTimestamp 系は呼び出し側で足す）を組み立てる。
// taxRate は 8 / 10 のどちらか（税込総額から内税を逆算する）。
export const buildEventDepositRecord = ({
  amount,
  taxRate,
  reducedRate = 8,
  standardRate = 10,
  taxRounding,
  category,
  eventDate,
  groupCount,
  memo,
  paymentMethod,
  paymentMethodLabel,
  register = {},
  department = {},
  registerMode = 'order',
  transactionId = '',
  businessDate,
  staff = {}
}) => {
  const total = Math.max(Math.round(Number(amount) || 0), 0);
  const isReduced = Number(taxRate) === Number(reducedRate) || Number(taxRate) === 8;
  const rate = isReduced ? Number(reducedRate) : Number(standardRate);
  const { baseAmount, taxAmount } = splitTaxIncludedAmount(total, rate, taxRounding);
  const reduced = isReduced
    ? { included: total, base: baseAmount, tax: taxAmount }
    : { included: 0, base: 0, tax: 0 };
  const standard = isReduced
    ? { included: 0, base: 0, tax: 0 }
    : { included: total, base: baseAmount, tax: taxAmount };
  const categoryId = toText(category?.id);
  const categoryName = toText(category?.name) || 'イベント';
  const normalizedEventDate = toText(eventDate) || businessDate;
  const normalizedGroupCount = Math.max(Math.round(Number(groupCount) || 0), 0);
  const saleMode = registerMode === 'pos' ? 'pos' : 'order';
  const departmentId = toText(department?.id);
  const departmentName = toText(department?.name);

  const item = {
    id: `event:${categoryId}`,
    menuItemId: `event:${categoryId}`,
    sourceType: EVENT_ITEM_SOURCE_TYPE,
    name: categoryName,
    categoryId: `${EVENT_ITEM_CATEGORY_PREFIX}${categoryId}`,
    categoryName: `${EVENT_PERIOD_NAME}: ${categoryName}`,
    // 分析の部門振り分け(departmentAttribution)はイベント明細だけこの部門を使う。
    departmentId,
    departmentName,
    quantity: 1,
    unitPrice: total,
    totalPrice: total,
    priceTaxIncluded: total,
    taxRate: rate,
    salesTaxIncludedAmount: total,
    salesTaxExcludedAmount: baseAmount,
    allowsTakeout: false,
    isTakeout: false,
    eventCategoryId: categoryId,
    eventDate: normalizedEventDate
  };

  return {
    sessionId: `event-${transactionId}`,
    tableId: 'event',
    tableDisplayName: EVENT_SUB_CHANNEL_LABEL,
    tableName: EVENT_SUB_CHANNEL_LABEL,

    registerId: toText(register?.id),
    registerName: toText(register?.name),
    departmentId,
    departmentName,
    registerMode: saleMode,
    salesChannel: saleMode === 'pos' ? 'pos_register' : 'order_register',
    salesChannelLabel: saleMode === 'pos' ? 'POSレジ' : 'ORDERレジ',
    salesSubChannel: EVENT_SUB_CHANNEL,
    salesSubChannelLabel: EVENT_SUB_CHANNEL_LABEL,

    orderType: 'event',
    serviceType: 'event',
    isTakeout: false,
    isEvent: true,
    orderFlow: 'deposit',

    eventCategoryId: categoryId,
    eventCategoryName: categoryName,
    eventDate: normalizedEventDate,
    eventGroupCount: normalizedGroupCount,
    eventMemo: toText(memo),

    customerIds: [],
    customerSummaries: [],
    items: [item],
    guestCount: 0,

    periodId: EVENT_PERIOD_ID,
    periodName: EVENT_PERIOD_NAME,

    subTotal: baseAmount,
    subtotal: baseAmount,
    rawTotalAmount: total,
    discountAmount: 0,
    promoExpenseAmount: 0,
    voucherAmount: 0,
    paymentAmount: total,
    receivedAmount: total,
    changeAmount: 0,
    settlementAdjustmentTotal: 0,
    salesAmountBeforeSettlementAdjustments: total,
    totalAmount: total,
    totalPrice: total,

    taxAmount,
    taxAmountReduced: reduced.tax,
    taxAmountStandard: standard.tax,
    taxRateReduced: Number(reducedRate),
    taxRateStandard: Number(standardRate),
    totalReducedIncl: reduced.included,
    totalStandardIncl: standard.included,
    taxSummary: {
      reducedTaxRate: Number(reducedRate),
      standardTaxRate: Number(standardRate),
      reducedTaxIncluded: reduced.included,
      reducedTaxExcluded: reduced.base,
      reducedTaxAmount: reduced.tax,
      standardTaxIncluded: standard.included,
      standardTaxExcluded: standard.base,
      standardTaxAmount: standard.tax
    },
    taxBreakdown: {
      reduced: { rate: Number(reducedRate), sales: reduced.included, baseAmount: reduced.base, tax: reduced.tax },
      standard: { rate: Number(standardRate), sales: standard.included, baseAmount: standard.base, tax: standard.tax }
    },

    discountType: 'none',
    discountValue: 0,
    appliedDiscounts: [],

    paymentMethod,
    paymentMethodGroup: paymentMethod,
    paymentMethodLabel: paymentMethodLabel || paymentMethod,
    payments: [{ method: paymentMethod, amount: total }],

    businessDate,
    isPaid: true,

    staffUid: toText(staff?.uid),
    staffName: toText(staff?.name)
  };
};

// 日計・分析用: イベント入金をカテゴリー別（＋開催日別）にまとめる。
export const summarizeEventDeposits = (records = [], { byDate = false } = {}) => {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (!isEventDepositRecord(record)) return;
    if (record.isPaid === false) return;
    if (record.isMethodAdjustment === true) return;
    // 締め後の取消(反対仕訳=マイナス伝票)は金額だけ差し引き、件数には数えない。
    const isReversal = record.isReversal === true || Boolean(record.reversalOf);
    const amount = Number(record.totalAmount || 0);
    // 当日取消で0円になった伝票は数えない。
    if (!isReversal && amount === 0) return;
    const categoryId = toText(record.eventCategoryId) || 'unknown';
    const categoryName = toText(record.eventCategoryName) || 'イベント';
    const eventDate = toText(record.eventDate);
    const key = byDate ? `${categoryId}__${eventDate}` : categoryId;
    if (!map.has(key)) {
      map.set(key, {
        key,
        categoryId,
        categoryName,
        eventDate: byDate ? eventDate : '',
        count: 0,
        groupCount: 0,
        total: 0
      });
    }
    const entry = map.get(key);
    if (!isReversal) {
      entry.count += 1;
      entry.groupCount += Math.max(Number(record.eventGroupCount) || 0, 0);
    }
    entry.total += amount;
  });
  return Array.from(map.values()).sort((left, right) => (
    (byDate ? String(right.eventDate).localeCompare(String(left.eventDate)) : 0)
    || right.total - left.total
    || left.categoryName.localeCompare(right.categoryName, 'ja')
  ));
};
