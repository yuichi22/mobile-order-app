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

  if (order?.status === 'cooking') return 'cooking';

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
  if (order?.status === 'cooking') return 'cooking';

  return 'pending';
};

const ORDER_STATUS_META = {
  pending: {
    label: '未着手',
    badgeClassName: 'border-orange-200 bg-orange-50 text-orange-700',
    headerClassName: 'border-orange-100 bg-orange-50/70 hover:bg-orange-50'
  },
  cooking: {
    label: '調理中',
    badgeClassName: 'border-orange-500 bg-orange-500 text-white',
    headerClassName: 'border-orange-200 bg-orange-50 hover:bg-orange-100/70'
  },
  serving: {
    label: '提供待ち',
    badgeClassName: 'border-emerald-500 bg-emerald-500 text-white',
    headerClassName: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100/70'
  },
  targetServed: {
    label: '提供済み',
    badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700',
    headerClassName: 'border-blue-200 bg-blue-50 hover:bg-blue-100/70'
  },
  waitingComplete: {
    label: '完了待機',
    badgeClassName: 'border-slate-300 bg-slate-200 text-slate-600',
    headerClassName: 'border-slate-200 bg-slate-50 hover:bg-slate-100'
  },
  allServed: {
    label: '全て完了',
    badgeClassName: 'border-slate-700 bg-slate-700 text-white',
    headerClassName: 'border-slate-300 bg-slate-100 hover:bg-slate-200'
  },
  completed: {
    label: '完了',
    badgeClassName: 'border-slate-300 bg-slate-200 text-slate-600',
    headerClassName: 'border-slate-200 bg-slate-50 hover:bg-slate-100'
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
    return 'border-red-200 bg-red-50 text-red-700';
  }

  if (serviceTiming === 'after_meal') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
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
    return status === 'prepared' || status === 'served';
  });

const canShowStartCookingButton =
  (orderKitchenStatus === 'pending' && !isSelectedForSummary) ||
  (orderKitchenStatus === 'cooking' && !isSelectedForSummary && !hasTargetItemProgress);

const canShowMarkPreparedButton =
  (orderKitchenStatus === 'pending' && isSelectedForSummary) ||
  (orderKitchenStatus === 'cooking' && (isSelectedForSummary || hasTargetItemProgress));

