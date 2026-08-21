import { useCallback, useState } from 'react';
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
export const useCrmMember = (storeId) => {
  const [member, setMember] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [codeInput, setCodeInput] = useState('');
  // この会計で使うポイント数(pt)。会計の割引明細(voucher_payment)として流し込む。
  const [pointsToUse, setPointsToUse] = useState(0);

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
  const lookupByCode = useCallback(async (rawCode, { silent = false } = {}) => {
    const code = String(rawCode || '').replace(/^MB/i, '').replace(/\D/g, '');
    if (!code) return null;
    setBusy(true);
    if (!silent) setMessage('');
    try {
      const res = await httpsCallable(functionsApi, 'crmLookupMember')({ storeId, memberCode: code });
      const m = res.data || {};
      const next = {
        personId: m.personId,
        displayName: m.displayName || null,
        pointBalance: Number(m.pointBalance || 0),
        redeem: m.redeem || { yenPerPoint: 1, unit: 1 }
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
  const lookupByPersonId = useCallback(async (personId) => {
    const id = String(personId || '').trim();
    if (!id) return null;
    setBusy(true);
    try {
      const res = await httpsCallable(functionsApi, 'crmLookupMember')({ storeId, personId: id });
      const m = res.data || {};
      const next = {
        personId: m.personId || id,
        displayName: m.displayName || null,
        pointBalance: Number(m.pointBalance || 0),
        redeem: m.redeem || { yenPerPoint: 1, unit: 1 }
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

  // 会計で実際に使える上限(pt)。残高・支払残額・利用単位の3つで決まる。
  const maxUsablePoints = useCallback((payableYen) => {
    if (!member) return 0;
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
    clearMember
  };
};

export default useCrmMember;
