import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Repeat2,
  RefreshCw,
  Send,
  ShoppingCart,
  Table2
} from 'lucide-react';

import { auth, db } from '../../../shared/api/firebase/client';
import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';
import FloorMapCanvas from '../../../shared/components/floor-map/FloorMapCanvas';
import { useAuth } from '../../../app/providers/useAuth';
import {
  USER_ROLES,
  hasMinimumRole,
  normalizeUserRole
} from '../../../shared/utils/roles';
import { getTableDisplayName } from '../../../shared/utils/tableDisplay';
import { bootstrapCustomerSession } from '../../customer/services/customerSessionService';
import {
  useCategoryData,
  useFloorLayout,
  useMenuData,
  usePeriodData,
  useStoreSettings
} from '../../store/hooks';
import { useCustomerCurrentPeriod } from '../../customer/hooks/useCustomerCurrentPeriod';
import { useTableMenuOverride } from '../../customer/hooks/useTableMenuOverride';
import {
  decorateMenuItemAvailability,
  getTodayKey
} from '../../../shared/utils/menuAvailability';

const formatMoney = (value) => `¥${Number(value || 0).toLocaleString('ja-JP')}`;

const normalizeTableItems = (layoutItems = []) => (
  Array.isArray(layoutItems)
    ? layoutItems
        .filter((item) => item?.type === 'table')
        .map((item) => {
          const tableId = String(item.label || item.tableId || item.id || '').replace(/^T-/, '').trim();
          const tableName = String(item.displayName || item.tableDisplayName || item.name || tableId || '').trim();

          return {
            id: tableId,
            tableId,
            tableName: tableName || tableId,
            isDisabled: Boolean(item.isDisabled)
          };
        })
        .filter((item) => item.tableId && !item.isDisabled)
        .sort((left, right) => {
          const leftNumber = Number(left.tableId);
          const rightNumber = Number(right.tableId);

          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
          }

          return String(left.tableId).localeCompare(String(right.tableId), 'ja', { numeric: true });
        })
    : []
);

const getMenuPrice = (item) => Number(item.price ?? item.unitPrice ?? 0);

const isStaffOrderMenuItemCustomerVisible = (item, todayKey = getTodayKey()) => {
  const visibility = item?.customerVisibility || 'visible';

  if (visibility === 'hidden') {
    return false;
  }

  if (visibility !== 'scheduled') {
    return true;
  }

  const fromDate = String(item?.visibleFromDate || '').trim();
  const toDate = String(item?.visibleToDate || '').trim();

  if (fromDate && todayKey < fromDate) {
    return false;
  }

  if (toDate && todayKey > toDate) {
    return false;
  }

  return true;
};

const isStaffOrderMenuItemTimeAllowed = (item, currentPeriod) => {
  const itemPeriods = Array.isArray(item?.periods)
    ? item.periods.map((periodId) => String(periodId))
    : item?.periods
      ? [String(item.periods)]
      : [];

  if (itemPeriods.length === 0) {
    return true;
  }

  if (!currentPeriod?.id) {
    return false;
  }

  return itemPeriods.includes(String(currentPeriod.id));
};


const hasCrossSellPrice = (item) => (
  item?.crossSellPrice !== null
  && item?.crossSellPrice !== undefined
  && item?.crossSellPrice !== ''
  && Number.isFinite(Number(item?.crossSellPrice))
  && Number(item?.crossSellPrice) >= 0
);

const getCartLineKey = (item) => String(item.cartId || item.id || '');

const getMenuCartQuantity = (cartItems = [], menuItem = {}, crossSellOffer = null) => {
  const menuItemId = String(menuItem.id || '').trim();
  if (!menuItemId) return 0;

  const expectedMode = crossSellOffer ? 'crossSell' : 'normal';
  const expectedGroupKey = crossSellOffer ? String(crossSellOffer.offerGroupKey || '') : '';

  return cartItems
    .filter((cartItem) => String(cartItem.id || '') === menuItemId)
    .filter((cartItem) => {
      const mode = cartItem.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal';
      if (mode !== expectedMode) return false;

      if (expectedMode !== 'crossSell') return true;

      return String(cartItem.crossSellSourceGroupKey || '') === expectedGroupKey;
    })
    .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);
};

const getMenuCartQuantityByMode = (cartItems = [], menuItem = {}, mode = 'normal', offerGroupKey = '') => {
  const menuItemId = String(menuItem.id || '').trim();
  const expectedMode = mode === 'crossSell' ? 'crossSell' : 'normal';
  const expectedGroupKey = String(offerGroupKey || '');

  if (!menuItemId) return 0;

  return cartItems
    .filter((cartItem) => String(cartItem.id || '') === menuItemId)
    .filter((cartItem) => {
      const cartMode = cartItem.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal';
      if (cartMode !== expectedMode) return false;

      if (expectedMode !== 'crossSell' || !expectedGroupKey) return true;

      return String(cartItem.crossSellSourceGroupKey || '') === expectedGroupKey;
    })
    .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);
};

const findMenuCartLineByMode = (cartItems = [], menuItem = {}, mode = 'normal', offerGroupKey = '') => {
  const menuItemId = String(menuItem.id || '').trim();
  const expectedMode = mode === 'crossSell' ? 'crossSell' : 'normal';
  const expectedGroupKey = String(offerGroupKey || '');

  return cartItems.find((cartItem) => {
    if (String(cartItem.id || '') !== menuItemId) return false;

    const cartMode = cartItem.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal';
    if (cartMode !== expectedMode) return false;

    if (expectedMode !== 'crossSell' || !expectedGroupKey) return true;

    return String(cartItem.crossSellSourceGroupKey || '') === expectedGroupKey;
  }) || null;
};


const isCrossSellCartItem = (item) => item?.appliedPriceMode === 'crossSell';

const isCancelledOrderForSetPrice = (order = {}) => (
  order.status === 'cancelled' ||
  order.cancelled === true ||
  order.isCancelled === true ||
  Boolean(order.cancelledAt)
);

const isCancelledOrderItemForSetPrice = (item = {}) => (
  item.status === 'cancelled' ||
  item.cancelled === true ||
  item.isCancelled === true ||
  Boolean(item.cancelledAt)
);

const normalizeOrderItemForSetPrice = (item = {}, order = {}, itemIndex = 0) => {
  if (isCancelledOrderForSetPrice(order) || isCancelledOrderItemForSetPrice(item)) {
    return null;
  }

  const quantity = Math.max(Number(item.quantity || 0), 0);
  if (quantity <= 0) return null;

  const itemId = String(
    item.id ||
    item.menuItemId ||
    item.itemId ||
    `${order.id || 'order'}:${itemIndex}`
  ).trim();

  if (!itemId) return null;

  return {
    id: itemId,
    cartId: String(item.cartId || `${order.id || 'order'}:${itemId}:${itemIndex}`),
    name: item.name || '商品',
    quantity,
    unitPrice: Number(item.unitPrice ?? item.price ?? 0),
    price: Number(item.unitPrice ?? item.price ?? 0),
    originalPrice: item.originalPrice ?? null,
    category: item.category || item.categoryId || '',
    categoryId: item.categoryId || item.category || '',
    kitchenName: item.kitchenName || '',
    selectedOptions: Array.isArray(item.selectedOptions) ? item.selectedOptions : [],
    allowsTakeout: item.allowsTakeout !== false,
    allergens: item.allergens || [],
    serviceTiming: item.serviceTiming || '',
    serviceTimingLabel: item.serviceTimingLabel || '',
    appliedPriceMode: item.appliedPriceMode === 'crossSell' || item.priceMode === 'crossSell'
      ? 'crossSell'
      : 'normal',
    priceLabelText: item.priceLabelText || '',
    originalPriceLabelText: item.originalPriceLabelText || '',
    crossSellSourceKey: item.crossSellSourceKey || item.sourceKey || '',
    crossSellSourceFlowId: item.crossSellSourceFlowId || item.sourceFlowId || '',
    crossSellSourceStepId: item.crossSellSourceStepId || item.sourceStepId || '',
    crossSellSourceGroupKey: item.crossSellSourceGroupKey || item.sourceGroupKey || '',
    crossSellSourceCategoryIds: Array.isArray(item.crossSellSourceCategoryIds)
      ? item.crossSellSourceCategoryIds.map(String)
      : Array.isArray(item.sourceCategoryIds)
        ? item.sourceCategoryIds.map(String)
        : []
  };
};

