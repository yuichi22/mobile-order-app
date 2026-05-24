import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  RefreshCcw,
  Utensils
} from 'lucide-react';

import { useAuth } from '../../app/providers/useAuth';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { getTableDisplayName } from '../../shared/utils/tableDisplay';
import { useKitchenBoard } from '../kitchen/hooks/useKitchenBoard';
import { useStoreSettings } from '../store/hooks';

const getServiceTimingBadgeClassName = (serviceTiming) => {
  if (serviceTiming === 'before_meal') {
    return 'border-red-200 bg-red-50 text-red-700';
  }

  if (serviceTiming === 'after_meal') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const resolveKitchenStatus = (item) => {
  if (item?.kitchenStatus === 'served') return 'served';
  if (item?.kitchenStatus === 'prepared' || item?.isPrepared) return 'prepared';
  return 'pending';
};

const getTargetKitchenIds = (item, menuItemLookup = {}) => {
  const lookupId = item?.menuId || item?.id;
  const masterItem = menuItemLookup?.[lookupId] || {};

  return masterItem.kitchenIds || (
    masterItem.kitchenId ? [masterItem.kitchenId] : []
  );
};

const isTargetItemForKitchen = (item, activeKitchenId, menuItemLookup = {}) => {
  if (activeKitchenId === 'all') return true;

  const targetKitchenIds = getTargetKitchenIds(item, menuItemLookup);

  return targetKitchenIds.some((kitchenId) => (
    String(kitchenId) === String(activeKitchenId)
  ));
};

const getOrderTime = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatElapsedMinutes = (timestamp) => {
  const date = getOrderTime(timestamp);
  if (!date) return '--';

  const elapsedMs = Date.now() - date.getTime();
  const minutes = Math.max(Math.floor(elapsedMs / 60000), 0);

  return `${minutes}分`;
};

const buildTargetItems = (items = [], activeKitchenId, menuItemLookup = {}) => {
  return items
    .map((item, sourceIndex) => ({ ...item, sourceIndex }))
    .filter((item) => isTargetItemForKitchen(item, activeKitchenId, menuItemLookup));
};

const isServeModeVisibleOrder = (order, activeKitchenId, menuItemLookup = {}) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const targetItems = buildTargetItems(items, activeKitchenId, menuItemLookup);

  if (targetItems.length === 0) return false;

  return targetItems.some((item) => resolveKitchenStatus(item) === 'prepared');
};

const getVisibleMobileItems = (order, activeKitchenId, menuItemLookup = {}) => {
  return buildTargetItems(order?.items || [], activeKitchenId, menuItemLookup)
    .filter((item) => resolveKitchenStatus(item) !== 'served');
};

