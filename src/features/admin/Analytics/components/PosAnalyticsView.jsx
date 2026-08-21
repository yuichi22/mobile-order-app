import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { Store, Globe, ChevronRight, X, LayoutGrid, Layers, TicketPercent, TrendingUp, AlignLeft } from 'lucide-react';

import { db } from '../../../../shared/api/firebase/client';
import { useAnalyticsSummary } from '../hooks/useAnalyticsSummary';
import { buildDailyClosingSummary } from '../utils/dailyClosingHelpers';
import AnalyticsChartSection from './AnalyticsChartSection';
import AbcAnalysisView from './AbcAnalysisView';
import {
  buildPosItemResolver,
  filterPosOrders,
  buildAreaBreakdown,
  buildGroupBreakdown,
  buildCategoryBreakdown,
  buildSubCategoryBreakdown,
  sumGrossItemTotal
} from '../utils/posAnalyticsSales';

const yen = (value) => `¥${Number(value || 0).toLocaleString()}`;
const ratioText = (amount, base) => (Number(base || 0) > 0 ? `売上比 ${(Number(amount || 0) / base * 100).toFixed(1)}%` : '売上比 -');

// 税込/税抜の表示モードは端末に記憶する（日計と同じ運用）。
const AMOUNT_MODE_KEY = 'posAnalyticsAmountDisplayMode';
const getInitialTaxMode = () => {
  try {
    return window.localStorage.getItem(AMOUNT_MODE_KEY) === 'tax_excluded' ? 'tax_excluded' : 'tax_included';
  } catch {
    return 'tax_included';
  }
};

// 階層の順序と、1つ下へのドリルダウン定義。
const DRILL = {
  area: { deeper: 'group', scopeKey: 'areaId', suffix: 'グループ' },
  group: { deeper: 'category', scopeKey: 'groupId', suffix: 'カテゴリ' },
  category: { deeper: 'subCategory', scopeKey: 'categoryId', suffix: 'サブカテゴリ' },
  subCategory: null
};

const KIND_ICON = { area: Store, group: Layers, category: LayoutGrid, subCategory: LayoutGrid };

const SummaryCards = ({ salesIncl, salesExcl, totalTax, customerCount, avgIncl, avgExcl, taxMode, onTaxModeChange }) => {
  const isExcl = taxMode === 'tax_excluded';
  const label = isExcl ? '税抜' : '税込';
  const mainSales = isExcl ? salesExcl : salesIncl;
  const subSales = isExcl ? salesIncl : salesExcl;
  const mainAvg = isExcl ? avgExcl : avgIncl;
  const subAvg = isExcl ? avgIncl : avgExcl;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl bg-blue-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black text-blue-600">売上合計 {label}・値引き後</div>
          <div className="flex rounded-full bg-white p-0.5 text-[10px] font-black shadow-sm">
            <button
              type="button"
              onClick={() => onTaxModeChange('tax_excluded')}
              className={`rounded-full px-2 py-1 transition-colors ${isExcl ? 'bg-blue-600 text-white' : 'text-blue-600'}`}
            >
              税抜
            </button>
            <button
              type="button"
              onClick={() => onTaxModeChange('tax_included')}
              className={`rounded-full px-2 py-1 transition-colors ${!isExcl ? 'bg-blue-600 text-white' : 'text-blue-600'}`}
            >
              税込
            </button>
          </div>
        </div>
        <div className="mt-2 text-2xl font-black text-gray-900">{yen(mainSales)}</div>
        <div className="mt-1 text-[11px] font-bold text-blue-600/80">
          {isExcl ? '税込' : '税抜'} {yen(subSales)}
          <span className="mx-1 text-blue-300">/</span>
          内税 {yen(totalTax)}
        </div>
      </div>
      <div className="rounded-2xl bg-gray-50 p-4">
        <div className="text-xs font-black text-gray-400">来客数（会計件数）</div>
        <div className="mt-2 text-2xl font-black text-gray-900">{Number(customerCount || 0).toLocaleString()}</div>
      </div>
      <div className="rounded-2xl bg-gray-50 p-4">
        <div className="text-xs font-black text-gray-400">客単価 {label}</div>
        <div className="mt-2 text-2xl font-black text-gray-900">{yen(mainAvg)}</div>
        <div className="mt-1 text-[11px] font-bold text-gray-400">{isExcl ? '税込' : '税抜'} {yen(subAvg)}</div>
      </div>
    </div>
  );
};