const normalizeSessionOrderItemsForSetPrice = (orders = []) => (
  Array.isArray(orders)
    ? orders.flatMap((order) => {
        const items = Array.isArray(order?.items) ? order.items : [];

        return items
          .map((item, index) => normalizeOrderItemForSetPrice(item, order, index))
          .filter(Boolean);
      })
    : []
);


const normalizeStringArray = (value) => (
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
);

const getCrossSellGroupsFromSettings = (settings = {}) => (
  Array.isArray(settings?.groups)
    ? settings.groups
    : Array.isArray(settings?.crossSellGroups)
      ? settings.crossSellGroups
      : []
);

const getCrossSellFlowsFromSettings = (settings = {}) => (
  Array.isArray(settings?.flows)
    ? settings.flows
    : Array.isArray(settings?.crossSellFlows)
      ? settings.crossSellFlows
      : []
);

const getFlowTriggerCategoryIds = (flow = {}, crossSellSettings = {}) => {
  const ids = new Set(normalizeStringArray(
    flow.triggerCategoryIds ||
    flow.triggerCategories ||
    flow.sourceCategoryIds ||
    flow.categoryIds ||
    []
  ));

  if (flow.triggerCategoryId) {
    ids.add(String(flow.triggerCategoryId));
  }

  if (flow.triggerGroupId) {
    const triggerGroupId = String(flow.triggerGroupId);
    const matchedGroup = getCrossSellGroupsFromSettings(crossSellSettings)
      .find((group) => String(group.id || group.groupId || group.key || '') === triggerGroupId);

    if (matchedGroup) {
      getOfferGroupCategoryIds(matchedGroup).forEach((categoryId) => ids.add(categoryId));
    }
  }

  return Array.from(ids);
};

const getOfferGroupKey = (group = {}) => String(
  group.key ||
  group.groupId ||
  group.id ||
  group.categoryId ||
  normalizeStringArray(group.categoryIds)[0] ||
  ''
).trim();

const getOfferGroupCategoryIds = (group = {}) => (
  normalizeStringArray(
    group.categoryIds ||
    group.offerCategoryIds ||
    group.targetCategoryIds ||
    (group.categoryId ? [group.categoryId] : [])
  )
);

const getFlowOfferGroups = (flow = {}, crossSellSettings = {}) => {
  const allGroups = getCrossSellGroupsFromSettings(crossSellSettings);
  const result = [];

  const pushGroup = (group, fallbackKey = '') => {
    if (!group) return;

    const normalized = {
      ...group,
      key: getOfferGroupKey(group) || fallbackKey
    };

    if (getOfferGroupCategoryIds(normalized).length > 0) {
      result.push(normalized);
    }
  };

  const explicitGroups = Array.isArray(flow.offerGroups)
    ? flow.offerGroups
    : Array.isArray(flow.groups)
      ? flow.groups
      : [];

  explicitGroups.forEach((group) => {
    const key = getOfferGroupKey(group);
    const matched = key
      ? allGroups.find((candidate) => getOfferGroupKey(candidate) === key)
      : null;

    pushGroup({
      ...(matched || {}),
      ...group
    }, key);
  });

  const groupKeys = normalizeStringArray(
    flow.offerGroupKeys ||
    flow.groupKeys ||
    flow.offerGroupIds ||
    flow.groupIds ||
    []
  );

  groupKeys.forEach((groupKey) => {
    const matched = allGroups.find((group) => getOfferGroupKey(group) === groupKey);
    pushGroup(matched, groupKey);
  });

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  steps.forEach((step) => {
    if (!step || step.type === 'none') return;

    if (step.groupId) {
      const groupId = String(step.groupId);
      const matched = allGroups.find((group) => String(group.id || group.groupId || group.key || '') === groupId);
      pushGroup(matched || { id: groupId, groupId, categoryIds: [] }, groupId);
      return;
    }

    if (step.categoryId) {
      const categoryId = String(step.categoryId);
      pushGroup({
        id: `${String(flow.id || flow.key || 'flow')}:${String(step.id || categoryId)}`,
        key: `${String(flow.id || flow.key || 'flow')}:${String(step.id || categoryId)}`,
        categoryIds: [categoryId],
        name: step.title || ''
      });
    }
  });

  const targetCategoryIds = normalizeStringArray(
    flow.offerCategoryIds ||
    flow.targetCategoryIds ||
    flow.crossSellCategoryIds ||
    []
  );

  if (targetCategoryIds.length > 0) {
    pushGroup({
      id: `${String(flow.id || flow.key || 'flow')}:target`,
      key: `${String(flow.id || flow.key || 'flow')}:target`,
      categoryIds: targetCategoryIds
    });
  }

  const unique = new Map();
  result.forEach((group) => {
    const key = getOfferGroupKey(group) || JSON.stringify(getOfferGroupCategoryIds(group));
    if (!key) return;
    unique.set(key, group);
  });

  return Array.from(unique.values());
};

const getAllOfferCategoryIdsFromSettings = (crossSellSettings = {}) => {
  const categoryIds = new Set();

  getCrossSellGroupsFromSettings(crossSellSettings).forEach((group) => {
    getOfferGroupCategoryIds(group).forEach((categoryId) => categoryIds.add(categoryId));
  });

  getCrossSellFlowsFromSettings(crossSellSettings).forEach((flow) => {
    normalizeStringArray(
      flow.offerCategoryIds ||
      flow.targetCategoryIds ||
      flow.crossSellCategoryIds ||
      []
    ).forEach((categoryId) => categoryIds.add(categoryId));

    getFlowOfferGroups(flow, crossSellSettings).forEach((group) => {
      getOfferGroupCategoryIds(group).forEach((categoryId) => categoryIds.add(categoryId));
    });
  });

  return Array.from(categoryIds);
};

const resolveSetPriceOfferForItem = (item, cartItems = [], crossSellSettings = {}) => {
  if (!hasCrossSellPrice(item)) return null;

  const itemCategoryId = getCategoryId(item);
  if (!itemCategoryId) return null;

  const flows = getCrossSellFlowsFromSettings(crossSellSettings)
    .filter((flow) => flow?.enabled !== false);

  for (const flow of flows) {
    const triggerCategoryIds = getFlowTriggerCategoryIds(flow, crossSellSettings);

    // その flow のトリガーカテゴリ商品そのものは、同じ flow のセット対象にしない。
    // ただし、別 flow ではオファー対象になることがあるため、全flow共通では弾かない。
    if (triggerCategoryIds.includes(itemCategoryId)) {
      continue;
    }

    const triggerQuantity = cartItems
      .filter((cartItem) => !isCrossSellCartItem(cartItem))
      .filter((cartItem) => triggerCategoryIds.length === 0 || triggerCategoryIds.includes(getCategoryId(cartItem)))
      .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);

    if (triggerQuantity <= 0) continue;

    const offerGroups = getFlowOfferGroups(flow, crossSellSettings);

    for (const offerGroup of offerGroups) {
      const offerCategoryIds = getOfferGroupCategoryIds(offerGroup);

      if (offerCategoryIds.length > 0 && !offerCategoryIds.includes(itemCategoryId)) continue;

      const offerGroupKey = getOfferGroupKey(offerGroup) || `${String(flow.id || flow.key || 'flow')}:offer`;
      const usedQuantity = cartItems
        .filter(isCrossSellCartItem)
        .filter((cartItem) => {
          if (offerGroupKey && cartItem.crossSellSourceGroupKey) {
            return String(cartItem.crossSellSourceGroupKey) === offerGroupKey;
          }

          if (offerCategoryIds.length > 0) {
            return offerCategoryIds.includes(getCategoryId(cartItem));
          }

          return true;
        })
        .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);

      const remainingQuantity = Math.max(triggerQuantity - usedQuantity, 0);

      if (remainingQuantity <= 0) continue;

      return {
        flow,
        offerGroup,
        offerGroupKey,
        offerCategoryIds: offerCategoryIds.length > 0 ? offerCategoryIds : [itemCategoryId],
        remainingQuantity
      };
    }

  }

  // crossSellSettings が未設定・読み込み未完了の場合だけ、最低限のフォールバックを許可する。
  // 実設定がある場合は、flow/step/group の実データだけで判定する。
  if (flows.length === 0) {
    const normalQuantity = cartItems
      .filter((cartItem) => !isCrossSellCartItem(cartItem))
      .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);

    const usedQuantity = cartItems
      .filter(isCrossSellCartItem)
      .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);

    const remainingQuantity = Math.max(normalQuantity - usedQuantity, 0);

    if (remainingQuantity > 0) {
      return {
        flow: null,
        offerGroup: null,
        offerGroupKey: 'staff-fallback',
        offerCategoryIds: [itemCategoryId],
        remainingQuantity
      };
    }
  }

  return null;
};

