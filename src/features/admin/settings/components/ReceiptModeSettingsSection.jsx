import React, { useEffect, useState } from 'react';
import { Check, Printer } from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { RECEIPT_PRINT_METHODS, buildReceiptModeDraft } from '../../../../shared/utils/receiptSettings';

const MODE_TABS = [
  { id: 'pos', label: 'POSレジ' },
  { id: 'order', label: 'ORDERレジ' }
];

// レジモード(POS共通 / ORDER共通)別のレシート設定。印刷方式・プリンタ・自動印刷・文言をモード別に保存する。
const ReceiptModeSettingsSection = ({ settings, onSave, onSaved }) => {
  const [activeMode, setActiveMode] = useState('pos');
  const [draft, setDraft] = useState(() => buildReceiptModeDraft(settings));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 設定が(遅延)読み込まれた/外部更新されたら下書きを同期する。編集中の頻繁な上書きは避けるため対象フィールドのみ依存。
    setDraft(buildReceiptModeDraft(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.receiptModeSettings, settings?.printerSettings]);

  const current = draft[activeMode] || {};
  const updateCurrent = (patch) => {
    setDraft((prev) => ({ ...prev, [activeMode]: { ...prev[activeMode], ...patch } }));
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ ...settings, receiptModeSettings: draft });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const isBrowser = current.printMethod === 'browser';

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Printer size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tight text-gray-900">レシート設定（レジモード別）</h3>
            <p className="mt-0.5 text-xs font-bold text-gray-400">
              POSレジ・ORDERレジで、印刷方式・プリンタ・自動印刷・文言を分けて設定できます。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-black active:scale-95 disabled:opacity-60"
        >
          {saving ? <LoadingSpinner size={16} /> : <Check size={16} />}
          保存
        </button>
      </div>

      <div className="mb-5 inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveMode(tab.id)}
            className={`h-9 rounded-full px-5 text-sm font-black transition-all ${
              activeMode === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-[11px] font-black uppercase tracking-wider text-gray-400">印刷方式</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {RECEIPT_PRINT_METHODS.map((method) => {
              const active = current.printMethod === method.id;
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => updateCurrent({ printMethod: method.id })}
                  className={`rounded-2xl border-2 p-4 text-left transition-all ${
                    active ? 'border-slate-900 bg-slate-50' : 'border-gray-100 bg-white hover:border-gray-200'
                  }`}
                >
                  <div className="text-sm font-black text-gray-900">{method.label}</div>
                  <div className="mt-1 text-[11px] font-bold leading-relaxed text-gray-400">{method.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {isBrowser ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold leading-relaxed text-blue-700">
            iPad等のSafariからAirPrint対応プリンタへ印刷します。会計後または取引履歴の「レシート」ボタンで印刷ダイアログが開きます。
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">印刷ブリッジURL</span>
              <input
                value={current.bridgeUrl || ''}
                onChange={(event) => updateCurrent({ bridgeUrl: event.target.value })}
                placeholder="http://localhost:8787"
                className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">プリンタIP</span>
              <input
                value={current.printerIp || ''}
                onChange={(event) => updateCurrent({ printerIp: event.target.value })}
                placeholder="192.168.0.100"
                className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ポート</span>
              <input
                type="number"
                value={current.printerPort ?? 9100}
                onChange={(event) => updateCurrent({ printerPort: Number(event.target.value) || 9100 })}
                placeholder="9100"
                className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
              />
            </label>
          </div>
        )}

        <label className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3">
          <input
            type="checkbox"
            checked={Boolean(current.autoPrint)}
            onChange={(event) => updateCurrent({ autoPrint: event.target.checked })}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span className="text-sm font-black text-gray-700">会計時に自動でレシートを印刷する</span>
        </label>

        <div className="grid gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ヘッダー文言（任意）</span>
            <input
              value={current.headerTitle || ''}
              onChange={(event) => updateCurrent({ headerTitle: event.target.value })}
              placeholder="例：領収書 / お買い上げありがとうございます"
              className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">フッター文言（任意）</span>
            <textarea
              value={current.footerNote || ''}
              onChange={(event) => updateCurrent({ footerNote: event.target.value })}
              rows={2}
              placeholder="例：またのご来店をお待ちしております"
              className="w-full rounded-2xl border-2 border-gray-100 px-4 py-3 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">バナー画像URL（任意）</span>
            <input
              value={current.bannerImage || ''}
              onChange={(event) => updateCurrent({ bannerImage: event.target.value })}
              placeholder="https://..."
              className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default ReceiptModeSettingsSection;
