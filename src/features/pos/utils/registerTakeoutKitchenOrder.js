/**
 * レジ（ORDER）で会計したテイクアウトを、キッチンディスプレイの通常の注文カードとして出すための注文ドキュメントを作る。
 *
 * ⚠ Web予約のテイクアウト（takeoutOrders）とは別物。あちらは受け取りが先の日付まであるので
 *   キッチンのサイドバーに別枠で出す。レジのテイクアウトは「いま作って渡す」ので、店内の注文と同じ並びに出す。
 * ⚠ 売上は transactions 側で計上済み。この注文は会計に紐付けない（orderIds に入れない）。
 *   紐付けると日計の時間帯別集計が注文を拾い、二重に見えるため。
 * ⚠ firestore.rules の orders create（スタッフ・orderSource=pos_register_takeout）と項目を合わせる。
 */

export const REGISTER_TAKEOUT_ORDER_SOURCE = 'pos_register_takeout';
export const TAKEOUT_TABLE_LABEL = 'テイクアウト';

// レジのカートのうち、キッチンで作るもの（メニュー商品）だけを残す。
// 物販・手入力・バーコード・予約会計（groom）などはキッチンに出さない。
const isKitchenMenuLine = (line, menuItemsById) => {
  if (!line?.id) return false;
  if (line.sourceType && line.sourceType !== 'takeout') return false;
  if (Number(line.quantity || 0) <= 0) return false;
  return Boolean(menuItemsById[String(line.id)]);
};

export const buildRegisterTakeoutKitchenOrder = ({
  cart = [],
  menuItemsById = {},
  transactionId,
  registerId = '',
  registerName = '',
  staffUid = '',
  customerName = ''
}) => {
  if (!transactionId) return null;

  const items = (Array.isArray(cart) ? cart : [])
    .filter((line) => isKitchenMenuLine(line, menuItemsById))
    .map((line) => {
      const menu = menuItemsById[String(line.id)] || {};
      const quantity = Math.max(Math.floor(Number(line.quantity || 0)), 0);
      const unitPrice = Math.max(Number(line.takeoutPrice ?? line.unitPrice ?? 0), 0);
      return {
        id: String(line.id),
        menuId: String(line.id),
        name: String(line.name || menu.name || '商品'),
        kitchenName: String(menu.kitchenName || '').trim(),
        quantity,
        unitPrice,
        taxIncludedAmount: unitPrice * quantity,
        category: String(line.categoryId || menu.category || ''),
        categoryId: String(line.categoryId || menu.category || menu.categoryId || ''),
        options: [],
        allergens: Array.isArray(menu.allergens) ? menu.allergens : [],
        isTakeout: true,
        status: 'pending',
        kitchenStatus: 'pending',
        // 会計済み。レジの未会計明細として拾われないように明示する。
        paymentStatus: 'paid'
      };
    });

  if (items.length === 0) return null;

  return {
    tableId: 'takeout',
    tableNumber: 'takeout',
    tableDisplayName: TAKEOUT_TABLE_LABEL,
    tableName: TAKEOUT_TABLE_LABEL,
    // テーブルの席（セッション）には属さない。
    sessionId: null,
    status: 'pending',
    orderType: 'takeout',
    serviceType: 'takeout',
    isTakeout: true,
    orderSource: REGISTER_TAKEOUT_ORDER_SOURCE,
    orderFlow: 'prepay',
    paymentStatus: 'paid',
    transactionId: String(transactionId),
    registerId: String(registerId || ''),
    registerName: String(registerName || ''),
    createdByStaffUid: String(staffUid || ''),
    customerName: String(customerName || ''),
    items,
    totalPrice: items.reduce((sum, item) => sum + item.taxIncludedAmount, 0),
    // 限定数の残数は、これまでどおりレジのテイクアウトでは数えない
    // （syncLimitedMenuStock が作成時に計上しないための目印）。
    limitedStockCountedAtCreate: true
  };
};

export const isRegisterTakeoutOrder = (order) => (
  order?.orderSource === REGISTER_TAKEOUT_ORDER_SOURCE
  || (order?.orderType === 'takeout' && String(order?.tableId || '') === 'takeout')
);
