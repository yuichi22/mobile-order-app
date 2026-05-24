import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Store, X } from 'lucide-react';

import FloorMapCanvas from '../../../shared/components/floor-map/FloorMapCanvas';

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

const resolveTableLabel = (item) => (
  item.displayName || item.tableName || item.name || item.label || item.id
);

const normalizeTables = (layoutItems = []) => (
  layoutItems
    .filter((item) => item?.type === 'table')
    .map((item) => ({
      id: String(item.label || item.id),
      name: resolveTableLabel(item),
      seats: item.seats || 0,
      raw: item
    }))
    .filter((item) => item.id)
);

const TableMenuOverrideModal = ({
  open,
  periods = [],
  layoutItems = [],
  activeSessions = [],
  onClose,
  onApply,
  processing = false
}) => {
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [step, setStep] = useState('period');

  const resetFlow = () => {
    setSelectedPeriodId('');
    setDurationMinutes(30);
    setStep('period');
  };

  const handleClose = () => {
    resetFlow();
    onClose?.();
  };

  useEffect(() => {
    if (!open) {
      resetFlow();
    }
  }, [open]);

  const tables = useMemo(() => normalizeTables(layoutItems), [layoutItems]);
  const selectedPeriod = periods.find((period) => String(period.id) === String(selectedPeriodId));

  if (!open) return null;

  const handleSelectPeriod = (periodId) => {
    setSelectedPeriodId(String(periodId));
    setStep('table');
  };

  const handleApply = async (table) => {
    if (!selectedPeriod) return;

    await onApply?.({
      tableId: table.id,
      tableName: table.name,
      periodId: selectedPeriod.id,
      periodName: selectedPeriod.name || selectedPeriod.label || selectedPeriod.id,
      durationMinutes
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-orange-50 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-100">
              <Clock size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900">
                時間帯メニュー変更
              </h3>
              <p className="mt-1 text-xs font-bold text-gray-500">
                指定したテーブルだけ、一時的に時間帯メニューを表示します。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-2xl bg-white p-2 text-gray-400 shadow-sm transition-colors hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStep('period')}
              className={`rounded-2xl px-4 py-3 text-left transition-all ${
                step === 'period'
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-100'
                  : 'bg-gray-50 text-gray-500'
              }`}
            >
              <div className="text-sm font-black">1. 時間帯を選択</div>
              <div className={`mt-1 text-xs font-bold ${step === 'period' ? 'text-orange-100' : 'text-gray-400'}`}>
                表示するメニューを選びます
              </div>
            </button>

            <button
              type="button"
              disabled={!selectedPeriodId}
              onClick={() => selectedPeriodId && setStep('table')}
              className={`rounded-2xl px-4 py-3 text-left transition-all disabled:opacity-40 ${
                step === 'table'
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-100'
                  : 'bg-gray-50 text-gray-500'
              }`}
            >
              <div className="text-sm font-black">2. テーブルを選択</div>
              <div className={`mt-1 text-xs font-bold ${step === 'table' ? 'text-orange-100' : 'text-gray-400'}`}>
                対象テーブルに適用します
              </div>
            </button>
          </div>

          {step === 'period' && (
            <div className="space-y-5">
              <section>
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-800">
                  <Store size={17} className="text-orange-500" />
                  時間帯メニュー
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {periods.map((period) => (
                    <button
                      key={period.id}
                      type="button"
                      onClick={() => handleSelectPeriod(period.id)}
                      className="rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:border-orange-200 hover:bg-orange-50"
                    >
                      <div className="text-base font-black text-gray-900">
                        {period.name || period.label || period.id}
                      </div>
                      <div className="mt-1 text-xs font-bold text-gray-400">
                        {period.start}〜{period.end}
                      </div>
                    </button>
                  ))}
                </div>

                {periods.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-bold text-gray-400">
                    時間帯メニューが登録されていません。
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 text-sm font-black text-gray-800">
                  表示時間
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {DURATION_OPTIONS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setDurationMinutes(minutes)}
                      className={`h-12 rounded-2xl text-sm font-black transition-all ${
                        durationMinutes === minutes
                          ? 'bg-orange-500 text-white shadow-lg shadow-orange-100'
                          : 'bg-gray-50 text-gray-500 hover:bg-orange-50 hover:text-orange-600'
                      }`}
                    >
                      {minutes}分
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}

          {step === 'table' && (
            <div>
              <div className="mb-4 rounded-2xl border border-orange-100 bg-orange-50 p-4">
                <div className="text-sm font-black text-orange-900">
                  {selectedPeriod?.name || selectedPeriod?.label || selectedPeriod?.id} を {durationMinutes}分表示
                </div>
                <div className="mt-1 text-xs font-bold text-orange-700/70">
                  利用中のテーブルは色付きで表示されます。適用するテーブルを選択してください。
                </div>
              </div>

              {tables.length > 0 ? (
                <div className="h-[420px] overflow-hidden rounded-3xl border border-gray-100 bg-slate-100 shadow-inner">
                  <FloorMapCanvas
                    mode="view"
                    items={layoutItems}
                    sessions={activeSessions}
                    orders={[]}
                    calls={[]}
                    checks={[]}
                    width={760}
                    height={420}
                    darkTheme={false}
                    onTableSelect={(tableId) => {
                      const selectedTable = tables.find((table) => String(table.id) === String(tableId));
                      if (!selectedTable || processing) return;
                      handleApply(selectedTable);
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-bold text-gray-400">
                  テーブルが登録されていません。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TableMenuOverrideModal;
