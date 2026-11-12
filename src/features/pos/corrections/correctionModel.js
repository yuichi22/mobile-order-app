// 取消/返品/支払方法訂正の共通ロジック（純関数）。
// 設計: 対象伝票の営業日がロック済み(締め後/過去日)なら「操作日に反対(マイナス)伝票」を
// 起こす。未締め当日なら元伝票をその場で減額する(呼び出し側の既存処理)。
// 参照: メモリ mobile-order-corrections-redesign。

export const CORRECTION_TYPES = Object.freeze({
  CANCEL: 'cancel', // 会計取消
  RETURN: 'return', // 返品
  PAYMENT_FIX: 'payment_fix' // 支払方法の打ち間違い訂正
});

// JST(Asia/Tokyo)の営業日 YYYY-MM-DD。会計/締めの businessDate と同一表現。
// (PosRegister.jsx の getJstBusinessDate と同じ。将来こちらに一本化する)
export const getJstBusinessDate = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date); // "2026-07-02"
};

// 反対仕訳(マイナス伝票)かどうか。集計側はこれで件数/客数からの除外を判定する。
export const isReversalTransaction = (transaction = {}) => (
  transaction?.isReversal === true || Boolean(transaction?.reversalOf)
);

// 対象営業日がロック済み(締め後 or 過去日)か。D1: closed か businessDate<当日。
// closings は { [dateKey]: { status } } 形式(dailyClosings/{date} のミラー)。
export const isDayLocked = (businessDate, { closings = {}, today = getJstBusinessDate() } = {}) => {
  const dateKey = String(businessDate || '').trim();
  if (!dateKey) return false; // 営業日不明は安全側で当日扱い(その場減額)にせず、呼び出し側で判断
  if (dateKey < today) return true; // 過去日は常にロック
  return closings?.[dateKey]?.status === 'closed';
};

// 数値を負に丸める(マイナス伝票の金額生成用)。
const neg = (value) => -Math.abs(Number(value || 0));

// 反対仕訳の明細行を、元取引の明細 + 取消数量から作る。
// entries: [{ item, quantity }] (item は元 transaction.items の1要素、quantity は取消数)
// 金額系は「取消数ぶんのマイナス」。数量もマイナスにして item分析が純額になるようにする。
// netRatio: 割引後にスケールする率(取引の totalAmount / 明細グロス合計)。既定=1(割引なし)。
export const buildReversalItems = (entries = [], netRatio = 1) => (
  entries
    .filter((entry) => entry && entry.item && Number(entry.quantity) > 0)
    .map(({ item, quantity }) => {
      const originalQty = Number(item.quantity || 0) || 1;
      const cancelQty = Math.min(Math.max(Number(quantity), 0), Math.max(originalQty, Number(quantity)));
      const ratio = (originalQty > 0 ? cancelQty / originalQty : 1) * (Number(netRatio) || 1);
      const scaleNeg = (value) => neg(Math.round(Number(value || 0) * ratio));
      return {
        ...item,
        quantity: -cancelQty,
        totalPrice: scaleNeg(item.totalPrice),
        taxIncludedAmount: scaleNeg(item.taxIncludedAmount),
        salesTaxIncludedAmount: scaleNeg(item.salesTaxIncludedAmount),
        salesTaxExcludedAmount: scaleNeg(item.salesTaxExcludedAmount),
        salesTaxAmount: scaleNeg(item.salesTaxAmount),
        costTaxIncludedAmount: scaleNeg(item.costTaxIncludedAmount),
        costTaxExcludedAmount: scaleNeg(item.costTaxExcludedAmount),
        costTaxAmount: scaleNeg(item.costTaxAmount),
        grossProfitTaxIncluded: scaleNeg(item.grossProfitTaxIncluded),
        grossProfitTaxExcluded: scaleNeg(item.grossProfitTaxExcluded)
      };
    })
);

