// 「取消してカートに戻す」(再会計)の共通ロジック(純関数)。
// 流れ: 会計済み伝票を全額取消(取消/締め後は反対仕訳。correctionModel と同じ経路) →
// 明細・割引・会員を POSレジのカートへ読み込む → 打ち直して新しい伝票にする。
// 単価は会計時の値(unitPrice)をそのまま使う。商品マスタの最新価格にはしない
// (お客様に提示した額で打ち直すため。予約注文の展開と同じ考え方)。

import { LINE_POINT_ACCOUNTING_OPTIONS, LINE_POINT_ITEM_ID, buildLinePointItem, resolveLinePointSettings } from '../../../shared/constants/linePoints';

// 取消の理由に必ず残す文言(履歴・日計で「打ち直しのための取消」と分かるように)。
export const RECHECKOUT_REASON = '再会計のため';

// 再会計できる伝票か。最初は POSレジの会計だけ(卓の会計は卓のセッションへ戻す必要があるため対象外)。
// groom 会計依頼の伝票は依頼(checkoutRequests)が paid のまま残るので対象外。
export const isRecheckoutEligibleTransaction = (tx = {}) => (
  Boolean(tx)
  && tx.isReversal !== true
  && !tx.reversalOf
  && tx.isMethodAdjustment !== true
  && (tx.registerMode === 'pos' || tx.salesChannel === 'pos_register')
  && tx.source !== 'groom'
);

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const nullableNumber = (value) => (
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
);

// 会計時の単価(税込)。unitPrice が無い古い明細は割引前のライン額 ÷ 数量で戻す。
const resolveUnitPrice = (item = {}) => {
  if (Number.isFinite(Number(item.unitPrice)) && item.unitPrice !== null && item.unitPrice !== '') {
    return Math.max(Number(item.unitPrice), 0);
  }
  const qty = toNumber(item.quantity) || 1;
  const lineTotal = toNumber(item.originalLineTotal ?? item.totalPrice);
  return Math.max(Math.round(lineTotal / qty), 0);
};

// 明細割引をカート行の形(type/value)へ戻す。金額割引は戻す数量の割合で縮める
// (一部が反対仕訳で取消済みの明細でも、残り数量に見合う割引だけを掛ける)。
const restoreLineDiscount = (lineDiscount, quantity, originalQuantity) => {
  if (!lineDiscount || toNumber(lineDiscount.amount ?? lineDiscount.value) <= 0) return null;
  const type = lineDiscount.type === 'amount' ? 'amount' : 'percent';
  const ratio = originalQuantity > 0 ? Math.min(quantity / originalQuantity, 1) : 1;
  const value = type === 'amount'
    ? Math.floor(toNumber(lineDiscount.value || lineDiscount.amount) * ratio)
    : Math.max(0, Math.min(100, toNumber(lineDiscount.value)));
  if (value <= 0) return null;
  return {
    type,
    value,
    discountId: lineDiscount.discountId || null,
    name: lineDiscount.name || '',
    accountingCategory: lineDiscount.accountingCategory === 'promo_expense' ? 'promo_expense' : 'sales_discount'
  };
};

// entries: [{ txnId, index, item, maxQty }](取消モーダルの明細。maxQty=反対仕訳で取消済みを除いた残数)
// productsById: Map(productId → 商品doc)。原価・在庫管理の有無は会計明細に無いので商品から補う。
export const buildRecheckoutCartItems = (entries = [], productsById = new Map()) => {
  const usedIds = new Set();
  const cart = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const item = entry?.item;
    if (!item) return;
    const originalQuantity = toNumber(item.quantity) || 1;
    const quantity = Math.max(0, Math.floor(toNumber(entry.maxQty ?? originalQuantity)));
    if (quantity <= 0) return;

    const productId = String(item.productId || '').replace(/^product:/, '');
    const sourceType = item.sourceType || 'manual';
    const product = productId ? (productsById.get(productId) || null) : null;

    // 物販はスキャン追加と同じ ID にして、同じ商品を読んだら同じ行に数量が足されるようにする。
    // 同じ商品が別行(明細割引違いなど)で複数あるときは行を分けたまま戻す。
    let id = sourceType === 'retail' && productId
      ? `product:${productId}`
      : `recheckout:${entry.txnId || ''}:${entry.index ?? cart.length}`;
    if (usedIds.has(id)) id = `${id}#${entry.index ?? cart.length}`;
    usedIds.add(id);

    const unitPrice = resolveUnitPrice(item);
    const lineDiscount = restoreLineDiscount(item.lineDiscount, quantity, originalQuantity);

    cart.push({
      id,
      productId,
      sourceType,
      name: item.name || '商品',
      categoryId: item.categoryId || '',
      categoryName: item.categoryName || 'カテゴリー',
      salesAreaId: item.salesAreaId || '',
      salesAreaName: item.salesAreaName || '',
      categoryGroupId: item.categoryGroupId || '',
      categoryGroupName: item.categoryGroupName || '',
      brandId: item.brandId || '',
      brandName: item.brandName || '',
      productSupplierCostRate: nullableNumber(product?.supplierCostRate),
      productCostTaxIncludedUnit: nullableNumber(product?.costTaxIncluded),
      productCostTaxExcludedUnit: nullableNumber(product?.costTaxExcluded),
      takeoutPrice: unitPrice,
      unitPrice,
      priceTaxIncluded: unitPrice,
      taxRate: nullableNumber(item.taxRate ?? item.salesTaxRate),
      barcode: item.barcode || '',
      sku: item.sku || '',
      stockQuantity: product
        ? Math.max(Math.floor(toNumber(product.inventoryQuantity ?? product.quantity)), 0)
        : (item.stockQuantity ?? null),
      inventoryUnmanaged: Boolean(product?.inventoryUnmanaged),
      quantity,
      ...(lineDiscount ? { lineDiscount } : {})
    });
  });
  return cart;
};

