import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Delete, Minus, Plus, X } from 'lucide-react';

// バーコード未登録商品の会計用モーダル。
// 売り場(salesArea)を起点に、商品マスターの分類変更UIと同じ流れで
// カテゴリーグループ→カテゴリーを選び、金額・数量を手入力してカートへ確定する。
const ChoiceButton = ({ label, subLabel = '', active = false, disabled = false, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`group w-full rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-orange-200 ${
      disabled
        ? 'cursor-default border-slate-200 bg-white text-slate-400 opacity-50'
        : active
          ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10'
          : 'border-slate-200 bg-white text-slate-800 hover:border-orange-300 hover:bg-orange-50'
    }`}
  >
    <div className="text-sm font-black">{label}</div>
    {subLabel ? (
      <div className={`mt-0.5 text-[11px] font-bold ${active ? 'text-slate-200' : 'text-slate-500'}`}>
        {subLabel}
      </div>
    ) : null}
  </button>
);

const UncodedSaleModal = ({
  open,
  salesArea,
  productCategoryGroups = [],
  productCategories = [],
  onClose,
  onConfirm
}) => {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState(1);

  // 状態は売り場ごとにフレッシュにしたいので、親側で uncodedSalesArea がある時だけ
  // マウントする(= 開くたびにこのコンポーネントが再生成され、上の初期値に戻る)。

  const allowedGroupNames = useMemo(() => (
    Array.isArray(salesArea?.allowedCategoryGroupNames)
      ? salesArea.allowedCategoryGroupNames.map((name) => String(name || '').trim()).filter(Boolean)
      : []
  ), [salesArea]);

  const groupOptions = useMemo(() => (
    allowedGroupNames.length > 0
      ? productCategoryGroups.filter((group) => allowedGroupNames.includes(String(group.name || '').trim()))
      : productCategoryGroups
  ), [allowedGroupNames, productCategoryGroups]);

  const categoryOptions = useMemo(() => (
    selectedGroup
      ? productCategories.filter((category) => (
        category.groupId === selectedGroup.id
        || category.categoryGroupId === selectedGroup.id
        || category.groupName === selectedGroup.name
        || category.categoryGroupName === selectedGroup.name
      ))
      : []
  ), [productCategories, selectedGroup]);

  if (!open || typeof document === 'undefined') return null;

  const priceNumber = Math.max(Number(amount || 0) || 0, 0);
  const canConfirm = Boolean(selectedCategory) && priceNumber > 0 && Number(quantity) > 0;

  // 価格は電卓(テンキー)で入力する。タップで桁を積み上げ。
  const pushDigit = (digit) => {
    setAmount((prev) => (prev + digit).replace(/^0+/, '').slice(0, 9));
  };
  const backspacePrice = () => setAmount((prev) => prev.slice(0, -1));
  const clearPrice = () => setAmount('');

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm?.({
      salesAreaId: salesArea?.id || '',
      salesAreaName: salesArea?.name || '',
      categoryGroupId: selectedGroup?.id || '',
      categoryGroupName: selectedGroup?.name || '',
      categoryId: selectedCategory?.id || '',
      categoryName: selectedCategory?.name || '',
      price: priceNumber,
      quantity: Math.max(Number(quantity) || 1, 1)
    });
  };

  const breadcrumb = [
    salesArea?.displayName || salesArea?.name,
    selectedGroup?.name,
    selectedCategory?.name
  ].filter(Boolean).join(' ＞ ') || '分類未選択';

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Uncoded Sale</p>
            <h3 className="mt-1 text-xl font-black text-slate-900">バーコード未登録商品の会計</h3>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              分類を選び、価格と数量を入力して会計リストに追加します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div className="text-xs font-black text-slate-400">選択中の分類</div>
          <div className="mt-1 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-800 shadow-sm">
            {breadcrumb}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <section className="space-y-3">
              <div>
                <div className="text-sm font-black text-slate-900">1. カテゴリーグループ</div>
                <div className="mt-1 text-xs font-bold text-slate-400">
                  {salesArea?.displayName || salesArea?.name || '売り場'} のグループ
                </div>
              </div>
              <div className="space-y-2">
                {groupOptions.map((group) => (
                  <ChoiceButton
                    key={group.id || group.name}
                    label={group.name}
                    active={selectedGroup?.id === group.id}
                    onClick={() => {
                      setSelectedGroup(group);
                      setSelectedCategory(null);
                    }}
                  />
                ))}
                {groupOptions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold leading-relaxed text-slate-400">
                    この売り場に紐付いたカテゴリーグループがありません。
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-sm font-black text-slate-900">2. カテゴリー</div>
                <div className="mt-1 text-xs font-bold text-slate-400">グループ配下のカテゴリー</div>
              </div>
              <div className="space-y-2">
                {categoryOptions.map((category) => (
                  <ChoiceButton
                    key={category.id || category.name}
                    label={category.name}
                    active={selectedCategory?.id === category.id}
                    disabled={!selectedGroup}
                    onClick={() => setSelectedCategory(category)}
                  />
                ))}
                {selectedGroup && categoryOptions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold leading-relaxed text-slate-400">
                    このグループにカテゴリーがありません。
                  </div>
                )}
                {!selectedGroup && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold leading-relaxed text-slate-400">
                    先にカテゴリーグループを選択してください。
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <div className="text-sm font-black text-slate-900">3. 価格・数量</div>
                <div className="mt-1 text-xs font-bold text-slate-400">税込価格をテンキーで入力します。</div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-bold text-slate-500">価格（税込）</span>
                <div className="mb-2 flex h-14 items-center justify-end rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 font-mono text-3xl font-black text-slate-900">
                  ¥{priceNumber.toLocaleString()}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pushDigit(key)}
                      className="h-12 rounded-2xl border-2 border-slate-200 bg-white text-xl font-black text-slate-800 transition hover:bg-slate-50 active:scale-95"
                    >
                      {key}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={backspacePrice}
                    aria-label="1桁削除"
                    className="flex h-12 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 active:scale-95"
                  >
                    <Delete size={20} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={clearPrice}
                  className="mt-2 h-9 w-full rounded-xl text-xs font-black text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  クリア
                </button>
              </div>

              <div>
                <span className="mb-1 block text-xs font-bold text-slate-500">数量</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity((current) => Math.max(Number(current || 1) - 1, 1))}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  >
                    <Minus size={18} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(event) => setQuantity(Math.max(parseInt(event.target.value, 10) || 1, 1))}
                    className="h-12 w-20 rounded-2xl border-2 border-slate-100 bg-slate-50 text-center font-mono text-2xl font-black text-slate-900 outline-none focus:border-orange-400"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((current) => Math.max(Number(current || 1) + 1, 1))}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-blue-600 hover:bg-blue-50"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-black text-slate-500">小計</span>
                  <span className="font-mono text-2xl font-black text-slate-900">
                    ¥{(priceNumber * Math.max(Number(quantity) || 1, 1)).toLocaleString()}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-500 transition hover:bg-slate-100"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 text-sm font-black text-white shadow-lg transition hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
          >
            <Check size={18} />
            会計リストに追加
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default UncodedSaleModal;
