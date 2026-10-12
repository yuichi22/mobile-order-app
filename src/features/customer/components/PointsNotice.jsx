// PointsNotice.jsx
// お会計画面の上に出す「ポイント」の案内と、「この注文にポイントをつける」(2026-10-12)。
//
// 3つの状態:
//  a) 紐づけ済み: 「◯◯さまに ◯pt つきます」+「別の人にする」「今回はつけない」
//  b) 端末が前回の会員を覚えている: 自動でつけ直す(確認中…)。失敗したら記憶を消して c へ
//  c) 未紐づけ: 「このお会計で ◯pt たまります」+ ボタン「この注文にポイントをつける（LINE で）」
//
// ボタンは LINE の会員証(ミニアプリ)を bind 付きで開く。会員証が本人を POS の卓セッションに紐づけ、
// レジでは会員証を見せなくてもポイントが付く。未登録の人は同じ入口で 1 分で登録できる。
// ⚠iOS Safari は非同期後の window.open を塞ぐので、トークンは画面を開いた時に先に作り、ボタンは素の <a> にする。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functionsApi } from '../../../shared/api/firebase/client';

const memoryKey = (storeId) => `akutoMember:${storeId}`;
const readMemory = (storeId) => {
  try { const raw = localStorage.getItem(memoryKey(storeId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const writeMemory = (storeId, member) => {
  try {
    if (member) localStorage.setItem(memoryKey(storeId), JSON.stringify(member));
    else localStorage.removeItem(memoryKey(storeId));
  } catch { /* noop */ }
};
const sessionFlag = (key) => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } };
const setSessionFlag = (key, on) => { try { if (on) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key); } catch { /* noop */ } };

export const PointsNotice = ({ storeId, sessionId, customerId, memberCardUrl, pointInfo, bound, myTotal, isOpen }) => {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [bindToken, setBindToken] = useState(null); // { token, at }
  const triedAutoRef = useRef(false);

  const brand = pointInfo?.brandName || 'LINE 会員証';
  const enabled = pointInfo?.linked !== false && pointInfo?.pointsEnabled !== false;
  const rate = Number(pointInfo?.pointsPerYen || 0);
  const mult = Math.max(1, Number(pointInfo?.campaignMultiplier || 1));
  const yenPerPoint = Math.max(1, Number(pointInfo?.yenPerPoint || 1));
  const pts = enabled && rate > 0 ? Math.floor(Number(myTotal || 0) * rate * mult) : 0;
  const skipKey = `akutoBindSkip:${sessionId}`;

  // 紐づいたら端末に覚える(次回は自動)
  useEffect(() => {
    if (bound?.personId && bound?.memberCode) writeMemory(storeId, { personId: bound.personId, memberCode: bound.memberCode, displayName: bound.displayName || null });
  }, [storeId, bound?.personId, bound?.memberCode, bound?.displayName]);

  // b) 端末の記憶で自動でつけ直す(画面を開いた時に1回だけ。「今回はつけない」の後はしない)
  useEffect(() => {
    if (!isOpen || bound || triedAutoRef.current || !sessionId || !storeId) return;
    if (sessionFlag(skipKey)) return;
    const mem = readMemory(storeId);
    if (!mem?.personId || !mem?.memberCode) return;
    triedAutoRef.current = true;
    setBusy('auto');
    httpsCallable(functionsApi, 'crmApplyRememberedMember')({ storeId, sessionId, customerId, personId: mem.personId, memberCode: mem.memberCode })
      .catch(() => { writeMemory(storeId, null); })
      .finally(() => setBusy(''));
  }, [isOpen, bound, sessionId, storeId, customerId, skipKey]);

  // c) ボタン用の一時トークンを先に作る(25分で作り直し)
  useEffect(() => {
    if (!isOpen || bound || !sessionId || !storeId || !enabled) return;
    if (bindToken && Date.now() - bindToken.at < 25 * 60 * 1000) return;
    let alive = true;
    httpsCallable(functionsApi, 'crmCreateBindToken')({ storeId, sessionId, customerId })
      .then((res) => { if (alive && res.data?.token) setBindToken({ token: res.data.token, at: Date.now() }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isOpen, bound, sessionId, storeId, customerId, enabled, bindToken]);

  const bindHref = useMemo(() => (
    bindToken?.token ? `${memberCardUrl}&bind=${encodeURIComponent(bindToken.token)}&bindStore=${encodeURIComponent(storeId)}` : memberCardUrl
  ), [memberCardUrl, bindToken?.token, storeId]);

  const clearBound = async ({ forget }) => {
    setMsg('');
    setBusy('clear');
    try {
      await httpsCallable(functionsApi, 'crmClearSessionMember')({ storeId, sessionId, customerId });
      setSessionFlag(skipKey, true);
      if (forget) writeMemory(storeId, null);
      setBindToken(null);
    } catch (e) {
      setMsg(e?.message || '解除できませんでした。');
    } finally {
      setBusy('');
    }
  };

  if (!enabled) return null;

  // a) 紐づけ済み
  if (bound) {
    const name = bound.displayName ? `${bound.displayName}さま` : '会員さま';
    return (
      <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2.5">
        <p className="text-[13px] font-black leading-snug text-gray-900 tabular-nums">
          {pts > 0 ? `${name}に ${pts.toLocaleString()}pt つきます` : `${name}の${brand}につきます`}
          {mult > 1 && <span className="ml-1 text-[11px] font-bold text-gray-500">本日 {mult}倍</span>}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-gray-500">お会計で会員証を見せなくても、自動でたまります。</p>
        <div className="mt-1.5 flex gap-4">
          <button type="button" disabled={!!busy} onClick={() => clearBound({ forget: true })} className="text-[11px] font-black text-gray-500 underline disabled:opacity-50">別の人にする</button>
          <button type="button" disabled={!!busy} onClick={() => clearBound({ forget: false })} className="text-[11px] font-black text-gray-500 underline disabled:opacity-50">今回はつけない</button>
        </div>
        {msg && <p className="mt-1 text-[11px] font-bold text-red-600">{msg}</p>}
      </div>
    );
  }

  // b) 自動でつけ直し中
  if (busy === 'auto') {
    return (
      <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2.5">
        <p className="text-[12px] font-bold text-gray-500">前回の会員証を確認しています…</p>
      </div>
    );
  }

  // c) 未紐づけ
  return (
    <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2.5">
      <p className="text-[13px] font-black leading-snug text-gray-900 tabular-nums">
        {pts > 0 ? `${brand}　このお会計で ${pts.toLocaleString()}pt たまります` : `${brand}でポイントがたまります`}
        {mult > 1 && <span className="ml-1 text-[11px] font-bold text-gray-500">本日 {mult}倍</span>}
      </p>
      <p className="mt-0.5 text-[11px] font-bold text-gray-500">
        1pt＝{yenPerPoint}円。お持ちの方はお会計時に会員証をご提示ください。
      </p>
      {/* ポイントがつく=価値が動く瞬間なので、会員証と同じ紺黒×シャンパン(2026-10-12 ユーザー決定)。
          店のテーマ色の「メニューに戻る」とも、ふつうの黒ボタンとも見分けがつく */}
      <a
        href={bindHref}
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex h-10 items-center justify-center rounded-xl px-3 text-sm font-black transition active:scale-95"
        style={{ backgroundColor: '#0B1220', color: '#D9C08A' }}
      >
        この注文にポイントをつける（LINE で）
      </a>
      <p className="mt-1.5 text-[11px] font-bold text-gray-500">会員証をお持ちでない方も、同じボタンから 1 分で作れます。</p>
      {msg && <p className="mt-1 text-[11px] font-bold text-red-600">{msg}</p>}
    </div>
  );
};
