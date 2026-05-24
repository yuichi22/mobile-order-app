import React, { useState } from 'react';
import {
  X, Plus, Trash2, Save, Clock, Edit,
  Sun, Utensils, Coffee, Moon, Wine, Sparkles, Clock4,
  AlertTriangle
} from 'lucide-react';
import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import ColorPicker from '../../../../shared/components/inputs/ColorPicker';

const ICON_TEMPLATES = [
  { id: 'sun', icon: Sun, label: 'モーニング' },
  { id: 'utensils', icon: Utensils, label: 'ランチ' },
  { id: 'coffee', icon: Coffee, label: 'カフェ' },
  { id: 'moon', icon: Moon, label: 'ディナー' },
  { id: 'wine', icon: Wine, label: 'バー' },
  { id: 'sparkles', icon: Sparkles, label: 'イベント' },
  { id: 'clock', icon: Clock4, label: '通常' }
];

const COLOR_TEMPLATES = [
  { id: 'apricot', value: '#F8B862', label: 'アプリコット' },
  { id: 'orange', value: '#F39800', label: 'オレンジ' },
  { id: 'terracotta', value: '#EE7948', label: 'テラコッタ' },
  { id: 'purple', value: '#655C99', label: 'パープル' }
];

const createBlankPeriod = () => ({
  id: null,
  name: '',
  start: '11:00',
  end: '14:00',
  icon: 'clock',
  bannerColor: '#F39800'
});

