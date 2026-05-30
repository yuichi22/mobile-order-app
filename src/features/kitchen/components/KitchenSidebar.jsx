import React, { useMemo, useState } from 'react';
import { getTableDisplayName, getTableDisplayLabel } from '../../../shared/utils/tableDisplay';
import {
  Ban,
  Bell,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ReceiptText,
  RotateCcw,
  X
} from 'lucide-react';

const normalizeTableId = (item) => getTableDisplayName(item);

const CompactRequestSection = ({
  title,
  items = [],
  icon,
  accentClassName,
  emptyLabel,
  expanded,
  onToggle,
  onComplete,
  tone = 'default'
}) => {

const toneClassName = tone === 'call'
  ? 'border-orange-300/60 bg-orange-500 text-white shadow-lg shadow-orange-950/30 ring-orange-300/40'
  : tone === 'check'
    ? 'border-emerald-300/60 bg-emerald-500 text-white shadow-lg shadow-emerald-950/30 ring-emerald-300/40'
    : 'border-slate-700 bg-slate-900/75 text-slate-100 ring-slate-700/70';

const childRowClassName = tone === 'call'
  ? 'bg-orange-600/70 text-white'
  : tone === 'check'
    ? 'bg-emerald-600/70 text-white'
    : 'bg-slate-950/60 text-slate-100';

const headerHoverClassName = tone === 'call'
  ? 'hover:bg-orange-600/40'
  : tone === 'check'
    ? 'hover:bg-emerald-600/40'
    : 'hover:bg-slate-800/80';

const subTextClassName = tone === 'default'
  ? 'text-slate-400'
  : 'text-white/80';

const expandIconClassName = tone === 'default'
  ? 'text-slate-400'
  : 'text-white/80';


  const count = items.length;
  const firstItem = items[0];

  if (count === 0) {
    return (
      <div className="rounded-2xl bg-slate-900/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon}
            <span className="truncate text-sm font-black text-slate-500">
              {emptyLabel}
            </span>
          </div>

          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-black text-slate-500">
            0
          </span>
        </div>
      </div>
    );
  }

  const shouldExpand = count >= 2;

  return (
    <div className={`overflow-hidden rounded-2xl border ring-1 ${toneClassName}`}>
      <div
        role={shouldExpand ? 'button' : undefined}
        tabIndex={shouldExpand ? 0 : undefined}
        onClick={shouldExpand ? onToggle : undefined}
        onKeyDown={(event) => {
          if (!shouldExpand) return;

          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle?.();
          }
        }}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
          shouldExpand
            ? `cursor-pointer ${headerHoverClassName}`
            : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}

          <div className="min-w-0">
            <div className={`truncate text-sm font-black ${accentClassName}`}>
              {title}
            </div>

            <div className={`mt-0.5 truncate text-xs font-bold ${subTextClassName}`}>
              {count === 1
                ? getTableDisplayLabel(firstItem)
                : `${count}件あります`}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-black tabular-nums text-white">
            {count}
          </span>

          {count === 1 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onComplete(firstItem.id);
              }}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-black text-slate-900 transition-colors hover:bg-slate-100"
            >
              完了
            </button>
          ) : (
            <span className={expandIconClassName}>
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </span>
          )}
        </div>
      </div>

      {expanded && shouldExpand && (
        <div className="space-y-1 border-t border-slate-700/70 px-2.5 py-2.5">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${childRowClassName}`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-100">
                  {getTableDisplayLabel(item)}
                </div>

                {item.createdAt?.toDate && (
                  <div className="mt-0.5 text-xs font-bold text-slate-500">
                    {item.createdAt.toDate().toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onComplete(item.id)}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-slate-900 transition-colors hover:bg-slate-100"
              >
                完了
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );};

const KitchenSidebar = ({
  calls = [],
  checks = [],
  soldOutItems = [],
  pendingItemSummary = [],
  summaryMode = 'all',
  selectedOrderCount = 0,
  completedReadyCount = 0,
  onSummaryModeChange,
  onClearSelectedOrders,
  onMarkSelectedOrdersReady,
  onMarkSummaryItemReady,
  onClearCompletedOrders,
  onComplete,
  onRestore
}) => {
  const [expandedRequestType, setExpandedRequestType] = useState(null);

  const cookingCategorySummary = Array.isArray(pendingItemSummary?.cookingCategorySummary)
    ? pendingItemSummary.cookingCategorySummary
    : [];

  const itemSummary = Array.isArray(pendingItemSummary?.itemSummary)
    ? pendingItemSummary.itemSummary
    : Array.isArray(pendingItemSummary)
      ? pendingItemSummary
      : [];

  const hasPendingSummaryItems = itemSummary.length > 0 || cookingCategorySummary.length > 0;

  const summaryTotal = useMemo(() => (
    itemSummary.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  ), [itemSummary]);

  const isSelectionMode = summaryMode === 'selected';
  const hasSelectedOrders = selectedOrderCount > 0;

  return (
    <div className="z-10 flex w-[380px] shrink-0 flex-col border-l border-slate-700 bg-slate-800 shadow-2xl">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(calls.length > 0 || checks.length > 0) && (
          <div className="shrink-0 space-y-2 border-b border-slate-700 bg-slate-950/80 p-3 animate-in slide-in-from-top-3 fade-in duration-300">
            {calls.length > 0 && (
              <CompactRequestSection
                title="スタッフ呼び出し"
                emptyLabel="呼び出しなし"
                items={calls}
                icon={<Bell size={17} className="text-white" />}
                accentClassName="text-white"
                tone="call"
                expanded={expandedRequestType === 'calls'}
                onToggle={() => setExpandedRequestType((current) => (
                  current === 'calls' ? null : 'calls'
                ))}
                onComplete={onComplete}
              />
            )}

            {checks.length > 0 && (
              <CompactRequestSection
                title="会計依頼"
                emptyLabel="会計依頼なし"
                items={checks}
                icon={<ReceiptText size={17} className="text-white" />}
                accentClassName="text-white"
                tone="check"
                expanded={expandedRequestType === 'checks'}
                onToggle={() => setExpandedRequestType((current) => (
                  current === 'checks' ? null : 'checks'
                ))}
                onComplete={onComplete}
              />
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-900/70">
          <div className="shrink-0 border-b border-slate-700 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  <ClipboardList size={14} />
                  Pending
                </div>

                <h2 className="mt-1 text-base font-black text-slate-100">
                  未完了商品の合計
                </h2>
              </div>

              <div className="shrink-0 rounded-2xl bg-slate-800 px-4 py-2.5 text-right">
                <div className="text-2xl font-black leading-none tabular-nums text-white">
                  {summaryTotal}
                </div>
                <div className="mt-0.5 text-[10px] font-black text-slate-500">
                  点
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => onSummaryModeChange?.('all')}
                className={`rounded-xl py-2.5 text-sm font-black transition-all ${
                  summaryMode === 'all'
                    ? 'bg-green-600 text-white shadow-sm ring-1 ring-green-400/60'
                    : 'text-slate-400 hover:bg-slate-700'
                }`}
              >
                全体
              </button>

              <button
                type="button"
                onClick={() => onSummaryModeChange?.('selected')}
                className={`rounded-xl py-2.5 text-sm font-black transition-all ${
                summaryMode === 'selected'
                  ? 'bg-green-600 text-white shadow-sm ring-1 ring-green-400/60'
                  : 'text-slate-400 hover:bg-slate-700'
                }`}
              >
                選択
              </button>
            </div>

            {completedReadyCount > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onClearCompletedOrders}
                  disabled={completedReadyCount === 0}
                  className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3.5 text-sm font-black shadow-sm transition-all active:scale-[0.98] ${
                    completedReadyCount > 0
                      ? 'border-blue-300 bg-white text-blue-700 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-800'
                      : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 shadow-none'
                  }`}
                >
                  <CheckCircle size={18} strokeWidth={2.8} />
                  伝票を一括整理
                </button>
              </div>
            )}


            {isSelectionMode && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="min-w-0 text-xs font-bold text-slate-500">
                  伝票ヘッダーをタップして集計します
                  {hasSelectedOrders ? `（${selectedOrderCount}件選択中）` : ''}
                </p>

                {hasSelectedOrders && (
                  <button
                    type="button"
                    onClick={onClearSelectedOrders}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-black text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                  >
                    <X size={13} />
                    クリア
                  </button>
                )}
              </div>
            )}


            {isSelectionMode && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onMarkSelectedOrdersReady}
                  disabled={!hasSelectedOrders}
                  className={`flex h-12 w-full items-center justify-center rounded-2xl text-sm font-black shadow-lg transition-all active:scale-[0.98] ${
                    hasSelectedOrders
                      ? 'bg-emerald-500 text-white shadow-emerald-950/20 hover:bg-emerald-600'
                      : 'cursor-not-allowed bg-slate-800 text-slate-600 shadow-none'
                  }`}
                >
                  選択中を提供待ちにする
                </button>
              </div>
            )}

          </div>

          <div className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {isSelectionMode && !hasSelectedOrders ? (
              <div className="rounded-2xl border border-dashed border-slate-700 py-8 text-center text-sm font-bold text-slate-500">
                集計したい伝票のヘッダーをタップしてください
              </div>
            ) : !hasPendingSummaryItems ? (
              <div className="rounded-2xl border border-dashed border-slate-700 py-8 text-center text-sm font-bold text-slate-500">
                未完了商品はありません
              </div>
            ) : (
              <>
                {cookingCategorySummary.length > 0 && (
                  <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-3">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      調理分類別
                    </div>

                    <div className="space-y-1.5">
                      {cookingCategorySummary.map((item) => (
                        <div
                          key={item.id || item.name}
                          className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-900/70 px-4 py-3 text-left"
                        >
                          <span className="min-w-0 truncate text-sm font-black text-slate-100">
                            {item.name}
                          </span>

                          <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl bg-white px-2 text-sm font-black tabular-nums text-slate-900 shadow-sm">
                            {Number(item.quantity || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {itemSummary.length > 0 && (
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-3">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      商品別
                    </div>

                    <div className="space-y-1.5">
                          {itemSummary.map((item) => (
                            <div
                              key={item.id || item.name}
                              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm"
                            >
                              <button
                                type="button"
                                onClick={() => onMarkSummaryItemReady?.(item)}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-emerald-200 bg-emerald-50 text-emerald-600 transition-all hover:border-emerald-500 hover:bg-emerald-500 hover:text-white active:scale-95"
                                title={`${item.name}を提供待ちにする`}
                              >
                                <CheckCircle size={18} strokeWidth={2.8} />
                              </button>

                              <span className="min-w-0 flex-1 truncate text-base font-black text-slate-900">
                                {item.name}
                              </span>

                              <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 px-2 text-base font-black tabular-nums text-white shadow-sm">
                                {Number(item.quantity || 0)}
                              </span>
                            </div>
                          ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {soldOutItems.length > 0 && (
          <div className="shrink-0 border-t border-slate-700 bg-red-950/30 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-black text-red-300">
                <Ban size={15} />
                売り切れ
              </div>

              <span className="rounded-full bg-red-900/60 px-2.5 py-0.5 text-xs font-black text-red-100">
                {soldOutItems.length}
              </span>
            </div>

            <div className="custom-scrollbar flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {soldOutItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onRestore(item.id)}
                  className="flex items-center gap-1 rounded-lg border border-red-800 bg-red-900/50 px-3 py-1.5 text-xs font-bold text-red-100 transition-all hover:border-green-600 hover:bg-green-600"
                >
                  <span className="max-w-[170px] truncate">
                    {item.name}
                  </span>
                  <RotateCcw size={12} className="opacity-60" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KitchenSidebar;