const canShowSetPriceForMenuItem = (item, cartItems, crossSellSettings) => (
  Boolean(resolveSetPriceOfferForItem(item, cartItems, crossSellSettings))
);

const buildStaffSetPriceDebugRows = (cartItems = [], crossSellSettings = {}) => {
  const flows = getCrossSellFlowsFromSettings(crossSellSettings)
    .filter((flow) => flow?.enabled !== false);

  return flows.map((flow) => {
    const triggerCategoryIds = getFlowTriggerCategoryIds(flow, crossSellSettings);
    const triggerQuantity = cartItems
      .filter((cartItem) => !isCrossSellCartItem(cartItem))
      .filter((cartItem) => triggerCategoryIds.length === 0 || triggerCategoryIds.includes(getCategoryId(cartItem)))
      .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);

    const groups = getFlowOfferGroups(flow, crossSellSettings).map((group) => {
      const groupKey = getOfferGroupKey(group);
      const categoryIds = getOfferGroupCategoryIds(group);
      const usedQuantity = cartItems
        .filter(isCrossSellCartItem)
        .filter((cartItem) => {
          if (groupKey && cartItem.crossSellSourceGroupKey) {
            return String(cartItem.crossSellSourceGroupKey) === String(groupKey);
          }

          return categoryIds.includes(getCategoryId(cartItem));
        })
        .reduce((sum, cartItem) => sum + Number(cartItem.quantity || 0), 0);

      return {
        key: groupKey || categoryIds.join(',') || 'group',
        name: group.name || group.title || groupKey || 'セットグループ',
        usedQuantity,
        remainingQuantity: Math.max(triggerQuantity - usedQuantity, 0)
      };
    });

    return {
      id: String(flow.id || flow.key || flow.name || 'flow'),
      name: flow.name || flow.title || 'セット条件',
      triggerQuantity,
      groups
    };
  });
};

const normalizeCartSetPriceBalance = (items = [], existingItems = []) => {
  const normalizedItems = Array.isArray(items) ? items : [];
  const referenceItems = [
    ...(Array.isArray(existingItems) ? existingItems : []),
    ...normalizedItems
  ];

  const normalQuantity = referenceItems
    .filter((item) => !isCrossSellCartItem(item))
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const existingCrossSellQuantity = (Array.isArray(existingItems) ? existingItems : [])
    .filter(isCrossSellCartItem)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  let usedCrossSellQuantity = existingCrossSellQuantity;

  return normalizedItems.map((item) => {
    if (!isCrossSellCartItem(item)) return item;

    const quantity = Number(item.quantity || 0);
    const availableQuantity = Math.max(normalQuantity - usedCrossSellQuantity, 0);
    const crossSellQuantity = Math.min(quantity, availableQuantity);
    usedCrossSellQuantity += crossSellQuantity;

    if (crossSellQuantity === quantity) return item;

    return {
      ...item,
      appliedPriceMode: 'normal',
      unitPrice: Number(item.originalPrice ?? item.price ?? item.unitPrice ?? 0),
      price: Number(item.originalPrice ?? item.price ?? item.unitPrice ?? 0),
      priceLabelText: item.originalPriceLabelText || item.priceLabelText || '',
      crossSellSourceKey: '',
      crossSellSourceFlowId: '',
      crossSellSourceStepId: '',
      crossSellSourceGroupKey: '',
      crossSellSourceCategoryIds: []
    };
  });
};

const reduceCartLineByOne = (cartItems = [], cartLineKey = '') => (
  cartItems
    .map((cartItem) => {
      if (getCartLineKey(cartItem) !== String(cartLineKey)) return cartItem;

      const nextQuantity = Number(cartItem.quantity || 0) - 1;
      if (nextQuantity <= 0) return null;

      return {
        ...cartItem,
        quantity: nextQuantity
      };
    })
    .filter(Boolean)
);

const removeOneExcessSetPriceLine = (cartItems = [], existingItems = []) => {
  const normalizedCart = normalizeCartSetPriceBalance(cartItems, existingItems);

  for (let index = cartItems.length - 1; index >= 0; index -= 1) {
    const cartItem = cartItems[index];
    if (!isCrossSellCartItem(cartItem)) continue;

    const normalizedItem = normalizedCart.find((candidate) => (
      getCartLineKey(candidate) === getCartLineKey(cartItem)
    ));

    if (!normalizedItem || normalizedItem.appliedPriceMode !== 'crossSell') {
      return reduceCartLineByOne(cartItems, getCartLineKey(cartItem));
    }
  }

  return cartItems;
};

const getCategoryId = (item) => String(item.categoryId || item.category || '').trim();

const isMenuItemCustomerVisible = (item, todayKey) => {
  const visibility = item?.customerVisibility || 'visible';

  if (visibility === 'hidden') {
    return false;
  }

  if (visibility !== 'scheduled') {
    return true;
  }

  const fromDate = String(item?.visibleFromDate || '').trim();
  const toDate = String(item?.visibleToDate || '').trim();

  if (fromDate && todayKey < fromDate) {
    return false;
  }

  if (toDate && todayKey > toDate) {
    return false;
  }

  return true;
};

const isCategoryCustomerVisible = (category) => {
  const visibility = category?.customerTabVisibility || 'always';

  // スタッフ注文端末では、クロスセル専用カテゴリもスタッフが選べるように表示する。
  // 非表示にするのは hidden だけ。
  return visibility !== 'hidden';
};

const getCategoryVisibility = (category) => (
  category?.customerTabVisibility || 'always'
);

const hasCrossSellLineInCategory = (items = [], categoryId = '') => (
  Array.isArray(items)
    ? items.some((item) => (
        isCrossSellCartItem(item)
        && getCategoryId(item) === String(categoryId)
      ))
    : false
);

const hasSetPriceOfferInCategory = (menuItems = [], categoryId = '', referenceItems = [], crossSellSettings = {}) => (
  Array.isArray(menuItems)
    ? menuItems
        .filter((item) => getCategoryId(item) === String(categoryId))
        .some((item) => Boolean(resolveSetPriceOfferForItem(item, referenceItems, crossSellSettings)))
    : false
);

const shouldShowStaffCategoryTab = ({
  category,
  categoryId,
  menuItems,
  setPriceReferenceItems,
  existingOrderItemsForSetPrice,
  cart,
  crossSellSettings
}) => {
  const visibility = getCategoryVisibility(category);

  if (visibility === 'hidden') return false;
  if (visibility !== 'crossSellOnly') return true;

  return (
    hasSetPriceOfferInCategory(menuItems, categoryId, setPriceReferenceItems, crossSellSettings)
    || hasCrossSellLineInCategory(cart, categoryId)
    || hasCrossSellLineInCategory(existingOrderItemsForSetPrice, categoryId)
  );
};

const buildCategoryById = (categories = []) => {
  const map = new Map();

  if (Array.isArray(categories)) {
    categories.forEach((category) => {
      if (!category?.id) return;
      map.set(String(category.id), category);
    });
  }

  return map;
};

const findSetPriceReplacementItems = ({
  targetItem,
  menuItems = [],
  referenceItems = [],
  crossSellSettings = {}
}) => {
  if (!targetItem || !isCrossSellCartItem(targetItem)) return [];

  const sourceGroupKey = String(targetItem.crossSellSourceGroupKey || '');
  const sourceCategoryIds = normalizeStringArray(targetItem.crossSellSourceCategoryIds);
  const targetItemId = String(targetItem.id || '');

  return Array.isArray(menuItems)
    ? menuItems
        .filter((menuItem) => String(menuItem.id || '') !== targetItemId)
        .filter((menuItem) => {
          const categoryId = getCategoryId(menuItem);

          if (sourceCategoryIds.length > 0) {
            return sourceCategoryIds.includes(categoryId);
          }

          if (!sourceGroupKey) return false;

          const offer = resolveSetPriceOfferForItem(menuItem, referenceItems, crossSellSettings);
          return String(offer?.offerGroupKey || '') === sourceGroupKey;
        })
        .filter(hasCrossSellPrice)
        .sort((left, right) => {
          const leftOrder = Number(left.sortOrder ?? left.order ?? 999999);
          const rightOrder = Number(right.sortOrder ?? right.order ?? 999999);

          if (leftOrder !== rightOrder) return leftOrder - rightOrder;

          return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
        })
    : [];
};


