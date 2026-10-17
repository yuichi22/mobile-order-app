import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, X } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';
import { describeDrawerError, openCashDrawer } from '../../../shared/utils/receiptPrinting';

// 会計なしでキャッシュドロワーを開く【10-17】。iPadアプリ・店長以上だけに出す(表示判定は呼び出し側)。
// 会計を伴わない開放は現金管理の穴になるため、理由を選ばせて stores/{storeId}/cashDrawerLogs に残す
// (開けなかった試行も ok:false で残す)。日計の現金差額を確かめるときの手がかり。
const REASONS = [
  { id: 'exchange', label: '両替' },
  { id: 'change_fund', label: '釣銭補充' },
  { id: 'other', label: 'その他' }
];

const CashDrawerButton = ({ storeId, user, settings, mode, onResult }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('exchange');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setReason('exchange');
    setNote('');
  };

  const handleOpen = async () => {
    if (busy) return;
    setBusy(true);
    let error = null;
    try {
      await openCashDrawer({ settings, mode });
    } catch (err) {
      error = err;
    }
    try {
      await addDoc(collection(db, 'stores', storeId, 'cashDrawerLogs'), {
        type: 'manual',
        reason,
        reasonLabel: REASONS.find((r) => r.id === reason)?.label || reason,
        note: reason === 'other' ? note.trim() : '',
        ok: !error,
        error: error ? describeDrawerError(error) : '',
        registerMode: mode || 'pos',
        uid: user?.uid || '',
        userName: user?.displayName || user?.email || '',
        createdAt: serverTimestamp()
      });
    } catch (logError) {
      console.error('[cash drawer log error]', logError);
    }
    setBusy(false);
    setOpen(false);
    setNote('');
    onResult?.(error
      ? { type: 'error', message: 'ドロワーを開けませんでした', description: describeDrawerError(error) }
      : { type: 'success', message: 'ドロワーを開きました' });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 shrink-0 items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-4 text-sm font-black text-gray-700 transition-colors hover:bg-gray-50 active:scale-95"
      >
        <Archive size={18} strokeWidth={2.5} />
        ドロワーを開く
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900">ドロワーを開く</h2>
              <button type="button" onClick={close} aria-label="閉じる" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                <X size={18} />
              </button>
            </div>
            <p className="mb-3 text-xs font-bold text-gray-500">開ける理由を選んでください。日時・操作した人と一緒に記録します。</p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReason(r.id)}
                  className={`h-12 rounded-2xl text-sm font-black transition-colors ${reason === r.id ? 'bg-ui text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {reason === 'other' && (
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="理由(任意)"
                className="mb-3 h-12 w-full rounded-2xl border-2 border-gray-200 px-4 text-sm font-bold text-gray-700 outline-none focus:border-ui"
              />
            )}
            <button
              type="button"
              onClick={handleOpen}
              disabled={busy}
              className="h-14 w-full rounded-2xl bg-gray-900 text-base font-black text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? '開いています…' : 'ドロワーを開く'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default CashDrawerButton;
