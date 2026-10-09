import React, { useMemo } from 'react';
import { getTableDisplayName } from '../../../shared/utils/tableDisplay';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  Flame,
  RotateCcw,
  Timer
} from 'lucide-react';

import {
  getActiveKitchenItems,
  getElapsedLevel,
  getElapsedTime,
  processDisplayItems
} from '../utils/kitchenUtils';

const IMPORTANT_OPTION_PATTERN = /(抜き|少なめ|多め|別|アレル|なし|変更|大盛|追加|ソース|氷|辛さ|ご飯)/;

const resolveKitchenStatus = (item) => {
  if (item?.kitchenStatus === 'served') return 'served';
  if (item?.kitchenStatus === 'prepared' || item?.isPrepared) return 'prepared';
  if (item?.kitchenStatus === 'cooking' || item?.isCooking) return 'cooking';
  return 'pending';
};

const resolveOrderKitchenStatus = (order) => {
  const items = getActiveKitchenItems(order?.items);

  if (order?.status === 'completed') return 'completed';

  if (items.length > 0 && items.every((item) => resolveKitchenStatus(item) === 'served')) {
    return 'served';
  }

  if (
    items.length > 0 &&
    items.every((item) => {
      const status = resolveKitchenStatus(item);
      return status === 'prepared' || status === 'served';
    })
  ) {
    return 'serving';
  }

  if (items.length > 0 && items.some((item) => resolveKitchenStatus(item) === 'cooking')) {
    return 'cooking';
  }

  return 'pending';
};



const resolveDisplayKitchenStatus = ({
  order,
  activeKitchenId,
  displayItems
}) => {
  const allItems = getActiveKitchenItems(order?.items);
  const targetItems = activeKitchenId === 'all'
    ? (displayItems || [])
    : (displayItems || []).filter((item) => item.isMatched);

  if (order?.status === 'completed') return 'completed';
  if (targetItems.length === 0) return 'pending';

  // 調理開始済みの商品が1つでもあれば、提供中判定より先に「調理中」を優先する
  if (targetItems.some((item) => resolveKitchenStatus(item) === 'cooking')) {
    return 'cooking';
  }

  const moveKey = String(activeKitchenId || 'all');
  const movedToBackKitchenIds = Array.isArray(order?.movedToBackKitchenIds)
    ? order.movedToBackKitchenIds.map(String)
    : [];
  const isMovedToBack = movedToBackKitchenIds.includes(moveKey);

  const allOrderServed = allItems.length > 0 && allItems.every((item) => (
    resolveKitchenStatus(item) === 'served'
  ));

  const allTargetServed = targetItems.every((item) => (
    resolveKitchenStatus(item) === 'served'
  ));

  const allTargetPrepared = targetItems.every((item) => {
    const status = resolveKitchenStatus(item);
    return status === 'prepared' || status === 'served';
  });

  if (allTargetServed && !isMovedToBack) return 'targetServed';
  if (allOrderServed && isMovedToBack) return 'allServed';
  if (allTargetServed && isMovedToBack) return 'waitingComplete';
  if (allTargetPrepared) return 'serving';

  return 'pending';
};

