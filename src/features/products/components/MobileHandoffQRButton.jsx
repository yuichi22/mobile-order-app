import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { httpsCallable } from 'firebase/functions';
import { QrCode, X } from 'lucide-react';
import { functionsApi } from '../../../shared/api/firebase/client';

// PCで表示 → スマホのカメラで読むと、スマホ用の下げ札登録ページが自動ログインで開く。
// createRegisterHandoff でワンタイムコード(5分有効)を発行し、QRに埋める。

export default function MobileHandoffQRButton({ storeId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  const issue = async () => {
    if (!storeId) { setError('店舗が特定できません。'); return; }
    setLoading(true);
    setError('');
    setUrl('');
    try {
      const call = httpsCallable(functionsApi, 'createRegisterHandoff');
      const res = await call({ storeId });
      const code = res.data?.code;
      if (!code) throw new Error('コードの発行に失敗しました。');
      setUrl(`${window.location.origin}/m/tag-register?h=${encodeURIComponent(code)}`);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => { setOpen(true); issue(); };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex h-9 items-center gap-2 rounded-lg border-2 border-slate-400 bg-white px-3 text-sm font-black text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95"
      >
        <QrCode size={16} />
        モバイル用QRを表示
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-black text-slate-800">スマホで続ける</div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
              {loading && <div className="text-sm text-slate-400">QRを発行しています…</div>}
              {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</div>}
              {url && !loading && (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <QRCodeSVG value={url} size={200} level="M" includeMargin />
                  </div>
                  <div className="text-center text-xs text-slate-500">
                    スマホのカメラでこのQRを読み取ってください。<br />
                    下げ札の撮影・登録がスマホでできます（有効期限5分・一度きり）。
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={issue}
              disabled={loading}
              className="mt-3 h-10 w-full rounded-lg bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
            >
              QRを再発行
            </button>
          </div>
        </div>
      )}
    </>
  );
}
