const escapeReceiptHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatAmount = (value) => Number(value || 0).toLocaleString();

const buildItemRows = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="item">商品明細なし</div>';
  }

  return items.map((item) => {
    const name = escapeReceiptHtml(item.name || item.itemName || item.productName || item.menuName || '商品');
    const quantity = Number(item.quantity ?? item.qty ?? item.count ?? 1) || 1;
    const unitPrice = Number(item.unitPrice ?? item.price ?? item.amount ?? 0) || 0;
    const totalPrice = Number(
      item.totalPrice ??
      item.lineTotal ??
      item.total ??
      unitPrice * quantity
    ) || 0;

    // 商品ごとの割引（会計伝票と同じく商品行の直下に表示）。
    const ld = item.lineDiscount;
    const lineDiscountRow = ld && Number(ld.amount || 0) > 0
      ? `<div class="item-sub" style="display:flex;justify-content:space-between;"><span>${escapeReceiptHtml(ld.label || '値引き')}</span><span>-¥${formatAmount(ld.amount)}</span></div>`
      : '';

    return `
      <div class="item">
        <div class="item-main">
          <span>${name}</span>
          <span>¥${formatAmount(totalPrice)}</span>
        </div>
        <div class="item-sub">¥${formatAmount(unitPrice)} × ${quantity}</div>
        ${lineDiscountRow}
      </div>
    `;
  }).join('');
};