// キッチンのカードは一目で状態を見分けるため、例外として7色のテーマ色を使う【AKUTOブランド基準 10-09】
// 未着手・調理中=テラコッタ / 提供待ち・済=グリーン / 提供中=ブルー
const ORDER_STATUS_META = {
  pending: {
    label: '未着手',
    badgeClassName: 'border-[#C2410C]/20 bg-[#C2410C]/5 text-[#C2410C]',
    headerClassName: 'border-[#C2410C]/10 bg-[#C2410C]/5 hover:bg-[#C2410C]/5'
  },
  cooking: {
    label: '調理中',
    badgeClassName: 'border-[#C2410C] bg-[#C2410C] text-white',
    headerClassName: 'border-[#C2410C]/20 bg-[#C2410C]/5 hover:bg-[#C2410C]/10'
  },
  serving: {
    label: '提供待ち',
    badgeClassName: 'border-[#15803D] bg-[#15803D] text-white',
    headerClassName: 'border-[#15803D]/20 bg-[#15803D]/5 hover:bg-[#15803D]/10'
  },
  targetServed: {
    label: '提供中',
    badgeClassName: 'border-[#2563EB]/20 bg-[#2563EB]/5 text-[#2563EB]',
    headerClassName: 'border-[#2563EB]/20 bg-[#2563EB]/5 hover:bg-[#2563EB]/10'
  },
  waitingComplete: {
    label: '完了待機',
    badgeClassName: 'border-gray-300 bg-gray-200 text-gray-600',
    headerClassName: 'border-gray-200 bg-gray-50 hover:bg-gray-100'
  },
  allServed: {
    label: '全て完了',
    badgeClassName: 'border-gray-700 bg-gray-700 text-white',
    headerClassName: 'border-gray-300 bg-gray-100 hover:bg-gray-200'
  },
  completed: {
    label: '完了',
    badgeClassName: 'border-gray-300 bg-gray-200 text-gray-600',
    headerClassName: 'border-gray-200 bg-gray-50 hover:bg-gray-100'
  }
};

const getNextKitchenStatus = (currentStatus) => {
  if (currentStatus === 'pending') return 'cooking';
  if (currentStatus === 'cooking') return 'prepared';
  if (currentStatus === 'prepared') return 'served';
  return 'pending';
};