// 伝票割引(appliedDiscount)をカートの割引状態({type, value, selected})へ戻す。
// - %割引・クーポン/値引き(売上値引き・販促費)は戻す
// - 金券・売掛(voucher_payment)・全額売掛は戻さない(券の受け取り直しが要るので打ち直してもらう)
// - ポイント利用は pointsItem(会員を読めた時だけ呼び出し側が渡す)で戻す
// 返り値: { discount: {type, value, selected} | null, skippedNames: string[] }
export const buildRecheckoutDiscount = (appliedDiscount, { pointsItem = null } = {}) => {
  const skippedNames = [];
  const applied = appliedDiscount && typeof appliedDiscount === 'object' ? appliedDiscount : null;

  if (applied?.type === 'percent') {
    const value = Math.max(0, Math.min(100, toNumber(applied.value)));
    if (value > 0) {
      return {
        discount: {
          type: 'percent',
          value,
          selected: {
            id: applied.id || null,
            name: applied.name || '値引き',
            type: 'percent',
            value,
            accountingCategory: applied.accountingCategory || 'sales_discount',
            count: 1,
            quantity: 1
          }
        },
        skippedNames
      };
    }
  }

  const sourceItems = !applied || applied.type === 'percent'
    ? []
    : applied.type === 'full_credit'
      ? [{ ...applied, accountingCategory: 'voucher_payment' }]
      : (Array.isArray(applied.items) && applied.items.length > 0 ? applied.items : [applied]);

  const kept = [];
  sourceItems.forEach((item) => {
    if (!item) return;
    if (item.id === LINE_POINT_ITEM_ID) return; // ポイントは pointsItem で戻す(残高を読み直してから)
    if (item.accountingCategory === 'voucher_payment' || item.type === 'full_credit') {
      skippedNames.push(String(item.name || '金券/売掛').replace(/\s*[×✕ｘxX]\s*\d+\s*枚\s*$/, '').trim() || '金券/売掛');
      return;
    }
    const quantity = Math.max(1, Math.floor(toNumber(item.quantity ?? item.count ?? 1)));
    const value = toNumber(item.value);
    const amount = toNumber(item.amount) || value * quantity;
    if (amount <= 0) return;
    kept.push({
      id: item.id || null,
      name: item.name || '値引き',
      type: 'amount',
      value: value || amount,
      accountingCategory: item.accountingCategory === 'promo_expense' ? 'promo_expense' : 'sales_discount',
      allowsChange: false,
      count: quantity,
      quantity,
      amount
    });
  });
  if (pointsItem && toNumber(pointsItem.amount) > 0) kept.push(pointsItem);

  if (kept.length === 0) return { discount: null, skippedNames };

  // 割引モーダルの「複数の金額値引きを1つにまとめる」(commitCombinedAmountDiscounts)と同じ形。
  const total = kept.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const single = kept.length === 1;
  const totalQuantity = kept.reduce((sum, item) => sum + toNumber(item.quantity || 1), 0);
  return {
    discount: {
      type: 'amount',
      value: total,
      selected: {
        id: single ? kept[0].id : 'multiple_coupons',
        name: single ? kept[0].name : `${kept.length}種類の割引/クーポン`,
        type: 'amount',
        accountingCategory: single ? (kept[0].accountingCategory || 'sales_discount') : 'mixed',
        value: single ? kept[0].value : 0,
        count: totalQuantity,
        quantity: totalQuantity,
        amount: total,
        items: kept,
        label: single
          ? `${kept[0].name} × ${kept[0].quantity}枚`
          : `${kept.length}種類 / ${totalQuantity}枚`
      }
    },
    skippedNames
  };
};

// ポイント利用を割引明細(PosModals と同じ形=shared/constants/linePoints の buildLinePointItem)に戻す。
// 名前・会計区分は元伝票のポイント明細を優先する(会計後に割引設定を変えても、打ち直しで区分が変わらないように)。
// 元伝票に明細が無い(古い伝票等)ときは店舗の現在の設定を使う。
export const buildRecheckoutPointsItem = (points, yenPerPoint = 1, { original = null, storeSettings = null } = {}) => {
  const current = resolveLinePointSettings(storeSettings);
  const originalItem = findLinePointItem(original);
  const accountingCategory = LINE_POINT_ACCOUNTING_OPTIONS.includes(originalItem?.accountingCategory)
    ? originalItem.accountingCategory
    : current.accountingCategory;
  return buildLinePointItem(points, yenPerPoint, {
    ...current,
    // 旧伝票の明細名「ポイント利用」は今の表示名にする。
    name: (originalItem?.name && originalItem.name !== 'ポイント利用') ? originalItem.name : current.name,
    accountingCategory
  });
};

// 伝票に載っているポイント利用の明細(無ければ null)。
const findLinePointItem = (tx) => {
  if (!tx) return null;
  const applied = Array.isArray(tx.appliedDiscounts) && tx.appliedDiscounts.length > 0
    ? tx.appliedDiscounts
    : (tx.appliedDiscount ? [tx.appliedDiscount] : []);
  const pools = [
    ...applied.flatMap((discount) => (Array.isArray(discount?.items) ? discount.items : [discount])),
    ...(Array.isArray(tx.promoExpenseItems) ? tx.promoExpenseItems : []),
    ...(Array.isArray(tx.accountingAdjustments) ? tx.accountingAdjustments : [])
  ];
  return pools.find((item) => item?.id === LINE_POINT_ITEM_ID) || null;
};
