import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Loader2,
  TicketPercent,
  X
} from 'lucide-react';

import { formatCurrency } from '../Analytics/utils/dailyClosingHelpers';

const DENOMINATIONS = [
  { key: 'bill10000', label: '10,000円札', value: 10000 },
  { key: 'bill5000', label: '5,000円札', value: 5000 },
  { key: 'bill1000', label: '1,000円札', value: 1000 },
  { key: 'coin500', label: '500円玉', value: 500 },
  { key: 'coin100', label: '100円玉', value: 100 },
  { key: 'coin50', label: '50円玉', value: 50 },
  { key: 'coin10', label: '10円玉', value: 10 },
  { key: 'coin5', label: '5円玉', value: 5 },
  { key: 'coin1', label: '1円玉', value: 1 }
];

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getCouponUnitValue = (discount) => {
  const value = Number(discount?.value || 0);

  if (value > 0 && discount?.type === 'amount') {
    return value;
  }

  const count = Number(discount?.count || 0);
  const amount = Number(discount?.amount || 0);

  if (count > 0 && amount > 0) {
    return Math.round(amount / count);
  }

  return 0;
};

const DailyClosingCheckModal = ({
  isOpen,
  dateKey,
  summary,
  discountList = [],
  onClose,
  onConfirm,
  isProcessing
}) => {
  const [denominations, setDenominations] = useState(() => (
    DENOMINATIONS.reduce((acc, item) => {
      acc[item.key] = '';
      return acc;
    }, {})
  ));

  const [couponCounts, setCouponCounts] = useState(() => (
    discountList.reduce((acc, discount) => {
      acc[discount.id || discount.name] = '';
      return acc;
    }, {})
  ));

  const expectedCashAmount = Number(summary?.cashSales || 0);
  const expectedCouponAmount = Number(summary?.discountTotal || 0);

  const actualCashAmount = useMemo(() => (
    DENOMINATIONS.reduce((sum, item) => (
      sum + (toNumber(denominations[item.key]) * item.value)
    ), 0)
  ), [denominations]);

  const couponCheckItems = useMemo(() => (
    discountList.map((discount, index) => {
      const id = discount.id || discount.name || `discount_${index}`;
      const name = discount.name || '値引き';
      const expectedCount = Number(discount.quantity || discount.count || 0);
      const expectedAmount = Number(discount.amount || 0);
      const unitValue = getCouponUnitValue(discount);
      const actualCount = toNumber(couponCounts[id]);
      const actualAmount = actualCount * unitValue;

      return {
        id,
        name,
        type: discount.type || '',
        value: unitValue,
        expectedCount,
        expectedAmount,
        actualCount,
        actualAmount,
        difference: actualAmount - expectedAmount
      };
    })
  ), [couponCounts, discountList]);

  const actualCouponAmount = couponCheckItems.reduce((sum, item) => sum + item.actualAmount, 0);
  const cashDifference = actualCashAmount - expectedCashAmount;
  const couponDifference = actualCouponAmount - expectedCouponAmount;
  const hasDifference = cashDifference !== 0 || couponDifference !== 0;

  const updateDenomination = (key, value) => {
    setDenominations((previous) => ({
      ...previous,
      [key]: value
    }));
  };

  const updateCouponCount = (id, value) => {
    setCouponCounts((previous) => ({
      ...previous,
      [id]: value
    }));
  };

  const handleConfirm = () => {
    if (hasDifference) {
      const ok = window.confirm(
        '現金またはクーポンに差額があります。この内容で締め保存しますか？'
      );

      if (!ok) return;
    }

    onConfirm({
      cashCheck: {
        expectedCashAmount,
        actualCashAmount,
        difference: cashDifference,
        denominations: DENOMINATIONS.reduce((acc, item) => {
          acc[item.key] = toNumber(denominations[item.key]);
          return acc;
        }, {})
      },
      couponCheck: {
        expectedTotalAmount: expectedCouponAmount,
        actualTotalAmount: actualCouponAmount,
        difference: couponDifference,
        items: couponCheckItems
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 print:hidden">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-orange-500">
              <CheckCircle2 size={15} />
              締め処理
            </div>
            <h2 className="mt-1 text-xl font-black text-gray-900">
              {dateKey} の締め確認
            </h2>
            <p className="mt-1 text-xs font-bold text-gray-400">
              金種とクーポン枚数を確認してから日計を保存します。
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
            aria-label="閉じる"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-100 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                    <Banknote size={17} />
                    現金確認
                </div>

                {cashDifference === 0 ? (
                    <div className="flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-600">
                    <CheckCircle2 size={14} />
                    差額なし
                    </div>
                ) : (
                    <div className="flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">
                    <AlertTriangle size={14} />
                    差額あり
                    </div>
                )}
                </div>

              <div className="mb-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-gray-50 p-3">
                  <div className="text-[11px] font-black text-gray-400">現金売上</div>
                  <div className="mt-1 text-lg font-black text-gray-900">
                    {formatCurrency(expectedCashAmount)}
                  </div>
                </div>

                <div className="rounded-xl bg-orange-50 p-3">
                  <div className="text-[11px] font-black text-orange-500">実査額</div>
                  <div className="mt-1 text-lg font-black text-gray-900">
                    {formatCurrency(actualCashAmount)}
                  </div>
                </div>

                <div className={`rounded-xl p-3 ${cashDifference === 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className={`text-[11px] font-black ${cashDifference === 0 ? 'text-green-600' : 'text-red-500'}`}>
                    差額
                </div>
                <div className={`mt-1 flex items-center gap-1 text-lg font-black ${cashDifference === 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {cashDifference === 0 && <CheckCircle2 size={17} />}
                    {cashDifference > 0 ? '+' : ''}
                    {formatCurrency(cashDifference)}
                </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {DENOMINATIONS.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3"
                  >
                    <span className="text-sm font-black text-gray-700">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={denominations[item.key]}
                        onChange={(event) => updateDenomination(item.key, event.target.value)}
                        className="h-10 w-20 rounded-xl border border-gray-200 bg-white px-3 text-right text-sm font-black text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                        placeholder="0"
                      />
                      <span className="text-xs font-bold text-gray-400">枚</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-100 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                    <TicketPercent size={17} />
                    クーポン確認
                </div>

                {couponDifference === 0 ? (
                    <div className="flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-600">
                    <CheckCircle2 size={14} />
                    差額なし
                    </div>
                ) : (
                    <div className="flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-600">
                    <AlertTriangle size={14} />
                    差額あり
                    </div>
                )}
                </div>

              <div className="mb-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-gray-50 p-3">
                  <div className="text-[11px] font-black text-gray-400">利用金額</div>
                  <div className="mt-1 text-lg font-black text-gray-900">
                    {formatCurrency(expectedCouponAmount)}
                  </div>
                </div>

                <div className="rounded-xl bg-orange-50 p-3">
                  <div className="text-[11px] font-black text-orange-500">実確認額</div>
                  <div className="mt-1 text-lg font-black text-gray-900">
                    {formatCurrency(actualCouponAmount)}
                  </div>
                </div>

                <div className={`rounded-xl p-3 ${couponDifference === 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className={`text-[11px] font-black ${couponDifference === 0 ? 'text-green-600' : 'text-red-500'}`}>
                    差額
                </div>
                <div className={`mt-1 flex items-center gap-1 text-lg font-black ${couponDifference === 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {couponDifference === 0 && <CheckCircle2 size={17} />}
                    {couponDifference > 0 ? '+' : ''}
                    {formatCurrency(couponDifference)}
                </div>
                </div>
              </div>

              <div className="space-y-2">
                {couponCheckItems.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-5 text-center text-xs font-bold text-gray-400">
                    クーポン・値引きの利用はありません
                  </div>
                ) : (
                  couponCheckItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl bg-gray-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-gray-800">
                            {item.name}
                          </div>
                          <div className="mt-1 text-[11px] font-bold text-gray-400">
                            システム：{item.expectedCount}件 / {formatCurrency(item.expectedAmount)}
                            {item.value > 0 && (
                              <span className="ml-2">
                                券面 {formatCurrency(item.value)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            value={couponCounts[item.id] || ''}
                            onChange={(event) => updateCouponCount(item.id, event.target.value)}
                            className="h-10 w-20 rounded-xl border border-gray-200 bg-white px-3 text-right text-sm font-black text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                            placeholder="0"
                          />
                          <span className="text-xs font-bold text-gray-400">枚</span>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs font-bold">
                        <span className="text-gray-400">
                          実確認額：{formatCurrency(item.actualAmount)}
                        </span>
                        <span className={`flex items-center gap-1 ${item.difference === 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {item.difference === 0 && <CheckCircle2 size={13} />}
                        差額：{item.difference > 0 ? '+' : ''}
                        {formatCurrency(item.difference)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

                {hasDifference ? (
                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-600">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <div>
                    現金またはクーポンに差額があります。内容を確認してから締め保存してください。
                    </div>
                </div>
                ) : (
                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-green-50 p-4 text-sm font-bold text-green-700">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                    <div>
                    現金・クーポンともに差額はありません。このまま締め保存できます。
                    </div>
                </div>
                )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-100 px-6 py-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="h-12 rounded-xl px-6 text-sm font-black text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            キャンセル
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gray-900 px-8 text-sm font-black text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isProcessing ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <CheckCircle2 size={17} />
            )}
            確認してこの日を締める
          </button>
        </div>
      </div>
    </div>
  );
};

export default DailyClosingCheckModal;