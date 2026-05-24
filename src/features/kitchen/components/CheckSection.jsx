import React from 'react';
import { getTableDisplayName } from '../../../shared/utils/tableDisplay';
import { CreditCard } from 'lucide-react';

const CheckSection = ({ checks = [], onComplete }) => (
  <div className="flex-1 flex flex-col min-h-0 bg-slate-800">
    <div className="px-5 py-3 bg-slate-800/90 backdrop-blur border-b border-slate-700 font-bold text-blue-400 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-2 text-sm tracking-wider"><CreditCard size={16} /> 会計呼び出し</div>
      {checks.length > 0 && <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{checks.length}</span>}
    </div>
    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
      {checks.length === 0 ? (
        <div className="text-center text-slate-600 text-xs py-10">会計待ちはありません</div>
      ) : (
        checks.map(check => (
          <div key={check.id} className="bg-slate-700/50 p-4 rounded-xl border border-blue-500/30 shadow-lg relative overflow-hidden group">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-blue-500"></div>
            <div className="flex justify-between items-start mb-3 pl-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-blue-400/80 font-bold tracking-wider">会計待ち</span>
                <span className="text-3xl font-black text-slate-100">
                  {getTableDisplayName(check)}
                </span>
              </div>
            </div>
            <button onClick={() => onComplete(check.id)} className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-3 rounded-lg shadow active:scale-95 transition-all">会計完了</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default CheckSection;
