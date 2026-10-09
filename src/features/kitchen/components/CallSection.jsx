import React from 'react';
import { getTableDisplayName } from '../../../shared/utils/tableDisplay';
import { Bell } from 'lucide-react';

const CallSection = ({ calls = [], onComplete }) => (
  <div className="flex-1 flex flex-col border-b border-gray-700 min-h-0 bg-gray-800">
    <div className="px-5 py-3 bg-gray-800/90 backdrop-blur border-b border-gray-700 font-bold text-amber-400 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-2 text-sm tracking-wider">
        <Bell size={16} className={calls.length > 0 ? "animate-bounce" : ""} /> 呼び出し
      </div>
      {calls.length > 0 && <span className="bg-amber-500 text-gray-900 text-xs font-bold px-2 py-0.5 rounded-full">{calls.length}</span>}
    </div>
    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
      {calls.length === 0 ? (
        <div className="text-center text-gray-600 text-xs py-10">呼び出しはありません</div>
      ) : (
        calls.map(call => (
          <div key={call.id} className="bg-gray-700/50 p-4 rounded-xl border border-amber-500/30 shadow-lg relative overflow-hidden group">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-amber-500"></div>
            <div className="flex justify-between items-start mb-3 pl-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-amber-500/80 font-bold tracking-wider">呼び出し中</span>
                <span className="text-3xl font-black text-gray-100">
                  {getTableDisplayName(call)}
                </span>
              </div>
              <span className="text-[10px] font-mono text-gray-500">{call.createdAt?.toLocaleTimeString ? call.createdAt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
            </div>
            <button onClick={() => onComplete(call.id)} className="w-full bg-amber-500 hover:bg-amber-400 text-gray-900 text-sm font-bold py-3 rounded-lg shadow active:scale-95 transition-all">対応完了</button>
          </div>
        ))
      )}
    </div>
  </div>
);

export default CallSection;