// 物販の期間合計サマリ(値引き/販促/売掛/粗利)。選択分類に依らず全体を出す。
const FinancialPanel = ({ financial, grossItemTotal }) => {
  const netSales = Number(financial?.totalSales || 0);
  return (
    <div className="mt-4 rounded-2xl border border-gray-100 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
        <TicketPercent size={16} /> 物販の内訳（期間合計）
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">税込（粗利・原価は税抜）</span>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="text-[11px] font-black text-gray-400">商品売上（値引き前）</div>
          <div className="mt-1 text-xl font-black text-gray-900">{yen(grossItemTotal)}</div>
          <div className="mt-1 text-[11px] font-bold text-gray-400">値引き後 {yen(netSales)}</div>
        </div>
        <div className="rounded-xl bg-orange-50 p-4">
          <div className="text-[11px] font-black text-orange-500">値引き額</div>
          <div className="mt-1 text-xl font-black text-gray-900">{yen(financial?.discountTotal)}</div>
          <div className="mt-1 text-[11px] font-bold text-orange-400">{ratioText(financial?.discountTotal, netSales)}</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-4">
          <div className="text-[11px] font-black text-emerald-600">販促費</div>
          <div className="mt-1 text-xl font-black text-gray-900">{yen(financial?.promoExpenseTotal)}</div>
          <div className="mt-1 text-[11px] font-bold text-emerald-500">{ratioText(financial?.promoExpenseTotal, netSales)}</div>
        </div>
        <div className="rounded-xl bg-sky-50 p-4">
          <div className="text-[11px] font-black text-sky-600">金券/売掛</div>
          <div className="mt-1 text-xl font-black text-gray-900">{yen(financial?.voucherTotal)}</div>
          <div className="mt-1 text-[11px] font-bold text-sky-500">{ratioText(financial?.voucherTotal, netSales)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-emerald-50/60 p-4">
          <div className="flex items-center gap-1 text-[11px] font-black text-emerald-600"><TrendingUp size={12} /> 粗利（税抜）</div>
          <div className="mt-1 text-xl font-black text-gray-900">{yen(financial?.grossProfitTaxExcluded)}</div>
          <div className="mt-1 text-[11px] font-bold text-gray-400">税込 {yen(financial?.grossProfitTaxIncluded)}</div>
        </div>
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="text-[11px] font-black text-gray-400">粗利率</div>
          <div className="mt-1 text-xl font-black text-gray-900">
            {financial?.grossProfitRate == null ? '-' : `${Number(financial.grossProfitRate || 0).toFixed(1)}%`}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="text-[11px] font-black text-gray-400">原価（税抜）</div>
          <div className="mt-1 text-xl font-black text-gray-900">{yen(financial?.costTaxExcludedTotal)}</div>
        </div>
      </div>
    </div>
  );
};

const SalesRow = ({ entry, active, onSelect, onDrill }) => (
  <div className={`flex items-center justify-between rounded-xl px-2 py-2 transition ${
    active ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-gray-50 hover:bg-gray-100'
  }`}>
    <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2 py-1 text-left">
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-gray-800">{entry.name}</div>
        <div className="text-[11px] font-bold text-gray-400">
          {Number(entry.quantity || 0).toLocaleString()}点
          <span className="mx-1 text-gray-300">/</span>
          {Number(entry.transactionCount || 0).toLocaleString()}会計
        </div>
      </div>
      <span className="shrink-0 text-sm font-black text-gray-900">{yen(entry.total)}</span>
    </button>
    {onDrill && (
      <button
        type="button"
        onClick={onDrill}
        className="ml-1 flex shrink-0 items-center gap-0.5 rounded-lg bg-white px-2 py-1.5 text-[11px] font-black text-gray-500 shadow-sm transition hover:bg-blue-50 hover:text-blue-600"
      >
        詳細<ChevronRight size={13} />
      </button>
    )}
  </div>
);

const EmptyList = ({ label = 'データがありません' }) => (
  <div className="rounded-xl bg-gray-50 p-6 text-center text-xs font-bold text-gray-400">{label}</div>
);

// 構成比の配色。
const COMPOSITION_PALETTE = [
  '#f97316', '#0ea5e9', '#22c55e', '#a855f7', '#eab308',
  '#ef4444', '#14b8a6', '#ec4899', '#6366f1', '#84cc16',
  '#f59e0b', '#06b6d4', '#8b5cf6', '#10b981', '#fb7185'
];

// 一覧の構成比を横いっぱいの100%分割バーで表示（高さを取らない）。
const CompositionBar = ({ items = [], title = '売上割合' }) => {
  const list = (Array.isArray(items) ? items : []).filter((i) => Number(i.total || 0) > 0);
  const total = list.reduce((sum, i) => sum + Number(i.total || 0), 0);
  const colorOf = (index) => COMPOSITION_PALETTE[index % COMPOSITION_PALETTE.length];

  return (
    <div className="print:break-inside-avoid mb-6">
      <div className="mb-2 flex items-center gap-2 text-xs font-black text-gray-500">
        <AlignLeft size={14} /> {title}
      </div>
      {total === 0 ? (
        <EmptyList />
      ) : (
        <>
          <div className="flex h-7 w-full overflow-hidden rounded-full bg-gray-100">
            {list.map((entry, index) => {
              const pct = (Number(entry.total || 0) / total) * 100;
              return (
                <div
                  key={entry.id}
                  className="h-full"
                  style={{ width: `${pct}%`, backgroundColor: colorOf(index) }}
                  title={`${entry.name}: ${yen(entry.total)} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {list.map((entry, index) => {
              const pct = (Number(entry.total || 0) / total) * 100;
              return (
                <div key={entry.id} className="flex items-center gap-1.5 text-[11px] font-bold">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(index) }} />
                  <span className="text-gray-700">{entry.name}</span>
                  <span className="text-gray-400">{pct.toFixed(1)}%</span>
                  <span className="text-gray-500">{yen(entry.total)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const PosAnalyticsView = ({
  storeId,
  posSlices,
  ecSlices = [],
  period,
  currentDate,
  customRange,
  weeklyBaseDate,
  isDayOfWeekMode,
  businessSettings,
  periods,
  chartMetric,
  salesAreas,
  productCategories,
  productCategoryGroups
}) => {
  const [viewMode, setViewMode] = useState('store'); // 'store' | 'ec' | 'all'
  const [selection, setSelection] = useState({ level: 'all' });
  const [drillTabs, setDrillTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState('area');
  const [abcThresholds, setAbcThresholds] = useState({ a: 70, b: 90 });
  // 売上の税込/税抜表示（端末に記憶。日計と同じ運用）。
  const [taxMode, setTaxMode] = useState(getInitialTaxMode);
  const updateTaxMode = (mode) => {
    const next = mode === 'tax_excluded' ? 'tax_excluded' : 'tax_included';
    setTaxMode(next);
    try { window.localStorage.setItem(AMOUNT_MODE_KEY, next); } catch { /* 記憶不可の環境は無視 */ }
  };
  // サブカテゴリ用 productId→{subCategoryId,subCategoryName}。サブカテゴリにドリルした時のみ、
  // その期間に売れた商品だけを遅延取得する（全商品先読みは重いので廃止）。
  const [subcatProductMap, setSubcatProductMap] = useState(() => new Map());
  const loadedProductIdsRef = useRef(new Set());

  const resolvePosItem = useMemo(
    () => buildPosItemResolver({ salesAreas, productCategories, productCategoryGroups, productById: subcatProductMap }),
    [salesAreas, productCategories, productCategoryGroups, subcatProductMap]
  );

  // EC(Shopify)取引スライス。AnalyticsDashboard から ecOrders 由来で渡る。
  const EC_SLICES = useMemo(() => ecSlices || [], [ecSlices]);
  const hasEc = EC_SLICES.length > 0;
  const sourceSlices = viewMode === 'store'
    ? (posSlices || [])
    : viewMode === 'ec'
      ? EC_SLICES
      : [...(posSlices || []), ...EC_SLICES]; // 'all' = 店舗+EC

  // 物販の内訳(値引き/販促/売掛/粗利)は日計と同じ集計で期間合計を出す。
  const financial = useMemo(
    () => buildDailyClosingSummary(sourceSlices, periods),
    [sourceSlices, periods]
  );
  const grossItemTotal = useMemo(() => sumGrossItemTotal(sourceSlices), [sourceSlices]);

  // カード・グラフ・ABC: 選択分類で絞った取引 → 既存サマリに流し込む。
  const filteredOrders = useMemo(
    () => filterPosOrders(sourceSlices, resolvePosItem, selection),
    [sourceSlices, resolvePosItem, selection]
  );
  const analytics = useAnalyticsSummary({
    orders: filteredOrders,
    period,
    currentDate,
    customRange,
    itemCategoryMap: {},
    categoryColorMap: {},
    isDayOfWeekMode,
    abcThresholds,
    categories: [],
    businessSettings,
    weeklyBaseDate,
    periods,
    selectedPeriodId: 'all'
  });

  const baseTab = viewMode === 'ec'
    ? { id: 'group', kind: 'group', label: 'カテゴリーグループ別' }
    : { id: 'area', kind: 'area', label: '売場別' };
  const tabs = [baseTab, ...drillTabs];
  const activeTab = tabs.find((t) => t.id === activeTabId) || baseTab;

  const switchMode = (mode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    setDrillTabs([]);
    setSelection({ level: 'all' });
    setActiveTabId(mode === 'ec' ? 'group' : 'area');
  };

  const activeList = useMemo(() => {
    switch (activeTab.kind) {
      case 'area': return buildAreaBreakdown(sourceSlices, resolvePosItem);
      case 'group': return buildGroupBreakdown(sourceSlices, resolvePosItem, activeTab.scope || {});
      case 'category': return buildCategoryBreakdown(sourceSlices, resolvePosItem, activeTab.scope?.groupId);
      case 'subCategory': return buildSubCategoryBreakdown(sourceSlices, resolvePosItem, activeTab.scope?.categoryId);
      default: return [];
    }
  }, [activeTab, sourceSlices, resolvePosItem]);

  // サブカテゴリタブを開いた時だけ、その期間にそのカテゴリで売れた商品(productId)を遅延取得する。
  // 明細に subCategory が無いため商品から補完する。全商品(数万件)先読みは廃止し、必要分のみ。
  const subcatCategoryId = activeTab.kind === 'subCategory' ? String(activeTab.scope?.categoryId || '') : '';
  useEffect(() => {
    if (!subcatCategoryId || !storeId) return undefined;

    const ids = new Set();
    (sourceSlices || []).forEach((tx) => {
      (Array.isArray(tx.items) ? tx.items : []).forEach((it) => {
        if (String(it.categoryId || '') === subcatCategoryId && it.productId) ids.add(String(it.productId));
      });
    });
    const missing = [...ids].filter((id) => !loadedProductIdsRef.current.has(id));
    if (missing.length === 0) return undefined;
    missing.forEach((id) => loadedProductIdsRef.current.add(id));

    let cancelled = false;
    (async () => {
      try {
        const col = collection(db, 'stores', storeId, 'products');
        const chunks = [];
        for (let i = 0; i < missing.length; i += 30) chunks.push(missing.slice(i, i + 30));
        const snaps = await Promise.all(chunks.map((ch) => getDocs(query(col, where(documentId(), 'in', ch)))));
        if (cancelled) return;
        setSubcatProductMap((prev) => {
          const next = new Map(prev);
          snaps.forEach((snap) => snap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            next.set(String(docSnap.id), {
              subCategoryId: String(data.subCategoryId || '').trim(),
              subCategoryName: String(data.subCategoryName || '').trim()
            });
          }));
          return next;
        });
      } catch (error) {
        missing.forEach((id) => loadedProductIdsRef.current.delete(id)); // 再取得できるよう戻す
        console.error('Failed to load products for subcategory (Analytics):', error);
      }
    })();
    return () => { cancelled = true; };
  }, [subcatCategoryId, sourceSlices, storeId]);

  const selectRow = (entry) => {
    setSelection((prev) => (
      prev.level === activeTab.kind && String(prev.id) === String(entry.id)
        ? { level: 'all' }
        : { level: activeTab.kind, id: entry.id, name: entry.name }
    ));
  };

  // タブへ移動する時は選択(グラフ絞り込み)を解除し、その階層の割合グラフを必ず出す。
  const activateTab = (id) => {
    setActiveTabId(id);
    setSelection({ level: 'all' });
  };

  const drillRow = (entry) => {
    const rule = DRILL[activeTab.kind];
    if (!rule) return;
    const id = `${rule.deeper}:${entry.id}`;
    const tab = {
      id,
      kind: rule.deeper,
      scope: { ...(activeTab.scope || {}), [rule.scopeKey]: entry.id },
      label: `${entry.name}｜${rule.suffix}`,
      closable: true
    };
    setDrillTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, tab]));
    activateTab(id);
  };

  const closeTab = (tabId) => {
    setDrillTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((prev) => (prev === tabId ? baseTab.id : prev));
    setSelection({ level: 'all' });
  };

  const canDrill = Boolean(DRILL[activeTab.kind]);

  return (
    <div className="flex-grow">
      {/* 店舗 / EC / 全体 切替（既定=店舗） */}
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex rounded-full bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => switchMode('store')}
            className={`flex h-9 items-center gap-1.5 rounded-full px-5 text-sm font-black transition ${
              viewMode === 'store' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-blue-600'
            }`}
          >
            <Store size={15} /> 店舗
          </button>
          <button
            type="button"
            onClick={() => switchMode('ec')}
            className={`flex h-9 items-center gap-1.5 rounded-full px-5 text-sm font-black transition ${
              viewMode === 'ec' ? 'bg-sky-500 text-white shadow-sm' : 'text-gray-500 hover:text-sky-600'
            }`}
          >
            <Globe size={15} /> EC
          </button>
          <button
            type="button"
            onClick={() => switchMode('all')}
            className={`flex h-9 items-center gap-1.5 rounded-full px-5 text-sm font-black transition ${
              viewMode === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-500 hover:text-slate-700'
            }`}
          >
            全体
          </button>
        </div>
        {(viewMode === 'ec' || viewMode === 'all') && !hasEc && (
          <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-bold text-sky-500">
            この期間のEC売上はありません
          </span>
        )}
        {/* ECは拠点ではなく販売チャネル。複数店舗で同じECサイトを共有している場合、
            店舗ごとのEC売上を足すと二重計上になる。 */}
        {(viewMode === 'ec' || viewMode === 'all') && hasEc && (
          <span
            className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-600"
            title="ECサイトの売上は店舗ではなく販売チャネルの売上です。同じECサイトを複数店舗で共有している場合、店舗ごとの数字を合算すると二重計上になります。"
          >
            ECは全店共通（店舗別に合算しない）
          </span>
        )}
      </div>

      {/* 売上合計カードは選択に依らず物販の期間合計で固定（グラフのみ選択を反映）。 */}
      <SummaryCards
        salesIncl={financial?.totalSales}
        salesExcl={financial?.totalSalesTaxExcluded}
        totalTax={financial?.totalTaxAmount}
        customerCount={financial?.transactionCount}
        avgIncl={Number(financial?.transactionCount || 0) > 0
          ? Math.round(Number(financial?.totalSales || 0) / Number(financial.transactionCount))
          : 0}
        avgExcl={Number(financial?.transactionCount || 0) > 0
          ? Math.round(Number(financial?.totalSalesTaxExcluded || 0) / Number(financial.transactionCount))
          : 0}
        taxMode={taxMode}
        onTaxModeChange={updateTaxMode}
      />

      {viewMode === 'store' && <FinancialPanel financial={financial} grossItemTotal={grossItemTotal} />}

      {selection.level !== 'all' && (
        <div className="mt-3 flex items-center gap-2 text-xs font-black text-blue-600">
          <span className="rounded-full bg-blue-100 px-3 py-1">グラフ表示中: 「{selection.name}」</span>
          <button type="button" onClick={() => setSelection({ level: 'all' })} className="text-gray-400 underline">
            全体に戻す
          </button>
        </div>
      )}

      {/* タブ（詳細＞で下位タブが増える） */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2">
        {tabs.map((tab) => {
          const Icon = KIND_ICON[tab.kind] || LayoutGrid;
          const isActive = activeTab.id === tab.id;
          return (
            <div key={tab.id} className="flex items-center">
              <button
                type="button"
                onClick={() => activateTab(tab.id)}
                className={`flex h-9 items-center gap-1.5 rounded-t-lg px-4 text-xs font-black transition ${
                  isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-blue-50'
                }`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
              {tab.closable && (
                <button
                  type="button"
                  onClick={() => closeTab(tab.id)}
                  className="ml-0.5 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="タブを閉じる"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-gray-400">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">税込</span>
          行をクリックでグラフに反映（再クリックで解除）
          {canDrill && '／「詳細＞」で1つ下の階層を新しいタブで開く'}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {activeList.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyList label={viewMode === 'ec' ? 'この期間のEC売上はありません' : 'データがありません'} />
            </div>
          ) : (
            activeList.map((entry) => (
              <SalesRow
                key={entry.id}
                entry={entry}
                active={selection.level === activeTab.kind && String(selection.id) === String(entry.id)}
                onSelect={() => selectRow(entry)}
                onDrill={canDrill ? () => drillRow(entry) : undefined}
              />
            ))
          )}
        </div>
      </div>

      <div className="mt-6">
        {/* 売上推移の上に構成比の100%分割バー。選択が無い時のみ表示、全階層で同じ挙動。 */}
        {selection.level === 'all' && (
          <CompositionBar items={activeList} title={`${activeTab.label} 売上割合`} />
        )}
        <AnalyticsChartSection
          chartData={analytics.chartData}
          isDayOfWeekMode={isDayOfWeekMode}
          chartMetric={chartMetric || 'sales'}
          categories={[]}
        />
      </div>

      {/* アイテム別 ABC 分析 */}
      <div className="print:break-inside-avoid mt-2">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
          ABC分析（アイテム別）
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">税込</span>
        </div>
        <AbcAnalysisView
          abcAnalysis={analytics.abcAnalysis}
          abcThresholds={abcThresholds}
          setAbcThresholds={setAbcThresholds}
          showSettings={false}
        />
      </div>
    </div>
  );
};

export default PosAnalyticsView;
