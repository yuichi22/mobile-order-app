import React from 'react';
import { Calculator, ChevronLeft, ShoppingBag, Store, User, Utensils } from 'lucide-react';
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
    .filter(({ item, key }) => item && !isCancelledPosItem(item) && !paidItemKeys.has(key));
};

const getRemainingOrderTotal = (order, paidItemKeys) => (
  getUnpaidActiveItems(order, paidItemKeys).reduce((sum, { item }) => {
    const unitPrice = Number(item.unitPrice) || 0;
    const quantity = Number(item.quantity) || 0;
    return sum + (unitPrice * quantity);
  }, 0)
);

export const PosRegisterLeft = ({
  orders,
  selectedOrderIds,
  paidItemKeys,
  takeoutItemKeys,
  totalAmount,
  allowTakeout,
  onBack,
  toggleSelect,
  toggleSelectAll,
  toggleSelectCustomer,
  setShowSplitModal,
  toggleItemTakeout
}) => {
  const groupedOrders = groupOrdersByCustomer(orders || []);

  const selectableOrders = (orders || []).filter((order) => getUnpaidActiveItems(order, paidItemKeys).length > 0);
  const allSelected = selectableOrders.length > 0 && selectableOrders.every((order) => selectedOrderIds.has(order.id));

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

        <div className="flex gap-2">
          <button
            onClick={() => setShowSplitModal(true)}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-600"
            disabled={totalAmount === 0}
          >
            <Calculator size={14} />
            分割会計
          </button>

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

          const userTotal = visibleOrders.reduce((sum, order) => sum + getRemainingOrderTotal(order, paidItemKeys), 0);
          const allCustomerOrdersSelected = visibleOrders.every((order) => selectedOrderIds.has(order.id));

          return (
            <div key={customerKey} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b bg-gray-100 px-4 py-2 text-xs font-bold text-gray-500">
                <div className="flex items-center gap-2">
                  <User size={14} />
                  <span>{formatOrderCustomerLabel(customerKey)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelectCustomer(customerKey)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${
                      allCustomerOrdersSelected
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : 'bg-white text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {allCustomerOrdersSelected ? 'この人を解除' : 'この人を選択'}
                  </button>
                  <span>合計 ¥{userTotal.toLocaleString()}</span>
                </div>
              </div>

              <div>
                {visibleOrders.map((order) => (
                  <label
                    key={order.id}
                    className={`flex cursor-pointer items-start border-b border-gray-100 p-4 hover:bg-gray-50 ${
                      selectedOrderIds.has(order.id)
                        ? 'border-l-4 border-l-blue-500 bg-blue-50'
                        : 'border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="mr-4 pt-1">
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </div>

                    <div className="flex-grow">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-600">
                          注文 #{order.id.slice(-4)}
                        </span>
                        <span className="font-mono text-lg font-bold text-gray-800">
                          ¥{(Number(order.totalPrice) || 0).toLocaleString()}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {order.items?.map((item, index) => {
                          const itemKey = `${order.id}-${index}`;
                          const isItemTakeout = takeoutItemKeys.has(itemKey);
                          const allowsTakeout = item?.allowsTakeout !== false;

                          if (!item || isCancelledPosItem(item) || paidItemKeys.has(itemKey)) return null;

                          return (
                            <div key={itemKey} className="flex items-center justify-between gap-3 text-sm text-gray-700">
                              <span>
                                {item.name} <span className="text-gray-400">x{item.quantity}</span>
                              </span>

                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-400">
                                  ¥{((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)).toLocaleString()}
                                </span>

                                {allowTakeout && allowsTakeout ? (
                                  <button
                                    onClick={(event) => toggleItemTakeout(event, [itemKey])}
                                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold shadow-sm transition-all duration-200 ${
                                      isItemTakeout
                                        ? 'border-orange-200 bg-orange-100 text-orange-700 hover:bg-orange-200'
                                        : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                                    }`}
                                  >
                                    {isItemTakeout ? <ShoppingBag size={12} /> : <Store size={12} />}
                                    テイクアウト
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                                    <Store size={12} />
                                    店内のみ
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
