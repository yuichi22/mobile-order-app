import React from 'react';

const RankingView = ({ ranking }) => {
  return (
    <div className="overflow-hidden rounded-xl border bg-white animate-in fade-in duration-300">
      <table className="w-full text-left">
        <thead className="bg-gray-100 text-xs text-gray-600 uppercase">
          <tr>
            <th className="p-3">順位</th>
            <th className="p-3">商品名</th>
            <th className="p-3 text-right">注文数</th>
            <th className="p-3 text-right">売上</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ranking.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-gray-400">対象データがありません</td></tr>}
          {ranking.map((item, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              <td className="w-16 p-3 font-bold text-gray-500">{idx + 1}</td>
              <td className="p-3 font-bold text-gray-800">{item.name}</td>
              <td className="p-3 text-right font-mono">{item.count}</td>
              <td className="p-3 text-right font-mono text-gray-600">¥{item.sales.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RankingView;