// 反対仕訳(マイナス)伝票の payments[] を作る。原則は元取引の支払手段に払い戻す。
// original.payments があればその比率で配分、無ければ単一手段(元 paymentMethod)に全額マイナス。
export const buildReversalPayments = (original = {}, refundAmount = 0) => {
  const amount = Math.abs(Number(refundAmount || 0));
  if (amount <= 0) return [];
  const originalPayments = Array.isArray(original.payments) ? original.payments.filter((p) => Number(p?.amount)) : [];
  if (originalPayments.length > 1) {
    const originalTotal = originalPayments.reduce((sum, p) => sum + Math.abs(Number(p.amount || 0)), 0) || 1;
    let allocated = 0;
    return originalPayments.map((p, index) => {
      const isLast = index === originalPayments.length - 1;
      const share = isLast
        ? amount - allocated
        : Math.round((amount * Math.abs(Number(p.amount || 0))) / originalTotal);
      allocated += share;
      return { method: p.method, amount: -share };
    });
  }
  const method = original.paymentMethodGroup || original.paymentMethod || 'cash';
  return [{ method, amount: -amount }];
};

// 元伝票の販促費/金券の内訳(promoExpenseItems / vouchers)を、取消分の金額で按分したマイナス明細にする。
// 日計で「メガネイベント商品券（返品）−2,000円」のように券名つきで戻すため。
export const buildReversalAdjustmentItems = (originalItems = [], refundAmount = 0) => {
  const amount = Math.abs(Math.round(Number(refundAmount || 0)));
  const items = (Array.isArray(originalItems) ? originalItems : [])
    .filter((item) => Number(item?.faceAmount ?? item?.amount ?? 0) > 0);
  if (amount <= 0 || items.length === 0) return [];
  const total = items.reduce((sum, item) => sum + Number(item.faceAmount ?? item.amount ?? 0), 0) || 1;
  let allocated = 0;
  return items.map((item, index) => {
    const share = index === items.length - 1
      ? amount - allocated
      : Math.round((amount * Number(item.faceAmount ?? item.amount ?? 0)) / total);
    allocated += share;
    return {
      id: item.id || '',
      name: item.name || item.label || '',
      type: item.type || 'amount',
      value: Number(item.value || 0),
      accountingCategory: item.accountingCategory || '',
      amount: -share,
      count: 1,
      quantity: -1
    };
  }).filter((item) => item.amount < 0);
};

// 反対仕訳(マイナス)伝票の完全ペイロードを組み立てる。
// original: 元 transaction, reversalItems: buildReversalItems の結果, sums: 再計算済み負値合計。
export const buildReversalTransaction = ({
  original = {},
  reversalItems = [],
  totals = {},
  correctionType = CORRECTION_TYPES.CANCEL,
  reason = '',
  operator = {},
  businessDate = getJstBusinessDate()
}) => {
  const totalAmount = -Math.abs(Number(totals.totalAmount || 0));
  const payments = buildReversalPayments(original, totalAmount);
  const isSplit = payments.length > 1;
  return {
    // 識別コンテキストは元取引から引き継ぐ(集計の部門/チャネル/卓を保つ)
    sessionId: original.sessionId || '',
    tableId: original.tableId || '',
    tableName: original.tableName || original.tableDisplayName || '',
    registerId: operator.registerId || original.registerId || '',
    registerName: operator.registerName || original.registerName || '',
    departmentId: original.departmentId || '',
    departmentName: original.departmentName || '',
    registerMode: original.registerMode || 'order',
    salesChannel: original.salesChannel || '',
    salesChannelLabel: original.salesChannelLabel || '',
    // CRM会員。これが無いと Core の付与トリガーが反対仕訳を拾えず、
    // 取消しても「貯まったポイント」が戻らない(金額は負なので付与も自動的に負になる)。
    ...(original.personId ? { personId: original.personId, crmSource: original.crmSource || null } : {}),
    // 反対仕訳マーカー
    isReversal: true,
    reversalOf: original.id || original.transactionId || '',
    originalBusinessDate: original.businessDate || '', // 取消した元売上の営業日(表示用)
    correctionType,
    reversalReason: String(reason || '').trim(),
    // 明細・金額(すべて負)
    items: reversalItems,
    subTotal: -Math.abs(Number(totals.subTotal || 0)),
    totalAmount,
    taxAmount: -Math.abs(Number(totals.taxAmount || 0)),
    taxAmountReduced: -Math.abs(Number(totals.taxAmountReduced || 0)),
    taxAmountStandard: -Math.abs(Number(totals.taxAmountStandard || 0)),
    // 値引き/販促費/金券・売掛の取消分を負で計上する。日計は反対仕訳を
    // 「取消・返品」欄に totalAmount + settlementAdjustmentTotal で計上するため、
    // 金券・売掛の充当分(voucher/promo)を settlementAdjustmentTotal に含める必要がある。
    discountAmount: -Math.abs(Number(totals.discountAmount || 0)),
    promoExpenseAmount: -Math.abs(Number(totals.promoExpenseAmount || 0)),
    voucherAmount: -Math.abs(Number(totals.voucherAmount || 0)),
    settlementAdjustmentTotal: -(Math.abs(Number(totals.promoExpenseAmount || 0)) + Math.abs(Number(totals.voucherAmount || 0))),
    promoExpenseItems: buildReversalAdjustmentItems(original.promoExpenseItems, totals.promoExpenseAmount),
    vouchers: buildReversalAdjustmentItems(original.vouchers, totals.voucherAmount),
    // 支払(払い戻し先。現金返金は現金ドロワーを減らす=負)
    paymentMethod: isSplit ? 'mixed' : (payments[0]?.method || original.paymentMethod || 'cash'),
    paymentMethodGroup: isSplit ? 'mixed' : (payments[0]?.method || original.paymentMethodGroup || 'cash'),
    ...(isSplit ? { payments, isSplitPayment: true } : {}),
    // 反対仕訳は「客数・件数」には数えないが、売上/入金には効かせる(集計側で isReversal 判定)
    customerIds: [],
    guestCount: 0,
    // ステータス: 集計対象に含めるため isPaid=true のまま(NET方式は isPaid=false を除外するため)
    isPaid: true,
    status: 'reversal',
    paymentStatus: 'reversal',
    businessDate
  };
};