const getReplacementCategoryIds = (replacementItems = []) => (
  Array.from(new Set(
    (Array.isArray(replacementItems) ? replacementItems : [])
      .map((item) => getCategoryId(item))
      .filter(Boolean)
  ))
);

const StaffOrderPage = ({ storeId }) => {
  const { currentUser, role, profileName, loading: authLoading } = useAuth();
  const normalizedRole = normalizeUserRole(role);
  const canUseStaffOrder = hasMinimumRole(normalizedRole, USER_ROLES.STAFF);

  const { settings } = useStoreSettings(storeId);
  const { layoutItems, loading: layoutLoading } = useFloorLayout(storeId);
  const { menuItems: rawMenuItems = [], loading: menuLoading } = useMenuData(storeId);
  const { categories = [], loading: categoryLoading } = useCategoryData(storeId);
  const { periods = [], loading: periodsLoading } = usePeriodData(storeId);

  const [selectedTable, setSelectedTable] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [bootstrappingTableId, setBootstrappingTableId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const hasInitializedCategorySelectionRef = useRef(false);
  const [cart, setCart] = useState([]);
  const [sessionOrders, setSessionOrders] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [message, setMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completedOrderId, setCompletedOrderId] = useState('');
  const [replaceSetPriceTarget, setReplaceSetPriceTarget] = useState(null);
  const [crossSellSettings, setCrossSellSettings] = useState(null);
  const [isWideMapViewport, setIsWideMapViewport] = useState(false);

  const storeName = settings?.name || '店舗';

  const staffOrderUrl = useMemo(() => {
    if (typeof window === 'undefined' || !storeId) return '';

    const params = new URLSearchParams();
    params.set('store_id', storeId);

    return `${window.location.origin}/staff-order?${params.toString()}`;
  }, [storeId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(min-width: 768px)');

    const updateViewportMode = () => {
      setIsWideMapViewport(Boolean(mediaQuery.matches));
    };

    updateViewportMode();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewportMode);

      return () => {
        mediaQuery.removeEventListener('change', updateViewportMode);
      };
    }

    mediaQuery.addListener(updateViewportMode);

    return () => {
      mediaQuery.removeListener(updateViewportMode);
    };
  }, []);

  useEffect(() => {
    if (!storeId) {
      setCrossSellSettings(null);
      return undefined;
    }

    let cancelled = false;

    getDoc(doc(db, 'stores', storeId, 'settings', 'crossSell'))
      .then((snapshot) => {
        if (cancelled) return;
        setCrossSellSettings(snapshot.exists() ? (snapshot.data() || null) : null);
      })
      .catch((loadError) => {
        console.warn('[StaffOrderPage] failed to load crossSell settings', loadError);
        if (!cancelled) setCrossSellSettings(null);
      });

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) {
      setActiveSessions([]);
      return undefined;
    }

    const sessionsQuery = query(
      collection(db, 'stores', storeId, 'sessions'),
      where('status', '==', 'active')
    );

    return onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const nextSessions = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        }));

        setActiveSessions(nextSessions);
      },
      (snapshotError) => {
        console.error('[StaffOrderPage] failed to subscribe active sessions', snapshotError);
        setActiveSessions([]);
      }
    );
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !sessionInfo?.sessionId) {
      setSessionOrders([]);
      return undefined;
    }

    const ordersQuery = query(
      collection(db, 'stores', storeId, 'orders'),
      where('sessionId', '==', sessionInfo.sessionId)
    );

    return onSnapshot(
      ordersQuery,
      (snapshot) => {
        const nextOrders = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        }));

        setSessionOrders(nextOrders);
      },
      (snapshotError) => {
        console.error('[StaffOrderPage] failed to subscribe staff session orders', snapshotError);
        setSessionOrders([]);
      }
    );
  }, [sessionInfo?.sessionId, storeId]);

  const tableItems = useMemo(() => normalizeTableItems(layoutItems), [layoutItems]);

  const activeSessionByTableId = useMemo(() => {
    const map = new Map();

    activeSessions.forEach((session) => {
      const tableId = String(session.tableId || session.table || '').trim();
      if (!tableId) return;
      map.set(tableId, session);
    });

    return map;
  }, [activeSessions]);

  const getActiveSessionForTable = (tableId) => (
    activeSessionByTableId.get(String(tableId || '').trim()) || null
  );

  useEffect(() => {
    if (!selectedTable?.tableId || !sessionInfo?.sessionId) return;

    const selectedSessionStillActive = activeSessions.some((session) => (
      String(session.id || '') === String(sessionInfo.sessionId)
    ));

    if (selectedSessionStillActive) return;

    hasInitializedCategorySelectionRef.current = false;
    setSelectedCategoryId('');
    setSelectedTable(null);
    setSessionInfo(null);
    setSessionOrders([]);
    setCart([]);
    setError('');
    setCompletedOrderId('');
    setMessage('このテーブルの会計が完了したため、テーブルを選び直してください。');
  }, [activeSessions, selectedTable?.tableId, sessionInfo?.sessionId]);

  const currentPeriod = useCustomerCurrentPeriod(periods);
  const tableMenuOverride = useTableMenuOverride({
    storeId,
    tableId: selectedTable?.tableId,
    periods
  });
  const effectiveCurrentPeriod = tableMenuOverride?.period || currentPeriod;

  const menuItems = useMemo(() => {
    const todayKey = getTodayKey();

    return (Array.isArray(rawMenuItems) ? rawMenuItems : [])
      .filter((item) => isStaffOrderMenuItemCustomerVisible(item, todayKey))
      .filter((item) => isStaffOrderMenuItemTimeAllowed(item, effectiveCurrentPeriod));
  }, [rawMenuItems, effectiveCurrentPeriod]);

  const todayKey = useMemo(() => getTodayKey(), []);

  const categoryById = useMemo(() => buildCategoryById(categories), [categories]);

  const floorMapBounds = useMemo(() => {
    const items = Array.isArray(layoutItems) ? layoutItems : [];

    const maxRight = items.reduce((max, item) => {
      const x = Number(item.x || 0);
      const width = Number(item.width || item.w || 120);
      return Math.max(max, x + width);
    }, 360);

    const maxBottom = items.reduce((max, item) => {
      const y = Number(item.y || 0);
      const height = Number(item.height || item.h || 80);
      return Math.max(max, y + height);
    }, 220);

    return {
      width: Math.max(360, Math.ceil(maxRight + 40)),
      height: Math.max(220, Math.ceil(maxBottom + 40))
    };
  }, [layoutItems]);

  const floorMapScale = useMemo(() => {
    const targetWidth = isWideMapViewport ? 980 : 600;
    return Math.min(1, targetWidth / Math.max(floorMapBounds.width, 1));
  }, [floorMapBounds.width, isWideMapViewport]);

  const floorMapViewportHeight = isWideMapViewport
    ? Math.ceil(floorMapBounds.height * floorMapScale) + 24
    : 280;

  const customerVisibleMenuItems = useMemo(() => (
    Array.isArray(menuItems)
      ? menuItems
          .map((item) => decorateMenuItemAvailability(item, todayKey))
          .filter((item) => item && item.isSoldOut !== true && item.isHidden !== true && item.visible !== false)
          .filter((item) => isMenuItemCustomerVisible(item, todayKey))
          .filter((item) => {
            const itemPeriods = Array.isArray(item.periods) ? item.periods.map(String) : [];

            if (itemPeriods.length === 0) return true;
            if (!effectiveCurrentPeriod?.id) return false;

            return itemPeriods.includes(String(effectiveCurrentPeriod.id));
          })
      : []
  ), [effectiveCurrentPeriod, menuItems, todayKey]);

  const existingOrderItemsForSetPrice = useMemo(
    () => normalizeSessionOrderItemsForSetPrice(sessionOrders),
    [sessionOrders]
  );

  const setPriceReferenceItems = useMemo(
    () => [...existingOrderItemsForSetPrice, ...cart],
    [cart, existingOrderItemsForSetPrice]
  );


  const replacementCandidates = useMemo(() => (
    findSetPriceReplacementItems({
      targetItem: replaceSetPriceTarget,
      menuItems: customerVisibleMenuItems,
      referenceItems: setPriceReferenceItems.filter((item) => (
        getCartLineKey(item) !== getCartLineKey(replaceSetPriceTarget || {})
      )),
      crossSellSettings: crossSellSettings || {}
    })
  ), [crossSellSettings, customerVisibleMenuItems, replaceSetPriceTarget, setPriceReferenceItems]);

  const replacementCategoryIds = useMemo(
    () => getReplacementCategoryIds(replacementCandidates),
    [replacementCandidates]
  );

  const isReplaceMode = Boolean(replaceSetPriceTarget);

  const activeCategories = useMemo(() => {
    const menuCategoryIds = new Set(
      customerVisibleMenuItems
        .map((item) => getCategoryId(item))
        .filter(Boolean)
    );

    const replacementCategoryIdSet = new Set(replacementCategoryIds);

    return Array.isArray(categories)
      ? categories
          .map((category, index) => ({
            ...category,
            __index: index
          }))
          .filter((category) => category?.id)
          .filter((category) => menuCategoryIds.has(String(category.id)))
          .filter((category) => {
            if (isReplaceMode) {
              return replacementCategoryIdSet.has(String(category.id));
            }

            return shouldShowStaffCategoryTab({
              category,
              categoryId: String(category.id),
              menuItems: customerVisibleMenuItems,
              setPriceReferenceItems,
              existingOrderItemsForSetPrice,
              cart,
              crossSellSettings: crossSellSettings || {}
            });
          })
          .map((category) => ({
            id: String(category.id),
            name: category.name || 'カテゴリー',
            sortOrder: Number(category.sortOrder ?? category.order ?? category.__index ?? 999999),
            __index: Number(category.__index ?? 999999)
          }))
          .sort((left, right) => {
            if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
            return left.__index - right.__index;
          })
      : [];
  }, [
    cart,
    categories,
    crossSellSettings,
    customerVisibleMenuItems,
    existingOrderItemsForSetPrice,
    isReplaceMode,
    replacementCategoryIds,
    setPriceReferenceItems
  ]);

  // selected category validity guard
  useEffect(() => {
    if (!Array.isArray(activeCategories) || activeCategories.length === 0) {
      return;
    }

    const firstCategoryId = String(activeCategories[0].id || '');
    if (!firstCategoryId) return;

    if (!hasInitializedCategorySelectionRef.current) {
      hasInitializedCategorySelectionRef.current = true;
      setSelectedCategoryId(firstCategoryId);
      return;
    }

    if (selectedCategoryId === 'all') return;

    const exists = activeCategories.some((category) => String(category.id) === String(selectedCategoryId));
    if (!selectedCategoryId || !exists) {
      setSelectedCategoryId(firstCategoryId);
    }
  }, [activeCategories, selectedCategoryId]);

  const availableMenuItems = useMemo(() => {
    const sourceItems = isReplaceMode ? replacementCandidates : customerVisibleMenuItems;

    return sourceItems
      .filter((item) => {
        const categoryId = getCategoryId(item);
        const category = categoryById.get(categoryId);
        const visibility = getCategoryVisibility(category);

        return visibility !== 'hidden';
      })
      .filter((item) => selectedCategoryId === 'all' || getCategoryId(item) === selectedCategoryId)
      .sort((left, right) => {
        const leftOrder = Number(left.sortOrder ?? left.order ?? 999999);
        const rightOrder = Number(right.sortOrder ?? right.order ?? 999999);

        if (leftOrder !== rightOrder) return leftOrder - rightOrder;

        return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
      });
  }, [
    categoryById,
    customerVisibleMenuItems,
    isReplaceMode,
    replacementCandidates,
    selectedCategoryId
  ]);

  const cartTotal = useMemo(() => (
    cart.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0)
  ), [cart]);

  const cartCount = useMemo(() => (
    cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  ), [cart]);

  const crossSellSummary = useMemo(() => {
    const normalQuantity = setPriceReferenceItems
      .filter((item) => !isCrossSellCartItem(item))
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    const crossSellQuantity = setPriceReferenceItems
      .filter(isCrossSellCartItem)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    return {
      normalQuantity,
      crossSellQuantity,
      remainingCrossSellQuantity: Math.max(normalQuantity - crossSellQuantity, 0)
    };
  }, [setPriceReferenceItems]);

  const staffSetPriceDebugRows = useMemo(
    () => buildStaffSetPriceDebugRows(setPriceReferenceItems, crossSellSettings || {}),
    [crossSellSettings, setPriceReferenceItems]
  );

  const staffDisplayName = profileName || currentUser?.displayName || currentUser?.email || 'スタッフ';

  const showTemporaryToast = (nextMessage) => {
    setToastMessage(nextMessage);

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setToastMessage('');
      }, 1800);
    }
  };

  const openReplaceSetPriceModal = (cartItem) => {
    if (!cartItem || !isCrossSellCartItem(cartItem)) return;
    setReplaceSetPriceTarget(cartItem);

    const categoryIds = getReplacementCategoryIds(findSetPriceReplacementItems({
      targetItem: cartItem,
      menuItems: customerVisibleMenuItems,
      referenceItems: setPriceReferenceItems.filter((item) => (
        getCartLineKey(item) !== getCartLineKey(cartItem)
      )),
      crossSellSettings: crossSellSettings || {}
    }));

    if (categoryIds[0]) {
      setSelectedCategoryId(categoryIds[0]);
    }
  };

  const closeReplaceSetPriceModal = () => {
    setReplaceSetPriceTarget(null);
    hasInitializedCategorySelectionRef.current = false;
    setSelectedCategoryId('');
  };

  const handleReplaceSetPriceItem = (replacementItem) => {
    if (!replaceSetPriceTarget || !replacementItem?.id) return;

    setCart((current) => {
      const currentCart = Array.isArray(current) ? current : [];
      const targetKey = getCartLineKey(replaceSetPriceTarget);
      const normalPrice = getMenuPrice(replacementItem);
      const setPrice = Number(replacementItem.crossSellPrice);

      return currentCart.map((cartItem) => {
        if (getCartLineKey(cartItem) !== targetKey) return cartItem;

        return {
          ...cartItem,
          id: String(replacementItem.id),
          name: replacementItem.name || '商品',
          unitPrice: setPrice,
          price: setPrice,
          originalPrice: normalPrice,
          category: replacementItem.category || replacementItem.categoryId || '',
          categoryId: replacementItem.categoryId || replacementItem.category || '',
          kitchenName: replacementItem.kitchenName || '',
          allowsTakeout: replacementItem.allowsTakeout !== false,
          allergens: replacementItem.allergens || [],
          priceLabelText: replacementItem.crossSellPriceLabelText || 'セット価格',
          originalPriceLabelText: replacementItem.priceLabelText || ''
        };
      });
    });

    setReplaceSetPriceTarget(null);
  };

  const handleSelectTable = async (table) => {
    if (!storeId || !table?.tableId || bootstrappingTableId) return;

    setError('');
    setCompletedOrderId('');
    setBootstrappingTableId(table.tableId);

    try {
      const idToken = await auth.currentUser?.getIdToken();

      if (!idToken) {
        throw new Error('ログイン状態を確認できませんでした。');
      }

      const result = await bootstrapCustomerSession({
        idToken,
        storeId,
        tableId: table.tableId,
        tableToken: '',
        participantToken: ''
      });

      const nextSessionInfo = {
        sessionId: result.sessionId,
        participantId: result.participantId,
        participantToken: result.participantToken || '',
        tableId: result.tableId || table.tableId,
        tableName: result.tableName || result.tableDisplayName || table.tableName || table.tableId
      };

      if (!nextSessionInfo.sessionId || !nextSessionInfo.participantId) {
        throw new Error('セッション情報を取得できませんでした。');
      }

      setSelectedTable({
        ...table,
        tableName: nextSessionInfo.tableName || table.tableName
      });
      setSessionInfo(nextSessionInfo);
      setSessionOrders([]);
      setCart([]);
    } catch (selectError) {
      console.error('[StaffOrderPage] failed to select table', selectError);
      setError(selectError.message || 'テーブルの開始に失敗しました。');
    } finally {
      setBootstrappingTableId('');
    }
  };

  const canIncreaseCartLineQuantity = (targetItem, currentCart = cart) => {
    if (!targetItem || targetItem.appliedPriceMode !== 'crossSell') {
      return true;
    }

    const targetKey = getCartLineKey(targetItem);
    const nextCart = currentCart.map((cartItem) => (
      getCartLineKey(cartItem) === targetKey
        ? { ...cartItem, quantity: Number(cartItem.quantity || 0) + 1 }
        : cartItem
    ));

    const normalizedCart = normalizeCartSetPriceBalance(
      nextCart,
      existingOrderItemsForSetPrice
    );

    const normalizedTarget = normalizedCart.find((cartItem) => getCartLineKey(cartItem) === targetKey);

    return Boolean(
      normalizedTarget &&
      normalizedTarget.appliedPriceMode === 'crossSell' &&
      Number(normalizedTarget.quantity || 0) === Number(targetItem.quantity || 0) + 1
    );
  };

  const addToCart = (item, preferredPriceMode = 'auto') => {
    setCompletedOrderId('');
    setError('');

    const itemId = String(item.id || '').trim();
    if (!itemId) return;

    setCart((current) => {
      const currentCart = Array.isArray(current) ? current : [];
      const referenceItems = [...existingOrderItemsForSetPrice, ...currentCart];
      const normalPrice = getMenuPrice(item);
      const crossSellOffer = resolveSetPriceOfferForItem(item, referenceItems, crossSellSettings || {});
      const wantsNormalPrice = preferredPriceMode === 'normal';
      const wantsSetPrice = preferredPriceMode === 'crossSell';
      const canUseCrossSellPrice = !wantsNormalPrice && Boolean(crossSellOffer);

      if (wantsSetPrice && !crossSellOffer) {
        showTemporaryToast('セット価格の残数がありません。');
        return currentCart;
      }

      const appliedPriceMode = canUseCrossSellPrice ? 'crossSell' : 'normal';
      const unitPrice = canUseCrossSellPrice ? Number(item.crossSellPrice) : normalPrice;
      const cartId = appliedPriceMode === 'crossSell'
        ? `${itemId}:crossSell:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
        : itemId;

      const nextCartItem = {
        id: itemId,
        cartId,
        name: item.name || '商品',
        quantity: 1,
        unitPrice,
        price: unitPrice,
        originalPrice: canUseCrossSellPrice ? normalPrice : null,
        category: item.category || item.categoryId || '',
        categoryId: item.categoryId || item.category || '',
        kitchenName: item.kitchenName || '',
        selectedOptions: [],
        allowsTakeout: item.allowsTakeout !== false,
        allergens: item.allergens || [],
        serviceTiming: '',
        serviceTimingLabel: '',
        appliedPriceMode,
        priceLabelText: canUseCrossSellPrice ? (item.crossSellPriceLabelText || 'セット価格') : (item.priceLabelText || ''),
        originalPriceLabelText: canUseCrossSellPrice ? (item.priceLabelText || '') : '',
        crossSellSourceKey: canUseCrossSellPrice
          ? `${String(crossSellOffer?.flow?.id || crossSellOffer?.flow?.key || 'staff-flow')}:${String(crossSellOffer?.offerGroupKey || 'group')}`
          : '',
        crossSellSourceFlowId: canUseCrossSellPrice ? String(crossSellOffer?.flow?.id || '') : '',
        crossSellSourceStepId: '',
        crossSellSourceGroupKey: canUseCrossSellPrice ? String(crossSellOffer?.offerGroupKey || '') : '',
        crossSellSourceCategoryIds: canUseCrossSellPrice
          ? normalizeStringArray(crossSellOffer?.offerCategoryIds)
          : []
      };

      if (appliedPriceMode === 'crossSell') {
        // 重要:
        // ここで normalizeCartSetPriceBalance() を通すと、
        // flow/group 別の残数判定ではなく簡易総数判定で crossSell 行が normal に戻る場合がある。
        // セット価格として判定済みの行は、そのまま追加して残数管理に反映する。
        return [...currentCart, nextCartItem];
      }

      const existing = currentCart.find((cartItem) => (
        getCartLineKey(cartItem) === itemId
        && cartItem.appliedPriceMode !== 'crossSell'
      ));

      const nextCart = existing
        ? currentCart.map((cartItem) => (
            getCartLineKey(cartItem) === getCartLineKey(existing)
              ? { ...cartItem, quantity: Number(cartItem.quantity || 0) + 1 }
              : cartItem
          ))
        : [...currentCart, nextCartItem];

      window.setTimeout(() => {
          }, 0);

      return nextCart;
    });
  };

  const changeQuantity = (cartLineKey, delta) => {
    setCart((current) => {
      const currentCart = Array.isArray(current) ? current : [];
      const targetItem = currentCart.find((item) => getCartLineKey(item) === String(cartLineKey));

      const changedCart = currentCart
        .map((item) => (
          getCartLineKey(item) === String(cartLineKey)
            ? { ...item, quantity: Math.max(Number(item.quantity || 0) + Number(delta || 0), 0) }
            : item
        ))
        .filter((item) => Number(item.quantity || 0) > 0);

      if (Number(delta || 0) < 0 && targetItem && !isCrossSellCartItem(targetItem)) {
        const balancedCart = normalizeCartSetPriceBalance(
          changedCart,
          existingOrderItemsForSetPrice
        );

        const hasExcessSetPrice = balancedCart.some((item) => (
          isCrossSellCartItem(
            changedCart.find((cartItem) => getCartLineKey(cartItem) === getCartLineKey(item)) || {}
          ) && item.appliedPriceMode !== 'crossSell'
        ));

        if (hasExcessSetPrice) {
          showTemporaryToast('セット価格商品をセット権利に合わせて1点取り消しました。');
          return removeOneExcessSetPriceLine(changedCart, existingOrderItemsForSetPrice);
        }

        return changedCart;
      }

      return normalizeCartSetPriceBalance(
        changedCart,
        existingOrderItemsForSetPrice
      );
    });
  };

  const clearTableSelection = () => {
    hasInitializedCategorySelectionRef.current = false;
    setSelectedCategoryId('');
    setSelectedTable(null);
    setSessionInfo(null);
    setSessionOrders([]);
    setCart([]);
    setError('');
    setCompletedOrderId('');
  };

  const handleSubmitOrder = async () => {
    if (!storeId || !sessionInfo?.sessionId || !sessionInfo?.participantId || !selectedTable?.tableId || cart.length === 0 || submitting) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const idToken = await auth.currentUser?.getIdToken();

      if (!idToken) {
        throw new Error('ログイン状態を確認できませんでした。');
      }

      const response = await fetch('/api/createPostpayOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          storeId,
          sessionId: sessionInfo.sessionId,
          tableId: selectedTable.tableId,
          partySize: 0,
          participantId: sessionInfo.participantId,
          cart,
          totalPrice: cartTotal,
          orderSource: 'staff',
          isStaffOrder: true,
          createdByStaffUid: currentUser?.uid || '',
          createdByStaffName: staffDisplayName
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message || '注文の送信に失敗しました。');
      }

      setCompletedOrderId(payload.orderId || '');
      setCart([]);
      setMessage('注文を送信しました。キッチンモニターに反映されます。');
    } catch (submitError) {
      console.error('[StaffOrderPage] failed to submit order', submitError);
      setError(submitError.message || '注文の送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <LoadingSpinner size={32} className="m-auto" />
      </div>
    );
  }

  if (!currentUser || currentUser.isAnonymous || !canUseStaffOrder) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center">
        <div className="w-full max-w-md rounded-[2rem] bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-black text-slate-900">
            スタッフ注文
          </h1>
          <p className="mt-4 text-sm font-bold leading-relaxed text-slate-500">
            この画面を利用するには、店舗スタッフアカウントでログインしてください。
          </p>
        </div>
      </div>
    );
  }

  if (!storeId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center">
        <div className="w-full max-w-md rounded-[2rem] bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-black text-slate-900">
            店舗情報が見つかりません
          </h1>
          <p className="mt-4 text-sm font-bold leading-relaxed text-slate-500">
            レジ画面の「スタッフ注文」から開き直してください。
          </p>
        </div>
      </div>
    );
  }

  const isLoadingData = layoutLoading || menuLoading || categoryLoading || periodsLoading;

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
              Staff Order
            </p>
            <h1 className="truncate text-xl font-black text-slate-900">
              スタッフ注文
            </h1>
            <p className="truncate text-xs font-bold text-slate-500">
              {storeName}
            </p>
          </div>

          {selectedTable && (
            <button
              type="button"
              onClick={clearTableSelection}
              className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white shadow-sm active:scale-95"
            >
              <ArrowLeft size={18} />
              テーブル選択
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {message && (
          <div className="mb-4 rounded-2xl bg-green-50 px-4 py-3 text-sm font-black text-green-700">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">
            {error}
          </div>
        )}

        {isLoadingData ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <LoadingSpinner size={32} className="m-auto" />
          </div>
        ) : !selectedTable ? (
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  テーブルを選択
                </h2>
                <p className="text-xs font-bold text-slate-500">
                  マップ、またはスマホ用ボタンからテーブルを選びます。
                </p>
              </div>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-black text-slate-600 shadow-sm active:scale-95"
              >
                <RefreshCw size={15} />
                更新
              </button>
            </div>

            {tableItems.length === 0 ? (
              <div className="rounded-[1.5rem] bg-white p-8 text-center shadow-sm">
                <Table2 className="mx-auto mb-4 text-slate-300" size={44} />
                <p className="text-sm font-black text-slate-500">
                  テーブル設定が見つかりません。管理画面のフロアマップを確認してください。
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 rounded-[1.5rem] bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-3 px-1">
                    <div>
                      <p className="text-xs font-black text-slate-500">
                        フロアマップ
                      </p>
                      <p className="text-[11px] font-bold text-slate-400">
                        マップ上のテーブルもタップできます
                      </p>
                    </div>

                    <p className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-500">
                      {layoutItems.length}要素 / {tableItems.length}卓
                    </p>
                  </div>

                  <div className="w-full rounded-[1.25rem] bg-slate-100">
                    {layoutItems.length > 0 ? (
                      <div
                        className={`${isWideMapViewport ? 'overflow-hidden' : 'overflow-auto'} rounded-[1.25rem]`}
                        style={{
                          height: `${floorMapViewportHeight}px`,
                          WebkitOverflowScrolling: 'touch'
                        }}
                      >
                        <div
                          className={isWideMapViewport ? 'mx-auto' : ''}
                          style={{
                            width: `${Math.ceil(floorMapBounds.width * floorMapScale) + 24}px`,
                            height: `${Math.ceil(floorMapBounds.height * floorMapScale) + 24}px`,
                            padding: '12px'
                          }}
                        >
                          <div
                            style={{
                              width: `${floorMapBounds.width}px`,
                              height: `${floorMapBounds.height}px`,
                              transform: `scale(${floorMapScale})`,
                              transformOrigin: 'top left'
                            }}
                          >
                            <FloorMapCanvas
                              key={`staff-scroll-map-${layoutItems.length}-${floorMapBounds.width}-${floorMapBounds.height}-${floorMapScale}`}
                              mode="view"
                              items={layoutItems}
                              sessions={activeSessions}
                              orders={[]}
                              calls={[]}
                              checks={[]}
                              width={floorMapBounds.width}
                              height={floorMapBounds.height}
                              darkTheme={false}
                              selectedTableId={bootstrappingTableId || ''}
                              onTableSelect={(tableId) => {
                                const targetTable = tableItems.find((table) => String(table.tableId) === String(tableId));
                                if (targetTable) handleSelectTable(targetTable);
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-44 items-center justify-center px-4 text-center text-xs font-bold text-slate-400">
                        フロアマップ設定が見つかりません。下のテーブルボタンから選択してください。
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3 md:hidden">
                  {tableItems.map((table) => {
                    const isBootstrapping = bootstrappingTableId === table.tableId;
                    const activeSession = getActiveSessionForTable(table.tableId);
                    const isActiveTable = Boolean(activeSession);

                    return (
                      <button
                        key={table.tableId}
                        type="button"
                        onClick={() => handleSelectTable(table)}
                        disabled={Boolean(bootstrappingTableId)}
                        className={`flex min-h-[92px] flex-col items-center justify-center rounded-[1.35rem] border px-2 py-4 text-center shadow-sm transition-all active:scale-[0.98] disabled:opacity-60 ${
                          isActiveTable
                            ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        {isBootstrapping ? (
                          <Loader2 className="animate-spin text-blue-600" size={24} />
                        ) : (
                          <>
                            <span className={`line-clamp-2 text-xl font-black leading-tight sm:text-2xl ${
                              isActiveTable ? 'text-blue-900' : 'text-slate-900'
                            }`}>
                              {table.tableName || getTableDisplayName(table)}
                            </span>
                            {isActiveTable && (
                              <span className="mt-2 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-black text-white">
                                利用中
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {staffOrderUrl && (
                  <div className="mt-4 hidden rounded-[1.5rem] bg-white p-6 text-center shadow-sm md:block">
                    <p className="text-sm font-black text-slate-900">
                      スマホ注文端末で開く
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-500">
                      スタッフのスマホで読み込んでください
                    </p>

                    <div className="mx-auto mt-5 flex w-fit rounded-[1.25rem] bg-white p-4 shadow-inner ring-1 ring-slate-100">
                      <QRCodeSVG
                        value={staffOrderUrl}
                        size={180}
                        level="M"
                        includeMargin
                      />
                    </div>

                    <p className="mx-auto mt-4 max-w-md break-all rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-bold leading-relaxed text-slate-500">
                      {staffOrderUrl}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              {toastMessage && (
                <div className="sticky top-[76px] z-30 mb-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-black text-orange-700 shadow-sm">
                  {toastMessage}
                </div>
              )}

              <div className="mb-3 rounded-[1.5rem] bg-white p-4 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
                  選択中テーブル
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {selectedTable.tableName || selectedTable.tableId}
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  Session: {sessionInfo?.sessionId?.slice(0, 8) || '-'}
                </p>
              </div>

              {isReplaceMode && (
                <div className="sticky top-[76px] z-30 mb-3 rounded-[1.25rem] border border-blue-200 bg-blue-50 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-blue-700">
                        セット商品を変更中
                      </p>
                      <p className="mt-1 text-xs font-bold text-blue-600">
                        {replaceSetPriceTarget?.name || 'セット商品'} の差し替え先を選んでください。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeReplaceSetPriceModal}
                      className="h-10 rounded-2xl bg-white px-4 text-xs font-black text-blue-700 shadow-sm"
                    >
                      変更をやめる
                    </button>
                  </div>
                </div>
              )}

              <div className={`sticky z-20 mb-3 overflow-x-auto rounded-[1.25rem] bg-white p-2 shadow-sm ${
                isReplaceMode ? 'top-[152px] ring-2 ring-blue-100' : 'top-[76px]'
              }`}>
                <div className="flex gap-2">
                  {activeCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(category.id)}
                      className={`h-11 shrink-0 rounded-2xl px-4 text-sm font-black ${
                        selectedCategoryId === category.id
                          ? (isReplaceMode ? 'bg-blue-600 text-white' : 'bg-slate-900 text-white')
                          : (isReplaceMode ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-600')
                      }`}
                    >
                      {category.name}
                    </button>
                  ))}
                  {!isReplaceMode && (
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryId('all')}
                      className={`h-11 shrink-0 rounded-2xl px-4 text-sm font-black ${
                        selectedCategoryId === 'all'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      すべて
                    </button>
                  )}

                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {availableMenuItems.map((item) => {
                  const setPriceOffer = resolveSetPriceOfferForItem(item, setPriceReferenceItems, crossSellSettings || {});
                  const setOfferGroupKey = String(setPriceOffer?.offerGroupKey || '');
                  const canAddSetPrice = Boolean(setPriceOffer);
                  const setPriceCartQuantity = getMenuCartQuantityByMode(cart, item, 'crossSell', setOfferGroupKey);
                  const normalCartQuantity = getMenuCartQuantityByMode(cart, item, 'normal');
                  const setPriceCartLine = findMenuCartLineByMode(cart, item, 'crossSell', setOfferGroupKey);
                  const normalCartLine = findMenuCartLineByMode(cart, item, 'normal');
                  const normalPrice = getMenuPrice(item);

                  // セット残数がある時だけ、カード本体はセット価格表示。
                  // セット残数が0になった後は、カード本体を定価表示へ戻す。
                  // その商品がセット価格でカートに入っている場合だけ、下部にセット価格分サブ表示を残す。
                  const shouldUseSetPriceAsMain = canAddSetPrice;
                  const shouldShowUsedSetPriceSubcard = !canAddSetPrice && setPriceCartQuantity > 0;

                  const activeCartQuantity = shouldUseSetPriceAsMain ? setPriceCartQuantity : normalCartQuantity;
                  const activeCartLine = shouldUseSetPriceAsMain ? setPriceCartLine : normalCartLine;
                  const activePriceMode = shouldUseSetPriceAsMain ? 'crossSell' : 'normal';

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (isReplaceMode) {
                          handleReplaceSetPriceItem(item);
                          return;
                        }

                        addToCart(item, activePriceMode);
                      }}
                      className={`rounded-[1.5rem] border p-5 text-left shadow-sm transition-all active:scale-[0.98] ${
                        isReplaceMode
                          ? 'border-blue-200 bg-white ring-1 ring-blue-100'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-lg font-black leading-snug text-slate-900">
                            {item.name || '商品'}
                          </p>

                          {isReplaceMode ? (
                            <div className="mt-2 space-y-1">
                              <p className="inline-flex rounded-full bg-blue-100 px-3 py-1.5 text-sm font-black text-blue-700">
                                セット価格 {formatMoney(Number(item.crossSellPrice))}
                              </p>
                              {item.kitchenName && (
                                <p className="text-[11px] font-bold text-slate-400">
                                  {item.kitchenName}
                                </p>
                              )}
                            </div>
                          ) : shouldUseSetPriceAsMain ? (
                            <div className="mt-2 space-y-1">
                              <p className="text-sm font-black text-slate-400 line-through">
                                通常価格 {formatMoney(normalPrice)}
                              </p>
                              <p className="inline-flex rounded-full bg-orange-100 px-3 py-1.5 text-sm font-black text-orange-700">
                                セット価格 {formatMoney(Number(item.crossSellPrice))}
                              </p>
                            </div>
                          ) : (
                            <div className="mt-2 space-y-1">
                              <p className="text-xl font-black text-blue-600">
                                {formatMoney(normalPrice)}
                              </p>
                              {item.kitchenName && (
                                <p className="text-[11px] font-bold text-slate-400">
                                  {item.kitchenName}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {activeCartQuantity > 0 && (
                            <>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();

                                  if (activeCartLine) {
                                    changeQuantity(getCartLineKey(activeCartLine), -1);
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600 shadow-sm ring-1 ring-red-100 active:scale-95"
                                aria-label="カートから1点減らす"
                              >
                                <Minus size={18} />
                              </div>

                              <div className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-2xl bg-slate-900 px-3 text-white shadow-sm">
                                <ShoppingCart size={16} />
                                <span className="text-sm font-black">
                                  {activeCartQuantity}
                                </span>
                              </div>
                            </>
                          )}

                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();

                              if (isReplaceMode) {
                                handleReplaceSetPriceItem(item);
                                return;
                              }

                              addToCart(item, activePriceMode);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              event.stopPropagation();

                              if (isReplaceMode) {
                                handleReplaceSetPriceItem(item);
                                return;
                              }

                              addToCart(item, activePriceMode);
                            }}
                            className={`flex h-11 items-center justify-center rounded-2xl text-white shadow-sm active:scale-95 ${
                              isReplaceMode
                                ? 'bg-blue-600 px-4 text-sm font-black'
                                : shouldUseSetPriceAsMain
                                  ? 'w-11 bg-orange-500'
                                  : 'w-11 bg-blue-600'
                            }`}
                            aria-label={isReplaceMode ? 'この商品に変更' : shouldUseSetPriceAsMain ? 'セット価格で追加' : '通常価格で追加'}
                          >
                            {isReplaceMode ? '変更' : <Plus size={22} />}
                          </div>
                        </div>
                      </div>

                      {shouldShowUsedSetPriceSubcard && (
                        <div
                          role="group"
                          aria-label="セット価格分"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          className="mt-4 rounded-[1.25rem] border border-orange-200 bg-orange-50 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-black text-orange-700">
                                セット価格分
                              </p>
                              <p className="mt-1 text-2xl font-black text-orange-700">
                                {formatMoney(Number(item.crossSellPrice))}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (setPriceCartLine) {
                                    changeQuantity(getCartLineKey(setPriceCartLine), -1);
                                  }
                                }}
                                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 shadow-sm ring-1 ring-red-100 active:scale-95"
                                aria-label="セット価格分を1点減らす"
                              >
                                <Minus size={18} />
                              </button>

                              <div className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-2xl bg-slate-900 px-3 text-white shadow-sm">
                                <ShoppingCart size={16} />
                                <span className="text-sm font-black">
                                  {setPriceCartQuantity}
                                </span>
                              </div>

                              <button
                                type="button"
                                disabled
                                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-300 shadow-none"
                                aria-label="セット価格分は追加できません"
                              >
                                <Plus size={22} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="lg:sticky lg:top-[92px] lg:self-start">
              <div className="rounded-[1.75rem] border-2 border-blue-200 bg-blue-100 p-4 shadow-md">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-lg font-black">
                    <ShoppingCart size={20} />
                    カート
                  </h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                    {cartCount}点
                  </span>
                </div>

                {cart.length === 0 ? (
                  <p className="rounded-2xl bg-white p-5 text-center text-sm font-bold text-slate-400">
                    商品を選択してください。
                  </p>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div
                        key={getCartLineKey(item)}
                        className="rounded-2xl border border-blue-100 bg-white p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-black text-slate-900">
                              {item.name}
                            </p>
                            <p className="mt-1 text-sm font-bold text-slate-500">
                              {formatMoney(item.unitPrice)} × {item.quantity}
                            </p>
                            {item.appliedPriceMode === 'crossSell' && (
                              <p className="mt-1 inline-flex rounded-full bg-orange-100 px-2 py-1 text-[11px] font-black text-orange-700">
                                {item.priceLabelText || 'セット価格'}
                              </p>
                            )}
                          </div>

                          <p className="shrink-0 font-black text-slate-900">
                            {formatMoney(Number(item.unitPrice || 0) * Number(item.quantity || 0))}
                          </p>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => changeQuantity(getCartLineKey(item), -1)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm"
                          >
                            <Minus size={16} />
                          </button>

                          <span className="w-8 text-center text-sm font-black">
                            {item.quantity}
                          </span>

                          <button
                            type="button"
                            onClick={() => changeQuantity(getCartLineKey(item), 1)}
                            disabled={item.appliedPriceMode === 'crossSell' && !canIncreaseCartLineQuantity(item, cart)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm disabled:opacity-40"
                          >
                            <Plus size={16} />
                          </button>

                          {item.appliedPriceMode === 'crossSell' && (
                            <button
                              type="button"
                              onClick={() => openReplaceSetPriceModal(item)}
                              className="flex h-9 items-center gap-1 rounded-xl bg-blue-600 px-3 text-xs font-black text-white shadow-sm"
                            >
                              <Repeat2 size={15} />
                              変更
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex items-end justify-between">
                    <span className="text-sm font-black text-slate-500">
                      合計
                    </span>
                    <span className="text-3xl font-black text-slate-900">
                      {formatMoney(cartTotal)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleSubmitOrder}
                    disabled={cart.length === 0 || submitting}
                    className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-base font-black text-white shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:bg-slate-300 disabled:shadow-none"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                    注文を送信
                  </button>

                  {completedOrderId && (
                    <div className="mt-4 rounded-2xl bg-green-50 p-4 text-center text-sm font-black text-green-700">
                      <CheckCircle2 className="mx-auto mb-2" size={24} />
                      注文を送信しました
                    </div>
                  )}

                  {completedOrderId && (
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCompletedOrderId('');
                        }}
                        className="h-12 rounded-2xl bg-slate-900 text-sm font-black text-white"
                      >
                        続けて注文
                      </button>

                      <button
                        type="button"
                        onClick={clearTableSelection}
                        className="h-12 rounded-2xl bg-slate-100 text-sm font-black text-slate-700"
                      >
                        テーブル選択へ戻る
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </section>
        )}
      </main>

    </div>
  );
};

export default StaffOrderPage;
