import React, { useMemo, useState } from 'react';
import {
  Boxes,
  Building2,
  Factory,
  FolderTree,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  Tag,
  Trash2,
  X
} from 'lucide-react';

import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';

const PRODUCT_TABS = [
  { id: 'products', label: '商品', icon: Package },
  { id: 'categories', label: 'カテゴリー', icon: Tag },
  { id: 'groups', label: 'カテゴリーグループ', icon: FolderTree },
  { id: 'brands', label: 'ブランド', icon: Building2 },
  { id: 'suppliers', label: '仕入先', icon: Factory }
];

const blankProduct = {
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  categoryGroupId: '',
  brandId: '',
  supplierId: '',
  departmentId: 'retail',
  productType: 'retail',
  priceTaxIncluded: '',
  priceTaxExcluded: '',
  taxRateType: 'standard',
  taxRate: 10,
  costTaxExcluded: '',
  costTaxIncluded: '',
  supplierCostRate: '',
  reorderPoint: '',
  reorderLot: '',
  labelEnabled: true,
  isActive: true,
  isArchived: false,
  shopifyProductId: '',
  shopifyVariantId: '',
  shopifyInventoryItemId: ''
};

const blankCategory = {
  name: '',
  groupId: '',
  sortOrder: 0,
  departmentId: 'retail',
  color: '#64748b',
  isActive: true
};

const blankGroup = {
  name: '',
  sortOrder: 0,
  departmentId: 'retail',
  isActive: true
};

const blankBrand = {
  name: '',
  kana: '',
  note: '',
  isActive: true
};

