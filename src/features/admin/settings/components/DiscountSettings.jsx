import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit,
  Percent,
  Plus,
  Save,
  Trash2,
  X
} from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';

const ACCOUNTING_CATEGORY_OPTIONS = [
  {
    id: 'sales_discount',
    label: '売上値引',
    desc: '売上金額そのものを減らします。通常の割引・値引きはこちらです。'
  },
  {
    id: 'promo_expense',
    label: '販促費',
    desc: 'スタンプカードなど。お客様支払額は減らし、日計では販促費として別枠表示します。'
  },
  {
    id: 'voucher_payment',
    label: '金券/売掛',
    desc: '地域ギフト券など。お客様支払額は減らし、日計では金券・売掛回収として別枠表示します。'
  }
];

const getAccountingCategoryLabel = (value) => (
  ACCOUNTING_CATEGORY_OPTIONS.find((option) => option.id === value)?.label || '売上値引'
);

const createBlankDiscount = () => ({
  id: null,
  name: '',
  type: 'amount',
  value: '',
  accountingCategory: 'sales_discount',
  note: ''
});

const DiscountSettings = ({ discounts = [], loading, onSave, onDelete, onSaved }) => {
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [discountType, setDiscountType] = useState('amount');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingDiscount, setDeletingDiscount] = useState(null);

  const startCreating = () => {
    setEditingDiscount(createBlankDiscount());
    setDiscountType('amount');
  };

  const startEditing = (discount) => {
    setEditingDiscount({
      ...discount,
      type: discount.type || 'amount',
      value: discount.value ?? '',
      accountingCategory: discount.accountingCategory || 'sales_discount'
    });
    setDiscountType(discount.type || 'amount');
  };

  const cancelEditing = () => {
    setEditingDiscount(null);
    setDiscountType('amount');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!editingDiscount) return;

    setIsProcessing(true);

    try {
      const formData = new FormData(event.currentTarget);

      await onSave({
        ...editingDiscount,
        name: String(formData.get('name') || '').trim(),
        type: discountType,
        value: Number(formData.get('value')) || 0,
        accountingCategory: String(formData.get('accountingCategory') || 'sales_discount'),
        note: String(formData.get('note') || '').trim()
      });

      onSaved?.();
      cancelEditing();
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingDiscount) return;

    setIsProcessing(true);
    try {
      await onDelete(deletingDiscount.id);
      onSaved?.();
      setDeletingDiscount(null);
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
      {editingDiscount ? (
        <div className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl animate-in zoom-in-95 duration-300">
          <div className="flex h-24 items-center justify-between border-b bg-orange-500 px-8 text-white transition-none">
            <div className="flex items-center gap-5">
              <div className="rounded-2xl bg-white/20 p-3 shadow-inner">
                <Percent size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight">
                  {editingDiscount.id ? '割引設定を編集' : '新しい割引を追加'}
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
              <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                <div className="space-y-10">
                  <div>
                    <label className="mb-3 block text-sm font-black uppercase tracking-widest text-gray-500">
                      割引名
                    </label>
                    <input
                      name="name"
                      defaultValue={editingDiscount.name}
                      required
                      placeholder="例: ランチ値引き"
                      className="h-16 w-full rounded-2xl border-2 border-gray-100 px-6 text-2xl font-bold text-gray-800 outline-none transition-all placeholder:text-gray-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-50"
                    />
                  </div>

                  <div>
                    <label className="mb-5 block text-sm font-black uppercase tracking-widest text-gray-500">
                      割引タイプ
                    </label>
                    <div className="flex gap-4">
                      {[
                        {
                          id: 'percent',
                          label: 'パーセント (%)',
                          icon: <Percent size={24} />
                        },
                        {
                          id: 'amount',
                          label: '固定金額値引き (円)',
                          icon: <span className="text-xl font-black">¥</span>
                        }
                      ].map((type) => {
                        const isSelected = discountType === type.id;

                        return (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => setDiscountType(type.id)}
                            className={`relative flex min-h-[188px] flex-1 flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 px-6 py-8 text-center transition-all ${
                              isSelected
                                ? 'border-orange-500 bg-orange-50/50 shadow-xl shadow-orange-100 ring-1 ring-orange-500'
                                : 'border-gray-100 bg-white hover:border-orange-200 hover:bg-gray-50/30'
                            }`}
                          >
                            <div
                              className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full transition-all ${
                                isSelected ? 'scale-100 bg-orange-500 text-white' : 'scale-50 bg-gray-100 text-transparent'
                              }`}
                            >
                              <Check size={12} strokeWidth={4} />
                            </div>
                            <div
                              className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-all ${
                                isSelected
                                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
                                  : 'bg-gray-50 text-gray-400'
                              }`}
                            >
                              {type.icon}
                            </div>
                            <span className={`text-lg font-black leading-tight ${isSelected ? 'text-orange-950' : 'text-gray-500'}`}>
                              {type.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-10">
                  <div>
                    <label className="mb-3 block text-sm font-black uppercase tracking-widest text-gray-500">
                      割引内容 ({discountType === 'percent' ? 'パーセント' : '円'})
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        name="value"
                        defaultValue={editingDiscount.value}
                        required
                        className="h-16 w-full rounded-2xl border-2 border-gray-100 pl-6 pr-14 text-3xl font-black text-gray-800 outline-none transition-all focus:border-orange-500 focus:ring-4 focus:ring-orange-50"
                      />
                      <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xl font-black text-gray-300">
                        {discountType === 'percent' ? '%' : '円'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-5 block text-sm font-black uppercase tracking-widest text-gray-500">
                      会計区分
                    </label>
                    <div className="space-y-3">
                      {ACCOUNTING_CATEGORY_OPTIONS.map((option) => (
                        <label
                          key={option.id}
                          className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-gray-100 bg-white p-4 transition-all hover:border-orange-200 hover:bg-orange-50/30"
                        >
                          <input
                            type="radio"
                            name="accountingCategory"
                            value={option.id}
                            defaultChecked={(editingDiscount.accountingCategory || 'sales_discount') === option.id}
                            className="mt-1 h-4 w-4 accent-orange-500"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-black text-gray-800">{option.label}</span>
                            <span className="mt-1 block text-xs font-bold leading-relaxed text-gray-400">{option.desc}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-3 block text-sm font-black uppercase tracking-widest text-gray-500">
                      備考メモ
                    </label>
                    <textarea
                      name="note"
                      defaultValue={editingDiscount.note}
                      placeholder="適用条件や補足など"
                      className="h-32 w-full resize-none rounded-3xl border-2 border-gray-100 p-6 text-lg font-medium text-gray-700 outline-none transition-all focus:border-orange-500 focus:ring-4 focus:ring-orange-50"
                    />
                  </div>
                </div>
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
                disabled={isProcessing}
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
                <Percent size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">登録済み割引</h3>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">
                  現在の登録数 / {discounts.length}件
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={startCreating}
              className="flex items-center gap-3 rounded-xl bg-orange-500 px-6 py-3.5 font-black text-white shadow-xl shadow-orange-200 transition-colors hover:bg-orange-600 active:scale-95 outline-none"
            >
              <Plus size={20} strokeWidth={3} />
              新しい割引を追加
            </button>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left">
              <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                <tr>
                  <th className="w-20 px-4 py-5 text-center">#</th>
                  <th className="w-24 px-4 py-5 text-center">形式</th>
                  <th className="px-4 py-5">名称</th>
                  <th className="w-[22%] px-4 py-5 text-left">割引内容</th>
                  <th className="w-[16%] px-4 py-5 text-left">会計区分</th>
                  <th className="w-[15%] px-4 py-5 text-left">備考</th>
                  <th className="w-32 px-4 py-5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {discounts.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-24 text-center font-bold leading-none tracking-widest text-gray-300">
                      まだ割引は登録されていません
                    </td>
                  </tr>
                )}

                {discounts.map((discount, index) => (
                  <tr
                    key={discount.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => startEditing(discount)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        startEditing(discount);
                      }
                    }}
                    className="group cursor-pointer transition-colors hover:bg-orange-50/30"
                  >
                    <td className="px-4 py-5 text-center">
                      <span className="font-mono text-base font-black text-gray-300">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </td>

                    <td className="px-4 py-5 text-center">
                      <div className="flex items-center justify-center leading-none">
                        <div
                          className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-lg ring-4 ring-white"
                          style={{ backgroundColor: discount.type === 'percent' ? '#f97316' : '#64748b' }}
                        >
                          {discount.type === 'percent' ? (
                            <Percent size={18} />
                          ) : (
                            <span className="text-base font-black">¥</span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-5">
                      <div className="flex items-center leading-tight">
                        <span className="text-lg font-black text-gray-800">{discount.name}</span>
                      </div>
                    </td>

                    <td className="px-4 py-5">
                      <div className="inline-flex h-10 items-center justify-center rounded-xl border border-orange-100/50 bg-orange-50 px-4 leading-none">
                        {discount.type === 'percent' ? (
                          <span className="inline-flex items-center gap-0 leading-none">
                            <span className="inline-flex items-center text-[16px] font-bold leading-none text-orange-700">
                              {discount.value}%
                            </span>
                            <span className="inline-flex items-center text-[16px] font-bold uppercase leading-none text-orange-700">
                              OFF
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-[1px] leading-none">
                            <span className="-translate-y-px inline-flex items-center text-[16px] font-bold leading-none text-orange-700">
                              ¥{Number(discount.value || 0).toLocaleString()}
                            </span>
                            <span className="inline-flex items-center text-[12px] font-semibold tracking-[-0.015em] leading-none text-orange-700">
                              値引き
                            </span>
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-5">
                      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                        {getAccountingCategoryLabel(discount.accountingCategory || 'sales_discount')}
                      </span>
                    </td>

                    <td className="px-4 py-5">
                      <div className="flex items-center justify-start leading-none">
                        <span className="max-w-[150px] truncate text-xs font-bold text-gray-400">
                          {discount.note || '-'}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-5 text-right">
                      <div className="flex translate-x-2 items-center justify-end gap-3 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 leading-none">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEditing(discount);
                          }}
                          className="rounded-2xl border border-gray-100 bg-white p-2.5 text-blue-500 shadow-md transition-all hover:bg-blue-50 active:scale-90 outline-none"
                        >
                          <Edit size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeletingDiscount(discount);
                          }}
                          className="rounded-2xl border border-gray-100 bg-white p-2.5 text-red-400 shadow-md transition-all hover:bg-red-50 active:scale-90 outline-none"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {deletingDiscount && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md rounded-[2.5rem] bg-white p-10 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">割引を削除しますか？</h3>
            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">「{deletingDiscount.name}」</span> を削除します。
              <br />
              この操作は元に戻せません。
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
                onClick={() => setDeletingDiscount(null)}
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

export default DiscountSettings;
