import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, CreditCard, MoonStar, Save, Store, SunMedium } from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import {
  BUSINESS_DAY_OPTIONS,
  DEFAULT_BUSINESS_SETTINGS,
  normalizeBusinessSettings
} from '../../../../shared/utils/businessHours';

const DAY_LABELS = {
  sun: '日',
  mon: '月',
  tue: '火',
  wed: '水',
  thu: '木',
  fri: '金',
  sat: '土'
};

const LAST_ORDER_OPTIONS = [
  { value: 0, label: '閉店と同時' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 45, label: '45分前' },
  { value: 60, label: '60分前' }
];

const BusinessSettings = ({ settings, onSave, onSaved }) => {
  const normalizedSettings = useMemo(
    () => normalizeBusinessSettings(settings || DEFAULT_BUSINESS_SETTINGS),
    [settings]
  );
  const [draft, setDraft] = useState(normalizedSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setDraft(normalizeBusinessSettings(settings || DEFAULT_BUSINESS_SETTINGS));
  }, [settings]);

  const handleDayChange = (dayKey, field, value) => {
    setDraft((current) => ({
      ...current,
      businessHours: {
        ...current.businessHours,
        [dayKey]: {
          ...current.businessHours[dayKey],
          [field]: value
        }
      }
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setSaveError('');

    try {
      await onSave(normalizeBusinessSettings(draft));
      onSaved?.();
    } catch (error) {
      console.error('営業時間の保存に失敗しました:', error);
      setSaveError('営業時間の保存に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full animate-in fade-in duration-300 pb-20">
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex h-24 items-center justify-between border-b bg-orange-50/50 px-8 transition-none">
          <div className="flex items-center gap-5">
            <div className="rounded-2xl bg-orange-500 p-3 text-white shadow-xl shadow-orange-200">
              <Clock3 size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">営業設定</h3>
              <p className="mt-0.5 text-[10px] font-black tracking-[0.2em] text-orange-300">
                営業時間 / 定休日 / ラストオーダー
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[2rem] border border-gray-100 bg-white p-8 shadow-sm">
              <div className="mb-6 flex items-center gap-2 text-orange-500">
                <Store size={18} strokeWidth={3} />
                <span className="text-xs font-black tracking-widest">曜日ごとの営業時間</span>
              </div>

              <div className="space-y-4">
                {BUSINESS_DAY_OPTIONS.map((day) => {
                  const dayValue = draft.businessHours[day.key];
                  const dayLabel = DAY_LABELS[day.key] || day.label;

                  return (
                    <div key={day.key} className="rounded-3xl border border-gray-100 bg-gray-50/60 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                            dayValue.isOpen ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {dayValue.isOpen ? <SunMedium size={20} /> : <MoonStar size={20} />}
                          </div>
                          <div>
                            <div className="text-lg font-black text-gray-900">{dayLabel}曜日</div>
                            <div className="text-xs font-bold text-gray-400">
                              {dayValue.isOpen ? '営業日' : '定休日'}
                            </div>
                          </div>
                        </div>

                        <label className="inline-flex cursor-pointer items-center gap-3 rounded-full bg-white px-4 py-2 shadow-sm">
                          <span className={`text-xs font-black ${dayValue.isOpen ? 'text-orange-600' : 'text-gray-400'}`}>
                            {dayValue.isOpen ? '営業' : '休業'}
                          </span>
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={dayValue.isOpen}
                              onChange={(event) => handleDayChange(day.key, 'isOpen', event.target.checked)}
                              className="peer sr-only"
                            />
                            <div className="h-7 w-12 rounded-full bg-gray-200 transition-colors peer-checked:bg-orange-500" />
                            <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                          </div>
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-gray-400">開始</span>
                          <input
                            type="time"
                            value={dayValue.open}
                            disabled={!dayValue.isOpen}
                            onChange={(event) => handleDayChange(day.key, 'open', event.target.value)}
                            className="h-14 w-full rounded-2xl border-2 border-gray-100 bg-white px-5 font-mono text-lg font-bold text-gray-700 outline-none transition-all focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-300"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-gray-400">終了</span>
                          <input
                            type="time"
                            value={dayValue.close}
                            disabled={!dayValue.isOpen}
                            onChange={(event) => handleDayChange(day.key, 'close', event.target.value)}
                            className="h-14 w-full rounded-2xl border-2 border-gray-100 bg-white px-5 font-mono text-lg font-bold text-gray-700 outline-none transition-all focus:border-orange-500 disabled:bg-gray-100 disabled:text-gray-300"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-6">


                <div className="rounded-[2rem] border border-gray-100 bg-white p-8 shadow-sm">
  <div className="mb-6 flex items-center gap-2 text-orange-500">
    <CreditCard size={18} strokeWidth={3} />
    <span className="text-xs font-black tracking-widest">注文フロー</span>
  </div>

  <div className="grid gap-3">
    {[
      {
        value: 'postpay',
        label: '後払い',
        desc: '通常の飲食店向け。注文後にレジで会計します。'
      },
      {
        value: 'prepay',
        label: '事前決済',
        desc: 'AKUTO利用者向け。注文時に決済します。'
      }
    ].map((option) => {
      const isSelected = draft.orderFlow === option.value;

      return (
        <button
          key={option.value}
          type="button"
          onClick={() => setDraft((current) => ({ ...current, orderFlow: option.value }))}
          className={`rounded-2xl border-2 px-5 py-4 text-left transition-all ${
            isSelected
              ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-lg shadow-orange-100'
              : 'border-gray-100 bg-white text-gray-500 hover:border-orange-200'
          }`}
        >
          <div className="text-sm font-black">{option.label}</div>
          <div className="mt-1 text-xs font-bold leading-relaxed text-gray-400">
            {option.desc}
          </div>
        </button>
      );
    })}
  </div>

  {draft.orderFlow === 'prepay' && (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-700">
      事前決済モードは現在準備中です。保存はできますが、注文画面では注文を停止します。
    </div>
  )}
</div>


              <div className="rounded-[2rem] border border-gray-100 bg-white p-8 shadow-sm">
                <div className="mb-6 flex items-center gap-2 text-orange-500">
                  <Clock3 size={18} strokeWidth={3} />
                  <span className="text-xs font-black tracking-widest">ラストオーダー</span>
                </div>
                <div className="grid gap-3">
                  {LAST_ORDER_OPTIONS.map((option) => {
                    const isSelected = Number(draft.lastOrderMinutesBeforeClose) === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraft((current) => ({ ...current, lastOrderMinutesBeforeClose: option.value }))}
                        className={`flex items-center justify-between rounded-2xl border-2 px-5 py-4 text-left transition-all ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-lg shadow-orange-100'
                            : 'border-gray-100 bg-white text-gray-500 hover:border-orange-200'
                        }`}
                      >
                        <span className="font-black">{option.label}</span>
                        <span className="text-xs font-bold">
                          {option.value === 0 ? '閉店時刻まで注文可' : `閉店 ${option.value} 分前で受付終了`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[2rem] border border-blue-100 bg-blue-50/60 p-8 shadow-sm">
                <div className="mb-3 text-xs font-black tracking-[0.18em] text-blue-400">使い方メモ</div>
                <div className="space-y-3 text-sm leading-relaxed text-slate-600">
                  <p>営業時間外はお客様画面で注文できなくなります。営業中でもラストオーダー後は注文受付のみ停止します。</p>
                  <p>日またぎ営業にも対応しているので、深夜営業のお店でもそのまま使えます。</p>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-10 flex justify-end border-t border-gray-100 pt-8">
            <div className="flex flex-col items-end gap-3">
              {saveError && (
                <p className="text-sm font-bold text-red-500">
                  {saveError}
                </p>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-3 rounded-xl bg-orange-500 px-12 py-4 text-lg font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95 disabled:bg-orange-300"
              >
              {isSaving ? <LoadingSpinner size={22} /> : <Save size={22} strokeWidth={2.5} />}
                保存して反映
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BusinessSettings;
