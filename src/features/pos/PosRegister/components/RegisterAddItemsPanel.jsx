import React, { useMemo, useState } from 'react';
import { Minus, Plus, ScanLine, X } from 'lucide-react';

import SearchField from '../../../../shared/components/SearchField';
import { isOptionMenuItem, isTakeoutMenuItem } from '../../utils/registerAddOrder';

// テーブルの会計画面の右側を、品を足している間だけこのパネルに切り替える。
// 画面の形は ORDER のテイクアウト画面（カテゴリー → 商品リスト → 追加する品）に合わせる。

const TABS = [
  { id: 'takeout', label: 'テイクアウト' },
  { id: 'retail', label: '物販' },
  { id: 'option', label: 'オプション' }
];

const RETAIL_LIST_LIMIT = 60;

const formatYen = (value) => `¥${Number(value || 0).toLocaleString('ja-JP')}`;

const normalize = (value) => String(value || '').trim().toLowerCase();

export const RegisterAddItemsPanel = ({
  tableDisplayName = '',
  menuItems = [],
  categories = [],
  retailProducts = [],
  resolveRetailTaxRate,
  productMasterLoading = false,
  submitting = false,
  error = '',
  onClose,
  onSubmit
}) => {
  const [tab, setTab] = useState('takeout');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [lines, setLines] = useState([]);
  const [sendToKitchen, setSendToKitchen] = useState(true);
  const [notice, setNotice] = useState('');

  const categoryOrder = useMemo(() => {
    const map = new Map();
    (Array.isArray(categories) ? categories : []).forEach((category, index) => {
      if (category?.id) map.set(String(category.id), { index, name: category.name || 'カテゴリー未設定' });
    });
    return map;
  }, [categories]);

  const menuListByTab = useMemo(() => {
    const decorate = (item) => {
      const categoryId = String(item.category || item.categoryId || '');
      const category = categoryOrder.get(categoryId);
      return {
        ...item,
        resolvedCategoryId: categoryId,
        categoryName: category?.name || item.categoryName || 'カテゴリー未設定',
        categoryIndex: category ? category.index : Number.MAX_SAFE_INTEGER
      };
    };
    const byCategoryThenName = (left, right) => (
      left.categoryIndex - right.categoryIndex
      || Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || String(left.name || '').localeCompare(String(right.name || ''), 'ja')
    );
    const source = Array.isArray(menuItems) ? menuItems : [];
    return {
      takeout: source.filter(isTakeoutMenuItem).map(decorate).sort(byCategoryThenName),
      option: source.filter(isOptionMenuItem).map(decorate).sort(byCategoryThenName),
      retail: []
    };
  }, [menuItems, categoryOrder]);

  const currentMenuList = menuListByTab[tab] || menuListByTab.retail;

  const menuCategories = useMemo(() => {
    const seen = new Map();
    currentMenuList.forEach((item) => {
      if (!seen.has(item.resolvedCategoryId)) {
        seen.set(item.resolvedCategoryId, { id: item.resolvedCategoryId, name: item.categoryName });
      }
    });
    return Array.from(seen.values());
  }, [currentMenuList]);

  const visibleMenuItems = useMemo(() => {
    const word = normalize(keyword);
    return currentMenuList.filter((item) => (
      (!categoryFilter || item.resolvedCategoryId === categoryFilter)
      && (!word || normalize(item.name).includes(word) || normalize(item.kitchenName).includes(word))
    ));
  }, [categoryFilter, currentMenuList, keyword]);

  const matchedRetailProducts = useMemo(() => {
    const word = normalize(keyword);
    if (!word) return [];
    return (Array.isArray(retailProducts) ? retailProducts : []).filter((product) => (
      [product.name, product.sku, product.productCode, product.barcode, product.brandName, product.resolvedCategoryName]
        .some((value) => normalize(value).includes(word))
    ));
  }, [keyword, retailProducts]);

  const lineKey = (kind, id) => `${kind}:${id}`;

  const addLine = (kind, source) => {
    if (!source?.id) return;
    const key = lineKey(kind, source.id);
    setNotice('');
    setLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) => (line.key === key ? { ...line, quantity: line.quantity + 1 } : line));
      }
      const price = kind === 'takeout'
        ? Number(source.takeoutPrice || 0)
        : kind === 'retail'
          ? Number(source.resolvedPrice || 0)
          : Number(source.price || 0);
      return [
        ...current,
        {
          key,
          kind,
          source,
          quantity: 1,
          price,
          categoryName: source.categoryName || source.resolvedCategoryName || '',
          ...(kind === 'retail' && typeof resolveRetailTaxRate === 'function'
            ? { taxRate: resolveRetailTaxRate(source) }
            : {})
        }
      ];
    });
  };

  const changeQuantity = (key, delta) => {
    setLines((current) => current
      .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0));
  };

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setCategoryFilter('');
    setKeyword('');
    setNotice('');
  };

  // バーコードを読んだとき（物販）。完全一致が1件なら、そのまま足す。
  const handleRetailSubmit = (text) => {
    const code = normalize(text);
    if (!code) return;
    const exact = (Array.isArray(retailProducts) ? retailProducts : []).filter((product) => (
      [product.barcode, product.sku, product.productCode].some((value) => normalize(value) === code)
    ));
    if (exact.length === 1) {
      addLine('retail', exact[0]);
      setKeyword('');
      return;
    }
    if (exact.length === 0 && matchedRetailProducts.length === 0) {
      setNotice('この番号の商品が見つかりません。商品名でも探せます。');
    }
  };

  const totalAmount = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const totalCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const hasKitchenLines = lines.some((line) => line.kind !== 'retail');

  const kindLabel = { takeout: 'テイクアウト', retail: '物販', option: 'オプション' };

  const renderMenuRow = (item) => {
    const price = tab === 'takeout' ? item.takeoutPrice : item.price;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => addLine(tab, item)}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 text-left transition-colors hover:border-gray-300 active:scale-[0.99]"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-900">{item.name || '未設定商品'}</div>
          <div className="mt-0.5 truncate text-xs font-bold text-gray-500">{item.categoryName}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-base font-black tabular-nums text-gray-900">{formatYen(price)}</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white">
            <Plus size={17} strokeWidth={2} />
          </span>
        </div>
      </button>
    );
  };

  const renderRetailRow = (product) => (
    <button
      key={product.id}
      type="button"
      onClick={() => addLine('retail', product)}
      className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-2.5 text-left transition-colors hover:border-gray-300 active:scale-[0.99]"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-gray-900">{product.name || '商品'}</div>
        <div className="mt-0.5 truncate text-xs font-bold text-gray-500">
          {[product.brandName, product.resolvedCategoryName, product.barcode].filter(Boolean).join(' ・ ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-base font-black tabular-nums text-gray-900">{formatYen(product.resolvedPrice)}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white">
          <Plus size={17} strokeWidth={2} />
        </span>
      </div>
    </button>
  );

  const renderEmpty = (text, sub = '') => (
    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white p-6 text-center">
      <p className="text-sm font-black text-gray-500">{text}</p>
      {sub && <p className="mt-2 text-xs font-bold leading-relaxed text-gray-500">{sub}</p>}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 w-5/12 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <h2 className="min-w-0 truncate text-base font-black text-gray-900">
          品を追加
          {tableDisplayName && <span className="ml-2 text-gray-500">{tableDisplayName}</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="閉じる"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
        >
          <X size={20} strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-3 px-4 pt-4">
        <div className="flex gap-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => switchTab(item.id)}
              className={`h-11 rounded-full px-4 text-sm font-black transition-colors ${
                tab === item.id ? 'bg-ui text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <SearchField
          value={keyword}
          onChange={(value) => { setKeyword(value); setNotice(''); }}
          onSubmit={tab === 'retail' ? handleRetailSubmit : undefined}
          icon={tab === 'retail' ? ScanLine : undefined}
          placeholder={tab === 'retail' ? '商品名・バーコード' : '商品名'}
          ariaLabel="商品を探す"
          autoFocus={tab === 'retail'}
          key={tab}
        />

        {tab !== 'retail' && menuCategories.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {[{ id: '', name: 'すべて' }, ...menuCategories].map((category) => (
              <button
                key={category.id || 'all'}
                type="button"
                onClick={() => setCategoryFilter(category.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-black transition-colors ${
                  categoryFilter === category.id
                    ? 'bg-gray-900 text-white'
                    : 'border-2 border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}

        {notice && <p className="text-xs font-bold text-red-600">{notice}</p>}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {tab === 'takeout' && (
          visibleMenuItems.length > 0
            ? visibleMenuItems.map(renderMenuRow)
            : renderEmpty(
                menuListByTab.takeout.length === 0 ? 'テイクアウト価格が設定された商品がありません。' : '当てはまる商品がありません。',
                menuListByTab.takeout.length === 0 ? 'メニュー設定で「テイクアウト価格」を入力すると、ここに表示されます。' : ''
              )
        )}

        {tab === 'option' && (
          visibleMenuItems.length > 0
            ? visibleMenuItems.map(renderMenuRow)
            : renderEmpty(
                menuListByTab.option.length === 0 ? 'オプションの品がありません。' : '当てはまる商品がありません。',
                menuListByTab.option.length === 0 ? 'メニュー設定で「顧客画面への表示」を「非表示」にした品が、ここに表示されます。' : ''
              )
        )}

        {tab === 'retail' && (
          productMasterLoading && retailProducts.length === 0
            ? renderEmpty('商品を読み込んでいます。')
            : !normalize(keyword)
              ? renderEmpty('バーコードを読むか、商品名を入れてください。')
              : matchedRetailProducts.length > 0
                ? (
                  <>
                    {matchedRetailProducts.slice(0, RETAIL_LIST_LIMIT).map(renderRetailRow)}
                    {matchedRetailProducts.length > RETAIL_LIST_LIMIT && (
                      <p className="pt-1 text-center text-xs font-bold text-gray-500">
                        ほかに {matchedRetailProducts.length - RETAIL_LIST_LIMIT} 件あります。言葉を足して絞ってください。
                      </p>
                    )}
                  </>
                )
                : renderEmpty('当てはまる商品がありません。')
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
        {lines.length === 0 ? (
          <p className="py-2 text-center text-sm font-bold text-gray-500">追加する品を選んでください。</p>
        ) : (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {lines.map((line) => (
              <div key={line.key} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-900">{line.source.name || '商品'}</div>
                  <div className="mt-0.5 text-xs font-bold text-gray-500">
                    {kindLabel[line.kind]}
                    {line.kind === 'retail' && Number.isFinite(Number(line.taxRate)) ? ` ・ ${line.taxRate}%` : ''}
                    {line.kind === 'takeout' ? ' ・ 8%' : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => changeQuantity(line.key, -1)}
                    aria-label="1つ減らす"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    <Minus size={16} strokeWidth={1.5} />
                  </button>
                  <span className="w-7 text-center text-sm font-black tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => changeQuantity(line.key, 1)}
                    aria-label="1つ増やす"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    <Plus size={16} strokeWidth={1.5} />
                  </button>
                  <span className="w-20 text-right text-sm font-black tabular-nums text-gray-900">
                    {formatYen(line.price * line.quantity)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasKitchenLines && (
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-bold text-gray-700">
            <input
              type="checkbox"
              checked={sendToKitchen}
              onChange={(event) => setSendToKitchen(event.target.checked)}
              className="h-5 w-5 accent-[#3b6e8f]"
            />
            キッチンに送る（物販は送りません）
          </label>
        )}

        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}

        <button
          type="button"
          disabled={lines.length === 0 || submitting}
          onClick={() => onSubmit?.({ lines, sendToKitchen: hasKitchenLines && sendToKitchen })}
          className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-[24px] bg-gray-900 text-base font-black text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting
            ? '追加しています'
            : lines.length === 0
              ? '伝票に追加'
              : <>伝票に追加<span className="tabular-nums">（{totalCount}点 {formatYen(totalAmount)}）</span></>}
        </button>
      </div>
    </div>
  );
};

export default RegisterAddItemsPanel;
