import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Delete, Search, Undo2, X } from 'lucide-react';

import { appConfirm } from '../../../shared/components/feedback/AppConfirmDialog';
import {
  coreErrorMessage,
  grantCrmLegacyStamp,
  searchCrmMembers,
  setCrmMemberPhone,
  undoCrmMemberPhone
} from '../services/crmMemberDirectoryService';

// 既存会員の検索 → 携帯番号を主番号に登録 → 手書きスタンプ途中分のポイント付与。
// ポイントカードのご案内を始める前に必要になる店頭作業をここ1枚にまとめる。
//
// なぜ要るか: 会員の名寄せキーは電話番号の数字列の完全一致。既存会員の18.7%(prod 3,320人)は
// 固定電話で登録されているので、その人がポイントカードに携帯で登録すると既存のお客様として
// 繋がらず、これまでのポイントと累計購入額が引き継がれない。気づくのは店頭で
// 「前のポイントが無い」と言われた時なので、先に携帯番号をお伺いして主番号に入れる。
//
// ⚠**1件目を自動選択しない**。同じ電話番号のお客様が複数いる（家族で1番号を共有。prod で
//   871番号・1,837人）ため、自動で選ぶと他人のポイントを渡す事故になる。必ず人に選ばせる。
// ⚠表示は氏名・カナ・電話下4桁・町名まで。番地・累計購入額・生年月日はサーバが返していない。

const REASON_PRESETS = [
  'スタンプカード途中分',
  'スタンプカード2枚目以降',
  'スタンプカード紛失・再発行'
];

const MIN_QUERY_LENGTH = 3;

/** 「あと12:34」の形。残り時間の表示用。 */
const formatRemaining = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** 都道府県＋市区町村＋町名。番地はサーバが返していない（レジには出さない）。 */
const formatTown = (row) => [row.pref, row.city, row.town].filter(Boolean).join('');

const Tenkey = ({ onDigit, onBackspace, onClear }) => (
  <div className="grid grid-cols-3 gap-1.5">
    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
      <button
        key={d}
        type="button"
        onClick={() => onDigit(d)}
        className="h-11 rounded-xl border border-slate-200 bg-white font-mono text-lg font-black text-slate-800 active:scale-95"
      >
        {d}
      </button>
    ))}
    <button
      type="button"
      onClick={onClear}
      className="h-11 rounded-xl border border-slate-200 bg-slate-50 text-xs font-black text-slate-500 active:scale-95"
    >
      クリア
    </button>
    <button
      type="button"
      onClick={() => onDigit('0')}
      className="h-11 rounded-xl border border-slate-200 bg-white font-mono text-lg font-black text-slate-800 active:scale-95"
    >
      0
    </button>
    <button
      type="button"
      onClick={onBackspace}
      className="flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 active:scale-95"
      aria-label="1桁消す"
    >
      <Delete size={18} strokeWidth={2.6} />
    </button>
  </div>
);

const MemberRow = ({ row, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${
      active
        ? 'border-slate-900 bg-slate-900 text-white'
        : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50'
    }`}
  >
    <div className="flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-black">{row.displayName || '（氏名なし）'}</div>
        {row.nameKana && (
          <div className={`truncate text-[11px] font-bold ${active ? 'text-slate-300' : 'text-slate-400'}`}>
            {row.nameKana}
          </div>
        )}
      </div>
      <div className={`shrink-0 text-[11px] font-black ${active ? 'text-emerald-300' : 'text-emerald-700'}`}>
        {row.pointBalance.toLocaleString()}pt
      </div>
    </div>
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold ${active ? 'text-slate-300' : 'text-slate-500'}`}>
      <span>{row.phoneLast4 ? `電話 下4桁 ${row.phoneLast4}` : '電話番号なし'}</span>
      {row.subPhoneLast4 && <span>/ 副 {row.subPhoneLast4}</span>}
      <span>{row.addressUnknown ? '住所不明' : (formatTown(row) || '住所なし')}</span>
      {row.legacyStampCards > 0 && <span>カード {row.legacyStampCards}枚</span>}
    </div>
    <div className="mt-1 flex flex-wrap gap-1">
      {row.needsMobile && (
        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">
          {row.hasPhone ? '携帯未登録' : '電話番号なし'}
        </span>
      )}
      {row.hasLine && (
        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800">LINE連携済み</span>
      )}
      {row.phoneShared && (
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600">番号共有</span>
      )}
      {row.hasIdentityConflict && (
        <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-700">要確認</span>
      )}
    </div>
  </button>
);

