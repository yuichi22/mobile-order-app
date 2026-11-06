import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Plus, Trash2 } from 'lucide-react';

import SettingsCard from './SettingsCard';
import { ChangesBar } from './SaveControls';
import { appConfirm } from '../../../../shared/components/feedback/AppConfirmDialog';
import { getAvailableDepartments } from '../../../pos/utils/registerContext';
import { normalizeEventCategories } from '../../../pos/utils/eventDeposit';

// イベント入金で選ぶ「イベントカテゴリー」(HAUSマルシェ・市役所出張イベント・刺繍教室スイーツ代金 など)。
// settings/basic.eventCategories に配列で持つ。使わなくなったカテゴリーは削除せず「使わない」にすると、
// レジのボタンからは消え、過去の集計(取引に名前を残している)はそのまま残る。
const toDrafts = (list) => normalizeEventCategories(list).map((entry) => ({ ...entry }));

const EventCategorySettings = ({ settings, onSave, onSaved }) => {
  const saved = useMemo(() => toDrafts(settings?.eventCategories), [settings?.eventCategories]);
  const [drafts, setDrafts] = useState(saved);
  const [savedSnapshot, setSavedSnapshot] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 保存済みの値が外から変わったら(他端末で保存など)、未編集のときだけ追従する。
  if (savedSnapshot !== saved) {
    const isDirtyNow = JSON.stringify(drafts) !== JSON.stringify(savedSnapshot);
    setSavedSnapshot(saved);
    if (!isDirtyNow) setDrafts(saved);
  }

  const departments = useMemo(() => getAvailableDepartments(settings?.departments), [settings?.departments]);
  const defaultDepartmentId = departments.find((dept) => dept.registerMode === 'order')?.id || departments[0]?.id || '';
  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved);

  const update = (index, patch) => {
    setDrafts((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  const move = (index, delta) => {
    setDrafts((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const add = () => {
    setDrafts((current) => [
      ...current,
      {
        id: `evcat_${Date.now()}`,
        name: '',
        departmentId: defaultDepartmentId,
        defaultTaxRate: 10,
        active: true,
        sortOrder: current.length
      }
    ]);
  };

  const remove = async (index) => {
    const entry = drafts[index];
    const ok = await appConfirm(
      `「${entry?.name || '名前なし'}」を削除しますか？過去の集計は残ります。終わったイベントは「使わない」にする方法もあります。`,
      { okLabel: '削除する', tone: 'danger' }
    );
    if (!ok) return;
    setDrafts((current) => current.filter((_, i) => i !== index));
  };

  const save = async () => {
    const names = drafts.map((entry) => String(entry.name || '').trim());
    if (names.some((name) => !name)) {
      setError('名前が空のカテゴリーがあります。');
      return;
    }
    if (new Set(names).size !== names.length) {
      setError('同じ名前のカテゴリーがあります。');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave(drafts.map((entry, index) => ({
        id: entry.id,
        name: String(entry.name || '').trim(),
        departmentId: entry.departmentId || '',
        defaultTaxRate: Number(entry.defaultTaxRate) === 8 ? 8 : 10,
        active: entry.active !== false,
        sortOrder: index
      })));
      onSaved?.();
    } catch (saveError) {
      console.error('[EventCategorySettings] save failed', saveError);
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-28">
      <SettingsCard
        icon={CalendarDays}
        title="イベント入金"
        meta="EVENT CATEGORIES"
        actions={(
          <button
            type="button"
            onClick={add}
            className="flex h-11 items-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-black text-white transition hover:bg-black active:scale-95"
          >
            <Plus size={16} />
            カテゴリーを追加
          </button>
        )}
      >
        <p className="mb-5 text-sm font-bold leading-relaxed text-gray-600">
          レジの「イベント入金」で選ぶカテゴリーです。店外イベントの売上を、イベントが終わったあとにまとめて1回で入金します。
          売上は入金した日の日計に入り、来客数・客単価には含めません。税率は入金のたびに選べます（ここは最初に選ばれている税率）。
        </p>

        {drafts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-bold text-gray-500">
            まだカテゴリーがありません。「カテゴリーを追加」から、HAUSマルシェなどを登録してください。
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((entry, index) => (
              <div
                key={entry.id}
                className={`grid gap-3 rounded-2xl border p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto_auto] md:items-end ${
                  entry.active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
                }`}
              >
                <label className="block">
                  <span className="mb-1 block text-[11px] font-black text-gray-500">名前</span>
                  <input
                    value={entry.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    placeholder="例: HAUSマルシェ"
                    className="h-11 w-full rounded-xl border-2 border-gray-200 px-3 text-sm font-bold text-gray-900 outline-none focus:border-ui"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-black text-gray-500">部門</span>
                  <select
                    value={entry.departmentId}
                    onChange={(event) => update(index, { departmentId: event.target.value })}
                    className="h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-ui"
                  >
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <span className="mb-1 block text-[11px] font-black text-gray-500">最初の税率</span>
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-gray-200">
                    {[8, 10].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => update(index, { defaultTaxRate: rate })}
                        className={`w-14 text-sm font-black ${entry.defaultTaxRate === rate ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                      >
                        {rate}%
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-1 block text-[11px] font-black text-gray-500">レジに出す</span>
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-gray-200">
                    <button
                      type="button"
                      onClick={() => update(index, { active: true })}
                      className={`px-3 text-sm font-black ${entry.active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                    >
                      使う
                    </button>
                    <button
                      type="button"
                      onClick={() => update(index, { active: false })}
                      className={`px-3 text-sm font-black ${!entry.active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                    >
                      使わない
                    </button>
                  </div>
                </div>
                <div className="flex h-11 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="上へ"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 disabled:opacity-30"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === drafts.length - 1}
                    aria-label="下へ"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 disabled:opacity-30"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label="削除"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</div>}
      </SettingsCard>

      <ChangesBar
        dirty={dirty}
        loading={saving}
        onSave={save}
        onDiscard={() => { setDrafts(saved); setError(''); }}
      />
    </div>
  );
};

export default EventCategorySettings;
