// TerminalPaymentModal.jsx
// カード端末決済の待機モーダル。useTerminalCardPayment の modal 状態で描画する。
// phase: starting|waiting|canceling|success|error
import React from 'react';

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString()}`;

const TerminalPaymentModal = ({ state, onCancel, onClose }) => {
  if (!state) return null;
  const { phase, amount, message } = state;

  const isBusy = phase === 'starting' || phase === 'waiting' || phase === 'canceling';
  const isError = phase === 'error';
  const isSuccess = phase === 'success';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
        {/* アイコン/スピナー */}
        <div className="mb-5 flex justify-center">
          {isBusy && (
            <div className="h-14 w-14 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          )}
          {isSuccess && (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">
              ✓
            </div>
          )}
          {isError && (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-3xl text-red-500">
              !
            </div>
          )}
        </div>

        <h2 className="text-lg font-black text-slate-900">
          {phase === 'starting' && '端末に送信中'}
          {phase === 'waiting' && 'カードでお支払い'}
          {phase === 'canceling' && '中止しています'}
          {phase === 'success' && '決済完了'}
          {phase === 'error' && '決済できませんでした'}
        </h2>

        {amount != null && (
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{yen(amount)}</p>
        )}

        {message && (
          <p className="mt-3 text-sm font-bold leading-relaxed text-slate-500">{message}</p>
        )}

        {/* 操作 */}
        <div className="mt-6">
          {phase === 'waiting' && (
            <button
              type="button"
              onClick={onCancel}
              className="h-11 w-full rounded-2xl bg-slate-100 text-sm font-black text-slate-600 transition active:scale-95 hover:bg-slate-200"
            >
              決済を中止
            </button>
          )}
          {isError && (
            <button
              type="button"
              onClick={onClose}
              className="h-11 w-full rounded-2xl bg-slate-900 text-sm font-black text-white transition active:scale-95"
            >
              閉じる
            </button>
          )}
          {(phase === 'starting' || phase === 'canceling') && (
            <p className="text-xs font-bold text-slate-300">しばらくお待ちください…</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TerminalPaymentModal;
