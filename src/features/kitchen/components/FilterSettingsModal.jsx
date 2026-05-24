import React, { useState } from 'react';
import { X, Plus, Trash2, Check, Settings2 } from 'lucide-react';

const FilterSettingsModal = ({ config, onSave, onClose }) => {
  const [tempConfig, setTempConfig] = useState([...config]);

  const addFilter = () => {
    setTempConfig([...tempConfig, { id: Date.now().toString(), label: '新フィルタ', categories: [], enabled: true }]);
  };

  const updateFilter = (index, updates) => {
    const next = [...tempConfig];
    next[index] = { ...next[index], ...updates };
    setTempConfig(next);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <div className="flex items-center gap-3"><Settings2 className="text-orange-500" /><h2 className="text-xl font-bold">表示カテゴリ設定</h2></div>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full"><X/></button>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4 custom-scrollbar">
          {tempConfig.map((item, idx) => (
            <div key={item.id} className={`p-4 rounded-2xl border-2 ${item.enabled ? 'bg-slate-700/50 border-slate-600' : 'bg-slate-900/30 border-slate-800 opacity-50'}`}>
              <div className="flex items-center gap-4 mb-3">
                <input className="bg-slate-900 rounded-lg px-3 py-2 text-sm font-bold flex-grow" value={item.label} placeholder="表示名 (例: ドリンク専用)" onChange={(e) => updateFilter(idx, { label: e.target.value })} />
                <button onClick={() => updateFilter(idx, { enabled: !item.enabled })} className={`px-3 py-2 rounded-lg text-xs font-black ${item.enabled ? 'bg-green-600' : 'bg-slate-600'}`}>{item.enabled ? '有効' : '無効'}</button>
                {item.id !== 'all' && <button onClick={() => setTempConfig(tempConfig.filter((_, i) => i !== idx))} className="text-red-400 p-2"><Trash2 size={18}/></button>}
              </div>
              {item.id !== 'all' && <input className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-orange-400" value={item.categories.join(', ')} placeholder="対象カテゴリをカンマ区切りで入力 (main, drink...)" onChange={(e) => updateFilter(idx, { categories: e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) })} />}
            </div>
          ))}
          <button onClick={addFilter} className="w-full py-4 border-2 border-dashed border-slate-700 rounded-2xl text-slate-500 hover:border-orange-500 hover:text-orange-500 transition-all flex items-center justify-center gap-2 font-bold"><Plus size={20}/> フィルタを追加</button>
        </div>
        <div className="p-6 bg-slate-900/50 border-t border-slate-700 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 text-slate-400 font-bold">キャンセル</button>
          <button onClick={() => { onSave(tempConfig); onClose(); }} className="flex-1 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-orange-900/20"><Check size={20}/> 保存する</button>
        </div>
      </div>
    </div>
  );
};

export default FilterSettingsModal;