export const openPosReceiptBrowserPrint = (payload = {}, options = {}) => {
  const receiptWindow = window.open('', '_blank', options.windowFeatures || 'width=420,height=760');

  if (!receiptWindow) {
    window.alert('ブラウザ印刷画面を開けませんでした。ポップアップ許可を確認してください。');
    return false;
  }

  const rows = buildItemRows(payload.items || []);
  const title = escapeReceiptHtml(payload.title || '領収書');
  const receiptScopeLabel = escapeReceiptHtml(payload.receiptScopeLabel || '');
  const storeName = escapeReceiptHtml(payload.storeName || 'Akuto Order System');
  const issuedAtText = escapeReceiptHtml(payload.issuedAtText || new Date().toLocaleString('ja-JP'));
  const tableName = escapeReceiptHtml(payload.tableName || payload.tableDisplayName || '');
  const registerName = escapeReceiptHtml(payload.registerName || '');
  // 会計ID(取引No)。Star/ブリッジと同じ payload.receiptNo を使い、印字面で揃える。
  const receiptNo = escapeReceiptHtml(payload.receiptNo || '');
  // 割引内訳（%割引・スタンプカード等）。配列が無ければ合計1行へフォールバックする。
  const discountLines = Array.isArray(payload.discounts) ? payload.discounts.filter((line) => Number(line?.amount || 0) > 0) : [];
  const discountRows = discountLines.length > 0
    ? discountLines.map((line) => `<div class="row"><span>${escapeReceiptHtml(line.label || '値引き')}</span><span>-¥${formatAmount(line.amount)}</span></div>`).join('')
    : (Number(payload.discount || payload.discountAmount || 0) > 0
      ? `<div class="row"><span>値引き</span><span>-¥${formatAmount(payload.discount || payload.discountAmount)}</span></div>`
      : '');
  // 税率別の内訳行。税込対象額があれば「{率}%対象」+「（内消費税{率}%）」の2行、無ければ税額のみ(旧伝票)へフォールバック。
  const taxRows = (() => {
    const tir = Number(payload.taxableIncludedReduced || 0);
    const tis = Number(payload.taxableIncludedStandard || 0);
    const tar = Number(payload.taxAmountReduced || 0);
    const tas = Number(payload.taxAmountStandard || 0);
    const rr = Number(payload.taxRateReduced || 8);
    const rs = Number(payload.taxRateStandard || 10);
    let html = '';
    if (tir > 0) {
      html += `<div class="row"><span>${rr}%対象</span><span>¥${formatAmount(tir)}</span></div>`;
      html += `<div class="row"><span>　（内消費税${rr}%）</span><span>¥${formatAmount(tar)}</span></div>`;
    } else if (tar > 0) {
      html += `<div class="row"><span>消費税 ${rr}%</span><span>¥${formatAmount(tar)}</span></div>`;
    }
    if (tis > 0) {
      html += `<div class="row"><span>${rs}%対象</span><span>¥${formatAmount(tis)}</span></div>`;
      html += `<div class="row"><span>　（内消費税${rs}%）</span><span>¥${formatAmount(tas)}</span></div>`;
    } else if (tas > 0) {
      html += `<div class="row"><span>消費税 ${rs}%</span><span>¥${formatAmount(tas)}</span></div>`;
    }
    if (tar === 0 && tas === 0) {
      html += `<div class="row"><span>うち消費税</span><span>¥${formatAmount(payload.tax || payload.taxAmount)}</span></div>`;
    }
    return html;
  })();
  const paymentMethod = escapeReceiptHtml(payload.paymentMethod || '');
  const hideRecipientAndProviso = payload.hideRecipientAndProviso === true;
  const recipientLabel = escapeReceiptHtml(payload.recipientLabel || (payload.recipientName ? `${payload.recipientName} 様` : '様'));
  const provisoLabel = escapeReceiptHtml(payload.provisoLabel || (payload.proviso ? `${payload.proviso} として` : 'として'));

  receiptWindow.document.write(`
    <!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page { size: 58mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #fff;
            color: #000;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            font-size: 10px;
            line-height: 1.35;
            font-weight: 700;
          }
          .receipt {
            width: 58mm;
            padding: 4mm 3mm;
          }
          .center { text-align: center; }
          .receipt-title {
            margin: 0 0 3mm;
            font-size: 16px;
            font-weight: 900;
            letter-spacing: .08em;
          }
          .store-name {
            margin-bottom: 1mm;
            font-size: 14px;
            font-weight: 900;
          }
          .section {
            border-top: 1px dashed #000;
            padding-top: 2mm;
            margin-top: 2mm;
          }
          .items-section {
            border-top: none;
            padding-top: 2.5mm;
            margin-top: 2mm;
          }
          .row,
          .item-main,
          .handwrite {
            display: flex;
            justify-content: space-between;
            gap: 8px;
          }
          .handwrite {
            min-height: 9mm;
            align-items: flex-end;
            margin-top: 2mm;
            padding-top: 1mm;
            padding-bottom: 1mm;
            border-bottom: 1px solid #000;
            font-weight: 900;
          }
          .item {
            margin-bottom: 1.8mm;
          }
          .item-main {
            font-weight: 900;
          }
          .item-sub {
            padding-left: 2mm;
            font-size: 9px;
            color: #111;
            font-weight: 700;
          }
          .total {
            min-height: 4.6mm;
            display: flex;
            align-items: center;
            font-size: 14px;
            font-weight: 900;
          }
          .footer {
            margin-top: 4mm;
            text-align: center;
            font-size: 9px;
            line-height: 1.7;
          }
          @media screen {
            body {
              background: #f3f4f6;
              padding: 16px;
            }
            .receipt {
              margin: 0 auto;
              background: #fff;
              box-shadow: 0 8px 24px rgba(0,0,0,.16);
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="center">
            ${payload.bannerImage ? `<img src="${escapeReceiptHtml(payload.bannerImage)}" alt="" style="max-width:100%;max-height:120px;margin:0 auto 6px;display:block;" />` : ''}
            <div class="receipt-title">${title}</div>
            ${payload.headerTitle ? `<div>${escapeReceiptHtml(payload.headerTitle)}</div>` : ''}
            <div class="store-name">${storeName}</div>
            ${payload.address ? `<div>${escapeReceiptHtml(payload.address)}</div>` : ''}
            ${payload.tel ? `<div>TEL: ${escapeReceiptHtml(payload.tel)}</div>` : ''}
            ${payload.invoiceNumber ? `<div>登録番号: ${escapeReceiptHtml(payload.invoiceNumber)}</div>` : ''}
          </div>

          <div class="section">
            <div class="row"><span>発行日時</span><span>${issuedAtText}</span></div>
            ${receiptNo ? `<div class="row"><span>会計No</span><span>${receiptNo}</span></div>` : ''}
            ${tableName ? `<div class="row"><span>テーブル</span><span>${tableName}</span></div>` : ''}
            ${registerName ? `<div class="row"><span>レジ</span><span>${registerName}</span></div>` : ''}
            ${paymentMethod ? `<div class="row"><span>支払い方法</span><span>${paymentMethod}</span></div>` : ''}
            ${receiptScopeLabel ? `<div class="row"><span>区分</span><span>${receiptScopeLabel}</span></div>` : ''}
            ${hideRecipientAndProviso ? '' : `<div class="handwrite"><span>宛名：</span><span>${recipientLabel}</span></div>`}
            ${hideRecipientAndProviso ? '' : `<div class="handwrite"><span>但し：</span><span>${provisoLabel}</span></div>`}
          </div>

          <div class="items-section">
            ${rows}
          </div>

          <div class="section">
            <div class="row"><span>小計</span><span>¥${formatAmount(payload.subtotal || payload.subTotal)}</span></div>
            ${discountRows}
            ${taxRows}
          </div>

          <div class="section">
            <div class="row total"><span>合計</span><span>¥${formatAmount(payload.total || payload.totalAmount || payload.totalPrice)}</span></div>
            ${Number(payload.receivedAmount || 0) > 0 ? `<div class="row"><span>お預かり</span><span>¥${formatAmount(payload.receivedAmount)}</span></div>` : ''}
            ${(Number(payload.receivedAmount || 0) > 0 || Number(payload.changeAmount || 0) > 0) ? `<div class="row"><span>おつり</span><span>¥${formatAmount(payload.changeAmount || 0)}</span></div>` : ''}
          </div>

          <div class="section footer">
            ${payload.footerNote
              ? escapeReceiptHtml(payload.footerNote).replaceAll('\n', '<br>')
              : '<div>ご利用ありがとうございました。</div><div>またのご来店をお待ちしております。</div>'}
          </div>
        </div>
        <script>
          window.onload = () => {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  receiptWindow.document.close();

  return true;
};
