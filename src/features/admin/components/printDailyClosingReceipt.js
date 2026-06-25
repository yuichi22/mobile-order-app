const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString()}`;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatDateTime = (date = new Date()) => {
  const target = new Date(date);
  return target.toLocaleString('ja-JP');
};

const row = (label, value, className = '') => `
  <div class="row ${className}">
    <span>${escapeHtml(label)}</span>
    <span>${escapeHtml(value)}</span>
  </div>
`;

const section = (content) => `
  <div class="section">
    ${content}
  </div>
`;

const sectionTitle = (title) => `
  <div class="section-title">${escapeHtml(title)}</div>
`;

const buildPaymentRows = (paymentMethodList = []) => {
  if (!paymentMethodList.length) {
    return '<div class="empty">データなし</div>';
  }

  return paymentMethodList.map((entry) => row(
    `${entry.label || entry.method || '未設定'} ${Number(entry.count || 0)}件`,
    formatCurrency(entry.total)
  )).join('');
};

const buildTaxRows = (taxBreakdownList = []) => {
  if (!taxBreakdownList.length) {
    return '<div class="empty">データなし</div>';
  }

  return taxBreakdownList.map((entry) => {
    const label = entry.key === 'reduced'
      ? '軽減税率'
      : entry.key === 'standard'
        ? '標準税率'
        : '税率未設定';

    return `
      ${row(`${label} ${Number(entry.rate || 0)}%`, formatCurrency(entry.sales), 'bold')}
      ${row('税抜対象額', formatCurrency(entry.baseAmount))}
      ${row('内消費税', formatCurrency(entry.tax))}
    `;
  }).join('');
};

const buildGrossProfitRows = (summary = {}) => {
  const grossProfitRate =
    summary.grossProfitRate === null || summary.grossProfitRate === undefined
      ? '-'
      : `${Number(summary.grossProfitRate || 0).toFixed(1)}%`;

  return `
    ${row('原価設定済み売上 税込', formatCurrency(summary.costConfiguredSalesTaxIncluded), 'bold')}
    ${row('原価設定済み売上 税抜', formatCurrency(summary.costConfiguredSalesTaxExcluded))}
    ${row('原価 税込', formatCurrency(summary.costTaxIncludedTotal))}
    ${row('原価 税抜', formatCurrency(summary.costTaxExcludedTotal))}
    ${row('粗利 税込', formatCurrency(summary.grossProfitTaxIncluded), 'bold')}
    ${row('粗利 税抜', formatCurrency(summary.grossProfitTaxExcluded))}
    ${row('粗利率', grossProfitRate, 'bold')}
    ${row('原価登録済み', `${Number(summary.costConfiguredItemCount || 0).toLocaleString()}点`)}
    ${row('原価未設定売上 税込', formatCurrency(summary.costMissingSalesTaxIncluded), Number(summary.costMissingSalesTaxIncluded || 0) > 0 ? 'bold' : '')}
    ${row('原価未設定売上 税抜', formatCurrency(summary.costMissingSalesTaxExcluded))}
    ${row('原価未設定', `${Number(summary.costMissingItemCount || 0).toLocaleString()}点`)}
  `;
};

const buildDiscountRows = (discountList = []) => {
  if (!discountList.length) {
    return '<div class="empty">利用なし</div>';
  }

  return discountList.map((discount) => row(
    `${discount.name || '値引き'} ${Number(discount.quantity || discount.count || 0)}枚`,
    formatCurrency(discount.amount)
  )).join('');
};

const buildTimeSlotRows = (timeSlotList = []) => {
  if (!timeSlotList.length) {
    return '<div class="empty">データなし</div>';
  }

  return timeSlotList.map((slot) => row(
    `${slot.name || '時間帯未設定'} ${Number(slot.count || 0)}件`,
    formatCurrency(slot.total)
  )).join('');
};

const buildCategoryRows = (categoryList = []) => {
  if (!categoryList.length) {
    return '<div class="empty">データなし</div>';
  }

  return categoryList.map((category) => row(
    `${category.name || 'カテゴリー未設定'} ${Number(category.quantity || 0)}点`,
    formatCurrency(category.total)
  )).join('');
};


const buildDepartmentRows = (departmentList = []) => {
  if (!departmentList.length) {
    return '<div class="empty">データなし</div>';
  }

  return departmentList.map((department) => row(
    `${department.name || department.departmentName || '部門未設定'} ${Number(department.count || 0)}件`,
    formatCurrency(department.total)
  )).join('');
};

const buildCashCheckRows = (cashCheck) => {
  if (!cashCheck) {
    return '<div class="empty">未確認</div>';
  }

  const difference = Number(cashCheck.difference || 0);

  return `
    ${row('現金売上', formatCurrency(cashCheck.expectedCashAmount))}
    ${row('実査額', formatCurrency(cashCheck.actualCashAmount))}
    ${row('差額', `${difference > 0 ? '+' : ''}${formatCurrency(difference)}`, 'bold')}
  `;
};

const buildCouponCheckRows = (couponCheck) => {
  if (!couponCheck) {
    return '<div class="empty">未確認</div>';
  }

  const difference = Number(couponCheck.difference || 0);
  const itemRows = Array.isArray(couponCheck.items)
    ? couponCheck.items.map((item) => row(
      `${item.name || 'クーポン'} ${Number(item.actualCount || 0)}枚`,
      formatCurrency(item.actualAmount)
    )).join('')
    : '';

  return `
    ${row('利用金額', formatCurrency(couponCheck.expectedTotalAmount))}
    ${row('実確認額', formatCurrency(couponCheck.actualTotalAmount))}
    ${row('差額', `${difference > 0 ? '+' : ''}${formatCurrency(difference)}`, 'bold')}
    ${itemRows ? `<div class="mini-section">${itemRows}</div>` : ''}
  `;
};

export const printDailyClosingReceipt = ({
  dateKey,
  summary,
  paymentMethodList = [],
  taxBreakdownList = [],
  discountList = [],
  timeSlotList = [],
  categoryList = [],
  departmentList = [],
  closedDailyData = null,
  settings = {}
}) => {
  const receiptWindow = window.open('', '_blank', 'width=420,height=760');

  if (!receiptWindow) {
    window.alert('印刷画面を開けませんでした。ポップアップブロックを確認してください。');
    return;
  }

  const totalSales = Number(summary?.totalSales || closedDailyData?.totalSales || 0);
  const totalSalesTaxExcluded = Number(summary?.totalSalesTaxExcluded || 0);
  const totalTaxAmount = Number(summary?.totalTaxAmount || 0);
  const customerCount = Number(summary?.customerCount || closedDailyData?.customerCount || 0);
  const transactionCount = Number(summary?.transactionCount || closedDailyData?.transactionCount || 0);
  const itemCount = Number(summary?.itemCount || closedDailyData?.itemCount || 0);
  const averageSpendPerCustomer = customerCount > 0
    ? Math.round(totalSales / customerCount)
    : 0;

  // 値引・クーポンの区分別 合計金額／適用延べ件数。
  const discountTotal = Number(summary?.discountTotal ?? closedDailyData?.discountTotal ?? 0);
  const promoExpenseTotal = Number(summary?.promoExpenseTotal ?? closedDailyData?.promoExpenseTotal ?? 0);
  const voucherTotal = Number(summary?.voucherTotal ?? closedDailyData?.voucherTotal ?? 0);
  const discountCount = Number(summary?.discountCount ?? closedDailyData?.discountCount ?? 0);
  const promoExpenseCount = Number(summary?.promoExpenseCount ?? closedDailyData?.promoExpenseCount ?? 0);
  const voucherCount = Number(summary?.voucherCount ?? closedDailyData?.voucherCount ?? 0);

  const cashCheck = closedDailyData?.cashCheck || null;
  const couponCheck = closedDailyData?.couponCheck || null;

  receiptWindow.document.write(`
    <!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>日計表 ${escapeHtml(dateKey)}</title>
        <style>
          body {
            margin: 0;
            padding: 24px;
            background: #f3f4f6;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          }

          .paper {
            width: 58mm;
            margin: 0 auto;
            background: #fff;
            color: #111827;
            padding: 0 0 8px;
          }

          .section {
            margin: 0 8px;
            padding: 10px 0;
            border-bottom: 1px dashed #111827;
          }

          .title {
            text-align: center;
          }

          .title h1 {
            margin: 0 0 6px;
            font-size: 18px;
          }

          .title p {
            margin: 2px 0;
            font-size: 10px;
          }

          .section-title {
            margin-bottom: 6px;
            font-size: 11px;
            font-weight: 700;
            text-align: center;
          }

          .row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
            margin: 2px 0;
            font-size: 10px;
          }

          .row span:first-child {
            min-width: 0;
            overflow-wrap: anywhere;
          }

          .row span:last-child {
            flex-shrink: 0;
            text-align: right;
            white-space: nowrap;
          }

          .bold {
            font-weight: 700;
          }

          .total {
            font-size: 14px;
            font-weight: 700;
          }

          .empty {
            padding: 4px 0;
            color: #6b7280;
            font-size: 10px;
            text-align: center;
          }

          .mini-section {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px dotted #9ca3af;
          }

          .footer {
            margin-top: 10px;
            text-align: center;
            font-size: 9px;
          }

          @media print {
            body {
              padding: 0;
              background: #fff;
            }

            .paper {
              width: 58mm;
            }
          }
        </style>
      </head>

      <body>
        <div class="paper">
          <div class="section title">
            <h1>${escapeHtml(settings?.name || '日計表')}</h1>
            ${settings?.address ? `<p>${escapeHtml(settings.address)}</p>` : ''}
            ${settings?.tel ? `<p>TEL: ${escapeHtml(settings.tel)}</p>` : ''}
            ${settings?.invoiceNumber ? `<p>登録番号: ${escapeHtml(settings.invoiceNumber)}</p>` : ''}
          </div>

          ${section(`
            ${row('日付', dateKey, 'bold')}
            ${row('発行日時', formatDateTime())}
            ${closedDailyData?.closedAt ? row('締め保存', '保存済み') : ''}
          `)}

          ${section(`
            ${sectionTitle('サマリー')}
            ${row('売上合計 税込', formatCurrency(totalSales), 'total')}
            ${row('売上合計 税抜', formatCurrency(totalSalesTaxExcluded))}
            ${row('内消費税', formatCurrency(totalTaxAmount))}
            ${row('来客数', `${customerCount.toLocaleString()}名`)}
            ${row('客単価', formatCurrency(averageSpendPerCustomer))}
            ${row('会計件数', `${transactionCount.toLocaleString()}件`)}
            ${row('販売点数', `${itemCount.toLocaleString()}点`)}
          `)}

          ${section(`
            ${sectionTitle('粗利・原価')}
            ${buildGrossProfitRows(summary)}
          `)}

          ${section(`
            ${sectionTitle('支払い方法別')}
            ${buildPaymentRows(paymentMethodList)}
          `)}

          ${section(`
            ${sectionTitle('税率別売上')}
            ${buildTaxRows(taxBreakdownList)}
          `)}

          ${section(`
            ${sectionTitle('値引・クーポン利用')}
            ${row(`売上値引 (${discountCount}件)`, formatCurrency(discountTotal))}
            ${row(`販促費 (${promoExpenseCount}件)`, formatCurrency(promoExpenseTotal))}
            ${row(`金券/売掛 (${voucherCount}件)`, formatCurrency(voucherTotal))}
            ${discountList.length ? `<div class="mini-section">${buildDiscountRows(discountList)}</div>` : ''}
          `)}

          ${section(`
            ${sectionTitle('現金確認')}
            ${buildCashCheckRows(cashCheck)}
          `)}

          ${section(`
            ${sectionTitle('クーポン確認')}
            ${buildCouponCheckRows(couponCheck)}
          `)}

          ${section(`
            ${sectionTitle('時間帯別売上')}
            ${buildTimeSlotRows(timeSlotList)}
          `)}

          ${section(`
            ${sectionTitle('部門別売上')}
            ${buildDepartmentRows(departmentList)}
          `)}

          ${section(`
            ${sectionTitle('カテゴリー別売上')}
            ${buildCategoryRows(categoryList)}
          `)}

          <div class="footer">
            <p>日計表を印刷しました。</p>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
      </body>
    </html>
  `);

  receiptWindow.document.close();
};