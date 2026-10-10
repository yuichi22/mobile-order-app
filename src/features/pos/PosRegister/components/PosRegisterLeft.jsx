import React, { useRef } from 'react';
import { memberBarStyle, rankTheme } from '../../utils/rankTheme';
import { QRCodeSVG } from 'qrcode.react';
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
  tableDisplayName,
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
  crmMember,
  crmMemberBusy,
  crmMemberMsg,
  crmCodeInput,
  setCrmCodeInput,
  onLookupCrmMember,
  onRecheckCrmMember,
  onClearCrmMember,
  onOpenMemberSearch
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

  const canUseCrm = typeof onLookupCrmMember === 'function';

  return (
    <div className="z-10 flex h-full min-h-0 w-7/12 flex-col overflow-hidden border-r border-gray-200 bg-white shadow-xl">
      {/* 会員バー: 会員を読み込んだら常時表示する。
          ⚠会計せず放置すると次のお客様に紐づく事故になるため、目立たせ・解除しやすくする。
          未読込のときは会員番号の入力欄(スキャナは MB+番号 を自動で拾う)。 */}
      {canUseCrm && (
        crmMember ? (
          <>
          {/* ランクがあればカードと同じメタリック、無ければ黒。 */}
          <div
            style={memberBarStyle(crmMember.rank)}
            className={`flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-white shadow-md ${
              crmMember.rank ? '' : 'bg-gray-900'
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              {crmMember.rank && (
                <span
                  className="shrink-0 rounded-md bg-black/25 px-2 py-0.5 text-[10px] font-black tracking-[0.12em]"
                  style={{ color: rankTheme(crmMember.rank)?.label }}
                >
                  {crmMember.rank.name}
                </span>
              )}
              <span className="truncate text-sm font-black">
                会員: {crmMember.displayName ? `${crmMember.displayName} 様` : '会員さま'}
              </span>
              <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-black">
                利用可能 {Number(crmMember.pointBalance || 0).toLocaleString()}pt
              </span>
            </div>
            <button
              type="button"
              onClick={() => onClearCrmMember?.()}
              className="shrink-0 rounded-lg bg-white/90 px-3 py-1 text-xs font-black text-gray-900 transition hover:bg-white active:scale-95"
            >
              解除
            </button>
          </div>
          {/* 友だち追加がまだ(登録未完了)の会員: ポイントは保留・利用不可。QRを読んでもらい「再照会」で解放する(2026-10-10) */}
          {crmMember.registration && crmMember.registration.complete === false && (
            <div className="flex shrink-0 items-center gap-3 border-b border-amber-100 bg-amber-50 px-4 py-2">
              {crmMember.registration.addFriendUrl && (
                <div className="shrink-0 rounded-lg bg-white p-1">
                  <QRCodeSVG value={crmMember.registration.addFriendUrl} size={56} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black text-gray-900">友だち追加で登録完了</div>
                <div className="text-[11px] font-bold text-gray-600">
                  {crmMember.registration.oaName ? `${crmMember.registration.oaName} を` : '公式アカウントを'}
                  友だち追加していただくと、ポイントが付与・利用できます。
                  {Number(crmMember.heldPoints || 0) > 0 && (
                    <span className="tabular-nums"> 追加後に {Number(crmMember.heldPoints).toLocaleString()}pt が残高に加わります。</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRecheckCrmMember?.()}
                disabled={crmMemberBusy}
                className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white transition active:scale-95 disabled:opacity-50"
              >
                {crmMemberBusy ? '確認中' : '再照会'}
              </button>
            </div>
          )}
          </>
        ) : (
          <div className="shrink-0 border-b border-gray-200 bg-gray-100/60 px-4 py-2">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onLookupCrmMember(crmCodeInput);
                setCrmCodeInput?.('');
              }}
              className="flex items-center gap-2"
            >
              <span className="shrink-0 text-[11px] font-black text-gray-900">会員</span>
              <input
                value={crmCodeInput || ''}
                onChange={(event) => setCrmCodeInput?.(event.target.value)}
                inputMode="numeric"
                placeholder="会員番号（スキャンも可）"
                className="border-2 border-gray-200 bg-white hover:border-gray-300 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm font-bold outline-none focus:border-ui"
              />
              <button
                type="submit"
                disabled={crmMemberBusy || !String(crmCodeInput || '').trim()}
                className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
              >
                {crmMemberBusy ? '照会中…' : '照会'}
              </button>
              {/* 会員番号が分からないお客様（ポイントカード未登録・固定電話で登録）はこちらから探す。 */}
              {typeof onOpenMemberSearch === 'function' && (
                <button
                  type="button"
                  onClick={onOpenMemberSearch}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-black text-gray-900 hover:bg-gray-100"
                >
                  検索
                </button>
              )}
            </form>
            {crmMemberMsg && (
              <div className="mt-1 text-[11px] font-bold text-red-600">{crmMemberMsg}</div>
            )}
          </div>
        )
      )}

      <div className="flex items-center justify-between border-b bg-gray-50 p-4">
        {/* 戻る(黒)→会計伝票テーブル名 の順(右ペインのヘッダ廃止に伴い移設)。 */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 text-sm font-black text-white shadow-sm transition-all hover:bg-black active:scale-95"
          >
            <ChevronLeft size={18} />
            戻る
          </button>
          <h2 className="flex min-w-0 items-center gap-2 text-base font-black text-gray-900">
            <span className="shrink-0">会計伝票</span>
            {tableDisplayName && (
              <span className="min-w-0 truncate text-gray-500">{tableDisplayName}</span>
            )}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {isCustomMode && (
            <div className="mr-1 rounded-full bg-ui-50 px-3 py-1.5 text-xs font-black text-ui">
              個別会計中
            </div>
          )}

          {isCustomMode && (
            <button
              type="button"
              onClick={clearCustomSelection}
              className="flex items-center gap-1 rounded-lg border border-ui-100 bg-ui-50 px-3 py-1.5 text-xs font-black text-ui shadow-sm transition-colors hover:border-ui-100 hover:bg-ui-50"
            >
              <RotateCcw size={14} />
              選択をクリア
            </button>
          )}

          <button
            onClick={() => setShowSplitModal(true)}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-sm font-black text-gray-600 shadow-sm transition-colors hover:bg-ui-50 hover:text-ui disabled:cursor-not-allowed disabled:opacity-50"
            disabled={totalAmount === 0}
          >
            <Calculator size={16} />
            分割会計
          </button>

          {isCustomMode && (
            <button
              onClick={toggleSelectAll}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                allSelected
                  ? 'border-ui-100 bg-ui-50 text-ui'
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
          <div className="flex h-full flex-col items-center justify-center text-gray-500 opacity-60">
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

          return (
            <div
              key={customerKey}
              className={`overflow-hidden rounded-xl border shadow-sm transition-all ${
                customerSelection.isAllSelected
                  ? 'border-ui bg-ui-50 shadow-md shadow-gray-200'
                  : customerSelection.isPartiallySelected
                    ? 'border-ui-100 bg-ui-50/40 shadow-sm'
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
                    ? 'border-ui-100 bg-ui-50 text-ui'
                    : customerSelection.isPartiallySelected
                      ? 'border-ui-100 bg-ui-50 text-ui'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-black shadow-sm ${
                    customerSelection.isAllSelected
                      ? 'border-ui bg-ui text-white'
                      : customerSelection.isPartiallySelected
                        ? 'border-ui bg-ui text-white'
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
                          ? 'border-ui bg-ui-50 shadow-sm shadow-gray-200'
                          : orderSelection.isPartiallySelected
                            ? 'border-ui-100 bg-ui-50/40 shadow-sm'
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
                              ? 'bg-ui text-white'
                              : orderSelection.isPartiallySelected
                                ? 'bg-ui-50 text-ui'
                                : 'bg-gray-200 text-gray-600'
                          }`}>
                            注文 #{order.id.slice(-4)}
                          </span>
                          {orderSelection.isAllSelected && <Check size={15} className="text-ui" />}
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
                                    ? 'border-ui-100 bg-ui-50 text-ui'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-ui-100 hover:bg-ui-50/30'
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                  isItemSelected
                                    ? 'border-ui bg-ui text-white'
                                    : 'border-gray-200 bg-white text-transparent'
                                }`}>
                                  <Check size={13} strokeWidth={3} />
                                </span>
                                <span className={`min-w-0 truncate ${isItemCancelled ? 'line-through decoration-2' : ''}`}>
                                  {item.name} <span className="text-gray-500">x{item.quantity}</span>
                                </span>
                                {isItemCancelled && (
                                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-600">
                                    取消済み
                                  </span>
                                )}
                              </span>

                              <div className="flex shrink-0 items-center gap-2">
                                <span className={`font-mono text-xs text-gray-500 ${isItemCancelled ? 'line-through decoration-2' : ''}`}>
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
                                        ? 'border-ui-100 bg-ui-50 text-ui hover:bg-ui-100'
                                        : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                  >
                                    {isItemTakeout ? <ShoppingBag size={12} /> : <Store size={12} />}
                                    テイクアウト
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-500">
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
