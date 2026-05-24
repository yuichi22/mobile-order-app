import React, { useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  Check,
  Edit,
  GripVertical,
  LayoutGrid,
  List as ListIcon,
  MousePointerClick,
  Plus,
  Save,
  StretchHorizontal,
  Tag,
  Trash2,
  X
} from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { useDraggableList } from '../../../../shared/hooks/useDraggableList';

const LAYOUT_OPTIONS = [
  {
    id: 'grid',
    label: 'グリッドカード',
    icon: LayoutGrid,
    desc: '写真を大きく見せる表示です。メイン料理やおすすめメニューに向いています。'
  },
  {
    id: 'wide',
    label: 'ワイドカード',
    icon: StretchHorizontal,
    desc: '横長デザインで説明文も入れやすく、訴求したい商品に向いています。'
  },
  {
    id: 'list',
    label: 'シンプルリスト',
    icon: ListIcon,
    desc: '情報量を抑えた一覧表示です。ドリンクや軽食など、数が多い時に向いています。'
  },
  {
    id: 'limited',
    label: '限定商品カード',
    icon: BadgePercent,
    desc: '1商品を大きく見せる表示です。数量限定・季節限定・特別メニューに向いています。'
  }
];


const createBlankCategory = () => ({
  id: null,
  name: '',
  layoutType: 'grid',
  serviceTimingEnabled: false,
  serviceTimingDefault: 'with_meal'
});