const PeriodSettings = ({ periods = [], menuItems = [], onSave, loading, onSaved }) => {
  const [editingItem, setEditingItem] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingPeriod, setDeletingPeriod] = useState(null);

  const getItemCount = (periodId) => {
    if (!Array.isArray(menuItems)) return 0;
    return menuItems.filter((item) => {
      if (!item.periods) return false;
      return Array.isArray(item.periods)
        ? item.periods.includes(periodId)
        : String(item.periods) === String(periodId);
    }).length;
  };

  const startCreating = () => setEditingItem(createBlankPeriod());
  const startEditing = (item) => setEditingItem({ ...item });
  const cancelEditing = () => setEditingItem(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsProcessing(true);
    try {
      const nextList = editingItem.id
        ? periods.map((item) => (item.id === editingItem.id ? editingItem : item))
        : [...periods, { ...editingItem, id: `period_${Date.now()}` }];
      await onSave(nextList);
      onSaved?.();
      cancelEditing();
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingPeriod) return;
    setIsProcessing(true);
    try {
      await onSave(periods.filter((item) => item.id !== deletingPeriod.id));
      onSaved?.();
      setDeletingPeriod(null);
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-orange-500">
        <LoadingSpinner size={32} className="mx-auto" />
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in duration-300 pb-20">
      {editingItem ? (
        <div className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl animate-in zoom-in-95 duration-300">
          <div className="flex h-24 items-center justify-between border-b bg-orange-500 px-8 text-white transition-none">
            <div className="flex items-center gap-5">
              <div className="rounded-2xl bg-white/20 p-3 shadow-inner">
                <Clock size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight">
                  {editingItem.id ? '時間帯の詳細設定' : '新しい時間帯の追加'}
                </h3>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-white/60">
                  Configuration
                </p>
              </div>
            </div>
          <button
            type="button"
            onClick={cancelEditing}
            className="flex h-11 items-center gap-2 rounded-full px-4 text-sm font-black text-white/90 transition-all hover:bg-white/20 active:scale-95"
            aria-label="閉じる"
          >
            <span>閉じる</span>
            <X size={20} />
          </button>
          </div>

          <form onSubmit={handleSubmit} className="p-8">
            <div className="mx-auto max-w-4xl space-y-10">
              <div className="rounded-[2.5rem] border border-gray-100 bg-gray-50/50 p-8">
                <label className="mb-6 block text-center text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                  モバイルプレビュー
                </label>
                <div className="mx-auto flex h-16 w-full max-w-sm items-center justify-center gap-4 rounded-2xl text-white shadow-xl ring-8 ring-white" style={{ backgroundColor: editingItem.bannerColor }}>
                  {React.createElement(ICON_TEMPLATES.find((item) => item.id === editingItem.icon)?.icon || Clock4, { size: 24, strokeWidth: 2.5 })}
                  <p className="text-lg font-black leading-none">{editingItem.name || '未入力'} 提供中</p>
                </div>
              </div>

              <div>
                <label className="mb-3 block text-sm font-black uppercase tracking-widest text-gray-500">時間帯名</label>
                <input
                  value={editingItem.name}
                  onChange={(event) => setEditingItem({ ...editingItem, name: event.target.value })}
                  required
                  className="h-16 w-full rounded-2xl border-2 border-gray-100 px-6 text-2xl font-bold text-gray-800 outline-none transition-all placeholder:text-gray-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-50"
                  placeholder="例：ランチタイム"
                />
              </div>

              <div>
                <label className="mb-3 block text-sm font-black uppercase tracking-widest text-gray-500">提供時間設定</label>
                <div className="grid max-w-md grid-cols-2 gap-4">
                  <input type="time" value={editingItem.start} onChange={(event) => setEditingItem({ ...editingItem, start: event.target.value })} required className="h-16 w-full rounded-2xl border-2 border-gray-100 bg-white text-center font-mono text-2xl font-black outline-none transition-all focus:border-orange-500" />
                  <input type="time" value={editingItem.end} onChange={(event) => setEditingItem({ ...editingItem, end: event.target.value })} required className="h-16 w-full rounded-2xl border-2 border-gray-100 bg-white text-center font-mono text-2xl font-black outline-none transition-all focus:border-orange-500" />
                </div>
              </div>

              <div>
                <label className="mb-4 block text-sm font-black uppercase tracking-widest text-gray-500">表示アイコン</label>
                <div className="flex flex-wrap gap-3">
                  {ICON_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, icon: template.id })}
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition-all ${editingItem.icon === template.id ? 'scale-110 border-orange-500 bg-orange-500 text-white shadow-lg' : 'border-gray-200 bg-white text-gray-400 hover:border-orange-300'}`}
                      title={template.label}
                    >
                      <template.icon size={24} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[2.5rem] border border-gray-100 bg-gray-50/50 p-8">
                <label className="mb-6 block text-sm font-black uppercase tracking-widest text-gray-500">バナーカラー</label>
                <ColorPicker selectedColor={editingItem.bannerColor} onChange={(hex) => setEditingItem({ ...editingItem, bannerColor: hex })} presetColors={COLOR_TEMPLATES} />
              </div>
            </div>

            <div className="mt-12 flex justify-end gap-4 border-t border-gray-100 pt-10">
              <button type="button" onClick={cancelEditing} className="rounded-xl px-8 py-4 font-bold text-gray-400 transition-colors hover:bg-gray-100 outline-none">
                キャンセル
              </button>
              <button type="submit" disabled={isProcessing || !editingItem.name.trim()} className="flex items-center gap-3 rounded-xl bg-orange-500 px-12 py-4 font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95">
              {isProcessing ? <LoadingSpinner size={24} /> : <Save size={20} />}
                保存する
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex h-24 items-center justify-between border-b bg-orange-50/50 px-8 transition-none">
            <div className="flex items-center gap-5">
              <div className="rounded-2xl bg-orange-500 p-3 text-white shadow-xl shadow-orange-200">
                <Clock size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">提供時間帯管理</h3>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">現在の登録数 / {periods.length}件</p>
              </div>
            </div>
            <button onClick={startCreating} className="flex items-center gap-3 whitespace-nowrap rounded-xl bg-orange-500 px-6 py-3.5 font-black text-white shadow-xl shadow-orange-200 transition-colors hover:bg-orange-600 active:scale-95 outline-none">
              <Plus size={20} strokeWidth={3} />
              新しい時間帯
            </button>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left">
              <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                <tr>
                  <th className="w-20 px-4 py-5 text-center">#</th>
                  <th className="w-24 px-4 py-5 text-center">アイコン</th>
                  <th className="px-4 py-5">名称</th>
                  <th className="w-[25%] px-4 py-5">提供時間</th>
                  <th className="w-[15%] px-4 py-5">商品数</th>
                  <th className="w-32 px-4 py-5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {periods.map((item, index) => {
                  const IconComp = ICON_TEMPLATES.find((template) => template.id === item.icon)?.icon || Clock4;
                  return (
                    <tr
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => startEditing(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          startEditing(item);
                        }
                      }}
                      className="group cursor-pointer transition-colors hover:bg-orange-50/30"
                    >
                      <td className="px-4 py-5 text-center"><span className="font-mono text-base font-black text-gray-300">{String(index + 1).padStart(2, '0')}</span></td>
                      <td className="px-4 py-5 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-lg ring-4 ring-white" style={{ backgroundColor: item.bannerColor || '#ccc' }}><IconComp size={18} /></div></td>
                      <td className="px-4 py-5">
                        <div className="flex flex-col">
                          <span className="text-lg font-black leading-tight text-gray-800">{item.name}</span>
                          <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">TIME RANGE</span>
                        </div>
                      </td>
                        <td className="px-4 py-5"><div className="inline-flex h-10 items-center justify-center gap-2.5 rounded-xl border border-orange-100/50 bg-orange-50 px-4 text-[16px] font-bold leading-none text-orange-700"><Clock size={16} className="self-center text-orange-500" /><span className="flex h-full items-center leading-none">{item.start} ~ {item.end}</span></div></td>
                      <td className="px-4 py-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 text-xs font-black text-gray-500">{getItemCount(item.id)}</div></td>
                      <td className="px-4 py-5 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 transition-all group-hover:opacity-100">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditing(item);
                            }}
                            className="rounded-2xl border border-gray-100 bg-white p-2.5 text-blue-500 shadow-md transition-all hover:bg-blue-50 outline-none active:scale-90"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeletingPeriod(item);
                            }}
                            className="rounded-2xl border border-gray-100 bg-white p-2.5 text-red-400 shadow-md transition-all hover:bg-red-50 outline-none active:scale-90"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {deletingPeriod && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md rounded-[2.5rem] bg-white p-10 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">時間帯を削除しますか？</h3>
            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">「{deletingPeriod.name}」</span>を削除します。<br />
              この時間帯に設定されている <span className="font-bold text-red-500">{getItemCount(deletingPeriod.id)}件</span> のメニューは、提供時間の紐付けが外れます。この操作は元に戻せません。
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={confirmDelete} disabled={isProcessing} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600 active:scale-95">
              {isProcessing ? <LoadingSpinner size={20} /> : '削除する'}
              </button>
              <button onClick={() => setDeletingPeriod(null)} disabled={isProcessing} className="w-full rounded-2xl py-4 font-bold text-gray-400 transition-colors hover:bg-gray-50">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PeriodSettings;
