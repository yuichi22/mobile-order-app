export const isCancelledKitchenItem = (item) => (
  item?.status === 'cancelled' || item?.kitchenStatus === 'cancelled'
);

export const getActiveKitchenItems = (items = []) => (
  Array.isArray(items)
    ? items.filter((item) => !isCancelledKitchenItem(item))
    : []
);

export const getCategory = (item, menuItemLookup = {}) => {
  if (!item) return '';

  if (item.category) {
    return String(item.category).toLowerCase();
  }

  const masterItem = menuItemLookup[item.menuId] || menuItemLookup[item.id];

  return masterItem?.category
    ? String(masterItem.category).toLowerCase()
    : '';
};

export const processDisplayItems = (items, activeKitchenId, menuItemLookup = {}) => {
  if (!items || !Array.isArray(items)) return [];

  return items.flatMap((item, index) => {
    if (isCancelledKitchenItem(item)) return [];

    const masterItem = menuItemLookup[item.menuId] || menuItemLookup[item.id] || {};

    const targetKitchenIds = masterItem.kitchenIds || (
      masterItem.kitchenId ? [masterItem.kitchenId] : []
    );

    const isMatched =
      activeKitchenId === 'all' ||
      activeKitchenId === '' ||
      targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

    return [{
      ...item,
      serviceTiming: item.serviceTiming || '',
      serviceTimingLabel: item.serviceTimingLabel || '',
      isMatched,
      sourceIndex: index
    }];
  });
};

export const getElapsedTime = (timestamp, currentTime) => {
  if (!timestamp) return 0;

  const start = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const startMillis = start.getTime();

  if (Number.isNaN(startMillis)) return 0;

  return Math.max(0, Math.floor((currentTime - startMillis) / 1000 / 60));
};

export const getElapsedLevel = (elapsedMinutes) => {
  const minutes = Number(elapsedMinutes) || 0;

  if (minutes >= 15) {
    return {
      level: 'danger',
      label: '遅延',
      badgeClass: 'bg-red-500 text-white shadow-red-900/30',
      textClass: 'text-red-400',
      ringClass: 'ring-red-500/30'
    };
  }

  if (minutes >= 10) {
    return {
      level: 'warning',
      label: '注意',
      badgeClass: 'bg-amber-500 text-white shadow-amber-900/30',
      textClass: 'text-amber-300',
      ringClass: 'ring-amber-500/30'
    };
  }

  if (minutes >= 5) {
    return {
      level: 'notice',
      label: '確認',
      badgeClass: 'bg-orange-500 text-white shadow-orange-900/30',
      textClass: 'text-orange-300',
      ringClass: 'ring-orange-500/30'
    };
  }

  return {
    level: 'normal',
    label: '通常',
    badgeClass: 'bg-slate-700 text-slate-200',
    textClass: 'text-slate-400',
    ringClass: 'ring-white/5'
  };
};

const resolveItemKitchenStatus = (item) => {
  if (item?.kitchenStatus === 'served') return 'served';

  if (item?.kitchenStatus === 'prepared' || item?.isPrepared) {
    return 'prepared';
  }

  if (item?.kitchenStatus === 'cooking' || item?.isCooking) {
    return 'cooking';
  }

  return 'pending';
};

const getCookingCategoryIds = (item, menuItemLookup = {}) => {
  const masterItem = menuItemLookup[item.menuId] || menuItemLookup[item.id] || {};

  if (Array.isArray(masterItem.cookingCategoryIds)) {
    return masterItem.cookingCategoryIds.map(String).filter(Boolean);
  }

  if (Array.isArray(item.cookingCategoryIds)) {
    return item.cookingCategoryIds.map(String).filter(Boolean);
  }

  return [];
};

