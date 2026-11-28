/**
 * テーブルの会計画面（レジ）の「＋ 追加」で、卓の伝票に足す注文ドキュメントを作る。
 *
 * 種類は3つ:
 *   - takeout … メニューのテイクアウト品。テイクアウト価格・軽減税率で固定（行の切り替えは出さない）
 *   - retail  … 商品マスタの物販。商品カテゴリーの税率で固定。キッチンには出さない。会計時に在庫を減らす
 *   - option  … お客様の画面では「非表示」のメニュー（裏メニュー・大盛り等）。店内価格で、通常の品と同じ扱い
 *
 * ⚠ 税の扱い: 明細に registerTaxClass（'reduced' | 'standard'）があれば、レジはその税率で固定して計算する
 *   （店内価格からの換算はしない）。無ければ従来どおり「店内=標準／テイクアウト切替=軽減に換算」。
 * ⚠ firestore.rules の orders create（スタッフ・orderSource=pos_register_add）と項目を合わせる。
 *   paymentStatus は持たせない（未会計）。customerId は 'register'（伝票では「レジで追加」の見出しになる）。
 */

export const REGISTER_ADD_ORDER_SOURCE = 'pos_register_add';
export const REGISTER_ADD_CUSTOMER_ID = 'register';

export const REGISTER_ADD_KINDS = ['takeout', 'retail', 'option'];

export const REGISTER_TAX_CLASSES = ['reduced', 'standard'];

// 明細の固定税区分（無ければ ''）。
export const getRegisterTaxClass = (item) => {
  const value = String(item?.registerTaxClass || '');
  return REGISTER_TAX_CLASSES.includes(value) ? value : '';
};

export const isRegisterAddOrder = (order) => order?.orderSource === REGISTER_ADD_ORDER_SOURCE;

// お客様の画面に出さないメニュー（= レジの「オプション」に並べる品）。
export const isOptionMenuItem = (item) => (
  Boolean(item)
  && item.isSoldOut !== true
  && (item.customerVisibility || 'visible') === 'hidden'
  && Number(item.price ?? 0) >= 0
);

// テイクアウト画面（ORDER テイクアウト）と同じ条件。
export const isTakeoutMenuItem = (item) => (
  Boolean(item)
  && item.isSoldOut !== true
  && item.allowsTakeout !== false
  && Number(item.takeoutPrice || 0) > 0
);

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * パネルのカート1行 → 注文明細。
 * @param {{kind:string, source:object, quantity:number}} line
 * @param {{reducedRate:number, retailTaxRate?:number}} ctx retailTaxRate は物販の解決済み税率
 */
