import React, { useState } from 'react';
import { ArrowLeftRight, Check, ClipboardList, Monitor, Utensils, X } from 'lucide-react';

// スマホ用の画面切り替え【10-17】。提供モード・オーダー端末のヘッダー右上と、PC版の左下に出す。
// 選択肢は呼び出し側が権限で絞って渡す(allowedModes)。
const MODE_OPTIONS = {
  serve: { label: '提供', description: '出来上がった料理を運ぶ', icon: Utensils },
  staffOrder: { label: 'オーダー', description: 'テーブルの注文を入れる', icon: ClipboardList },
  admin: { label: 'PC版', description: 'PCと同じ画面を閲覧(拡大して見る・レジ操作は非対応)', icon: Monitor }
};

const MobileModeSwitcher = ({ currentMode, allowedModes, onSelect, variant = 'header' }) => {
  const [open, setOpen] = useState(false);
  const options = allowedModes.filter((mode) => MODE_OPTIONS[mode]);
  // 今の画面以外に移れる先が無ければ出さない(今の画面が契約外で選択肢に無いときは、移り先が1つでも出す)
  if (!options.some((mode) => mode !== currentMode)) return null;

  // PC版は PC 幅を縮小表示しているので、ボタンもシートも大きく描いて画面上で読める大きさにする。
  const isDesktop = variant === 'desktop';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="画面を切り替える"
        className={isDesktop
          ? 'fixed bottom-8 left-8 z-[70] flex h-28 items-center gap-4 rounded-full bg-gray-900 px-10 text-4xl font-black text-white shadow-2xl active:scale-95 print:hidden'
          : 'flex h-10 shrink-0 items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3 text-sm font-black text-gray-700 shadow-sm active:scale-95'}
      >
        <ArrowLeftRight size={isDesktop ? 40 : 16} strokeWidth={2.5} />
        切替
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 print:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className={`w-full rounded-t-3xl bg-white shadow-2xl ${isDesktop ? 'max-w-[1180px] p-12 pb-16' : 'max-w-md p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`flex items-center justify-between ${isDesktop ? 'mb-8' : 'mb-3'}`}>
              <h2 className={`font-black text-gray-900 ${isDesktop ? 'text-5xl' : 'text-base'}`}>画面を切り替える</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className={`flex items-center justify-center rounded-full bg-gray-100 text-gray-600 ${isDesktop ? 'h-24 w-24' : 'h-9 w-9'}`}
              >
                <X size={isDesktop ? 48 : 18} />
              </button>
            </div>
            <div className={`flex flex-col ${isDesktop ? 'gap-6' : 'gap-2'}`}>
              {options.map((mode) => {
                const { label, description, icon: Icon } = MODE_OPTIONS[mode];
                const active = mode === currentMode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!active) onSelect(mode);
                    }}
                    className={`flex w-full items-center text-left transition-colors ${
                      isDesktop ? 'gap-8 rounded-[2rem] p-8' : 'gap-3 rounded-2xl p-3'
                    } ${active ? 'bg-ui-50 ring-2 ring-ui' : 'bg-gray-50 active:bg-gray-100'}`}
                  >
                    <span className={`flex shrink-0 items-center justify-center rounded-2xl ${active ? 'bg-ui text-white' : 'bg-white text-gray-700'} ${isDesktop ? 'h-24 w-24' : 'h-10 w-10'}`}>
                      <Icon size={isDesktop ? 48 : 20} strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block font-black text-gray-900 ${isDesktop ? 'text-5xl' : 'text-sm'}`}>{label}</span>
                      <span className={`block font-bold text-gray-500 ${isDesktop ? 'mt-2 text-3xl' : 'text-xs'}`}>{description}</span>
                    </span>
                    {active && <Check size={isDesktop ? 56 : 20} strokeWidth={3} className="shrink-0 text-ui" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileModeSwitcher;