const ServeMode = ({ storeId }) => {
  const { storeId: authStoreId, loading: authLoading } = useAuth();
  const effectiveStoreId = storeId || authStoreId;
  const kdsData = useKitchenBoard(effectiveStoreId || null);
  const { settings: storeSettings } = useStoreSettings(effectiveStoreId || null);

  const serveTabStorageKey = effectiveStoreId
    ? `serve-active-tab:${effectiveStoreId}`
    : '';

  const [activeKitchenId, setActiveKitchenId] = useState(() => {
    try {
      if (!effectiveStoreId) return 'all';
      return window.localStorage.getItem(`serve-active-tab:${effectiveStoreId}`) || 'all';
    } catch {
      return 'all';
    }
  });

  const [processingOrderId, setProcessingOrderId] = useState(null);

  const availableStations = useMemo(
    () => [{ id: 'all', name: '全て表示' }, ...(kdsData.kitchens || [])],
    [kdsData.kitchens]
  );

  useEffect(() => {
    if (!serveTabStorageKey) return;

    try {
      window.localStorage.setItem(serveTabStorageKey, String(activeKitchenId));
    } catch {
      // localStorage が使えない環境では保存しない
    }
  }, [activeKitchenId, serveTabStorageKey]);

  const servingOrders = useMemo(() => {
    const source = Array.isArray(kdsData.orders) ? kdsData.orders : [];

    return source
      .filter((order) => isServeModeVisibleOrder(order, activeKitchenId, kdsData.menuItemLookup))
      .sort((left, right) => {
        const leftTime = getOrderTime(left.timestamp)?.getTime() || 0;
        const rightTime = getOrderTime(right.timestamp)?.getTime() || 0;
        return leftTime - rightTime;
      });
  }, [
    activeKitchenId,
    kdsData.orders,
    kdsData.menuItemLookup
  ]);

  const handleKitchenTabChange = (nextKitchenId) => {
    setActiveKitchenId(nextKitchenId);
  };

  const handleServePreparedItems = async (order) => {
    if (!order?.id || processingOrderId) return;

    setProcessingOrderId(order.id);

    try {
      const nextItems = (order.items || []).map((item) => {
        const isTargetItem = isTargetItemForKitchen(
          item,
          activeKitchenId,
          kdsData.menuItemLookup
        );

        if (!isTargetItem) return item;

        const status = resolveKitchenStatus(item);

        if (status !== 'prepared') return item;

        return {
          ...item,
          kitchenStatus: 'served',
          isPrepared: true
        };
      });

      await kdsData.updateOrderItems(order.id, nextItems, 'serving');
    } finally {
      setProcessingOrderId(null);
    }
  };

  if (authLoading || !effectiveStoreId || kdsData.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <LoadingSpinner size={48} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-200 font-sans text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Utensils size={18} strokeWidth={2.8} />
            </div>

            <div className="min-w-0">
              <h1 className="truncate text-base font-black text-slate-900">
                提供モード
              </h1>
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {storeSettings?.name || 'Serve Display'}
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-3 flex w-full max-w-3xl gap-2 overflow-x-auto pb-1">
          {availableStations.map((station) => {
            const isActive = String(activeKitchenId) === String(station.id);

            return (
              <button
                key={station.id}
                type="button"
                onClick={() => handleKitchenTabChange(station.id)}
                className={`h-10 shrink-0 rounded-2xl px-4 text-sm font-black shadow-sm transition-all active:scale-95 ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                {station.name}
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 p-3 pb-24">
        <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-md ring-1 ring-slate-300">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              Ready To Serve
            </div>
            <div className="mt-1 text-lg font-black text-slate-900">
              提供できる伝票
            </div>
          </div>

          <div className="flex h-14 min-w-14 items-center justify-center rounded-2xl bg-blue-600 px-4 text-2xl font-black tabular-nums text-white shadow-sm">
            {servingOrders.length}
          </div>
        </div>

        {servingOrders.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-white/70 p-10 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-300">
              <Check size={42} strokeWidth={1.7} />
            </div>

            <h2 className="text-xl font-black text-slate-700">
              提供できる商品はありません
            </h2>

            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-400">
              キッチン側で一部でも調理完了になると、ここに表示されます。
            </p>
          </div>
        ) : (
          servingOrders.map((order) => {
            const targetItems = getVisibleMobileItems(
              order,
              activeKitchenId,
              kdsData.menuItemLookup
            );

            const preparedItems = targetItems.filter((item) => (
              resolveKitchenStatus(item) === 'prepared'
            ));

            const pendingItems = targetItems.filter((item) => (
              resolveKitchenStatus(item) === 'pending'
            ));

            const preparedCount = preparedItems.reduce((sum, item) => (
              sum + Number(item.quantity || 1)
            ), 0);

            const pendingCount = pendingItems.reduce((sum, item) => (
              sum + Number(item.quantity || 1)
            ), 0);

            const totalVisibleCount = preparedCount + pendingCount;
            const isPartialServe = pendingCount > 0;
            const actionLabel = isPartialServe ? '一部提供完了' : '提供完了';
            const isProcessing = processingOrderId === order.id;

            return (
                <article
                key={order.id}
                className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-300"
                >
                <div className="border-b border-blue-100 bg-blue-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-black text-blue-500">
                        テーブル
                      </div>

                      <div className="mt-1 text-4xl font-black leading-none tracking-tighter text-slate-950">
                        {getTableDisplayName(order)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-100">
                        <Clock size={15} />
                        {formatElapsedMinutes(order.timestamp)}
                      </div>

                      <div className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white shadow-sm">
                        {totalVisibleCount} 点
                      </div>

                      {isPartialServe && (
                        <div className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-black text-orange-700">
                          残り {pendingCount} 点
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {targetItems.map((item) => {
                    const itemStatus = resolveKitchenStatus(item);
                    const isPrepared = itemStatus === 'prepared';
                    const quantity = Number(item.quantity || 1);

                    return (
                      <div
                        key={`${order.id}-${item.sourceIndex}-${item.name}`}
                        className={`flex items-center justify-between gap-3 px-4 py-3 ${
                        isPrepared ? 'bg-blue-50/80' : 'bg-white'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                              isPrepared
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-300 bg-white text-transparent'
                            }`}
                          >
                            <Check size={17} strokeWidth={3} />
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-base font-black text-slate-900">
                            {item.name || '未設定商品'}
                            </div>

                            {item.serviceTimingLabel && (
                              <div className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${getServiceTimingBadgeClassName(item.serviceTiming)}`}>
                                {item.serviceTimingLabel}
                              </div>
                            )}

                            {Array.isArray(item.options) && item.options.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {item.options.map((option, optionIndex) => (
                                  <span
                                    key={`${option}-${optionIndex}`}
                                    className="rounded-lg border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700"
                                  >
                                    {option}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-black tabular-nums shadow-sm ${
                            isPrepared
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-300 bg-white text-slate-900'
                          }`}
                        >
                          {quantity}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-slate-50 p-3">
                  <button
                    type="button"
                    onClick={() => handleServePreparedItems(order)}
                    disabled={isProcessing || preparedItems.length === 0}
                    className={`flex h-14 w-full items-center justify-center gap-2.5 rounded-xl text-base font-black text-white shadow-lg transition-all active:scale-[0.98] ${
                      isProcessing
                        ? 'bg-slate-400'
                        : isPartialServe
                          ? 'bg-orange-500 hover:bg-orange-600'
                          : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCcw size={22} className="animate-spin" />
                        処理中
                      </>
                    ) : (
                      <>
                        <Check size={24} strokeWidth={3} />
                        {actionLabel}
                      </>
                    )}
                  </button>

                  {isPartialServe && (
                    <p className="mt-2 text-center text-xs font-bold text-slate-400">
                      チェック済みの商品だけを提供完了にします
                    </p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </main>
    </div>
  );
};

export default ServeMode;