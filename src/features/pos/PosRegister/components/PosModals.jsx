import React, { useMemo } from 'react';
import { Calculator, Check, ChevronRight, HandCoins, LogOut, Minus, Percent, Plus, X } from 'lucide-react';

const getAccountingCategoryLabel = (category) => {
  if (category === 'promo_expense') return '販促費';
  if (category === 'voucher_payment') return '金券/売掛';
  return '売上値引';
};

export const PosModals = ({
  showSuccessModal,
  setShowSuccessModal,
  lastTransaction,
  setPaymentAmount,
  showSplitModal,
  setShowSplitModal,
  totalAmount,
  rawTotalAmount,
  splitCount,
  setSplitCount,
  showDiscountModal,
  setShowDiscountModal,
  discounts,
  setDiscountType,
  setDiscountValue,
  setSelectedDiscount,
  discountQuantities,
  setDiscountQuantities,
  onFullCreditCheckout,
  showAbortModal,
  setShowAbortModal,
  abortReason = 'manual_abort',
  setAbortReason,
  onAbortSession,
  onConfirmAbort,
  tableId,
  tableDisplayName
}) => {
  const splitResult = useMemo(() => {
    const count = Number(splitCount) || 1;
    if (count <= 0) return { perPerson: 0, remainder: 0 };
    return { perPerson: Math.floor(totalAmount / count), remainder: totalAmount % count };
  }, [totalAmount, splitCount]);

  const discountBase = Math.max(0, Number(totalAmount) || 0);

  // この場で選択中の登録割引。percent優先→amount合算 で「適用予定額」を算出する。
  const selectedRegisteredPercent = discounts.find((discount) => {
    const type = discount.type || 'amount';
    const key = discount.id || discount.name;
    return type === 'percent' && Number(discountQuantities?.[key] || 0) > 0;
  });
  const registeredAmountSum = discounts.reduce((sum, discount) => {
    if ((discount.type || 'amount') !== 'amount') return sum;
    const key = discount.id || discount.name;
    const quantity = Math.max(0, Number(discountQuantities?.[key] || 0));
    return sum + ((Number(discount.value) || 0) * quantity);
  }, 0);

  const previewDiscountAmount = selectedRegisteredPercent
    ? Math.floor(discountBase * ((Number(selectedRegisteredPercent.value) || 0) / 100))
    : registeredAmountSum;
  const previewPercentLabel = selectedRegisteredPercent
    ? `${Number(selectedRegisteredPercent.value) || 0}%`
    : null;

  const resetDiscountSelection = () => {
    setDiscountType('none');
    setDiscountValue(0);
    setSelectedDiscount?.(null);
    setDiscountQuantities?.({});
  };

  // 全額売掛を適用。amount経路 + voucher_payment区分で、値引き前の支払全額を売掛として計上する。
  // onFullCreditCheckout が渡されていれば「適用＋会計確定」を親に委ねる(ワンタップ会計)。
  const fullCreditAmount = Math.max(0, Math.floor(Number(rawTotalAmount) || 0));
  const applyFullCredit = () => {
    if (fullCreditAmount <= 0) return;
    if (onFullCreditCheckout) {
      setShowDiscountModal(false);
      onFullCreditCheckout();
      return;
    }
    setDiscountType('amount');
    setDiscountValue(fullCreditAmount);
    setSelectedDiscount?.({
      id: 'full_credit',
      name: '全額売掛',
      type: 'full_credit',
      value: fullCreditAmount,
      accountingCategory: 'voucher_payment',
      count: 1,
      quantity: 1,
      amount: fullCreditAmount
    });
    setDiscountQuantities?.({});
    setShowDiscountModal(false);
  };

  // 全体割引モーダルの「適用」: 登録済み割引(percent優先→amount合算)を適用する。
  const applyDiscountSelection = () => {
    if (selectedRegisteredPercent) {
      const unitValue = Number(selectedRegisteredPercent.value) || 0;
      setDiscountType('percent');
      setDiscountValue(unitValue);
      setSelectedDiscount?.({
        id: selectedRegisteredPercent.id || null,
        name: selectedRegisteredPercent.name || '値引き',
        type: 'percent',
        value: unitValue,
        accountingCategory: selectedRegisteredPercent.accountingCategory || 'sales_discount',
        count: 1,
        quantity: 1
      });
      setShowDiscountModal(false);
      return;
    }

    const selectedAmountDiscounts = discounts
      .map((discount) => {
        const type = discount.type || 'amount';
        const key = discount.id || discount.name;
        const quantity = Math.max(0, Number(discountQuantities?.[key] || 0));
        const unitValue = Number(discount.value) || 0;
        if (type !== 'amount' || quantity <= 0) return null;
        return {
          id: discount.id || null,
          name: discount.name || '値引き',
          type,
          value: unitValue,
          accountingCategory: discount.accountingCategory || 'sales_discount',
          count: quantity,
          quantity,
          amount: unitValue * quantity
        };
      })
      .filter(Boolean);

    const totalAmountDiscount = selectedAmountDiscounts.reduce(
      (sum, discount) => sum + Number(discount.amount || 0),
      0
    );

    if (totalAmountDiscount <= 0) {
      setDiscountType('none');
      setDiscountValue(0);
      setSelectedDiscount?.(null);
      setShowDiscountModal(false);
      return;
    }

    const displayName = selectedAmountDiscounts.length === 1
      ? selectedAmountDiscounts[0].name
      : `${selectedAmountDiscounts.length}種類のクーポン`;
    const totalQuantity = selectedAmountDiscounts.reduce(
      (sum, discount) => sum + Number(discount.quantity || 0),
      0
    );

    setDiscountType('amount');
    setDiscountValue(totalAmountDiscount);
    setSelectedDiscount?.({
      id: selectedAmountDiscounts.length === 1 ? selectedAmountDiscounts[0].id : 'multiple_coupons',
      name: displayName,
      type: 'amount',
      accountingCategory: selectedAmountDiscounts.length === 1
        ? selectedAmountDiscounts[0].accountingCategory || 'sales_discount'
        : 'mixed',
      value: selectedAmountDiscounts.length === 1 ? selectedAmountDiscounts[0].value : 0,
      count: totalQuantity,
      quantity: totalQuantity,
      amount: totalAmountDiscount,
      items: selectedAmountDiscounts,
      label: selectedAmountDiscounts.length === 1
        ? `${selectedAmountDiscounts[0].name} × ${selectedAmountDiscounts[0].quantity}枚`
        : `${displayName} / ${totalQuantity}枚`
    });
    setShowDiscountModal(false);
  };

  const isAllItemsCancelledAbort = abortReason === 'all_items_cancelled';
  const abortModalTitle = isAllItemsCancelledAbort
    ? 'すべて取消済みです'
    : '無会計で退店にしますか？';
  const abortModalLead = isAllItemsCancelledAbort
    ? '未会計の商品がすべて取消済みです。'
    : '未会計の注文があります。';
  const abortModalDescription = isAllItemsCancelledAbort
    ? 'このまま席を終了すると、席は待機中に戻ります。'
    : 'この操作を行うと、注文はキャンセル扱いになり、席は待機中に戻ります。';
  const abortConfirmLabel = isAllItemsCancelledAbort
    ? '席を終了する'
    : '退店にする';

  const closeAbortModal = () => {
    setShowAbortModal(false);
    setAbortReason?.('manual_abort');
  };

  const confirmAbortModal = () => {
    onConfirmAbort?.({ reason: abortReason || 'manual_abort' });
  };

  return (
    <>
      {showSuccessModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="animate-in zoom-in-95 flex w-full max-w-sm flex-col items-center rounded-2xl bg-white p-8 text-center shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
              <Check size={40} strokeWidth={3} />
            </div>

            <h3 className="mb-2 text-2xl font-bold text-gray-800">
              会計が完了しました
            </h3>

            <div className="mb-6 w-full space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between text-sm font-bold text-gray-600">
                <span>今回の会計額</span>
                <span className="font-mono text-xl">
                  ¥{Number(lastTransaction?.total || 0).toLocaleString()}
                </span>
              </div>

              {lastTransaction?.method === 'cash' && (
                <div className="flex items-center justify-between border-t border-dashed border-gray-200 pt-2 text-blue-600">
                  <span>おつり</span>
                  <span className="font-mono text-2xl font-bold">
                    ¥{Number(lastTransaction?.change || 0).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowSuccessModal(false);
                setPaymentAmount('');
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 text-lg font-bold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-[0.98]"
            >
              戻る
            </button>
          </div>
        </div>
      )}

      {showSplitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="animate-in zoom-in-95 w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800">
                <Calculator size={20} className="text-blue-500" />
                分割会計
              </h3>
              <button onClick={() => setShowSplitModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 rounded-xl bg-gray-50 p-4 text-center">
              <p className="mb-1 text-xs text-gray-500">対象金額(税込)</p>
              <p className="font-mono text-2xl font-bold text-gray-800">¥{totalAmount.toLocaleString()}</p>
            </div>

            <div className="mb-6 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-2">
              <button
                onClick={() => setSplitCount(Math.max(2, splitCount - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600"
              >
                <Minus size={18} />
              </button>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{splitCount}</span>
                <span className="text-sm text-gray-500">人</span>
              </div>
              <button
                onClick={() => setSplitCount(splitCount + 1)}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 p-3">
                <span className="text-sm font-bold text-blue-800">1人あたり</span>
                <span className="font-mono text-xl font-bold text-blue-700">¥{splitResult.perPerson.toLocaleString()}</span>
              </div>

              {splitResult.remainder > 0 && (
                <div className="flex items-center justify-between px-3 text-sm text-gray-500">
                  <span className="font-bold">端数</span>
                  <span className="font-mono font-bold">¥{splitResult.remainder.toLocaleString()}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowSplitModal(false)}
              className="mt-6 w-full rounded-xl bg-gray-800 py-3 font-bold text-white shadow-lg hover:bg-gray-700"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {showDiscountModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[82vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800">
              <Percent size={20} className="text-orange-500" />
              割引・売掛を適用
            </h3>

            <div className="mb-4 space-y-2">
              <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-2">
                <div className="mb-1 flex items-center gap-1 px-1 text-[11px] font-black text-sky-600">
                  <HandCoins size={13} />
                  全額売掛{onFullCreditCheckout ? '（即会計）' : ''}
                </div>
                <button
                  type="button"
                  onClick={applyFullCredit}
                  disabled={fullCreditAmount <= 0}
                  className="flex h-10 w-full items-center justify-center gap-1 rounded-lg bg-sky-500 px-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-sky-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {fullCreditAmount > 0
                    ? `全額 ¥${fullCreditAmount.toLocaleString()} を売掛${onFullCreditCheckout ? 'で会計' : ''}`
                    : '全額を売掛にする'}
                </button>
              </div>
              <p className="px-1 text-[10px] font-bold leading-relaxed text-gray-400">
                % 割引は商品ごとの「単品割引」で適用します。下のリストは登録済みの金額クーポン/金券、全額売掛は支払全額を売掛(後日回収)として計上します。
              </p>
            </div>

            <div className="mb-2 px-1 text-[11px] font-black text-gray-400">登録済みの割引/金券</div>
            <div className="mb-3 grid grid-cols-[1fr_120px_100px] gap-2 border-b border-gray-100 px-2 pb-2 text-[11px] font-black text-gray-400">
              <div>項目名</div>
              <div className="text-center">数量</div>
              <div className="text-right">小計</div>
            </div>

            <div className="mb-4 min-h-0 flex-grow overflow-y-auto pr-1">
              {discounts.length === 0 ? (
                <div className="rounded-xl bg-gray-50 p-6 text-center text-sm font-bold text-gray-400">
                  登録済みの割引/金券がありません
                </div>
              ) : (
                <div className="space-y-2">
                  {discounts.map((discount) => {
                    const currentDiscountType = discount.type || 'amount';
                    const unitValue = Number(discount.value) || 0;
                    const isAmountDiscount = currentDiscountType === 'amount';
                    const discountKey = discount.id || discount.name;
                    const quantity = Math.max(0, Number(discountQuantities?.[discountKey] || 0));
                    const lineTotal = isAmountDiscount ? unitValue * quantity : 0;
                    const isSelectedPercent = !isAmountDiscount && quantity > 0;

                    const updateQuantity = (nextQuantity) => {
                      const normalizedQuantity = Math.max(0, Number(nextQuantity || 0));

                      setDiscountQuantities((previous) => ({
                        ...(previous || {}),
                        [discountKey]: isAmountDiscount
                          ? normalizedQuantity
                          : normalizedQuantity > 0
                            ? 1
                            : 0
                      }));
                    };

                    const incrementQuantity = () => {
                      updateQuantity(isAmountDiscount ? quantity + 1 : 1);
                    };

                    return (
                      <div
                        key={discountKey}
                        role="button"
                        tabIndex={0}
                        onClick={incrementQuantity}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            incrementQuantity();
                          }
                        }}
                        className={`grid cursor-pointer grid-cols-[1fr_120px_100px] items-center gap-2 rounded-xl border px-2 py-3 transition-all ${
                          quantity > 0
                            ? 'border-orange-200 bg-orange-50'
                            : 'border-gray-100 bg-white hover:border-orange-100 hover:bg-orange-50/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-gray-800">
                            {discount.name || '値引き'}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] font-bold text-gray-400">
                            <span>
                              {isAmountDiscount
                                ? `1枚 ${unitValue.toLocaleString()}円`
                                : `${unitValue}%割引`}
                            </span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                              {getAccountingCategoryLabel(discount.accountingCategory || 'sales_discount')}
                            </span>
                          </div>
                        </div>

                        <div
                          className="flex items-center justify-center gap-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {isAmountDiscount ? (
                            <>
                              <button
                                type="button"
                                onClick={() => updateQuantity(quantity - 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 shadow-sm active:scale-95"
                              >
                                <Minus size={15} />
                              </button>

                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                value={quantity}
                                onChange={(event) => updateQuantity(event.target.value)}
                                className="h-8 w-12 rounded-lg border border-gray-200 bg-white text-center text-sm font-black text-gray-900 outline-none focus:border-orange-400"
                              />

                              <button
                                type="button"
                                onClick={() => updateQuantity(quantity + 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700 shadow-sm active:scale-95"
                              >
                                <Plus size={15} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => updateQuantity(isSelectedPercent ? 0 : 1)}
                              className={`h-8 rounded-lg px-3 text-xs font-black transition-colors ${
                                isSelectedPercent
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-gray-100 text-gray-500 hover:bg-orange-100 hover:text-orange-700'
                              }`}
                            >
                              {isSelectedPercent ? '選択中' : '選択'}
                            </button>
                          )}
                        </div>

                        <div className="text-right font-mono text-sm font-black text-orange-700">
                          {isAmountDiscount
                            ? `-${lineTotal.toLocaleString()}円`
                            : isSelectedPercent
                              ? `${unitValue}%`
                              : '-'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-gray-100 pt-4">
              <div className="mb-3 rounded-xl bg-orange-50 px-4 py-3">
                <div className="flex items-center justify-between text-sm font-black text-orange-900">
                  <span>適用予定額</span>
                  <span className="font-mono">
                    {previewPercentLabel ? `${previewPercentLabel} = ` : ''}-{previewDiscountAmount.toLocaleString()}円
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-bold text-orange-600">
                  項目名を押すと数量が1増えます。
                </div>
              </div>

              <button
                type="button"
                onClick={applyDiscountSelection}
                className="mb-3 flex w-full items-center justify-center rounded-xl bg-orange-500 py-3 font-black text-white shadow-sm transition-all hover:bg-orange-600 active:scale-[0.99]"
              >
                適用
              </button>

              <button
                type="button"
                onClick={() => {
                  resetDiscountSelection();
                  setShowDiscountModal(false);
                }}
                className="mb-2 w-full rounded-xl bg-gray-100 py-3 font-bold text-gray-600 transition-colors hover:bg-gray-200"
              >
                リセット
              </button>

              <button
                type="button"
                onClick={() => setShowDiscountModal(false)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      {showAbortModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md animate-in fade-in">
          <div className="animate-in zoom-in-95 w-full max-w-sm rounded-[2.5rem] border border-gray-100 bg-white p-10 text-center shadow-2xl">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50">
              <LogOut size={40} className="ml-1 text-red-500" strokeWidth={2.5} />
            </div>

            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">
              {abortModalTitle}
            </h3>

            <p className="mb-10 text-sm font-medium leading-relaxed text-gray-500">
              <span className="mb-1 block text-base font-bold text-gray-800">
                {tableDisplayName || tableId || 'テーブル未設定'}
              </span>
              {abortModalLead}
              <br />
              {abortModalDescription}
            </p>

            <div className="flex gap-3">
              <button
                onClick={closeAbortModal}
                className="flex-1 rounded-2xl bg-gray-50 py-4 font-bold text-gray-400 transition-all hover:bg-gray-100"
              >
                キャンセル
              </button>

              <button
                onClick={confirmAbortModal}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg shadow-red-200 transition-all hover:bg-red-600 active:scale-95"
              >
                <LogOut size={20} strokeWidth={2.5} />
                {abortConfirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
