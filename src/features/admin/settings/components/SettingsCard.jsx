// SettingsCard.jsx — 設定画面の「見出しの帯つきカード」
// 【AKUTOブランド基準 10-10: 設定画面の見出し】どの設定ページもこの形で組む(各画面で作り直さない)。
// - 帯: 高さ96px・薄い青みの地・下に細い線。左=黒い角丸アイコン＋タイトル(20px)＋小さな補足、右=主ボタン1つ
// - ページの最初のカードのタイトル=左メニューの名前。本文の余白は32px(bodyClassName で変えられる)
// - 編集フォームも同じ薄い地(黒い帯は使わない)
import React from 'react';

// 帯だけ(カードの外枠は呼び出し側が持っている画面用)
export const SettingsCardHeader = ({ icon: Icon, title, meta = null, actions = null }) => (
  <div className="flex min-h-24 flex-wrap items-center justify-between gap-4 border-b bg-ui-50/50 px-8 py-4">
    <div className="flex min-w-0 items-center gap-5">
      {Icon && (
        <div className="shrink-0 rounded-2xl bg-gray-900 p-3 text-white">
          {React.createElement(Icon, { size: 24, strokeWidth: 2.5 })}
        </div>
      )}
      <div className="min-w-0">
        <h3 className="text-xl font-black leading-tight tracking-tight text-gray-900">{title}</h3>
        {meta && <div className="mt-0.5 text-[11px] font-black tracking-[0.12em] text-gray-500">{meta}</div>}
      </div>
    </div>
    {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

const SettingsCard = ({
  icon: Icon,
  title,
  meta = null,
  actions = null,
  children,
  className = '',
  bodyClassName = 'p-8'
}) => (
  <section className={`w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>
    <SettingsCardHeader icon={Icon} title={title} meta={meta} actions={actions} />
    {children !== undefined && children !== null && <div className={bodyClassName}>{children}</div>}
  </section>
);

export default SettingsCard;
