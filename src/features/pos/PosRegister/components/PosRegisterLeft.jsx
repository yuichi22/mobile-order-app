import React, { useRef } from 'react';
import { Calculator, Check, ChevronLeft, Minus, Package, Plus, RotateCcw, ShoppingBag, Store, Trash2, User, Utensils } from 'lucide-react';
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
  toggleItemTakeout,
  productMasterLoading = false,
  orderRetailProducts = [],
  orderRetailKeyword = '',
  setOrderRetailKeyword,
  orderRetailCart = [],
  orderRetailMessage = null,
  addOrderRetailProduct,
  updateOrderRetailCartQuantity,
  removeOrderRetailCartItem,
  getOrderRetailCartQuantity
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

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-slate-900">
                <Package size={16} />
                物販追加
              </h3>
              <p className="mt-1 text-xs font-bold text-slate-400">
                テーブル会計に商品マスターの商品を合算します。
              </p>
            </div>
            {orderRetailCart.length > 0 && (
              <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-600">
                追加 {orderRetailCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}点
              </div>
            )}
          </div>

          {orderRetailMessage && (
            <div className={`mb-3 rounded-xl border px-3 py-2 text-xs font-black ${
              orderRetailMessage.type === 'error'
                ? 'border-red-100 bg-red-50 text-red-600'
                : orderRetailMessage.type === 'success'
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                  : 'border-blue-100 bg-blue-50 text-blue-600'
            }`}>
              {orderRetailMessage.message}
            </div>
          )}

          <input
            value={orderRetailKeyword}
            onChange={(event) => setOrderRetailKeyword?.(event.target.value)}
            placeholder="商品名 / 品番 / バーコードで検索"
            className="mb-3 h-10 w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400"
          />

          {productMasterLoading ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-center text-xs font-bold text-slate-400">
              商品マスターを読み込み中...
            </div>
          ) : orderRetailProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs font-bold text-slate-400">
              商品が見つかりません。
            </div>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {orderRetailProducts.slice(0, 12).map((product) => {
                const stockQuantity = Number(product.resolvedStock || 0);
                const cartQuantity = getOrderRetailCartQuantity?.(product.id) || 0;
                const isDisabled = stockQuantity <= 0 || cartQuantity >= stockQuantity;

                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addOrderRetailProduct?.(product)}
                    disabled={isDisabled}
                    className={`flex min-h-[76px] flex-col justify-between rounded-xl border p-3 text-left shadow-sm transition-all active:scale-[0.99] ${
                      isDisabled
                        ? 'cursor-not-allowed border-slate-100 bg-slate-100 opacity-70'
                        : 'border-slate-100 bg-white hover:border-blue-200 hover:bg-blue-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-black ${isDisabled ? 'text-slate-400' : 'text-slate-800'}`}>
                        {product.name || '商品'}
                      </div>
                      <div className="mt-1 truncate text-[11px] font-bold text-slate-400">
                        {product.sku || product.productCode || product.barcode || product.resolvedCategoryName}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        stockQuantity <= 0
                          ? 'bg-red-50 text-red-500'
                          : cartQuantity >= stockQuantity
                            ? 'bg-orange-50 text-orange-500'
                            : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        在庫 {stockQuantity.toLocaleString()} / 選択 {Number(cartQuantity).toLocaleString()}
                      </span>
                      <span className="font-mono text-sm font-black text-slate-900">
                        ¥{Number(product.resolvedPrice || 0).toLocaleString()}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {orderRetailCart.length > 0 && (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
              <div className="mb-2 text-[11px] font-black tracking-widest text-emerald-700">
                追加済み物販
              </div>
              <div className="space-y-2">
                {orderRetailCart.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-slate-800">{item.name}</div>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-400">
                        ¥{Number(item.unitPrice || item.takeoutPrice || 0).toLocaleString()} / 在庫 {Number(item.stockQuantity || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateOrderRetailCartQuantity?.(item.id, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-7 text-center font-mono text-sm font-black text-slate-800">
                        {Number(item.quantity || 0)}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateOrderRetailCartQuantity?.(item.id, 1)}
                        disabled={Number(item.quantity || 0) >= Number(item.stockQuantity || 0)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOrderRetailCartItem?.(item.id)}
                        className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
