import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, Delete, Search, Undo2, X } from 'lucide-react';

import { appConfirm } from '../../../shared/components/feedback/AppConfirmDialog';
import { rankTheme } from '../utils/rankTheme';
import {
  adjustCrmMemberLtv,
  coreErrorMessage,
  getCrmMemberLtv,
  grantCrmLegacyStamp,
  searchCrmMembers,
  setCrmMemberPhone,
  undoCrmMemberPhone
} from '../services/crmMemberDirectoryService';

// 既存会員の検索 → 携帯番号を主番号に登録 → 手動でのポイント付与（紙のカードなどからの移行）。
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

// 付与の理由。⚠管理しているのは**お買い上げ金額**で、それは金額欄そのもの
// （ポイントと累計購入額の両方に同じ額が積まれる）。理由は「何のための付与か」を
// 台帳に残すためだけに要る。
// 既定は「ポイント移動」＝紙のカードや他システムからの引き継ぎ。それ以外は自由記入
// （テナントごとに事情が違うので、選択肢をこちらで増やさない）。
const TRANSFER_REASON = 'ポイント移動';

const RankBadge = ({ rank, size = 'sm' }) => {
  const theme = rankTheme(rank);
  if (!theme) return null;
  return (
    <span
      className={`shrink-0 rounded-md font-black tracking-[0.12em] ${
        size === 'lg' ? 'px-2.5 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]'
      }`}
      style={{ background: theme.bg, color: theme.label }}
    >
      {rank.name}
    </span>
  );
};

