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
  // お釣りON金券は「回収=額面(充当+お釣り)」で表示し、お釣りを別行で出す。
  const voucherChange = Math.max(0, Number(data.voucherChangeAmount || 0) || 0);
  if (voucher <= 0 && voucherChange <= 0) return formatPaymentMethodText(data);

  const lines = [];
  if (Array.isArray(data.payments) && data.payments.length > 0) {
    data.payments.forEach((payment) => {
      // 金券お釣りの現金マイナス(ドロワー記録用)は「おつり」行で出すため内訳からは除外する。
      if (payment?.isVoucherChange) return;
      const amount = Number(payment.amount || 0) || 0;
      if (amount !== 0) lines.push(`${formatPaymentMethod(payment.method)} ¥${amount.toLocaleString()}`);
    });
  } else {
    const base = Math.max(0, Number(data.totalAmount ?? 0) || 0);
    if (base > 0) lines.push(`${formatPaymentMethod(data.paymentMethod)} ¥${base.toLocaleString()}`);
  }
  // 使った金券/売掛の名称(券名)を併記する。金額は別に出るため「×N枚」の枚数表記は券名から除去し、
  // 保存データのばらつき(「おまっち ×1枚」/「おまっち」)を「おまっち」に統一する。
  const voucherNames = (Array.isArray(data.vouchers) ? data.vouchers : [])
    .map((item) => String(item?.name || '').replace(/\s*[×✕xX]\s*\d+\s*枚\s*$/, '').trim())
    .filter(Boolean);
  const voucherLabel = voucherNames.length > 0 ? `金券/売掛（${voucherNames.join('・')}）` : '金券/売掛';
  lines.push(`${voucherLabel} ¥${(voucher + voucherChange).toLocaleString()}`);
  // お釣り額は独立した「おつり」行(receivedAmount/changeAmount)で印字するためここには含めない。
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

  // 金券/売掛(voucher_payment)は値引きではなく支払い内訳(buildTenderで券名併記)に回すため除外する。
  const isVoucher = (entry) => entry?.accountingCategory === 'voucher_payment';

  const applied = Array.isArray(data.appliedDiscounts) && data.appliedDiscounts.length > 0
    ? data.appliedDiscounts
    : (data.appliedDiscount ? [data.appliedDiscount] : []);

  // 重要: 同じ割引が appliedDiscounts と promoExpenseItems の両方に保存される(会計区分別の再掲)ため、
  // 単純連結すると二重計上になる。appliedDiscounts を正とし、items があれば各クーポンへ展開する。
  // promoExpenseItems は appliedDiscounts が空(それ単独の割引)のときだけフォールバックで使う。
  if (applied.length > 0) {
    applied.forEach((discount) => {
      if (Array.isArray(discount?.items) && discount.items.length > 0) {
        // 複数クーポン等は各クーポン単位に1行ずつ展開する(金券itemは支払い充当なので除外)。
        discount.items
          .filter((item) => !isVoucher(item))
          .forEach((item) => pushLine(item, discount.name || '値引き'));
      } else if (!isVoucher(discount)) {
        pushLine(discount, '値引き');
      }
    });
  } else {
    (Array.isArray(data.promoExpenseItems) ? data.promoExpenseItems : [])
      .forEach((item) => pushLine(item, '販促値引き'));
  }

  return lines;
};

// 商品個別割引(item.lineDiscount)を、レシート印字用の { label, amount } に整える。
// 会計伝票と同じく「割引名（10%OFF）」の形にする（%のときのみ %OFF を併記）。
const normalizeLineDiscount = (lineDiscount) => {
  const amount = Number(lineDiscount?.amount || 0) || 0;
  if (amount <= 0) return null;
  const value = Number(lineDiscount?.value || 0) || 0;
  const isPercent = lineDiscount?.type === 'percent';
  const baseName = lineDiscount?.name || (isPercent ? `${value}%OFF` : '値引き');
  const label = isPercent && lineDiscount?.name ? `${baseName}（${value}%OFF）` : baseName;
  return { label, amount };
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
      totalPrice,
      // 商品ごとの割引（会計伝票と同じく商品行の直下に印字する）。
      lineDiscount: normalizeLineDiscount(item.lineDiscount)
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

  // 税率別の「税込対象額」(適格簡易請求書の「税率ごとの対価の合計額」)。
  // 会計伝票の taxBreakdown(reduced/standard.sales=税込) を正とし、無ければ taxSummary(*TaxIncluded)へフォールバック。
  const taxBreakdown = data.taxBreakdown || {};
  const taxSummary = data.taxSummary || {};
  // フラット値(data.taxableIncluded*)→ 税内訳(taxBreakdown.sales)→ taxSummary(*TaxIncluded) の順で解決。
  // 履歴の再印刷では nested な taxBreakdown が落ちるため、フラット値を第一候補にする。
  const taxableIncludedReduced = Number(
    data.taxableIncludedReduced ?? taxBreakdown.reduced?.sales ?? taxSummary.reducedTaxIncluded ?? 0
  ) || 0;
  const taxableIncludedStandard = Number(
    data.taxableIncludedStandard ?? taxBreakdown.standard?.sales ?? taxSummary.standardTaxIncluded ?? 0
  ) || 0;

  // お預かり(現金の預かり額)とおつり。おつりは現金の釣銭＋金券お釣り(額面超過の現金払い戻し)の合算。
  // お預かりは現金会計のみ意味を持つ(カード/QRは総額が入るだけなので出さない)。
  const isCashTender = String(data.paymentMethod || data.method || '') === 'cash';
  const receivedAmount = isCashTender ? Number(data.receivedAmount ?? data.paymentAmount ?? 0) || 0 : 0;
  const changeAmount = (isCashTender ? Number(data.changeAmount ?? data.change ?? 0) || 0 : 0)
    + Math.max(0, Number(data.voucherChangeAmount || 0) || 0);

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
    // 会計No(会計ID)。取引IDを正とする。sessionId は takeout 会計だと "takeout-..." になり
    // "takeout" と表示されてしまうため、transactionId/取引IDを優先し、最後の手段でのみ sessionId を使う。
    receiptNo:
      data.receiptNo ||
      data.receiptNumber ||
      data.transactionId ||
      data.sourceTransactionId ||
      data.id ||
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
    // 税率別の税込対象額(税率ごとの対価の合計額)。0のとき(旧伝票=内訳なし)は税額のみのフォールバック表示になる。
    taxableIncludedReduced,
    taxableIncludedStandard,
    // 税率（会計伝票と同じく 8%/10% を分けて表示するため。既定は軽減8%/標準10%）。
    taxRateReduced: Number(data.taxRateReduced) || 8,
    taxRateStandard: Number(data.taxRateStandard) || 10,
    total,
    paymentMethod: buildTenderText(data),
    // レンダラ(ブラウザ印刷/Starネイティブ/ブリッジ)で「お預かり」「おつり」行を出すための金額。
    receivedAmount,
    changeAmount
  };
};
