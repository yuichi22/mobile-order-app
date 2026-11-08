// LINE ポイント(AKUTO Core の会員ポイント)をお会計で使ったときの扱い(2026-11-08)。
// 設定は stores/{storeId}/settings/basic の linePoints に持つ(割引設定の画面で編集)。
//   enabled            : お会計で「ポイント利用」を出すか
//   name               : 割引明細・日計に出す名前
//   accountingCategory : 'sales_discount'(売上値引) | 'promo_expense'(販促費)
//   note               : 備考
// ⚠未設定の店舗は「使う・売上値引」= この設定ができる前と同じ動きにする(既に使っている店を止めない)。
// ⚠金券/売掛(voucher_payment)は選ばせない。自社ポイントの利用は対価の値引きで課税ベースを減らすもの。
//   金券にすると課税ベースが減らず消費税を過大に納めることになる。売上値引・販促費はどちらも課税ベースを減らす。

export const LINE_POINT_ITEM_ID = 'crm_points';
export const LINE_POINT_DEFAULT_NAME = 'LINE ポイント';

export const LINE_POINT_ACCOUNTING_OPTIONS = ['sales_discount', 'promo_expense'];

export const resolveLinePointSettings = (settings) => {
  const raw = settings?.linePoints || {};
  const accountingCategory = LINE_POINT_ACCOUNTING_OPTIONS.includes(raw.accountingCategory)
    ? raw.accountingCategory
    : 'sales_discount';
  return {
    enabled: raw.enabled !== false,
    name: String(raw.name || '').trim() || LINE_POINT_DEFAULT_NAME,
    accountingCategory,
    note: String(raw.note || '')
  };
};

/** ポイント利用を割引明細の形にする(会計・訂正の再会計で同じ形にするための正準)。 */
export const buildLinePointItem = (points, yenPerPoint = 1, linePointSettings = null) => {
  const usePoints = Math.floor(Number(points) || 0);
  if (usePoints <= 0) return null;
  const resolved = linePointSettings || resolveLinePointSettings(null);
  const amount = usePoints * Math.max(Number(yenPerPoint) || 1, 1);
  return {
    id: LINE_POINT_ITEM_ID,
    name: resolved.name,
    type: 'amount',
    value: amount,
    accountingCategory: resolved.accountingCategory,
    allowsChange: false, // ポイントはお釣りを出さない
    count: 1,
    quantity: 1,
    amount,
    points: usePoints
  };
};
