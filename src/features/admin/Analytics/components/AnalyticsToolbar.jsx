import React, { useRef } from 'react';
import {
  Calendar as CalendarIcon,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Printer,
  Settings
} from 'lucide-react';

const formatDailyLabel = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const day = target.getDate();

  const weekLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const week = weekLabels[target.getDay()];

  return `${year}年${month}月${day}日（${week}）`;
};

const formatMonthlyLabel = (date) => {
  const target = new Date(date || new Date());
  return `${target.getFullYear()}年${target.getMonth() + 1}月`;
};

const formatWeeklyLabel = (date) => {
  const end = new Date(date || new Date());
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - (52 * 7) + 1);

  const formatShort = (target) => (
    `${target.getFullYear()}/${target.getMonth() + 1}/${target.getDate()}`
  );

  return `${formatShort(start)}〜${formatShort(end)}`;
};

const formatDateInputValue = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const formatMonthInputValue = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
};

const parseDateInputValue = (value) => {
  if (!value) return new Date();

  const [year, month, day] = value.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day);
  nextDate.setHours(0, 0, 0, 0);

  return nextDate;
};

const parseMonthInputValue = (value) => {
  if (!value) return new Date();

  const [year, month] = value.split('-').map(Number);
  const nextDate = new Date(year, month - 1, 1);
  nextDate.setHours(0, 0, 0, 0);

  return nextDate;
};

const PeriodButton = ({ active, icon: Icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex h-10 items-center gap-2 rounded-full px-4 text-sm font-black transition-colors ${
      active
        ? 'bg-orange-500 text-white shadow-sm'
        : 'bg-white text-gray-500 shadow-sm hover:bg-orange-100 hover:text-orange-600'
    }`}
  >
    <Icon size={15} strokeWidth={2.8} />
    {label}
  </button>
);

const AnalyticsToolbar = ({
  children,
  period,
  setPeriod,
  currentDate,
  shiftDate,
  setCurrentDate,
  isDayOfWeekMode,
  setIsDayOfWeekMode
}) => {
  const dateInputRef = useRef(null);
  const monthInputRef = useRef(null);

  const handlePrint = () => {
    window.print();
  };

  const openPicker = () => {
    const input = period === 'monthly' ? monthInputRef.current : dateInputRef.current;
    if (!input) return;

    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.click();
  };

  const handleDateChange = (event) => {
    if (!setCurrentDate) return;
    setCurrentDate(parseDateInputValue(event.target.value));
  };

  const handleMonthChange = (event) => {
    if (!setCurrentDate) return;
    setCurrentDate(parseMonthInputValue(event.target.value));
  };

  const currentLabel = period === 'monthly'
    ? formatMonthlyLabel(currentDate)
    : period === 'weekly'
      ? formatWeeklyLabel(currentDate)
      : formatDailyLabel(currentDate);

  return (
    <div className="mb-6 space-y-4 print:hidden">
      <div className="flex flex-col gap-3 rounded-2xl border border-orange-100 bg-orange-50/40 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black text-orange-500">
            <CalendarDays size={15} />
            分析対象期間
          </div>
          <p className="mt-1 text-xs font-bold text-gray-400">
            日次・月次・任意期間を切り替えて売上を確認できます。
          </p>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <PeriodButton
              active={period === 'daily'}
              icon={Clock}
              label="日次"
              onClick={() => setPeriod('daily')}
            />

            <PeriodButton
              active={period === 'monthly'}
              icon={CalendarIcon}
              label="月次"
              onClick={() => setPeriod('monthly')}
            />

            <PeriodButton
              active={period === 'weekly'}
              icon={CalendarClock}
              label="週次トレンド"
              onClick={() => setPeriod('weekly')}
            />

            <PeriodButton
              active={period === 'custom'}
              icon={Settings}
              label="任意期間"
              onClick={() => setPeriod('custom')}
            />
          </div>

          {period !== 'custom' && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => shiftDate(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-600"
                aria-label="前へ"
              >
                <ChevronLeft size={20} strokeWidth={3} />
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={openPicker}
                  className="min-w-[220px] rounded-full bg-white px-6 py-3 text-center text-sm font-black text-gray-900 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-700"
                >
                  {currentLabel}
                </button>

                <input
                  ref={dateInputRef}
                  type="date"
                  value={formatDateInputValue(currentDate)}
                  onChange={handleDateChange}
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <input
                  ref={monthInputRef}
                  type="month"
                  value={formatMonthInputValue(currentDate)}
                  onChange={handleMonthChange}
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>

              <button
                type="button"
                onClick={() => shiftDate(1)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-600"
                aria-label="次へ"
              >
                <ChevronRight size={20} strokeWidth={3} />
              </button>
            </div>
          )}
        </div>
      </div>

      {period === 'custom' && (
        <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
          {children}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {(period === 'monthly' || period === 'custom') && (
          <button
            type="button"
            onClick={() => setIsDayOfWeekMode(!isDayOfWeekMode)}
            className={`flex h-11 items-center gap-2 rounded-full px-4 text-sm font-black shadow-sm transition-all active:scale-95 ${
              isDayOfWeekMode
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-500 hover:bg-orange-50 hover:text-orange-600'
            }`}
          >
            <CalendarRange size={17} strokeWidth={2.7} />
            曜日で見る
          </button>
        )}

        <button
          type="button"
          onClick={handlePrint}
          className="flex h-11 items-center gap-2 rounded-full bg-gray-900 px-4 text-sm font-black text-white shadow-sm transition-all hover:bg-black active:scale-95"
        >
          <Printer size={17} strokeWidth={2.7} />
          印刷
        </button>
      </div>
    </div>
  );
};

export default AnalyticsToolbar;