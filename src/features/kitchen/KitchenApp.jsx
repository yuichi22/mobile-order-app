import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';

import { useAuth } from '../../app/providers/useAuth';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import KitchenHeader from './components/KitchenHeader';
import OrderCard from './components/OrderCard';
import KitchenSidebar from './components/KitchenSidebar';
import { useKitchenBoard } from './hooks/useKitchenBoard';
import { useStoreSettings } from '../store/hooks';
import { buildPendingItemSummary, getActiveKitchenItems, isCancelledKitchenItem, sortKitchenOrders } from './utils/kitchenUtils';


const ALERT_SOUND_URL = '/order-alert.mp3';

const AlignedHistory = ({ size, strokeWidth }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12a10 10 0 1 0 10-10 10.75 10.75 0 0 0-7.5 3.2L2 8" />
    <path d="M2 3v5h5" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const KitchenApp = ({ storeId, onBack, onSwitchToRegister, onSwitchToServe, onSwitchToSettings }) => {
  const { storeId: authStoreId, loading: authLoading } = useAuth();
  const effectiveStoreId = storeId || authStoreId;
  const kdsData = useKitchenBoard(effectiveStoreId || null);
  const { settings: storeSettings } = useStoreSettings(effectiveStoreId || null);

  const kitchenTabStorageKey = effectiveStoreId
    ? `kitchen-active-tab:${effectiveStoreId}`
    : '';

  const [viewMode, setViewMode] = useState('active');
  const [activeKitchenId, setActiveKitchenId] = useState(() => {
    try {
      if (!effectiveStoreId) return 'all';

      return window.localStorage.getItem(`kitchen-active-tab:${effectiveStoreId}`) || 'all';
    } catch {
      return 'all';
    }
  });
  const [currentTime, setCurrentTime] = useState(new Date().getTime());
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [alertVolume, setAlertVolume] = useState(() => {
    try {
      const saved = window.localStorage.getItem('kitchen-alert-volume');
      const value = Number(saved);
      return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.8;
    } catch {
      return 0.8;
    }
  });

  const [summaryMode, setSummaryMode] = useState('all');
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());

  const audioRef = useRef(new Audio(ALERT_SOUND_URL));
  const prevOrderIds = useRef(new Set());
  const isInitialSyncDone = useRef(false);
  const isReadyToPlay = useRef(false);
  const hasUserSelectedKitchenTabRef = useRef(false);
  const previousOrderIndexRef = useRef(new Map());

  useEffect(() => {
    audioRef.current.volume = alertVolume;

    try {
      window.localStorage.setItem('kitchen-alert-volume', String(alertVolume));
    } catch {
      // localStorage が使えない環境では保存しない
    }
  }, [alertVolume]);

  const playAlertPreview = () => {
    if (!audioRef.current) return;

    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current.volume = alertVolume;

    audioRef.current.play().catch(() => {
      // ブラウザ側の自動再生制限などで鳴らない場合は無視
    });
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().getTime()), 1000);
    const readyTimer = setTimeout(() => {
      isReadyToPlay.current = true;
    }, 2000);

    return () => {
      clearInterval(timer);
      clearTimeout(readyTimer);
    };
  }, []);

  useEffect(() => {
    if (!kdsData.loading && kdsData.orders && !isInitialSyncDone.current) {
      kdsData.orders.forEach((order) => prevOrderIds.current.add(order.id));
      isInitialSyncDone.current = true;
    }
  }, [kdsData.orders, kdsData.loading]);

  const availableStations = useMemo(
    () => [{ id: 'all', name: '全て表示' }, ...(kdsData.kitchens || [])],
    [kdsData.kitchens]
  );

  useEffect(() => {
    if (!kitchenTabStorageKey || availableStations.length === 0) return;
    if (hasUserSelectedKitchenTabRef.current) return;

    try {
      const savedKitchenId = window.localStorage.getItem(kitchenTabStorageKey);
      if (!savedKitchenId) return;

      const exists = availableStations.some(
        (station) => String(station.id) === String(savedKitchenId)
      );

      if (exists && String(activeKitchenId) !== String(savedKitchenId)) {
        setActiveKitchenId(savedKitchenId);
      }
    } catch {
      // localStorage が使えない環境では復元しない
    }
  }, [activeKitchenId, availableStations, kitchenTabStorageKey]);

  const currentStation = useMemo(
    () => availableStations.find((station) => String(station.id) === String(activeKitchenId)) || availableStations[0],
    [activeKitchenId, availableStations]
  );

  const sidebarPosition = activeKitchenId === 'all'
  ? 'right'
  : currentStation?.sidebarPosition || 'left';

  const clearSelectedOrders = () => {
    setSelectedOrderIds(new Set());
  };

  const handleKitchenTabChange = (nextKitchenId) => {
    hasUserSelectedKitchenTabRef.current = true;

    setActiveKitchenId(nextKitchenId);
    setSummaryMode('all');
    clearSelectedOrders();

    if (!kitchenTabStorageKey) return;

    try {
      window.localStorage.setItem(kitchenTabStorageKey, String(nextKitchenId));
    } catch {
      // localStorage が使えない環境では保存しない
    }
  };

  const handleSummaryModeChange = (nextMode) => {
    setSummaryMode(nextMode);

    if (nextMode === 'all') {
      clearSelectedOrders();
    }
  };

  const handleViewModeChange = (nextViewMode) => {
    setViewMode(nextViewMode);
    setSummaryMode('all');
    clearSelectedOrders();
  };

  const toggleStation = () => {
    const currentIndex = availableStations.findIndex(
      (station) => String(station.id) === String(activeKitchenId)
    );
    const nextIndex = (currentIndex + 1) % availableStations.length;
    handleKitchenTabChange(availableStations[nextIndex].id);
  };

  const filteredOrders = useMemo(() => {
    const source = viewMode === 'active' ? kdsData.orders : kdsData.completedOrders;
    if (!source) return [];
    if (activeKitchenId === 'all') return source;

    return source.filter((order) =>
      order.items?.some((item) => {
        const lookupId = item.menuId || item.id;
        const masterItem = kdsData.menuItemLookup[lookupId] || {};
        const targetKitchenIds = masterItem.kitchenIds || (masterItem.kitchenId ? [masterItem.kitchenId] : []);

        return targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));
      })
    );
  }, [
    viewMode,
    kdsData.orders,
    kdsData.completedOrders,
    activeKitchenId,
    kdsData.menuItemLookup
  ]);

    const getOrderDisplayStatusRank = (order) => {
      const items = getActiveKitchenItems(order?.items);

      const resolveItemStatus = (item) => {
        if (item?.kitchenStatus === 'served') return 'served';
        if (item?.kitchenStatus === 'prepared' || item?.isPrepared) return 'prepared';
        return 'pending';
      };

      const targetItems = items.filter((item) => {
        if (activeKitchenId === 'all') return true;

        const lookupId = item.menuId || item.id;
        const masterItem = kdsData.menuItemLookup?.[lookupId] || {};
        const targetKitchenIds = masterItem.kitchenIds || (
          masterItem.kitchenId ? [masterItem.kitchenId] : []
        );

        return targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));
      });

      if (targetItems.length === 0) return 99;

      const moveKey = String(activeKitchenId || 'all');
      const movedToBackKitchenIds = Array.isArray(order?.movedToBackKitchenIds)
        ? order.movedToBackKitchenIds.map(String)
        : [];
      const isMovedToBack = movedToBackKitchenIds.includes(moveKey);

      const allPrepared = targetItems.every((item) => {
        const status = resolveItemStatus(item);
        return status === 'prepared' || status === 'served';
      });

      const allServed = targetItems.every((item) => resolveItemStatus(item) === 'served');

      const allOrderServed = items.length > 0 && items.every((item) => (
        resolveItemStatus(item) === 'served'
      ));

      if (allPrepared && !allServed) return 0; // 提供待ち
      if (allServed && !isMovedToBack) return 0; // 提供済み・後ろへ移動前：まだ残す
      if (order.status === 'cooking' && !allPrepared) return 1; // 調理中
      if (!allPrepared) return 2; // 未着手
      if (allServed && isMovedToBack && !allOrderServed) return 4; // 完了待機
      if (allOrderServed && isMovedToBack) return 5; // 全て完了

      return 6;
    };

    const sortedOrders = useMemo(() => {
      const baseSorted = sortKitchenOrders(
        filteredOrders,
        'oldest',
        currentTime,
        activeKitchenId,
        kdsData.menuItemLookup
      );

      const previousOrderIndex = previousOrderIndexRef.current;

      return [...baseSorted]
        .map((order, fallbackIndex) => ({
          order,
          fallbackIndex,
          previousIndex: previousOrderIndex.has(order.id)
            ? previousOrderIndex.get(order.id)
            : fallbackIndex
        }))
        .sort((leftEntry, rightEntry) => {
          const left = leftEntry.order;
          const right = rightEntry.order;

          const leftRank = getOrderDisplayStatusRank(left);
          const rightRank = getOrderDisplayStatusRank(right);

          if (leftRank !== rightRank) return leftRank - rightRank;

          if (leftEntry.previousIndex !== rightEntry.previousIndex) {
            return leftEntry.previousIndex - rightEntry.previousIndex;
          }

          return leftEntry.fallbackIndex - rightEntry.fallbackIndex;
        })
        .map((entry) => entry.order);
    }, [
      filteredOrders,
      currentTime,
      activeKitchenId,
      kdsData.menuItemLookup
    ]);

    const completedReadyOrders = useMemo(() => {
      const resolveItemStatus = (item) => {
        if (item?.kitchenStatus === 'served') return 'served';
        if (item?.kitchenStatus === 'prepared' || item?.isPrepared) return 'prepared';
        return 'pending';
      };

      return sortedOrders.filter((order) => {
        const items = Array.isArray(order?.items) ? order.items : [];
        if (items.length === 0) return false;

        return items.every((item) => resolveItemStatus(item) === 'served');
      });
    }, [sortedOrders]);


    useEffect(() => {
      previousOrderIndexRef.current = new Map(
        sortedOrders.map((order, index) => [order.id, index])
      );
    }, [sortedOrders]);

  const visibleSelectedOrderIds = useMemo(() => {
    const visibleIds = new Set(sortedOrders.map((order) => order.id));
    const next = new Set();

    selectedOrderIds.forEach((orderId) => {
      if (visibleIds.has(orderId)) {
        next.add(orderId);
      }
    });

    return next;
  }, [selectedOrderIds, sortedOrders]);

  useEffect(() => {
    if (selectedOrderIds.size === visibleSelectedOrderIds.size) return;

    setSelectedOrderIds(visibleSelectedOrderIds);
  }, [selectedOrderIds.size, visibleSelectedOrderIds]);

  const selectedOrdersForSummary = useMemo(() => {
    if (summaryMode !== 'selected') return sortedOrders;
    if (visibleSelectedOrderIds.size === 0) return [];

    return sortedOrders.filter((order) => visibleSelectedOrderIds.has(order.id));
  }, [sortedOrders, summaryMode, visibleSelectedOrderIds]);

  const pendingItemSummary = useMemo(
    () => buildPendingItemSummary(
      selectedOrdersForSummary,
      activeKitchenId,
      kdsData.menuItemLookup,
      kdsData.cookingCategories
    ),
    [
      selectedOrdersForSummary,
      activeKitchenId,
      kdsData.menuItemLookup,
      kdsData.cookingCategories
    ]
  );

  const toggleSelectedOrder = (orderId) => {
    setSummaryMode('selected');

    setSelectedOrderIds((previous) => {
      const next = new Set(previous);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  };

  const handleMarkSelectedOrdersReady = async () => {
    const selectedIds = Array.from(visibleSelectedOrderIds);
    if (selectedIds.length === 0) return;

    await Promise.all(
      sortedOrders
        .filter((order) => selectedIds.includes(order.id))
        .map((order) => {
            const nextItems = (order.items || []).map((item) => {
              if (isCancelledKitchenItem(item)) {
                return item;
              }

              const lookupId = item.menuId || item.id;
              const masterItem = kdsData.menuItemLookup?.[lookupId] || {};
              const targetKitchenIds = masterItem.kitchenIds || (
                masterItem.kitchenId ? [masterItem.kitchenId] : []
              );

              const isTargetItem =
                activeKitchenId === 'all' ||
                targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

              if (!isTargetItem) {
                return item;
              }

              const currentStatus = item?.kitchenStatus === 'served'
                ? 'served'
                : item?.kitchenStatus === 'prepared' || item?.isPrepared
                  ? 'prepared'
                  : 'pending';

              // 重要：提供済みの商品は復活させない
              if (currentStatus === 'served') {
                return item;
              }

              return {
                ...item,
                kitchenStatus: 'prepared',
                isPrepared: true
              };
            });

          const nextActiveItems = getActiveKitchenItems(nextItems);

          const allPrepared = nextActiveItems.length > 0 && nextActiveItems.every((item) => {
            const status = item?.kitchenStatus === 'served'
              ? 'served'
              : item?.kitchenStatus === 'prepared' || item?.isPrepared
                ? 'prepared'
                : 'pending';

            return status === 'prepared' || status === 'served';
          });

          const allServed = nextActiveItems.length > 0 && nextActiveItems.every((item) => (
            item?.kitchenStatus === 'served'
          ));

          const nextStatus = allServed
            ? 'serving'
            : allPrepared
              ? 'serving'
              : 'cooking';

          return kdsData.updateOrderItems(order.id, nextItems, nextStatus);
        })
    );

    setSummaryMode('all');
    clearSelectedOrders();
  };

  const handleMarkSummaryItemReady = async (summaryItem) => {
    if (!summaryItem) return;

    const targetMenuId = String(summaryItem.id || '');
    const targetName = String(summaryItem.name || '');

    const sourceOrders = summaryMode === 'selected'
      ? selectedOrdersForSummary
      : sortedOrders;

    const targetOrders = sourceOrders.filter((order) => {
      const items = Array.isArray(order?.items) ? order.items : [];

      return items.some((item) => {
        const lookupId = String(item.menuId || item.id || '');
        const itemName = String(item.name || '');

        const masterItem = kdsData.menuItemLookup?.[lookupId] || {};
        const targetKitchenIds = masterItem.kitchenIds || (
          masterItem.kitchenId ? [masterItem.kitchenId] : []
        );

        const isTargetKitchen =
          activeKitchenId === 'all' ||
          targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

        const currentStatus = item?.kitchenStatus === 'served'
          ? 'served'
          : item?.kitchenStatus === 'prepared' || item?.isPrepared
            ? 'prepared'
            : 'pending';

        const isTargetItem =
          (targetMenuId && lookupId === targetMenuId) ||
          (!targetMenuId && itemName === targetName) ||
          itemName === targetName;

        return isTargetKitchen && isTargetItem && currentStatus === 'pending';
      });
    });

    if (targetOrders.length === 0) return;

    await Promise.all(
      targetOrders.map((order) => {
        const nextItems = (order.items || []).map((item) => {
          if (isCancelledKitchenItem(item)) {
            return item;
          }

          const lookupId = String(item.menuId || item.id || '');
          const itemName = String(item.name || '');

          const masterItem = kdsData.menuItemLookup?.[lookupId] || {};
          const targetKitchenIds = masterItem.kitchenIds || (
            masterItem.kitchenId ? [masterItem.kitchenId] : []
          );

          const isTargetKitchen =
            activeKitchenId === 'all' ||
            targetKitchenIds.some((kitchenId) => String(kitchenId) === String(activeKitchenId));

          const currentStatus = item?.kitchenStatus === 'served'
            ? 'served'
            : item?.kitchenStatus === 'prepared' || item?.isPrepared
              ? 'prepared'
              : 'pending';

          const isTargetItem =
            (targetMenuId && lookupId === targetMenuId) ||
            (!targetMenuId && itemName === targetName) ||
            itemName === targetName;

          if (!isTargetKitchen || !isTargetItem || currentStatus !== 'pending') {
            return item;
          }

          return {
            ...item,
            kitchenStatus: 'prepared',
            isPrepared: true
          };
        });

        const nextActiveItems = getActiveKitchenItems(nextItems);

        const allPrepared = nextActiveItems.length > 0 && nextActiveItems.every((item) => {
          const status = item?.kitchenStatus === 'served'
            ? 'served'
            : item?.kitchenStatus === 'prepared' || item?.isPrepared
              ? 'prepared'
              : 'pending';

          return status === 'prepared' || status === 'served';
        });

        const allServed = nextActiveItems.length > 0 && nextActiveItems.every((item) => (
          item?.kitchenStatus === 'served'
        ));

        const nextStatus = allServed
          ? 'serving'
          : allPrepared
            ? 'serving'
            : 'cooking';

        return kdsData.updateOrderItems(order.id, nextItems, nextStatus);
      })
    );
  };

  const handleClearCompletedOrders = async () => {
    if (completedReadyOrders.length === 0) return;

    await Promise.all(
      completedReadyOrders.map((order) => (
        kdsData.updateOrderStatus(order.id, 'completed')
      ))
    );
  };

  useEffect(() => {
    if (
      !isReadyToPlay.current
      || !isSoundEnabled
      || viewMode !== 'active'
      || !isInitialSyncDone.current
    ) {
      return;
    }

    const newOrderIds = filteredOrders
      .map((order) => order.id)
      .filter((id) => !prevOrderIds.current.has(id));

    if (newOrderIds.length > 0) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.volume = alertVolume;
      audioRef.current.play().catch(() => {
        // ユーザー操作前の再生失敗は無視する。
      });

      newOrderIds.forEach((id) => prevOrderIds.current.add(id));
    }
  }, [filteredOrders, isSoundEnabled, viewMode, alertVolume]);

  if (authLoading || !effectiveStoreId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-900 font-sans text-gray-100">
      <KitchenHeader
        currentTime={currentTime}
        viewMode={viewMode}
        setViewMode={handleViewModeChange}
        availableStations={availableStations}
        activeKitchenId={activeKitchenId}
        setActiveKitchenId={handleKitchenTabChange}
        onBack={onBack}
        onSwitchToRegister={onSwitchToRegister}
        onSwitchToSettings={onSwitchToSettings}
        activeOrderCount={Array.isArray(kdsData.orders) ? kdsData.orders.length : 0}
        soldOutCount={Array.isArray(kdsData.soldOutItems) ? kdsData.soldOutItems.length : 0}
        isSoundEnabled={isSoundEnabled}
        setIsSoundEnabled={setIsSoundEnabled}
        alertVolume={alertVolume}
        setAlertVolume={setAlertVolume}
        onPlayAlertPreview={playAlertPreview}
        logoUrl={storeSettings?.customerLogoUrl}
        storeName={storeSettings?.name}
      />

      <div
        className={`flex min-h-0 flex-grow overflow-hidden ${
          sidebarPosition === 'left' ? 'flex-row-reverse' : 'flex-row'
        } ${viewMode === 'history' ? 'bg-slate-800' : ''}`}
      >
        <div className="flex min-h-0 flex-grow flex-col overflow-hidden">
          <div className="custom-scrollbar min-h-0 flex-grow overflow-y-auto overflow-x-hidden p-6">
            {sortedOrders.length === 0 ? (
              <div className="flex h-full w-full flex-col items-center justify-center text-center text-slate-600 opacity-50">
                <div className="mb-6 flex h-[100px] w-[100px] items-center justify-center">
                  {viewMode === 'active' ? (
                    <CheckCircle size={100} strokeWidth={1} />
                  ) : (
                    <AlignedHistory size={100} strokeWidth={1} />
                  )}
                </div>

                <p className="text-2xl font-bold tracking-tight">
                  {activeKitchenId === 'all'
                    ? viewMode === 'active'
                      ? 'オーダーはありません'
                      : '履歴はありません'
                    : `${currentStation.name} のオーダーはありません`}
                </p>
              </div>
            ) : (
              <motion.div
                layout
                className="grid auto-rows-max grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-5"
              >
                <AnimatePresence initial={false}>
                  {sortedOrders.map((order) => (
                    <motion.div
                      key={order.id}
                      layout
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{
                        layout: {
                          type: 'spring',
                          stiffness: 420,
                          damping: 34
                        },
                        opacity: {
                          duration: 0.16
                        },
                        scale: {
                          duration: 0.16
                        }
                      }}
                    >
                      <OrderCard
                        order={order}
                        currentTime={currentTime}
                        viewMode={viewMode}
                        activeKitchenId={activeKitchenId}
                        menuItemLookup={kdsData.menuItemLookup}
                        updateStatus={kdsData.updateOrderStatus}
                        updateOrderItems={kdsData.updateOrderItems}
                        updateOrderMeta={kdsData.updateOrderMeta}
                        isSummarySelectMode={summaryMode === 'selected'}
                        isSelectedForSummary={visibleSelectedOrderIds.has(order.id)}
                        onToggleSummarySelect={() => toggleSelectedOrder(order.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </div>

        <KitchenSidebar
          calls={kdsData.calls}
          checks={kdsData.checks}
          soldOutItems={kdsData.soldOutItems}
          pendingItemSummary={pendingItemSummary}
          summaryMode={summaryMode}
          selectedOrderCount={visibleSelectedOrderIds.size}
          completedReadyCount={completedReadyOrders.length}
          onSummaryModeChange={handleSummaryModeChange}
          onClearSelectedOrders={clearSelectedOrders}
          onMarkSelectedOrdersReady={handleMarkSelectedOrdersReady}
          onMarkSummaryItemReady={handleMarkSummaryItemReady}
          onClearCompletedOrders={handleClearCompletedOrders}
          onComplete={kdsData.completeRequest}
          onRestore={kdsData.restoreStock}
        />
      </div>
    </div>
  );
};

export default KitchenApp;