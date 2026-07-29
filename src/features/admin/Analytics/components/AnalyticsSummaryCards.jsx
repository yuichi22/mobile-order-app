import React, { useState } from 'react';
import { ReceiptText, TrendingUp, Users, UserRoundCheck } from 'lucide-react';

const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString()}`;

// 売上の税込/税抜表示は端末に記憶する（日計・POS分析と同じ運用）。
const AMOUNT_MODE_KEY = 'analyticsAmountDisplayMode';
const getInitialTaxMode = () => {
  try {
    return window.localStorage.getItem(AMOUNT_MODE_KEY) === 'tax_excluded' ? 'tax_excluded' : 'tax_included';
  } catch {
    return 'tax_included';
  }
};

// 売上合計カード（税込/税抜トグル付き）。カード全体でグラフ指標をsalesに切替、トグルは税表示のみ。
const SalesSummaryCard = ({ active, salesIncl, salesExcl, totalTax, cancelReturn = 0, taxMode, onTaxModeChange, onClick }) => {
  const isExcl = taxMode === 'tax_excluded';
  const label = isExcl ? '税抜' : '税込';
  const main = isExcl ? salesExcl : salesIncl;
  const sub = isExcl ? salesIncl : salesExcl;
  return (
    <div
      className={`rounded-2xl p-4 text-left transition-all print:border print:border-gray-300 ${
        active ? 'bg-orange-500 text-white shadow-lg shadow-orange-100' : 'bg-orange-50 text-gray-900'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-2 text-xs font-black ${active ? 'text-white/90' : 'text-orange-500'}`}>
          <TrendingUp size={15} />
          売上合計 {label}
        </div>
        <div className="flex rounded-full bg-white p-0.5 text-[10px] font-black shadow-sm">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onTaxModeChange('tax_excluded'); }}
            className={`rounded-full px-2 py-0.5 transition-colors ${isExcl ? 'bg-orange-500 text-white' : 'text-orange-500'}`}
          >
            税抜
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onTaxModeChange('tax_included'); }}
            className={`rounded-full px-2 py-0.5 transition-colors ${!isExcl ? 'bg-orange-500 text-white' : 'text-orange-500'}`}
          >
            税込
          </button>
        </div>
      </div>
      <button type="button" onClick={onClick} className="mt-2 block w-full text-left text-2xl font-black active:scale-[0.99]">
        {formatCurrency(main)}
      </button>
      <div className={`mt-1 text-[11px] font-bold ${active ? 'text-white/70' : 'text-gray-400'}`}>
        {isExcl ? '税込' : '税抜'} {formatCurrency(sub)}
        <span className="mx-1 opacity-50">/</span>
        内税 {formatCurrency(totalTax)}
      </div>
      {cancelReturn < 0 && (
        <div className={`mt-1 text-[11px] font-bold ${active ? 'text-white/80' : 'text-gray-500'}`}>
          取消・返品 {formatCurrency(cancelReturn)}
          <span className="mx-1 opacity-50">/</span>
          純売上(税込) {formatCurrency(salesIncl + cancelReturn)}
        </div>
      )}
    </div>
  );
};

const SummaryCard = ({
  active,
  icon: Icon,
  label,
  value,
  suffix,
  subText,
  accent = false,
  onClick
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-2xl p-4 text-left transition-all active:scale-[0.99] print:border print:border-gray-300 ${
      active
        ? 'bg-orange-500 text-white shadow-lg shadow-orange-100'
        : accent
          ? 'bg-orange-50 text-gray-900 hover:bg-orange-100'
          : 'bg-gray-50 text-gray-900 hover:bg-orange-50'
    }`}
  >
    <div className={`flex items-center gap-2 text-xs font-black ${
      active
        ? 'text-white/90'
        : accent
          ? 'text-orange-500'
          : 'text-gray-400'
    }`}
    >
      <Icon size={15} />
      {label}
    </div>

    <div className="mt-2 text-2xl font-black">
      {value}
      {suffix && (
        <span className={`ml-1 text-sm font-bold ${active ? 'text-white/80' : 'text-gray-400'}`}>
          {suffix}
        </span>
      )}
    </div>

    {subText && (
      <div className={`mt-1 text-[11px] font-bold ${active ? 'text-white/70' : 'text-gray-400'}`}>
        {subText}
      </div>
    )}
  </button>
);

