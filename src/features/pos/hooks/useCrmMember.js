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
export const useCrmMember = (storeId, { onMessage } = {}) => {
  const [member, setMember] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [codeInput, setCodeInput] = useState('');

  // onMessage は呼び出し側で毎レンダー作り直される想定なので ref 経由で参照する
  // (useCallback の依存に入れて lookupByCode の同一性が壊れるのを避ける)。
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const clearMember = useCallback(({ notify = false } = {}) => {
    setMember(null);
    setMessage('');
    if (notify) onMessageRef.current?.('会員を解除しました。', 'info');
  }, []);

  /**
   * 会員コードを Core に照会して会員を特定する。
   * silent=true は「商品として見つからなかった値の“ついで照会”」用で、
   * 失敗しても既存の会員選択やエラー表示を壊さない。
   */
  const lookupByCode = useCallback(async (rawCode, { silent = false } = {}) => {
    const code = String(rawCode || '').replace(/^MB/i, '').replace(/\D/g, '');
    if (!code) return false;
    setBusy(true);
    if (!silent) setMessage('');
    try {
      const res = await httpsCallable(functionsApi, 'crmLookupMember')({ storeId, memberCode: code });
      const m = res.data || {};
      setMember({
        personId: m.personId,
        displayName: m.displayName || null,
        pointBalance: Number(m.pointBalance || 0),
        redeem: m.redeem || { yenPerPoint: 1, unit: 1 }
      });
      setMessage('');
      onMessageRef.current?.(`会員を読み込みました（利用可能 ${Number(m.pointBalance || 0).toLocaleString()}pt）`, 'success');
      return true;
    } catch (e) {
      if (!silent) {
        setMember(null);
        setMessage(e?.message || '会員を照会できませんでした。');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [storeId]);

  return {
    member,
    setMember,
    busy,
    message,
    setMessage,
    codeInput,
    setCodeInput,
    lookupByCode,
    clearMember
  };
};

export default useCrmMember;