const blankSupplier = {
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

const formatCurrency = (value) => {
  const number = Number(value || 0);
  return `¥${number.toLocaleString()}`;
};

const normalizeNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeProductPayload = (draft) => ({
  ...draft,
  name: String(draft.name || '').trim(),
  sku: String(draft.sku || '').trim(),
  barcode: String(draft.barcode || '').trim(),
  categoryId: String(draft.categoryId || '').trim(),
  categoryGroupId: String(draft.categoryGroupId || '').trim(),
  brandId: String(draft.brandId || '').trim(),
  supplierId: String(draft.supplierId || '').trim(),
  departmentId: draft.departmentId || 'retail',
  productType: draft.productType || 'retail',
  priceTaxIncluded: normalizeNumberOrNull(draft.priceTaxIncluded),
  priceTaxExcluded: normalizeNumberOrNull(draft.priceTaxExcluded),
  taxRateType: draft.taxRateType || 'standard',
  taxRate: normalizeNumberOrNull(draft.taxRate) ?? 10,
  costTaxExcluded: normalizeNumberOrNull(draft.costTaxExcluded),
  costTaxIncluded: normalizeNumberOrNull(draft.costTaxIncluded),
  supplierCostRate: normalizeNumberOrNull(draft.supplierCostRate),
  reorderPoint: normalizeNumberOrNull(draft.reorderPoint),
  reorderLot: normalizeNumberOrNull(draft.reorderLot),
  labelEnabled: draft.labelEnabled !== false,
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

const SelectField = ({ label, value, onChange, children }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <select
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-400"
    >
      {children}
    </select>
  </label>
);

const TextField = ({ label, value, onChange, type = 'text', placeholder = '' }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">{label}</span>
    <input
      type={type}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-orange-400"
    />
  </label>
);

const ToggleField = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`flex h-12 items-center justify-between rounded-2xl border-2 px-4 text-sm font-black transition ${
      checked
        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
        : 'border-slate-100 bg-slate-50 text-slate-400'
    }`}
  >
    <span>{label}</span>
    <span>{checked ? 'ON' : 'OFF'}</span>
  </button>
);

const EmptyState = ({ label }) => (
  <div className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-white p-10 text-center">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">
      <Boxes size={28} />
    </div>
    <div className="text-base font-black text-slate-700">{label}はまだ登録されていません</div>
    <p className="mt-2 text-sm font-bold text-slate-400">右上の追加ボタンから登録できます。</p>
  </div>
);

const ProductForm = ({
  draft,
  setDraft,
  categories,
  groups,
  brands,
  suppliers,
  onCancel,
  onSave,
  saving
}) => (
  <div className="rounded-[2rem] border border-orange-100 bg-white p-6 shadow-sm">
    <div className="mb-6 flex items-center justify-between">
      <div>
        <div className="text-lg font-black text-slate-900">
          {draft.id ? '商品を編集' : '商品を追加'}
        </div>
        <p className="mt-1 text-sm font-bold text-slate-400">
          物販POS / Inventory用の商品です。既存の飲食メニューには影響しません。
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"
      >
        <X size={18} />
      </button>
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <TextField label="商品名" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
      <TextField label="SKU" value={draft.sku} onChange={(value) => setDraft({ ...draft, sku: value })} />
      <TextField label="バーコード" value={draft.barcode} onChange={(value) => setDraft({ ...draft, barcode: value })} />

      <SelectField label="カテゴリーグループ" value={draft.categoryGroupId} onChange={(value) => setDraft({ ...draft, categoryGroupId: value })}>
        <option value="">未設定</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </SelectField>

      <SelectField label="カテゴリー" value={draft.categoryId} onChange={(value) => setDraft({ ...draft, categoryId: value })}>
        <option value="">未設定</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </SelectField>

      <SelectField label="ブランド" value={draft.brandId} onChange={(value) => setDraft({ ...draft, brandId: value })}>
        <option value="">未設定</option>
        {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
      </SelectField>

      <SelectField label="仕入先" value={draft.supplierId} onChange={(value) => setDraft({ ...draft, supplierId: value })}>
        <option value="">未設定</option>
        {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
      </SelectField>

      <SelectField label="部門" value={draft.departmentId} onChange={(value) => setDraft({ ...draft, departmentId: value })}>
        <option value="retail">物販</option>
        <option value="food">飲食</option>
      </SelectField>

      <SelectField label="商品種別" value={draft.productType} onChange={(value) => setDraft({ ...draft, productType: value })}>
        <option value="retail">物販商品</option>
        <option value="food">飲食商品</option>
        <option value="service">サービス</option>
      </SelectField>

      <TextField label="税込販売価格" type="number" value={draft.priceTaxIncluded} onChange={(value) => setDraft({ ...draft, priceTaxIncluded: value })} />
      <TextField label="税抜販売価格" type="number" value={draft.priceTaxExcluded} onChange={(value) => setDraft({ ...draft, priceTaxExcluded: value })} />

      <SelectField label="税区分" value={draft.taxRateType} onChange={(value) => setDraft({ ...draft, taxRateType: value, taxRate: value === 'reduced' ? 8 : value === 'exempt' ? 0 : 10 })}>
        <option value="standard">標準税率</option>
        <option value="reduced">軽減税率</option>
        <option value="exempt">非課税/対象外</option>
      </SelectField>

      <TextField label="税率" type="number" value={draft.taxRate} onChange={(value) => setDraft({ ...draft, taxRate: value })} />
      <TextField label="税抜原価" type="number" value={draft.costTaxExcluded} onChange={(value) => setDraft({ ...draft, costTaxExcluded: value })} />
      <TextField label="税込原価" type="number" value={draft.costTaxIncluded} onChange={(value) => setDraft({ ...draft, costTaxIncluded: value })} />
      <TextField label="仕入掛け率 %" type="number" value={draft.supplierCostRate} onChange={(value) => setDraft({ ...draft, supplierCostRate: value })} />
      <TextField label="発注点" type="number" value={draft.reorderPoint} onChange={(value) => setDraft({ ...draft, reorderPoint: value })} />
      <TextField label="発注ロット" type="number" value={draft.reorderLot} onChange={(value) => setDraft({ ...draft, reorderLot: value })} />
      <TextField label="Shopify Product ID" value={draft.shopifyProductId} onChange={(value) => setDraft({ ...draft, shopifyProductId: value })} />
      <TextField label="Shopify Variant ID" value={draft.shopifyVariantId} onChange={(value) => setDraft({ ...draft, shopifyVariantId: value })} />
      <TextField label="Shopify Inventory Item ID" value={draft.shopifyInventoryItemId} onChange={(value) => setDraft({ ...draft, shopifyInventoryItemId: value })} />

      <ToggleField label="ラベル印刷対象" checked={draft.labelEnabled !== false} onChange={(value) => setDraft({ ...draft, labelEnabled: value })} />
      <ToggleField label="有効" checked={draft.isActive !== false} onChange={(value) => setDraft({ ...draft, isActive: value })} />
      <ToggleField label="アーカイブ" checked={Boolean(draft.isArchived)} onChange={(value) => setDraft({ ...draft, isArchived: value })} />
    </div>

    <div className="mt-6 flex justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="h-12 rounded-2xl bg-slate-100 px-5 text-sm font-black text-slate-500"
      >
        キャンセル
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !String(draft.name || '').trim()}
        className="flex h-12 items-center gap-2 rounded-2xl bg-orange-500 px-6 text-sm font-black text-white shadow-lg shadow-orange-500/20 disabled:opacity-50"
      >
        {saving ? <LoadingSpinner size={16} /> : <Save size={17} />}
        保存
      </button>
    </div>
  </div>
);

const SimpleForm = ({ title, fields, draft, setDraft, onCancel, onSave, saving }) => (
  <div className="rounded-[2rem] border border-orange-100 bg-white p-6 shadow-sm">
    <div className="mb-6 flex items-center justify-between">
      <div className="text-lg font-black text-slate-900">{title}</div>
      <button type="button" onClick={onCancel} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <X size={18} />
      </button>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      {fields.map((field) => (
        <TextField
          key={field.id}
          label={field.label}
          type={field.type || 'text'}
          value={draft[field.id]}
          onChange={(value) => setDraft({ ...draft, [field.id]: value })}
        />
      ))}
      <ToggleField label="有効" checked={draft.isActive !== false} onChange={(value) => setDraft({ ...draft, isActive: value })} />
    </div>
    <div className="mt-6 flex justify-end gap-3">
      <button type="button" onClick={onCancel} className="h-12 rounded-2xl bg-slate-100 px-5 text-sm font-black text-slate-500">キャンセル</button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !String(draft.name || '').trim()}
        className="flex h-12 items-center gap-2 rounded-2xl bg-orange-500 px-6 text-sm font-black text-white shadow-lg shadow-orange-500/20 disabled:opacity-50"
      >
        {saving ? <LoadingSpinner size={16} /> : <Save size={17} />}
        保存
      </button>
    </div>
  </div>
);

const ProductList = ({ products, categoriesById, groupsById, brandsById, suppliersById, onEdit, onDelete }) => {
  if (products.length === 0) return <EmptyState label="商品" />;

  return (
    <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white shadow-sm">
      <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_0.9fr_0.8fr_96px] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3 text-[11px] font-black tracking-widest text-slate-400">
        <span>商品</span>
        <span>価格</span>
        <span>カテゴリー</span>
        <span>ブランド/仕入先</span>
        <span>在庫設定</span>
        <span className="text-right">操作</span>
      </div>
      {products.map((product) => (
        <div key={product.id} className="grid grid-cols-[1.5fr_0.8fr_0.9fr_0.9fr_0.8fr_96px] items-center gap-3 border-b border-slate-50 px-5 py-4 last:border-b-0">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900">{product.name}</div>
            <div className="mt-1 truncate text-xs font-bold text-slate-400">
              SKU {product.sku || '-'} / Barcode {product.barcode || '-'}
            </div>
          </div>
          <div>
            <div className="text-sm font-black text-slate-900">{formatCurrency(product.priceTaxIncluded)}</div>
            <div className="text-xs font-bold text-slate-400">税抜 {formatCurrency(product.priceTaxExcluded)}</div>
          </div>
          <div className="text-xs font-bold text-slate-500">
            <div>{categoriesById[product.categoryId]?.name || '未設定'}</div>
            <div className="mt-1 text-slate-300">{groupsById[product.categoryGroupId]?.name || ''}</div>
          </div>
          <div className="text-xs font-bold text-slate-500">
            <div>{brandsById[product.brandId]?.name || 'ブランド未設定'}</div>
            <div className="mt-1 text-slate-300">{suppliersById[product.supplierId]?.name || '仕入先未設定'}</div>
          </div>
          <div className="text-xs font-bold text-slate-500">
            <div>発注点 {product.reorderPoint ?? '-'}</div>
            <div className="mt-1 text-slate-300">ラベル {product.labelEnabled === false ? 'OFF' : 'ON'}</div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onEdit(product)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <Pencil size={15} />
            </button>
            <button type="button" onClick={() => onDelete(product)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const SimpleList = ({ label, items, onEdit, onDelete }) => {
  if (items.length === 0) return <EmptyState label={label} />;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
            <div className="mt-1 truncate text-xs font-bold text-slate-400">
              {item.kana || item.contactName || item.paymentTerms || item.note || item.id}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => onEdit(item)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <Pencil size={15} />
            </button>
            <button type="button" onClick={() => onDelete(item)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
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
  onSaved
}) => {
  const [activeTab, setActiveTab] = useState('products');
  const [keyword, setKeyword] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const categoriesById = useMemo(
    () => Object.fromEntries(productCategories.map((item) => [item.id, item])),
    [productCategories]
  );
  const groupsById = useMemo(
    () => Object.fromEntries(productCategoryGroups.map((item) => [item.id, item])),
    [productCategoryGroups]
  );
  const brandsById = useMemo(
    () => Object.fromEntries(brands.map((item) => [item.id, item])),
    [brands]
  );
  const suppliersById = useMemo(
    () => Object.fromEntries(suppliers.map((item) => [item.id, item])),
    [suppliers]
  );

  const filterItems = (items) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return items;

    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(normalizedKeyword));
  };

  const startAdd = () => {
    if (activeTab === 'products') setDraft({ ...blankProduct });
    if (activeTab === 'categories') setDraft({ ...blankCategory });
    if (activeTab === 'groups') setDraft({ ...blankGroup });
    if (activeTab === 'brands') setDraft({ ...blankBrand });
    if (activeTab === 'suppliers') setDraft({ ...blankSupplier });
  };

  const saveDraft = async () => {
    if (!draft || saving) return;

    setSaving(true);

    try {
      if (activeTab === 'products') {
        await onSaveProduct(normalizeProductPayload(draft));
      }

      if (activeTab === 'categories') {
        await onSaveCategory({
          ...normalizeSimplePayload(draft, blankCategory),
          groupId: String(draft.groupId || '').trim(),
          sortOrder: normalizeNumberOrNull(draft.sortOrder) ?? 0,
          departmentId: draft.departmentId || 'retail',
          color: draft.color || '#64748b'
        });
      }

      if (activeTab === 'groups') {
        await onSaveCategoryGroup({
          ...normalizeSimplePayload(draft, blankGroup),
          sortOrder: normalizeNumberOrNull(draft.sortOrder) ?? 0,
          departmentId: draft.departmentId || 'retail'
        });
      }

      if (activeTab === 'brands') {
        await onSaveBrand(normalizeSimplePayload(draft, blankBrand));
      }

      if (activeTab === 'suppliers') {
        await onSaveSupplier({
          ...normalizeSimplePayload(draft, blankSupplier),
          contactName: String(draft.contactName || '').trim(),
          tel: String(draft.tel || '').trim(),
          email: String(draft.email || '').trim(),
          address: String(draft.address || '').trim(),
          defaultCostRate: normalizeNumberOrNull(draft.defaultCostRate),
          paymentTerms: String(draft.paymentTerms || '').trim()
        });
      }

      setDraft(null);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const deleteWithConfirm = async (item, handler, label) => {
    if (!item?.id) return;
    if (!window.confirm(`${label}「${item.name || item.id}」を削除しますか？`)) return;
    await handler(item.id);
    onSaved?.();
  };

  const currentTab = PRODUCT_TABS.find((tab) => tab.id === activeTab) || PRODUCT_TABS[0];

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] bg-gradient-to-br from-slate-900 to-slate-800 p-7 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black tracking-widest text-orange-200">
              AKUTO INVENTORY
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight">商品マスター</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-300">
              物販POS / 入庫 / 棚卸し / 自動発注 / Shopify在庫連携の土台です。
              飲食Mobile Orderの menuItems とは分離して保存します。
            </p>
          </div>
          <button
            type="button"
            onClick={startAdd}
            className="flex h-12 items-center gap-2 rounded-2xl bg-orange-500 px-5 text-sm font-black text-white shadow-lg shadow-orange-500/20"
          >
            <Plus size={18} />
            追加
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {PRODUCT_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setDraft(null);
              }}
              className={`flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${
                active
                  ? 'border-orange-200 bg-orange-50 text-orange-600'
                  : 'border-slate-100 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Icon size={17} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black text-slate-900">{currentTab.label}</div>
          <p className="mt-1 text-sm font-bold text-slate-400">
            Phase 1では登録・編集・削除まで。POS販売・在庫連動は次フェーズで接続します。
          </p>
        </div>

        <div className="relative w-full max-w-sm">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="検索"
            className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white pl-11 pr-4 text-sm font-bold text-slate-700 outline-none focus:border-orange-400"
          />
        </div>
      </div>

      {loading && (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {!loading && draft && activeTab === 'products' && (
        <ProductForm
          draft={draft}
          setDraft={setDraft}
          categories={productCategories}
          groups={productCategoryGroups}
          brands={brands}
          suppliers={suppliers}
          saving={saving}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {!loading && draft && activeTab === 'categories' && (
        <SimpleForm
          title={draft.id ? 'カテゴリーを編集' : 'カテゴリーを追加'}
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          fields={[
            { id: 'name', label: 'カテゴリー名' },
            { id: 'groupId', label: 'グループID' },
            { id: 'sortOrder', label: '並び順', type: 'number' },
            { id: 'color', label: 'カラー' }
          ]}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {!loading && draft && activeTab === 'groups' && (
        <SimpleForm
          title={draft.id ? 'カテゴリーグループを編集' : 'カテゴリーグループを追加'}
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          fields={[
            { id: 'name', label: 'グループ名' },
            { id: 'sortOrder', label: '並び順', type: 'number' }
          ]}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {!loading && draft && activeTab === 'brands' && (
        <SimpleForm
          title={draft.id ? 'ブランドを編集' : 'ブランドを追加'}
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          fields={[
            { id: 'name', label: 'ブランド名' },
            { id: 'kana', label: 'かな' },
            { id: 'note', label: 'メモ' }
          ]}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {!loading && draft && activeTab === 'suppliers' && (
        <SimpleForm
          title={draft.id ? '仕入先を編集' : '仕入先を追加'}
          draft={draft}
          setDraft={setDraft}
          saving={saving}
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
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {!loading && !draft && activeTab === 'products' && (
        <ProductList
          products={filterItems(products)}
          categoriesById={categoriesById}
          groupsById={groupsById}
          brandsById={brandsById}
          suppliersById={suppliersById}
          onEdit={(item) => setDraft({ ...blankProduct, ...item })}
          onDelete={(item) => deleteWithConfirm(item, onDeleteProduct, '商品')}
        />
      )}

      {!loading && !draft && activeTab === 'categories' && (
        <SimpleList
          label="カテゴリー"
          items={filterItems(productCategories)}
          onEdit={(item) => setDraft({ ...blankCategory, ...item })}
          onDelete={(item) => deleteWithConfirm(item, onDeleteCategory, 'カテゴリー')}
        />
      )}

      {!loading && !draft && activeTab === 'groups' && (
        <SimpleList
          label="カテゴリーグループ"
          items={filterItems(productCategoryGroups)}
          onEdit={(item) => setDraft({ ...blankGroup, ...item })}
          onDelete={(item) => deleteWithConfirm(item, onDeleteCategoryGroup, 'カテゴリーグループ')}
        />
      )}

      {!loading && !draft && activeTab === 'brands' && (
        <SimpleList
          label="ブランド"
          items={filterItems(brands)}
          onEdit={(item) => setDraft({ ...blankBrand, ...item })}
          onDelete={(item) => deleteWithConfirm(item, onDeleteBrand, 'ブランド')}
        />
      )}

      {!loading && !draft && activeTab === 'suppliers' && (
        <SimpleList
          label="仕入先"
          items={filterItems(suppliers)}
          onEdit={(item) => setDraft({ ...blankSupplier, ...item })}
          onDelete={(item) => deleteWithConfirm(item, onDeleteSupplier, '仕入先')}
        />
      )}
    </div>
  );
};

export default ProductMasterSettings;