// 選んだお客様への操作（携帯番号の登録・スタンプ途中分の付与）。
// ⚠**personId を key にしてマウントする**こと。お客様を切り替えたときに入力中の金額や
//   番号が残ると、別の人へ誤って付与してしまう。key を付けておけば React が作り直す。
const MemberActions = ({ storeId, member, meta, onPatchRow, onLoadMember, onClose }) => {
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneErr, setPhoneErr] = useState('');
  const [phoneDone, setPhoneDone] = useState(null); // { changeId, undoableUntilMs }

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(REASON_PRESETS[0]);
  const [granting, setGranting] = useState(false);
  const [grantErr, setGrantErr] = useState('');
  const [grantDone, setGrantDone] = useState(null); // { amount, points }
  // 冪等キー。1回の付与操作で使い回し、成功したら次の操作用に作り直す。
  const grantIdRef = useRef('');
  const [now, setNow] = useState(() => Date.now());

  // 取消の残り時間を1秒ごとに描き替える（窓が閉じたらボタンを消す）
  useEffect(() => {
    if (!phoneDone?.undoableUntilMs) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phoneDone]);

  const undoRemaining = phoneDone?.undoableUntilMs ? phoneDone.undoableUntilMs - now : 0;

  const registerPhone = async () => {
    if (!member) return;
    setPhoneBusy(true);
    setPhoneErr('');
    try {
      const res = await setCrmMemberPhone({ storeId, personId: member.personId, phone: phoneInput });
      if (res.unchanged) {
        setPhoneErr('同じ番号が既に主番号として登録されています。');
        return;
      }
      onPatchRow(member.personId, {
        phoneLast4: res.phoneLast4 || null,
        subPhoneLast4: res.subPhoneLast4 || null,
        needsMobile: res.needsMobile === true,
        hasPhone: true
      });
      setPhoneDone({ changeId: res.changeId, undoableUntilMs: Number(res.undoableUntilMs || 0) });
      setPhoneInput('');
      setNow(Date.now());
    } catch (e) {
      // ⚠「別のお客様に登録済み」(phone_taken)は Core が索引を付け替えずに弾いた合図。
      //   家族で1番号を共有しているケースが普通にあるので、奪わず検索に戻す。
      setPhoneErr(coreErrorMessage(e, '登録できませんでした。'));
    } finally {
      setPhoneBusy(false);
    }
  };

  const undoPhone = async () => {
    if (!member || !phoneDone?.changeId) return;
    setPhoneBusy(true);
    setPhoneErr('');
    try {
      const res = await undoCrmMemberPhone({
        storeId, personId: member.personId, changeId: phoneDone.changeId
      });
      onPatchRow(member.personId, {
        phoneLast4: res.phoneLast4 || null,
        subPhoneLast4: res.subPhoneLast4 || null,
        needsMobile: res.needsMobile !== false,
        hasPhone: !!res.phoneLast4
      });
      setPhoneDone(null);
    } catch (e) {
      setPhoneErr(coreErrorMessage(e, '取り消せませんでした。'));
    } finally {
      setPhoneBusy(false);
    }
  };

  const amountNumber = Math.max(0, Math.floor(Number(amount || 0) || 0));
  const stampCardYen = Number(meta.stampCardYen || 30000);
  const previewPoints = meta.pointsPerYen > 0 ? Math.floor(amountNumber * meta.pointsPerYen) : 0;
  // 付与は有効なのに付与率が取れていない＝サーバ側の受け渡し漏れ。
  // ⚠「金額が小さい」と区別しないと、原因が分からないまま押せないボタンを眺めることになる
  //   （実際に2026-10-06、レジの中継が pointsPerYen を返し忘れてこの状態になった）。
  const rateMissing = meta.pointsEnabled && !(meta.pointsPerYen > 0);
  const overLimit = amountNumber > stampCardYen;
  // ⚠1pt にも満たない金額は Core が amount_too_small で弾く。押せてしまうと現場が迷うので手前で止める。
  const canGrant = !!member && amountNumber > 0 && previewPoints > 0 && !overLimit && !!reason.trim() && meta.pointsEnabled;

  const grant = async () => {
    if (!canGrant || !member) return;
    if (!grantIdRef.current) {
      grantIdRef.current = `${member.personId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    setGranting(true);
    setGrantErr('');
    try {
      const args = {
        storeId,
        personId: member.personId,
        amount: amountNumber,
        reason: reason.trim(),
        grantId: grantIdRef.current
      };
      let res = await grantCrmLegacyStamp(args);

      // 満了済み枚数から見て多すぎる付与。止めるのではなく、スタッフに確認させて記録に残す。
      if (res.requiresConfirm === true) {
        const ok = await appConfirm(
          `このお客様の満了カードは ${res.legacyStampCards}枚（これまでの付与 ¥${Number(res.grantedAmount || 0).toLocaleString()}）です。\n`
          + `今回の ¥${amountNumber.toLocaleString()} を足すと、カード枚数から見た目安 ¥${Number(res.cap || 0).toLocaleString()} を超えます。\n\n`
          + 'お手元のカードの枚数をご確認ください。このまま付与しますか？',
          { title: 'カード枚数より多い付与', okLabel: '確認した・付与する', tone: 'danger' }
        );
        if (!ok) return;
        res = await grantCrmLegacyStamp({ ...args, confirm: true });
        if (res.requiresConfirm === true) {
          setGrantErr('付与できませんでした。もう一度お試しください。');
          return;
        }
      }

      setGrantDone({ amount: amountNumber, points: Number(res.points || 0), duplicate: res.duplicate === true });
      onPatchRow(member.personId, {
        pointBalance: Number(member.pointBalance || 0) + Number(res.points || 0),
        legacyStampGrantedAmount: Number(member.legacyStampGrantedAmount || 0) + amountNumber
      });
      setAmount('');
      grantIdRef.current = ''; // 次の付与は別の冪等キーで
    } catch (e) {
      setGrantErr(coreErrorMessage(e, '付与できませんでした。'));
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-base font-black text-slate-900">{member.displayName || '（氏名なし）'}</div>
        {member.nameKana && <div className="text-[11px] font-bold text-slate-400">{member.nameKana}</div>}
        <dl className="mt-2 space-y-1 text-xs font-bold text-slate-600">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">主番号</dt>
            <dd>{member.phoneLast4 ? `下4桁 ${member.phoneLast4}` : '登録なし'}</dd>
          </div>
          {member.subPhoneLast4 && (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">固定・その他</dt>
              <dd>下4桁 {member.subPhoneLast4}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">ご住所</dt>
            <dd>{member.addressUnknown ? '不明' : (formatTown(member) || '登録なし')}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">ポイント</dt>
            <dd className="text-emerald-700">{member.pointBalance.toLocaleString()}pt</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">満了カード</dt>
            <dd>
              {member.legacyStampCards}枚
              {member.legacyStampGrantedAmount > 0
                && `（途中分の付与 ¥${Number(member.legacyStampGrantedAmount).toLocaleString()}）`}
            </dd>
          </div>
        </dl>
      </div>

      {/* 携帯番号。固定電話しか無い人はここで必ずアラートが出る。 */}
      <div className={`rounded-2xl border px-4 py-3 ${member.needsMobile ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
        {member.needsMobile ? (
          <div className="mb-2 flex items-start gap-2 text-xs font-black text-amber-800">
            <AlertTriangle size={15} strokeWidth={2.8} className="mt-0.5 shrink-0" />
            <span>
              {member.hasPhone
                ? '主番号が携帯ではありません（固定電話）。'
                : 'お電話番号が登録されていません。'}
              <br />
              このままポイントカードにご登録いただくと、これまでのポイントが引き継がれません。
              携帯番号をお伺いしてご登録ください。
            </span>
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-1.5 text-xs font-black text-emerald-700">
            <Check size={15} strokeWidth={3} />
            携帯番号が主番号に登録されています
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); registerPhone(); }}
          className="flex items-center gap-2"
        >
          <input
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            inputMode="numeric"
            placeholder="携帯番号（090/080/070）"
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-slate-100 bg-white px-3 font-mono text-sm font-bold outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={phoneBusy || !/^0[789]0\d{8}$/.test(phoneInput.replace(/\D/g, ''))}
            className="h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-xs font-black text-white disabled:opacity-40"
          >
            {phoneBusy ? '登録中…' : '主番号に登録'}
          </button>
        </form>
        <p className="mt-1.5 text-[11px] font-bold text-slate-500">
          今までのお電話番号は残ります（どちらの番号でもお客様を特定できます）。
          お電話番号の変更がないかも併せてお伺いしてください。
        </p>
        {phoneErr && <div className="mt-1.5 text-[11px] font-bold text-red-600">{phoneErr}</div>}

        {phoneDone && undoRemaining > 0 && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
            <span className="text-[11px] font-bold text-slate-500">
              登録しました。打ち間違いはあと {formatRemaining(undoRemaining)} 取り消せます。
            </span>
            <button
              type="button"
              onClick={undoPhone}
              disabled={phoneBusy}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-black text-slate-600 disabled:opacity-40"
            >
              <Undo2 size={13} strokeWidth={2.8} />
              取り消す
            </button>
          </div>
        )}
      </div>

      {/* スタンプ途中分の付与。入力は金額だけ。ポイントは付与率から自動計算。 */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-xs font-black text-slate-700">手書きスタンプの途中分を付与</div>
        {!meta.pointsEnabled ? (
          <p className="mt-2 text-[11px] font-bold text-slate-500">
            この店舗はポイントの付与が無効になっています。
          </p>
        ) : (
          <>
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              お手元のカードに貯まっている分を<strong className="text-slate-700">お買い上げ金額</strong>で入力してください。
              1回あたり ¥{stampCardYen.toLocaleString()}（カード1枚分）までです。
              2枚以上は分けて付与してください。
            </p>

            <div className="mt-2 flex items-baseline justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-xs font-black text-slate-500">金額</span>
              <span className="font-mono text-2xl font-black text-slate-900">
                ¥{amountNumber.toLocaleString()}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 px-3">
              <span className="text-[11px] font-bold text-slate-400">付与されるポイント</span>
              <span className="font-mono text-sm font-black text-emerald-700">
                {previewPoints.toLocaleString()}pt
              </span>
            </div>
            {overLimit && (
              <div className="mt-1.5 text-[11px] font-bold text-red-600">
                1回あたり ¥{stampCardYen.toLocaleString()} までです。
              </div>
            )}
            {rateMissing && (
              <div className="mt-1.5 text-[11px] font-bold text-red-600">
                ポイントの付与率を取得できませんでした。検索をやり直しても直らない場合は運営にご連絡ください。
              </div>
            )}
            {!rateMissing && !overLimit && amountNumber > 0 && previewPoints <= 0 && (
              <div className="mt-1.5 text-[11px] font-bold text-amber-700">
                この金額ではポイントが付きません。金額をご確認ください。
              </div>
            )}

            <div className="mt-2">
              <Tenkey
                onDigit={(d) => setAmount((prev) => (prev + d).replace(/^0+/, '').slice(0, 7))}
                onBackspace={() => setAmount((prev) => prev.slice(0, -1))}
                onClear={() => setAmount('')}
              />
            </div>

            <div className="mt-3">
              <div className="mb-1 text-[11px] font-black text-slate-500">付与の理由（記録に残ります）</div>
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(preset)}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-black transition ${
                      reason === preset
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="理由（必須）"
                className="h-10 w-full rounded-xl border-2 border-slate-100 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-400"
              />
            </div>

            <button
              type="button"
              onClick={grant}
              disabled={!canGrant || granting}
              className="mt-3 h-12 w-full rounded-xl bg-slate-900 text-sm font-black text-white disabled:opacity-40"
            >
              {granting
                ? '付与中…'
                : `¥${amountNumber.toLocaleString()} 分（${previewPoints.toLocaleString()}pt）を付与`}
            </button>
            {grantErr && <div className="mt-1.5 text-[11px] font-bold text-red-600">{grantErr}</div>}
            {grantDone && (
              <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-black text-emerald-800">
                {grantDone.duplicate
                  ? 'この付与は既に記録されています（二重付与にはなっていません）。'
                  : `¥${grantDone.amount.toLocaleString()} 分 ${grantDone.points.toLocaleString()}pt を付与しました。`}
              </div>
            )}
          </>
        )}
      </div>

      {typeof onLoadMember === 'function' && (
        <button
          type="button"
          onClick={() => { onLoadMember(member); onClose?.(); }}
          className="h-12 w-full rounded-xl border-2 border-emerald-300 bg-white text-sm font-black text-emerald-700 hover:bg-emerald-50"
        >
          このお客様を会計に読み込む
        </button>
      )}
    </div>
  );
};

