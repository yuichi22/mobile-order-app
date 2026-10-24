// POS(物販)専用分析の集計ユーティリティ。
//
// 入力は「物販部門スライス」(splitTransactionsByDepartment で物販部門に絞った取引)を想定する。
// 物販/飲食の切り分けは日計と同一(departmentAttribution)。ここでは物販内の
// 売り場/カテゴリーグループ(画面では「部門」)/カテゴリー/サブカテゴリー/ブランドへの分解と、
// 選択分類での絞り込みを担う。
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

// アイテム→分類 { areaId/Name, groupId/Name, categoryId/Name, subCategoryId/Name, brandId/Name }。
// productById: Map(productId -> {subCategoryId, subCategoryName, brandId, brandName}) 。
//   明細に無いサブカテゴリと、2026-10 以前の明細に無いブランドを商品から補完する。
// brandNameById: Map(brandId -> ブランド名)。ブランドマスタの現在名を優先する(改名に追従)。
export const buildPosItemResolver = ({
  salesAreas = [],
  productCategories = [],
  productCategoryGroups = [],
  productById = null,
  brandNameById = null
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
    const brandId = String(item.brandId || product?.brandId || '').trim();
    const brandName = String(
      (brandId && brandNameById ? brandNameById.get(brandId) : '') || item.brandName || product?.brandName || ''
    ).trim();
    return {
      areaId, areaName, groupId, groupName, categoryId, categoryName, subCategoryId, subCategoryName, brandId, brandName
    };
  };
};

// 売り場/グループのキーは「名前優先」で作る。
// 会計時に salesAreaId まで保存された明細と名前だけの明細が混在したり、売り場を作り直して id が
// 変わると、同名なのにキー(旧: id||name)が割れて重複表示された。表示は名前なので、名前優先キーで
// 束ね直す。グルーピングとドリルダウンの絞り込み(inArea/inGroup)を同じキーで一致させる。
const areaKeyOf = (c) => String(c?.areaName || '').trim() || String(c?.areaId || '').trim() || '__no_area__';
const groupKeyOf = (c) => String(c?.groupName || '').trim() || String(c?.groupId || '').trim() || '__no_group__';
// ブランドも名前優先(id だけの古い商品と名前だけの古い商品を束ねる)。
const brandKeyOf = (c) => String(c?.brandName || '').trim() || String(c?.brandId || '').trim() || '__no_brand__';

// 「未設定」バケットの id。これらの行からは下の階層へ掘り下げない。
export const UNSET_IDS = new Set(['__no_area__', '__no_group__', '__no_category__', '__no_sub__', '__no_brand__']);

// 各階層のキー(未設定は専用バケットに寄せる)。
const KEY = {
  area: (c) => ({ id: areaKeyOf(c), name: c.areaName || '売り場未設定' }),
  group: (c) => ({ id: groupKeyOf(c), name: c.groupName || 'グループ未設定' }),
  category: (c) => ({ id: c.categoryId || '__no_category__', name: c.categoryName || 'カテゴリー未設定' }),
  subCategory: (c) => ({ id: c.subCategoryId || '__no_sub__', name: c.subCategoryName || 'サブカテゴリ未設定' }),
  brand: (c) => ({ id: brandKeyOf(c), name: c.brandName || 'ブランド未設定' })
};

const inArea = (areaKey) => (cls) => areaKeyOf(cls) === String(areaKey);
const inGroup = (groupKey) => (cls) => groupKeyOf(cls) === String(groupKey);
const inCategory = (categoryId) => (cls) => String(cls.categoryId || '__no_category__') === String(categoryId);
const inSubCategory = (subCategoryId) => (cls) => String(cls.subCategoryId || '__no_sub__') === String(subCategoryId);

// タブの scope({areaId, groupId, categoryId, subCategoryId})を分類の判定関数にする。空なら null(=全件)。
export const buildScopeMatcher = (scope = {}) => {
  const checks = [];
  if (scope?.areaId != null) checks.push(inArea(scope.areaId));
  if (scope?.groupId != null) checks.push(inGroup(scope.groupId));
  if (scope?.categoryId != null) checks.push(inCategory(scope.categoryId));
  if (scope?.subCategoryId != null) checks.push(inSubCategory(scope.subCategoryId));
  if (checks.length === 0) return null;
  return (cls) => checks.every((check) => check(cls));
};

