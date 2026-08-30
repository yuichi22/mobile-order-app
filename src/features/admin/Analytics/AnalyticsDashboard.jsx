import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { db } from '../../../shared/api/firebase/client';
import { useAuth } from '../../../app/providers/useAuth';
import { useMenuData, useCategoryData, useBusinessSettings, usePeriodData, useStoreSettings } from '../../store/hooks';
import { getActiveRegisterContext, getDepartmentById, getAvailableDepartments } from '../../pos/utils/registerContext';
import { buildItemDepartmentResolver, filterAnalyticsOrdersByDepartment, splitTransactionsByDepartment } from './utils/departmentAttribution';

import CustomRangePicker from './components/CustomRangePicker';
import RankingView from './components/RankingView';
import AbcAnalysisView from './components/AbcAnalysisView';
import AnalyticsToolbar from './components/AnalyticsToolbar';
import AnalyticsSummaryCards from './components/AnalyticsSummaryCards';
import AnalyticsChartSection from './components/AnalyticsChartSection';
import AnalyticsModeTabs from './components/AnalyticsModeTabs';
import PosAnalyticsView from './components/PosAnalyticsView';
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
  // 分析も部門単位で表示。既定=自レジの部門、'all'=全体（日計と同じ方式）。
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('all');
  // 販売チャネル: 'all'(全体=店頭+EC) | 'pos'(店舗) | 'ec'(Shopify)。既定は全体。
  const [selectedChannel, setSelectedChannel] = useState('all');
  // 部門振り分け用の商品カテゴリーマスター（当日中はほぼ不変なので一度だけ取得）。
  const [productCategories, setProductCategories] = useState([]);
  const [productCategoryGroups, setProductCategoryGroups] = useState([]);
  // POS分析用の売り場マスター。サブカテゴリ用の商品取得は PosAnalyticsView 側で
  // 「サブカテゴリにドリルした時だけ・売れた商品だけ」遅延取得する（全商品先読みは重いため廃止）。
  const [productSalesAreas, setProductSalesAreas] = useState([]);

  const { menuItems = [] } = useMenuData(storeId);
  const { categories = [] } = useCategoryData(storeId);
  const { periods = [] } = usePeriodData(storeId);
  const { settings: storeSettings } = useStoreSettings(storeId);
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
    weeklyBaseDate,
    selectedPeriodId: effectiveSelectedPeriodId
  });

  // 部門振り分け・売り場集計に必須のマスター（カテゴリ/グループ/売り場）を取得。
  // ※重い/失敗しうる商品全件取得(サブカテゴリ用)とは必ず分離する。ここが失敗すると
  //   部門判定が総崩れ(全item飲食扱い)になり、POS分析が0表示になるため。
  useEffect(() => {
    let cancelled = false;
    const loadClassificationMaster = async () => {
      if (!storeId) {
        setProductCategories([]);
        setProductCategoryGroups([]);
        setProductSalesAreas([]);
        return;
      }
      try {
        const [catSnap, groupSnap, areaSnap] = await Promise.all([
          getDocs(collection(db, 'stores', storeId, 'productCategories')),
          getDocs(collection(db, 'stores', storeId, 'productCategoryGroups')),
          getDocs(collection(db, 'stores', storeId, 'productSalesAreas'))
        ]);
        if (cancelled) return;
        setProductCategories(catSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setProductCategoryGroups(groupSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setProductSalesAreas(areaSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } catch (error) {
        console.error('Failed to load classification master (Analytics):', error);
      }
    };
    loadClassificationMaster();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  // この端末の登録レジ→所属部門。分析は既定でこの部門を表示する。
  const activeRegister = useMemo(
    () => getActiveRegisterContext(storeId, storeSettings?.registers, storeSettings?.departments),
    [storeId, storeSettings?.registers, storeSettings?.departments]
  );
  const activeDepartment = useMemo(
    () => getDepartmentById(activeRegister?.departmentId, storeSettings?.departments),
    [activeRegister, storeSettings?.departments]
  );
  const departmentOptions = useMemo(
    () => getAvailableDepartments(storeSettings?.departments || []),
    [storeSettings?.departments]
  );
  // 表示中の部門。POS(物販)部門を選んでいる時は専用ビューに差し替える。
  const selectedDepartment = useMemo(
    () => departmentOptions.find((dept) => dept.id === selectedDepartmentId) || null,
    [departmentOptions, selectedDepartmentId]
  );
  const isPosDepartmentView = selectedDepartment?.registerMode === 'pos';

  // 既定表示を自部門に一度だけ寄せる（その後はユーザー操作を優先）。
  const didInitDeptFilter = useRef(false);
  useEffect(() => {
    if (didInitDeptFilter.current) return;
    if (!storeSettings?.departments && !storeSettings?.registers) return;
    didInitDeptFilter.current = true;
    setSelectedDepartmentId(activeDepartment?.id || 'all');
  }, [activeDepartment, storeSettings?.departments, storeSettings?.registers]);

  // 商品カテゴリーの所属部門でアイテムを振り分けるリゾルバ（日計と同一ロジック）。
  const resolveItemDepartment = useMemo(
    () => buildItemDepartmentResolver({
      productCategories,
      productCategoryGroups,
      departments: storeSettings?.departments || []
    }),
    [productCategories, productCategoryGroups, storeSettings?.departments]
  );

  // チャネル(店舗/EC/全体)で先に絞る。department帰属が salesChannel を消す(departmentAttribution)ため、
  // チャネル→部門の順で適用する。EC(shopify)判定は正規化時に付与した salesChannel を使う。
  const channelFilteredOrders = useMemo(() => {
    if (selectedChannel === 'ec') return orders.filter((record) => record?.salesChannel === 'shopify');
    if (selectedChannel === 'pos') return orders.filter((record) => record?.salesChannel !== 'shopify');
    return orders;
  }, [orders, selectedChannel]);

  // EC売上が期間内に存在する時だけチャネルトグルのEC欄を出す(単一チャネル店の混乱防止)。
  const hasEcData = useMemo(
    () => orders.some((record) => record?.salesChannel === 'shopify'),
    [orders]
  );

  // 選択部門で order レコードを絞った分析入力（'all' は全件＝従来挙動）。
  const departmentFilteredOrders = useMemo(
    () => filterAnalyticsOrdersByDepartment(channelFilteredOrders, resolveItemDepartment, selectedDepartmentId),
    [channelFilteredOrders, resolveItemDepartment, selectedDepartmentId]
  );

  // POS(物販)ビュー用: 物販部門スライス（日計と同一ルールで物販に絞った取引）。
  const posDepartmentId = useMemo(
    () => departmentOptions.find((dept) => dept.registerMode === 'pos')?.id || null,
    [departmentOptions]
  );
  const posDepartmentSlices = useMemo(() => {
    if (!isPosDepartmentView || !posDepartmentId) return [];
    // 店頭(POS)分のみ。ECは salesChannel で除外し、下の ecDepartmentSlices として別に渡す。
    return splitTransactionsByDepartment(orders.filter((record) => record?.salesChannel !== 'shopify'), resolveItemDepartment)
      .filter((slice) => String(slice?.departmentId || '') === String(posDepartmentId));
  }, [isPosDepartmentView, posDepartmentId, orders, resolveItemDepartment]);

  // EC(shopify)取引を物販ビューの EC/全体 に流すためのスライス。明細の productId を補完(サブカテゴリ用)。
  const ecDepartmentSlices = useMemo(
    () => (orders || [])
      .filter((record) => record?.salesChannel === 'shopify')
      .map((record) => ({
        ...record,
        items: (Array.isArray(record.items) ? record.items : []).map((item) => ({
          ...item,
          productId: item.productId || item.matchedProductId || ''
        }))
      })),
    [orders]
  );

  const analytics = useAnalyticsSummary({
    orders: departmentFilteredOrders,
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
          departmentOptions={departmentOptions}
          selectedDepartmentId={selectedDepartmentId}
          setSelectedDepartmentId={setSelectedDepartmentId}
          activeDepartment={activeDepartment}
          activeRegister={activeRegister}
          selectedChannel={selectedChannel}
          setSelectedChannel={setSelectedChannel}
          showEcChannel={hasEcData && !isPosDepartmentView}
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
      ) : isPosDepartmentView ? (
        <PosAnalyticsView
          storeId={storeId}
          posSlices={posDepartmentSlices}
          ecSlices={ecDepartmentSlices}
          period={period}
          currentDate={effectiveAnalyticsDate}
          customRange={customRange}
          weeklyBaseDate={weeklyBaseDate}
          isDayOfWeekMode={effectiveDayOfWeekMode}
          businessSettings={businessSettings}
          periods={periods}
          chartMetric={chartMetric}
          salesAreas={productSalesAreas}
          productCategories={productCategories}
          productCategoryGroups={productCategoryGroups}
        />
      ) : (
        <div className="print:w-full flex-grow">
          <AnalyticsSummaryCards
            totalSales={analytics.totalSales}
            totalSalesTaxExcluded={analytics.totalSalesTaxExcluded}
            totalTaxAmount={analytics.totalTaxAmount}
            cancelReturnTotal={analytics.cancelReturnTotal}
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

          {/* 粗利・原価（原価登録済み明細ベース。日計と同基準） */}
          <div className="mb-8 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-emerald-50 p-4">
              <div className="text-xs font-black text-emerald-600">粗利（税抜）</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                ¥{Number(analytics.grossProfitTaxExcluded || 0).toLocaleString()}
              </div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">原価率</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                {analytics.costRate == null ? '-' : `${Number(analytics.costRate).toFixed(1)}%`}
              </div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-xs font-black text-gray-400">原価（税抜）</div>
              <div className="mt-2 text-2xl font-black text-gray-900">
                ¥{Number(analytics.costTaxExcludedTotal || 0).toLocaleString()}
              </div>
            </div>
          </div>

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