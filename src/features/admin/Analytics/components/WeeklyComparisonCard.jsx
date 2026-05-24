import React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock } from 'lucide-react';

const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString()}`;

const formatRate = (rate) => {
  if (rate === null || rate === undefined || Number.isNaN(Number(rate))) {
    return '-';
  }

  return `${Number(rate).toLocaleString()}%`;
};

const WeeklyComparisonCard = ({ comparison }) => {
  if (!comparison) return null;

  const difference = Number(comparison.difference || 0);
  const isPositive = difference > 0;
  const isNegative = difference < 0;

  const DifferenceIcon = isPositive
    ? ArrowUpRight
    : isNegative
      ? ArrowDownRight
      : ArrowRight;

  const differenceText = `${isPositive ? '+' : ''}${formatCurrency(difference)}`;

  return (
    <div className="mb-8 rounded-2xl border border-orange-100 bg-orange-50/40 p-4 print:border-gray-300">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-orange-500">
            <CalendarClock size={15} />
            前年同週比較
          </div>
          <p className="mt-1 text-xs font-bold text-gray-400">
            最新の締め済み日を基準に、直近7日間と52週前の同じ曜日並びを比較します。
          </p>
        </div>

        <div className="rounded-full bg-white px-4 py-2 text-xs font-black text-gray-500 shadow-sm">
          直近7日間 vs 前年同週
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs font-black text-gray-400">直近7日間</div>
          <div className="mt-1 text-[11px] font-bold text-gray-400">
            {comparison.currentRangeLabel}
          </div>
          <div className="mt-2 text-2xl font-black text-gray-900">
            {formatCurrency(comparison.currentSales)}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs font-black text-gray-400">前年同週</div>
          <div className="mt-1 text-[11px] font-bold text-gray-400">
            {comparison.previousRangeLabel}
          </div>
          <div className="mt-2 text-2xl font-black text-gray-900">
            {formatCurrency(comparison.previousSales)}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs font-black text-gray-400">前年差</div>
          <div className={`mt-2 flex items-center gap-1 text-2xl font-black ${
            isPositive
              ? 'text-orange-600'
              : isNegative
                ? 'text-blue-600'
                : 'text-gray-900'
          }`}
          >
            <DifferenceIcon size={22} strokeWidth={3} />
            {differenceText}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs font-black text-gray-400">前年比</div>
          <div className={`mt-2 text-2xl font-black ${
            isPositive
              ? 'text-orange-600'
              : isNegative
                ? 'text-blue-600'
                : 'text-gray-900'
          }`}
          >
            {formatRate(comparison.rate)}
          </div>
          <div className="mt-1 text-[11px] font-bold text-gray-400">
            前年売上が0円の場合は算出なし
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-white/70 px-4 py-3 text-xs font-bold text-gray-500">
          来客数：{Number(comparison.currentCustomers || 0).toLocaleString()}名
          <span className="mx-2 text-gray-300">/</span>
          前年 {Number(comparison.previousCustomers || 0).toLocaleString()}名
        </div>

        <div className="rounded-xl bg-white/70 px-4 py-3 text-xs font-bold text-gray-500">
          客単価：{formatCurrency(comparison.currentCustomerUnitPrice)}
          <span className="mx-2 text-gray-300">/</span>
          前年 {formatCurrency(comparison.previousCustomerUnitPrice)}
        </div>

        <div className="rounded-xl bg-white/70 px-4 py-3 text-xs font-bold text-gray-500">
          会計件数：{Number(comparison.currentTransactions || 0).toLocaleString()}件
          <span className="mx-2 text-gray-300">/</span>
          前年 {Number(comparison.previousTransactions || 0).toLocaleString()}件
        </div>
      </div>
    </div>
  );
};

export default WeeklyComparisonCard;