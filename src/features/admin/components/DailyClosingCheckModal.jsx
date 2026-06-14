import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  QrCode,
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


const NumericInputModal = ({
  isOpen,
  title,
  description,
  value,
  suffix = '',
  onChange,
  onClose,
  onConfirm
}) => {
  if (!isOpen) return null;

  const normalizedValue = String(value || '');

  const appendValue = (nextValue) => {
    const merged = `${normalizedValue}${nextValue}`.replace(/^0+(?=\d)/, '');
    onChange(merged);
  };

  const removeLast = () => {
    onChange(normalizedValue.slice(0, -1));
  };

  const clearValue = () => {
    onChange('');
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-black text-orange-500">
              数字入力
            </div>
            <h3 className="mt-1 truncate text-lg font-black text-gray-900">
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-xs font-bold text-gray-400">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-4 rounded-2xl bg-gray-50 px-4 py-4 text-right">
            <div className="min-h-[2.5rem] font-mono text-4xl font-black tracking-tight text-gray-900">
              {normalizedValue ? Number(normalizedValue).toLocaleString() : '0'}
              {suffix && (
                <span className="ml-1 text-base font-black text-gray-400">
                  {suffix}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => appendValue(key)}
                className="h-14 rounded-2xl bg-gray-100 text-xl font-black text-gray-900 transition-colors hover:bg-gray-200 active:scale-[0.98]"
              >
                {key}
              </button>
            ))}

            <button
              type="button"
              onClick={removeLast}
              className="h-14 rounded-2xl bg-gray-100 text-lg font-black text-gray-700 transition-colors hover:bg-gray-200 active:scale-[0.98]"
            >
              ←
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={clearValue}
              className="h-12 rounded-2xl bg-gray-100 text-sm font-black text-gray-600 transition-colors hover:bg-gray-200"
            >
              クリア
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="h-12 rounded-2xl bg-gray-900 text-sm font-black text-white transition-colors hover:bg-black"
            >
              決定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const DailyClosingCheckModal = ({
  isOpen,
  dateKey,
  summary,
  discountList = [],
  changeFundAmount = 0,
  closedDailyData = null,
  onSaveChangeFundAmount,
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
  const expectedCardAmount = Number(summary?.cardSales || 0);
  const expectedQrAmount = Number(summary?.qrSales || 0);
  const expectedCouponAmount = Number(summary?.discountTotal || 0);

  const [cardActualAmountInput, setCardActualAmountInput] = useState('');
  const [qrActualAmountInput, setQrActualAmountInput] = useState('');
  const [numericModal, setNumericModal] = useState(null);
  const [isEditingChangeFund, setIsEditingChangeFund] = useState(false);
  const [changeFundAmountInput, setChangeFundAmountInput] = useState(() => String(Number(changeFundAmount || 0) || ''));
  useEffect(() => {
    if (!isOpen) return;

    const savedCashCheck = closedDailyData?.cashCheck || null;
    const savedCouponCheck = closedDailyData?.couponCheck || null;
    const savedExternalPaymentCheck = closedDailyData?.externalPaymentCheck || null;

    setDenominations(
      DENOMINATIONS.reduce((acc, item) => {
        const savedValue = savedCashCheck?.denominations?.[item.key];
        acc[item.key] = savedValue === undefined || savedValue === null || Number(savedValue) === 0
          ? ''
          : String(savedValue);
        return acc;
      }, {})
    );

    setCouponCounts(
      discountList.reduce((acc, discount, index) => {
        const id = discount.id || discount.name || `discount_${index}`;
        const savedItem = Array.isArray(savedCouponCheck?.items)
          ? savedCouponCheck.items.find((item) => item?.id === id)
          : null;
        const savedValue = savedItem?.actualCount;
        acc[id] = savedValue === undefined || savedValue === null || Number(savedValue) === 0
          ? ''
          : String(savedValue);
        return acc;
      }, {})
    );

    const savedCardAmount = savedExternalPaymentCheck?.actualCardAmount;
    const savedQrAmount = savedExternalPaymentCheck?.actualQrAmount;

    setCardActualAmountInput(
      savedCardAmount === undefined || savedCardAmount === null || Number(savedCardAmount) === 0
        ? ''
        : String(savedCardAmount)
    );

    setQrActualAmountInput(
      savedQrAmount === undefined || savedQrAmount === null || Number(savedQrAmount) === 0
        ? ''
        : String(savedQrAmount)
    );

    setChangeFundAmountInput(String(Number(changeFundAmount || 0) || ''));
    setIsEditingChangeFund(false);
  }, [isOpen, closedDailyData, discountList, changeFundAmount]);

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
  const actualCardAmount = toNumber(cardActualAmountInput);
  const actualQrAmount = toNumber(qrActualAmountInput);
  const normalizedChangeFundAmount = Math.max(Math.round(Number(changeFundAmount || 0) || 0), 0);
  const expectedDrawerAmount = expectedCashAmount + normalizedChangeFundAmount;

  const cashDifference = actualCashAmount - expectedDrawerAmount;
  const cardDifference = actualCardAmount - expectedCardAmount;
  const qrDifference = actualQrAmount - expectedQrAmount;
  const couponDifference = actualCouponAmount - expectedCouponAmount;

  const hasDifference =
    cashDifference !== 0 ||
    cardDifference !== 0 ||
    qrDifference !== 0 ||
    couponDifference !== 0;

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

  const openNumericModal = ({ target, title, description = '', value = '', suffix = '' }) => {
    setNumericModal({
      target,
      title,
      description,
      value: String(value || ''),
      suffix
    });
  };

  const updateNumericModalValue = (value) => {
    setNumericModal((previous) => previous ? {
      ...previous,
      value: String(value || '').replace(/[^0-9]/g, '')
    } : previous);
  };

  const applyNumericModalValue = () => {
    if (!numericModal) return;

    const nextValue = String(numericModal.value || '').replace(/[^0-9]/g, '');
    const target = numericModal.target || {};

    if (target.type === 'denomination') updateDenomination(target.key, nextValue);
    if (target.type === 'coupon') updateCouponCount(target.id, nextValue);
    if (target.type === 'card') setCardActualAmountInput(nextValue);
    if (target.type === 'qr') setQrActualAmountInput(nextValue);
    if (target.type === 'changeFund') setChangeFundAmountInput(nextValue);

  };

  const handleSaveChangeFund = async () => {
    if (!onSaveChangeFundAmount) return;

    const normalizedAmount = Math.max(Math.round(Number(changeFundAmountInput) || 0), 0);
    await onSaveChangeFundAmount(normalizedAmount);
    setChangeFundAmountInput(String(normalizedAmount || ''));
    setIsEditingChangeFund(false);
  };

  const handleConfirm = () => {
    if (hasDifference) {
      const ok = window.confirm(
        '現金・カード・QR決済・クーポンのいずれかに差額があります。この内容で締め保存しますか？'
      );

      if (!ok) return;
    }

    onConfirm({
      cashCheck: {
        expectedCashAmount,
        expectedDrawerAmount,
        changeFundAmount: normalizedChangeFundAmount,
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
      },
      externalPaymentCheck: {
        expectedCardAmount,
        actualCardAmount,
        cardDifference,
        expectedQrAmount,
        actualQrAmount,
        qrDifference,
        difference: cardDifference + qrDifference
      }
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 print:hidden">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
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
              金種・カード端末・QR決済サイト・クーポン枚数を確認してから日計を保存します。
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-gray-100 p-4 xl:col-start-1 xl:row-start-1">
                <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                    <Banknote size={17} />
                    レジ金確認
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
                  <div className="mt-1 text-[10px] font-bold text-gray-400">
                    レジ金 {formatCurrency(normalizedChangeFundAmount)}
                  </div>
                </div>

                <div className="rounded-xl bg-orange-50 p-3">
                  <div className="text-[11px] font-black text-orange-500">実査額</div>
                  <div className="mt-1 text-lg font-black text-gray-900">
                    {formatCurrency(actualCashAmount)}
                  </div>
                  <div className="mt-1 text-[10px] font-bold text-orange-500">
                    期待額 {formatCurrency(expectedDrawerAmount)}
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

              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-black text-gray-400">釣り銭用レジ金</div>
                    <div className="mt-0.5 text-base font-black text-gray-900">
                      {formatCurrency(normalizedChangeFundAmount)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setChangeFundAmountInput(String(normalizedChangeFundAmount || ''));
                      setIsEditingChangeFund((previous) => !previous);
                    }}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-black text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
                  >
                    変更
                  </button>
                </div>

                {isEditingChangeFund && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      readOnly
                      value={changeFundAmountInput}
                      onClick={() => openNumericModal({
                        target: { type: 'changeFund' },
                        title: '釣り銭用レジ金',
                        description: '毎日使う釣り銭用のレジ金を入力してください',
                        value: changeFundAmountInput,
                        suffix: '円'
                      })}
                      className="h-9 min-w-0 flex-1 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-right text-sm font-black text-gray-900 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-100"
                      placeholder="100000"
                    />
                    <button
                      type="button"
                      onClick={handleSaveChangeFund}
                      className="h-9 rounded-xl bg-gray-900 px-4 text-xs font-black text-white hover:bg-black"
                    >
                      保存
                    </button>
                  </div>
                )}
              </div>

            </section>

            <section className="rounded-2xl border border-gray-100 p-4 xl:col-start-2 xl:row-start-1">
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
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            readOnly
                            value={couponCounts[item.id] || ''}
                            onClick={() => openNumericModal({
                              target: { type: 'coupon', id: item.id },
                              title: `${item.name}の枚数`,
                              description: 'クーポン・値引きの確認枚数を入力してください',
                              value: couponCounts[item.id] || '',
                              suffix: '枚'
                            })}
                            className="h-7 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white px-2 text-right text-xs font-black text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                            placeholder="0"
                          />
                          <span className="text-[9px] font-bold text-gray-400">枚</span>
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
             <section className="rounded-2xl border border-gray-100 p-2.5 xl:col-start-1 xl:row-start-2 xl:row-span-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                  <Banknote size={16} />
                  金種入力
                </div>
                <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-500">
                  実査額 {formatCurrency(actualCashAmount)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {DENOMINATIONS.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5"
                  >
                    <span className="text-[11px] font-black text-gray-700">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        readOnly
                        value={denominations[item.key]}
                        onClick={() => openNumericModal({
                          target: { type: 'denomination', key: item.key },
                          title: `${item.label}の枚数`,
                          description: '金種枚数を入力してください',
                          value: denominations[item.key],
                          suffix: '枚'
                        })}
                        className="h-10 w-20 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-right text-sm font-black text-gray-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                        placeholder="0"
                      />
                      <span className="text-xs font-bold text-gray-400">枚</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="flex h-full flex-col rounded-2xl border border-blue-100 bg-blue-50/30 p-4 xl:col-start-2 xl:row-start-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-blue-800">
                  <CreditCard size={17} />
                  カード端末確認
                </div>

                {cardDifference === 0 ? (
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

              <div className={`mb-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-black ${
                cardDifference === 0
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-red-50 text-red-600'
              }`}>
                <span className="shrink-0">
                  システム {formatCurrency(expectedCardAmount)}
                </span>
                <span className="shrink-0">
                  端末 {formatCurrency(actualCardAmount)}
                </span>
                <span className="shrink-0">
                  差額 {cardDifference > 0 ? '+' : ''}{formatCurrency(cardDifference)}
                </span>
              </div>

              <label className="mt-auto block">
                <span className="mb-2 block text-xs font-black text-blue-700">
                  カード端末の決済合計
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  readOnly
                  value={cardActualAmountInput}
                  onClick={() => openNumericModal({
                    target: { type: 'card' },
                    title: 'カード端末の決済合計',
                    description: 'カード端末側の合計金額を入力してください',
                    value: cardActualAmountInput,
                    suffix: '円'
                  })}
                  className="h-12 w-full cursor-pointer rounded-xl border border-blue-100 bg-white px-4 text-right text-lg font-black text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="0"
                />
              </label>
            </section>

            <section className="flex h-full flex-col rounded-2xl border border-purple-100 bg-purple-50/30 p-4 xl:col-start-2 xl:row-start-3">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-purple-800">
                  <QrCode size={17} />
                  QR決済確認
                </div>

                {qrDifference === 0 ? (
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

              <div className={`mb-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-black ${
                qrDifference === 0
                  ? 'bg-purple-50 text-purple-700'
                  : 'bg-red-50 text-red-600'
              }`}>
                <span className="shrink-0">
                  システム {formatCurrency(expectedQrAmount)}
                </span>
                <span className="shrink-0">
                  サイト {formatCurrency(actualQrAmount)}
                </span>
                <span className="shrink-0">
                  差額 {qrDifference > 0 ? '+' : ''}{formatCurrency(qrDifference)}
                </span>
              </div>

              <label className="mt-auto block">
                <span className="mb-2 block text-xs font-black text-purple-700">
                  QR決済サイトの集計金額
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  readOnly
                  value={qrActualAmountInput}
                  onClick={() => openNumericModal({
                    target: { type: 'qr' },
                    title: 'QR決済サイトの集計金額',
                    description: 'QR決済サイト側の合計金額を入力してください',
                    value: qrActualAmountInput,
                    suffix: '円'
                  })}
                  className="h-12 w-full cursor-pointer rounded-xl border border-purple-100 bg-white px-4 text-right text-lg font-black text-gray-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  placeholder="0"
                />
              </label>
            </section>

         </div>

                {hasDifference ? (
                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-600">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <div>
                    現金・カード・QR決済・クーポンのいずれかに差額があります。内容を確認してから締め保存してください。
                    </div>
                </div>
                ) : (
                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-green-50 p-4 text-sm font-bold text-green-700">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                    <div>
                    現金・カード・QR決済・クーポンともに差額はありません。このまま締め保存できます。
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

      <NumericInputModal
        isOpen={Boolean(numericModal)}
        title={numericModal?.title || ''}
        description={numericModal?.description || ''}
        value={numericModal?.value || ''}
        suffix={numericModal?.suffix || ''}
        onChange={updateNumericModalValue}
        onClose={() => setNumericModal(null)}
        onConfirm={applyNumericModalValue}
      />
    </>
  );
};

export default DailyClosingCheckModal;