const CategorySettings = ({ categories = [], menuItems = [], onSave, loading, onSaved }) => {
  const { list, setList, onDragStart, onDragOver, onDragEnd } = useDraggableList(categories);
  const [editingItem, setEditingItem] = useState(null);
  const [deletingCategory, setDeletingCategory] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const getItemCount = (categoryId) => {
    if (!Array.isArray(menuItems)) return 0;
    return menuItems.filter((item) => String(item.category) === String(categoryId)).length;
  };

  const startCreating = () => setEditingItem(createBlankCategory());
  const startEditing = (item) => setEditingItem({ ...item, layoutType: item.layoutType || 'grid', serviceTimingEnabled: item.serviceTimingEnabled === true, serviceTimingDefault: item.serviceTimingDefault || 'with_meal' });
  const cancelEditing = () => setEditingItem(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsProcessing(true);

    try {
      const nextList = editingItem.id
        ? list.map((item) => (item.id === editingItem.id ? editingItem : item))
        : [...list, { ...editingItem, id: `cat_${Date.now()}` }];

      setList(nextList);
      await onSave(nextList);
      onSaved?.();
      cancelEditing();
    } finally {
      setIsProcessing(false);
    }
  };

  const moveCategory = async (fromIndex, direction) => {
    const toIndex = fromIndex + direction;

    if (toIndex < 0 || toIndex >= list.length || isProcessing) return;

    const nextList = [...list];
    const [movedItem] = nextList.splice(fromIndex, 1);
    nextList.splice(toIndex, 0, movedItem);

    setIsProcessing(true);

    try {
      setList(nextList);
      await onSave(nextList);
      onSaved?.();
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingCategory) return;

    setIsProcessing(true);
    try {
      const nextList = list.filter((item) => item.id !== deletingCategory.id);
      setList(nextList);
      await onSave(nextList);
      onSaved?.();
      setDeletingCategory(null);
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
                <Tag size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight">
                  {editingItem.id ? 'カテゴリの詳細設定' : '新しいカテゴリを追加'}
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
            <div className="mx-auto max-w-4xl space-y-12">
              <div>
                <label className="mb-3 block text-sm font-black uppercase tracking-widest text-gray-500">
                  カテゴリ名
                </label>
                <input
                  value={editingItem.name}
                  onChange={(event) => setEditingItem({ ...editingItem, name: event.target.value })}
                  required
                  className="h-16 w-full rounded-2xl border-2 border-gray-100 px-6 text-2xl font-bold text-gray-800 outline-none transition-all placeholder:text-gray-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-50"
                  placeholder="例：おすすめ"
                />
              </div>

              <div>
                <label className="mb-5 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-500">
                  <MousePointerClick size={16} />
                  表示形式
                </label>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                  {LAYOUT_OPTIONS.map((option) => {
                    const isSelected = editingItem.layoutType === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setEditingItem({ ...editingItem, layoutType: option.id })}
                        className={`group relative overflow-hidden rounded-3xl border-2 p-6 text-left transition-all ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50/50 shadow-xl shadow-orange-100 ring-1 ring-orange-500'
                            : 'border-gray-100 bg-white hover:border-orange-200 hover:bg-gray-50/30'
                        }`}
                      >
                        <div
                          className={`absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full transition-all ${
                            isSelected ? 'scale-100 bg-orange-500 text-white' : 'scale-50 bg-gray-100 text-transparent'
                          }`}
                        >
                          <Check size={14} strokeWidth={4} />
                        </div>
                        <div
                          className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl transition-all ${
                            isSelected
                              ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
                              : 'bg-gray-50 text-gray-400 group-hover:text-orange-400'
                          }`}
                        >
                          <option.icon size={28} />
                        </div>
                        <div className={`mb-2 text-lg font-black ${isSelected ? 'text-orange-950' : 'text-gray-700'}`}>
                          {option.label}
                        </div>
                        <p className={`text-xs font-medium leading-relaxed ${isSelected ? 'text-orange-700/70' : 'text-gray-400'}`}>
                          {option.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[2rem] border border-blue-100 bg-blue-50/60 p-6">
                <label className="flex cursor-pointer items-start gap-4">
                  <input
                    type="checkbox"
                    checked={editingItem.serviceTimingEnabled === true}
                    onChange={(event) => setEditingItem({
                      ...editingItem,
                      serviceTimingEnabled: event.target.checked
                    })}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-sm font-black text-gray-800">
                      提供タイミング対象にする
                    </div>
                    <p className="mt-1 text-xs font-bold leading-relaxed text-gray-500">
                      食事とのクロスセル時に、このカテゴリの商品へ「食前・食事と一緒に・食後」の選択を表示できます。ドリンクカテゴリでの利用を想定しています。
                    </p>

                    {editingItem.serviceTimingEnabled === true && (
                      <div className="mt-4">
                        <label className="mb-1 block text-xs font-black text-gray-500">
                          デフォルトの提供タイミング
                        </label>
                        <select
                          value={editingItem.serviceTimingDefault || 'with_meal'}
                          onChange={(event) => setEditingItem({
                            ...editingItem,
                            serviceTimingDefault: event.target.value
                          })}
                          className="h-12 w-full rounded-2xl border border-blue-100 bg-white px-4 text-sm font-black text-gray-700 outline-none focus:border-blue-300"
                        >
                          <option value="before_meal">食前</option>
                          <option value="with_meal">食事と一緒に</option>
                          <option value="after_meal">食後</option>
                        </select>
                      </div>
                    )}
                  </div>
                </label>
              </div>

            </div>

            <div className="mt-12 flex justify-end gap-4 border-t border-gray-100 pt-10">
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-xl px-8 py-4 font-bold text-gray-400 transition-colors hover:bg-gray-100 outline-none"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={isProcessing || !editingItem.name.trim()}
                className="flex items-center gap-3 rounded-xl bg-orange-500 px-12 py-4 font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95"
              >
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
                <Tag size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">登録済みカテゴリ</h3>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">
                  現在の登録数 / {list.length}件
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={startCreating}
              className="flex items-center gap-3 whitespace-nowrap rounded-xl bg-orange-500 px-6 py-3.5 font-black text-white shadow-xl shadow-orange-200 transition-colors hover:bg-orange-600 active:scale-95 outline-none"
            >
              <Plus size={20} strokeWidth={3} />
              新しいカテゴリ
            </button>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left">
              <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                <tr>
                  <th className="w-20 px-4 py-5 text-center">#</th>
                  <th className="px-4 py-5">名称</th>
                  <th className="w-[25%] px-4 py-5">表示形式</th>
                  <th className="w-[15%] px-4 py-5">商品数</th>
                  <th className="w-32 px-4 py-5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((item, index) => {
                  const currentLayout = LAYOUT_OPTIONS.find((option) => option.id === item.layoutType) || LAYOUT_OPTIONS[0];

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
                      onDragOver={(event) => onDragOver(event, index)}
                      onDragEnd={() => onDragEnd(async (nextList) => {
                        await onSave(nextList);
                        onSaved?.();
                      })}
                      className="group cursor-pointer transition-colors hover:bg-orange-50/30"
                    >
                      <td className="px-4 py-5 text-center">
                        <div
                          className="flex items-center justify-center gap-1 leading-none"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={index === 0 || isProcessing}
                            onClick={(event) => {
                              event.stopPropagation();
                              moveCategory(index, -1);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-xs font-black text-gray-500 transition-colors hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-30"
                            title="上へ"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={index === list.length - 1 || isProcessing}
                            onClick={(event) => {
                              event.stopPropagation();
                              moveCategory(index, 1);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-xs font-black text-gray-500 transition-colors hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-30"
                            title="下へ"
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="flex flex-col">
                          <span className="text-lg font-black leading-tight text-gray-800">{item.name}</span>
                          <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                            ID: {item.id}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="inline-flex h-10 items-center justify-center gap-3 rounded-xl border border-orange-100/50 bg-orange-50 px-4 text-xs font-bold leading-none text-orange-700">
                          <currentLayout.icon size={16} className="self-center text-orange-500" />
                          <span className="flex h-full items-center leading-none">{currentLayout.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 text-xs font-black text-gray-500">
                          {getItemCount(item.id)}
                        </div>
                      </td>
                      <td className="px-4 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditing(item);
                            }}
                            className="rounded-2xl border border-gray-100 bg-white p-2.5 text-blue-500 shadow-md transition-all hover:bg-blue-50 active:scale-90 outline-none"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeletingCategory(item);
                            }}
                            className="rounded-2xl border border-gray-100 bg-white p-2.5 text-red-400 shadow-md transition-all hover:bg-red-50 active:scale-90 outline-none"
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

      {deletingCategory && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md rounded-[2.5rem] bg-white p-10 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">カテゴリを削除しますか？</h3>
            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">「{deletingCategory.name}」</span> を削除します。<br />
              このカテゴリに含まれる <span className="font-bold text-red-500">{getItemCount(deletingCategory.id)}件</span> のメニューは未分類になります。この操作は元に戻せません。
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isProcessing}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600 active:scale-95"
              >
              {isProcessing ? <LoadingSpinner size={20} /> : '削除する'}
              </button>
              <button
                type="button"
                onClick={() => setDeletingCategory(null)}
                disabled={isProcessing}
                className="w-full rounded-2xl py-4 font-bold text-gray-400 transition-colors hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategorySettings;
