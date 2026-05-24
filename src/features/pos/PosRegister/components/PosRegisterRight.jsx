import React, { useMemo } from 'react';
import {
  CheckCircle,
  ChevronRight,
  CreditCard,
  Delete,
  DollarSign,
  LogOut,
  Percent,
  QrCode,
  ScanQrCode,
  ShoppingBag,
  Store
} from 'lucide-react';

const PAYMENT_METHOD_OPTIONS = [
  { id: 'cash', label: '現金', icon: DollarSign },
  { id: 'card', label: 'カード', icon: CreditCard },
  { id: 'qr', label: 'QR決済', icon: ScanQrCode }
];

export const PosRegisterRight = ({
  orders,
  subTotal,
  discountAmount,
  taxAmount,
  totalAmount,
  discountType,
  discountValue,
  selectedDiscount,
  selectedDiscountQuantity,
  paymentAmount,
  setPaymentAmount,
  paymentMethod,
  setPaymentMethod,
  allowedPaymentMethods,
  changeAmount,
  isEverythingTakeout,
  allowTakeout,
  issueReceipt,
  setIssueReceipt,
  recipientName,
  setRecipientName,
  selectedOrderIds,
  settings,
  consolidatedItems,
  takeoutItemKeys,
  setShowDiscountModal,
  handleBulkTakeout,
  showSuccessModal,
  showAbortModal,
  isPaymentSubmitting,
  handlePayment,
  handleAbortSession,
  tableId,
  tableDisplayName
}) => {
  const tableTitle = tableDisplayName || tableId || '';

  const taxLabel = useMemo(() => {
    const standardLabel = `${settings?.taxRate || 10}%`;
    const reducedLabel = `${settings?.taxRateReduced || 8}%`;
    if (!consolidatedItems || consolidatedItems.length === 0) return standardLabel;

    const allDetails = consolidatedItems.flatMap((item) => item.details || []);
    const takeoutCount = allDetails.filter((detail) => takeoutItemKeys.has(detail.key)).length;

    if (takeoutCount === allDetails.length && allowTakeout) return `軽減税率 ${reducedLabel}`;
    if (takeoutCount === 0 || !allowTakeout) return standardLabel;
    return '税率混在';
  }, [allowTakeout, consolidatedItems, settings, takeoutItemKeys]);

  const availablePaymentMethods = useMemo(
    () => PAYMENT_METHOD_OPTIONS.filter((option) => allowedPaymentMethods.includes(option.id)),
    [allowedPaymentMethods]
  );

  const handleNumClick = (value) => {
    if (value === 'clear') setPaymentAmount('');
    else if (value === 'backspace') setPaymentAmount((previous) => previous.slice(0, -1));
    else if (value === '00') setPaymentAmount((previous) => previous + '00');
    else setPaymentAmount((previous) => previous + value);
  };

  const handleQuickAdd = (amount) => {
    const current = parseInt(paymentAmount, 10) || 0;
    setPaymentAmount(String(current + amount));
  };

  const handleFullPayment = () => setPaymentAmount(String(totalAmount));

  const discountDisplayLabel = useMemo(() => {
  if (discountType === 'none') return '未設定';

  if (selectedDiscount?.name) {
    if (selectedDiscount.type === 'amount') {
      return `${selectedDiscount.name} × ${Number(selectedDiscountQuantity || 1)}枚`;
    }

    return selectedDiscount.name;
  }

  if (discountType === 'percent') {
    return `${Number(discountValue) || 0}%割引`;
  }

  if (discountType === 'amount') {
    return `¥${Number(discountValue || 0).toLocaleString()} 値引き`;
  }

  return '未設定';
}, [discountType, discountValue, selectedDiscount, selectedDiscountQuantity]);

  const isPaymentDisabled =
    (orders.length > 0 && selectedOrderIds.size === 0)
    || (paymentMethod === 'cash' && (parseInt(paymentAmount, 10) || 0) < totalAmount);

  return (
    <div className="relative flex h-full w-5/12 flex-col bg-white">
      <div className="shrink-0 border-b border-gray-100 px-6 pb-4 pt-3">
        <h2 className="text-xl font-black text-gray-900">
          会計伝票
          {tableTitle && (
            <span className="ml-2 text-gray-500">
              {tableTitle}
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          注文内容と会計金額を確認できます。
        </p>
      </div>

      <div className="flex flex-grow flex-col overflow-y-auto p-6">
        <div className="mb-6 space-y-3">
          <div className="flex justify-between text-sm text-gray-500">
            <span>小計(税抜)</span>
            <span className="font-mono">¥{subTotal.toLocaleString()}</span>
          </div>

          <div className={`flex ${allowTakeout ? 'h-20' : 'h-20'} gap-3`}>
            <button
              onClick={() => setShowDiscountModal(true)}
              disabled={orders.length === 0}
              className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 p-3 transition-all ${
                discountType !== 'none'
                  ? 'border-orange-300 bg-orange-100 text-orange-900 hover:border-orange-500'
                  : 'border-orange-300 bg-orange-100 text-orange-700'
              }`}
            >
              <div className="mb-1 flex items-center gap-1">
                <Percent size={18} />
                <span className="text-sm font-bold">割引・値引き</span>
              </div>
              <span className="line-clamp-1 max-w-full text-xs font-bold text-orange-600">
                {discountDisplayLabel}
              </span>
            </button>

            {allowTakeout && (
              <button
                onClick={handleBulkTakeout}
                className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 p-3 shadow-sm transition-all ${
                  isEverythingTakeout
                    ? 'border-blue-300 bg-blue-100 text-blue-700 hover:border-blue-500'
                    : 'border-gray-300 bg-white text-gray-400 hover:border-blue-200 hover:bg-blue-50'
                }`}
              >
                <div className="mb-1 flex items-center gap-1">
                  {isEverythingTakeout ? <ShoppingBag size={18} /> : <Store size={18} />}
                  <span className="text-sm font-bold">テイクアウト</span>
                </div>
                <span className={`text-xs font-bold ${isEverythingTakeout ? 'text-blue-700' : 'text-gray-400'}`}>
                  {isEverythingTakeout
                    ? `軽減税率 ${settings?.taxRateReduced || 8}%`
                    : `標準税率 ${settings?.taxRate || 10}%`}
                </span>
              </button>
            )}
          </div>

          {discountAmount > 0 && (
            <div className="flex justify-between gap-3 text-sm text-red-500">
              <span className="min-w-0 truncate">
                {selectedDiscount?.name ? discountDisplayLabel : '割引・値引き'}
              </span>
              <span className="shrink-0 font-mono">-¥{discountAmount.toLocaleString()}</span>
            </div>
          )}

          <div className="flex justify-between text-sm font-bold text-blue-600">
            <span>消費税 ({taxLabel})</span>
            <span className="font-mono">¥{taxAmount.toLocaleString()}</span>
          </div>

          <div className="mt-2 border-t border-gray-100 pt-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="font-bold text-gray-600">合計(税込)</span>
              <span className="font-mono text-4xl font-bold tracking-tight text-gray-900">
                ¥{totalAmount.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-2 shadow-sm">
          <div className={`grid gap-2 ${availablePaymentMethods.length === 1 ? 'grid-cols-1' : availablePaymentMethods.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {availablePaymentMethods.map((method) => (
              <button
                key={method.id}
                onClick={() => setPaymentMethod(method.id)}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${
                  paymentMethod === method.id
                    ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100'
                    : 'bg-transparent text-gray-500 hover:bg-white/70 hover:text-blue-600'
                }`}
              >
                <method.icon size={15} />
                {method.label}
              </button>
            ))}
          </div>
        </div>

        {paymentMethod === 'cash' ? (
          <div className="flex flex-grow flex-col">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 p-4">
              <div>
                <p className="mb-1 text-xs font-bold text-gray-500">お預かり</p>
                <div className="flex items-baseline text-gray-900">
                  <span className="font-mono text-3xl font-bold">¥</span>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    className="w-40 bg-transparent font-mono text-3xl font-bold outline-none placeholder-gray-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="mb-1 text-xs font-bold text-gray-500">おつり</p>
                <div className={`whitespace-nowrap font-mono text-xl font-bold ${changeAmount < 0 ? 'text-red-500' : 'text-blue-600'}`}>
                  ¥{changeAmount.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-4 gap-2">
              {[1000, 5000, 10000].map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleQuickAdd(amount)}
                  className="rounded-lg border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600 shadow-sm transition-all hover:bg-gray-50"
                >
                  +{amount.toLocaleString()}
                </button>
              ))}
              <button
                onClick={handleFullPayment}
                className="rounded-lg border border-blue-600 bg-white py-2 text-xs font-bold text-blue-600 shadow-sm transition-all hover:bg-blue-50"
              >
                ちょうど
              </button>
            </div>

            <div className="grid min-h-[200px] flex-grow grid-cols-3 gap-2">
              {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((number) => (
                <button
                  key={number}
                  onClick={() => handleNumClick(String(number))}
                  className="rounded-xl border border-gray-200 bg-white text-xl font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
                >
                  {number}
                </button>
              ))}
              <button
                onClick={() => handleNumClick('00')}
                className="rounded-xl border border-gray-200 bg-white text-lg font-bold text-gray-600 shadow-sm"
              >
                00
              </button>
              <button
                onClick={() => handleNumClick('0')}
                className="rounded-xl border border-gray-200 bg-white text-xl font-bold text-gray-700 shadow-sm"
              >
                0
              </button>
              <button
                onClick={() => handleNumClick('backspace')}
                className="flex items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-500 shadow-sm transition-all hover:bg-red-100"
              >
                <Delete size={24} />
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 flex flex-grow flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-400">
            {paymentMethod === 'card' && <CreditCard size={48} className="mb-2 opacity-50" />}
            {paymentMethod === 'qr' && <QrCode size={48} className="mb-2 opacity-50" />}
            <p className="text-sm">端末で決済を完了してください</p>
          </div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={issueReceipt}
              onChange={(event) => setIssueReceipt(event.target.checked)}
              className="h-5 w-5 rounded text-gray-800"
            />
            <span className="text-sm font-bold text-gray-600">領収書を発行する</span>
            {issueReceipt && (
              <input
                type="text"
                placeholder="宛名 (任意)"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
                className="flex-grow border-b border-gray-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500"
                onClick={(event) => event.stopPropagation()}
              />
            )}
          </label>
        </div>
      </div>

      <div className="border-t border-gray-200 bg-gray-50 p-4">
        <div className="space-y-3">
          {orders.length > 0 && (
            <button
              onClick={handlePayment}
              disabled={isPaymentDisabled}
              className={`flex w-full items-center justify-center gap-3 rounded-xl py-4 text-xl font-bold shadow-lg transition-all active:scale-[0.98] ${
                isPaymentDisabled
                  ? 'bg-gray-300 text-gray-500'
                  : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-xl'
              }`}
            >
              <CheckCircle size={24} />
              {selectedOrderIds.size === orders.length
                ? `¥${totalAmount.toLocaleString()} を会計する`
                : `選択分 ¥${totalAmount.toLocaleString()} を会計する`}
              <ChevronRight size={24} className="opacity-50" />
            </button>
          )}

          {orders.length === 0 && !isPaymentSubmitting && !showSuccessModal && !showAbortModal && (
            <div>
              <button
                type="button"
                onClick={handleAbortSession}
                className="flex w-full items-center justify-center gap-3 rounded-xl bg-red-500 py-4 text-xl font-bold text-white shadow-lg transition-all hover:bg-red-600 active:scale-[0.98]"
              >
                <LogOut size={24} />
                退店処理
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
