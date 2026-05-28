import React, { useRef } from 'react';
import { Calculator, Check, ChevronLeft, RotateCcw, ShoppingBag, Store, User, Utensils } from 'lucide-react';
import {
  formatOrderCustomerLabel,
  groupOrdersByCustomer
} from '../../../../shared/utils/orderCustomerIdentity';

const isCancelledPosItem = (item) => (
  item?.status === 'cancelled' || item?.kitchenStatus === 'cancelled'
);

const getUnpaidActiveItems = (order, paidItemKeys) => {
  if (!order?.items || !Array.isArray(order.items)) return [];

  return order.items
    .map((item, index) => ({ item, index, key: `${order.id}-${index}` }))
    .filter(({ item, key }) => (
      item &&
      !paidItemKeys.has(key) &&
      item.paymentStatus !== 'paid'
    ));
};

const getRemainingOrderTotal = (order, paidItemKeys) => (
  getUnpaidActiveItems(order, paidItemKeys).reduce((sum, { item }) => {
    if (isCancelledPosItem(item)) return sum;

    const unitPrice = Number(item.unitPrice) || 0;
    const quantity = Number(item.quantity) || 0;
    return sum + (unitPrice * quantity);
  }, 0)
);

const getSelectionState = (itemKeys, selectedItemKeys, isCustomMode) => {
  if (!isCustomMode || itemKeys.length === 0) {
    return { selectedCount: 0, isAllSelected: false, isPartiallySelected: false };
  }

  const selectedCount = itemKeys.filter((key) => selectedItemKeys.has(key)).length;

  return {
    selectedCount,
    isAllSelected: selectedCount === itemKeys.length,
    isPartiallySelected: selectedCount > 0 && selectedCount < itemKeys.length
  };
};

