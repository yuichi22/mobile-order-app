// SaveControls.jsx — 設定画面の保存ボタン【AKUTOブランド基準 10-10: 保存ボタン】
// - 文言は「保存」1語(保存と同時に別の動作もするときだけ「保存して〇〇」)
// - 形: 黒の主ボタン・高さ44px・角丸12px・影なし・左に保存アイコン
// - 置き場所は1ページに1か所:
//   一覧の中で1件を編集する画面 → フォームの最後の右端(左に「キャンセル」)= <FormActions>
//   ページ全体が1枚の設定 → 画面下に固定したバーの右端 = <SaveBar>(帯には置かない)
//   表の中で直接書き換える(商品マスター) → 変更したときに出る「変更を保存」(各画面のまま)
import React from 'react';
import { Save } from 'lucide-react';
import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';

export const SaveButton = ({ label = '保存', loading = false, disabled = false, type = 'button', onClick, form, className = '' }) => (
  <button
    type={type}
    form={form}
    onClick={onClick}
    disabled={disabled || loading}
    className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gray-900 px-6 text-sm font-black text-white transition-colors hover:bg-gray-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:active:scale-100 ${className}`}
  >
    {loading ? <LoadingSpinner size={16} /> : <Save size={16} strokeWidth={2.5} />}
    {label}
  </button>
);

export const CancelButton = ({ label = 'キャンセル', onClick, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border-2 border-gray-200 bg-white px-6 text-sm font-black text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50"
  >
    {label}
  </button>
);

// 一覧の中で1件を編集するフォームの最後
export const FormActions = ({ onCancel, saveLabel = '保存', loading = false, disabled = false, onSave, saveType = 'submit', children = null }) => (
  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 pt-6">
    {children}
    {onCancel && <CancelButton onClick={onCancel} disabled={loading} />}
    <SaveButton type={saveType} onClick={onSave} label={saveLabel} loading={loading} disabled={disabled} />
  </div>
);

// ページ全体が1枚の設定のとき、画面下に固定するバー(右端に保存)
export const SaveBar = ({ saveLabel = '保存', loading = false, disabled = false, onSave, saveType = 'button', form, note = null }) => (
  <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white/90 px-8 py-4 backdrop-blur-md md:left-56">
    <div className="flex w-full items-center justify-end gap-4">
      {note && <div className="mr-auto text-xs font-bold text-gray-500">{note}</div>}
      <SaveButton type={saveType} form={form} onClick={onSave} label={saveLabel} loading={loading} disabled={disabled} />
    </div>
  </div>
);
