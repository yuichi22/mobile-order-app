import React, { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';

import SettingsCard from './SettingsCard';
import { ChangesBar } from './SaveControls';
import { resolveLinePointSettings } from '../../../../shared/constants/linePoints';

// 割引設定の「LINE ポイント」(2026-11-08)。
// お会計で LINE ポイント(会員証のポイント)を使ったときに、どの会計区分で日計に載せるかを決める。
// settings/basic.linePoints に保存する。紙のポイントカード(スタンプカード)は通常の割引として登録し、
// 日計では回収枚数で数える。LINE ポイントは使った pt・金額で別に出す。
const ACCOUNTING_OPTIONS = [
  {
    id: 'sales_discount',
    label: '売上値引',
    desc: '売上金額そのものを減らします。日計では売上値引合計に含めます。'
  },
  {
    id: 'promo_expense',
    label: '販促費',
    desc: 'お客様の支払額は減らし、日計では販促費合計に含めます。'
  }
];

const toDraft = (settings) => {
  const resolved = resolveLinePointSettings(settings);
  return {
    enabled: resolved.enabled,
    name: resolved.name,
    accountingCategory: resolved.accountingCategory,
    note: resolved.note
  };
};

const LinePointSettingsCard = ({ settings, onSave, onSaved }) => {
  const saved = useMemo(() => toDraft(settings), [settings]);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [savedSnapshotKey, setSavedSnapshotKey] = useState(savedKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 保存済みの値が外から変わったら(他端末で保存など)、未編集のときだけ追従する。
  if (savedSnapshotKey !== savedKey) {
    const isDirtyNow = JSON.stringify(draft) !== savedSnapshotKey;
    setSavedSnapshotKey(savedKey);
    if (!isDirtyNow) setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== savedKey;
  const update = (patch) => {
    setError('');
    setDraft((current) => ({ ...current, ...patch }));
  };

  const save = async () => {
    const name = String(draft.name || '').trim();
    if (draft.enabled && !name) {
      setError('表示名を入力してください。');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        enabled: draft.enabled === true,
        name: name || saved.name,
        accountingCategory: draft.accountingCategory === 'promo_expense' ? 'promo_expense' : 'sales_discount',
        note: String(draft.note || '').trim()
      });
      onSaved?.();
    } catch (saveError) {
      console.error('LINE ポイント設定の保存に失敗', saveError);
      setError('保存できませんでした。通信を確認して、もう一度保存してください。');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={draft.enabled}
      onClick={() => update({ enabled: !draft.enabled })}
      className="flex h-11 items-center gap-3 rounded-full px-3 text-sm font-black text-gray-900 transition-colors hover:bg-white"
    >
      <span>LINE ポイントを使用する</span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          draft.enabled ? 'bg-ui' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
            draft.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );

  return (
    <>
      <SettingsCard
        icon={HandCoins}
        title="LINE ポイント"
        meta={draft.enabled ? '会計区分 / ' + (draft.accountingCategory === 'promo_expense' ? '販促費' : '売上値引') : '使用しない'}
        actions={toggle}
        bodyClassName={draft.enabled ? 'p-8' : 'px-8 py-5'}
      >
        {draft.enabled ? (
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-10 md:grid-cols-2">
            <div className="space-y-10">
              <div>
                <label htmlFor="line-point-name" className="mb-3 block text-sm font-black tracking-widest text-gray-500">
                  表示名
                </label>
                <input
                  id="line-point-name"
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder="例: LINE ポイント"
                  className="h-16 w-full rounded-xl border-2 border-gray-200 bg-white px-6 text-2xl font-bold text-gray-900 outline-none transition-colors placeholder:text-gray-300 hover:border-gray-300 focus:border-gray-900"
                />
                <p className="mt-2 text-xs font-bold leading-relaxed text-gray-500">
                  お会計の割引画面・レシート・日計に出る名前です。
                </p>
              </div>

              <div>
                <div className="mb-3 block text-sm font-black tracking-widest text-gray-500">使える額</div>
                <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-5 text-sm font-bold leading-relaxed text-gray-500">
                  1pt あたりの金額と利用単位は会員証（AKUTO Core）の設定に従います。
                  お会計で会員を読み込むと「割引・売掛を適用」に表示されます。
                </div>
              </div>
            </div>

            <div className="space-y-10">
              <div>
                <div className="mb-5 block text-sm font-black tracking-widest text-gray-500">会計区分</div>
                <div className="space-y-3">
                  {ACCOUNTING_OPTIONS.map((option) => (
                    <label
                      key={option.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white p-4 transition-colors ${
                        draft.accountingCategory === option.id
                          ? 'border-gray-900'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="linePointAccountingCategory"
                        value={option.id}
                        checked={draft.accountingCategory === option.id}
                        onChange={() => update({ accountingCategory: option.id })}
                        className="mt-1 h-4 w-4 accent-ui"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-gray-900">{option.label}</span>
                        <span className="mt-1 block text-xs font-bold leading-relaxed text-gray-500">{option.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs font-bold leading-relaxed text-gray-500">
                  日計ではポイントカードの回収枚数とは別に、使われた pt と金額を表示します。
                  変更は次のお会計から反映します。
                </p>
              </div>

              <div>
                <label htmlFor="line-point-note" className="mb-3 block text-sm font-black tracking-widest text-gray-500">
                  備考メモ
                </label>
                <textarea
                  id="line-point-note"
                  value={draft.note}
                  onChange={(event) => update({ note: event.target.value })}
                  placeholder="運用の決まりや補足など"
                  className="h-32 w-full resize-none rounded-xl border-2 border-gray-200 bg-white p-6 text-base font-bold text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-gray-900"
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm font-bold text-gray-500">
            オンにすると、お会計で LINE ポイントを使えるようになり、会計区分を設定できます。
          </p>
        )}
        {error && <p className="mt-4 text-sm font-bold text-red-600">{error}</p>}
      </SettingsCard>

      <ChangesBar
        dirty={dirty}
        loading={saving}
        onSave={save}
        onDiscard={() => { setError(''); setDraft(saved); }}
        message="LINE ポイントの設定に保存していない変更があります"
      />
    </>
  );
};

export default LinePointSettingsCard;
