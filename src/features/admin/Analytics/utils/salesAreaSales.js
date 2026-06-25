// 日計の「売り場別売上」集計ユーティリティ(POS物販向け)。
//
// 売上の所属:
//  - 会計時にアイテムへ保存した salesAreaId/salesAreaName・categoryGroupId/categoryGroupName を最優先で使う(正)。
//  - 旧データ等でそれが無い場合のフォールバックとして、categoryId → カテゴリー → 所属グループ →
//    (グループ名が allowedCategoryGroupNames に含まれる)売り場 の順に解決する。
//    ※グループ名が複数売り場に属する場合は sortOrder の小さい売り場を優先(曖昧なので参考値)。
//  - 売り場が解決できないアイテム(メニュー品など)は集計対象外＝POSの物販のみが残る。

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const getItemLineTotal = (item = {}) => {
  const direct = item.totalPrice ?? item.salesTaxIncludedAmount ?? item.taxIncludedAmount;
  if (direct !== undefined && direct !== null && Number.isFinite(Number(direct))) {
    return Number(direct);
  }
  return num(item.unitPrice) * Math.max(num(item.quantity), 0);
};

// アイテム→{ areaId, areaName, groupId, groupName } を返す解決関数を生成する。
export const buildItemSalesAreaResolver = ({
  salesAreas = [],
  productCategories = [],
  productCategoryGroups = []
} = {}) => {
  const categoryMap = new Map();
  (productCategories || []).forEach((category) => {
    if (category?.id) categoryMap.set(String(category.id), category);
  });

  const groupMap = new Map();
  (productCategoryGroups || []).forEach((group) => {
    if (group?.id) groupMap.set(String(group.id), group);
  });

  // グループ名 → 売り場(最小 sortOrder 優先)。allowedCategoryGroupNames はグループ名の配列。
  const areaByGroupName = new Map();
  const sortedAreas = [...(salesAreas || [])].sort(
    (left, right) => num(left?.sortOrder) - num(right?.sortOrder)
  );
  sortedAreas.forEach((area) => {
    const names = Array.isArray(area?.allowedCategoryGroupNames) ? area.allowedCategoryGroupNames : [];
    names.forEach((rawName) => {
      const name = String(rawName || '').trim();
      if (name && !areaByGroupName.has(name)) {
        areaByGroupName.set(name, area);
      }
    });
  });

  return (item = {}) => {
    // --- カテゴリーグループの解決 ---
    let groupId = String(item.categoryGroupId || '').trim();
    let groupName = String(item.categoryGroupName || '').trim();

    if ((!groupId || !groupName) && item.categoryId) {
      const category = categoryMap.get(String(item.categoryId));
      if (category) {
        groupId = groupId || String(category.groupId || category.categoryGroupId || '').trim();
        groupName = groupName || String(category.groupName || category.categoryGroupName || '').trim();
      }
    }
    if (groupId && !groupName) {
      groupName = String(groupMap.get(groupId)?.name || '').trim();
    }

    // --- 売り場の解決 ---
    let areaId = String(item.salesAreaId || '').trim();
    let areaName = String(item.salesAreaName || '').trim();

    if (!areaId && !areaName && groupName) {
      const area = areaByGroupName.get(groupName);
      if (area) {
        areaId = String(area.id || '').trim();
        areaName = String(area.name || area.displayName || '').trim();
      }
    }

    return { areaId, areaName, groupId, groupName };
  };
};

// 取引配列を「売り場別売上(＋カテゴリーグループ内訳)」に集計する。
// 売り場が解決できないアイテムは対象外なので、POSの物販売上のみが残る。
export const buildSalesAreaSales = (transactions = [], resolveItemSalesArea) => {
  if (typeof resolveItemSalesArea !== 'function') return [];

  const areas = new Map();

  (transactions || []).forEach((transaction) => {
    if (transaction?.isPaid === false) return;
    const items = Array.isArray(transaction?.items) ? transaction.items : [];

    items.forEach((item) => {
      const { areaId, areaName, groupId, groupName } = resolveItemSalesArea(item);
      if (!areaId && !areaName) return; // 売り場未解決(メニュー品など)は除外

      const areaKey = areaId || areaName;
      if (!areas.has(areaKey)) {
        areas.set(areaKey, {
          id: areaId || areaName,
          name: areaName || '売り場未設定',
          quantity: 0,
          total: 0,
          groups: new Map()
        });
      }

      const area = areas.get(areaKey);
      const quantity = Math.max(num(item.quantity), 0);
      const amount = getItemLineTotal(item);
      area.quantity += quantity;
      area.total += amount;

      const groupKey = groupId || groupName || 'group_unassigned';
      if (!area.groups.has(groupKey)) {
        area.groups.set(groupKey, {
          id: groupId || groupName || 'group_unassigned',
          name: groupName || 'グループ未設定',
          quantity: 0,
          total: 0
        });
      }
      const group = area.groups.get(groupKey);
      group.quantity += quantity;
      group.total += amount;
    });
  });

  return Array.from(areas.values())
    .map((area) => ({
      id: area.id,
      name: area.name,
      quantity: area.quantity,
      total: area.total,
      groupList: Array.from(area.groups.values()).sort((left, right) => right.total - left.total)
    }))
    .sort((left, right) => right.total - left.total);
};
