import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// window.confirm 代替の Promise ベース確認ダイアログ。
// AppConfirmHost をアプリルート(App.jsx)に1つだけマウントし、
// 任意の場所から `if (!(await appConfirm('メッセージ'))) return;` の形で使う。
// options: { title, okLabel, cancelLabel, tone: 'default' | 'danger' }

let hostListener = null;

// eslint-disable-next-line react-refresh/only-export-components -- ホストと呼び出しAPIは同一モジュール変数を共有するため同居させる
export const appConfirm = (message, options = {}) => {
  // ホスト未マウント時(初期化前など)は従来の window.confirm にフォールバックする。
  if (!hostListener) {
    return Promise.resolve(window.confirm(String(message ?? '')));
  }

  return new Promise((resolve) => {
    hostListener({ message: String(message ?? ''), options, resolve });
  });
};

export const AppConfirmHost = () => {
  const [queue, setQueue] = useState([]);
  const current = queue[0] || null;

  useEffect(() => {
    hostListener = (request) => setQueue((prev) => [...prev, request]);
    return () => {
      hostListener = null;
    };
  }, []);

  const settle = (result) => {
    setQueue((prev) => {
      const [head, ...rest] = prev;
      head?.resolve(result);
      return rest;
    });
  };

  // native confirm と同じく Enter=OK / Escape=キャンセル。
  // ダイアログ表示中はキー入力を下のUI(バーコードスキャナ等)へ流さない。
  useEffect(() => {
    if (!current) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        settle(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        settle(true);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [current]);

  if (!current) return null;

  const {
    title = '確認',
    okLabel = 'OK',
    cancelLabel = 'キャンセル',
    tone = 'default'
  } = current.options || {};

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[1.5rem] bg-white shadow-2xl">
        <div className="px-6 pb-2 pt-5 text-base font-black text-slate-900">{title}</div>
        <div className="max-h-[55vh] overflow-y-auto whitespace-pre-line px-6 pb-5 text-sm font-bold leading-relaxed text-slate-600">
          {current.message}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3.5">
          <button
            type="button"
            onClick={() => settle(false)}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-200 px-5 text-sm font-black text-slate-600 transition hover:bg-slate-300"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => settle(true)}
            className={
              tone === 'danger'
                ? 'inline-flex h-11 items-center justify-center rounded-2xl bg-rose-500 px-6 text-sm font-black text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-600'
                : 'inline-flex h-11 items-center justify-center rounded-2xl bg-orange-500 px-6 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600'
            }
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
