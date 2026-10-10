// SaveControls.jsx — 設定画面の保存ボタン【AKUTOブランド基準 10-10: 保存ボタン】
// - 文言は「保存」1語(保存と同時に別の動作もするときだけ「保存して〇〇」)
// - 形: 黒の主ボタン・高さ44px・角丸12px・影なし・左に保存アイコン
// - 置き場所は1ページに1か所:
//   一覧の中で1件を編集する画面 → 画面下に固定したバー(［キャンセル］［保存］)= <FormActions>
//   ページ全体が1枚の設定 → 画面下に固定したバーの右端 = <SaveBar>(帯には置かない)
//   表の中で直接書き換える(商品マスター) → 変更したときに出る「変更を保存」(各画面のまま)
import React, { useEffect, useRef } from 'react';
import { appConfirm } from '../../../../shared/components/feedback/AppConfirmDialog';
import { Save } from 'lucide-react';

// ── 保存していない変更の見張り【AKUTOブランド基準 10-10】──
// 下のバー(ChangesBar / 変更ありの FormActions)が出ている間は「未保存あり」として登録する。
// 別のページへ移る操作は confirmLeaveIfUnsaved() を通し、未保存があれば確認を出す。
// 再読み込み・タブを閉じるときはブラウザ標準の確認を出す。
const unsavedSources = new Map(); // id -> { discard }
let unsavedSeq = 0;

// eslint-disable-next-line react-refresh/only-export-components
export const hasUnsavedChanges = () => unsavedSources.size > 0;

const useUnsavedRegistration = (dirty, discard) => {
  const discardRef = useRef(discard);
  useEffect(() => { discardRef.current = discard; }, [discard]);
  useEffect(() => {
    if (!dirty) return undefined;
    unsavedSeq += 1;
    const id = unsavedSeq;
    unsavedSources.set(id, { discard: () => discardRef.current?.() });
    return () => { unsavedSources.delete(id); };
  }, [dirty]);
};

if (typeof window !== 'undefined' && !window.__akutoUnsavedGuard) {
  window.__akutoUnsavedGuard = true;
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

// 移ってよければ true。未保存があるときは確認し、移るなら変更を捨てる(元に戻す)
// eslint-disable-next-line react-refresh/only-export-components
export const confirmLeaveIfUnsaved = async () => {
  if (!hasUnsavedChanges()) return true;
  const ok = await appConfirm(
    '保存していない変更があります。このまま移動すると、変更は保存されません。',
    { title: '保存していない変更', okLabel: '移動する', cancelLabel: 'このページに残る', tone: 'danger' }
  );
  if (!ok) return false;
  [...unsavedSources.values()].forEach((source) => { try { source.discard(); } catch { /* 無視 */ } });
  unsavedSources.clear();
  return true;
};
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

// 一覧の中で1件を編集するフォーム: ［キャンセル］［保存］は画面下に固定したバーに出す(長いフォームでもスクロール不要)【10-10】
export const FormActions = ({ onCancel, saveLabel = '保存', loading = false, disabled = false, onSave, saveType = 'submit', children = null, message = null, dirty = false }) => {
  useUnsavedRegistration(dirty, onCancel);
  return (
  <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 px-8 py-4 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur-md md:left-56">
    <div className="flex w-full flex-wrap items-center justify-end gap-3">
      {message && <div className="mr-auto text-sm font-black text-gray-900">{message}</div>}
      {children}
      {onCancel && <CancelButton onClick={onCancel} disabled={loading} />}
      <SaveButton type={saveType} onClick={onSave} label={saveLabel} loading={loading} disabled={disabled} />
    </div>
  </div>
  );
};

// ページ全体が1枚の設定のとき、画面下に固定するバー(右端に保存)
export const SaveBar = ({ saveLabel = '保存', loading = false, disabled = false, onSave, saveType = 'button', form, note = null }) => (
  <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white/90 px-8 py-4 backdrop-blur-md md:left-56">
    <div className="flex w-full items-center justify-end gap-4">
      {note && <div className="mr-auto text-xs font-bold text-gray-500">{note}</div>}
      <SaveButton type={saveType} form={form} onClick={onSave} label={saveLabel} loading={loading} disabled={disabled} />
    </div>
  </div>
);

// 変更があるときだけ画面の下に出るバー【AKUTOブランド基準 10-10】
// ページ全体が1枚の設定・並び替え・表の直接編集など、「保存するまで確定しない」画面はすべてこれを使う。
// 左=何が変わったか、右=［元に戻す］［保存］。変更が無いときは出さない(=押せない保存ボタンを並べない)。
export const ChangesBar = ({
  dirty,
  onSave,
  onDiscard,
  loading = false,
  disabled = false,
  message = '保存していない変更があります',
  saveLabel = '保存',
  saveType = 'button',
  form
}) => {
  useUnsavedRegistration(dirty, onDiscard);
  if (!dirty && !loading) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 px-8 py-4 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur-md animate-in slide-in-from-bottom-2 duration-200 md:left-56">
      <div className="flex w-full flex-wrap items-center justify-end gap-3">
        <div className="mr-auto text-sm font-black text-gray-900">{message}</div>
        {onDiscard && <CancelButton label="元に戻す" onClick={onDiscard} disabled={loading} />}
        <SaveButton type={saveType} form={form} onClick={onSave} label={saveLabel} loading={loading} disabled={disabled} />
      </div>
    </div>
  );
};
