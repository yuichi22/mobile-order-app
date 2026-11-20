import React, { useState } from 'react';

/**
 * Web注文（サイト連携）の「受付できない日」と、予約品の「受取時間帯」の入力欄。
 *
 * ⚠ 判定の本体は functions/takeoutReservation.js（blockedDatesOf / pickupWindowsOf）。
 *   ここで保存する形（"YYYY-MM-DD" の配列 / [{ from: "HH:MM", to: "HH:MM" }]）を変えるときは
 *   関数側とサイト（akuto-sites の haus-site）も合わせること。
 * ⚠ 受取枠はサイトで30分刻みなので、時刻も30分刻みでしか選ばせない。
 */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-12-31" → "12月31日(木)" */
const formatDateKeyLabel = (key) => {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return key;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日(${wd})`;
};

/** 端末の日付（日本で使う前提）を "YYYY-MM-DD" に。過去日は追加させない判定に使う。 */
const todayKey = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** 0:00〜23:30 の30分刻み */
const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  return `${h}:${i % 2 === 0 ? '00' : '30'}`;
});

const inputClass =
  'border-2 border-gray-200 bg-white h-12 rounded-2xl px-3 text-sm font-black text-gray-800 outline-none focus:border-ui';

export const BlockedDatesEditor = ({ value = [], onChange }) => {
  const [draft, setDraft] = useState('');
  const dates = [...new Set((Array.isArray(value) ? value : []).filter(Boolean))].sort();
  const today = todayKey();
  const canAdd = Boolean(draft) && draft >= today && !dates.includes(draft);

  const add = () => {
    if (!canAdd) return;
    onChange([...dates, draft].sort());
    setDraft('');
  };

  return (
    <div>
      <label className="mb-2 block text-[11px] font-black uppercase text-gray-500">
        受付できない日
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          min={today}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="h-12 rounded-2xl bg-gray-900 px-5 text-sm font-black text-white disabled:bg-gray-200 disabled:text-gray-400"
        >
          追加
        </button>
      </div>
      {dates.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {dates.map((date) => (
            <li
              key={date}
              className={`inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs font-black ${
                date < today ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-700'
              }`}
            >
              {formatDateKeyLabel(date)}
              <button
                type="button"
                onClick={() => onChange(dates.filter((d) => d !== date))}
                className="flex h-6 w-6 items-center justify-center rounded-full text-sm hover:bg-white"
                aria-label={`${formatDateKeyLabel(date)} を外す`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs font-bold text-gray-400">まだありません</p>
      )}
      <p className="mt-2 text-xs font-bold leading-relaxed text-gray-500">
        追加した日はサイトで受取日に選べなくなります。カゴの中のどれか1品でも受けられない日は、その日ごと選べません。過ぎた日は灰色になり、サイトには出ません。
      </p>
    </div>
  );
};

export const PickupWindowsEditor = ({ value = [], onChange }) => {
  const windows = Array.isArray(value) ? value : [];

  const update = (index, patch) => {
    onChange(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  };

  return (
    <div>
      <label className="mb-2 block text-[11px] font-black uppercase text-gray-500">
        受取時間帯（任意）
      </label>
      <div className="space-y-2">
        {windows.map((w, index) => {
          const broken = !w.from || !w.to || w.from >= w.to;
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select
                value={w.from || ''}
                onChange={(event) => update(index, { from: event.target.value })}
                className={`${inputClass} ${broken ? 'border-red-300' : ''}`}
              >
                <option value="">--:--</option>
                {HALF_HOUR_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-sm font-bold text-gray-500">〜</span>
              <select
                value={w.to || ''}
                onChange={(event) => update(index, { to: event.target.value })}
                className={`${inputClass} ${broken ? 'border-red-300' : ''}`}
              >
                <option value="">--:--</option>
                {HALF_HOUR_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                type="button"
                onClick={() => onChange(windows.filter((_, i) => i !== index))}
                className="h-12 rounded-2xl px-3 text-sm font-black text-gray-500 hover:bg-white"
              >
                削除
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange([...windows, { from: '', to: '' }])}
        className="mt-2 h-11 rounded-2xl border-2 border-dashed border-gray-300 bg-white px-4 text-sm font-black text-gray-700 hover:border-gray-400"
      >
        ＋ 時間帯を追加
      </button>
      <p className="mt-2 text-xs font-bold leading-relaxed text-gray-500">
        お客様はこの時間帯の中から受取時刻（30分ごと）を選びます。両端の時刻も選べます。空なら店の通常の受取時間（11:30〜19:30）です。指定すると通常の受取時間の代わりにこちらを使います。
      </p>
    </div>
  );
};
