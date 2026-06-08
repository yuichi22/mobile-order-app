import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Check,
  ChevronDown,
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
    inputMode={type === 'number' ? 'decimal' : undefined}
    className={classNames(
      'h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 shadow-sm outline-none transition [appearance:textfield] focus:border-orange-400 focus:ring-2 focus:ring-orange-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
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
        'h-8 w-full rounded-md border px-2 text-sm font-black shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100',
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
          'rounded-xl border p-2 shadow-md shadow-slate-200/60',
          isNew ? 'border-orange-100 bg-orange-50/60 shadow-orange-100/50' : 'border-slate-200 bg-slate-50/80'
        )}
      >
        <div className="grid grid-cols-[minmax(112px,1fr)_minmax(124px,0.98fr)_minmax(130px,1.02fr)_minmax(64px,0.5fr)_minmax(64px,0.5fr)_repeat(4,minmax(72px,0.55fr))_minmax(44px,0.35fr)_96px] gap-1.5">
          <div>
            <FieldLabel>品番</FieldLabel>
            <TableTextInput
              value={row.sku || row.productCode}
              onChange={(value) => update({ sku: value, productCode: value })}
              placeholder="品番"
            />
          </div>

          <div className="col-span-2">
            <FieldLabel>商品名</FieldLabel>
            <TableTextInput value={row.name} onChange={(value) => update({ name: value })} placeholder="商品名" />
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

          <div className="row-span-2">
            <FieldLabel>入庫数</FieldLabel>
            <TableTextInput
              type="number"
              value={row.stockInQuantityDraft || ''}
              onChange={(value) => update({ stockInQuantityDraft: value })}
              placeholder="数"
              className="h-[4.25rem] text-right text-base"
            />
          </div>

          <div className="row-span-2">
            <FieldLabel>操作</FieldLabel>
            <div className="flex h-[4.25rem] flex-col gap-1.5">
              <button
                type="button"
                onClick={isNew ? saveNew : () => saveExisting(row)}
                disabled={isSaving}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 text-xs font-black text-white disabled:opacity-60"
              >
                {isSaving ? <LoadingSpinner size={12} /> : <Save size={13} />}
                保存・更新
              </button>
              {!isNew && (
                <button
                  type="button"
                  onClick={() => deleteProduct(row)}
                  className="inline-flex h-8 items-center justify-center rounded-lg bg-rose-50 text-xs font-black text-rose-500"
                  title="削除"
                >
                  <Trash2 size={13} />
                  削除
                </button>
              )}
            </div>
          </div>

          <div>
            <FieldLabel>ID</FieldLabel>
            <div className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-black text-slate-500">
              {isNew ? '新規' : row.id?.slice(0, 8)}
            </div>
          </div>

          <div>
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
              className="!border-slate-200 !bg-slate-50 !text-slate-500"
            >
              <option value="">カテゴリー</option>
              {productCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </TableSelect>
          </div>

          <div>
            <FieldLabel>ブランド</FieldLabel>
            <TableSelect value={row.brandId} onChange={(value) => update({ brandId: value })} alertWhenEmpty className="!border-slate-200 !bg-slate-50 !text-slate-500">
              <option value="">ブランド</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </TableSelect>
          </div>

          <div className="col-span-2">
            <FieldLabel>バーコード</FieldLabel>
            <TableTextInput value={row.barcode} onChange={(value) => update({ barcode: value })} placeholder="バーコード" className="!border-slate-200 !bg-slate-50 !text-slate-500" />
          </div>

          <div className="col-span-4 self-end">
            <FieldLabel>表示 / Shopify / ステータス / 入庫履歴 / 在庫</FieldLabel>
            <div className="flex h-8 items-center gap-1.5 px-0">
              <PillToggle
                checked={row.labelEnabled}
                onChange={(value) => update({ labelEnabled: value })}
                onLabel="ラベル"
                offLabel="ラベル"
                className="!h-7 !min-w-[68px] !px-3 text-[11px]"
              />
              <PillToggle
                checked={row.shopifyCreateEnabled}
                onChange={(value) => update({ shopifyCreateEnabled: value })}
                onLabel="Shopify"
                offLabel="Shopify"
                activeClassName="bg-emerald-600 text-white shadow-sm shadow-emerald-200"
                inactiveClassName="bg-slate-200 text-slate-500"
                className="!h-7 !min-w-[82px] !px-3 text-[11px]"
              />
              <span className="inline-flex h-7 min-w-[74px] items-center justify-center rounded-full bg-slate-900 px-3 text-[11px] font-black text-white">
                ACTIVE
              </span>
              <button
                type="button"
                className="inline-flex h-7 min-w-[82px] items-center justify-center rounded-full bg-slate-100 px-3 text-[11px] font-black text-slate-600 transition hover:bg-slate-200"
                title="入庫履歴を表示"
              >
                入庫履歴
              </button>
              <span className="inline-flex h-7 min-w-[82px] items-center justify-center rounded-full bg-blue-50 px-3 text-[11px] font-black text-blue-700">
                在庫 {Number(row.inventoryQuantity ?? row.quantity ?? 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-[2rem] border border-slate-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-base font-black text-slate-900">商品マスター</h3>
          <p className="mt-0.5 text-[11px] font-bold text-slate-400">
            ブランドの下にカテゴリー、品番の下に商品名を配置し、横スクロールを抑えた直接入力型です。
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-black text-slate-600">
          {products.length.toLocaleString()}件
        </div>
      </div>

      <div className="overflow-x-auto bg-sky-100/60 p-4">
        <div className="min-w-[1290px] space-y-3">
          <div className="grid grid-cols-[minmax(112px,1fr)_minmax(124px,0.98fr)_minmax(130px,1.02fr)_minmax(64px,0.5fr)_minmax(64px,0.5fr)_repeat(4,minmax(72px,0.55fr))_minmax(44px,0.35fr)_96px] gap-1.5 px-2 pb-1 text-[11px] font-black tracking-widest text-slate-400">
            <div>品番 / ID</div>
            <div>商品名 / カテゴリー</div>
            <div>商品名 / ブランド</div>
            <div>サイズ / バーコード</div>
            <div>色 / バーコード</div>
            <div className="text-right">金額 / 表示</div>
            <div className="text-right">LOT / Shopify</div>
            <div className="text-right">発注点 / ACTIVE</div>
            <div className="text-right">発注数 / 入庫履歴・在庫</div>
            <div className="text-right">入庫数</div>
            <div className="text-center">保存</div>
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


const SimpleTextInput = ({ label, value, onChange, type = 'text', disabled = false, helpText = '' }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={classNames(
        'h-12 w-full rounded-2xl border-2 px-4 text-sm font-bold outline-none transition focus:border-orange-400',
        disabled
          ? 'cursor-default border-slate-100 bg-slate-50 text-slate-500'
          : 'border-slate-100 bg-white text-slate-700'
      )}
    />
    {helpText && (
      <span className="mt-1.5 block text-[11px] font-bold leading-relaxed text-slate-400">
        {helpText}
      </span>
    )}
  </label>
);


const SimpleOptionSelectInput = ({
  label,
  value,
  onChange,
  options = [],
  disabled = false,
  placeholder = '選択してください',
  helpText = ''
}) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={classNames(
        'h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-400',
        disabled ? 'cursor-not-allowed bg-slate-50 text-slate-400' : ''
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    {helpText && (
      <span className="mt-1.5 block text-[11px] font-bold leading-relaxed text-slate-400">
        {helpText}
      </span>
    )}
  </label>
);

const SimpleDisplayField = ({ label, value, muted = false, helpText = '' }) => (
  <div className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <div
      className={classNames(
        'flex min-h-12 w-full items-center rounded-2xl border-2 px-4 text-sm font-black',
        muted
          ? 'border-orange-100 bg-orange-50 text-orange-600'
          : 'border-slate-100 bg-slate-50 text-slate-700'
      )}
    >
      {value || '未設定'}
    </div>
    {helpText && (
      <span className="mt-1.5 block text-[11px] font-bold leading-relaxed text-slate-400">
        {helpText}
      </span>
    )}
  </div>
);

const SimpleTextareaInput = ({ label, value, onChange, rows = 6, disabled = false }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <textarea
      value={value ?? ''}
      rows={rows}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={classNames(
        'w-full resize-y rounded-2xl border-2 px-4 py-3 text-sm font-bold leading-relaxed outline-none transition focus:border-orange-400',
        disabled
          ? 'cursor-default border-slate-100 bg-slate-50 text-slate-500'
          : 'border-slate-100 bg-white text-slate-700'
      )}
    />
  </label>
);

const PosModalSelect = ({
  label,
  value,
  onChange,
  options = [],
  placeholder = '選択してください',
  searchPlaceholder = '検索',
  createLabel = '新規作成',
  onCreate,
  onCreateSave,
  onCreated,
  createFields = [],
  createInitialValue = {},
  disabled = false,
  getOptionLabel = (option) => option?.name || option?.label || option?.id || '',
  getOptionSubLabel = (option) => option?.kana || option?.supplierName || option?.contactName || option?.id || ''
}) => {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [createMode, setCreateMode] = useState(false);
  const [createDraft, setCreateDraft] = useState({ ...createInitialValue });
  const [creating, setCreating] = useState(false);

  const selectedOption = options.find((option) => String(option.id) === String(value || '')) || null;

  const filteredOptions = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return options;

    return options.filter((option) => JSON.stringify(option).toLowerCase().includes(normalizedKeyword));
  }, [keyword, options]);

  const closeModal = () => {
    setOpen(false);
    setKeyword('');
    setCreateMode(false);
    setCreateDraft({ ...createInitialValue });
  };

  const selectOption = (option) => {
    onChange(option?.id || '', option || null);
    closeModal();
  };

  const clearSelection = () => {
    onChange('', null);
    closeModal();
  };

  const handleCreate = () => {
    if (typeof onCreateSave === 'function') {
      setCreateMode(true);
      setCreateDraft({ ...createInitialValue });
      return;
    }

    closeModal();
    onCreate?.();
  };

  const normalizeCreatedPayload = () => {
    const payload = { ...createDraft };

    for (const field of createFields) {
      if (field.type === 'number' && payload[field.id] !== undefined) {
        const raw = String(payload[field.id] ?? '').trim();
        payload[field.id] = raw === '' ? null : Number(raw);
      } else if (typeof payload[field.id] === 'string') {
        payload[field.id] = payload[field.id].trim();
      }
    }

    payload.name = String(payload.name || '').trim();
    payload.isActive = payload.isActive !== false;

    return payload;
  };

  const saveCreatedItem = async () => {
    const payload = normalizeCreatedPayload();

    if (!payload.name) {
      alert('名称を入力してください');
      return;
    }

    if (typeof onCreateSave !== 'function') return;

    setCreating(true);
    try {
      const createdResult = await onCreateSave(payload);
      const createdId = typeof createdResult === 'string'
        ? createdResult
        : createdResult?.id || payload.id || '';
      const createdOption = {
        ...payload,
        ...(createdResult && typeof createdResult === 'object' ? createdResult : {}),
        id: createdId || payload.id || `created:${Date.now()}`,
        name: createdResult?.name || payload.name || ''
      };

      onChange(createdOption.id, createdOption);
      closeModal();
      if (typeof onCreated === 'function') {
        await onCreated(createdOption, payload);
      }
    } catch (error) {
      console.error('failed to create modal option', error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    } finally {
      setCreating(false);
    }
  };

  const renderCreateInput = (field) => {
    if (field.type === 'select') {
      return (
        <label key={field.id} className="block">
          <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{field.label}</span>
          <select
            value={createDraft[field.id] ?? ''}
            onChange={(event) => setCreateDraft((current) => ({ ...current, [field.id]: event.target.value }))}
            className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
          >
            <option value="">{field.placeholder || '選択してください'}</option>
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === 'textarea') {
      return (
        <label key={field.id} className="block">
          <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{field.label}</span>
          <textarea
            value={createDraft[field.id] ?? ''}
            rows={field.rows || 5}
            onChange={(event) => setCreateDraft((current) => ({ ...current, [field.id]: event.target.value }))}
            className="w-full resize-y rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-sm font-bold leading-relaxed text-slate-700 outline-none focus:border-orange-400"
          />
        </label>
      );
    }

    return (
      <label key={field.id} className="block">
        <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{field.label}</span>
        <input
          type={field.type || 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={createDraft[field.id] ?? ''}
          onChange={(event) => setCreateDraft((current) => ({ ...current, [field.id]: event.target.value }))}
          className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
        />
      </label>
    );
  };

  const modalNode = open ? (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-slate-900/55 px-5 pb-5 pt-20 backdrop-blur-sm">
      <div className="flex h-[min(760px,calc(100vh-7rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">
                {createMode ? 'Create' : 'Select'}
              </p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">
                {createMode ? createLabel : label}
              </h3>
            </div>
            <button
              type="button"
              onClick={closeModal}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm transition hover:text-slate-700"
              aria-label="閉じる"
            >
              <X size={18} />
            </button>
          </div>

          {!createMode && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
                className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
              />
              {(onCreate || onCreateSave) && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 text-sm font-black text-white shadow-lg shadow-orange-500/20"
                >
                  <Plus size={16} />
                  {createLabel}
                </button>
              )}
            </div>
          )}
        </div>

        {createMode ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {createFields.map((field) => renderCreateInput(field))}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <button
              type="button"
              onClick={clearSelection}
              className="mb-2 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-black text-slate-400 transition hover:bg-slate-50"
            >
              <span>未選択にする</span>
              {!value && <Check size={16} className="text-orange-500" />}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-400">
                該当する項目がありません。
              </div>
            ) : (
              <div className="space-y-1">
                {filteredOptions.map((option) => {
                  const isSelected = String(option.id) === String(value || '');
                  return (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => selectOption(option)}
                      className={classNames(
                        'flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left transition',
                        isSelected ? 'bg-orange-50 text-orange-700' : 'hover:bg-slate-50 text-slate-700'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black">{getOptionLabel(option)}</span>
                        <span className="mt-1 block truncate text-xs font-bold text-slate-400">{getOptionSubLabel(option)}</span>
                      </span>
                      {isSelected && <Check size={17} className="shrink-0 text-orange-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4">
          {createMode ? (
            <div className="flex justify-between gap-3">
              <button
                type="button"
                onClick={() => setCreateMode(false)}
                disabled={creating}
                className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-500 disabled:opacity-60"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={saveCreatedItem}
                disabled={creating}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-500/20 disabled:opacity-60"
              >
                {creating ? <LoadingSpinner size={16} /> : <Save size={14} />}
                保存して選択
              </button>
            </div>
          ) : (
            <div className="text-right">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-500"
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="block">
      <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={classNames(
          'flex h-12 w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left text-sm font-bold outline-none transition focus:border-orange-400',
          disabled
            ? 'cursor-default border-slate-100 bg-slate-50 text-slate-500'
            : 'border-slate-100 bg-white text-slate-700 hover:border-orange-200'
        )}
      >
        <span className={selectedOption ? 'truncate text-slate-800' : 'truncate text-slate-400'}>
          {selectedOption ? getOptionLabel(selectedOption) : placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-slate-400" />
      </button>

      {modalNode && createPortal(modalNode, document.body)}
    </div>
  );
};

const SimpleToggle = ({ label, checked, onChange, disabled = false }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={classNames(
      'flex h-12 items-center justify-between rounded-2xl border-2 px-4 text-sm font-black transition',
      disabled ? 'cursor-default opacity-70' : '',
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
  onSaved,
  suppliers = [],
  productCategoryGroups = [],
  onSaveSupplier,
  onSaveCategoryGroup
}) => {
  const [draft, setDraft] = useState({ ...blank });
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [isEditing, setIsEditing] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [sortEditMode, setSortEditMode] = useState(false);
  const [sortDraftItems, setSortDraftItems] = useState([]);

  useEffect(() => {
    setEditingId('');
    setDraft({ ...blank });
    setKeyword('');
    setIsEditing(true);
    setSelectedSnapshot(null);
    setSortEditMode(false);
    setSortDraftItems([]);
  }, [label]);

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return items;

    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(normalizedKeyword));
  }, [items, keyword]);

  const isSortableMaster = label === 'カテゴリー' || label === 'カテゴリーグループ';

  const sortedItems = useMemo(() => {
    const sourceItems = filteredItems || [];
    if (!isSortableMaster) return sourceItems;

    return [...sourceItems].sort((a, b) => {
      const aSort = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 999999;
      const bSort = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 999999;
      if (aSort !== bSort) return aSort - bSort;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
    });
  }, [filteredItems, isSortableMaster]);

  const displayItems = sortEditMode && sortDraftItems.length > 0 ? sortDraftItems : sortedItems;


  const buildDraftFromItem = (item) => ({
    ...blank,
    ...item,
    supplierId: item.supplierId || '',
    supplierName: item.supplierName || '',
    groupId: item.groupId || '',
    groupName: item.groupName || ''
  });

  const startEdit = (item) => {
    const nextDraft = buildDraftFromItem(item);
    setEditingId(item.id);
    setDraft(nextDraft);
    setSelectedSnapshot(nextDraft);
    setIsEditing(false);
  };

  const reset = () => {
    setEditingId('');
    setDraft({ ...blank });
    setSelectedSnapshot(null);
    setIsEditing(true);
  };

  const clearSelection = () => {
    reset();
  };

  const cancelEdit = () => {
    if (selectedSnapshot) {
      setDraft({ ...selectedSnapshot });
    }
    setIsEditing(false);
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
        ...(draft.groupId !== undefined ? {
          groupId: String(draft.groupId || '').trim(),
          groupName: productCategoryGroups.find((group) => group.id === draft.groupId)?.name || String(draft.groupName || '').trim()
        } : {}),
        ...(draft.sortOrder !== undefined ? { sortOrder: normalizeNumberOrNull(draft.sortOrder) ?? 0 } : {}),
        ...(draft.departmentId !== undefined ? { departmentId: draft.departmentId || 'retail' } : {}),
        ...(draft.color !== undefined ? { color: draft.color || '#64748b' } : {}),
        ...(draft.contactName !== undefined ? { contactName: String(draft.contactName || '').trim() } : {}),
        ...(draft.tel !== undefined ? { tel: String(draft.tel || '').trim() } : {}),
        ...(draft.email !== undefined ? { email: String(draft.email || '').trim() } : {}),
        ...(draft.address !== undefined ? { address: String(draft.address || '').trim() } : {}),
        ...(draft.defaultCostRate !== undefined ? { defaultCostRate: normalizeNumberOrNull(draft.defaultCostRate) } : {}),
        ...(draft.paymentTerms !== undefined ? { paymentTerms: String(draft.paymentTerms || '').trim() } : {}),
        ...(draft.supplierId !== undefined ? {
          supplierId: String(draft.supplierId || '').trim(),
          supplierName: suppliers.find((supplier) => supplier.id === draft.supplierId)?.name || String(draft.supplierName || '').trim()
        } : {}),
        ...(draft.supplierSmaregiId !== undefined ? { supplierSmaregiId: String(draft.supplierSmaregiId || '').trim() } : {}),
        ...(draft.stocktakingTypeCode !== undefined ? { stocktakingTypeCode: String(draft.stocktakingTypeCode || '').trim() } : {})
      };

      const savedDraft = { ...draft, ...payload };

      await onSave(payload);

      if (editingId) {
        setDraft(savedDraft);
        setSelectedSnapshot(savedDraft);
        setIsEditing(false);
      } else {
        reset();
      }

      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const canEdit = !editingId || isEditing;

  const renderListSubInfo = (item) => {
    if (label === '仕入先') {
      const costRateNumber = Number(item.defaultCostRate);
      const hasCostRate = Number.isFinite(costRateNumber) && costRateNumber > 0;
      const hasPaymentTerms = Boolean(String(item.paymentTerms || '').trim());

      return (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold leading-relaxed">
          <span className={hasCostRate ? 'text-slate-400' : 'text-orange-500'}>
            標準掛け率：{hasCostRate ? `${item.defaultCostRate}%` : '未設定'}
          </span>
          <span className={hasPaymentTerms ? 'text-slate-400' : 'text-orange-500'}>
            支払いサイト：{hasPaymentTerms ? item.paymentTerms : '未設定'}
          </span>
        </div>
      );
    }

    if (label === 'ブランド') {
      const supplier = suppliers.find((supplierItem) => supplierItem.id === item.supplierId) || null;
      const supplierName = item.supplierName || supplier?.name || '';
      const supplierCostRateNumber = Number(supplier?.defaultCostRate);
      const hasSupplierCostRate = Number.isFinite(supplierCostRateNumber) && supplierCostRateNumber > 0;

      if (supplierName || item.note || item.id) {
        return (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold leading-relaxed">
            <span className={supplierName ? 'text-slate-400' : 'text-orange-500'}>
              仕入先：{supplierName || '未設定'}
            </span>
            <span className={hasSupplierCostRate ? 'text-slate-400' : 'text-orange-500'}>
              標準掛け率：{hasSupplierCostRate ? `${supplier.defaultCostRate}%` : '未設定'}
            </span>
          </div>
        );
      }
    }

    return (
      <div className="mt-1 line-clamp-2 text-xs font-bold leading-relaxed text-slate-400">
        {item.groupName || productCategoryGroups.find((group) => group.id === item.groupId)?.name || item.supplierName || item.kana || item.contactName || item.paymentTerms || item.brandProfile || item.note || item.id}
      </div>
    );
  };

  const getEffectiveCostRateDisplay = () => {
    const brandCostRateNumber = Number(draft.defaultCostRate);
    if (Number.isFinite(brandCostRateNumber) && brandCostRateNumber > 0) {
      return {
        value: `${draft.defaultCostRate}%`,
        muted: false
      };
    }

    const supplier = suppliers.find((supplierItem) => supplierItem.id === draft.supplierId) || null;
    const supplierCostRateNumber = Number(supplier?.defaultCostRate);
    if (Number.isFinite(supplierCostRateNumber) && supplierCostRateNumber > 0) {
      return {
        value: `${supplier.defaultCostRate}%`,
        muted: false
      };
    }

    return {
      value: '未設定',
      muted: true
    };
  };

  const handleSortModeButton = async () => {
    if (!isSortableMaster || saving) return;

    if (!sortEditMode) {
      setSortDraftItems(sortedItems);
      setSortEditMode(true);
      return;
    }

    setSaving(true);
    try {
      for (let index = 0; index < displayItems.length; index += 1) {
        const nextItem = displayItems[index];
        const nextSortOrder = (index + 1) * 10;

        if (Number(nextItem.sortOrder) === nextSortOrder) continue;

        await onSave({
          ...nextItem,
          sortOrder: nextSortOrder
        });
      }

      onSaved?.();
      setSortEditMode(false);
      setSortDraftItems([]);
    } finally {
      setSaving(false);
    }
  };

  const moveItem = async (item, direction) => {
    if (!isSortableMaster || !item?.id || saving) return;

    const sourceItems = displayItems.length > 0 ? displayItems : sortedItems;
    const currentIndex = sourceItems.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sourceItems.length) return;

    const reorderedItems = [...sourceItems];
    const [movedItem] = reorderedItems.splice(currentIndex, 1);
    reorderedItems.splice(targetIndex, 0, movedItem);

    setSortDraftItems(reorderedItems);
  };

  const remove = async (item) => {
    if (!item?.id) return;
    if (!window.confirm(`${label}「${item.name || item.id}」を削除しますか？`)) return;
    await onDelete(item.id);
    onSaved?.();
  };

  return (
    <div className="grid min-h-0 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="max-h-[calc(100vh-15rem)] overflow-y-auto rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm xl:sticky xl:top-[9rem] xl:self-start">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-lg font-black text-slate-900">{editingId ? `${label}を確認` : `${label}を新規作成`}</div>
            <p className="mt-0.5 text-[11px] font-bold text-slate-400">左フォームは新規作成が基本です。右の一覧から選択すると確認・編集できます。</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {editingId ? (
              <>
                <button
                  type="button"
                  onClick={isEditing ? save : () => setIsEditing(true)}
                  disabled={saving}
                  className={classNames(
                    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black text-white shadow-lg transition disabled:opacity-60',
                    isEditing
                      ? 'bg-orange-500 shadow-orange-500/20'
                      : 'bg-slate-900 shadow-slate-900/10'
                  )}
                >
                  {saving ? <LoadingSpinner size={16} /> : isEditing ? <Save size={13} /> : <Check size={14} />}
                  {isEditing ? '保存' : '編集'}
                </button>
                <button
                  type="button"
                  onClick={isEditing ? cancelEdit : clearSelection}
                  disabled={saving}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 px-4 text-sm font-black text-slate-500 transition hover:bg-slate-200 disabled:opacity-60"
                >
                  {isEditing ? 'キャンセル' : '選択解除'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition disabled:opacity-60"
              >
                {saving ? <LoadingSpinner size={16} /> : <Save size={13} />}
                新規保存
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {fields.map((field) => (
            field.type === 'categoryGroupSelect' ? (
              <PosModalSelect
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                options={productCategoryGroups}
                disabled={!canEdit}
                placeholder="カテゴリーグループを選択"
                searchPlaceholder="グループ名・IDで検索"
                createLabel="グループを新規作成"
                onCreateSave={onSaveCategoryGroup}
                createFields={[
                  { id: 'name', label: 'グループ名' },
                  { id: 'sortOrder', label: '並び順', type: 'number' }
                ]}
                createInitialValue={{ name: '', sortOrder: 0, isActive: true }}
                onCreate={reset}
                getOptionLabel={(option) => option.name || option.id}
                getOptionSubLabel={(option) => option.smaregiCategoryGroupId || option.categoryGroupExternalId || option.externalCategoryGroupId || option.id}
                onChange={(value, group) => {
                  setDraft((current) => ({
                    ...current,
                    [field.id]: value,
                    groupName: group?.name || ''
                  }));
                  onSaved?.();
                }}
              />
            ) : field.type === 'supplierSelect' ? (
              <PosModalSelect
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                options={suppliers}
                disabled={!canEdit}
                placeholder="仕入先を選択"
                searchPlaceholder="仕入先名・IDで検索"
                createLabel="仕入先を新規作成"
                onCreateSave={onSaveSupplier}
                createFields={[
                  { id: 'name', label: '仕入先名' },
                  { id: 'contactName', label: '担当者' },
                  { id: 'tel', label: '電話番号' },
                  { id: 'email', label: 'メール' },
                  { id: 'address', label: '住所' },
                  { id: 'defaultCostRate', label: '標準掛け率 %', type: 'number' },
                  {
                    id: 'paymentTerms',
                    label: '支払いサイト',
                    type: 'select',
                    placeholder: '支払いサイトを選択',
                    options: [
                      { value: '月末締め翌月末払い', label: '月末締め翌月末払い' },
                      { value: 'COD', label: 'COD' }
                    ]
                  }
                ]}
                createInitialValue={{ name: '', contactName: '', tel: '', email: '', address: '', defaultCostRate: '', paymentTerms: '月末締め翌月末払い', isActive: true }}
                getOptionLabel={(option) => option.name || option.id}
                getOptionSubLabel={(option) => option.smaregiSupplierId || option.supplierSmaregiId || option.contactName || option.tel || option.id}
                onChange={(value, supplier) => {
                  setDraft((current) => ({
                    ...current,
                    [field.id]: value,
                    supplierName: supplier?.name || ''
                  }));
                  onSaved?.();
                }}
              />
            ) : field.type === 'effectiveCostRateDisplay' ? (
              <SimpleDisplayField
                key={field.id}
                label={field.label}
                value={getEffectiveCostRateDisplay().value}
                muted={getEffectiveCostRateDisplay().muted}
                helpText={field.helpText || ''}
              />
            ) : field.type === 'select' ? (
              <SimpleOptionSelectInput
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                options={field.options || []}
                disabled={!canEdit}
                placeholder={field.placeholder || '選択してください'}
                helpText={field.helpText || ''}
                onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
              />
            ) : field.type === 'textarea' ? (
              <SimpleTextareaInput
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                rows={field.rows || 6}
                disabled={!canEdit}
                onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
              />
            ) : (
              <SimpleTextInput
                key={field.id}
                label={field.label}
                type={field.type || 'text'}
                value={draft[field.id]}
                disabled={!canEdit}
                helpText={field.helpText || ''}
                onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
              />
            )
          ))}
          <SimpleToggle
            label="有効"
            checked={draft.isActive !== false}
            disabled={!canEdit}
            onChange={(value) => setDraft((current) => ({ ...current, isActive: value }))}
          />
        </div>

      </div>

      <div className="min-h-0 min-w-0 overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
        <div className="sticky top-0 z-10 space-y-3 border-b border-slate-100 bg-white px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-base font-black text-slate-900">{label}一覧</div>
            <div className="rounded-2xl bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-500">
              {filteredItems.length.toLocaleString()} / {items.length.toLocaleString()}件
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={`${label}を検索`}
              className="h-11 min-w-0 flex-1 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold text-slate-700 outline-none focus:border-orange-400 focus:bg-white"
            />
            {isSortableMaster && (
              <button
                type="button"
                onClick={handleSortModeButton}
                className={classNames(
                  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black shadow-lg transition',
                  sortEditMode
                    ? 'bg-blue-600 text-white shadow-blue-500/20'
                    : 'bg-slate-900 text-white shadow-slate-900/10'
                )}
              >
                {sortEditMode ? '保存' : '並び替え'}
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[calc(100vh-15rem)] divide-y divide-slate-100 overflow-y-auto">
          {displayItems.length === 0 ? (
            <div className="p-8 text-sm font-bold text-slate-400">
              {items.length === 0 ? 'まだ登録されていません。' : '検索条件に一致するデータがありません。'}
            </div>
          ) : (
            displayItems.map((item, itemIndex) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => startEdit(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    startEdit(item);
                  }
                }}
                className={classNames(
                  'flex min-w-0 cursor-pointer items-center justify-between gap-4 px-5 py-4 transition hover:bg-orange-50/40',
                  editingId === item.id ? 'bg-orange-50/70' : 'bg-white'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                  {renderListSubInfo(item)}
                </div>
                <div className="flex shrink-0 gap-2">
                  {isSortableMaster && sortEditMode && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          moveItem(item, -1);
                        }}
                        disabled={saving || itemIndex === 0}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-30"
                        aria-label="上へ"
                        title="上へ"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          moveItem(item, 1);
                        }}
                        disabled={saving || itemIndex === displayItems.length - 1}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-30"
                        aria-label="下へ"
                        title="下へ"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(item);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500"
                    aria-label="削除"
                  >
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
