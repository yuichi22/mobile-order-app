import React from 'react';
import { ReceiptText, TrendingUp, Users, UserRoundCheck } from 'lucide-react';

const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString()}`;

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

const AnalyticsSummaryCards = ({
  totalSales = 0,
  totalOrders = 0,
  customerCount = 0,
  averageSpendPerCustomer = 0,
  averageSpendPerTransaction = 0,
  averagePartySize = 0,
  activeMetric = 'sales',
  onMetricChange
}) => (
  <div className="mb-8 grid gap-3 md:grid-cols-5">
    <SummaryCard
      active={activeMetric === 'sales'}
      accent
      icon={TrendingUp}
      label="売上合計"
      value={formatCurrency(totalSales)}
      onClick={() => onMetricChange?.('sales')}
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
      onClick={() => onMetricChange?.('customerUnitPrice')}
    />

    <SummaryCard
      active={activeMetric === 'transactionUnitPrice'}
      icon={ReceiptText}
      label="組単価"
      value={formatCurrency(averageSpendPerTransaction)}
      subText={`会計 ${Number(totalOrders || 0).toLocaleString()} 件`}
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

export default AnalyticsSummaryCards;