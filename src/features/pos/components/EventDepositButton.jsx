import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronLeft, CreditCard, Delete, DollarSign, Minus, Plus, QrCode, X } from 'lucide-react';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { useAuth } from '../../../app/providers/useAuth';
import { db } from '../../../shared/api/firebase/client';
import { DateField } from '../../../shared/components/akuto/DateField';
import {
  describeDrawerError,
  isCashDrawerSupported,
  openCashDrawer,
  shouldOpenDrawerForPayment
} from '../../../shared/utils/receiptPrinting';
import { resolveModeTaxSettings, splitTaxIncludedAmount } from '../../../shared/utils/tax';
import { useStoreSettings } from '../../store/hooks';
import { getJstBusinessDate } from '../corrections/correctionModel';
import { getActiveRegisterContext, getAvailableDepartments } from '../utils/registerContext';
import {
  applyCalculatorKey,
  buildEventDepositRecord,
  formatEventDateShort,
  normalizeEventCategories
} from '../utils/eventDeposit';

// イベント入金【仕様: https://claude.ai/artifact/XdD9dQZyZQYH6DwinGSmtp】
// 店外イベント(HAUSマルシェ等)の売上を、イベント後にまとめて1回で入金する。カートは通さず、このモーダルで完結。
// 流れ: カテゴリー → 開催日(既定は今日) → 税率 → 電卓で税込総額 → 支払方法 → 確認 → 入金。
// 売上は transactions に1件(日計は入金した日、分析のイベント別表は開催日)。来客数には入れない。
// 支払い方法の色は会計画面と同じ(現金=黒/カード=ブルー/QR=パープル)【AKUTOブランド基準・例外 10-09】。
const PAYMENT_OPTIONS = [
  {
    id: 'cash',
    label: '現金',
    icon: DollarSign,
    active: 'border-gray-950 bg-gray-950 text-white',
    badge: 'border-gray-950 bg-gray-50 text-gray-950',
    action: 'bg-gray-950 hover:bg-black'
  },
  {
    id: 'card',
    label: 'カード',
    icon: CreditCard,
    active: 'border-[#2563EB] bg-[#2563EB] text-white',
    badge: 'border-[#2563EB] bg-[#2563EB]/5 text-[#1D4ED8]',
    action: 'bg-[#2563EB] hover:bg-[#1D4ED8]'
  },
  {
    id: 'qr',
    label: 'QR',
    icon: QrCode,
    active: 'border-[#9333EA] bg-[#9333EA] text-white',
    badge: 'border-[#9333EA] bg-[#9333EA]/5 text-[#7E22CE]',
    action: 'bg-[#9333EA] hover:bg-[#7E22CE]'
  }
];

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '000'];

const yen = (value) => `¥${Number(value || 0).toLocaleString()}`;

