import React from 'react';
import { QrCode } from 'lucide-react';

// 「利用中」画面で、先に開いた人のスマホのどこを見ればよいかを一目で示す。
// CustomerHeader の見た目(Menu見出し＋右上の「同席者QR」ボタン)をそのまま縮小再現し、
// ボタンをリングと吹き出しで強調する。文章で「画面右上の…」と説明するより早い。
const InviteHintIllustration = ({ themeColor = '#16a34a', periodLabel = 'モーニング 07:00 - 11:30' }) => (
  <div className="mx-auto w-full max-w-xs">
    <div className="overflow-hidden rounded-[1.75rem] border-[6px] border-gray-900 bg-white shadow-xl">
      <div className="flex items-center justify-center bg-gray-900 pb-1.5 pt-1">
        <span className="h-1.5 w-16 rounded-full bg-gray-700" />
      </div>

      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="text-left">
          <p className="text-base font-black tracking-tight text-gray-900">Menu</p>
          <p className="mt-0.5 text-[10px] font-bold tracking-wide text-gray-400">{periodLabel}</p>
        </div>

        <div className="relative">
          <span
            className="absolute -inset-2 animate-pulse rounded-full"
            style={{ boxShadow: `0 0 0 3px ${themeColor}55` }}
          />
          <span
            className="relative flex items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3.5 py-2 text-xs font-black text-gray-700 shadow-sm"
            style={{ boxShadow: `0 0 0 3px ${themeColor}` }}
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: themeColor }}
            >
              <QrCode size={14} strokeWidth={3} />
            </span>
            同席者QR
          </span>
        </div>
      </div>

      <div className="flex gap-2 overflow-hidden whitespace-nowrap px-3 py-2.5">
        {['フード', 'ドリンク', 'スイーツ'].map((label, index) => (
          <span
            key={label}
            className={`rounded-full px-3 py-1 text-[10px] font-black ${
              index === 0 ? 'text-white' : 'bg-gray-100 text-gray-500'
            }`}
            style={index === 0 ? { backgroundColor: themeColor } : undefined}
          >
            {label}
          </span>
        ))}
      </div>
    </div>

    <p className="mt-3 text-center text-xs font-black" style={{ color: themeColor }}>
      ↑ 先に開いた方のスマホの右上「同席者QR」をタップ
    </p>
  </div>
);

export default InviteHintIllustration;
