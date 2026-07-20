// CardTerminalModal.jsx
// 「カード決済端末連携」モーダル(店舗セルフサービス)。
// - 連携状態の表示
// - 端末登録(登録コード入力／テストはシミュレーター)
// - 登録済み端末一覧
// - (将来)リース/購入の導線
// バックエンド: registerCardReader / listCardReaders(onCall)。登録先の拠点(space)は
// サーバ側が store→Core マッピングから解決するため、内部IDは扱わない。
import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functionsApi } from '../../../../shared/api/firebase/client';

const str = (v) => String(v ?? '').trim();

const STATUS_LABEL = {
  online: 'オンライン',
  offline: 'オフライン',
};

const CardTerminalModal = ({ storeId, readers = [], state = 'idle', onClose, onChanged }) => {
  const [registrationCode, setRegistrationCode] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null); // {type:'ok'|'error', text}

  const linked = state === 'ready';

  const handleRegister = async () => {
    const code = str(registrationCode);
    if (!code) {
      setMessage({ type: 'error', text: '登録コードを入力してください。' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await httpsCallable(functionsApi, 'registerCardReader')({
        storeId,
        registrationCode: code,
        label: str(label),
      });
      setRegistrationCode('');
      setLabel('');
      setMessage({ type: 'ok', text: '端末を登録しました。' });
      if (onChanged) await onChanged();
    } catch (error) {
      const code2 = error?.code || '';
      const text =
        code2 === 'functions/failed-precondition'
          ? 'この拠点の初期設定が未完了です。運営にお問い合わせください。'
          : code2 === 'functions/permission-denied'
          ? '端末登録は店舗管理者のみ可能です。'
          : code2 === 'functions/invalid-argument'
          ? '登録コードが正しくありません。'
          : error?.message || '登録に失敗しました。';
      setMessage({ type: 'error', text });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">カード決済端末連携</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm font-black text-slate-400 hover:bg-slate-100"
          >
            閉じる
          </button>
        </div>

        {/* 連携状態 */}
        <div className="mb-5 rounded-2xl bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">
              端末決済の状態
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-black ${
                linked ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {state === 'ready'
                ? '利用可能'
                : state === 'loading'
                ? '確認中…'
                : state === 'unlinked'
                ? '準備中（拠点未設定）'
                : '確認できません'}
            </span>
          </div>
          {state === 'unlinked' && (
            <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">
              この店舗の端末決済はまだ準備中です。運営側の初期設定が完了すると、ここで端末を登録できます。
            </p>
          )}
        </div>

        {/* 端末登録 */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-black text-slate-800">端末を登録</h3>
          <p className="mb-3 text-xs font-bold leading-relaxed text-slate-400">
            端末の画面に表示される登録コードを入力します。テスト環境では
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-slate-600">simulated-wpe</code>
            でシミュレーター端末を追加できます。
          </p>
          <div className="space-y-2">
            <input
              value={registrationCode}
              onChange={(e) => setRegistrationCode(e.target.value)}
              placeholder="登録コード（例: simulated-wpe）"
              disabled={submitting || !linked}
              className="h-11 w-full rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-900 disabled:opacity-50"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="端末名（任意・例: レジ横S700）"
              disabled={submitting || !linked}
              className="h-11 w-full rounded-xl border-2 border-slate-100 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-900 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleRegister}
              disabled={submitting || !linked}
              className="h-11 w-full rounded-xl bg-slate-900 text-sm font-black text-white transition active:scale-95 disabled:opacity-50"
            >
              {submitting ? '登録中…' : '端末を登録'}
            </button>
          </div>
          {message && (
            <p
              className={`mt-2 text-xs font-bold ${
                message.type === 'error' ? 'text-red-500' : 'text-emerald-600'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>

        {/* 登録済み端末 */}
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-black text-slate-800">
            登録済みの端末（{readers.length}）
          </h3>
          {readers.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-400">
              まだ登録された端末はありません。
            </p>
          ) : (
            <ul className="space-y-2">
              {readers.map((reader) => (
                <li
                  key={reader.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-800">
                      {reader.label || reader.id}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                      {reader.deviceType || '端末'} / {reader.id}
                    </div>
                  </div>
                  <span
                    className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                      reader.status === 'online'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {STATUS_LABEL[reader.status] || reader.status || '不明'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] font-bold text-slate-400">
            登録した端末は、各レジの「STRIPE リーダー」で割り当てられます。
          </p>
        </div>

        {/* 将来: リース/購入 */}
        <div className="rounded-2xl border border-dashed border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500">端末を用意する</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">
              近日対応
            </span>
          </div>
          <p className="mt-1 text-[11px] font-bold text-slate-400">
            将来的に、この画面から決済端末のリース／購入を申し込めるようにする予定です。
          </p>
        </div>
      </div>
    </div>
  );
};

export default CardTerminalModal;