const getPrimaryCookingCategoryMeta = ({
  item,
  menuItemLookup = {},
  cookingCategoryLookup = {}
}) => {
  const cookingCategoryIds = getCookingCategoryIds(item, menuItemLookup);
  const firstCategoryId = cookingCategoryIds[0] ? String(cookingCategoryIds[0]) : '';

  if (!firstCategoryId) {
    return {
      id: 'uncategorized',
      name: '分類未設定',
      sortOrder: 999999
    };
  }

  const category = cookingCategoryLookup[firstCategoryId];

  return {
    id: firstCategoryId,
    name: category?.name || '分類未設定',
    sortOrder: Number(category?.sortOrder ?? 999999)
  };
};

export const buildPendingItemSummary = (
  orders,
  activeKitchenId,
  menuItemLookup = {},
  cookingCategories = []
) => {
  const itemSummaryMap = new Map();
  const cookingCategorySummaryMap = new Map();

  const cookingCategoryLookup = Object.fromEntries(
    (cookingCategories || [])
      .filter((category) => category?.id)
      .map((category) => [String(category.id), category])
  );

  (orders || []).forEach((order) => {
    const visibleItems = getVisibleKitchenItems(order, activeKitchenId, menuItemLookup);

    visibleItems.forEach((item) => {
      const itemStatus = resolveItemKitchenStatus(item);

      if (itemStatus === 'prepared' || itemStatus === 'served') {
        return;
      }

      const quantity = Number(item.quantity || 1);
      const name = item.name || '未設定商品';
      const itemId = item.menuId || item.id || name;
      const cookingCategoryIds = getCookingCategoryIds(item, menuItemLookup);

      const primaryCategory = getPrimaryCookingCategoryMeta({
        item,
        menuItemLookup,
        cookingCategoryLookup
      });

      const currentItem = itemSummaryMap.get(name) || {
        id: itemId,
        name,
        quantity: 0,
        orderCount: 0,
        cookingCategoryId: primaryCategory.id,
        cookingCategoryName: primaryCategory.name,
        cookingCategorySortOrder: Number(primaryCategory.sortOrder ?? 999999)
      };

      currentItem.quantity += quantity;
      currentItem.orderCount += 1;

      // 同名商品が複数伝票にある場合でも、より上位の調理分類順を採用する。
      if (Number(primaryCategory.sortOrder ?? 999999) < Number(currentItem.cookingCategorySortOrder ?? 999999)) {
        currentItem.cookingCategoryId = primaryCategory.id;
        currentItem.cookingCategoryName = primaryCategory.name;
        currentItem.cookingCategorySortOrder = Number(primaryCategory.sortOrder ?? 999999);
      }

      itemSummaryMap.set(name, currentItem);

      cookingCategoryIds.forEach((categoryId) => {
        const normalizedCategoryId = String(categoryId || '');
        if (!normalizedCategoryId) return;

        const category = cookingCategoryLookup[normalizedCategoryId];

        const currentCategory = cookingCategorySummaryMap.get(normalizedCategoryId) || {
          id: normalizedCategoryId,
          name: category?.name || '分類未設定',
          quantity: 0,
          orderCount: 0,
          sortOrder: Number(category?.sortOrder ?? 999999)
        };

        currentCategory.quantity += quantity;
        currentCategory.orderCount += 1;

        cookingCategorySummaryMap.set(normalizedCategoryId, currentCategory);
      });
    });
  });

  const cookingCategorySummary = Array.from(cookingCategorySummaryMap.values())
    .sort((left, right) => {
      const leftOrder = Number(left.sortOrder ?? 999999);
      const rightOrder = Number(right.sortOrder ?? 999999);

      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (right.quantity !== left.quantity) return right.quantity - left.quantity;

      return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
    });

  const itemSummary = Array.from(itemSummaryMap.values())
    .sort((left, right) => {
      const leftOrder = Number(left.cookingCategorySortOrder ?? 999999);
      const rightOrder = Number(right.cookingCategorySortOrder ?? 999999);

      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCategoryName = String(left.cookingCategoryName || '');
      const rightCategoryName = String(right.cookingCategoryName || '');

      if (leftCategoryName !== rightCategoryName) {
        return leftCategoryName.localeCompare(rightCategoryName, 'ja');
      }

      if (right.quantity !== left.quantity) return right.quantity - left.quantity;

      return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
    });

  return {
    cookingCategorySummary,
    itemSummary
  };
};