const getServiceTimingBadgeClassName = (serviceTiming) => {
  if (serviceTiming === 'before_meal') {
    return 'border-amber-400 bg-amber-100 text-amber-900'; // 食前=急ぎめ
  }

  if (serviceTiming === 'after_meal') {
    return 'border-[#15803D]/20 bg-[#15803D]/5 text-[#15803D]';
  }

  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const OrderCard = ({
  order,
  currentTime,
  viewMode,
  activeKitchenId,
  menuItemLookup,
  updateStatus,
  updateOrderItems,
  updateOrderMeta,
  isSummarySelectMode = false,
  isSelectedForSummary = false,
  onToggleSummarySelect
}) => {
  const elapsed = getElapsedTime(order.timestamp, currentTime);
  const elapsedLevel = getElapsedLevel(elapsed);
  const isLate = elapsedLevel.level === 'danger' && viewMode === 'active';

  const displayItems = processDisplayItems(order.items, activeKitchenId, menuItemLookup);
  const matchedItems = displayItems.filter((item) => item.isMatched);
  const displayQuantity = displayItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const matchedQuantity = matchedItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const partySize = Number(
    order?.partySize
    || order?.guestCount
    || order?.peopleCount
    || order?.sessionPartySize
    || 0
  );
  const pendingItems = matchedItems.filter((item) => resolveKitchenStatus(item) === 'pending').length;

  const orderKitchenStatus = resolveDisplayKitchenStatus({
    order,
    activeKitchenId,
    displayItems
  });

  const orderStatusMeta = ORDER_STATUS_META[orderKitchenStatus] || ORDER_STATUS_META.pending;
  const shouldShowHeaderAlerts = orderKitchenStatus !== 'allServed';

  const targetItems = activeKitchenId === 'all' ? displayItems : matchedItems;

  const hasTargetItemProgress = targetItems.some((item) => {
    const status = resolveKitchenStatus(item);
    return status === 'cooking' || status === 'prepared' || status === 'served';
  });

  const hasTargetCookingItems = targetItems.some((item) => (
    resolveKitchenStatus(item) === 'cooking'
  ));

const canShowStartCookingButton =
  viewMode === 'active' &&
  orderKitchenStatus === 'pending' &&
  !hasTargetCookingItems;

const canShowMarkPreparedButton =
  viewMode === 'active' &&
  hasTargetCookingItems;

const canSelectCard =
  viewMode === 'active' &&
  (orderKitchenStatus === 'pending' || hasTargetCookingItems || canShowMarkPreparedButton);

  const elapsedCardClassName =
    viewMode === 'active' && elapsedLevel.level === 'danger'
      ? 'ring-4 ring-amber-600/60' // 遅れ=濃いアンバー(赤は呼び出しだけ)
      : viewMode === 'active' && elapsedLevel.level === 'warning'
        ? 'ring-2 ring-amber-400/35'
        : '';

  const elapsedBadgeClassName =
    viewMode === 'active'
      ? elapsedLevel.badgeClass
      : 'bg-gray-100 text-gray-500';

  const sortedDisplayItems = useMemo(() => {
    return [...displayItems].sort((left, right) => {
      if (left.isMatched !== right.isMatched) return left.isMatched ? -1 : 1;
      return left.sourceIndex - right.sourceIndex;
    });
  }, [displayItems]);

  const otherKitchenItems = activeKitchenId === 'all'
    ? []
    : displayItems.filter((item) => !item.isMatched);

  const hasOtherKitchenItems = otherKitchenItems.length > 0;

  const allOtherKitchenItemsServed = hasOtherKitchenItems && otherKitchenItems.every((item) => (
    resolveKitchenStatus(item) === 'served'
  ));

  const firstOtherKitchenItemIndex = sortedDisplayItems.findIndex((item) => (
    activeKitchenId !== 'all' && !item.isMatched
  ));

  if (activeKitchenId !== 'all' && displayItems.every((item) => !item.isMatched)) {
    return null;
  }

  let priority = {
    label: '通常',
    icon: Timer,
    chipClassName: 'border border-[#2563EB]/10 bg-[#2563EB]/5 text-[#2563EB]'
  };

  if (viewMode === 'active') {
    if (elapsed >= 12 || matchedQuantity >= 5 || pendingItems >= 4) {
      priority = {
        label: '最優先',
        icon: AlertTriangle,
        chipClassName: 'border border-amber-500 bg-amber-500 text-white'
      };
    } else if (elapsed >= 8 || matchedQuantity >= 3 || pendingItems >= 2) {
      priority = {
        label: '優先',
        icon: AlertTriangle,
        chipClassName: 'border border-amber-200 bg-amber-50 text-amber-700'
      };
    }
  }

  const PriorityIcon = priority.icon;

  const togglePrepared = (sourceIndex) => {
    if (!updateOrderItems || viewMode !== 'active') return;

    const nextItems = (order.items || []).map((sourceItem, index) => {
      if (index !== sourceIndex) return sourceItem;

      const currentStatus = resolveKitchenStatus(sourceItem);
      const nextStatus = getNextKitchenStatus(currentStatus);

      return {
        ...sourceItem,
        kitchenStatus: nextStatus,
        isPrepared: nextStatus !== 'pending'
      };
    });

    const targetItemsAfterUpdate = nextItems.filter((item) => {
      if (activeKitchenId === 'all') return true;

      const lookupId = item.menuId || item.id;
      const masterItem = menuItemLookup?.[lookupId] || {};
      const targetKitchenIds = masterItem.kitchenIds || (
        masterItem.kitchenId ? [masterItem.kitchenId] : []
      );

      return targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));
    });

    const allTargetPrepared = targetItemsAfterUpdate.length > 0 && targetItemsAfterUpdate.every((item) => {
      const status = resolveKitchenStatus(item);
      return status === 'prepared' || status === 'served';
    });

    const nextStatus = allTargetPrepared ? 'serving' : 'cooking';

    updateOrderItems(order.id, nextItems, nextStatus);

    if (typeof updateOrderMeta === 'function') {
      updateOrderMeta(order.id, {
        movedToBackKitchenIds: removeCurrentKitchenFromMovedBack()
      });
    }
  };

  const startCooking = () => {
    if (!updateOrderItems || viewMode !== 'active') return;

    const startedAtMs = Date.now();

    const nextItems = (order.items || []).map((item) => {
      const lookupId = item.menuId || item.id;
      const masterItem = menuItemLookup?.[lookupId] || {};
      const targetKitchenIds = masterItem.kitchenIds || (
        masterItem.kitchenId ? [masterItem.kitchenId] : []
      );

      const isTargetItem =
        activeKitchenId === 'all' ||
        targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

      if (!isTargetItem) {
        return item;
      }

      const currentStatus = resolveKitchenStatus(item);

      if (currentStatus !== 'pending') {
        return item;
      }

      return {
        ...item,
        kitchenStatus: 'cooking',
        isCooking: true,
        cookingStartedAtMs: startedAtMs
      };
    });

    updateOrderItems(order.id, nextItems, 'cooking', {
      cookingStartedAtMs: startedAtMs,
      movedToBackKitchenIds: removeCurrentKitchenFromMovedBack()
    });

    if (!isSelectedForSummary && typeof onToggleSummarySelect === 'function') {
      onToggleSummarySelect();
    }
  };

  const revertCookingToPending = () => {
    if (!updateOrderItems || viewMode !== 'active') return;

    const nextItems = (order.items || []).map((item) => {
      const lookupId = item.menuId || item.id;
      const masterItem = menuItemLookup?.[lookupId] || {};
      const targetKitchenIds = masterItem.kitchenIds || (
        masterItem.kitchenId ? [masterItem.kitchenId] : []
      );

      const isTargetItem =
        activeKitchenId === 'all' ||
        targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

      if (!isTargetItem) {
        return item;
      }

      const currentStatus = resolveKitchenStatus(item);

      // 調理完了・提供中は戻さない。cooking だけ pending に戻す。
      if (currentStatus !== 'cooking') {
        return item;
      }

      const {
        isCooking,
        cookingStartedAtMs,
        ...rest
      } = item;

      return {
        ...rest,
        kitchenStatus: 'pending'
      };
    });

    updateOrderItems(order.id, nextItems, 'pending', {
      cookingStartedAtMs: null,
      movedToBackKitchenIds: removeCurrentKitchenFromMovedBack()
    });

    if (isSelectedForSummary && typeof onToggleSummarySelect === 'function') {
      onToggleSummarySelect();
    }
  };

  const handleHeaderClick = () => {
    if (orderKitchenStatus === 'pending') {
      startCooking();
      return;
    }

    if (hasTargetCookingItems) {
      revertCookingToPending();
      return;
    }

    if (typeof onToggleSummarySelect === 'function') {
      onToggleSummarySelect();
    }
  };

  const handleStartCookingButtonClick = () => {
    startCooking();
  };

  const markAllPrepared = () => {
    if (!updateOrderItems || viewMode !== 'active') return;

    const nextItems = (order.items || []).map((item) => {
      const lookupId = item.menuId || item.id;
      const masterItem = menuItemLookup?.[lookupId] || {};
      const targetKitchenIds = masterItem.kitchenIds || (
        masterItem.kitchenId ? [masterItem.kitchenId] : []
      );

      const isTargetItem =
        activeKitchenId === 'all' ||
        targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

      if (!isTargetItem) {
        return item;
      }

      const currentStatus = resolveKitchenStatus(item);

      // 重要：提供中の商品は絶対に prepared に戻さない
      if (currentStatus === 'served') {
        return item;
      }

      return {
        ...item,
        kitchenStatus: 'prepared',
        isPrepared: true
      };
    });

    const targetItemsAfterUpdate = nextItems.filter((item) => {
      if (activeKitchenId === 'all') return true;

      const lookupId = item.menuId || item.id;
      const masterItem = menuItemLookup?.[lookupId] || {};
      const targetKitchenIds = masterItem.kitchenIds || (
        masterItem.kitchenId ? [masterItem.kitchenId] : []
      );

      return targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));
    });

    const allTargetPrepared = targetItemsAfterUpdate.length > 0 && targetItemsAfterUpdate.every((item) => {
      const status = resolveKitchenStatus(item);
      return status === 'prepared' || status === 'served';
    });

    const nextStatus = allTargetPrepared ? 'serving' : 'cooking';

    updateOrderItems(order.id, nextItems, nextStatus);
  };
  
  const markTargetServed = () => {
    if (!updateOrderItems || viewMode !== 'active') return;

    const nextItems = (order.items || []).map((item) => {
      const lookupId = item.menuId || item.id;
      const masterItem = menuItemLookup?.[lookupId] || {};
      const targetKitchenIds = masterItem.kitchenIds || (
        masterItem.kitchenId ? [masterItem.kitchenId] : []
      );

      const isTargetItem =
        activeKitchenId === 'all' ||
        targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

      if (!isTargetItem) {
        return item;
      }

      return {
        ...item,
        kitchenStatus: 'served',
        isPrepared: true
      };
    });

    updateOrderItems(order.id, nextItems, 'serving');
  };

  const removeCurrentKitchenFromMovedBack = () => {
    const moveKey = String(activeKitchenId || 'all');
    const currentIds = Array.isArray(order.movedToBackKitchenIds)
      ? order.movedToBackKitchenIds.map(String)
      : [];

    return currentIds.filter((id) => id !== moveKey);
  };

  const moveCardToBack = () => {
  if (!updateOrderMeta || viewMode !== 'active') return;

  const moveKey = String(activeKitchenId || 'all');
  const currentIds = Array.isArray(order.movedToBackKitchenIds)
    ? order.movedToBackKitchenIds.map(String)
    : [];

  const nextIds = currentIds.includes(moveKey)
    ? currentIds
    : [...currentIds, moveKey];

  updateOrderMeta(order.id, {
    movedToBackKitchenIds: nextIds
  });
};

  const cardSelectModeClassName = isSummarySelectMode
    ? 'ring-2 ring-gray-500/35'
    : '';

  const isCookingActive = hasTargetCookingItems;

  const headerClassName = isSelectedForSummary || isCookingActive
    ? 'border-[#15803D]/35 bg-[#15803D]/10 shadow-inner'
    : isSummarySelectMode
      ? 'border-gray-200 bg-gray-50 hover:bg-[#15803D]/5'
      : orderStatusMeta.headerClassName;

  const tableLabelClassName = isSelectedForSummary || isCookingActive
    ? 'text-[#15803D]'
    : 'text-gray-400';

  const tableNumberClassName = isSelectedForSummary || isCookingActive
    ? 'text-[#15803D]'
    : 'text-gray-800';

  const itemCountClassName = isSelectedForSummary
    ? 'text-[#15803D]'
    : 'text-gray-500';

  const selectedElapsedBadgeClassName =
    `${elapsedBadgeClassName} ${viewMode === 'active' ? elapsedLevel.ringClass : 'ring-gray-100'}`;

  const selectedPriorityClassName = priority.chipClassName;

  return (
    <div
      className={`flex min-w-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl transition-all duration-300 ${
        isLate ? 'scale-[1.01]' : 'hover:shadow-2xl'
      } ${elapsedCardClassName} ${cardSelectModeClassName}`}
    >

    <div
      role={canSelectCard ? 'button' : undefined}
      tabIndex={canSelectCard ? 0 : undefined}
      onClick={canSelectCard ? handleHeaderClick : undefined}
      onKeyDown={
        canSelectCard
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleHeaderClick();
              }
            }
          : undefined
      }
      className={`relative flex w-full items-stretch justify-between border-b px-5 py-4 text-left transition-all ${
        canSelectCard ? 'cursor-pointer' : 'cursor-default'
      } ${headerClassName}`}
    >
  
        <div>
          <span className={`mb-0.5 block text-[10px] font-bold ${tableLabelClassName}`}>
            テーブル
          </span>

          <div className={`text-4xl font-black leading-none tracking-tight ${tableNumberClassName}`}>
            {getTableDisplayName(order)}
          </div>

          <div className="mt-1 text-sm font-bold text-gray-400">
            {partySize > 0 ? `${partySize}名` : '人数未設定'}
          </div>
        </div>

        <div className="flex flex-col items-end justify-center gap-2">

        {shouldShowHeaderAlerts && (
          <>
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-sm font-black shadow-sm ring-1 ${
                selectedElapsedBadgeClassName
              } ${isLate && !isSelectedForSummary ? 'animate-pulse' : ''}`}
            >
              <Timer size={14} />
              <span className="tabular-nums">{elapsed}m</span>

              {viewMode === 'active' && elapsedLevel.level !== 'normal' && (
                <span className="ml-0.5 text-[10px] font-black">
                  {elapsedLevel.label}
                </span>
              )}
            </div>

            {viewMode === 'active' && (
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${selectedPriorityClassName}`}>
                <PriorityIcon size={13} />
                <span>{priority.label}</span>
              </div>
            )}
          </>
        )}
        </div>
      </div>

      <div className="custom-scrollbar min-h-[220px] flex-grow overflow-y-auto bg-gray-100/80">
        {sortedDisplayItems.map((item, index) => {
          const quantity = item.quantity || 1;
          const kitchenDisplayName = String(item.kitchenName || item.name || '未設定商品').trim();
          const kitchenStatus = resolveKitchenStatus(item);
          const isPreparedItem = kitchenStatus === 'prepared';
          const isServedItem = kitchenStatus === 'served';
          const isDoneItem = isPreparedItem || isServedItem;

          const isDimmedItem = activeKitchenId !== 'all' && !item.isMatched;
          const isOtherKitchenServedArea = isDimmedItem && allOtherKitchenItemsServed;
          const shouldShowOtherKitchenServedLabel =
            isOtherKitchenServedArea && index === firstOtherKitchenItemIndex;
          const isReadOnlyItem = viewMode !== 'active' || !(activeKitchenId === 'all' || item.isMatched);
          const canToggleItem = !isReadOnlyItem;
          const RowTag = canToggleItem ? 'button' : 'div';

          const rowPaddingClassName = isDimmedItem
            ? shouldShowOtherKitchenServedLabel
              ? 'pl-10 pr-3 pb-2 pt-2.5'
              : 'pl-10 pr-3 py-1.5'
            : 'px-5 py-3';

          const rowGapClassName = isDimmedItem ? 'gap-2' : 'gap-3';

          const rowBackgroundClassName = isOtherKitchenServedArea
            ? 'bg-[#15803D]/10'
            : isDimmedItem
              ? isServedItem
                ? 'bg-gray-100/80'
                : isPreparedItem
                  ? 'bg-[#15803D]/5'
                  : 'bg-gray-100/80'
              : isServedItem
                ? 'bg-gray-50'
                : isPreparedItem
                  ? 'bg-[#15803D]/5'
                  : 'bg-white';

          const rowBorderClassName = isOtherKitchenServedArea
            ? 'border-b border-[#15803D]/35 ring-1 ring-inset ring-[#15803D]/35'
            : isDimmedItem
              ? 'border-b border-transparent'
              : 'border-b border-gray-200/70';

          const rowInteractionClassName = canToggleItem
            ? isServedItem
              ? 'cursor-pointer hover:bg-gray-100 active:bg-gray-200/70'
              : isPreparedItem
                ? 'cursor-pointer hover:bg-[#15803D]/10 active:bg-[#15803D]/10'
                : 'cursor-pointer hover:bg-[#C2410C]/5 active:bg-[#C2410C]/10'
            : isOtherKitchenServedArea
              ? 'cursor-default'
              : 'cursor-default hover:bg-black/[0.02]';

          const itemNameClassName = isOtherKitchenServedArea
            ? 'text-xs font-black leading-tight tracking-tight text-[#15803D]'
            : isDimmedItem
              ? 'text-xs font-bold leading-tight tracking-tight text-gray-500'
              : 'text-base font-bold leading-snug tracking-tight text-gray-800';

          const itemStateNameClassName = isOtherKitchenServedArea
            ? 'text-[#15803D] line-through decoration-2 decoration-[#15803D]/70'
            : isServedItem
              ? 'text-gray-400 line-through decoration-2 decoration-gray-400'
              : isPreparedItem
                ? 'text-[#15803D]'
                : '';

          const iconSizeClassName = isDimmedItem
            ? 'h-5 w-5'
            : 'h-8 w-8';

          const iconSvgSize = isDimmedItem ? 12 : 18;

          const quantitySizeClassName = isDimmedItem
            ? 'h-5 min-w-[22px] rounded text-[10px]'
            : 'h-8 min-w-[32px] rounded-lg text-base';

          const quantityClassName = isOtherKitchenServedArea
            ? 'border border-[#15803D]/60 bg-[#15803D]/20 text-[#15803D] shadow-none'
            : isDimmedItem
              ? 'bg-transparent text-gray-400 shadow-none'
              : isServedItem
                ? 'border border-gray-300 bg-gray-100 text-gray-500 shadow-none'
                : quantity >= 4
                  ? 'border border-amber-400 bg-amber-100 text-amber-900'
                  : quantity >= 2
                    ? 'border border-[#C2410C]/35 bg-[#C2410C]/5 text-[#C2410C]'
                    : 'border border-gray-300 bg-white text-gray-900';

          const optionClassName = isDimmedItem
            ? 'rounded border px-1.5 py-0.5 text-[9px] font-bold'
            : 'rounded-md border px-2 py-0.5 text-[10px] font-bold';

          const optionContainerClassName = isDimmedItem
            ? 'mt-1 flex flex-wrap gap-1'
            : 'mt-1.5 flex flex-wrap gap-1';

          const readOnlyIconClassName = isServedItem
            ? 'border-gray-300 bg-gray-200 text-gray-500'
            : isPreparedItem
              ? 'border-[#15803D] bg-[#15803D] text-white'
              : isDimmedItem
                ? 'border-gray-300 bg-gray-100/80 text-gray-300'
                : 'border-gray-300 bg-white text-gray-400';

          const actionIconClassName = isServedItem
            ? 'border-gray-300 bg-gray-200 text-gray-500 shadow-sm'
            : isPreparedItem
              ? 'border-[#15803D] bg-[#15803D] text-white shadow-sm'
              : 'border-gray-300 bg-white text-gray-400 group-hover:border-[#C2410C]/60 group-hover:bg-[#C2410C]/5 group-hover:text-[#C2410C]';

          return (
            <RowTag
              key={`${kitchenDisplayName}-${item.sourceIndex}-${index}`}
              type={canToggleItem ? 'button' : undefined}
              onClick={canToggleItem ? () => togglePrepared(item.sourceIndex) : undefined}
              className={`group flex w-full items-center text-left ${rowGapClassName} ${rowBorderClassName} transition-all duration-300 ${
                rowInteractionClassName
              } ${rowPaddingClassName} ${rowBackgroundClassName}`}
              aria-label={
                canToggleItem
                  ? `${kitchenDisplayName} を${
                      isServedItem
                        ? '未完了'
                        : isPreparedItem
                          ? '提供中'
                          : '調理完了'
                    }にする`
                  : undefined
              }
            >
              {isReadOnlyItem ? (
                <div
                  className={`flex flex-shrink-0 items-center justify-center rounded-full border ${
                    iconSizeClassName
                  } ${readOnlyIconClassName}`}
                >
                  {isDoneItem ? (
                    <Check size={iconSvgSize} strokeWidth={3} />
                  ) : null}
                </div>
              ) : (
                <div
                  className={`flex flex-shrink-0 items-center justify-center rounded-full border transition-all ${
                    iconSizeClassName
                  } ${actionIconClassName}`}
                >
                  {isDoneItem ? (
                    <Check size={iconSvgSize} strokeWidth={3} />
                  ) : null}
                </div>
              )}

              <div className="min-w-0 flex-1">
                {shouldShowOtherKitchenServedLabel && (
                  <div className="mb-1 inline-flex rounded-full border border-[#15803D]/60 bg-[#15803D] px-2 py-0.5 text-[9px] font-black text-white shadow-sm">
                    別キッチン提供済み
                  </div>
                )}

                <div className={`${itemNameClassName} ${itemStateNameClassName}`}>
                  {kitchenDisplayName}
                </div>

                {item.serviceTimingLabel && (
                  <div className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${getServiceTimingBadgeClassName(item.serviceTiming)}`}>
                    {item.serviceTimingLabel}
                  </div>
                )}

                {item.options?.length > 0 && (
                  <div className={optionContainerClassName}>
                    {item.options.map((option, optionIndex) => (
                      <span
                        key={`${option}-${optionIndex}`}
                        className={`${optionClassName} ${
                          IMPORTANT_OPTION_PATTERN.test(option)
                            ? 'border-[#C2410C]/20 bg-[#C2410C]/10 text-[#C2410C]'
                            : 'border-gray-200 bg-gray-100 text-gray-600'
                        } ${
                          isServedItem
                            ? 'opacity-60 line-through decoration-gray-400'
                            : isPreparedItem
                              ? 'opacity-80'
                              : ''
                        }`}
                      >
                        {option}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div
                className={`${quantityClassName} ${quantitySizeClassName} flex items-center justify-center font-bold tabular-nums ${
                  isDimmedItem || isServedItem ? '' : 'shadow-sm'
                }`}
              >
                {quantity}
              </div>
            </RowTag>
          );
        })}
      </div>

    <div className="bg-gray-100/80 p-4">
      {viewMode === 'history' ? (
        <button
          type="button"
          onClick={() => updateStatus(order.id, 'serving')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3.5 font-bold text-gray-500 shadow-sm transition-colors hover:bg-gray-50"
        >
          <RotateCcw size={18} />
          提供待ちに戻す
        </button>
      ) : (
        <>
{canShowStartCookingButton && (
        <button
          type="button"
          onClick={handleStartCookingButtonClick}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#C2410C] py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
        >
          <Flame size={20} />
          調理開始
        </button>
      )}

{canShowMarkPreparedButton && (
        <button
          type="button"
          onClick={markAllPrepared}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#15803D] py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
        >
          <Check size={20} />
          全て調理完了にする
        </button>
      )}

          {orderKitchenStatus === 'serving' && (
            <button
              type="button"
              onClick={markTargetServed}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#2563EB] py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
            >
              <Check size={20} />
              提供完了
            </button>
          )}

          {orderKitchenStatus === 'waitingComplete' && (
            <div className="flex w-full flex-col items-center justify-center rounded-xl bg-gray-100 py-3.5 text-center ring-1 ring-gray-200">
              <span className="text-base font-black text-gray-600">
                完了待機
              </span>
              <span className="mt-1 text-[11px] font-bold text-gray-400">
                他の持ち場の提供完了を待っています
              </span>
            </div>
          )}

          {orderKitchenStatus === 'targetServed' && (
            <button
              type="button"
              onClick={moveCardToBack}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#2563EB] py-3.5 text-base font-bold text-white shadow-lg transition-all hover:bg-[#2563EB] active:scale-[0.98]"
            >
              <Check size={20} />
              提供中
              <span className="mx-1 h-4 w-px bg-white/30" />
              <ArrowRight size={18} strokeWidth={3} />
              後ろへ
            </button>
          )}
          
          {orderKitchenStatus === 'allServed' && (
            <button
              type="button"
              onClick={() => updateStatus(order.id, 'completed')}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gray-800 py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
            >
              <CheckCircle size={20} />
              全て完了
            </button>
          )}
        </>
      )}
    </div>
   </div>
  );
};

export default OrderCard;