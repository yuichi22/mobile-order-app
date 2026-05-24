const formatPaymentMethod = (method) => {
  if (method === 'cash') return '現金';
  if (method === 'card' || method === 'credit') return 'カード';
  if (method === 'qr' || method === 'paypay') return 'QR決済';
  return method || '未設定';
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
    storeName: settings?.name || 'Akuto Order System',
    address: settings?.address || '',
    tel: settings?.tel || '',
    invoiceNumber: settings?.invoiceNumber || '',
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
    items,
    subtotal,
    discount: data.discountAmount || data.totals?.discount || 0,
    tax,
    taxAmountReduced: data.taxAmountReduced || 0,
    taxAmountStandard: data.taxAmountStandard || 0,
    total,
    paymentMethod: formatPaymentMethod(data.paymentMethod)
  };
};
