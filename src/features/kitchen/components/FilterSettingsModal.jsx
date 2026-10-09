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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/80 backdrop-blur-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-3"><Settings2 className="text-ui" /><h2 className="text-xl font-bold">表示カテゴリ設定</h2></div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full"><X/></button>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4 custom-scrollbar">
          {tempConfig.map((item, idx) => (
            <div key={item.id} className={`p-4 rounded-2xl border-2 ${item.enabled ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-900/30 border-gray-800 opacity-50'}`}>
              <div className="flex items-center gap-4 mb-3">
                <input className="bg-gray-900 rounded-lg px-3 py-2 text-sm font-bold flex-grow" value={item.label} placeholder="表示名 (例: ドリンク専用)" onChange={(e) => updateFilter(idx, { label: e.target.value })} />
                <button onClick={() => updateFilter(idx, { enabled: !item.enabled })} className={`px-3 py-2 rounded-lg text-xs font-black ${item.enabled ? 'bg-gray-900' : 'bg-gray-600'}`}>{item.enabled ? '有効' : '無効'}</button>
                {item.id !== 'all' && <button onClick={() => setTempConfig(tempConfig.filter((_, i) => i !== idx))} className="text-red-400 p-2"><Trash2 size={18}/></button>}
              </div>
              {item.id !== 'all' && <input className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-ui" value={item.categories.join(', ')} placeholder="対象カテゴリをカンマ区切りで入力 (main, drink...)" onChange={(e) => updateFilter(idx, { categories: e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) })} />}
            </div>
          ))}
          <button onClick={addFilter} className="w-full py-4 border-2 border-dashed border-gray-700 rounded-2xl text-gray-500 hover:border-ui hover:text-ui transition-all flex items-center justify-center gap-2 font-bold"><Plus size={20}/> フィルタを追加</button>
        </div>
        <div className="p-6 bg-gray-900/50 border-t border-gray-700 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 text-gray-500 font-bold">キャンセル</button>
          <button onClick={() => { onSave(tempConfig); onClose(); }} className="flex-1 py-3 bg-gray-900 hover:bg-gray-800 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-gray-200/20"><Check size={20}/> 保存する</button>
        </div>
      </div>
    </div>
  );
};

export default FilterSettingsModal;