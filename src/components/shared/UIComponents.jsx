import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Minus, Plus, QrCode, UserPlus, X } from 'lucide-react';

import { getAllergenLabel } from '../../shared/constants/menuMetadata';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { calculateItemTotal } from '../../shared/utils/money';

export const CircleYen = ({ size = 24, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 7l4 5 4-5" />
    <path d="M12 17v-5" />
    <path d="M8 12h8" />
    <path d="M8 15h8" />
  </svg>
);

export const NotificationToast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3000);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full px-6 py-3 shadow-xl animate-in slide-in-from-top-4 fade-in duration-300 ${
        type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
      }`}
    >
      {type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
      <span className="text-sm font-bold">{message}</span>
    </div>
  );
};

export const QRGenerator = () => {
  const [tableNum, setTableNum] = useState('1');
  const mockUrl = `${window.location.origin}${window.location.pathname}?start_table=${tableNum}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mockUrl)}`;

  return (
    <div className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <QrCode /> テーブル用QRコード生成
      </h3>
      <div className="mb-6 flex items-end gap-4">
        <label className="flex-grow">
          <span className="mb-1 block text-sm font-bold text-gray-700">テーブル番号</span>
          <input
            type="number"
            value={tableNum}
            onChange={(event) => setTableNum(event.target.value)}
            className="w-full rounded-lg border p-2"
          />
        </label>
        <button
          onClick={() => window.print()}
          className="mb-[1px] rounded-lg bg-gray-800 px-4 py-2 font-bold text-white"
        >
          印刷する
        </button>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 print:border-none print:bg-white">
        <p className="mb-4 text-xl font-bold">テーブル {tableNum}</p>
        <img src={qrApiUrl} alt="テーブル用QRコード" className="mb-4 h-48 w-48 mix-blend-multiply" />
        <p className="break-all text-center font-mono text-xs text-gray-500 opacity-50">{mockUrl}</p>
        <p className="mt-2 text-xs text-red-500">読み取り時は最新のURLを利用してください。</p>
      </div>
    </div>
  );
};

export const OptionsModal = ({
  item,
  onClose,
  onConfirm,
  isOrderingDisabled = false,
  orderingDisabledMessage = 'ただいま注文を受け付けていません'
}) => {
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState([]);

  if (!item) return null;

  const currentPrice = calculateItemTotal(item.price, selectedOptions);
  const isLimitedItem = Number.isFinite(item.remainingQuantity);
  const isSoldOut = item.isSoldOut;
  const quantityDisabled = isOrderingDisabled || isSoldOut;
  const maxQuantity = isLimitedItem ? Math.max(item.remainingQuantity, 1) : null;

  const toggleOption = (option) => {
    const optionId = option.id || option.name;
    setSelectedOptions((previous) => (
      previous.some((selected) => (selected.id || selected.name) === optionId)
        ? previous.filter((selected) => (selected.id || selected.name) !== optionId)
        : [...previous, option]
    ));
  };

  const handleConfirm = () => {
    if (quantityDisabled) return;
    onConfirm(item, quantity, selectedOptions);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="shrink-0 border-b bg-gray-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-900">{item.name}</h3>
              {item.description && (
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{item.description}</p>
              )}
            </div>
            <button onClick={onClose} className="rounded-2xl p-2 text-gray-400 transition-colors hover:bg-white hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-grow overflow-y-auto p-4">
          <div className="mb-5 space-y-3">
            {item.allowsTakeout === false && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                店内のみ
              </span>
            )}

            {isLimitedItem && (
              <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold ${
                item.remainingQuantity > 0
                  ? 'bg-orange-50 text-orange-700'
                  : 'bg-red-50 text-red-600'
              }`}>
                {item.remainingQuantity > 0
                  ? `本日の残り ${item.remainingQuantity} 点`
                  : '本日分は売り切れました'}
              </span>
            )}

            {item.allergens?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {item.allergens.map((allergenId) => (
                  <span
                    key={allergenId}
                    className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700"
                  >
                    {getAllergenLabel(allergenId)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {item.options?.length > 0 ? (
            item.options.map((option, index) => (
              <label
                key={index}
                className="mb-2 flex cursor-pointer items-center justify-between rounded-2xl border p-3 transition-colors hover:bg-orange-50"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedOptions.some(
                      (selected) => (selected.id || selected.name) === (option.id || option.name)
                    )}
                    onChange={() => toggleOption(option)}
                    className="h-5 w-5 rounded text-orange-500 focus:ring-orange-500"
                  />
                  <span>{option.name}</span>
                </div>
                <span className="text-sm text-gray-500">+¥{option.price}</span>
              </label>
            ))
          ) : (
            <p className="py-4 text-center text-gray-400">追加オプションはありません</p>
          )}

          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantityDisabled}
              className="flex h-12 w-12 items-center justify-center rounded-full border transition-colors hover:bg-gray-100 disabled:opacity-40"
            >
              <Minus size={20} />
            </button>
            <span className="w-12 text-center text-2xl font-bold">{quantity}</span>
            <button
              onClick={() => {
                if (maxQuantity && quantity >= maxQuantity) return;
                setQuantity(quantity + 1);
              }}
              disabled={quantityDisabled || (maxQuantity != null && quantity >= maxQuantity)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white transition-colors hover:bg-gray-700 disabled:bg-gray-300"
            >
              <Plus size={20} />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-t bg-gray-50 p-4">
          {isOrderingDisabled && (
            <p className="mb-3 text-sm font-bold text-red-500">{orderingDisabledMessage}</p>
          )}
          {isSoldOut && (
            <p className="mb-3 text-sm font-bold text-red-500">この商品は現在売り切れです。</p>
          )}
          <button
            onClick={handleConfirm}
            disabled={quantityDisabled}
            className={`w-full rounded-[1.6rem] py-3 font-bold shadow-lg transition-colors ${
              quantityDisabled
                ? 'bg-gray-300 text-gray-500 shadow-none'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            追加する (¥{(currentPrice * quantity).toLocaleString()})
          </button>
        </div>
      </div>
    </div>
  );
};

const InviteQrContent = ({ qrApiUrl }) => {
  const [isQrImageLoaded, setIsQrImageLoaded] = useState(false);

  return (
    <div className="mb-4 flex h-52 w-52 items-center justify-center rounded-xl border-2 border-orange-100 bg-white p-2">
      {qrApiUrl && (
        <img
          src={qrApiUrl}
          alt="参加用QRコード"
          className={`h-48 w-48 mix-blend-multiply ${isQrImageLoaded ? 'block' : 'hidden'}`}
          onLoad={() => setIsQrImageLoaded(true)}
        />
      )}
      {(!qrApiUrl || !isQrImageLoaded) && (
        <div className="flex h-48 w-48 items-center justify-center text-orange-600">
          <LoadingSpinner size={32} />
        </div>
      )}
    </div>
  );
};

export const InviteModal = ({ qrApiUrl, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-gray-100 p-1">
          <X size={20} className="text-gray-500" />
        </button>
        <div className="flex flex-col items-center p-8 text-center">
          <h3 className="mb-2 flex items-center gap-2 text-xl font-bold text-orange-600">
            <UserPlus size={24} /> 同席者用QRコード
          </h3>
          <p className="mb-6 text-sm text-gray-500">
            同席の方に読み取っていただくと、
            <br />
            同じテーブルで一緒に注文できます。
          </p>
          <InviteQrContent key={qrApiUrl || 'loading'} qrApiUrl={qrApiUrl} />
        </div>
      </div>
    </div>
  );
};
