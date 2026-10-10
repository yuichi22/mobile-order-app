import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functionsApi } from '../../../shared/api/firebase/client';

// 会員バーコードは "MB" + 会員番号。
// ⚠商品バーコード(JAN13/UPC-A の 12〜13桁数字)と衝突させないため、
//   スキャナからの横取りは必ずこの接頭辞付きのみを対象にする。
export const CRM_MEMBER_SCAN_PATTERN = /^MB\d{10,13}$/i;

export const isCrmMemberScanCode = (value) => CRM_MEMBER_SCAN_PATTERN.test(String(value || '').trim());

/**
 * CRM会員(ポイント)の読み込み状態を持つ共有フック。
 * POS/テイクアウト(PosMain)とイートインの会計(PosRegister)の両方から使う。
 * ⚠会員は「会計ごと」に解除する。読み込んだまま放置して次のお客様に紐づく事故を防ぐため、
 *   会計完了・保留・破棄の各経路で clearMember() を必ず呼ぶこと。
 */
// レジ起動時のウォームアップ。⚠1回の読み込みにつき店舗ごと1回だけ。
//   このフックは AdminApp / PosMain / PosRegister から作られることがあり、
//   素直に書くと同じ暖機が何度も飛ぶ。
const warmedStores = new Set();

export const useCrmMember = (storeId) => {
  const [member, setMember] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [codeInput, setCodeInput] = useState('');
  // この会計で使うポイント数(pt)。会計の割引明細(voucher_payment)として流し込む。
  const [pointsToUse, setPointsToUse] = useState(0);

  // ⚠会員照会は「レジ → この中継 → Core」の2段。どちらもしばらく使われないと
  //   コンテナが落ち、朝イチの1件目だけ起動待ちで待たされる。
  //   レジを開いた時に1回だけ空打ちして、両方を起こしておく（お客様は引かない）。
  //   失敗しても何もしない（暖機は「できたら得」なだけで、会計を止める理由にならない）。
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!storeId || warmedRef.current || warmedStores.has(storeId)) return;
    warmedRef.current = true;
    warmedStores.add(storeId);
    httpsCallable(functionsApi, 'crmLookupMember')({ storeId, warmup: true }).catch(() => {});
  }, [storeId]);

  const clearMember = useCallback(() => {
    setMember(null);
    setMessage('');
    setPointsToUse(0);
  }, []);

  /**
   * 会員コードを Core に照会して会員を特定する。
   * 成功したら会員オブジェクト、失敗したら null を返す(呼び出し側でトーストを出せるように)。
   * silent=true は「商品/卓として見つからなかった値の“ついで照会”」用で、
   * 失敗しても既存の会員選択やエラー表示を壊さない。
   */
  const lookupByCode = useCallback(async (rawCode, { silent = false, recheck = false } = {}) => {
    const code = String(rawCode || '').replace(/^MB/i, '').replace(/\D/g, '');
    if (!code) return null;
    setBusy(true);
    if (!silent) setMessage('');
    try {
      // recheck=true は「再照会」(友だち追加の直後)。Core が LINE に友だちを確認して保留ポイントを解放する
      const res = await httpsCallable(functionsApi, 'crmLookupMember')({ storeId, memberCode: code, ...(recheck ? { recheck: true } : {}) });
      const m = res.data || {};
      const next = {
        personId: m.personId,
        displayName: m.displayName || null,
        pointBalance: Number(m.pointBalance || 0),
        // カードの格（会員バーの色）と会員番号。⚠ランク判定は Core 側（お客様のカードと同じ）。
        rank: m.rank || null,
        memberCode: m.memberCode || null,
        pointsEnabled: m.pointsEnabled !== false,
        redeem: m.redeem || { yenPerPoint: 1, unit: 1 },
        // 登録状態(友だち追加が済んでいるか)と友だち追加待ちのポイント(2026-10-10)
        registration: m.registration || { complete: true },
        heldPoints: Number(m.heldPoints || 0)
      };
      setMember(next);
      setMessage('');
      return next;
    } catch (e) {
      if (!silent) {
        setMember(null);
        setMessage(e?.message || '会員を照会できませんでした。');
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [storeId]);

  /**
   * personId で会員を読み込む（groom の会計依頼を呼び出したとき用）。
   * ⚠会計依頼は会員コードを持たないので、これが無いとレジに会員が出ず
   *   ポイント利用もできない（付与だけ裏で走る状態になる）。
   */
  const lookupByPersonId = useCallback(async (personId, { fallbackName = null, recheck = false } = {}) => {
    const id = String(personId || '').trim();
    if (!id) return null;
    setBusy(true);
    try {
      const res = await httpsCallable(functionsApi, 'crmLookupMember')({ storeId, personId: id, ...(recheck ? { recheck: true } : {}) });
      const m = res.data || {};
      const next = {
        personId: m.personId || id,
        // Core に名前が無ければ呼び出し元の名前（会計依頼の顧客名）を使う
        displayName: m.displayName || fallbackName || null,
        pointBalance: Number(m.pointBalance || 0),
        rank: m.rank || null,
        memberCode: m.memberCode || null,
        pointsEnabled: m.pointsEnabled !== false,
        redeem: m.redeem || { yenPerPoint: 1, unit: 1 },
        registration: m.registration || { complete: true },
        heldPoints: Number(m.heldPoints || 0)
      };
      setMember(next);
      setMessage('');
      return next;
    } catch (e) {
      // 会員が引けなくても会計は続行できる（付与は伝票の personId で走る）。
      return null;
    } finally {
      setBusy(false);
    }
  }, [storeId]);

  /**
   * ポイント利用を Core に確定させる。
   * ⚠必ず会計の batch.commit() の直前に呼ぶこと(カード決済と同じスロット)。
   *   失敗したら会計を中断する。売上を確定させてからポイントだけ失敗すると辻褄が合わなくなる。
   * 冪等キーは会計ID(txId)。取消/返品は同じ txId に refund:true で戻す。
   */
  const redeemPoints = useCallback(async ({ personId, points, txId, refund = false }) => {
    const usePoints = Math.floor(Number(points) || 0);
    if (!personId || usePoints <= 0 || !txId) return { ok: false, skipped: true };
    const res = await httpsCallable(functionsApi, 'crmRedeemPoints')({
      storeId, personId, points: usePoints, txId, refund
    });
    return { ok: true, ...(res.data || {}) };
  }, [storeId]);

  /** 再照会: 友だち追加の直後に Core へ確認し直す(登録完了→保留ポイント解放)。 */
  const recheckMember = useCallback(async () => {
    if (!member) return null;
    if (member.memberCode) return lookupByCode(member.memberCode, { recheck: true });
    if (member.personId) return lookupByPersonId(member.personId, { fallbackName: member.displayName, recheck: true });
    return null;
  }, [member, lookupByCode, lookupByPersonId]);

  // 会計で実際に使える上限(pt)。残高・支払残額・利用単位の3つで決まる。
  const maxUsablePoints = useCallback((payableYen) => {
    if (!member) return 0;
    // 友だち追加が済んでいないLINE会員は使えない(Core も friend_required で拒否する)
    if (member.registration && member.registration.complete === false) return 0;
    const yenPerPoint = Math.max(Number(member.redeem?.yenPerPoint) || 1, 1);
    const unit = Math.max(Math.floor(Number(member.redeem?.unit) || 1), 1);
    const byPayable = Math.floor(Math.max(0, Number(payableYen) || 0) / yenPerPoint);
    const capped = Math.min(Math.floor(Number(member.pointBalance) || 0), byPayable);
    return Math.max(0, Math.floor(capped / unit) * unit);
  }, [member]);

  return {
    member,
    setMember,
    busy,
    message,
    setMessage,
    codeInput,
    setCodeInput,
    pointsToUse,
    setPointsToUse,
    maxUsablePoints,
    redeemPoints,
    lookupByCode,
    lookupByPersonId,
    recheckMember,
    clearMember
  };
};

export default useCrmMember;
