// SearchField.jsx — 検索窓【AKUTOブランド基準 10-11: 検索窓】全アプリ同じ形(画面ごとに作らない)
// - 高さ44px・角丸12px・白地に2pxの枠(hover gray-300 / 入力中は操作色)・文字16px(iOSの拡大を防ぐ)
// - 左に虫めがね(差し替え可: POSのバーコードなど)、右に×(入力があるときだけ・押すと消してフォーカスを戻す・44pxのタップ領域)
// - Esc で消す / Enter は onSubmit があるときだけ(日本語変換の確定の Enter では送らない)
import React, { useRef } from 'react';
import { Search, X } from 'lucide-react';

export default function SearchField({
  value,
  onChange,
  placeholder = '検索',
  onSubmit,
  icon: Icon = Search,
  ariaLabel,
  autoFocus = false,
  inputRef,
  className = '',
  inputClassName = '',
  onKeyDown,
  ...inputProps
}) {
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const text = value ?? '';

  const clear = () => {
    onChange('');
    ref.current?.focus();
  };

  return (
    <div className={`relative ${className}`}>
      {Icon && (
        <Icon
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
        />
      )}
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.preventDefault();
            event.stopPropagation();
            clear();
            return;
          }
          if (event.key === 'Enter' && onSubmit && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit(text);
          }
          onKeyDown?.(event);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        autoFocus={autoFocus}
        className={`h-11 w-full rounded-xl border-2 border-gray-200 bg-white ${Icon ? 'pl-11' : 'pl-4'} pr-11 text-base font-bold text-gray-900 outline-none transition-colors placeholder:font-bold placeholder:text-gray-400 hover:border-gray-300 focus:border-ui [&::-webkit-search-cancel-button]:appearance-none ${inputClassName}`}
        {...inputProps}
      />
      {text ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
          aria-label="検索語を消す"
          className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900">
            <X size={14} strokeWidth={2.5} />
          </span>
        </button>
      ) : null}
    </div>
  );
}
