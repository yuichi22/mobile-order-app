import React, { useMemo } from 'react';
import { BarChart2 } from 'lucide-react';

const METRIC_CONFIG = {
  sales: {
    title: '売上推移',
    format: (value) => `¥${Number(value || 0).toLocaleString()}`,
    useStacks: true
  },
  customers: {
    title: '来客数推移',
    format: (value) => `${Number(value || 0).toLocaleString()}名`,
    useStacks: false
  },
  customerUnitPrice: {
    title: '客単価推移',
    format: (value) => `¥${Number(value || 0).toLocaleString()}`,
    useStacks: false
  },
  transactionUnitPrice: {
    title: '組単価推移',
    format: (value) => `¥${Number(value || 0).toLocaleString()}`,
    useStacks: false
  },
  averagePartySize: {
    title: '1組平均人数推移',
    format: (value) => `${Number(value || 0).toLocaleString()}名`,
    useStacks: false
  }
};

const buildYAxisTicks = (maxValue) => {
  const rawMax = Number(maxValue || 0);

  if (rawMax <= 0) {
    return [100, 80, 60, 40, 20, 0];
  }

  const targetStep = rawMax / 5;
  const powerOf10 = Math.pow(10, Math.floor(Math.log10(targetStep)));
  const normalized = targetStep / powerOf10;

  let scale = 1;
  if (normalized < 1.5) scale = 1;
  else if (normalized < 3.5) scale = 2;
  else scale = 5;

  const step = Math.max(scale * powerOf10, 1);
  const finalMax = Math.ceil(rawMax / step) * step;

  const ticks = [];
  for (let value = finalMax; value >= 0; value -= step) {
    ticks.push(value);
    if (ticks.length >= 8) break;
  }

  if (ticks[ticks.length - 1] !== 0) ticks.push(0);

  return ticks;
};

const AnalyticsChartSection = ({
  chartData = [],
  categories = [],
  isDayOfWeekMode,
  chartMetric = 'sales'
}) => {
  const safeChartData = Array.isArray(chartData) ? chartData : [];
  const config = METRIC_CONFIG[chartMetric] || METRIC_CONFIG.sales;

  const metricValues = useMemo(
    () => safeChartData.map((point) => Number(point.metrics?.[chartMetric] ?? point.value ?? 0)),
    [safeChartData, chartMetric]
  );

  const maxMetricValue = Math.max(...metricValues, 0);
  const yAxisTicks = useMemo(() => buildYAxisTicks(maxMetricValue), [maxMetricValue]);
  const chartMaxValue = yAxisTicks[0] || 100;
  const columnCount = Math.max(safeChartData.length, 1);

  return (
    <div className="print:break-inside-avoid mb-8">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-gray-800">
        <BarChart2 size={20} />
        {isDayOfWeekMode ? '曜日別' : config.title}
      </h3>

      <div className="flex h-80 rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="relative mt-8 mr-2 h-[80%] w-16 shrink-0 border-r border-gray-200 pr-2 font-mono text-xs text-gray-400">
          {yAxisTicks.map((tick, index) => (
            tick !== 0 && (
              <span
                key={`${tick}-${index}`}
                className="absolute right-2 -translate-y-1/2 transform"
                style={{ top: `${(index / Math.max(yAxisTicks.length - 1, 1)) * 100}%` }}
              >
                {config.format(tick)}
              </span>
            )
          ))}
          <span className="absolute right-2 bottom-0 translate-y-1/2 transform">
            0
          </span>
        </div>

        <div className="relative min-w-0 flex-grow overflow-hidden">
          <div className="absolute inset-x-0 top-8 h-[80%]">
            <div
              className="grid h-full w-full items-end gap-1"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`
              }}
            >
              {safeChartData.map((dataPoint, index) => {
                const metricValue = Number(dataPoint.metrics?.[chartMetric] ?? dataPoint.value ?? 0);
                const totalHeightPercent = chartMaxValue > 0
                  ? (metricValue / chartMaxValue) * 100
                  : 0;

                return (
                  <div
                    key={`${dataPoint.label}-${index}`}
                    className="group relative flex h-full min-w-0 items-end justify-center"
                  >
                    <div
                      className="absolute z-20 flex -translate-y-2 flex-col items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      style={{
                        bottom: `${totalHeightPercent}%`
                      }}
                    >
                      <div className="whitespace-nowrap rounded-md bg-gray-800 px-2 py-1 text-[10px] font-bold text-white shadow-lg">
                        {config.format(metricValue)}
                      </div>
                      <div className="h-0 w-0 border-l-[4px] border-r-[4px] border-t-[4px] border-l-transparent border-r-transparent border-t-gray-800" />
                    </div>

                    {config.useStacks ? (
                      <div
                        className="relative flex w-full max-w-[28px] flex-col-reverse overflow-hidden rounded-t-md bg-gray-200"
                        style={{
                          height: `${Math.max(totalHeightPercent, metricValue > 0 ? 2 : 0)}%`
                        }}
                      >
                        {(dataPoint.stacks || []).map((stack, stackIndex) => (
                          <div
                            key={`${stack.name}-${stackIndex}`}
                            style={{
                              height: `${Number(dataPoint.value || 0) > 0 ? (stack.value / dataPoint.value) * 100 : 0}%`,
                              width: '100%',
                              backgroundColor: stack.color
                            }}
                            className="transition-opacity duration-200 hover:opacity-80"
                            title={`${stack.name}: ¥${Number(stack.value || 0).toLocaleString()}`}
                          />
                        ))}
                      </div>
                    ) : (
                      <div
                        className="w-full max-w-[28px] rounded-t-md bg-orange-500"
                        style={{
                          height: `${Math.max(totalHeightPercent, metricValue > 0 ? 2 : 0)}%`
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="absolute inset-x-0 bottom-0 grid h-[12%] items-center gap-1"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`
            }}
          >
            {safeChartData.map((dataPoint, index) => (
              <div
                key={`${dataPoint.label}-label-${index}`}
                className="flex min-w-0 items-center justify-center"
              >
                <span className="w-full truncate px-0.5 text-center text-[10px] font-black text-gray-500">
                  {dataPoint.showLabel === false ? '' : dataPoint.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {config.useStacks && (
        <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs font-bold text-gray-500">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-1">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: category.hex || '#ccc' }}
              />
              <span>{category.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnalyticsChartSection;