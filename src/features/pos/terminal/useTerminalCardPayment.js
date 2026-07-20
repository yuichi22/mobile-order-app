// useTerminalCardPayment.js
// POS会計のカード決済を Stripe Terminal(端末)へ送り、成立/失敗を待つフック。
// 使い方:
//   const term = useTerminalCardPayment(storeId);
//   ... 会計ハンドラ内 ...
//   if (needsTerminal) {
//     const { paymentIntentId } = await term.runCardPayment({ orderId, amount });
//     // 成立時のみここに来る。paymentIntentId を取引に付与して batch.commit()
//   }
//   画面に <TerminalPaymentModal state={term.modal} onCancel={term.cancel} onClose={term.close} /> を描画。
// 失敗/中止時は runCardPayment が reject するので、呼び出し側は try/catch で会計を中断する。
import { useCallback, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functionsApi } from '../../../shared/api/firebase/client';

const POLL_MS = 1500;
const TIMEOUT_MS = 120000; // 2分。端末操作待ちの上限。

const mapErrorMessage = (error) => {
  const code = error?.code || '';
  if (code === 'functions/failed-precondition')
    return 'このレジは端末が未割当か、店舗の端末決済が未設定です。';
  if (code === 'functions/permission-denied') return 'カード決済の権限がありません。';
  if (code === 'functions/invalid-argument') return '決済内容が不正です。';
  return error?.message || 'カード決済に失敗しました。';
};

export function useTerminalCardPayment(storeId) {
  // modal: null | { phase, amount, message, paymentIntentId }
  // phase: 'starting' | 'waiting' | 'canceling' | 'success' | 'error'
  const [modal, setModal] = useState(null);

  const resolverRef = useRef(null); // { resolve, reject }
  const pollRef = useRef(null);
  const piRef = useRef(null);
  const canceledRef = useRef(false);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const settle = useCallback((ok, payload) => {
    stopPolling();
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) {
      if (ok) r.resolve(payload);
      else r.reject(payload instanceof Error ? payload : new Error(String(payload || 'カード決済に失敗しました。')));
    }
  }, []);

  const safeCancel = useCallback(async (paymentIntentId) => {
    if (!paymentIntentId) return;
    try {
      await httpsCallable(functionsApi, 'cancelCardPayment')({ storeId, paymentIntentId });
    } catch (_e) {
      // 取消失敗は致命ではない(端末側でタイムアウトする)。会計中断を優先。
    }
  }, [storeId]);

  const runCardPayment = useCallback(
    ({ orderId, amount, label }) =>
      new Promise((resolve, reject) => {
        resolverRef.current = { resolve, reject };
        canceledRef.current = false;
        piRef.current = null;
        setModal({ phase: 'starting', amount, message: '端末に送信しています…', paymentIntentId: null });

        (async () => {
          try {
            const res = await httpsCallable(functionsApi, 'startCardPayment')({
              storeId,
              orderId,
              amount,
              idempotencyKey: orderId,
              ...(label ? { label } : {}),
            });
            const pi = res.data?.paymentIntentId;
            if (!pi) throw new Error('決済の開始に失敗しました。');
            piRef.current = pi;

            if (canceledRef.current) {
              await safeCancel(pi);
              setModal(null);
              settle(false, new Error('canceled'));
              return;
            }

            setModal({ phase: 'waiting', amount, paymentIntentId: pi, message: '端末でカードの操作をお願いします。' });

            const startedAt = Date.now();
            pollRef.current = setInterval(async () => {
              try {
                const st = await httpsCallable(functionsApi, 'getCardPaymentStatus')({
                  storeId,
                  paymentIntentId: pi,
                });
                const status = st.data?.status;
                if (status === 'succeeded') {
                  setModal({ phase: 'success', amount, paymentIntentId: pi, message: '決済が完了しました。' });
                  settle(true, { paymentIntentId: pi });
                } else if (status === 'failed' || status === 'canceled') {
                  setModal({
                    phase: 'error',
                    amount,
                    paymentIntentId: pi,
                    message: st.data?.errorMessage || 'カード決済が完了しませんでした。',
                  });
                  settle(false, new Error(st.data?.errorMessage || 'カード決済が完了しませんでした。'));
                } else if (Date.now() - startedAt > TIMEOUT_MS) {
                  await safeCancel(pi);
                  setModal({ phase: 'error', amount, paymentIntentId: pi, message: '時間切れです。もう一度お試しください。' });
                  settle(false, new Error('timeout'));
                }
                // それ以外(processing/requires_capture)は継続。
              } catch (_e) {
                // 一過性のネットワーク/権限リフレッシュはポーリング継続で吸収。
              }
            }, POLL_MS);
          } catch (error) {
            setModal({ phase: 'error', amount, paymentIntentId: piRef.current, message: mapErrorMessage(error) });
            settle(false, error);
          }
        })();
      }),
    [storeId, safeCancel, settle]
  );

  // 待機中にユーザーが中止。端末の決済を取り消して会計を中断させる。
  const cancel = useCallback(async () => {
    canceledRef.current = true;
    setModal((m) => (m ? { ...m, phase: 'canceling', message: '中止しています…' } : m));
    await safeCancel(piRef.current);
    setModal(null);
    settle(false, new Error('canceled'));
  }, [safeCancel, settle]);

  const close = useCallback(() => setModal(null), []);

  // 【テスト専用】シミュレーター端末にカード提示をシミュレート(物理端末なしで succeeded まで通す)。
  const simulate = useCallback(async () => {
    if (!piRef.current) return;
    try {
      await httpsCallable(functionsApi, 'simulateCardPresentation')({
        storeId,
        paymentIntentId: piRef.current,
      });
      // 実際の成立はポーリング(getCardPaymentStatus)が反映する。
    } catch (_e) {
      // 本番キー等でシミュレート不可でも、実端末なら通常操作で成立するため無視。
    }
  }, [storeId]);

  return { modal, runCardPayment, cancel, close, simulate };
}
