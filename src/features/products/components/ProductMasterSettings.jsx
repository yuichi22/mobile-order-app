import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Factory,
  FolderTree,
  Package,
  Plus,
  Save,
  Search,
  Tag,
  Trash2,
  X
} from 'lucide-react';

import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';

const PRODUCT_TABS = [
  { id: 'products', label: '商品', icon: Package }
];

const blankProduct = {
  name: '',
  sku: '',
  productCode: '',
  barcode: '',
  categoryId: '',
  categoryGroupId: '',
  brandId: '',
  supplierId: '',
  departmentId: 'retail',
  productType: 'retail',
  size: '',
  colorName: '',
  priceTaxIncluded: '',
  priceTaxExcluded: '',
  taxRateType: 'standard',
  taxRate: 10,
  costTaxExcluded: '',
  costTaxIncluded: '',
  supplierCostRate: '',
  orderLot: '',
  reorderLot: '',
  reorderPoint: '',
  reorderQuantity: '',
  labelEnabled: false,
  shopifyCreateEnabled: false,
  isActive: true,
  isArchived: false,
  shopifyProductId: '',
  shopifyVariantId: '',
  shopifyInventoryItemId: ''
};

export const blankCategory = {
  name: '',
  groupId: '',
  sortOrder: 0,
  departmentId: 'retail',
  color: '#64748b',
  isActive: true
};

export const blankGroup = {
  name: '',
  sortOrder: 0,
  departmentId: 'retail',
  isActive: true
};

export const blankBrand = {
  name: '',
  kana: '',
  note: '',
  isActive: true
};

export const blankSupplier = {
  name: '',
  kana: '',
  contactName: '',
  tel: '',
  email: '',
  address: '',
  defaultCostRate: '',
  paymentTerms: '',
  note: '',
  isActive: true
};

const normalizeNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `¥${Number(value || 0).toLocaleString()}`;
};

const formatDateText = (value) => {
  if (!value) return '-';
  if (value?.toDate) return value.toDate().toLocaleDateString('ja-JP');
  if (value instanceof Date) return value.toLocaleDateString('ja-JP');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ja-JP');
};

const normalizeProductPayload = (draft) => ({
  ...draft,
  name: String(draft.name || '').trim(),
  sku: String(draft.sku || '').trim(),
  productCode: String(draft.productCode || '').trim(),
  barcode: String(draft.barcode || '').trim(),
  categoryId: String(draft.categoryId || '').trim(),
  categoryGroupId: String(draft.categoryGroupId || '').trim(),
  brandId: String(draft.brandId || '').trim(),
  supplierId: String(draft.supplierId || '').trim(),
  departmentId: draft.departmentId || 'retail',
  productType: draft.productType || 'retail',
  size: String(draft.size || '').trim(),
  colorName: String(draft.colorName || '').trim(),
  priceTaxIncluded: normalizeNumberOrNull(draft.priceTaxIncluded),
  priceTaxExcluded: normalizeNumberOrNull(draft.priceTaxExcluded),
  taxRateType: draft.taxRateType || 'standard',
  taxRate: normalizeNumberOrNull(draft.taxRate) ?? 10,
  costTaxExcluded: normalizeNumberOrNull(draft.costTaxExcluded),
  costTaxIncluded: normalizeNumberOrNull(draft.costTaxIncluded),
  supplierCostRate: normalizeNumberOrNull(draft.supplierCostRate),
  orderLot: normalizeNumberOrNull(draft.orderLot),
  reorderLot: normalizeNumberOrNull(draft.reorderLot || draft.orderLot),
  reorderPoint: normalizeNumberOrNull(draft.reorderPoint),
  reorderQuantity: normalizeNumberOrNull(draft.reorderQuantity),
  labelEnabled: Boolean(draft.labelEnabled),
  shopifyCreateEnabled: Boolean(draft.shopifyCreateEnabled),
  isActive: draft.isActive !== false,
  isArchived: Boolean(draft.isArchived),
  shopifyProductId: String(draft.shopifyProductId || '').trim(),
  shopifyVariantId: String(draft.shopifyVariantId || '').trim(),
  shopifyInventoryItemId: String(draft.shopifyInventoryItemId || '').trim()
});