export const buildRegisterAddItem = (line, ctx = {}) => {
  const kind = line?.kind;
  const source = line?.source || {};
  const quantity = Math.max(Math.floor(toNumber(line?.quantity)), 0);
  const reducedRate = toNumber(ctx.reducedRate, 8);
  if (!REGISTER_ADD_KINDS.includes(kind) || quantity <= 0) return null;

  if (kind === 'retail') {
    const unitPrice = Math.max(toNumber(source.resolvedPrice ?? source.priceTaxIncluded ?? source.price), 0);
    const taxRate = toNumber(line.taxRate ?? ctx.retailTaxRate, 10);
    return {
      id: `retail:${source.id}`,
      productId: String(source.id || ''),
      productGroupId: String(source.productGroupId || source.groupId || ''),
      sourceType: 'retail',
      registerAddKind: 'retail',
      name: String(source.name || '商品'),
      quantity,
      unitPrice,
      taxIncludedAmount: unitPrice * quantity,
      category: String(source.categoryId || ''),
      categoryId: String(source.categoryId || ''),
      categoryName: String(source.resolvedCategoryName || source.categoryName || '物販'),
      salesAreaId: String(source.salesAreaId || ''),
      salesAreaName: String(source.salesAreaName || ''),
      categoryGroupId: String(source.categoryGroupId || ''),
      categoryGroupName: String(source.categoryGroupName || ''),
      brandId: String(source.brandId || ''),
      brandName: String(source.brandName || ''),
      productSupplierCostRate: Number.isFinite(Number(source.supplierCostRate)) ? Number(source.supplierCostRate) : null,
      productCostTaxIncludedUnit: Number.isFinite(Number(source.costTaxIncluded)) ? Number(source.costTaxIncluded) : null,
      productCostTaxExcludedUnit: Number.isFinite(Number(source.costTaxExcluded)) ? Number(source.costTaxExcluded) : null,
      barcode: String(source.barcode || ''),
      sku: String(source.sku || source.productCode || ''),
      taxRate,
      registerTaxClass: taxRate <= reducedRate ? 'reduced' : 'standard',
      isTakeout: false,
      allowsTakeout: false,
      options: [],
      // キッチンには出さない（注文ごと status=completed で作る）。
      kitchenStatus: 'served'
    };
  }

  const isTakeout = kind === 'takeout';
  const unitPrice = Math.max(toNumber(isTakeout ? source.takeoutPrice : source.price), 0);
  const categoryId = String(source.category || source.categoryId || '');

  return {
    id: String(source.id || ''),
    menuId: String(source.id || ''),
    registerAddKind: kind,
    name: String(source.name || '商品'),
    kitchenName: String(source.kitchenName || '').trim(),
    quantity,
    unitPrice,
    taxIncludedAmount: unitPrice * quantity,
    category: categoryId,
    categoryId,
    categoryName: String(line.categoryName || source.categoryName || ''),
    options: [],
    selectedOptions: [],
    allergens: Array.isArray(source.allergens) ? source.allergens : [],
    appliedPriceMode: 'normal',
    ...(isTakeout
      ? {
          // テイクアウト価格（税込・軽減税率）で固定。伝票の「テイクアウト」切り替えは出さない。
          isTakeout: true,
          allowsTakeout: false,
          taxRate: reducedRate,
          registerTaxClass: 'reduced'
        }
      : {
          // 店内で食べる品。通常の注文と同じく、伝票でテイクアウトに切り替えられる。
          isTakeout: false,
          allowsTakeout: source.allowsTakeout !== false
        }),
    status: 'pending',
    kitchenStatus: 'pending'
  };
};

/**
 * パネルのカート → 書き込む注文（0〜2件）。
 * 料理（takeout/option）と物販は別の注文にする。物販はキッチンに出さないため status=completed。
 * 料理も sendToKitchen=false なら completed（キッチンに出さない）。
 */
export const buildRegisterAddOrders = ({
  lines = [],
  ctx = {},
  sessionId,
  tableId,
  tableDisplayName = '',
  partySize = null,
  sendToKitchen = true,
  staffUid = '',
  staffName = '',
  registerId = '',
  registerName = '',
  timestamp
}) => {
  if (!sessionId) return [];

  const items = (Array.isArray(lines) ? lines : [])
    .map((line) => buildRegisterAddItem(line, { ...ctx, retailTaxRate: line?.taxRate }))
    .filter(Boolean);

  const menuItems = items.filter((item) => item.registerAddKind !== 'retail');
  const retailItems = items.filter((item) => item.registerAddKind === 'retail');

  const base = {
    tableId: String(tableId || ''),
    tableDisplayName: String(tableDisplayName || tableId || ''),
    tableName: String(tableDisplayName || tableId || ''),
    sessionId: String(sessionId),
    ...(Number(partySize) > 0 ? { partySize: Number(partySize) } : {}),
    timestamp,
    orderSource: REGISTER_ADD_ORDER_SOURCE,
    customerId: REGISTER_ADD_CUSTOMER_ID,
    participantId: REGISTER_ADD_CUSTOMER_ID,
    userId: String(staffUid || ''),
    createdByStaffUid: String(staffUid || ''),
    createdByStaffName: String(staffName || ''),
    registerId: String(registerId || ''),
    registerName: String(registerName || '')
  };

  const total = (list) => list.reduce((sum, item) => sum + Number(item.taxIncludedAmount || 0), 0);
  const orders = [];

  if (menuItems.length > 0) {
    const kitchen = sendToKitchen !== false;
    orders.push({
      ...base,
      status: kitchen ? 'pending' : 'completed',
      items: kitchen
        ? menuItems
        : menuItems.map((item) => ({ ...item, kitchenStatus: 'served' })),
      totalPrice: total(menuItems),
      isTakeout: menuItems.every((item) => item.isTakeout === true)
    });
  }

  if (retailItems.length > 0) {
    orders.push({
      ...base,
      status: 'completed',
      items: retailItems,
      totalPrice: total(retailItems),
      isTakeout: false,
      // 限定数の残数（メニュー）とは無関係なので数えない。
      limitedStockCountedAtCreate: true
    });
  }

  return orders;
};