const yen = (v) => `¥${Number(v || 0).toLocaleString()}`;
const fmtAt = (ms) => (ms ? new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

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
        className="h-11 rounded-xl border border-gray-200 bg-white font-mono text-lg font-black text-gray-800 active:scale-95"
      >
        {d}
      </button>
    ))}
    <button
      type="button"
      onClick={onClear}
      className="h-11 rounded-xl border border-gray-200 bg-gray-50 text-xs font-black text-gray-500 active:scale-95"
    >
      クリア
    </button>
    <button
      type="button"
      onClick={() => onDigit('0')}
      className="h-11 rounded-xl border border-gray-200 bg-white font-mono text-lg font-black text-gray-800 active:scale-95"
    >
      0
    </button>
    <button
      type="button"
      onClick={onBackspace}
      className="flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 active:scale-95"
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
        ? 'border-ui bg-ui text-white'
        : 'border-gray-200 bg-white hover:border-gray-200 hover:bg-gray-100'
    }`}
  >
    <div className="flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-black">{row.displayName || '（氏名なし）'}</span>
          <RankBadge rank={row.rank} />
        </div>
        {row.nameKana && (
          <div className={`truncate text-[11px] font-bold ${active ? 'text-gray-300' : 'text-gray-500'}`}>
            {row.nameKana}
          </div>
        )}
      </div>
      <div className={`shrink-0 text-[11px] font-black ${active ? 'text-gray-300' : 'text-gray-900'}`}>
        {row.pointBalance.toLocaleString()}pt
      </div>
    </div>
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold ${active ? 'text-gray-300' : 'text-gray-500'}`}>
      <span>{row.phoneLast4 ? `電話 下4桁 ${row.phoneLast4}` : '電話番号なし'}</span>
      {row.subPhoneLast4 && <span>/ 副 {row.subPhoneLast4}</span>}
      <span>{row.addressUnknown ? '住所不明' : (formatTown(row) || '住所なし')}</span>
    </div>
    <div className="mt-1 flex flex-wrap gap-1">
      {row.needsMobile && (
        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">
          {row.hasPhone ? '携帯未登録' : '電話番号なし'}
        </span>
      )}
      {row.hasLine && (
        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-black text-gray-900">LINE連携済み</span>
      )}
      {row.phoneShared && (
        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-black text-gray-600">番号共有</span>
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
  // 累計のお買い上げ金額(LTV)の内訳・履歴・修正。開いた時だけ読む。
  const [ltvOpen, setLtvOpen] = useState(false);
  const [ltvLoading, setLtvLoading] = useState(false);
  const [ltvDetail, setLtvDetail] = useState(null);
  const [ltvInput, setLtvInput] = useState('');
  const [ltvReason, setLtvReason] = useState('');
  const [ltvBusy, setLtvBusy] = useState(false);
  const [ltvErr, setLtvErr] = useState('');
  const adjustIdRef = useRef('');

  const [reasonKind, setReasonKind] = useState('transfer'); // transfer | other
  const [memo, setMemo] = useState('');                     // 「その他」を選んだ時の内容
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
  // 1回あたりの上限。Core が返す（DECOLLE ではスタンプカード1枚＝¥30,000 が由来）。
  const grantLimitYen = Number(meta.stampCardYen || 30000);
  const previewPoints = meta.pointsPerYen > 0 ? Math.floor(amountNumber * meta.pointsPerYen) : 0;
  // 付与は有効なのに付与率が取れていない＝サーバ側の受け渡し漏れ。
  // ⚠「金額が小さい」と区別しないと、原因が分からないまま押せないボタンを眺めることになる
  //   （実際に2026-10-06、レジの中継が pointsPerYen を返し忘れてこの状態になった）。
  const rateMissing = meta.pointsEnabled && !(meta.pointsPerYen > 0);
  const overLimit = amountNumber > grantLimitYen;
  // ⚠1pt にも満たない金額は Core が amount_too_small で弾く。押せてしまうと現場が迷うので手前で止める。
  const reason = reasonKind === 'other' ? memo.trim() : TRANSFER_REASON;
  // ⚠「その他」を選んだら中身は必須。空のまま通すと台帳に理由が残らない。
  const canGrant = !!member && amountNumber > 0 && previewPoints > 0 && !overLimit
    && !!reason && meta.pointsEnabled;

  // 行の値はキャッシュではなく、開いた時に読んだ内訳を正とする（修正直後も合う）。
  const ltvShown = ltvDetail ? Number(ltvDetail.ltvTotal || 0) : Number(member.ltvTotal || 0);
  const ltvNext = ltvInput === '' ? null : Math.floor(Number(ltvInput) || 0);
  const ltvDelta = ltvNext === null ? 0 : ltvNext - ltvShown;
  const canAdjustLtv = !!ltvDetail && ltvNext !== null && ltvDelta !== 0 && !!ltvReason.trim();

  const loadLtvDetail = useCallback(async () => {
    setLtvLoading(true);
    setLtvErr('');
    try {
      const d = await getCrmMemberLtv({ storeId, personId: member.personId });
      setLtvDetail(d);
      return d;
    } catch (e) {
      setLtvDetail(null);
      setLtvErr(coreErrorMessage(e, '内訳を読み込めませんでした。'));
      return null;
    } finally {
      setLtvLoading(false);
    }
  }, [storeId, member.personId]);

  const toggleLtvPanel = () => {
    setLtvOpen((prev) => {
      if (!prev && !ltvDetail) loadLtvDetail();
      return !prev;
    });
  };

  const adjustLtv = async () => {
    if (!canAdjustLtv) return;
    if (!adjustIdRef.current) {
      adjustIdRef.current = `${member.personId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    setLtvBusy(true);
    setLtvErr('');
    try {
      const args = {
        storeId,
        personId: member.personId,
        ltvTotal: ltvNext,
        reason: ltvReason.trim(),
        adjustId: adjustIdRef.current
      };
      let r = await adjustCrmMemberLtv(args);

      // 大きな修正（ランクが動き得る幅）は確認を挟む。止めはしない。
      if (r.requiresConfirm === true) {
        const ok = await appConfirm(
          `累計のお買い上げ金額を ${yen(r.before)} から ${yen(r.next)} に直します`
          + `（${r.delta > 0 ? '+' : ''}${yen(r.delta)}）。\n\n`
          + `${yen(r.confirmOverYen)} を超える修正です。カードの格が変わることがあります。\n`
          + '金額に間違いがないかご確認ください。このまま修正しますか？',
          { title: '大きな金額の修正', okLabel: '確認した・修正する', tone: 'danger' }
        );
        if (!ok) return;
        r = await adjustCrmMemberLtv({ ...args, confirm: true });
        if (r.requiresConfirm === true) {
          setLtvErr('修正できませんでした。もう一度お試しください。');
          return;
        }
      }

      adjustIdRef.current = '';
      setLtvInput('');
      setLtvReason('');
      // 内訳を読み直し、一覧の行（金額とランク）も合わせる。
      const fresh = await loadLtvDetail();
      if (fresh) {
        onPatchRow(member.personId, {
          ltvTotal: Number(fresh.ltvTotal || 0),
          ...(fresh.rank !== undefined ? { rank: fresh.rank } : {})
        });
      }
    } catch (e) {
      setLtvErr(coreErrorMessage(e, '修正できませんでした。'));
    } finally {
      setLtvBusy(false);
    }
  };

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
          `このお客様へのこれまでの手動付与は ¥${Number(res.grantedAmount || 0).toLocaleString()} です。\n`
          + `今回の ¥${amountNumber.toLocaleString()} を足すと、過去のご購入から見た目安 ¥${Number(res.cap || 0).toLocaleString()} を超えます。\n\n`
          + '金額に間違いがないかご確認ください。このまま付与しますか？',
          { title: '目安より多い付与', okLabel: '確認した・付与する', tone: 'danger' }
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
        ltvTotal: Number(member.ltvTotal || 0) + amountNumber,
        manualGrantedAmount: Number(member.manualGrantedAmount || 0) + amountNumber
      });
      setAmount('');
      setReasonKind('transfer');
      setMemo('');
      if (ltvOpen) loadLtvDetail(); // 内訳を開いていたら手動付与の分を反映する
      grantIdRef.current = ''; // 次の付与は別の冪等キーで
    } catch (e) {
      setGrantErr(coreErrorMessage(e, '付与できませんでした。'));
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-black text-gray-900">{member.displayName || '（氏名なし）'}</span>
          <RankBadge rank={member.rank} size="lg" />
        </div>
        {member.nameKana && <div className="text-[11px] font-bold text-gray-500">{member.nameKana}</div>}
        <dl className="mt-2 space-y-1 text-xs font-bold text-gray-600">
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">主番号</dt>
            <dd>{member.phoneLast4 ? `下4桁 ${member.phoneLast4}` : '登録なし'}</dd>
          </div>
          {member.subPhoneLast4 && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">固定・その他</dt>
              <dd>下4桁 {member.subPhoneLast4}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">ご住所</dt>
            <dd>{member.addressUnknown ? '不明' : (formatTown(member) || '登録なし')}</dd>
          </div>
          <div className="flex justify-between gap-2">
            {/* 会員番号＝ポイントカードのバーコードの中身("MB"+これ)。お客様との照合に使う。
                カードを一度開いたお客様にだけ発行される。 */}
            <dt className="text-gray-500">会員番号</dt>
            <dd className="font-mono">{member.memberCode || 'カード未発行'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">ポイント</dt>
            <dd className="text-gray-900">{member.pointBalance.toLocaleString()}pt</dd>
          </div>
          <div className="flex justify-between gap-2">
            {/* ⚠累計購入額(LTV)はレジに出す(2026-10-06 判断)。手動付与の妥当性を
                その場で判断するのに要るため。カードの格もこの金額で決まる。 */}
            <dt className="text-gray-500">お買い上げ累計</dt>
            <dd>{yen(ltvShown)}</dd>
          </div>
        </dl>

        {/* 内訳と修正。取込元のカード枚数が空白・不正確なお客様の LTV を概算に直す。
            ⚠普段は畳んでおく（毎回開くものではないし、誤操作の入口を減らす）。 */}
        <button
          type="button"
          onClick={toggleLtvPanel}
          className="mt-2 flex w-full items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-[11px] font-black text-gray-600 hover:bg-gray-100"
        >
          <span>お買い上げ累計の内訳と修正</span>
          <ChevronDown size={14} strokeWidth={3} className={ltvOpen ? 'rotate-180 transition' : 'transition'} />
        </button>

        {ltvOpen && (
          <div className="mt-2 rounded-xl border border-gray-200 p-3">
            {ltvLoading && <p className="text-[11px] font-bold text-gray-500">読み込み中…</p>}
            {!ltvLoading && ltvDetail && (
              <>
                {/* 内訳: 合計だけだと「誰かが手で入れた数字」かどうかが分からない */}
                <dl className="space-y-1 text-[11px] font-bold text-gray-600">
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">会計・取込分</dt>
                    <dd>{yen(ltvDetail.baseAmount)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">手動付与</dt>
                    <dd>{yen(ltvDetail.manualGrantedAmount)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-500">補正</dt>
                    <dd>{ltvDetail.ltvAdjustedAmount > 0 ? `+${yen(ltvDetail.ltvAdjustedAmount)}` : yen(ltvDetail.ltvAdjustedAmount)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-t border-gray-100 pt-1 text-gray-800">
                    <dt>合計</dt>
                    <dd className="font-black">{yen(ltvDetail.ltvTotal)}</dd>
                  </div>
                </dl>

                {/* 履歴（補正と手動付与を分けて出す） */}
                {(ltvDetail.adjustments?.length > 0 || ltvDetail.grants?.length > 0) && (
                  <div className="mt-3 space-y-2">
                    {ltvDetail.adjustments?.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">補正の履歴</div>
                        <ul className="space-y-1">
                          {ltvDetail.adjustments.map((a) => (
                            <li key={a.id} className="flex items-baseline justify-between gap-2 text-[11px] font-bold text-gray-600">
                              <span className="min-w-0 truncate">{fmtAt(a.at)} {a.reason || ''}</span>
                              <span className={`shrink-0 tabular-nums ${a.delta < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                {a.delta > 0 ? '+' : ''}{yen(a.delta)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {ltvDetail.grants?.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">手動付与の履歴</div>
                        <ul className="space-y-1">
                          {ltvDetail.grants.map((g) => (
                            <li key={g.id} className="flex items-baseline justify-between gap-2 text-[11px] font-bold text-gray-600">
                              <span className="min-w-0 truncate">{fmtAt(g.at)} {g.reason || ''}</span>
                              <span className="shrink-0 tabular-nums text-gray-800">
                                {yen(g.amount)}（{Number(g.points || 0).toLocaleString()}pt）
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 修正フォーム */}
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="mb-1 text-[11px] font-black text-gray-500">正しい累計に直す</div>
                  <p className="mb-1.5 text-[11px] font-bold text-gray-500">
                    概算で構いません。⚠ポイントは動きません（会計と手動付与で積んだ結果のため）。
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-sm font-black text-gray-500">¥</span>
                    <input
                      value={ltvInput}
                      onChange={(e) => setLtvInput(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      inputMode="numeric"
                      placeholder={String(ltvDetail.ltvTotal)}
                      className="h-10 min-w-0 flex-1 rounded-xl border-2 border-gray-100 bg-white px-3 font-mono text-sm font-black outline-none focus:border-gray-900"
                    />
                  </div>
                  {ltvDelta !== 0 && (
                    <div className="mt-1 text-[11px] font-bold text-gray-500">
                      増減 <span className={ltvDelta < 0 ? 'text-red-600' : 'text-gray-800'}>
                        {ltvDelta > 0 ? '+' : ''}{yen(ltvDelta)}
                      </span>
                    </div>
                  )}
                  <input
                    value={ltvReason}
                    onChange={(e) => setLtvReason(e.target.value)}
                    placeholder="修正の理由（必須）"
                    className="mt-1.5 h-10 w-full rounded-xl border-2 border-gray-100 bg-white px-3 text-xs font-bold outline-none focus:border-gray-900"
                  />
                  <button
                    type="button"
                    onClick={adjustLtv}
                    disabled={!canAdjustLtv || ltvBusy}
                    className="mt-2 h-10 w-full rounded-xl bg-gray-900 text-xs font-black text-white disabled:opacity-40"
                  >
                    {ltvBusy ? '修正中…' : '累計を修正する'}
                  </button>
                  {ltvErr && <div className="mt-1.5 text-[11px] font-bold text-red-600">{ltvErr}</div>}
                </div>
              </>
            )}
            {!ltvLoading && !ltvDetail && ltvErr && (
              <div className="text-[11px] font-bold text-red-600">{ltvErr}</div>
            )}
          </div>
        )}
      </div>

      {/* 携帯番号。固定電話しか無い人はここで必ずアラートが出る。 */}
      <div className={`rounded-2xl border px-4 py-3 ${member.needsMobile ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
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
          <div className="mb-2 flex items-center gap-1.5 text-xs font-black text-gray-900">
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
            className="h-11 min-w-0 flex-1 rounded-xl border-2 border-gray-100 bg-white px-3 font-mono text-sm font-bold outline-none focus:border-gray-900"
          />
          <button
            type="submit"
            disabled={phoneBusy || !/^0[789]0\d{8}$/.test(phoneInput.replace(/\D/g, ''))}
            className="h-11 shrink-0 rounded-xl bg-gray-900 px-4 text-xs font-black text-white disabled:opacity-40"
          >
            {phoneBusy ? '登録中…' : '主番号に登録'}
          </button>
        </form>
        <p className="mt-1.5 text-[11px] font-bold text-gray-500">
          今までのお電話番号は残ります（どちらの番号でもお客様を特定できます）。
          お電話番号の変更がないかも併せてお伺いしてください。
        </p>
        {phoneErr && <div className="mt-1.5 text-[11px] font-bold text-red-600">{phoneErr}</div>}

        {phoneDone && undoRemaining > 0 && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
            <span className="text-[11px] font-bold text-gray-500">
              登録しました。打ち間違いはあと {formatRemaining(undoRemaining)} 取り消せます。
            </span>
            <button
              type="button"
              onClick={undoPhone}
              disabled={phoneBusy}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-black text-gray-600 disabled:opacity-40"
            >
              <Undo2 size={13} strokeWidth={2.8} />
              取り消す
            </button>
          </div>
        )}
      </div>

      {/* 手動付与（紙のカードなどからの移行）。入力は金額だけで、ポイントは付与率から自動計算。 */}
      <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <div className="text-xs font-black text-gray-700">手動でポイントを付与</div>
        {!meta.pointsEnabled ? (
          <p className="mt-2 text-[11px] font-bold text-gray-500">
            この店舗はポイントの付与が無効になっています。
          </p>
        ) : (
          <>
            <p className="mt-1 text-[11px] font-bold text-gray-500">
              付与の対象になる<strong className="text-gray-700">お買い上げ金額</strong>を入力してください。
              ポイントと<strong className="text-gray-700">累計のお買い上げ金額</strong>の両方に、この金額が反映されます。
              1回あたり ¥{grantLimitYen.toLocaleString()} までです。超える分は分けて付与してください。
            </p>

            <div className="mt-2 flex items-baseline justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-xs font-black text-gray-500">金額</span>
              <span className="font-mono text-2xl font-black text-gray-900">
                ¥{amountNumber.toLocaleString()}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 px-3">
              <span className="text-[11px] font-bold text-gray-500">付与されるポイント</span>
              <span className="font-mono text-sm font-black text-gray-900">
                {previewPoints.toLocaleString()}pt
              </span>
            </div>
            {overLimit && (
              <div className="mt-1.5 text-[11px] font-bold text-red-600">
                1回あたり ¥{grantLimitYen.toLocaleString()} までです。
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
              <div className="mb-1 text-[11px] font-black text-gray-500">付与の理由（記録に残ります）</div>
              <div className="flex gap-1.5">
                {[['transfer', TRANSFER_REASON], ['other', 'その他']].map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setReasonKind(kind)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition ${
                      reasonKind === kind
                        ? 'bg-ui text-white'
                        : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {reasonKind === 'other' && (
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="理由を入力（必須）"
                  className="mt-1.5 h-10 w-full rounded-xl border-2 border-gray-100 bg-white px-3 text-xs font-bold outline-none focus:border-gray-900"
                />
              )}
            </div>

            <button
              type="button"
              onClick={grant}
              disabled={!canGrant || granting}
              className="mt-3 h-12 w-full rounded-xl bg-gray-900 text-sm font-black text-white disabled:opacity-40"
            >
              {granting
                ? '付与中…'
                : `¥${amountNumber.toLocaleString()} 分（${previewPoints.toLocaleString()}pt）を付与`}
            </button>
            {grantErr && <div className="mt-1.5 text-[11px] font-bold text-red-600">{grantErr}</div>}
            {grantDone && (
              <div className="mt-2 rounded-xl bg-gray-100 px-3 py-2 text-[11px] font-black text-gray-900">
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
          className="h-12 w-full rounded-xl border-2 border-gray-200 bg-white text-sm font-black text-gray-900 hover:bg-gray-100"
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
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-gray-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Member</p>
            <h3 className="mt-0.5 text-xl font-black text-gray-900">会員検索・携帯番号の登録</h3>
            <p className="mt-1 text-xs font-bold leading-relaxed text-gray-500">
              お電話番号・お名前・ふりがな・町名で検索できます（スペース区切りで絞り込み）。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
            aria-label="閉じる"
          >
            <X size={18} strokeWidth={2.8} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 左: 検索と結果 */}
          <div className="flex min-h-0 flex-col border-gray-100 lg:border-r">
            <form
              onSubmit={(e) => { e.preventDefault(); runSearch(); }}
              className="flex shrink-0 items-center gap-2 px-5 py-3"
            >
              <div className="relative min-w-0 flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoFocus
                  placeholder="例: 0852211234 / 石原 / いしはら 東朝日町"
                  className="h-11 w-full rounded-xl border-2 border-gray-100 bg-white pl-9 pr-3 text-sm font-bold outline-none focus:border-gray-900"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="h-11 shrink-0 rounded-xl bg-gray-900 px-5 text-sm font-black text-white disabled:opacity-40"
              >
                {searching ? '検索中…' : '検索'}
              </button>
            </form>

            {searchErr && (
              <div className="mx-5 mb-2 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{searchErr}</div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              {rows === null && !searchErr && (
                <p className="px-1 py-6 text-xs font-bold leading-relaxed text-gray-500">
                  はじめてのお客様は検索不要です。そのまま LINE でポイントカードにご登録いただけます
                  （携帯番号でご登録いただければ、これまでの記録と自動で繋がります）。
                  <br />
                  検索が必要なのは、すでにお客様情報をお預かりしている方です。
                </p>
              )}

              {rows !== null && rows.length === 0 && (
                <p className="px-1 py-6 text-xs font-bold text-gray-500">
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
                    <p className="mb-2 px-1 text-[11px] font-bold text-gray-500">
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
          <div className="min-h-0 overflow-y-auto bg-gray-50/60 px-5 py-4">
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
              <p className="px-1 py-6 text-xs font-bold text-gray-500">
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