export const PosRegisterLeft = ({
  orders,
  checkoutSelectionMode,
  selectedItemKeys,
  paidItemKeys,
  takeoutItemKeys,
  totalAmount,
  allowTakeout,
  onBack,
  toggleSelect,
  toggleSelectItem,
  toggleSelectAll,
  toggleSelectCustomer,
  clearCustomSelection,
  onRequestCancelTarget,
  setShowSplitModal,
  toggleItemTakeout
}) => {
  const groupedOrders = groupOrdersByCustomer(orders || []);
  const isCustomMode = checkoutSelectionMode === 'custom';
  const longPressTimerRef = useRef(null);
  const didLongPressRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (_event, payload) => {
    if (!onRequestCancelTarget) return;

    clearLongPress();
    didLongPressRef.current = false;

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      didLongPressRef.current = true;
      onRequestCancelTarget(payload);
    }, 750);
  };

  const shouldIgnoreClickAfterLongPress = () => {
    if (!didLongPressRef.current) return false;
    didLongPressRef.current = false;
    return true;
  };


  const allVisibleItemKeys = (orders || []).flatMap((order) => (
    getUnpaidActiveItems(order, paidItemKeys).map(({ key }) => key)
  ));
  const allSelected = isCustomMode && allVisibleItemKeys.length > 0 && allVisibleItemKeys.every((key) => selectedItemKeys.has(key));

  return (
    <div className="z-10 flex h-full min-h-0 w-7/12 flex-col overflow-hidden border-r border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b bg-gray-50 p-4">
        <button
          onClick={onBack}
          className="flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-500 shadow-sm transition-colors hover:text-gray-800"
        >
          <ChevronLeft size={18} className="mr-1" />
          戻る
        </button>

        <div className="flex items-center gap-2">
          {isCustomMode && (
            <div className="mr-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">
              個別会計中
            </div>
          )}

          {isCustomMode && (
            <button
              type="button"
              onClick={clearCustomSelection}
              className="flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-100"
            >
              <RotateCcw size={14} />
              選択をクリア
            </button>
          )}

          <button
            onClick={() => setShowSplitModal(true)}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-600"
            disabled={totalAmount === 0}
          >
            <Calculator size={14} />
            分割会計
          </button>

          {isCustomMode && (
            <button
              onClick={toggleSelectAll}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                allSelected
                  ? 'border-blue-200 bg-blue-100 text-blue-700'
                  : 'border-gray-300 bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              {allSelected ? 'すべて解除' : 'すべて選択'}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gray-50/50 p-4">
        {orders.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-gray-400 opacity-60">
            <Utensils size={64} strokeWidth={1} className="mb-4" />
            <p className="font-bold">未会計の注文はありません</p>
          </div>
        )}

        {Object.entries(groupedOrders).map(([customerKey, userOrders]) => {
          const visibleOrders = userOrders.filter(
            (order) => getUnpaidActiveItems(order, paidItemKeys).length > 0
          );
          if (visibleOrders.length === 0) return null;

          const customerItemKeys = visibleOrders.flatMap((order) => (
            getUnpaidActiveItems(order, paidItemKeys).map(({ key }) => key)
          ));
          const customerSelection = getSelectionState(customerItemKeys, selectedItemKeys, isCustomMode);
          const userTotal = visibleOrders.reduce((sum, order) => sum + getRemainingOrderTotal(order, paidItemKeys), 0);

          return (
            <div
              key={customerKey}
              className={`overflow-hidden rounded-xl border shadow-sm transition-all ${
                customerSelection.isAllSelected
                  ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-100'
                  : customerSelection.isPartiallySelected
                    ? 'border-blue-300 bg-blue-50/40 shadow-sm'
                    : 'border-gray-300 bg-gray-100/80 shadow-sm'
              }`}
            >
              <button
                type="button"
                onPointerDown={(event) => startLongPress(event, { type: 'customer', customerId: customerKey })}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  if (shouldIgnoreClickAfterLongPress()) return;
                  toggleSelectCustomer(customerKey);
                }}
                className={`flex w-full select-none items-center justify-between border-b px-4 py-2 text-left text-xs font-bold transition-colors ${
                  customerSelection.isAllSelected
                    ? 'border-blue-100 bg-blue-100 text-blue-700'
                    : customerSelection.isPartiallySelected
                      ? 'border-blue-100 bg-blue-50 text-blue-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-black shadow-sm ${
                    customerSelection.isAllSelected
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : customerSelection.isPartiallySelected
                        ? 'border-blue-500 bg-blue-500 text-white'
                        : 'border-gray-300 bg-white text-gray-700'
                  }`}>
                    <User size={14} />
                    {formatOrderCustomerLabel(customerKey)}
                  </span>
                </div>
              </button>

              <div className="px-3 pb-3">
                {visibleOrders.map((order) => {
                  const orderItems = getUnpaidActiveItems(order, paidItemKeys);
                  const orderItemKeys = orderItems.map(({ key }) => key);
                  const orderSelection = getSelectionState(orderItemKeys, selectedItemKeys, isCustomMode);
                  const orderTotal = getRemainingOrderTotal(order, paidItemKeys);

                  return (
                    <div
                      key={order.id}
                      className={`mt-3 rounded-2xl border p-4 transition-all ${
                        orderSelection.isAllSelected
                          ? 'border-blue-500 bg-blue-50 shadow-sm shadow-blue-100'
                          : orderSelection.isPartiallySelected
                            ? 'border-blue-300 bg-blue-50/40 shadow-sm'
                            : 'border-gray-200 bg-white/90 hover:border-gray-300 hover:bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onPointerDown={(event) => startLongPress(event, { type: 'order', orderId: order.id })}
                        onPointerUp={clearLongPress}
                        onPointerLeave={clearLongPress}
                        onPointerCancel={clearLongPress}
                        onContextMenu={(event) => event.preventDefault()}
                        onClick={() => {
                          if (shouldIgnoreClickAfterLongPress()) return;
                          toggleSelect(order.id);
                        }}
                        className="mb-2 flex w-full select-none items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                            orderSelection.isAllSelected
                              ? 'bg-blue-600 text-white'
                              : orderSelection.isPartiallySelected
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-200 text-gray-600'
                          }`}>
                            注文 #{order.id.slice(-4)}
                          </span>
                          {orderSelection.isAllSelected && <Check size={15} className="text-blue-600" />}
                        </div>

                        <span className="font-mono text-lg font-bold text-gray-800">
                          ¥{orderTotal.toLocaleString()}
                        </span>
                      </button>

                      <div className="space-y-2.5">
                        {order.items?.map((item, index) => {
                          const itemKey = `${order.id}-${index}`;
                          const isItemTakeout = takeoutItemKeys.has(itemKey);
                          const allowsTakeout = item?.allowsTakeout !== false;
                          const isItemSelected = isCustomMode && selectedItemKeys.has(itemKey);

                          if (!item || paidItemKeys.has(itemKey) || item.paymentStatus === 'paid') return null;

                          const isItemCancelled = isCancelledPosItem(item);

                          return (
                            <button
                              key={itemKey}
                              type="button"
                              onPointerDown={(event) => startLongPress(event, { type: 'item', itemKey })}
                              onPointerUp={clearLongPress}
                              onPointerLeave={clearLongPress}
                              onPointerCancel={clearLongPress}
                              onContextMenu={(event) => event.preventDefault()}
                              onClick={() => {
                                if (shouldIgnoreClickAfterLongPress()) return;
                                if (isItemCancelled) return;
                                toggleSelectItem(itemKey);
                              }}
                              className={`flex w-full select-none items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                                isItemCancelled
                                  ? 'border-red-100 bg-red-50/70 text-red-400'
                                  : isItemSelected
                                    ? 'border-blue-200 bg-blue-50 text-blue-900'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50/30'
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                  isItemSelected
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-gray-200 bg-white text-transparent'
                                }`}>
                                  <Check size={13} strokeWidth={3} />
                                </span>
                                <span className={`min-w-0 truncate ${isItemCancelled ? 'line-through decoration-2' : ''}`}>
                                  {item.name} <span className="text-gray-400">x{item.quantity}</span>
                                </span>
                                {isItemCancelled && (
                                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-600">
                                    取消済み
                                  </span>
                                )}
                              </span>

                              <div className="flex shrink-0 items-center gap-2">
                                <span className={`font-mono text-xs text-gray-400 ${isItemCancelled ? 'line-through decoration-2' : ''}`}>
                                  ¥{((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)).toLocaleString()}
                                </span>

                                {!isItemCancelled && allowTakeout && allowsTakeout ? (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => toggleItemTakeout(event, [itemKey])}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        toggleItemTakeout(event, [itemKey]);
                                      }
                                    }}
                                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold shadow-sm transition-all duration-200 ${
                                      isItemTakeout
                                        ? 'border-orange-200 bg-orange-100 text-orange-700 hover:bg-orange-200'
                                        : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                                    }`}
                                  >
                                    {isItemTakeout ? <ShoppingBag size={12} /> : <Store size={12} />}
                                    テイクアウト
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                                    <Store size={12} />
                                    店内のみ
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
