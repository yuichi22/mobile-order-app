import React, { useEffect, useMemo, useState } from 'react';
import { ChangesBar } from './SaveControls';
import { SettingsCardHeader } from './SettingsCard';
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
        <SettingsCardHeader
          icon={Clock3}
          title={'営業設定'}
          meta={'営業時間 / 定休日 / ラストオーダー'}
          actions={null}
        />

        <form onSubmit={handleSubmit} className="p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[2rem] border border-gray-100 bg-white p-8 shadow-sm">
              <div className="mb-6 flex items-center gap-2 text-ui">
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
                            dayValue.isOpen ? 'bg-ui text-white' : 'bg-gray-200 text-gray-500'
                          }`}>
                            {dayValue.isOpen ? <SunMedium size={20} /> : <MoonStar size={20} />}
                          </div>
                          <div>
                            <div className="text-lg font-black text-gray-900">{dayLabel}曜日</div>
                            <div className="text-xs font-bold text-gray-500">
                              {dayValue.isOpen ? '営業日' : '定休日'}
                            </div>
                          </div>
                        </div>

                        <label className="inline-flex cursor-pointer items-center gap-3 rounded-full bg-white px-4 py-2 shadow-sm">
                          <span className={`text-xs font-black ${dayValue.isOpen ? 'text-ui' : 'text-gray-500'}`}>
                            {dayValue.isOpen ? '営業' : '休業'}
                          </span>
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={dayValue.isOpen}
                              onChange={(event) => handleDayChange(day.key, 'isOpen', event.target.checked)}
                              className="peer sr-only"
                            />
                            <div className="h-7 w-12 rounded-full bg-gray-200 transition-colors peer-checked:bg-gray-900" />
                            <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
                          </div>
                        </label>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-gray-500">開始</span>
                          <input
                            type="time"
                            value={dayValue.open}
                            disabled={!dayValue.isOpen}
                            onChange={(event) => handleDayChange(day.key, 'open', event.target.value)}
                            className="border-2 border-gray-200 bg-white hover:border-gray-300 h-14 w-full rounded-2xl px-5 font-mono text-lg font-bold text-gray-700 transition-all disabled:bg-gray-100 disabled:text-gray-300 outline-none focus:border-ui"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-gray-500">終了</span>
                          <input
                            type="time"
                            value={dayValue.close}
                            disabled={!dayValue.isOpen}
                            onChange={(event) => handleDayChange(day.key, 'close', event.target.value)}
                            className="border-2 border-gray-200 bg-white hover:border-gray-300 h-14 w-full rounded-2xl px-5 font-mono text-lg font-bold text-gray-700 transition-all disabled:bg-gray-100 disabled:text-gray-300 outline-none focus:border-ui"
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
  <div className="mb-6 flex items-center gap-2 text-ui">
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
              ? 'border-ui bg-ui-50 text-ui shadow-lg shadow-gray-200'
              : 'border-gray-100 bg-white text-gray-500 hover:border-ui-100'
          }`}
        >
          <div className="text-sm font-black">{option.label}</div>
          <div className="mt-1 text-xs font-bold leading-relaxed text-gray-500">
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
                <div className="mb-6 flex items-center gap-2 text-ui">
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
                            ? 'border-ui bg-ui-50 text-ui shadow-lg shadow-gray-200'
                            : 'border-gray-100 bg-white text-gray-500 hover:border-ui-100'
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

              <div className="rounded-[2rem] border border-ui-100 bg-ui-50/60 p-8 shadow-sm">
                <div className="mb-3 text-xs font-black tracking-[0.18em] text-ui">使い方メモ</div>
                <div className="space-y-3 text-sm leading-relaxed text-gray-600">
                  <p>営業時間外はお客様画面で注文できなくなります。営業中でもラストオーダー後は注文受付のみ停止します。</p>
                  <p>日またぎ営業にも対応しているので、深夜営業のお店でもそのまま使えます。</p>
                </div>
              </div>
            </section>
          </div>

          <ChangesBar
            dirty={JSON.stringify(draft) !== JSON.stringify(normalizedSettings) || Boolean(saveError)}
            saveType="submit"
            loading={isSaving}
            onDiscard={() => { setDraft(normalizedSettings); setSaveError(''); }}
            message={saveError ? <span className="text-amber-700">{saveError}</span> : '営業設定を変更しました'}
          />
        </form>
      </div>
    </div>
  );
};

export default BusinessSettings;
