import React, { useState } from 'react';
import { CheckCircle, FileText, Printer } from 'lucide-react';
import { issueReceipt, resolveReceiptMode } from '../../shared/utils/receiptPrinting';
import { getIdToken } from 'firebase/auth';
import { auth } from '../../shared/api/firebase/client';

import { useStoreSettings } from '../store/hooks';

const formatPaymentMethod = (method) => {
  if (method === 'cash') return '現金';
  if (method === 'card' || method === 'credit') return 'カード';
  if (method === 'qr' || method === 'paypay') return 'QR決済';
  return method || '未設定';
};

export const PosReceipt = ({ data, onNext, storeId }) => {
  const { settings } = useStoreSettings(storeId);
  const [issuedReceipt, setIssuedReceipt] = useState({
    receiptId: data.receiptId || '',
    receiptNo: data.receiptNo || ''
  });
  const [recipientName, setRecipientName] = useState(data.recipientName || '');
  const [isIssuingReceipt, setIsIssuingReceipt] = useState(false);

  const handleIssueReceipt = async () => {
    if (issuedReceipt.receiptNo || isIssuingReceipt) return;

    const normalizedStoreId = storeId || data.storeId || '';
    const normalizedSessionId = data.sessionId || '';
    const normalizedTransactionId = data.transactionId || '';

    if (!normalizedStoreId || !normalizedSessionId || !normalizedTransactionId) {
      window.alert('領収書の発行情報が不足しています。');
      return;
    }

    if (!auth.currentUser) {
      window.alert('ログイン状態を確認できませんでした。');
      return;
    }

    setIsIssuingReceipt(true);

    try {
      const token = await getIdToken(auth.currentUser);

      const response = await fetch('/api/issuePostpayReceipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          storeId: normalizedStoreId,
          sessionId: normalizedSessionId,
          transactionId: normalizedTransactionId,
          recipientName: recipientName.trim()
        })
      });

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error?.message || '領収書の発行に失敗しました。');
      }

      setIssuedReceipt({
        receiptId: payload.receiptId || '',
        receiptNo: payload.receiptNo || ''
      });
    } catch (error) {
      console.error('[issue receipt after payment error]', error);
      window.alert(error.message || '領収書の発行に失敗しました。');
    } finally {
      setIsIssuingReceipt(false);
    }
  };

  const handlePrint = async () => {
    try {
      const receiptData = {
        ...data,
        receiptId: issuedReceipt.receiptId,
        receiptNo: issuedReceipt.receiptNo,
        issueReceipt: Boolean(issuedReceipt.receiptNo),
        recipientName
      };
      await issueReceipt({ data: receiptData, settings, mode: resolveReceiptMode(receiptData) });
    } catch (error) {
      const errorText = error?.message || error?.errorMessage || error?.code || JSON.stringify(error) || String(error);
      console.error('[pos receipt print error]', errorText, error);

      const shouldFallback = window.confirm(
        `レシートプリンターへの印刷に失敗しました。\n\n${errorText}\n\nブラウザ印刷を開きますか？`
      );

      if (shouldFallback) {
        window.print();
      }
    }
  };

  const taxRateStandard = Number(data.taxRateStandard || settings.taxRate || 10);
  const taxRateReduced = Number(data.taxRateReduced || settings.taxRateReduced || 8);
  const taxAmountReduced = Number(data.taxAmountReduced || 0);
  const taxAmountStandard = Number(data.taxAmountStandard || 0);
  const totalTaxAmount = taxAmountReduced + taxAmountStandard || Number(data.taxAmount || 0);
  const paymentLabel = formatPaymentMethod(data.paymentMethod);

  return (
    <div className="relative flex h-full flex-col items-center justify-center bg-gray-100 p-6">
      <div className="print:hidden w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-xl">
        <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-600" />
          <h2 className="mb-2 text-2xl font-bold text-gray-800">会計が完了しました</h2>
          <p className="mb-2 text-gray-500">
            合計 ¥{Number(data.totalAmount || 0).toLocaleString()}
          </p>

          {issuedReceipt.receiptNo && (
            <p className="mb-6 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              領収書番号：{issuedReceipt.receiptNo}
            </p>
          )}

        <div className="mb-6 space-y-2 rounded-lg bg-gray-50 p-4 text-left font-mono text-sm text-gray-600">
          <div className="flex justify-between">
            <span>小計</span>
            <span>¥{Number(data.subTotal || 0).toLocaleString()}</span>
          </div>
          {Number(data.discountAmount || 0) > 0 && (
            <div className="flex justify-between text-red-500">
              <span>値引き</span>
              <span>-¥{Number(data.discountAmount || 0).toLocaleString()}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t pt-2 font-bold">
            <span>合計</span>
            <span>¥{Number(data.totalAmount || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>おつり</span>
            <span>¥{Number(data.changeAmount || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handlePrint}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-4 font-black text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98]"
          >
            <Printer size={20} />
            レシートを印刷
          </button>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
            <label className="mb-2 block text-xs font-black text-slate-500">
              領収書の宛名
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              disabled={Boolean(issuedReceipt.receiptNo) || isIssuingReceipt}
              placeholder="例：上様"
              className="mb-3 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none transition focus:border-blue-400 disabled:bg-slate-100 disabled:text-slate-400"
            />

            <button
              type="button"
              onClick={handleIssueReceipt}
              disabled={Boolean(issuedReceipt.receiptNo) || isIssuingReceipt}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-3 font-black text-blue-700 shadow-sm transition-all hover:bg-blue-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <FileText size={18} />
              {issuedReceipt.receiptNo
                ? `領収書発行済み ${issuedReceipt.receiptNo}`
                : isIssuingReceipt
                  ? '領収書を発行中...'
                  : '領収書を発行'}
            </button>
          </div>

          <button
            type="button"
            onClick={onNext}
            className="w-full rounded-xl bg-blue-600 py-4 font-black text-white shadow-lg transition-all hover:bg-blue-700 active:scale-[0.98]"
          >
            戻る
          </button>
        </div>
      </div>

      <div className="hidden w-[58mm] bg-white p-0 text-[10px] leading-tight text-black print:mx-auto print:block print:font-mono">
        <div className="mb-4 border-b border-dashed border-black pb-2 text-center">
          <h1 className="mb-1 text-lg font-bold">{settings.name || 'Akuto Order System'}</h1>
          {settings.address && <p>{settings.address}</p>}
          {settings.tel && <p>TEL: {settings.tel}</p>}
          {settings.invoiceNumber && <p className="mt-1">登録番号: {settings.invoiceNumber}</p>}
        </div>

        <div className="mb-2 flex justify-between">
          <span>{new Date().toLocaleString('ja-JP')}</span>
        </div>
          <div className="mb-2 border-b border-dashed border-black pb-2">
            <p>No: {issuedReceipt.receiptNo || (data.sessionId ? data.sessionId.slice(0, 8) : '-')}</p>
            {issuedReceipt.receiptNo && <p>領収書番号: {issuedReceipt.receiptNo}</p>}
            {issuedReceipt.receiptNo && (
              <p className="mt-1 text-xs font-bold">
                宛名: {recipientName || ''}
              </p>
            )}
          </div>

        <div className="mb-2 border-b border-dashed border-black pb-2">
          {data.lineItems && data.lineItems.map((item, index) => (
            <div key={`${item.name}-${index}`} className="mb-1">
              <div className="flex justify-between">
                <span className="font-bold">{item.name}</span>
                <span>¥{Number(item.totalPrice || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between pl-2 text-[9px] text-gray-600">
                <span>¥{Number(item.unitPrice || 0).toLocaleString()} x {Number(item.quantity || 1)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-2 space-y-1 border-b border-dashed border-black pb-2">
          <div className="flex justify-between">
            <span>小計</span>
            <span>¥{Number(data.subTotal || 0).toLocaleString()}</span>
          </div>
          {Number(data.discountAmount || 0) > 0 && (
            <div className="flex justify-between">
              <span>値引き</span>
              <span>-¥{Number(data.discountAmount || 0).toLocaleString()}</span>
            </div>
          )}
          {taxAmountReduced > 0 && (
            <div className="flex justify-between">
              <span>消費税 {taxRateReduced}% (軽減税率)</span>
              <span>¥{taxAmountReduced.toLocaleString()}</span>
            </div>
          )}
          {taxAmountStandard > 0 && (
            <div className="flex justify-between">
              <span>消費税 {taxRateStandard}%</span>
              <span>¥{taxAmountStandard.toLocaleString()}</span>
            </div>
          )}
          {taxAmountReduced === 0 && taxAmountStandard === 0 && (
            <div className="flex justify-between">
              <span>(うち消費税)</span>
              <span>(¥{Number(totalTaxAmount || 0).toLocaleString()})</span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex justify-between text-base font-bold">
            <span>合計</span>
            <span>¥{Number(data.totalAmount || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>お預かり ({paymentLabel})</span>
            <span>¥{(Number(data.totalAmount || 0) + Number(data.changeAmount || 0)).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>おつり</span>
            <span>¥{Number(data.changeAmount || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="text-center text-[9px]">
          <p>ご利用ありがとうございました。</p>
          <p>またのご来店をお待ちしております。</p>
        </div>
      </div>
    </div>
  );
};
