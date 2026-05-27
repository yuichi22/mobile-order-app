import React, { useMemo, useRef, useState } from 'react';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { useAuth } from '../../../app/providers/useAuth';
import { useMenuData, useCategoryData, useBusinessSettings, usePeriodData } from '../../store/hooks';

import CustomRangePicker from './components/CustomRangePicker';
import RankingView from './components/RankingView';
import AbcAnalysisView from './components/AbcAnalysisView';
import AnalyticsToolbar from './components/AnalyticsToolbar';
import AnalyticsSummaryCards from './components/AnalyticsSummaryCards';
import AnalyticsChartSection from './components/AnalyticsChartSection';
import AnalyticsModeTabs from './components/AnalyticsModeTabs';
import DailyClosingPanel from '../components/DailyClosingPanel';
import { useAnalyticsOrders } from './hooks/useAnalyticsOrders';
import { useAnalyticsSummary } from './hooks/useAnalyticsSummary';
import { useWeeklyTrendBaseDate } from './hooks/useWeeklyTrendBaseDate';
import WeeklyComparisonCard from './components/WeeklyComparisonCard';

const formatDateLabel = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const day = target.getDate();

  const weekLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const week = weekLabels[target.getDay()];

  return `${year}年${month}月${day}日（${week}）`;
};

const formatDateInputValue = (date) => {
  const target = new Date(date || new Date());
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value) => {
  if (!value) return new Date();

  const [year, month, day] = value.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day);
  nextDate.setHours(0, 0, 0, 0);

  return nextDate;
};

