import React from 'react';

const formatCurrency = (value) => `¥${(Number(value) || 0).toLocaleString()}`;

const RANK_META = {
  A: {
    title: '主力商品',
    summary: '売上を維持しながら、いちばん強く伸ばしたい商品です。',
    action: '維持',
    cardClassName: 'bg-amber-100 border-amber-200 text-amber-800',
    badgeClassName: 'bg-amber-500',
    chipClassName: 'bg-amber-100 text-amber-800',
    barClassName: 'bg-amber-500'
  },
  B: {
    title: '育成候補',
    summary: '販促や導線改善で、次の主力に育てたい商品です。',
    action: '強化',
    cardClassName: 'bg-blue-50 border-blue-200 text-blue-800',
    badgeClassName: 'bg-blue-500',
    chipClassName: 'bg-blue-100 text-blue-800',
    barClassName: 'bg-blue-500'
  },
  C: {
    title: '見直し候補',
    summary: '価格や見せ方、内容の見直し候補として確認したい商品です。',
    action: '見直し',
    cardClassName: 'bg-gray-50 border-gray-200 text-gray-600',
    badgeClassName: 'bg-gray-400',
    chipClassName: 'bg-gray-100 text-gray-600',
    barClassName: 'bg-gray-400'
  }
};

const AbcAnalysisView = ({
  abcAnalysis,
  abcThresholds,
  setAbcThresholds,
  showSettings
}) => {
  const items = abcAnalysis?.items || [];
  const summary = abcAnalysis?.summary || {};
  const abcTotalSales = abcAnalysis?.totalSales || 0;

  const settingCards = [
    {
      key: 'A',
      title: 'Aランク',
      value: `上位 ${abcThresholds.a}% まで`,
      sub: `${summary.A?.items?.length || 0}商品`,
      className: 'border-amber-200 bg-amber-50 text-amber-800'
    },
    {
      key: 'B',
      title: 'Bランク',
      value: `${abcThresholds.a}% 〜 ${abcThresholds.b}%`,
      sub: `${summary.B?.items?.length || 0}商品`,
      className: 'border-blue-200 bg-blue-50 text-blue-800'
    },
    {
      key: 'C',
      title: 'Cランク',
      value: `${abcThresholds.b}% 〜 100%`,
      sub: `${summary.C?.items?.length || 0}商品`,
      className: 'border-gray-200 bg-gray-50 text-gray-600'
    }
  ];

  return (
    <div className="animate-in slide-in-from-bottom-2 fade-in duration-300">
      {showSettings && (
        <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 animate-in slide-in-from-top-2 duration-200">
          <div className="mb-3">
            <div className="text-lg font-bold text-blue-900">ランク基準</div>
            <div className="mt-1 text-xs text-blue-700">
              売上構成比の境目を調整して、A・B・Cランクの分類基準を決めます。
            </div>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            {settingCards.map((card) => (
              <div key={card.key} className={`rounded-lg border px-3 py-2 ${card.className}`}>
                <div className="text-[11px] font-bold">{card.title}</div>
                <div className="mt-1 text-sm font-bold">{card.value}</div>
                <div className="mt-1 text-[11px] opacity-70">{card.sub}</div>
              </div>
            ))}
          </div>

          <div className="mb-0 flex items-stretch gap-4">
            <div className="flex-1 max-w-[660px] space-y-4 py-1">
              <div className="flex items-center gap-3">
                <span className="w-16 text-[11px] font-bold text-gray-600">Aランク</span>
                <input
                  type="range"
                  min="1"
                  max="98"
                  value={abcThresholds.a}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setAbcThresholds({
                      ...abcThresholds,
                      a: value,
                      b: Math.max(value + 1, abcThresholds.b)
                    });
                  }}
                  className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-blue-200 accent-blue-600"
                />
                <span className="w-10 text-right text-xs font-bold text-blue-700">{abcThresholds.a}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-16 text-[11px] font-bold text-gray-600">Bランク</span>
                <input
                  type="range"
                  min="2"
                  max="99"
                  value={abcThresholds.b}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setAbcThresholds({
                      ...abcThresholds,
                      b: value,
                      a: Math.min(value - 1, abcThresholds.a)
                    });
                  }}
                  className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-blue-200 accent-blue-600"
                />
                <span className="w-10 text-right text-xs font-bold text-blue-700">{abcThresholds.b}%</span>
              </div>
            </div>
            <div className="flex items-center py-1">
              <button
                type="button"
                onClick={() => setAbcThresholds({ a: 70, b: 90 })}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-blue-600 px-4 py-3 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                既定値に戻す
              </button>
            </div>
          </div>

        </div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-4">
        {(['A', 'B', 'C']).map((rank) => {
          const meta = RANK_META[rank];
          const data = summary[rank] || { count: 0, sales: 0, items: [] };
          const share = abcTotalSales > 0 ? (data.sales / abcTotalSales) * 100 : 0;

          return (
            <div key={rank} className={`flex flex-col justify-between rounded-xl border p-4 ${meta.cardClassName}`}>
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold opacity-80">{meta.title}</div>
                </div>
                <div className={`${meta.badgeClassName} rounded px-2 py-0.5 text-xs font-bold text-white`}>{rank}ランク</div>
              </div>

              <div className="space-y-2">
                <div className="text-2xl font-bold">
                  {data.items.length}
                  <span className="ml-1 text-sm font-normal opacity-70">商品</span>
                  <span className="mx-2 opacity-40">/</span>
                  {formatCurrency(data.sales)}
                </div>
                <div className="mt-1 text-sm opacity-70">売上構成比 {share.toFixed(1)}%</div>
                <div className="rounded-lg bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                  {meta.summary}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6 flex h-6 w-full overflow-hidden rounded-full bg-gray-100 shadow-inner">
        {(['A', 'B', 'C']).map((rank) => {
          const data = summary[rank];
          const width = abcTotalSales > 0 && data ? (data.sales / abcTotalSales) * 100 : 0;
          if (width === 0) return null;

          return (
            <div
              key={rank}
              title={`${rank}ランク: ${width.toFixed(1)}%`}
              style={{ width: `${width}%` }}
              className={`${RANK_META[rank].barClassName} h-full transition-all duration-500 hover:opacity-90`}
            />
          );
        })}
      </div>

      <div className="max-h-[500px] overflow-y-auto rounded-xl border bg-white">
        <table className="relative w-full text-left">
          <thead className="sticky top-0 z-10 bg-gray-100 text-xs text-gray-600 uppercase shadow-sm">
            <tr>
              <th className="p-3">ランク</th>
              <th className="p-3">商品名</th>
              <th className="p-3 text-right">売上</th>
              <th className="p-3 text-right">注文数</th>
              <th className="p-3 text-right">売上構成比</th>
              <th className="p-3 text-right">累計構成比</th>
              <th className="p-3 text-right">推奨アクション</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && (
              <tr>
                <td colSpan="7" className="p-4 text-center text-gray-400">
                  対象データがありません
                </td>
              </tr>
            )}

            {items.map((item, idx) => {
              const meta = RANK_META[item.rank] || RANK_META.C;
              const rankColor =
                item.rank === 'A'
                  ? 'bg-amber-100 text-amber-800'
                  : item.rank === 'B'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-600';
              const share = abcTotalSales > 0 ? (item.sales / abcTotalSales) * 100 : 0;

              return (
                <tr key={`${item.name}-${idx}`} className="hover:bg-gray-50">
                  <td className="p-3">
                    <span className={`inline-block w-8 rounded py-0.5 text-center text-xs font-bold ${rankColor}`}>{item.rank}</span>
                  </td>
                  <td className="p-3 text-sm font-bold text-gray-800">
                    {item.name}
                    {idx < 3 && (
                      <span className="ml-2 text-[10px] font-normal text-amber-500">
                        上位 {idx + 1}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono text-sm">{formatCurrency(item.sales)}</td>
                  <td className="p-3 text-right font-mono text-sm text-gray-500">{item.count}</td>
                  <td className="p-3 text-right font-mono text-xs text-gray-500">{share.toFixed(1)}%</td>
                  <td className="p-3 text-right font-mono text-xs">
                    <div className="flex items-center justify-end gap-2">
                      <span className="w-12">{item.percentage.toFixed(1)}%</span>
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full ${meta.barClassName}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${meta.chipClassName}`}>
                      {meta.action}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-right text-xs text-gray-400">
        Aランクは {abcThresholds.a}% まで、Bランクは {abcThresholds.b}% までの累計売上構成比で判定しています。
      </div>
    </div>
  );
};

export default AbcAnalysisView;