const TimePeriodFilterCard = ({
  selectedPeriodId = 'all',
  periodOptions = [],
  onSelectedPeriodChange
}) => (
  <div className="rounded-2xl bg-gray-50 p-4 text-left print:border print:border-gray-300">
    <div className="flex items-center gap-2 text-xs font-black text-gray-400">
      <ReceiptText size={15} />
      時間帯
    </div>

    <select
      value={selectedPeriodId}
      onChange={(event) => onSelectedPeriodChange?.(event.target.value)}
      className="mt-2 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-black text-gray-900 outline-none transition-colors focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
    >
      <option value="all">全時間帯</option>
      {periodOptions.map((periodOption) => (
        <option key={periodOption.id} value={periodOption.id}>
          {periodOption.label}
        </option>
      ))}
    </select>

    <div className="mt-1 text-[11px] font-bold text-gray-400">
      注文時刻ベースで絞り込み
    </div>
  </div>
);

const AnalyticsSummaryCards = ({
  totalSales = 0,
  totalSalesTaxExcluded = 0,
  totalTaxAmount = 0,
  cancelReturnTotal = 0,
  totalOrders = 0,
  customerCount = 0,
  averageSpendPerCustomer = 0,
  averageSpendPerTransaction = 0,
  averagePartySize = 0,
  activeMetric = 'sales',
  onMetricChange,
  selectedPeriodId = 'all',
  periodOptions = [],
  onSelectedPeriodChange
}) => {
  const [taxMode, setTaxMode] = useState(getInitialTaxMode);
  const updateTaxMode = (mode) => {
    const next = mode === 'tax_excluded' ? 'tax_excluded' : 'tax_included';
    setTaxMode(next);
    try { window.localStorage.setItem(AMOUNT_MODE_KEY, next); } catch { /* 記憶不可の環境は無視 */ }
  };

  return (
  <div className="mb-8 grid gap-3 md:grid-cols-6">
    <SalesSummaryCard
      active={activeMetric === 'sales'}
      salesIncl={totalSales}
      salesExcl={totalSalesTaxExcluded}
      totalTax={totalTaxAmount}
      cancelReturn={cancelReturnTotal}
      taxMode={taxMode}
      onTaxModeChange={updateTaxMode}
      onClick={() => onMetricChange?.('sales')}
    />

    <TimePeriodFilterCard
      selectedPeriodId={selectedPeriodId}
      periodOptions={periodOptions}
      onSelectedPeriodChange={onSelectedPeriodChange}
    />

    <SummaryCard
      active={activeMetric === 'customers'}
      icon={Users}
      label="来客数"
      value={Number(customerCount || 0).toLocaleString()}
      suffix="名"
      onClick={() => onMetricChange?.('customers')}
    />

    <SummaryCard
      active={activeMetric === 'customerUnitPrice'}
      icon={UserRoundCheck}
      label="客単価"
      value={formatCurrency(averageSpendPerCustomer)}
      subText="税込"
      onClick={() => onMetricChange?.('customerUnitPrice')}
    />

    <SummaryCard
      active={activeMetric === 'transactionUnitPrice'}
      icon={ReceiptText}
      label="組単価"
      value={formatCurrency(averageSpendPerTransaction)}
      subText={`税込 ・ 会計 ${Number(totalOrders || 0).toLocaleString()} 件`}
      onClick={() => onMetricChange?.('transactionUnitPrice')}
    />

    <SummaryCard
      active={activeMetric === 'averagePartySize'}
      icon={Users}
      label="1組平均人数"
      value={Number(averagePartySize || 0).toLocaleString()}
      suffix="名"
      onClick={() => onMetricChange?.('averagePartySize')}
    />
  </div>
  );
};

export default AnalyticsSummaryCards;