import React from 'react';
import { PieChart, Layers, Settings } from 'lucide-react';

const AnalyticsModeTabs = ({
  analysisMode,
  setAnalysisMode,
  showAbcSettings,
  setShowAbcSettings
}) => (
  <div className="mb-6 flex items-center justify-between border-b border-gray-200">
    <div className="flex">
      <button onClick={() => setAnalysisMode('ranking')} className={`flex items-center gap-2 border-b-2 px-6 py-3 text-sm font-bold transition-all ${analysisMode === 'ranking' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:bg-gray-50 hover:text-gray-600'}`}><PieChart size={18} /> 商品ランキング</button>
      <button onClick={() => setAnalysisMode('abc')} className={`flex items-center gap-2 border-b-2 px-6 py-3 text-sm font-bold transition-all ${analysisMode === 'abc' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:bg-gray-50 hover:text-gray-600'}`}><Layers size={18} /> ABC分析</button>
    </div>
    {analysisMode === 'abc' && (
      <button onClick={() => setShowAbcSettings(!showAbcSettings)} className={`mr-2 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${showAbcSettings ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}><Settings size={14} /> 分析設定</button>
    )}
  </div>
);

export default AnalyticsModeTabs;