const normalizeSimplePayload = (draft, fallback = {}) => ({
  ...fallback,
  ...draft,
  name: String(draft.name || '').trim(),
  kana: String(draft.kana || '').trim(),
  note: String(draft.note || '').trim(),
  isActive: draft.isActive !== false
});

const classNames = (...values) => values.filter(Boolean).join(' ');

const TableTextInput = ({ value, onChange, type = 'text', className = '', placeholder = '' }) => (
  <input
    type={type}
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    className={classNames(
      'h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold text-slate-800 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100',
      className
    )}
  />
);

const TableSelect = ({ value, onChange, children, className = '', alertWhenEmpty = false }) => {
  const isEmpty = !String(value || '').trim();

  return (
    <select
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      className={classNames(
        'h-9 w-full rounded-lg border px-2 text-sm font-black outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100',
        alertWhenEmpty && isEmpty
          ? 'border-orange-200 bg-orange-50 text-orange-700'
          : 'border-slate-200 bg-white text-slate-800',
        className
      )}
    >
      {children}
    </select>
  );
};

const MiniRadio = ({ label, checked, onChange }) => (
  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-600">
    <input
      type="radio"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 accent-orange-500"
    />
    {label}
  </label>
);

const PillToggle = ({
  checked,
  onChange,
  onLabel = 'あり',
  offLabel = 'なし',
  activeClassName = 'bg-blue-600 text-white shadow-sm shadow-blue-200',
  inactiveClassName = 'bg-slate-200 text-slate-500',
  className = ''
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={classNames(
      'inline-flex h-8 min-w-[122px] items-center justify-center whitespace-nowrap rounded-full px-5 text-xs font-black transition active:scale-95',
      checked ? activeClassName : inactiveClassName,
      className
    )}
  >
    {checked ? onLabel : offLabel}
  </button>
);

const StatusPill = ({ product }) => {
  if (product.isArchived) {
    return <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-400">アーカイブ</span>;
  }

  if (product.isActive === false) {
    return <span className="inline-flex rounded-full bg-rose-50 px-2 py-1 text-xs font-black text-rose-500">停止</span>;
  }

  if (product.shopifyProductId || product.shopifyVariantId) {
    return <span className="inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-black text-blue-600">Shopify連携</span>;
  }

  return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-600">登録・更新</span>;
};

const FieldLabel = () => null;

const ProductMasterTable = ({
  products,
  productCategories,
  productCategoryGroups,
  brands,
  suppliers,
  onSaveProduct,
  onDeleteProduct,
  onSaved
}) => {
  const [draftRows, setDraftRows] = useState({});
  const [newRow, setNewRow] = useState({ ...blankProduct });
  const [savingKey, setSavingKey] = useState('');

  const getDraft = (product) => draftRows[product.id] || product;

  const updateDraft = (productId, patch) => {
    setDraftRows((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || products.find((product) => product.id === productId) || {}),
        ...patch
      }
    }));
  };

  const updateNewRow = (patch) => {
    setNewRow((current) => ({ ...current, ...patch }));
  };

  const saveExisting = async (product) => {
    const draft = getDraft(product);
    if (!String(draft.name || '').trim()) {
      alert('商品名を入力してください');
      return;
    }

    setSavingKey(product.id);
    try {
      await onSaveProduct(normalizeProductPayload(draft));
      setDraftRows((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      onSaved?.();
    } finally {
      setSavingKey('');
    }
  };

  const saveNew = async () => {
    if (!String(newRow.name || '').trim()) {
      alert('商品名を入力してください');
      return;
    }

    setSavingKey('__new__');
    try {
      await onSaveProduct(normalizeProductPayload(newRow));
      setNewRow({ ...blankProduct });
      onSaved?.();
    } finally {
      setSavingKey('');
    }
  };

  const deleteProduct = async (product) => {
    if (!product?.id) return;
    if (!window.confirm(`商品「${product.name || product.id}」を削除しますか？`)) return;
    await onDeleteProduct(product.id);
    onSaved?.();
  };

  const renderEditableRow = (row, options = {}) => {
    const isNew = options.isNew === true;
    const rowKey = isNew ? '__new__' : row.id;
    const update = isNew ? updateNewRow : (patch) => updateDraft(row.id, patch);
    const isSaving = savingKey === rowKey;

    return (
      <div
        key={rowKey}
        className={classNames(
          'rounded-2xl border p-3 shadow-sm',
          isNew ? 'border-orange-100 bg-orange-50/50' : 'border-slate-100 bg-white'
        )}
      >
        <div className="grid grid-cols-[88px_minmax(120px,1fr)_minmax(170px,1.4fr)_minmax(140px,1.15fr)_repeat(6,minmax(74px,0.72fr))_minmax(138px,1.05fr)_minmax(150px,1.15fr)_minmax(70px,0.55fr)] gap-2">
          <div className="row-span-2 rounded-xl bg-slate-50 p-2">
            <div className="text-[10px] font-black tracking-widest text-slate-400">ID</div>
            <div className="mt-1 text-sm font-black text-slate-900">
              {isNew ? '新規' : row.id?.slice(0, 8)}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={isNew ? saveNew : () => saveExisting(row)}
                disabled={isSaving}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 text-xs font-black text-white disabled:opacity-60"
              >
                {isSaving ? <LoadingSpinner size={12} /> : <Save size={13} />}
                保存
              </button>
              {!isNew && (
                <button
                  type="button"
                  onClick={() => deleteProduct(row)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500"
                  title="削除"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          <div>
            <FieldLabel>ブランド</FieldLabel>
            <TableSelect value={row.brandId} onChange={(value) => update({ brandId: value })} alertWhenEmpty>
              <option value="">ブランド</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </TableSelect>
          </div>

          <div>
            <FieldLabel>品番</FieldLabel>
            <TableTextInput
              value={row.sku || row.productCode}
              onChange={(value) => update({ sku: value, productCode: value })}
              placeholder="品番"
            />
          </div>

          <div>
            <FieldLabel>バーコード</FieldLabel>
            <TableTextInput value={row.barcode} onChange={(value) => update({ barcode: value })} placeholder="バーコード" />
          </div>

          <div>
            <FieldLabel>サイズ</FieldLabel>
            <TableTextInput value={row.size} onChange={(value) => update({ size: value })} placeholder="サイズ" />
          </div>

          <div>
            <FieldLabel>色</FieldLabel>
            <TableTextInput value={row.colorName} onChange={(value) => update({ colorName: value })} placeholder="色" />
          </div>

          <div>
            <FieldLabel>金額</FieldLabel>
            <TableTextInput type="number" value={row.priceTaxIncluded} onChange={(value) => update({ priceTaxIncluded: value })} placeholder="金額" className="text-right" />
          </div>

          <div>
            <FieldLabel>LOT数</FieldLabel>
            <TableTextInput type="number" value={row.orderLot ?? row.reorderLot ?? ''} onChange={(value) => update({ orderLot: value, reorderLot: value })} placeholder="LOT" className="text-right" />
          </div>

          <div>
            <FieldLabel>発注点</FieldLabel>
            <TableTextInput type="number" value={row.reorderPoint} onChange={(value) => update({ reorderPoint: value })} placeholder="発注点" className="text-right" />
          </div>

          <div>
            <FieldLabel>発注数</FieldLabel>
            <TableTextInput type="number" value={row.reorderQuantity} onChange={(value) => update({ reorderQuantity: value })} placeholder="発注数" className="text-right" />
          </div>

          <div>
            <FieldLabel>入庫履歴</FieldLabel>
            <div className="h-9 rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold leading-tight text-slate-500">
              <div>{formatDateText(row.lastStockInAt)}</div>
              <div className="text-slate-400">{formatCurrency(row.costTaxExcluded)}</div>
            </div>
          </div>

          <div>
            <FieldLabel>ステータス</FieldLabel>
            <div className="flex h-9 items-center">
              <StatusPill product={row} />
            </div>
          </div>

          <div>
            <FieldLabel>在庫</FieldLabel>
            <div className="h-9 rounded-lg bg-slate-50 px-2 py-1 text-right text-lg font-black text-slate-900">
              {Number(row.inventoryQuantity ?? row.quantity ?? 0).toLocaleString()}
            </div>
          </div>

          <div className="col-start-2">
            <FieldLabel>カテゴリー</FieldLabel>
            <TableSelect
              value={row.categoryId || ''}
              onChange={(value) => {
                const matchedCategory = productCategories.find((category) => category.id === value);
                update({
                  categoryId: value,
                  categoryGroupId: matchedCategory?.groupId || row.categoryGroupId || '',
                  departmentId: matchedCategory?.departmentId || row.departmentId || 'retail'
                });
              }}
              alertWhenEmpty
            >
              <option value="">カテゴリー</option>
              {productCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </TableSelect>
          </div>

          <div className="col-span-3">
            <FieldLabel>商品名</FieldLabel>
            <TableTextInput value={row.name} onChange={(value) => update({ name: value })} placeholder="商品名" />
          </div>

          <div className="col-span-2">
            <FieldLabel>表示 / Shopify</FieldLabel>
            <div className="flex h-9 items-center gap-3 px-2">
              <PillToggle
                checked={row.labelEnabled}
                onChange={(value) => update({ labelEnabled: value })}
                onLabel="ラベルあり"
                offLabel="ラベルなし"
                className="min-w-[128px]"
              />
              <PillToggle
                checked={row.shopifyCreateEnabled}
                onChange={(value) => update({ shopifyCreateEnabled: value })}
                onLabel="Shopify ON"
                offLabel="Shopify OFF"
                activeClassName="bg-emerald-600 text-white shadow-sm shadow-emerald-200"
                inactiveClassName="bg-slate-200 text-slate-500"
                className="min-w-[148px]"
              />
            </div>
          </div>
</div>
      </div>
    );
  };

  return (
    <section className="rounded-[2rem] border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <h3 className="text-lg font-black text-slate-900">商品マスター</h3>
          <p className="mt-1 text-xs font-bold text-slate-400">
            ブランドの下にカテゴリー、品番の下に商品名を配置し、横スクロールを抑えた直接入力型です。
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-black text-slate-600">
          {products.length.toLocaleString()}件
        </div>
      </div>

      <div className="overflow-x-auto p-4">
        <div className="min-w-[1450px] space-y-3">
          <div className="grid grid-cols-[88px_minmax(120px,1fr)_minmax(170px,1.4fr)_minmax(140px,1.15fr)_repeat(6,minmax(74px,0.72fr))_minmax(138px,1.05fr)_minmax(150px,1.15fr)_minmax(70px,0.55fr)] gap-2 px-3 pb-1 text-[11px] font-black tracking-widest text-slate-400">
            <div>操作</div>
            <div>ブランド / カテゴリー</div>
            <div>品番 / 商品名</div>
            <div>バーコード</div>
            <div>サイズ</div>
            <div>色</div>
            <div className="text-right">金額</div>
            <div className="text-right">LOT</div>
            <div className="text-right">発注点</div>
            <div className="text-right">発注数</div>
            <div>入庫履歴</div>
            <div>ステータス</div>
            <div className="text-right">在庫</div>
          </div>

          {renderEditableRow(newRow, { isNew: true })}
          {products.map((product) => renderEditableRow(getDraft(product)))}
        </div>
      </div>

      {products.length === 0 && (
        <div className="border-t border-slate-100 px-5 py-4 text-sm font-bold text-slate-400">
          まずは最上段の新規行に商品名を入力して保存してください。
        </div>
      )}
    </section>
  );
};


const SimpleTextInput = ({ label, value, onChange, type = 'text' }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <input
      type={type}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
    />
  </label>
);

const SimpleToggle = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={classNames(
      'flex h-12 items-center justify-between rounded-2xl border-2 px-4 text-sm font-black transition',
      checked ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-400'
    )}
  >
    <span>{label}</span>
    <span>{checked ? 'ON' : 'OFF'}</span>
  </button>
);

export const SimpleMasterPanel = ({
  label,
  blank,
  items,
  fields,
  onSave,
  onDelete,
  onSaved
}) => {
  const [draft, setDraft] = useState({ ...blank });
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (item) => {
    setEditingId(item.id);
    setDraft({ ...blank, ...item });
  };

  const reset = () => {
    setEditingId('');
    setDraft({ ...blank });
  };

  const save = async () => {
    if (!String(draft.name || '').trim()) {
      alert(`${label}名を入力してください`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...normalizeSimplePayload(draft, blank),
        ...(draft.groupId !== undefined ? { groupId: String(draft.groupId || '').trim() } : {}),
        ...(draft.sortOrder !== undefined ? { sortOrder: normalizeNumberOrNull(draft.sortOrder) ?? 0 } : {}),
        ...(draft.departmentId !== undefined ? { departmentId: draft.departmentId || 'retail' } : {}),
        ...(draft.color !== undefined ? { color: draft.color || '#64748b' } : {}),
        ...(draft.contactName !== undefined ? { contactName: String(draft.contactName || '').trim() } : {}),
        ...(draft.tel !== undefined ? { tel: String(draft.tel || '').trim() } : {}),
        ...(draft.email !== undefined ? { email: String(draft.email || '').trim() } : {}),
        ...(draft.address !== undefined ? { address: String(draft.address || '').trim() } : {}),
        ...(draft.defaultCostRate !== undefined ? { defaultCostRate: normalizeNumberOrNull(draft.defaultCostRate) } : {}),
        ...(draft.paymentTerms !== undefined ? { paymentTerms: String(draft.paymentTerms || '').trim() } : {})
      };

      await onSave(payload);
      reset();
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (!item?.id) return;
    if (!window.confirm(`${label}「${item.name || item.id}」を削除しますか？`)) return;
    await onDelete(item.id);
    onSaved?.();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-slate-900">{editingId ? `${label}を編集` : `${label}を追加`}</div>
            <p className="mt-1 text-xs font-bold text-slate-400">商品マスターで選択する補助マスターです。</p>
          </div>
          {editingId && (
            <button type="button" onClick={reset} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <X size={17} />
            </button>
          )}
        </div>

        <div className="space-y-4">
          {fields.map((field) => (
            <SimpleTextInput
              key={field.id}
              label={field.label}
              type={field.type || 'text'}
              value={draft[field.id]}
              onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
            />
          ))}
          <SimpleToggle
            label="有効"
            checked={draft.isActive !== false}
            onChange={(value) => setDraft((current) => ({ ...current, isActive: value }))}
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 text-sm font-black text-white shadow-lg shadow-orange-500/20 disabled:opacity-60"
        >
          {saving ? <LoadingSpinner size={16} /> : <Save size={17} />}
          保存
        </button>
      </div>

      <div className="rounded-[2rem] border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="text-base font-black text-slate-900">{label}一覧</div>
        </div>
        <div className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <div className="p-8 text-sm font-bold text-slate-400">まだ登録されていません。</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                  <div className="mt-1 truncate text-xs font-bold text-slate-400">
                    {item.kana || item.contactName || item.paymentTerms || item.note || item.id}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => startEdit(item)} className="h-9 rounded-xl bg-slate-100 px-3 text-xs font-black text-slate-600">
                    編集
                  </button>
                  <button type="button" onClick={() => remove(item)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const ProductMasterSettings = ({
  products = [],
  productCategories = [],
  productCategoryGroups = [],
  brands = [],
  suppliers = [],
  loading,
  onSaveProduct,
  onDeleteProduct,
  onSaveCategory,
  onDeleteCategory,
  onSaveCategoryGroup,
  onDeleteCategoryGroup,
  onSaveBrand,
  onDeleteBrand,
  onSaveSupplier,
  onDeleteSupplier,
  onSaved,
  externalKeyword,
  onExternalKeywordChange
}) => {
  const [activeTab, setActiveTab] = useState('products');
  const [internalKeyword, setInternalKeyword] = useState('');
  const keyword = typeof externalKeyword === 'string' ? externalKeyword : internalKeyword;
  const setKeyword = typeof onExternalKeywordChange === 'function' ? onExternalKeywordChange : setInternalKeyword;

  const filterItems = (items) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return items;

    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(normalizedKeyword));
  };

  const filteredProducts = useMemo(() => filterItems(products), [keyword, products]);
  const filteredCategories = useMemo(() => filterItems(productCategories), [keyword, productCategories]);
  const filteredGroups = useMemo(() => filterItems(productCategoryGroups), [keyword, productCategoryGroups]);
  const filteredBrands = useMemo(() => filterItems(brands), [keyword, brands]);
  const filteredSuppliers = useMemo(() => filterItems(suppliers), [keyword, suppliers]);

  return (
    <div className="space-y-5">
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          {activeTab === 'products' && (
            <ProductMasterTable
              products={filteredProducts}
              productCategories={productCategories}
              productCategoryGroups={productCategoryGroups}
              brands={brands}
              suppliers={suppliers}
              onSaveProduct={onSaveProduct}
              onDeleteProduct={onDeleteProduct}
              onSaved={onSaved}
            />
          )}

          {false && activeTab === 'categories' && (
            <SimpleMasterPanel
              label="カテゴリー"
              blank={blankCategory}
              items={filteredCategories}
              fields={[
                { id: 'name', label: 'カテゴリー名' },
                { id: 'groupId', label: 'グループID' },
                { id: 'sortOrder', label: '並び順', type: 'number' },
                { id: 'color', label: 'カラー' }
              ]}
              onSave={onSaveCategory}
              onDelete={onDeleteCategory}
              onSaved={onSaved}
            />
          )}

          {false && activeTab === 'groups' && (
            <SimpleMasterPanel
              label="カテゴリーグループ"
              blank={blankGroup}
              items={filteredGroups}
              fields={[
                { id: 'name', label: 'グループ名' },
                { id: 'sortOrder', label: '並び順', type: 'number' }
              ]}
              onSave={onSaveCategoryGroup}
              onDelete={onDeleteCategoryGroup}
              onSaved={onSaved}
            />
          )}

          {false && activeTab === 'brands' && (
            <SimpleMasterPanel
              label="ブランド"
              blank={blankBrand}
              items={filteredBrands}
              fields={[
                { id: 'name', label: 'ブランド名' },
                { id: 'kana', label: 'かな' },
                { id: 'note', label: 'メモ' }
              ]}
              onSave={onSaveBrand}
              onDelete={onDeleteBrand}
              onSaved={onSaved}
            />
          )}

          {false && activeTab === 'suppliers' && (
            <SimpleMasterPanel
              label="仕入先"
              blank={blankSupplier}
              items={filteredSuppliers}
              fields={[
                { id: 'name', label: '仕入先名' },
                { id: 'kana', label: 'かな' },
                { id: 'contactName', label: '担当者' },
                { id: 'tel', label: '電話' },
                { id: 'email', label: 'メール' },
                { id: 'address', label: '住所' },
                { id: 'defaultCostRate', label: '標準掛け率 %', type: 'number' },
                { id: 'paymentTerms', label: '支払条件' },
                { id: 'note', label: 'メモ' }
              ]}
              onSave={onSaveSupplier}
              onDelete={onDeleteSupplier}
              onSaved={onSaved}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ProductMasterSettings;