const EventDepositModal = ({ storeId, mode, settings, onClose, onResult }) => {
  const { currentUser: user } = useAuth();
  const categories = useMemo(
    () => normalizeEventCategories(settings?.eventCategories).filter((entry) => entry.active),
    [settings?.eventCategories]
  );
  const modeTax = useMemo(() => resolveModeTaxSettings(settings, mode), [settings, mode]);
  const today = getJstBusinessDate();

  const [step, setStep] = useState('input');
  const [categoryId, setCategoryId] = useState(categories.length === 1 ? categories[0].id : '');
  const [eventDate, setEventDate] = useState(today);
  const [taxKind, setTaxKind] = useState(
    categories.length === 1 && categories[0].defaultTaxRate === 8 ? 'reduced' : 'standard'
  );
  const [amount, setAmount] = useState('');
  const [groupCount, setGroupCount] = useState(0);
  const [memo, setMemo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const category = categories.find((entry) => entry.id === categoryId) || null;
  const taxRate = taxKind === 'reduced' ? modeTax.reducedRate : modeTax.standardRate;
  const amountNumber = Number(amount || 0);
  const taxPreview = splitTaxIncludedAmount(amountNumber, taxRate, modeTax.rounding);
  const paymentOption = PAYMENT_OPTIONS.find((option) => option.id === paymentMethod) || PAYMENT_OPTIONS[0];
  const canConfirm = Boolean(category) && amountNumber > 0 && Boolean(eventDate);

  const selectCategory = (entry) => {
    setCategoryId(entry.id);
    setTaxKind(entry.defaultTaxRate === 8 ? 'reduced' : 'standard');
    setError('');
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async () => {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError('');
    try {
      const register = getActiveRegisterContext(storeId, settings?.registers, settings?.departments);
      const departments = getAvailableDepartments(settings?.departments);
      const department = departments.find((dept) => dept.id === category.departmentId)
        || { id: register.departmentId || '', name: register.departmentName || '' };
      const transactionRef = doc(collection(db, 'stores', storeId, 'transactions'));
      const record = buildEventDepositRecord({
        amount: amountNumber,
        taxRate,
        reducedRate: modeTax.reducedRate,
        standardRate: modeTax.standardRate,
        taxRounding: modeTax.rounding,
        category,
        eventDate,
        groupCount,
        memo,
        paymentMethod,
        paymentMethodLabel: paymentOption.label,
        register,
        department,
        registerMode: mode,
        transactionId: transactionRef.id,
        businessDate: today,
        staff: { uid: user?.uid, name: user?.displayName || user?.email || '' }
      });

      await setDoc(transactionRef, {
        ...record,
        timestamp: serverTimestamp(),
        paidAt: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      let drawerMessage = '';
      if (isCashDrawerSupported() && shouldOpenDrawerForPayment(record, settings, mode)) {
        try {
          await openCashDrawer({ settings, mode });
        } catch (drawerError) {
          drawerMessage = ` ドロワーを開けませんでした: ${describeDrawerError(drawerError)}`;
        }
      }

      onResult?.({
        type: drawerMessage ? 'error' : 'success',
        message: `${category.name}（${formatEventDateShort(eventDate)}）${yen(amountNumber)} を${paymentOption.label}で入金しました。${drawerMessage}`
      });
      onClose();
    } catch (submitError) {
      console.error('[EventDeposit] save failed', submitError);
      setError('入金を記録できませんでした。通信状態を確認して、もう一度お試しください。');
      setStep('input');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div
        className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            {step === 'confirm' && (
              <button
                type="button"
                onClick={() => setStep('input')}
                disabled={busy}
                aria-label="戻る"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <CalendarDays size={20} className="text-gray-900" />
            <h2 className="text-lg font-black text-gray-900">イベント入金</h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {categories.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold leading-relaxed text-gray-600">
            イベントカテゴリーがまだありません。<br />
            管理画面の「設定 › イベント入金」で、HAUSマルシェなどを登録してください。
          </div>
        ) : step === 'confirm' ? (
          <div className="flex flex-col items-center gap-6 overflow-y-auto p-8">
            <div className="w-full max-w-md rounded-3xl bg-gray-50 p-6 text-center">
              <div className="text-sm font-black text-gray-500">
                {category?.name}（{formatEventDateShort(eventDate)} 開催）
              </div>
              <div className="mt-2 text-5xl font-black tracking-tight text-gray-900">{yen(amountNumber)}</div>
              <div className="mt-2 text-xs font-bold text-gray-500">
                税込・{taxRate}%（内税 {yen(taxPreview.taxAmount)}）
                {groupCount > 0 ? `・${groupCount}組` : ''}
              </div>
              {/* 支払方法は押し間違いに気づけるよう、会計画面と同じ色で大きく出す。 */}
              <div className={`mt-4 inline-flex items-center gap-2 rounded-2xl border-2 px-5 py-2.5 text-xl font-black ${paymentOption.badge}`}>
                {React.createElement(paymentOption.icon, { size: 22, strokeWidth: 2.6 })}
                {paymentOption.label}で入金
              </div>
              {memo.trim() && <div className="mt-2 text-xs font-bold text-gray-500">メモ: {memo.trim()}</div>}
            </div>
            <p className="text-xs font-bold text-gray-500">
              今日の売上として記録します。来客数・客単価には含めません。
              {paymentMethod !== 'cash' ? ' カード・QRは記録だけで、決済端末は動きません。' : ''}
            </p>
            {error && <div className="w-full max-w-md rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</div>}
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className={`flex h-16 w-full max-w-md items-center justify-center gap-2 rounded-2xl text-lg font-black text-white transition disabled:opacity-50 ${paymentOption.action}`}
            >
              <Check size={20} />
              {busy ? '記録しています…' : `${paymentOption.label}で入金する`}
            </button>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-5 border-gray-100 p-6 md:border-r">
              <section>
                <div className="mb-2 text-xs font-black text-gray-500">イベント</div>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => selectCategory(entry)}
                      className={`min-h-14 rounded-2xl border-2 px-3 py-2 text-left text-sm font-black transition ${
                        entry.id === categoryId
                          ? 'border-ui bg-ui text-white'
                          : 'border-gray-200 bg-white text-gray-800 hover:border-ui-100 hover:bg-ui-50'
                      }`}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-2 text-xs font-black text-gray-500">開催日</div>
                  <DateField value={eventDate} onChange={(value) => setEventDate(value || today)} max={today} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-black text-gray-500">税率</div>
                  <div className="flex h-12 overflow-hidden rounded-xl border-2 border-gray-200">
                    {[
                      { id: 'reduced', rate: modeTax.reducedRate },
                      { id: 'standard', rate: modeTax.standardRate }
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setTaxKind(option.id)}
                        className={`flex-1 text-sm font-black ${taxKind === option.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                      >
                        {option.rate}%
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-2 text-xs font-black text-gray-500">組数（任意）</div>
                  <div className="flex h-12 items-center justify-between rounded-xl border-2 border-gray-200 px-1">
                    <button
                      type="button"
                      onClick={() => setGroupCount((count) => Math.max(count - 1, 0))}
                      aria-label="減らす"
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="text-base font-black text-gray-900">{groupCount > 0 ? `${groupCount}組` : '-'}</span>
                    <button
                      type="button"
                      onClick={() => setGroupCount((count) => Math.min(count + 1, 9999))}
                      aria-label="増やす"
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <label className="block">
                  <span className="mb-2 block text-xs font-black text-gray-500">メモ（任意）</span>
                  <input
                    value={memo}
                    onChange={(event) => setMemo(event.target.value.slice(0, 60))}
                    placeholder="例: 午前の部"
                    className="h-12 w-full rounded-xl border-2 border-gray-200 px-3 text-sm font-bold text-gray-900 outline-none focus:border-ui"
                  />
                </label>
              </section>

              <section>
                <div className="mb-2 text-xs font-black text-gray-500">支払方法</div>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const active = option.id === paymentMethod;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPaymentMethod(option.id)}
                        className={`flex h-12 items-center justify-center gap-1.5 rounded-xl border-2 text-sm font-black transition ${
                          active ? option.active : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        <Icon size={16} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-3 p-6">
              <div className="rounded-2xl bg-gray-50 px-5 py-4 text-right">
                <div className="text-[11px] font-black text-gray-500">入金額（税込総額）</div>
                <div className="mt-1 truncate text-4xl font-black tracking-tight text-gray-900">{yen(amountNumber)}</div>
                <div className="mt-1 text-[11px] font-bold text-gray-500">
                  {taxRate}% 内税 {yen(taxPreview.taxAmount)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAmount((current) => applyCalculatorKey(current, key))}
                    className="h-14 rounded-2xl border border-gray-200 bg-white text-xl font-black text-gray-900 transition hover:bg-gray-50 active:scale-95"
                  >
                    {key}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAmount('')}
                  className="h-14 rounded-2xl border border-gray-200 bg-gray-100 text-base font-black text-gray-700 active:scale-95"
                >
                  C
                </button>
                <button
                  type="button"
                  onClick={() => setAmount((current) => applyCalculatorKey(current, 'back'))}
                  aria-label="1文字消す"
                  className="col-span-2 flex h-14 items-center justify-center rounded-2xl border border-gray-200 bg-gray-100 text-gray-700 active:scale-95"
                >
                  <Delete size={20} />
                </button>
              </div>
              {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</div>}
              <button
                type="button"
                onClick={() => setStep('confirm')}
                disabled={!canConfirm}
                className="mt-auto h-14 rounded-2xl bg-gray-900 text-base font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {category ? '確認へ' : 'イベントを選んでください'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// レジ(ORDER・POS)に置くボタン。押すとイベント入金のモーダルを開く。
const EventDepositButton = ({ storeId, mode = 'order', className = '', iconSize = 15, onResult }) => {
  const { settings } = useStoreSettings(storeId);
  const [open, setOpen] = useState(false);
  if (!storeId) return null;
  const registerMode = mode === 'pos' ? 'pos' : 'order';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <CalendarDays size={iconSize} />
        イベント入金
      </button>
      {open && (
        <EventDepositModal
          storeId={storeId}
          mode={registerMode}
          settings={settings}
          onClose={() => setOpen(false)}
          onResult={onResult}
        />
      )}
    </>
  );
};

export default EventDepositButton;
