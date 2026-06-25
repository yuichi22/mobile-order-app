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

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  return null;
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

  const total =
    data.totalAmount ??
    data.totalPrice ??
    data.total ??
    data.totals?.total ??
    0;

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
    tax,
    taxAmountReduced: data.taxAmountReduced || 0,
    taxAmountStandard: data.taxAmountStandard || 0,
    total,
    paymentMethod: formatPaymentMethodText(data)
  };
};