const DailyClosingDateNavigator = ({ currentDate, shiftDate, setCurrentDate }) => {
  const dateInputRef = useRef(null);

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;

    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }

    input.click();
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-orange-100 bg-orange-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-orange-500">
          <CalendarDays size={15} />
          日計対象日
        </div>
        <p className="mt-1 text-xs font-bold text-gray-400">
          矢印で日付を移動できます。日付を押すとカレンダーから選択できます。
        </p>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => shiftDate(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-600"
          aria-label="前の日"
        >
          <ChevronLeft size={20} strokeWidth={3} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={openDatePicker}
            className="min-w-[220px] rounded-full bg-white px-6 py-3 text-center text-sm font-black text-gray-900 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-700"
          >
            {formatDateLabel(currentDate)}
          </button>

          <input
            ref={dateInputRef}
            type="date"
            value={formatDateInputValue(currentDate)}
            onChange={(event) => setCurrentDate(parseDateInputValue(event.target.value))}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>

        <button
          type="button"
          onClick={() => shiftDate(1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-orange-100 hover:text-orange-600"
          aria-label="次の日"
        >
          <ChevronRight size={20} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
};

const AnalyticsDashboard = ({ mode = 'analytics' }) => {
  const { storeId: authStoreId } = useAuth();

  const storeId = authStoreId;
  const dashboardMode = mode === 'dailyClosing' ? 'dailyClosing' : 'analytics';

  const [period, setPeriod] = useState('daily');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isDayOfWeekMode, setIsDayOfWeekMode] = useState(false);
  const [analysisMode, setAnalysisMode] = useState('ranking');
  const [chartMetric, setChartMetric] = useState('sales');
  const [selectedPeriodId, setSelectedPeriodId] = useState('all');
  const [abcThresholds, setAbcThresholds] = useState({ a: 70, b: 90 });
  const [showAbcSettings, setShowAbcSettings] = useState(false);
  const [customRange, setCustomRange] = useState({
    start: new Date(),
    end: new Date()
  });

  const { menuItems = [] } = useMenuData(storeId);
  const { categories = [] } = useCategoryData(storeId);
  const { periods = [] } = usePeriodData(storeId);
  const {
    weeklyBaseDate,
    weeklyBaseDateKey,
    isFallbackYesterday
  } = useWeeklyTrendBaseDate(storeId);

  const effectiveAnalyticsDate = period === 'weekly'
    ? weeklyBaseDate
    : currentDate;
    
  const { settings: businessSettings } = useBusinessSettings(storeId);

  const categoryColorMap = useMemo(() => {
    const map = {};
    categories.forEach((category) => {
      map[category.id] = category.hex;
    });
    return map;
  }, [categories]);

  const itemCategoryMap = useMemo(() => {
    const map = {};
    if (Array.isArray(menuItems)) {
      menuItems.forEach((item) => {
        map[item.name] = item.category;
      });
    }
    return map;
  }, [menuItems]);

  const periodOptions = useMemo(() => (
    Array.isArray(periods)
      ? periods
          .map((periodOption) => ({
            id: String(periodOption?.id || '').trim(),
            label: String(periodOption?.name || periodOption?.label || periodOption?.id || '').trim()
          }))
          .filter((periodOption) => periodOption.id && periodOption.label)
      : []
  ), [periods]);

  const effectiveSelectedPeriodId = periodOptions.some((periodOption) => periodOption.id === selectedPeriodId)
    ? selectedPeriodId
    : 'all';

  const effectiveDayOfWeekMode =
    (period === 'monthly' || period === 'custom') && isDayOfWeekMode;

  const orders = useAnalyticsOrders({
    storeId,
    period,
    currentDate: effectiveAnalyticsDate,
    customRange,
    weeklyBaseDate
  });

  const analytics = useAnalyticsSummary({
    orders,
    period,
    currentDate: effectiveAnalyticsDate,
    customRange,
    itemCategoryMap,
    categoryColorMap,
    isDayOfWeekMode: effectiveDayOfWeekMode,
    abcThresholds,
    categories,
    businessSettings,
    weeklyBaseDate,
    periods,
    selectedPeriodId: effectiveSelectedPeriodId
  });

  const shiftDate = (delta) => {
    const nextDate = new Date(currentDate);

    if (dashboardMode === 'dailyClosing' || period === 'daily') {
      nextDate.setDate(nextDate.getDate() + delta);
    } else if (period === 'weekly') {
      nextDate.setDate(nextDate.getDate() + (delta * 7));
    } else {
      nextDate.setMonth(nextDate.getMonth() + delta);
    }

    setCurrentDate(nextDate);
  };

  return (
    <div className="relative flex min-h-[calc(100vh-140px)] flex-col rounded-xl bg-white p-6 shadow-sm transition-all">
      {dashboardMode === 'analytics' && (
        <AnalyticsToolbar
          period={period}
          setPeriod={setPeriod}
          currentDate={effectiveAnalyticsDate}
          setCurrentDate={setCurrentDate}
          shiftDate={shiftDate}
          customRange={customRange}
          setCustomRange={setCustomRange}
          isDayOfWeekMode={isDayOfWeekMode}
          setIsDayOfWeekMode={setIsDayOfWeekMode}
          weeklyBaseDateKey={weeklyBaseDateKey}
          isWeeklyFallbackYesterday={isFallbackYesterday}
        >
          {period === 'custom' && (
            <CustomRangePicker
              startDate={customRange.start}
              endDate={customRange.end}
              onChange={(start, end) => setCustomRange({ start, end })}
              isWeekMode={effectiveDayOfWeekMode}
            />
          )}
        </AnalyticsToolbar>
      )}

      {dashboardMode === 'dailyClosing' ? (
        <DailyClosingPanel
          storeId={storeId}
          targetDate={currentDate}
          setTargetDate={setCurrentDate}
        />
      ) : (
        <div className="print:w-full flex-grow">
          <AnalyticsSummaryCards
            totalSales={analytics.totalSales}
            totalOrders={analytics.totalOrders}
            customerCount={analytics.customerCount}
            averageSpendPerCustomer={analytics.averageSpendPerCustomer}
            averageSpendPerTransaction={analytics.averageSpendPerTransaction}
            averagePartySize={analytics.averagePartySize}
            activeMetric={chartMetric}
            onMetricChange={setChartMetric}
            selectedPeriodId={effectiveSelectedPeriodId}
            periodOptions={periodOptions}
            onSelectedPeriodChange={setSelectedPeriodId}
          />

          {period === 'weekly' && (
            <WeeklyComparisonCard comparison={analytics.weeklyComparison} />
          )}


            <AnalyticsChartSection
              chartData={analytics.chartData}
              maxChartValue={analytics.maxChartValue}
              yAxisTicks={analytics.yAxisTicks}
              categories={categories}
              isDayOfWeekMode={effectiveDayOfWeekMode}
              chartMetric={chartMetric}
            />

          <div className="print:break-inside-avoid mt-8">
            <AnalyticsModeTabs
              analysisMode={analysisMode}
              setAnalysisMode={setAnalysisMode}
              showAbcSettings={showAbcSettings}
              setShowAbcSettings={setShowAbcSettings}
            />

            {analysisMode === 'ranking' ? (
              <RankingView ranking={analytics.itemRanking} />
            ) : (
              <AbcAnalysisView
                abcAnalysis={analytics.abcAnalysis}
                abcThresholds={abcThresholds}
                setAbcThresholds={setAbcThresholds}
                showSettings={showAbcSettings}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;