export const getStatusTheme = (status) => {
  switch (status) {
    case 'cooking':
      return { border: 'border-orange-500', bg: 'bg-orange-50/30' };
    case 'serving':
      return { border: 'border-green-500', bg: 'bg-green-50/30' };
    case 'completed':
      return { border: 'border-slate-500', bg: 'bg-white' };
    default:
      return { border: 'border-blue-500', bg: 'bg-white' };
  }
};

export const getVisibleKitchenItems = (order, activeKitchenId, menuItemLookup = {}) => {
  const items = processDisplayItems(order?.items, activeKitchenId, menuItemLookup);

  if (activeKitchenId === 'all') {
    return items;
  }

  return items.filter((item) => item.isMatched);
};

const getTimestampMillis = (timestamp) => {
  if (!timestamp) return 0;

  if (typeof timestamp.toMillis === 'function') {
    return timestamp.toMillis();
  }

  if (typeof timestamp.toDate === 'function') {
    const date = timestamp.toDate();
    const millis = date.getTime();
    return Number.isNaN(millis) ? 0 : millis;
  }

  if (timestamp instanceof Date) {
    const millis = timestamp.getTime();
    return Number.isNaN(millis) ? 0 : millis;
  }

  if (typeof timestamp === 'number') {
    return timestamp;
  }

  if (typeof timestamp?.seconds === 'number') {
    return timestamp.seconds * 1000;
  }

  const parsed = new Date(timestamp).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
};

export const getKitchenPriorityScore = (order, currentTime, activeKitchenId, menuItemLookup = {}) => {
  const elapsed = getElapsedTime(order?.timestamp, currentTime);
  const visibleItems = getVisibleKitchenItems(order, activeKitchenId, menuItemLookup);

  const visibleQuantity = visibleItems.reduce(
    (sum, item) => sum + Number(item.quantity || 1),
    0
  );

  const pendingItems = visibleItems.filter((item) => {
    const status = resolveItemKitchenStatus(item);
    return status === 'pending';
  }).length;

  const statusWeight =
    order?.status === 'pending' ? 40
      : order?.status === 'cooking' ? 20
        : order?.status === 'serving' ? 5
          : 0;

  return statusWeight + Math.min(elapsed, 60) + visibleQuantity * 2 + pendingItems * 3;
};

export const getTableSortLabel = (sortMode) => {
  switch (sortMode) {
    case 'oldest':
      return '受付順';
    case 'table':
      return '卓順';
    default:
      return '優先順';
  }
};

export const sortKitchenOrders = (
  orders,
  sortMode,
  currentTime,
  activeKitchenId,
  menuItemLookup = {}
) => {
  const list = [...(orders || [])];

  if (sortMode === 'table') {
    return list.sort((left, right) =>
      String(left.tableId || '').localeCompare(String(right.tableId || ''), 'ja', {
        numeric: true
      })
    );
  }

  if (sortMode === 'oldest') {
    return list.sort((left, right) =>
      getTimestampMillis(left.timestamp) - getTimestampMillis(right.timestamp)
    );
  }

  return list.sort((left, right) => {
    const rightScore = getKitchenPriorityScore(
      right,
      currentTime,
      activeKitchenId,
      menuItemLookup
    );

    const leftScore = getKitchenPriorityScore(
      left,
      currentTime,
      activeKitchenId,
      menuItemLookup
    );

    if (rightScore !== leftScore) return rightScore - leftScore;

    return getTimestampMillis(left.timestamp) - getTimestampMillis(right.timestamp);
  });
};