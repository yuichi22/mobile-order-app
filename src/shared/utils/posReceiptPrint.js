const formatInvoiceNumber = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.startsWith('T') ? normalized : `T${normalized}`;
};

const formatPaymentMethod = (method) => {
  if (method === 'cash') return '現金';
  if (method === 'card' || method === 'credit') return 'カード';
  if (method === 'qr' || method === 'paypay') return 'QR決済';
  return method || '未設定';
};

// 現金＋カード/QR の分割会計は「現金 ¥1,000 / カード ¥2,000」のように内訳を表示する。
const formatPaymentMethodText = (data) => {
  if (Array.isArray(data?.payments) && data.payments.length > 0) {
    return data.payments
      .map((payment) => `${formatPaymentMethod(payment.method)} ¥${Number(payment.amount || 0).toLocaleString()}`)
      .join(' / ');
  }
  return formatPaymentMethod(data?.paymentMethod);
};

// 支払い内訳テキスト。金券/売掛(voucherAmount)は「値引き」ではなく充当(お支払い)として
// 現金/カード等と並べて表示する。金券/売掛が無い会計は従来表示のまま。
export const buildTenderText = (data = {}) => {
  const voucher = Math.max(0, Number(data.voucherAmount || 0) || 0);
  if (voucher <= 0) return formatPaymentMethodText(data);

  const lines = [];
  if (Array.isArray(data.payments) && data.payments.length > 0) {
    data.payments.forEach((payment) => {
      const amount = Number(payment.amount || 0) || 0;
      if (amount !== 0) lines.push(`${formatPaymentMethod(payment.method)} ¥${amount.toLocaleString()}`);
    });
  } else {
    const base = Math.max(0, Number(data.totalAmount ?? 0) || 0);
    if (base > 0) lines.push(`${formatPaymentMethod(data.paymentMethod)} ¥${base.toLocaleString()}`);
  }
  // 使った金券/売掛の名称(券名)を併記する。
  const voucherNames = (Array.isArray(data.vouchers) ? data.vouchers : [])
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);
  const voucherLabel = voucherNames.length > 0 ? `金券/売掛（${voucherNames.join('・')}）` : '金券/売掛';
  lines.push(`${voucherLabel} ¥${voucher.toLocaleString()}`);
  return lines.join(' / ');
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  return null;
};

// レシートに名前付きで並べる「値引き」行を作る。
// 通常割引(%/円=sales_discount)と販促費(スタンプカード等=promo_expense)は、顧客が実際に
// 安くなる値引きとして合計を下げる。金券/売掛(voucher_payment)は値引きではなく「お支払い(充当)」
// として扱うため、ここには含めない(buildTenderText 側で内訳表示)。
const buildDiscountLines = (data = {}) => {
  const lines = [];
  const pushLine = (entry, fallbackLabel) => {
    const amount = Number(entry?.amount || 0) || 0;
    if (amount <= 0) return;
    lines.push({ label: entry.label || entry.name || fallbackLabel, amount });
  };

  const applied = Array.isArray(data.appliedDiscounts) && data.appliedDiscounts.length > 0
    ? data.appliedDiscounts
    : (data.appliedDiscount ? [data.appliedDiscount] : []);
  // 金券/売掛(voucher_payment)は値引きではなく支払い内訳(buildTenderで券名併記)に回すため除外する。
  // (POS/takeoutは appliedDiscounts にも売掛が入るため、ここで弾かないと二重表示になる。)
  applied
    .filter((discount) => discount?.accountingCategory !== 'voucher_payment')
    .forEach((discount) => pushLine(discount, '値引き'));

  (Array.isArray(data.promoExpenseItems) ? data.promoExpenseItems : [])
    .forEach((item) => pushLine(item, '販促値引き'));

  return lines;
};

const normalizeItems = (items = []) => {
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const quantity = Number(item.quantity ?? item.qty ?? item.count ?? 1) || 1;
    const unitPrice = Number(item.unitPrice ?? item.price ?? item.amount ?? 0) || 0;
    const totalPrice = Number(
      item.totalPrice ??
      item.lineTotal ??
      item.total ??
      unitPrice * quantity
    ) || 0;

    return {
      name: item.name || item.itemName || item.productName || item.menuName || '商品',
      quantity,
      unitPrice,
      totalPrice
    };
  });
};

export const buildPosReceiptPrintPayload = (data = {}, settings = {}) => {
  const issuedAt =
    toDate(data.paidAt) ||
    toDate(data.timestamp) ||
    toDate(data.createdAt) ||
    new Date();

  const items = normalizeItems(data.lineItems || data.items || []);

  const subtotal =
    data.subTotal ??
    data.subtotal ??
    data.totals?.subtotal ??
    0;

  const tax =
    data.taxAmount ??
    data.totals?.tax ??
    Number(data.taxAmountReduced || 0) + Number(data.taxAmountStandard || 0);

  // 領収書・レシートの「合計」は満額(金券/売掛の充当前)で表示する。
  // 全額金券/売掛でも合計¥0にならず、満額が印字される(充当は支払い内訳に出す)。
  const receivedTotal =
    data.totalAmount ??
    data.totalPrice ??
    data.total ??
    data.totals?.total ??
    0;
  const total = Number(receivedTotal || 0) + Math.max(0, Number(data.voucherAmount || 0) || 0);

  return {
    title: data.title || '領収書',
    receiptType: data.receiptType || '',
    receiptScopeLabel: data.receiptScopeLabel || '',
    storeName: settings?.name || 'Akuto Order System',
    address: settings?.address || '',
    tel: settings?.tel || '',
    invoiceNumber: formatInvoiceNumber(settings?.invoiceNumber),
    tableName:
      data.tableDisplayName ||
      data.tableName ||
      (data.tableId ? `テーブル ${data.tableId}` : ''),
    // 使用レジ名（例: メインレジ1）。複数iPad/レジでどの端末の会計かを区別するため印字する。
    registerName: data.registerName || data.registerLabel || '',
    receiptNo:
      data.receiptNo ||
      data.receiptNumber ||
      (data.sessionId ? data.sessionId.slice(0, 8) : ''),
    issuedAtText: issuedAt.toLocaleString('ja-JP'),
    recipientName: data.recipientName || '',
    recipientLabel: data.recipientName ? `${data.recipientName} 様` : '様',
    proviso: data.proviso || '',
    provisoLabel: data.proviso ? `${data.proviso} として` : 'として',
    items,
    subtotal,
    discount: data.discountAmount || data.totals?.discount || 0,
    // 割引内訳（%割引・スタンプカード等）を名前付きで個別行に印字する。
    discounts: buildDiscountLines(data),
    tax,
    taxAmountReduced: data.taxAmountReduced || 0,
    taxAmountStandard: data.taxAmountStandard || 0,
    total,
    paymentMethod: buildTenderText(data)
  };
};