const canSelectCard =
  viewMode === 'active' &&
  (canShowStartCookingButton || canShowMarkPreparedButton);

  const elapsedCardClassName =
    viewMode === 'active' && elapsedLevel.level === 'danger'
      ? 'ring-4 ring-red-500/45'
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

  if (activeKitchenId !== 'all' && displayItems.every((item) => !item.isMatched)) {
    return null;
  }

  let priority = {
    label: '通常',
    icon: Timer,
    chipClassName: 'border border-blue-100 bg-blue-50 text-blue-700'
  };

  if (viewMode === 'active') {
    if (elapsed >= 12 || matchedQuantity >= 5 || pendingItems >= 4) {
      priority = {
        label: '最優先',
        icon: AlertTriangle,
        chipClassName: 'border border-red-200 bg-red-50 text-red-600'
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
  };

  const handleStartCookingOrSelectCard = () => {
    if (canShowStartCookingButton) {
      startCooking();
      return;
    }

    if (typeof onToggleSummarySelect === 'function') {
      onToggleSummarySelect();
    }
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

      // 重要：提供済みの商品は絶対に prepared に戻さない
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
    ? 'ring-2 ring-slate-500/35'
    : '';

  const headerClassName = isSelectedForSummary
    ? 'border-green-300 bg-green-100 shadow-inner'
    : isSummarySelectMode
      ? 'border-slate-200 bg-slate-50 hover:bg-green-50/80'
      : orderStatusMeta.headerClassName;

  const tableLabelClassName = isSelectedForSummary
    ? 'text-green-700'
    : 'text-gray-400';

  const tableNumberClassName = isSelectedForSummary
    ? 'text-green-950'
    : 'text-gray-800';

  const itemCountClassName = isSelectedForSummary
    ? 'text-green-800'
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
      onClick={canSelectCard ? handleStartCookingOrSelectCard : undefined}
      onKeyDown={
        canSelectCard
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleStartCookingOrSelectCard();
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

          <div className="mt-1 text-sm font-bold text-slate-400">
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

      <div className="custom-scrollbar min-h-[220px] flex-grow overflow-y-auto bg-slate-100/80">
        {sortedDisplayItems.map((item, index) => {
          const quantity = item.quantity || 1;
          const kitchenDisplayName = String(item.kitchenName || item.name || '未設定商品').trim();
          const kitchenStatus = resolveKitchenStatus(item);
          const isPreparedItem = kitchenStatus === 'prepared';
          const isServedItem = kitchenStatus === 'served';
          const isDoneItem = isPreparedItem || isServedItem;

          const isDimmedItem = activeKitchenId !== 'all' && !item.isMatched;
          const isReadOnlyItem = viewMode !== 'active' || !(activeKitchenId === 'all' || item.isMatched);
          const canToggleItem = !isReadOnlyItem;
          const RowTag = canToggleItem ? 'button' : 'div';

          const rowPaddingClassName = isDimmedItem
            ? 'pl-10 pr-3 py-1.5'
            : 'px-5 py-3';

          const rowGapClassName = isDimmedItem ? 'gap-2' : 'gap-3';

          const rowBackgroundClassName = isDimmedItem
            ? isServedItem
              ? 'bg-slate-100/80'
              : isPreparedItem
                ? 'bg-emerald-50/70'
                : 'bg-slate-100/80'
            : isServedItem
              ? 'bg-slate-50'
              : isPreparedItem
                ? 'bg-green-50/60'
                : 'bg-white';

          const rowBorderClassName = isDimmedItem
            ? 'border-b border-transparent'
            : 'border-b border-slate-200/70';

          const rowInteractionClassName = canToggleItem
            ? isServedItem
              ? 'cursor-pointer hover:bg-slate-100 active:bg-slate-200/70'
              : isPreparedItem
                ? 'cursor-pointer hover:bg-green-100/70 active:bg-green-100'
                : 'cursor-pointer hover:bg-orange-50/50 active:bg-orange-100/60'
            : 'cursor-default hover:bg-black/[0.02]';

          const itemNameClassName = isDimmedItem
            ? 'text-xs font-bold leading-tight tracking-tight text-gray-500'
            : 'text-base font-bold leading-snug tracking-tight text-gray-800';

          const itemStateNameClassName = isServedItem
            ? 'text-slate-400 line-through decoration-2 decoration-slate-400'
            : isPreparedItem
              ? 'text-green-700'
              : '';

          const iconSizeClassName = isDimmedItem
            ? 'h-5 w-5'
            : 'h-8 w-8';

          const iconSvgSize = isDimmedItem ? 12 : 18;

          const quantitySizeClassName = isDimmedItem
            ? 'h-5 min-w-[22px] rounded text-[10px]'
            : 'h-8 min-w-[32px] rounded-lg text-base';

          const quantityClassName = isDimmedItem
            ? 'bg-transparent text-gray-400 shadow-none'
            : isServedItem
              ? 'border border-slate-300 bg-slate-100 text-slate-500 shadow-none'
              : quantity >= 4
                ? 'border border-red-300 bg-red-50 text-red-700'
                : quantity >= 2
                  ? 'border border-orange-300 bg-orange-50 text-orange-700'
                  : 'border border-slate-300 bg-white text-slate-900';

          const optionClassName = isDimmedItem
            ? 'rounded border px-1.5 py-0.5 text-[9px] font-bold'
            : 'rounded-md border px-2 py-0.5 text-[10px] font-bold';

          const optionContainerClassName = isDimmedItem
            ? 'mt-1 flex flex-wrap gap-1'
            : 'mt-1.5 flex flex-wrap gap-1';

          const readOnlyIconClassName = isServedItem
            ? 'border-slate-300 bg-slate-200 text-slate-500'
            : isPreparedItem
              ? 'border-green-500 bg-green-500 text-white'
              : isDimmedItem
                ? 'border-slate-300 bg-slate-100/80 text-slate-300'
                : 'border-slate-300 bg-white text-slate-400';

          const actionIconClassName = isServedItem
            ? 'border-slate-300 bg-slate-200 text-slate-500 shadow-sm'
            : isPreparedItem
              ? 'border-green-500 bg-green-500 text-white shadow-sm'
              : 'border-slate-300 bg-white text-slate-400 group-hover:border-orange-400 group-hover:bg-orange-50 group-hover:text-orange-500';

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
                          ? '提供済み'
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
                            ? 'border-orange-200 bg-orange-100 text-orange-800'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        } ${
                          isServedItem
                            ? 'opacity-60 line-through decoration-slate-400'
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

    <div className="bg-slate-100/80 p-4">
      {viewMode === 'history' ? (
        <button
          type="button"
          onClick={() => updateStatus(order.id, 'serving')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3.5 font-bold text-slate-500 shadow-sm transition-colors hover:bg-slate-50"
        >
          <RotateCcw size={18} />
          提供待ちに戻す
        </button>
      ) : (
        <>
{canShowStartCookingButton && (
        <button
          type="button"
          onClick={handleStartCookingOrSelectCard}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-orange-500 py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
        >
          <Flame size={20} />
          調理開始
        </button>
      )}

{canShowMarkPreparedButton && (
        <button
          type="button"
          onClick={markAllPrepared}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
        >
          <Check size={20} />
          全て調理完了にする
        </button>
      )}

          {orderKitchenStatus === 'serving' && (
            <button
              type="button"
              onClick={markTargetServed}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
            >
              <Check size={20} />
              提供完了
            </button>
          )}

          {orderKitchenStatus === 'waitingComplete' && (
            <div className="flex w-full flex-col items-center justify-center rounded-xl bg-slate-100 py-3.5 text-center ring-1 ring-slate-200">
              <span className="text-base font-black text-slate-600">
                完了待機
              </span>
              <span className="mt-1 text-[11px] font-bold text-slate-400">
                他の持ち場の提供完了を待っています
              </span>
            </div>
          )}

          {orderKitchenStatus === 'targetServed' && (
            <button
              type="button"
              onClick={moveCardToBack}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-[0.98]"
            >
              <Check size={20} />
              提供済み
              <span className="mx-1 h-4 w-px bg-white/30" />
              <ArrowRight size={18} strokeWidth={3} />
              後ろへ
            </button>
          )}
          
          {orderKitchenStatus === 'allServed' && (
            <button
              type="button"
              onClick={() => updateStatus(order.id, 'completed')}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-slate-800 py-3.5 text-base font-bold text-white shadow-lg transition-all active:scale-[0.98]"
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