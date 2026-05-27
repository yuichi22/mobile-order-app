import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  BadgeJapaneseYen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  LockKeyhole,
  Printer,
  ReceiptText,
  TicketPercent,
  Users
} from 'lucide-react';

import { db } from '../../../shared/api/firebase/client';
import { useDailyTransactions } from '../Analytics/hooks/useDailyTransactions';
import {
  buildDailyClosingSummary,
  formatCurrency,
  formatDailyClosingDateKey,
  getPaymentMethodLabel
} from '../Analytics/utils/dailyClosingHelpers';
import DailyClosingCheckModal from './DailyClosingCheckModal';
import { useStoreSettings, usePeriodData } from '../../store/hooks';
import { printDailyClosingReceipt } from './printDailyClosingReceipt';

const toDateInputValue = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createDateFromInputValue = (value) => {
  if (!value) return new Date();

  const [year, month, day] = value.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day);
  nextDate.setHours(0, 0, 0, 0);

  return nextDate;
};

const DailyClosingPanel = ({ storeId, targetDate, setTargetDate }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [closingStatus, setClosingStatus] = useState(null);
  const [closedDailyData, setClosedDailyData] = useState(null);
  const [isLoadingClosedDaily, setIsLoadingClosedDaily] = useState(false);
  const [isCheckModalOpen, setIsCheckModalOpen] = useState(false);

  const dateInputRef = useRef(null);
  const { settings } = useStoreSettings(storeId);
  const { periods = [] } = usePeriodData(storeId);

  const { transactions, loading } = useDailyTransactions({
    storeId,
    targetDate
  });

  const dateKey = useMemo(() => formatDailyClosingDateKey(targetDate), [targetDate]);

  const summary = useMemo(
    () => buildDailyClosingSummary(transactions, periods),
    [transactions, periods]
  );

  useEffect(() => {
    if (!storeId || !dateKey) {
      setClosedDailyData(null);
      setClosingStatus(null);
      return undefined;
    }

    let isMounted = true;

    const loadClosedDaily = async () => {
      setIsLoadingClosedDaily(true);

      try {
        const closingRef = doc(db, 'stores', storeId, 'dailyClosings', dateKey);
        const closingSnapshot = await getDoc(closingRef);

        if (!isMounted) return;

        if (closingSnapshot.exists() && closingSnapshot.data()?.status === 'closed') {
          setClosedDailyData({
            id: closingSnapshot.id,
            ...closingSnapshot.data()
          });
          setClosingStatus('closed');
        } else {
          setClosedDailyData(null);
          setClosingStatus(null);
        }
      } catch (error) {
        console.error('Failed to load daily closing:', error);
        if (isMounted) {
          setClosedDailyData(null);
          setClosingStatus(null);
        }
      } finally {
        if (isMounted) {
          setIsLoadingClosedDaily(false);
        }
      }
    };

    loadClosedDaily();

    return () => {
      isMounted = false;
    };
  }, [storeId, dateKey]);

  const averageSpendPerCustomer = Number(summary?.customerCount || 0) > 0
  ? Math.round(Number(summary?.totalSales || 0) / Number(summary?.customerCount || 0))
  : 0;

  const paymentMethodList = Array.isArray(summary?.paymentMethodList)
    ? summary.paymentMethodList
    : [];

  const taxBreakdownList = Array.isArray(summary?.taxBreakdownList)
    ? summary.taxBreakdownList
    : [];

  const discountList = Array.isArray(summary?.discountList)
    ? summary.discountList
    : [];

  const timeSlotList = Array.isArray(summary?.timeSlotList)
    ? summary.timeSlotList
    : [];

  const categoryList = Array.isArray(summary?.categoryList)
    ? summary.categoryList
    : [];

  const isClosed = closingStatus === 'closed' || closedDailyData?.status === 'closed';

  const shiftDailyDate = (delta) => {
    if (!setTargetDate) return;

    const nextDate = new Date(targetDate || new Date());
    nextDate.setDate(nextDate.getDate() + delta);
    nextDate.setHours(0, 0, 0, 0);

    setTargetDate(nextDate);
    setClosingStatus(null);
  };

  const handleDateInputChange = (event) => {
    if (!setTargetDate) return;

    const nextDate = createDateFromInputValue(event.target.value);
    setTargetDate(nextDate);
    setClosingStatus(null);
  };

  const openDatePicker = () => {
    if (!dateInputRef.current) return;

    if (typeof dateInputRef.current.showPicker === 'function') {
      dateInputRef.current.showPicker();
      return;
    }

    dateInputRef.current.click();
  };

  const handlePrint = () => {
    printDailyClosingReceipt({
      dateKey,
      summary,
      paymentMethodList,
      taxBreakdownList,
      discountList,
      timeSlotList,
      categoryList,
      closedDailyData,
      settings
    });
  };


const openClosingModal = () => {
  if (!storeId || isClosing || loading || transactions.length === 0) return;
  setIsCheckModalOpen(true);
};

const handleCloseDay = async (closingCheck = {}) => {
  if (!storeId || isClosing) return;

  setIsClosing(true);

  try {
    const closingRef = doc(db, 'stores', storeId, 'dailyClosings', dateKey);
    const closingSnapshot = await getDoc(closingRef);

    if (closingSnapshot.exists()) {
      const overwrite = window.confirm('この日の締めデータは既にあります。上書きしますか？');
      if (!overwrite) {
        setIsClosing(false);
        return;
      }
    }

    const savedClosingData = {
      dateKey,
      targetDate: new Date(targetDate || new Date()),
      status: 'closed',

      transactionIds: transactions.map((transaction) => transaction.id),
      transactionCount: Number(summary?.transactionCount || 0),
      customerCount: Number(summary?.customerCount || 0),
      itemCount: Number(summary?.itemCount || 0),

      totalSales: Number(summary?.totalSales || 0),

      cashSales: Number(summary?.cashSales || 0),
      cardSales: Number(summary?.cardSales || 0),
      qrSales: Number(summary?.qrSales || 0),
      otherSales: Number(summary?.otherSales || 0),

      discountTotal: Number(summary?.discountTotal || 0),

      paymentMethods: paymentMethodList,
      taxBreakdown: taxBreakdownList,
      discounts: discountList,
      timeSlots: timeSlotList,
      categories: categoryList,

      cashCheck: closingCheck.cashCheck || null,
      couponCheck: closingCheck.couponCheck || null
    };

    await setDoc(closingRef, {
      ...savedClosingData,
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    setClosedDailyData(savedClosingData);
    setClosingStatus('closed');
    setIsCheckModalOpen(false);
  } catch (error) {
    console.error('Daily closing failed:', error);
    window.alert(error.message || '締め処理に失敗しました。');
  } finally {
    setIsClosing(false);
  }
};

  return (
    <div className="mt-2 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 border-b border-gray-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-orange-500">
            <CalendarDays size={15} />
            日計表
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftDailyDate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-orange-50 hover:text-orange-600"
              aria-label="前の日"
            >
              <ChevronLeft size={18} />
            </button>

            <button
              type="button"
              onClick={openDatePicker}
              className="min-w-[180px] rounded-full border border-gray-200 bg-white px-5 py-2 text-center text-lg font-black text-gray-900 shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50"
            >
              {dateKey}
            </button>

            <button
              type="button"
              onClick={() => shiftDailyDate(1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-orange-50 hover:text-orange-600"
              aria-label="次の日"
            >
              <ChevronRight size={18} />
            </button>

            <input
              ref={dateInputRef}
              type="date"
              value={toDateInputValue(targetDate)}
              onChange={handleDateInputChange}
              className="sr-only"
            />
          </div>

          <p className="mt-2 text-xs font-bold text-gray-400">
            会計済み取引をもとに日計を集計します。
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            onClick={openClosingModal}
            disabled={loading || isClosing || isLoadingClosedDaily || transactions.length === 0}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black shadow-sm transition-colors ${
              isClosed
                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                : 'bg-gray-900 text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300'
            }`}
          >
            {isClosing || isLoadingClosedDaily ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isClosed ? (
              <CheckCircle2 size={16} />
            ) : (
              <LockKeyhole size={16} />
            )}
            {isClosed ? '締め処理済み・修正' : '締め処理'}
          </button>

          {isClosed && (
            <>
              <div className="rounded-xl bg-gray-50 px-4 py-2 text-right text-xs font-bold text-gray-500">
                {dateKey} の日計
              </div>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-black text-gray-600 shadow-sm transition-colors hover:bg-gray-50"
              >
                <Printer size={15} />
                印刷
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm font-bold text-gray-400">
          <Loader2 size={18} className="mr-2 animate-spin" />
          読み込み中
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-2xl bg-orange-50 p-4">
              <div className="text-xs font-black text-orange-500">売上合計</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {formatCurrency(summary?.totalSales)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="flex items-center gap-1 text-xs font-black text-gray-400">
                <Users size={14} />
                来客数
              </div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {Number(summary?.customerCount || 0)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
            <div className="text-xs font-black text-gray-400">客単価</div>
            <div className="mt-2 text-2xl font-black text-gray-900">
                {formatCurrency(averageSpendPerCustomer)}
            </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">会計件数</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {Number(summary?.transactionCount || 0)}
              </div>
            </div>

            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">販売点数</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {Number(summary?.itemCount || 0)}
              </div>
            </div>



          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <ReceiptText size={16} />
                支払い方法別
              </div>

              <div className="space-y-2">
                {paymentMethodList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    会計データがありません
                  </div>
                ) : (
                  paymentMethodList.map((entry) => (
                    <div
                      key={entry.method}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-black text-gray-800">
                          {entry.label || getPaymentMethodLabel(entry.method)}
                        </div>
                        <div className="text-[11px] font-bold text-gray-400">
                          {Number(entry.count || 0)}件
                        </div>
                      </div>
                      <div className="text-sm font-black text-gray-900">
                        {formatCurrency(entry.total)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <BadgeJapaneseYen size={16} />
                税率別売上
              </div>

              <div className="space-y-2">
                {taxBreakdownList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    税率別データがありません
                  </div>
                ) : (
                  taxBreakdownList.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-black text-gray-800">
                          {entry.key === 'reduced'
                            ? '軽減税率'
                            : entry.key === 'standard'
                              ? '標準税率'
                              : '税率未設定'}
                          <span className="ml-2 text-xs font-black text-gray-400">
                            {Number(entry.rate || 0)}%
                          </span>
                        </div>
                        <div className="text-sm font-black text-gray-900">
                          {formatCurrency(entry.sales)}
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-gray-400">
                        <span>税抜対象額</span>
                        <span>{formatCurrency(entry.baseAmount)}</span>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-gray-400">
                        <span>内消費税</span>
                        <span>{formatCurrency(entry.tax)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <TicketPercent size={16} />
                値引・クーポン利用
              </div>

              <div className="mb-3 rounded-xl bg-orange-50 px-4 py-3">
                <div className="text-xs font-black text-orange-500">
                  割引クーポン合計金額
                </div>
                <div className="mt-1 text-xl font-black text-gray-900">
                  {formatCurrency(summary?.discountTotal)}
                </div>
              </div>

              <div className="space-y-2">
                {discountList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    値引・クーポンの利用はありません
                  </div>
                ) : (
                  discountList.map((discount) => (
                    <div
                      key={discount.id || discount.name}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-gray-800">
                          {discount.name || '値引き'}
                        </div>
                          <div className="text-[11px] font-bold text-gray-400">
                            {Number(discount.quantity || discount.count || 0)}枚
                            <span className="mx-1 text-gray-300">/</span>
                            {Number(discount.count || 0)}会計
                          </div>
                      </div>

                      <div className="ml-3 shrink-0 text-sm font-black text-gray-900">
                        {formatCurrency(discount.amount)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                <Clock3 size={16} />
                時間帯別売上
              </div>

              <div className="space-y-2">
                {timeSlotList.length === 0 ? (
                  <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400">
                    時間帯別データがありません
                  </div>
                ) : (
                  timeSlotList.map((slot) => (
                    <div
                      key={slot.id || slot.name}
                      className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-gray-800">
                          {slot.name || '時間帯未設定'}
                        </div>
                        <div className="text-[11px] font-bold text-gray-400">
                          {Number(slot.count || 0)}件
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-sm font-black text-gray-900">
                        {formatCurrency(slot.total)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-100 p-4">
            <div className="mb-3 text-sm font-black text-gray-800">
              カテゴリー別売上
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {categoryList.length === 0 ? (
                <div className="rounded-xl bg-gray-50 p-4 text-center text-xs font-bold text-gray-400 md:col-span-2">
                  カテゴリー別データがありません
                </div>
              ) : (
                categoryList.map((category) => (
                  <div
                    key={category.id || category.name}
                    className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-800">
                        {category.name || 'カテゴリー未設定'}
                      </div>
                      <div className="text-[11px] font-bold text-gray-400">
                        {Number(category.quantity || 0)}点
                      </div>
                    </div>
                    <div className="ml-3 shrink-0 text-sm font-black text-gray-900">
                      {formatCurrency(category.total)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      <DailyClosingCheckModal
        isOpen={isCheckModalOpen}
        dateKey={dateKey}
        summary={summary}
        discountList={discountList}
        isProcessing={isClosing}
        onClose={() => {
          if (!isClosing) setIsCheckModalOpen(false);
        }}
        onConfirm={handleCloseDay}
      />
    </div>
  );
};

export default DailyClosingPanel;