const PosMemberSearchModal = ({ storeId, onClose, onLoadMember }) => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null); // null=未検索 / []=0件
  const [meta, setMeta] = useState({ matchCount: 0, truncated: false, pointsPerYen: 0, pointsEnabled: true, stampCardYen: 30000 });
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  const [selectedId, setSelectedId] = useState('');

  const selected = useMemo(
    () => (rows || []).find((r) => r.personId === selectedId) || null,
    [rows, selectedId]
  );

  const runSearch = useCallback(async () => {
    const term = q.trim();
    if (term.replace(/[\s\u3000]+/g, '').length < MIN_QUERY_LENGTH) {
      setSearchErr(`${MIN_QUERY_LENGTH}文字以上で検索してください。`);
      return;
    }
    setSearching(true);
    setSearchErr('');
    setSelectedId('');
    try {
      const res = await searchCrmMembers({ storeId, q: term });
      setRows(res.members);
      setMeta({
        matchCount: res.matchCount,
        truncated: res.truncated,
        pointsPerYen: res.pointsPerYen,
        pointsEnabled: res.pointsEnabled,
        stampCardYen: res.stampCardYen
      });
    } catch (e) {
      setRows(null);
      setSearchErr(coreErrorMessage(e, '検索できませんでした。'));
    } finally {
      setSearching(false);
    }
  }, [q, storeId]);

  /** 検索結果の1行を書き換える（番号を登録したら表示もその場で追従させる）。 */
  const patchRow = useCallback((personId, patch) => {
    setRows((prev) => (prev || []).map((r) => (r.personId === personId ? { ...r, ...patch } : r)));
  }, []);
  // ⚠親は「開いている時だけマウントする」こと（UncodedSaleModal と同じ）。
  //   開閉を prop で持つと前のお客様の検索結果が残り、取り違えの元になる。
  if (typeof document === 'undefined') return null;


  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500">Member</p>
            <h3 className="mt-0.5 text-xl font-black text-slate-900">会員検索・携帯番号の登録</h3>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
              お電話番号・お名前・ふりがな・町名で検索できます（スペース区切りで絞り込み）。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
            aria-label="閉じる"
          >
            <X size={18} strokeWidth={2.8} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 左: 検索と結果 */}
          <div className="flex min-h-0 flex-col border-slate-100 lg:border-r">
            <form
              onSubmit={(e) => { e.preventDefault(); runSearch(); }}
              className="flex shrink-0 items-center gap-2 px-5 py-3"
            >
              <div className="relative min-w-0 flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoFocus
                  placeholder="例: 0852211234 / 石原 / いしはら 東朝日町"
                  className="h-11 w-full rounded-xl border-2 border-slate-100 bg-white pl-9 pr-3 text-sm font-bold outline-none focus:border-emerald-400"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="h-11 shrink-0 rounded-xl bg-slate-900 px-5 text-sm font-black text-white disabled:opacity-40"
              >
                {searching ? '検索中…' : '検索'}
              </button>
            </form>

            {searchErr && (
              <div className="mx-5 mb-2 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{searchErr}</div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              {rows === null && !searchErr && (
                <p className="px-1 py-6 text-xs font-bold leading-relaxed text-slate-400">
                  手書きスタンプカードに「1」と書かれているお客様は新規です。検索は不要で、
                  そのまま LINE でポイントカードにご登録いただけます（携帯番号でご登録いただければ自動で繋がります）。
                  <br />
                  検索が必要なのは2枚目以降のお客様です。
                </p>
              )}

              {rows !== null && rows.length === 0 && (
                <p className="px-1 py-6 text-xs font-bold text-slate-400">
                  該当するお客様が見つかりませんでした。お名前の表記（漢字・ふりがな）や、
                  以前ご登録のお電話番号でもお試しください。
                </p>
              )}

              {rows !== null && rows.length > 0 && (
                <>
                  <div className="mb-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                    <AlertTriangle size={14} strokeWidth={2.8} className="shrink-0" />
                    <span>
                      同じお電話番号のお客様が複数いらっしゃることがあります。お名前と町名でご本人をお確かめください。
                    </span>
                  </div>
                  {meta.truncated && (
                    <p className="mb-2 px-1 text-[11px] font-bold text-slate-400">
                      {meta.matchCount}件のうち{rows.length}件を表示しています。お名前や町名を足して絞り込んでください。
                    </p>
                  )}
                  <div className="space-y-2">
                    {rows.map((row) => (
                      <MemberRow
                        key={row.personId}
                        row={row}
                        active={row.personId === selectedId}
                        onClick={() => setSelectedId(row.personId)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 右: 選んだお客様の操作。key でお客様ごとに作り直す（入力の持ち越し防止）。 */}
          <div className="min-h-0 overflow-y-auto bg-slate-50/60 px-5 py-4">
            {selected ? (
              <MemberActions
                key={selected.personId}
                storeId={storeId}
                member={selected}
                meta={meta}
                onPatchRow={patchRow}
                onLoadMember={onLoadMember}
                onClose={onClose}
              />
            ) : (
              <p className="px-1 py-6 text-xs font-bold text-slate-400">
                左の一覧からお客様をお選びください。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PosMemberSearchModal;
