// StoreTerminalLinkPanel.jsx
// スーパー管理: mobile_order の店舗を Core(Stripe Terminal)の tenant/space に紐付ける。
// stores/{storeId}/settings/terminal = { coreTenantId, coreSpaceId } を編集する。
// この紐付けが済むと、店舗オーナーは基本設定で各レジにリーダーを割り当てられる。
import React, { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../shared/api/firebase/client';

const str = (v) => String(v ?? '').trim();

const StoreTerminalLinkPanel = ({ storeId }) => {
  const [coreTenantId, setCoreTenantId] = useState('');
  const [coreSpaceId, setCoreSpaceId] = useState('');
  const [state, setState] = useState('loading'); // loading|ready|saving|saved|error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      setState('loading');
      try {
        const snap = await getDoc(doc(db, 'stores', storeId, 'settings', 'terminal'));
        if (cancelled) return;
        const d = snap.exists() ? snap.data() || {} : {};
        setCoreTenantId(str(d.coreTenantId));
        setCoreSpaceId(str(d.coreSpaceId));
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        setState('error');
        setMessage('読み込みに失敗しました。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const handleSave = async () => {
    setState('saving');
    setMessage('');
    try {
      await setDoc(
        doc(db, 'stores', storeId, 'settings', 'terminal'),
        {
          coreTenantId: str(coreTenantId) || null,
          coreSpaceId: str(coreSpaceId) || null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setState('saved');
      setMessage(str(coreTenantId) && str(coreSpaceId) ? '連携しました。' : '連携を解除しました。');
    } catch (e) {
      setState('error');
      setMessage('保存に失敗しました。');
    }
  };

  const linked = str(coreTenantId) && str(coreSpaceId);

  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
          Stripe端末連携（Core tenant/space）
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            linked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
          }`}
        >
          {linked ? '連携済み' : '未連携'}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <input
          value={coreTenantId}
          onChange={(e) => setCoreTenantId(e.target.value)}
          placeholder="coreTenantId（例: suomi）"
          disabled={state === 'loading'}
          className="h-10 w-full rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-900 disabled:opacity-50"
        />
        <input
          value={coreSpaceId}
          onChange={(e) => setCoreSpaceId(e.target.value)}
          placeholder="coreSpaceId（Core上の拠点ID）"
          disabled={state === 'loading'}
          className="h-10 w-full rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-900 disabled:opacity-50"
        />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={state === 'loading' || state === 'saving'}
          className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-black text-white transition active:scale-95 disabled:opacity-50"
        >
          {state === 'saving' ? '保存中…' : '保存'}
        </button>
        {message && (
          <span
            className={`text-xs font-bold ${state === 'error' ? 'text-red-500' : 'text-emerald-600'}`}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
};

export default StoreTerminalLinkPanel;