// 選択は scope 付き。ブランドは部門をまたぐので、「この部門の中のこのブランド」に絞る。
const itemMatchesSelection = (cls, selection) => {
  if (!selection || !selection.level || selection.level === 'all') return true;
  const keyOf = KEY[selection.level];
  if (!keyOf) return true;
  const inScope = buildScopeMatcher(selection.scope);
  if (inScope && !inScope(cls)) return false;
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
        map.set(id, {
          id,
          name: key.name,
          total: 0,
          quantity: 0,
          transactionCount: 0,
          // 原価・粗利は「原価が登録済みの明細」だけを対象に日計と同じスナップショットで合算する。
          costTaxExcluded: 0,
          grossProfitTaxExcluded: 0,
          trackedSalesExcl: 0,
          // 下の階層が1件でも設定済みか。未設定だけなら掘り下げボタンを出さない。
          hasChild: { group: false, category: false, subCategory: false, brand: false },
          // 商品に紐づく明細があるか。商品をまだ読んでいない段階で「ブランドがあり得るか」の目安に使う。
          hasProduct: false
        });
      }
      const entry = map.get(id);
      entry.total += getItemLineTotal(item);
      entry.quantity += Math.max(num(item.quantity), 0);
      if (!UNSET_IDS.has(String(KEY.group(cls).id))) entry.hasChild.group = true;
      if (cls.categoryId) entry.hasChild.category = true;
      if (cls.subCategoryId) entry.hasChild.subCategory = true;
      if (!UNSET_IDS.has(brandKeyOf(cls))) entry.hasChild.brand = true;
      if (item.productId) entry.hasProduct = true;

      // 原価スナップショット(costPrice)がある明細のみ原価/粗利を積む(日計 addGrossProfitSummary と同基準)。
      const hasCost = item.costPrice !== null
        && item.costPrice !== undefined
        && item.costPrice !== ''
        && Number.isFinite(Number(item.costPrice));
      if (hasCost) {
        const salesExcl = num(item.salesTaxExcludedAmount ?? item.totalPrice ?? item.taxIncludedAmount);
        const costExcl = num(item.costTaxExcludedAmount ?? item.costTaxIncludedAmount);
        const grossExcl = num(item.grossProfitTaxExcluded ?? (salesExcl - costExcl));
        entry.costTaxExcluded += costExcl;
        entry.grossProfitTaxExcluded += grossExcl;
        entry.trackedSalesExcl += salesExcl;
      }
      seen.add(id);
    });
    seen.forEach((id) => {
      if (map.has(id)) map.get(id).transactionCount += 1;
    });
  });

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      // 原価率=原価(税抜)/原価登録済み売上(税抜)。未登録明細は分母から除くため実勢率になる。
      costRate: entry.trackedSalesExcl > 0 ? (entry.costTaxExcluded / entry.trackedSalesExcl) * 100 : null
    }))
    .sort((left, right) => right.total - left.total);
};

export const buildAreaBreakdown = (slices, resolvePosItem) =>
  buildBreakdown(slices, resolvePosItem, 'area');

// 下位の一覧はタブの scope(掘り下げてきた売場・部門・カテゴリー)すべてで絞る。
// 行の選択(itemMatchesSelection)も同じ scope で絞るので、一覧とグラフ・ABCの数字が揃う。
export const buildGroupBreakdown = (slices, resolvePosItem, scope = {}) =>
  buildBreakdown(slices, resolvePosItem, 'group', buildScopeMatcher(scope));

export const buildCategoryBreakdown = (slices, resolvePosItem, scope = {}) =>
  buildBreakdown(slices, resolvePosItem, 'category', buildScopeMatcher(scope));

export const buildSubCategoryBreakdown = (slices, resolvePosItem, scope = {}) =>
  buildBreakdown(slices, resolvePosItem, 'subCategory', buildScopeMatcher(scope));

// 部門などの scope 内のブランド別売上。売上の多い順。
export const buildBrandBreakdown = (slices, resolvePosItem, scope = {}) =>
  buildBreakdown(slices, resolvePosItem, 'brand', buildScopeMatcher(scope));

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