// 値引き行(単価・金額がマイナスの明細。ポータルのメガネ会計の「イベント割引」等)か。
export const isNegativeValueLine = (item = {}) => (
  Number(item?.totalPrice ?? (Number(item?.unitPrice || 0) * (Number(item?.quantity || 0) || 1))) < 0
);

// 取消数量の実効値を求める。値引き行(マイナス明細)は手で選ばせず、売上の明細に連動させる:
// その会計の売上の明細(プラス)が今回の取消で全部なくなるときだけ、値引き行も全数取消する。
// (2026-11: メガネだけ選んで取消すると −2,000円の値引き行だけの会計が日計に残った)
// プラス明細が既に無い会計(値引き行だけ残った旧データ)は、値引き行を手で選んだ数のまま使う。
// entries: [{ key, txnId, item, maxQty }]、qtyMap: { [key]: 選択数 }。返り値は新しい map。
export const resolveCancelQuantities = (entries = [], qtyMap = {}) => {
  const result = { ...qtyMap };
  const byTxn = new Map();
  entries.forEach((entry) => {
    if (!entry?.key) return;
    const list = byTxn.get(entry.txnId) || [];
    list.push(entry);
    byTxn.set(entry.txnId, list);
  });
  const capOf = (entry) => Number(entry.maxQty ?? (entry.item?.quantity || 0)) || 1;
  const selOf = (entry) => Math.min(Math.max(Number(qtyMap[entry.key] || 0), 0), capOf(entry));
  byTxn.forEach((list) => {
    const positives = list.filter((entry) => !isNegativeValueLine(entry.item));
    const negatives = list.filter((entry) => isNegativeValueLine(entry.item));
    if (negatives.length === 0 || positives.length === 0) return;
    const allPositivesGone = positives.every((entry) => selOf(entry) >= capOf(entry));
    negatives.forEach((entry) => {
      result[entry.key] = allPositivesGone ? capOf(entry) : 0;
    });
  });
  return result;
};

// 値引き行が売上の明細に連動して自動で決まる(手で選ばない)か。
export const isAutoFollowedLine = (entries = [], entry = {}) => (
  isNegativeValueLine(entry.item)
  && entries.some((other) => other.txnId === entry.txnId && !isNegativeValueLine(other.item))
);
