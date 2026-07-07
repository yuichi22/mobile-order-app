// POS(物販)専用分析の集計ユーティリティ。
//
// 入力は「物販部門スライス」(splitTransactionsByDepartment で物販部門に絞った取引)を想定する。
// 物販/飲食の切り分けは日計と同一(departmentAttribution)。ここでは物販内の
// 売り場/カテゴリーグループ/カテゴリー/サブカテゴリーへの分解と、選択分類での絞り込みを担う。
//
// 売り場・グループ・カテゴリーが未設定の物販明細も「未設定」バケットに必ず含め、
// リスト合計が物販の明細合計(値引き前)と一致する(＝取りこぼさない)ようにする。

import { buildItemSalesAreaResolver } from './salesAreaSales';

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const getItemLineTotal = (item = {}) => {
  const direct = item.totalPrice ?? item.salesTaxIncludedAmount ?? item.taxIncludedAmount;
  if (direct !== undefined && direct !== null && Number.isFinite(Number(direct))) {
    return Number(direct);
  }
  return num(item.unitPrice) * Math.max(num(item.quantity), 0);
};

// アイテム→分類 { areaId/Name, groupId/Name, categoryId/Name, subCategoryId/Name }。
// productById: Map(productId -> {subCategoryId, subCategoryName}) 。明細に無いサブカテゴリを補完。
export const buildPosItemResolver = ({
  salesAreas = [],
  productCategories = [],
  productCategoryGroups = [],
  productById = null
} = {}) => {
  const areaResolver = buildItemSalesAreaResolver({ salesAreas, productCategories, productCategoryGroups });
  const catMap = new Map();
  (productCategories || []).forEach((c) => {
    if (c?.id) catMap.set(String(c.id), c);
  });

  return (item = {}) => {
    const { areaId, areaName, groupId, groupName } = areaResolver(item);
    const categoryId = String(item.categoryId || '').trim();
    const category = categoryId ? catMap.get(categoryId) : null;
    const categoryName = String(item.categoryName || category?.name || '').trim();
    const product = productById ? productById.get(String(item.productId || '')) : null;
    const subCategoryId = String(item.subCategoryId || product?.subCategoryId || '').trim();
    const subCategoryName = String(item.subCategoryName || product?.subCategoryName || '').trim();
    return { areaId, areaName, groupId, groupName, categoryId, categoryName, subCategoryId, subCategoryName };
  };
};

// 各階層のキー(未設定は専用バケットに寄せる)。
const KEY = {
  area: (c) => ({ id: c.areaId || c.areaName || '__no_area__', name: c.areaName || '売り場未設定' }),
  group: (c) => ({ id: c.groupId || c.groupName || '__no_group__', name: c.groupName || 'グループ未設定' }),
  category: (c) => ({ id: c.categoryId || '__no_category__', name: c.categoryName || 'カテゴリー未設定' }),
  subCategory: (c) => ({ id: c.subCategoryId || '__no_sub__', name: c.subCategoryName || 'サブカテゴリ未設定' })
};

const itemMatchesSelection = (cls, selection) => {
  if (!selection || !selection.level || selection.level === 'all') return true;
  const keyOf = KEY[selection.level];
  if (!keyOf) return true;
  return String(keyOf(cls).id) === String(selection.id || '');
};

// 物販スライスを選択分類の item だけに絞り、金額(値引き後＝会計金額＋調整)を税込比率で按分。
// buildAnalyticsSummary に渡すと売上/来客/客単価/グラフが選択分類で出る。
export const filterPosOrders = (slices = [], resolvePosItem, selection = { level: 'all' }) => {
  if (typeof resolvePosItem !== 'function') return [];
  const out = [];
  (slices || []).forEach((tx) => {
    if (tx?.isPaid === false) return;
    const items = Array.isArray(tx.items) ? tx.items : [];
    const kept = [];
    let keptTotal = 0;
    let allTotal = 0;
    items.forEach((item) => {
      const lineTotal = getItemLineTotal(item);
      allTotal += lineTotal;
      if (itemMatchesSelection(resolvePosItem(item), selection)) {
        kept.push(item);
        keptTotal += lineTotal;
      }
    });
    if (kept.length === 0) return;
    const ratio = allTotal > 0 ? keptTotal / allTotal : 1;
    // 会計金額(値引き後)＋端数/総額調整。日計 totalSales と同じ基準。
    const net = num(tx.totalAmount) + num(tx.settlementAdjustmentTotal);
    out.push({
      ...tx,
      items: kept,
      totalAmount: Math.round(net * ratio),
      settlementAdjustmentTotal: 0,
      orderAnalyticsRecords: []
    });
  });
  return out;
};

// 分類レベル別の売上リスト(値引き前の明細合計)。total/quantity/transactionCount を返す。
const buildBreakdown = (slices, resolvePosItem, level, scope) => {
  if (typeof resolvePosItem !== 'function') return [];
  const keyOf = KEY[level];
  const map = new Map();

  (slices || []).forEach((tx) => {
    if (tx?.isPaid === false) return;
    const seen = new Set();
    (Array.isArray(tx.items) ? tx.items : []).forEach((item) => {
      const cls = resolvePosItem(item);
      if (scope && !scope(cls)) return;
      const key = keyOf(cls);
      const id = String(key.id);
      if (!map.has(id)) {
        map.set(id, { id, name: key.name, total: 0, quantity: 0, transactionCount: 0 });
      }
      const entry = map.get(id);
      entry.total += getItemLineTotal(item);
      entry.quantity += Math.max(num(item.quantity), 0);
      seen.add(id);
    });
    seen.forEach((id) => {
      if (map.has(id)) map.get(id).transactionCount += 1;
    });
  });

  return Array.from(map.values()).sort((left, right) => right.total - left.total);
};

const inArea = (areaId) => (cls) => String(cls.areaId || cls.areaName || '__no_area__') === String(areaId);
const inGroup = (groupId) => (cls) => String(cls.groupId || cls.groupName || '__no_group__') === String(groupId);
const inCategory = (categoryId) => (cls) => String(cls.categoryId || '__no_category__') === String(categoryId);

export const buildAreaBreakdown = (slices, resolvePosItem) =>
  buildBreakdown(slices, resolvePosItem, 'area');

export const buildGroupBreakdown = (slices, resolvePosItem, scope = {}) =>
  buildBreakdown(slices, resolvePosItem, 'group', scope.areaId != null ? inArea(scope.areaId) : null);

export const buildCategoryBreakdown = (slices, resolvePosItem, groupId) =>
  buildBreakdown(slices, resolvePosItem, 'category', inGroup(groupId));

export const buildSubCategoryBreakdown = (slices, resolvePosItem, categoryId) =>
  buildBreakdown(slices, resolvePosItem, 'subCategory', inCategory(categoryId));

// 物販明細の合計(値引き前)。売上合計(値引き後)との差の説明用。
export const sumGrossItemTotal = (slices = []) => {
  let total = 0;
  (slices || []).forEach((tx) => {
    if (tx?.isPaid === false) return;
    (Array.isArray(tx.items) ? tx.items : []).forEach((item) => {
      total += getItemLineTotal(item);
    });
  });
  return total;
};
