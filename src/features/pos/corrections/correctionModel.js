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
