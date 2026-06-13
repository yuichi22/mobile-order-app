import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
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
import { db } from '../../../shared/api/firebase/client';

const PRODUCT_MASTER_HEADER_SEARCH_LIMIT = 200;
const PRODUCT_MASTER_HEADER_CANDIDATE_LIMIT = 500;

const normalizeProductMasterSearchText = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
);

const addProductMasterSearchTerm = (terms, value) => {
  const normalized = normalizeProductMasterSearchText(value);
  if (!normalized) return;

  terms.add(normalized);

  normalized.split(/[\s　/／・,，、.。_\-ー]+/).forEach((part) => {
    const token = normalizeProductMasterSearchText(part);
    if (token) terms.add(token);
  });

  const compact = normalized.replace(/[\s　/／・,，、.。_\-ー]+/g, '');
  if (compact) terms.add(compact);
};

const buildProductMasterHeaderSearchTerms = (keyword) => {
  const terms = new Set();
  addProductMasterSearchTerm(terms, keyword);
  return Array.from(terms).filter(Boolean).slice(0, 30);
};

const buildProductMasterRequiredSearchTerms = (keyword) => (
  normalizeProductMasterSearchText(keyword)
    .split(/[\s　]+/)
    .map((term) => normalizeProductMasterSearchText(term))
    .filter(Boolean)
);

const productMatchesAllHeaderSearchTerms = (product, requiredTerms) => {
  if (!requiredTerms.length) return true;

  const keywordSet = new Set(
    Array.isArray(product?.searchKeywords)
      ? product.searchKeywords.map((value) => normalizeProductMasterSearchText(value)).filter(Boolean)
      : []
  );

  const fallbackText = normalizeProductMasterSearchText([
    product?.name,
    product?.sku,
    product?.productCode,
    product?.barcode,
    product?.brandName,
    product?.categoryGroupName,
    product?.categoryName,
    product?.subCategoryName,
    product?.salesAreaName,
    product?.productType,
    product?.colorName,
    product?.color,
    product?.size,
    product?.sizeName
  ].filter(Boolean).join(' '));

  return requiredTerms.every((term) => (
    keywordSet.has(term)
    || Array.from(keywordSet).some((keyword) => keyword.includes(term))
    || fallbackText.includes(term)
  ));
};

const PRODUCT_TABS = [
  { id: 'products', label: '商品', icon: Package }
];

const blankProduct = {
  name: '',
  sku: '',
  productCode: '',
  barcode: '',
  categoryId: '',
  subCategoryName: '',
  salesAreaName: '',
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
  shopifyEnabled: false,
  isActive: true,
  isArchived: false,
  shopifyProductId: '',
  shopifyVariantId: '',
  shopifyInventoryItemId: '',
  productGroupId: '',
  productGroupRole: 'primary',
  productGroupName: '',
  groupCode: ''
};

export const blankCategory = {
  name: '',
  groupId: '',
  sortOrder: 0,
  departmentId: 'retail',
  color: '#64748b',
  taxRateType: 'inherit',
  taxRate: null,
  isActive: true
};

export const blankGroup = {
  name: '',
  sortOrder: 0,
  departmentId: 'retail',
  taxRateType: 'inherit',
  taxRate: null,
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

const formatProductMasterDateTimeText = (value) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getProductMasterTimestampMs = (value) => {
  if (!value) return 0;
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
};

const getProductMasterSortTimestamp = (product) => Math.max(
  getProductMasterTimestampMs(product.createdAt),
  getProductMasterTimestampMs(product.created_at),
  getProductMasterTimestampMs(product.updatedAt),
  getProductMasterTimestampMs(product.updated_at)
);

const normalizeProductPayload = (draft) => ({
  ...draft,
  name: String(draft.name || '').trim(),
  sku: String(draft.sku || '').trim(),
  productCode: String(draft.productCode || '').trim(),
  barcode: String(draft.barcode || '').trim(),
  categoryId: String(draft.categoryId || '').trim(),
  subCategoryName: String(draft.subCategoryName || '').trim(),
  salesAreaName: String(draft.salesAreaName || '').trim(),
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
  shopifyCreateEnabled: Boolean(draft.shopifyCreateEnabled || draft.shopifyEnabled),
  shopifyEnabled: Boolean(draft.shopifyEnabled || draft.shopifyCreateEnabled),
  isActive: draft.isActive !== false,
  isArchived: Boolean(draft.isArchived),
  shopifyProductId: String(draft.shopifyProductId || '').trim(),
  shopifyVariantId: String(draft.shopifyVariantId || '').trim(),
  shopifyInventoryItemId: String(draft.shopifyInventoryItemId || '').trim(),
  productGroupId: String(draft.productGroupId || '').trim(),
  productGroupRole: draft.productGroupRole || 'primary',
  productGroupName: String(draft.productGroupName || '').trim(),
  groupCode: String(draft.groupCode || '').trim()
});

const normalizeSimplePayload = (draft, fallback = {}) => {
  const hasTaxRateType = draft.taxRateType !== undefined || fallback.taxRateType !== undefined;
  const taxRateType = hasTaxRateType
    ? normalizeMasterTaxRateType(draft.taxRateType ?? fallback.taxRateType)
    : undefined;

  return {
    ...fallback,
    ...draft,
    name: String(draft.name || '').trim(),
    kana: String(draft.kana || '').trim(),
    note: String(draft.note || '').trim(),
    ...(hasTaxRateType ? {
      taxRateType,
      taxRate: resolveMasterTaxRate(taxRateType, draft.taxRate ?? fallback.taxRate)
    } : {}),
    isActive: draft.isActive !== false
  };
};


const normalizeCascadeTaxRateValue = (value, fallback = 10) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
};

const calculateCascadeTaxIncludedPrice = (priceTaxExcluded, taxRate = 10) => {
  const excluded = Number(priceTaxExcluded);
  if (!Number.isFinite(excluded) || excluded <= 0) return null;

  const rate = normalizeCascadeTaxRateValue(taxRate, 10);
  return Math.floor(excluded * (100 + rate) / 100);
};

const hasMasterTaxRateChanged = (before = {}, after = {}) => {
  const beforeType = before.taxRateType || '';
  const afterType = after.taxRateType || '';
  const beforeRate = normalizeCascadeTaxRateValue(before.taxRate, null);
  const afterRate = normalizeCascadeTaxRateValue(after.taxRate, null);

  return beforeType !== afterType || beforeRate !== afterRate;
};

const getCascadeMatchedProducts = ({
  products = [],
  cascadeTaxLevel = '',
  masterId = '',
  masterName = ''
}) => {
  const id = String(masterId || '').trim();
  const name = String(masterName || '').trim();

  return (products || []).filter((product = {}) => {
    if (!product?.id) return false;

    if (cascadeTaxLevel === 'group') {
      return (
        (id && (product.categoryGroupId === id || product.groupId === id)) ||
        (name && (product.categoryGroupName === name || product.groupName === name))
      );
    }

    if (cascadeTaxLevel === 'category') {
      return (
        (id && (product.categoryId === id || product.categoryDocId === id)) ||
        (name && product.categoryName === name)
      );
    }

    if (cascadeTaxLevel === 'subCategory') {
      return (
        (id && (product.subCategoryId === id || product.subCategoryDocId === id)) ||
        (name && product.subCategoryName === name)
      );
    }

    return false;
  });
};

const cascadeMasterTaxRateToProducts = async ({
  storeId,
  products = [],
  cascadeTaxLevel = '',
  masterId = '',
  masterName = '',
  taxRate,
  taxRateType
}) => {
  if (!storeId || !cascadeTaxLevel || !masterId) {
    return { scanned: products.length, matched: 0, updated: 0 };
  }

  const normalizedTaxRate = normalizeCascadeTaxRateValue(taxRate, 10);
  const normalizedTaxRateType = normalizeMasterTaxRateType(taxRateType);
  const matchedProducts = getCascadeMatchedProducts({
    products,
    cascadeTaxLevel,
    masterId,
    masterName
  });

  let updated = 0;
  let batch = writeBatch(db);
  let batchCount = 0;

  for (const product of matchedProducts) {
    const priceTaxExcluded = Number(product.priceTaxExcluded ?? product.price ?? product.salesPrice ?? 0);
    const priceTaxIncluded = calculateCascadeTaxIncludedPrice(priceTaxExcluded, normalizedTaxRate);

    batch.set(
      doc(db, 'stores', storeId, 'products', product.id),
      {
        taxRate: normalizedTaxRate,
        taxRateType: normalizedTaxRateType,
        priceTaxIncluded,
        updatedAt: serverTimestamp(),
        taxRateCascadeUpdatedAt: serverTimestamp(),
        taxRateCascadeLevel: cascadeTaxLevel,
        taxRateCascadeMasterId: masterId,
        taxRateCascadeMasterName: masterName || ''
      },
      { merge: true }
    );

    updated += 1;
    batchCount += 1;

    if (batchCount >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return {
    scanned: products.length,
    matched: matchedProducts.length,
    updated
  };
};

const normalizeMasterTaxRateType = (value) => (
  ['inherit', 'standard', 'reduced', 'taxFree'].includes(value) ? value : 'inherit'
);

const resolveMasterTaxRate = (taxRateType, value) => {
  const normalizedType = normalizeMasterTaxRateType(taxRateType);
  if (normalizedType === 'standard') return 10;
  if (normalizedType === 'reduced') return 8;
  if (normalizedType === 'taxFree') return 0;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const MASTER_TAX_RATE_OPTIONS = [
  { id: 'inherit', label: '標準税率を使用', rate: null },
  { id: 'standard', label: '10% 標準税率', rate: 10 },
  { id: 'reduced', label: '8% 軽減税率', rate: 8 },
  { id: 'taxFree', label: '0% 非課税 / 対象外', rate: 0 }
];

const getMasterTaxRateOptions = (defaultTaxRate = 10) => {
  const normalizedDefault = Number(defaultTaxRate) === 8 ? 8 : 10;

  return MASTER_TAX_RATE_OPTIONS
    .map((option) => (
      option.id === 'inherit'
        ? { ...option, label: `標準税率を使用（${normalizedDefault}%）` }
        : option
    ))
    .filter((option) => option.id === 'inherit' || option.rate !== normalizedDefault);
};

const formatMasterTaxRateLabel = (item = {}, defaultTaxRate = 10) => {
  const normalizedDefault = Number(defaultTaxRate) === 8 ? 8 : 10;
  const taxRateType = normalizeMasterTaxRateType(item.taxRateType);
  if (taxRateType === 'standard') return '10%';
  if (taxRateType === 'reduced') return '8%';
  if (taxRateType === 'taxFree') return '0%';
  return `標準税率（${normalizedDefault}%）`;
};

const classNames = (...values) => values.filter(Boolean).join(' ');

const TableTextInput = ({ value, onChange, type = 'text', className = '', placeholder = '' }) => (
  <input
    type={type}
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    inputMode={type === 'number' ? 'decimal' : undefined}
    className={classNames(
      'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-900 shadow-sm outline-none transition [appearance:textfield] focus:border-orange-400 focus:ring-2 focus:ring-orange-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
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
        'h-9 w-full rounded-lg border px-2.5 text-sm font-black shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100',
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
      'inline-flex h-8 min-w-[108px] items-center justify-center whitespace-nowrap rounded-full px-4 text-xs font-black transition active:scale-95',
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

const PRODUCT_SAVED_ROW_COMPARE_FIELDS = [
  'name',
  'sku',
  'productCode',
  'barcode',
  'size',
  'colorName',
  'brandId',
  'categoryId',
  'subCategoryName',
  'salesAreaName',
  'priceTaxIncluded'
];

const normalizeSavedProductCompareValue = (value) => (
  value === null || value === undefined ? '' : String(value)
);

const isSavedProductVisibleInSnapshot = (product = {}, saved = {}) => (
  PRODUCT_SAVED_ROW_COMPARE_FIELDS.every((field) => (
    normalizeSavedProductCompareValue(product[field])
      === normalizeSavedProductCompareValue(saved[field])
  ))
);


const calculateProductMasterTaxIncludedPrice = (priceTaxExcluded, taxRate = 10) => {
  const excluded = Number(priceTaxExcluded);
  if (!Number.isFinite(excluded)) return '';

  const rate = Number(taxRate);
  const normalizedRate = Number.isFinite(rate) ? Math.max(rate, 0) : 10;

  return Math.floor(excluded * (100 + normalizedRate) / 100);
};

const ProductMasterTable = ({
  products,
  productGroups = [],
  productCategories,
  productCategoryGroups,
  productSubCategories = [],
  productSalesAreas = [],
  brands,
  suppliers,
  onSaveProduct,
  onDeleteProduct,
  onCreateShopifyDraftProduct,
  onUpdateShopifyProduct,
  onSaved
}) => {
  const [draftRows, setDraftRows] = useState({});
  const [recentlySavedRows, setRecentlySavedRows] = useState({});
  const [pendingShopifySyncProductIds, setPendingShopifySyncProductIds] = useState(() => new Set());
  const [newRow, setNewRow] = useState({ ...blankProduct });
  const [newSkuRows, setNewSkuRows] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [shopifySyncingGroupId, setShopifySyncingGroupId] = useState(null);
  const [shopifyBulkSyncing, setShopifyBulkSyncing] = useState(false);
  const [productMasterBulkSaving, setProductMasterBulkSaving] = useState(false);

  const getDraft = (product) => draftRows[product.id] || recentlySavedRows[product.id] || product;

  useEffect(() => {
    setRecentlySavedRows((current) => {
      const next = { ...current };
      let changed = false;

      products.forEach((product) => {
        const saved = next[product.id];
        if (saved && isSavedProductVisibleInSnapshot(product, saved)) {
          delete next[product.id];
          changed = true;
        }
      });


      return changed ? next : current;
    });
  }, [products]);

  const rememberSavedProduct = (payload) => {
    if (!payload?.id) return;

    setRecentlySavedRows((current) => ({
      ...current,
      [payload.id]: {
        ...(products.find((product) => product.id === payload.id) || {}),
        ...(current[payload.id] || {}),
        ...payload
      }
    }));
  };

  const getSubCategoryOptions = (categoryId) => {
    const normalizedCategoryId = String(categoryId || '').trim();
    if (!normalizedCategoryId) return [];
    return productSubCategories
      .filter((item) => String(item.categoryId || '').trim() === normalizedCategoryId)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  };

  const getSalesAreaOptions = () => (
    productSalesAreas
      .filter((item) => String(item?.name || '').trim())
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
  );

  const getGroupProductGroupId = (group) => (
    String(
      group?.id
      || group?.productGroupId
      || group?.products?.find((product) => product?.productGroupId)?.productGroupId
      || group?.products?.[0]?.productGroupId
      || ''
    ).trim()
  );

  const getGroupShopifyProductId = (group) => (
    String(
      group?.shopifyProductId
      || group?.products?.find((product) => product?.shopifyProductId)?.shopifyProductId
      || ''
    ).trim()
  );

  const getGroupBrandName = (group) => (
    String(
      group?.brandName
      || group?.products?.find((product) => product?.brandName)?.brandName
      || ''
    ).trim()
  );

  const getGroupCategoryName = (group) => (
    String(
      group?.categoryName
      || group?.products?.find((product) => product?.categoryName)?.categoryName
      || ''
    ).trim()
  );

  const getGroupDisplayName = (group) => (
    String(
      group?.name
      || group?.productGroupName
      || group?.baseProductName
      || group?.products?.find((product) => product?.productGroupRole === 'primary')?.name
      || group?.products?.[0]?.name
      || '名称未設定の商品'
    ).trim()
  );

  const getWorkingGroup = (group) => {
    const workingProducts = (group?.products || []).map((product) => getDraft(product));
    const primaryProduct = workingProducts.find((product) => product.productGroupRole === 'primary') || workingProducts[0] || {};

    return {
      ...group,
      name: primaryProduct.productGroupName || primaryProduct.name || group?.name || '',
      brandName: primaryProduct.brandName || group?.brandName || '',
      categoryName: primaryProduct.categoryName || group?.categoryName || '',
      salesAreaName: primaryProduct.salesAreaName || group?.salesAreaName || '',
      products: workingProducts
    };
  };

  const confirmShopifySyncMissingFields = (group) => {
    const missingLabels = [];
    if (!getGroupBrandName(group)) missingLabels.push('ブランド');
    if (!getGroupCategoryName(group)) missingLabels.push('カテゴリー');

    if (missingLabels.length === 0) return true;

    const message = [
      `対象商品: ${getGroupDisplayName(group)}`,
      '',
      `${missingLabels.join('・')}が未設定です。`,
      '',
      !getGroupBrandName(group) ? 'Shopifyの商品ブランド（vendor）は空欄で作成されます。' : '',
      !getGroupCategoryName(group) ? 'Shopifyの商品タイプ・カテゴリータグなしで作成されます。' : '',
      '',
      'このままShopify同期を実行しますか？'
    ].filter((line) => line !== '').join('\n');

    return window.confirm(message);
  };

  const getProductGroupSortKey = (product) => (
    product.productGroupId
      || product.productGroupName
      || product.id
      || ''
  );

  const groupedProducts = useMemo(() => {
    const productGroupById = new Map((productGroups || []).map((group) => [group.id, group]));
    const groups = new Map();

    for (const product of products || []) {
      const savedProductGroup = productGroupById.get(product.productGroupId || product.groupId || '');
      const productWithGroup = {
        ...product,
        productGroupName: product.productGroupName || savedProductGroup?.name || savedProductGroup?.baseProductName || '',
        brandId: product.brandId || savedProductGroup?.brandId || '',
        categoryId: product.categoryId || savedProductGroup?.categoryId || '',
        categoryGroupId: product.categoryGroupId || savedProductGroup?.categoryGroupId || '',
        shopifyEnabled: Boolean(product.shopifyEnabled || savedProductGroup?.shopifyEnabled),
        shopifyCreateEnabled: Boolean(product.shopifyCreateEnabled || savedProductGroup?.shopifyCreateEnabled || savedProductGroup?.shopifyEnabled),
        shopifyProductId: product.shopifyProductId || savedProductGroup?.shopifyProductId || '',
        createdAt: product.createdAt || product.created_at || savedProductGroup?.createdAt || savedProductGroup?.created_at || null,
        updatedAt: product.updatedAt || product.updated_at || savedProductGroup?.updatedAt || savedProductGroup?.updated_at || null
      };

      const key = getProductGroupSortKey(productWithGroup);

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          id: savedProductGroup?.id || key,
          name: productWithGroup.productGroupName || productWithGroup.name || savedProductGroup?.name || '名称未設定',
          brandName: productWithGroup.brandName || savedProductGroup?.brandName || '',
          categoryName: productWithGroup.categoryName || savedProductGroup?.categoryName || '',
          subCategoryName: productWithGroup.subCategoryName || '',
          salesAreaName: productWithGroup.salesAreaName || '',
          shopifyEnabled: Boolean(savedProductGroup?.shopifyEnabled || productWithGroup.shopifyEnabled),
          shopifyCreateEnabled: Boolean(savedProductGroup?.shopifyCreateEnabled || savedProductGroup?.shopifyEnabled || productWithGroup.shopifyCreateEnabled),
          shopifyProductId: savedProductGroup?.shopifyProductId || productWithGroup.shopifyProductId || '',
          createdAt: savedProductGroup?.createdAt || savedProductGroup?.created_at || productWithGroup.createdAt || null,
          updatedAt: savedProductGroup?.updatedAt || savedProductGroup?.updated_at || productWithGroup.updatedAt || null,
          products: []
        });
      }

      const group = groups.get(key);
      group.products.push(productWithGroup);
      group.shopifyEnabled = Boolean(group.shopifyEnabled || productWithGroup.shopifyEnabled || savedProductGroup?.shopifyEnabled);
      group.shopifyCreateEnabled = Boolean(group.shopifyCreateEnabled || productWithGroup.shopifyCreateEnabled || savedProductGroup?.shopifyCreateEnabled || savedProductGroup?.shopifyEnabled);
      group.shopifyProductId = group.shopifyProductId || productWithGroup.shopifyProductId || savedProductGroup?.shopifyProductId || '';
      group.createdAt = group.createdAt || savedProductGroup?.createdAt || savedProductGroup?.created_at || productWithGroup.createdAt || null;
      group.updatedAt = group.updatedAt || savedProductGroup?.updatedAt || savedProductGroup?.updated_at || productWithGroup.updatedAt || null;

      if (productWithGroup.productGroupRole === 'primary') {
        group.name = productWithGroup.productGroupName || productWithGroup.name || group.name;
        group.brandName = productWithGroup.brandName || group.brandName;
        group.categoryName = productWithGroup.categoryName || group.categoryName;
        group.subCategoryName = productWithGroup.subCategoryName || group.subCategoryName;
        group.salesAreaName = productWithGroup.salesAreaName || group.salesAreaName;
      }
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        products: [...group.products].sort((a, b) => {
          const aPrimary = a.productGroupRole === 'primary' ? 0 : 1;
          const bPrimary = b.productGroupRole === 'primary' ? 0 : 1;
          if (aPrimary !== bPrimary) return aPrimary - bPrimary;

          const bySize = String(a.size || '').localeCompare(String(b.size || ''), 'ja');
          if (bySize !== 0) return bySize;

          return String(a.sku || a.productCode || '').localeCompare(String(b.sku || b.productCode || ''), 'ja');
        })
      }))
      .sort((a, b) => {
        const bTimestamp = Math.max(
          getProductMasterTimestampMs(b.createdAt),
          getProductMasterTimestampMs(b.updatedAt),
          ...(b.products || []).map(getProductMasterSortTimestamp)
        );
        const aTimestamp = Math.max(
          getProductMasterTimestampMs(a.createdAt),
          getProductMasterTimestampMs(a.updatedAt),
          ...(a.products || []).map(getProductMasterSortTimestamp)
        );

        if (bTimestamp !== aTimestamp) return bTimestamp - aTimestamp;

        const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ja');
        if (byName !== 0) return byName;
        return String(a.key || '').localeCompare(String(b.key || ''), 'ja');
      });
  }, [products, productGroups]);


  const getDraftShopifyTarget = (product) => {
    const draft = draftRows[product.id];

    if (!draft) {
      return Boolean(product.shopifyCreateEnabled || product.shopifyEnabled);
    }

    if (Object.prototype.hasOwnProperty.call(draft, 'shopifyCreateEnabled')) {
      return Boolean(draft.shopifyCreateEnabled);
    }

    if (Object.prototype.hasOwnProperty.call(draft, 'shopifyEnabled')) {
      return Boolean(draft.shopifyEnabled);
    }

    return Boolean(product.shopifyCreateEnabled || product.shopifyEnabled);
  };

  const groupHasDraftShopifyTarget = (group) =>
    group.products.some((product) => getDraftShopifyTarget(product));

  const groupHasPendingShopifySync = (group) =>
    group.products.some((product) => pendingShopifySyncProductIds.has(product.id));

  const groupHasSavedUnsyncedShopifyReservation = (group) => {
    if (getGroupShopifyProductId(group)) return false;

    const hasExplicitDraftOff = (group.products || []).some((product) => {
      const draft = draftRows[product.id];
      if (!draft) return false;
      if (Object.prototype.hasOwnProperty.call(draft, 'shopifyCreateEnabled') && draft.shopifyCreateEnabled === false) return true;
      if (Object.prototype.hasOwnProperty.call(draft, 'shopifyEnabled') && draft.shopifyEnabled === false) return true;
      return false;
    });

    if (hasExplicitDraftOff) return false;

    return Boolean(
      group.shopifyCreateEnabled ||
      (group.products || []).some((product) => product.shopifyCreateEnabled === true)
    );
  };

  const groupHasShopifySyncTarget = (group) =>
    groupHasPendingShopifySync(group)
    || groupHasDraftShopifyTarget(group)
    || groupHasSavedUnsyncedShopifyReservation(group);

  const editedShopifyGroups = useMemo(() => (
    groupedProducts
      .map((group) => getWorkingGroup(group))
      .filter((group) => (
        (
          group.products.some((product) => draftRows[product.id] || pendingShopifySyncProductIds.has(product.id))
          || groupHasSavedUnsyncedShopifyReservation(group)
        )
        && groupHasShopifySyncTarget(group)
        && !getGroupShopifyProductId(group)
      ))
  ), [draftRows, pendingShopifySyncProductIds, groupedProducts]);

  const editedSyncedShopifyGroups = useMemo(() => (
    groupedProducts
      .map((group) => getWorkingGroup(group))
      .filter((group) => (
        group.products.some((product) => draftRows[product.id] || pendingShopifySyncProductIds.has(product.id))
        && groupHasShopifySyncTarget(group)
        && Boolean(getGroupShopifyProductId(group))
      ))
  ), [draftRows, pendingShopifySyncProductIds, groupedProducts]);

  const shopifySyncTargetGroupCount = editedShopifyGroups.length + editedSyncedShopifyGroups.length;

  const editedProductRows = useMemo(() => {
    const existingProductIds = new Set((products || []).map((product) => product.id));
    return Object.values(draftRows || {}).filter((row) => row?.id && existingProductIds.has(row.id));
  }, [draftRows, products]);

  const editedProductRowCount = editedProductRows.length;

  const stockInTargetRows = useMemo(() => (
    editedProductRows.filter((row) => Number(row.stockInQuantityDraft || 0) > 0)
  ), [editedProductRows]);


  const markPendingShopifySyncProducts = (productIds = []) => {
    const normalizedIds = productIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (normalizedIds.length === 0) return;

    setPendingShopifySyncProductIds((current) => {
      const next = new Set(current);
      normalizedIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearPendingShopifySyncProducts = (productIds = []) => {
    const normalizedIds = productIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (normalizedIds.length === 0) return;

    setPendingShopifySyncProductIds((current) => {
      let changed = false;
      const next = new Set(current);
      normalizedIds.forEach((id) => {
        if (next.delete(id)) changed = true;
      });
      return changed ? next : current;
    });
  };

  const clearProductDraftState = (productId) => {
    if (!productId) return;

    clearPendingShopifySyncProducts([productId]);

    setDraftRows((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, productId)) return current;
      const next = { ...current };
      delete next[productId];
      return next;
    });

    setRecentlySavedRows((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, productId)) return current;
      const next = { ...current };
      delete next[productId];
      return next;
    });
  };

  const updateDraft = (productId, patch) => {
    setDraftRows((current) => {
      const currentDraft = current[productId];
      const savedProduct = products.find((product) => product.id === productId) || {};
      const baseDraft = { ...(currentDraft || savedProduct) };

      if (!currentDraft) {
        delete baseDraft.shopifyCreateEnabled;
        delete baseDraft.shopifyEnabled;
      }

      return {
        ...current,
        [productId]: {
          ...baseDraft,
          ...patch
        }
      };
    });
  };

  const updateNewRow = (patch) => {
    setNewRow((current) => ({
      ...current,
      ...patch
    }));
  };

  const buildEmptyNewSkuRow = () => ({
    id: `__new_sku_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sku: '',
    productCode: '',
    barcode: '',
    size: '',
    colorName: '',
    priceTaxExcluded: '',
    taxRate: newRow.taxRate ?? 10,
    orderLot: '',
    reorderLot: '',
    reorderPoint: '',
    reorderQuantity: '',
    stockInQuantityDraft: ''
  });

  const hasNewProductDraft = useMemo(() => {
    const rows = [newRow, ...newSkuRows];
    return rows.some((row) => (
      String(row.brandId || '').trim() ||
      String(row.name || '').trim() ||
      String(row.sku || row.productCode || '').trim() ||
      String(row.barcode || '').trim() ||
      String(row.size || '').trim() ||
      String(row.colorName || '').trim() ||
      String(row.priceTaxExcluded || '').trim() ||
      String(row.orderLot ?? row.reorderLot ?? '').trim() ||
      String(row.reorderPoint || '').trim() ||
      String(row.reorderQuantity || '').trim() ||
      String(row.stockInQuantityDraft || '').trim() ||
      Boolean(row.labelEnabled) ||
      Boolean(row.shopifyCreateEnabled || row.shopifyEnabled) ||
      Boolean(row.salesAreaId) ||
      Boolean(row.categoryGroupId) ||
      Boolean(row.categoryId) ||
      Boolean(row.subCategoryId)
    ));
  }, [newRow, newSkuRows]);

  const newProductEntryCount = 1 + newSkuRows.length;

  const updateNewSkuRow = (index, patch) => {
    setNewSkuRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )));
  };

  const addNewSkuRow = () => {
    setNewSkuRows((current) => [...current, buildEmptyNewSkuRow()]);
  };

  const clearNewProductEntry = () => {
    setNewRow({
      brandId: '',
      name: '',
      labelEnabled: false,
      salesAreaId: '',
      categoryGroupId: '',
      categoryId: '',
      subCategoryId: '',
      sku: '',
      productCode: '',
      barcode: '',
      size: '',
      colorName: '',
      priceTaxExcluded: '',
      taxRate: 10,
      orderLot: '',
      reorderLot: '',
      reorderPoint: '',
      reorderQuantity: '',
      stockInQuantityDraft: '',
      shopifyCreateEnabled: false,
      shopifyEnabled: false
    });
    setNewSkuRows([]);
  };

  const removeNewSkuRow = (index) => {
    setNewSkuRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const buildProductSavePayload = (draft) => {
    const matchedBrand = brands.find((brand) => brand.id === draft.brandId);
    const matchedCategory = productCategories.find((category) => category.id === draft.categoryId);
    const matchedGroup = productCategoryGroups.find((group) => group.id === (draft.categoryGroupId || matchedCategory?.groupId));
    const matchedSupplier = suppliers.find((supplier) => supplier.id === (draft.supplierId || matchedBrand?.supplierId));

    return normalizeProductPayload({
      ...draft,
      brandName: matchedBrand?.name || draft.brandName || '',
      categoryName: matchedCategory?.name || draft.categoryName || '',
      subCategoryName: draft.subCategoryName || '',
      salesAreaName: draft.salesAreaName || '',
      categoryGroupId: matchedCategory?.groupId || draft.categoryGroupId || '',
      categoryGroupName: matchedGroup?.name || draft.categoryGroupName || '',
      supplierId: matchedBrand?.supplierId || draft.supplierId || '',
      supplierName: matchedSupplier?.name || matchedBrand?.supplierName || draft.supplierName || '',
      shopifyCreateEnabled: Boolean(draft.shopifyCreateEnabled || draft.shopifyEnabled),
      shopifyEnabled: Boolean(draft.shopifyEnabled || draft.shopifyCreateEnabled)
    });
  };

  const saveExisting = async (product) => {
    const draft = getDraft(product);

    if (!String(draft.name || '').trim()) {
      alert('商品名を入力してください');
      return;
    }

    setSavingKey(product.id);
    try {
      const payload = buildProductSavePayload(draft);
      await onSaveProduct(payload);
      rememberSavedProduct(payload);
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
    if (!hasNewProductDraft) return;

    const newProductRowsToSave = [newRow, ...newSkuRows];
    const primaryGroupDraft = newRow;
    const targetRows = newProductRowsToSave.filter((row, index) => (
      index === 0 ||
      String(row.sku || row.productCode || '').trim() ||
      String(row.barcode || '').trim() ||
      String(row.size || '').trim() ||
      String(row.colorName || '').trim() ||
      String(row.priceTaxExcluded || '').trim() ||
      String(row.orderLot ?? row.reorderLot ?? '').trim() ||
      String(row.reorderPoint || '').trim() ||
      String(row.reorderQuantity || '').trim() ||
      String(row.stockInQuantityDraft || '').trim()
    ));

    if (!String(primaryGroupDraft.name || '').trim()) {
      alert('新規登録する商品名を入力してください。');
      return;
    }

    setSavingKey('__new__');

    const newProductGroupId = primaryGroupDraft.productGroupId
      || `product_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newGroupCode = primaryGroupDraft.groupCode || newProductGroupId;

    try {
      for (const [index, row] of targetRows.entries()) {
        const mergedDraft = {
          ...primaryGroupDraft,
          ...row,
          brandId: primaryGroupDraft.brandId || row.brandId || '',
          brandName: primaryGroupDraft.brandName || row.brandName || '',
          name: primaryGroupDraft.name || row.name || '',
          labelEnabled: Boolean(primaryGroupDraft.labelEnabled),
          salesAreaId: primaryGroupDraft.salesAreaId || row.salesAreaId || '',
          categoryGroupId: primaryGroupDraft.categoryGroupId || row.categoryGroupId || '',
          categoryId: primaryGroupDraft.categoryId || row.categoryId || '',
          subCategoryId: primaryGroupDraft.subCategoryId || row.subCategoryId || '',
          productGroupId: newProductGroupId,
          groupCode: newGroupCode,
          productGroupName: primaryGroupDraft.name || row.productGroupName || row.name || '',
          productGroupRole: index === 0 ? 'primary' : 'variant',
          shopifyCreateEnabled: Boolean(primaryGroupDraft.shopifyCreateEnabled || primaryGroupDraft.shopifyEnabled),
          shopifyEnabled: Boolean(primaryGroupDraft.shopifyCreateEnabled || primaryGroupDraft.shopifyEnabled)
        };

        await onSaveProduct(buildProductSavePayload(mergedDraft));
      }

      clearNewProductEntry();
      onSaved?.();
    } catch (error) {
      console.error('failed to save new product rows', error);
      alert(`新規商品登録に失敗しました: ${error?.message || error}`);
    } finally {
      setSavingKey(null);
    }
  };

  const createSkuDraftFromProduct = (source) => ({
    ...blankProduct,
    name: source.name || '',
    brandId: source.brandId || '',
    brandName: source.brandName || '',
    categoryId: source.categoryId || '',
    categoryName: source.categoryName || '',
    subCategoryName: source.subCategoryName || '',
    salesAreaName: source.salesAreaName || '',
    categoryGroupId: source.categoryGroupId || '',
    categoryGroupName: source.categoryGroupName || '',
    supplierId: source.supplierId || '',
    supplierName: source.supplierName || '',
    departmentId: source.departmentId || 'retail',
    productType: source.productType || 'retail',
    priceTaxIncluded: source.priceTaxIncluded ?? '',
    priceTaxExcluded: source.priceTaxExcluded ?? '',
    taxRateType: source.taxRateType || 'standard',
    taxRate: source.taxRate ?? 10,
    costTaxExcluded: source.costTaxExcluded ?? '',
    costTaxIncluded: source.costTaxIncluded ?? '',
    supplierCostRate: source.supplierCostRate ?? '',
    orderLot: source.orderLot ?? source.reorderLot ?? '',
    reorderLot: source.reorderLot ?? source.orderLot ?? '',
    reorderPoint: source.reorderPoint ?? '',
    reorderQuantity: source.reorderQuantity ?? '',
    labelEnabled: Boolean(source.labelEnabled),
    shopifyCreateEnabled: Boolean(source.shopifyCreateEnabled || source.shopifyEnabled),
    shopifyEnabled: Boolean(source.shopifyEnabled || source.shopifyCreateEnabled),
    isActive: source.isActive !== false,
    isArchived: false,
    productGroupId: source.productGroupId || '',
    productGroupRole: 'variant',
    productGroupName: source.productGroupName || source.name || '',
    sku: '',
    productCode: '',
    barcode: '',
    size: '',
    colorName: '',
    stockInQuantityDraft: ''
  });

  const addSkuToProductGroup = async (source) => {
    if (!source?.id) return;

    if (!source.productGroupId) {
      alert('商品グループがまだ作成されていません。先にこの商品を保存してください。');
      return;
    }

    const nextSku = createSkuDraftFromProduct(source);
    setSavingKey(`sku:${source.id}`);

    try {
      const savedId = await onSaveProduct(buildProductSavePayload(nextSku));
      onSaved?.();
      alert('SKUを追加しました。追加されたSKU行に品番・バーコード・サイズ・色を入力してください。');
      return savedId;
    } catch (error) {
      console.error('failed to add SKU', error);
      alert(`SKU追加に失敗しました: ${error?.message || error}`);
      return undefined;
    } finally {
      setSavingKey('');
    }
  };

  const saveProductGroupHeader = async (group, primaryDraft = {}, options = {}) => {
    if (!group?.products?.length) return;

    const primaryProduct = group.products.find((product) => product.productGroupRole === 'primary') || group.products[0];
    if (!primaryProduct?.id) return;

    const matchedCategory = productCategories.find((category) => category.id === primaryDraft.categoryId);
    const headerPatch = {
      name: primaryDraft.name || '',
      brandId: primaryDraft.brandId || '',
      categoryId: primaryDraft.categoryId || '',
      categoryName: matchedCategory?.name || primaryDraft.categoryName || '',
      subCategoryName: primaryDraft.subCategoryName || '',
      categoryGroupId: matchedCategory?.groupId || primaryDraft.categoryGroupId || '',
      categoryGroupName: productCategoryGroups.find((group) => group.id === (matchedCategory?.groupId || primaryDraft.categoryGroupId))?.name || primaryDraft.categoryGroupName || '',
      salesAreaName: primaryDraft.salesAreaName || '',
      departmentId: matchedCategory?.departmentId || primaryDraft.departmentId || 'retail',
      labelEnabled: Boolean(primaryDraft.labelEnabled)
    };

    if (!String(headerPatch.name || '').trim()) {
      alert('商品名を入力してください');
      return;
    }

    setSavingKey(`group:${group.key}`);

    try {
      for (const product of group.products) {
        const draft = getDraft(product);
        const payload = buildProductSavePayload({
          ...draft,
          ...headerPatch,
          id: product.id,
          productGroupId: product.productGroupId || getDraft(product).productGroupId,
          productGroupRole: product.productGroupRole || getDraft(product).productGroupRole || (product.id === primaryProduct.id ? 'primary' : 'variant')
        });
        await onSaveProduct(payload);
        rememberSavedProduct(payload);
      }

      setDraftRows((current) => {
        const next = { ...current };
        for (const product of group.products) {
          delete next[product.id];
        }
        return next;
      });

      onSaved?.();
      if (!options.suppressSuccessAlert) {
        alert('商品グループの共通項目を保存しました。');
      }
    } catch (error) {
      console.error('failed to save product group header', error);
      alert(`商品グループの保存に失敗しました: ${error?.message || error}`);
    } finally {
      setSavingKey('');
    }
  };

  const createShopifyDraftForGroup = async (group, options = {}) => {
    const productGroupId = getGroupProductGroupId(group);

    if (!productGroupId) {
      alert('商品グループIDが見つかりません。商品グループを保存してから再度お試しください。');
      return;
    }

    if (!group.products?.some((product) => product.shopifyCreateEnabled)) {
      alert('先にShopify連携をONにしてください。');
      return;
    }

    if (!options.skipMissingConfirm && !confirmShopifySyncMissingFields(group)) return undefined;

    const hadExistingShopifyProductId = Boolean(getGroupShopifyProductId(group));

    if (hadExistingShopifyProductId && !options.skipExistingConfirm) {
      const ok = window.confirm('この商品グループはすでにShopify商品IDがあります。重複作成せず同期済み確認だけ行いますか？');
      if (!ok) return undefined;
    }

    setShopifySyncingGroupId(productGroupId);
    try {
      if (typeof onCreateShopifyDraftProduct !== 'function') {
        throw new Error('Shopify同期処理が画面に接続されていません。画面を再読み込みしてから再度お試しください。');
      }

      const result = await onCreateShopifyDraftProduct(productGroupId);
      const status = String(
        result?.status
        || result?.result?.status
        || result?.data?.status
        || result?.shopifySyncStatus
        || ''
      ).trim();

      const action = String(
        result?.action
        || result?.result?.action
        || result?.data?.action
        || ''
      ).trim();

      const alreadySynced = (
        hadExistingShopifyProductId
        || status === 'already_synced'
        || status === 'skipped_already_synced'
        || status === 'skipped'
        || action === 'skipped_already_synced'
        || action === 'already_synced'
        || result?.alreadySynced === true
        || result?.result?.alreadySynced === true
      );

      if (!options.suppressSuccessAlert) {
        if (alreadySynced) {
          alert('すでにShopify連携済みです。重複作成はしていません。');
        } else {
          alert('Shopifyに下書き商品を作成しました。');
        }
      }

      onSaved?.();
      return { result, alreadySynced };

    } catch (error) {
      console.error('failed to create shopify draft product', error);
      if (!options.suppressErrorAlert) {
        alert(`Shopify下書き商品の作成に失敗しました: ${error?.message || error}`);
      }
      throw error;
    } finally {
      setShopifySyncingGroupId(null);
    }
  };

  const updateShopifyProductForGroup = async (group, options = {}) => {
    const productGroupId = getGroupProductGroupId(group);

    if (!productGroupId) {
      alert('商品グループIDが見つかりません。商品グループを保存してから再度お試しください。');
      return undefined;
    }

    if (!getGroupShopifyProductId(group)) {
      alert('Shopify商品IDが見つかりません。先にShopify下書きを作成してください。');
      return undefined;
    }

    setShopifySyncingGroupId(productGroupId);
    try {
      if (typeof onUpdateShopifyProduct !== 'function') {
        throw new Error('Shopify更新処理が画面に接続されていません。画面を再読み込みしてから再度お試しください。');
      }

      const result = await onUpdateShopifyProduct(productGroupId);

      if (!options.suppressSuccessAlert) {
        alert('Shopify商品を更新しました。');
      }

      onSaved?.();
      return { result };
    } catch (error) {
      console.error('failed to update shopify product', error);
      if (!options.suppressErrorAlert) {
        alert(`Shopify商品の更新に失敗しました: ${error?.message || error}`);
      }
      throw error;
    } finally {
      setShopifySyncingGroupId(null);
    }
  };

  const saveEditedProductRows = async () => {
    if (editedProductRows.length === 0) {
      alert('更新対象の変更はありません。');
      return;
    }

    const targetLines = editedProductRows.map((row) => {
      const stockInQuantity = Number(row.stockInQuantityDraft || 0);
      return `・${row.name || row.productGroupName || row.sku || row.id}${stockInQuantity > 0 ? ` / 入庫 +${stockInQuantity}` : ''}`;
    });

    const message = [
      '以下の変更を商品マスターに反映します。',
      '',
      ...targetLines,
      '',
      stockInTargetRows.length > 0 ? `入庫反映: ${stockInTargetRows.length}件` : '',
      stockInTargetRows.length > 0 ? '入庫数は在庫数へ加算し、入庫履歴を記録します。' : '',
      '',
      '実行してよろしいですか？'
    ].filter((line) => line !== '').join('\n');

    if (!window.confirm(message)) return;

    setProductMasterBulkSaving(true);

    try {
      for (const row of editedProductRows) {
        const payload = buildProductSavePayload(row);
        await onSaveProduct(payload);
        rememberSavedProduct(payload);
      }

      setDraftRows((current) => {
        const next = { ...current };
        for (const row of editedProductRows) {
          delete next[row.id];
        }
        return next;
      });

      onSaved?.();
      alert(`商品マスターを更新しました。対象: ${editedProductRows.length}件${stockInTargetRows.length > 0 ? ` / 入庫: ${stockInTargetRows.length}件` : ''}`);
    } catch (error) {
      console.error('failed to save edited product rows', error);
      alert(`商品マスター更新に失敗しました: ${error?.message || error}`);
    } finally {
      setProductMasterBulkSaving(false);
    }
  };

  const saveDraftRowsForGroup = async (group) => {
    const rows = (group.products || [])
      .map((product) => draftRows[product.id])
      .filter((row) => row?.id);

    if (rows.length === 0) return [];

    const savedRows = [];

    for (const row of rows) {
      const payload = buildProductSavePayload(row);
      await onSaveProduct(payload);
      rememberSavedProduct(payload);
      savedRows.push(payload);
    }

    setDraftRows((current) => {
      const next = { ...current };
      for (const row of rows) {
        delete next[row.id];
      }
      return next;
    });

    return savedRows;
  };

  const buildGroupWithSavedDraftRows = (group, savedRows = []) => {
    const savedRowsById = new Map(savedRows.map((row) => [row.id, row]));

    return {
      ...group,
      products: (group.products || []).map((product) => savedRowsById.get(product.id) || getDraft(product))
    };
  };

  const syncEditedShopifyGroups = async () => {
    if (shopifySyncTargetGroupCount === 0) {
      alert('Shopify同期対象の商品はありません。Shopify同期ONにして保存してから実行してください。');
      return;
    }

    const createTargetLines = editedShopifyGroups.map((group) => `・${getGroupDisplayName(group)}`);
    const updateTargetLines = editedSyncedShopifyGroups.map((group) => `・${getGroupDisplayName(group)}`);

    const targetLines = [
      editedShopifyGroups.length > 0 ? '下書き作成:' : '',
      ...createTargetLines,
      editedSyncedShopifyGroups.length > 0 ? '更新同期:' : '',
      ...updateTargetLines
    ].filter((line) => line !== '');

    const missingLines = editedShopifyGroups.flatMap((group) => {
      const missing = [];
      if (!getGroupBrandName(group)) missing.push('ブランド');
      if (!getGroupCategoryName(group)) missing.push('カテゴリー');
      if (missing.length === 0) return [];

      return [
        `・${getGroupDisplayName(group)}`,
        `　未設定: ${missing.join('・')}`
      ];
    });

    const message = [
      '以下の編集済み商品をShopify同期します。',
      '',
      ...targetLines,
      '',
      editedShopifyGroups.length > 0 ? '未同期の商品はShopify下書きを作成します。' : '',
      editedSyncedShopifyGroups.length > 0 ? 'Shopify連携済み商品は商品名・SKU・JAN・価格を更新します。' : '',
      '',
      missingLines.length > 0 ? '以下の商品には未設定項目があります。' : '',
      ...missingLines,
      missingLines.length > 0 ? '未設定項目はShopify側へ空欄で同期されます。' : '',
      '',
      '実行してよろしいですか？'
    ].filter((line) => line !== '').join('\n');

    if (!window.confirm(message)) return;

    setShopifyBulkSyncing(true);
    try {
      for (const group of editedShopifyGroups) {
        const originalGroup = groupedProducts.find((item) => item.key === group.key) || group;
        const primaryProduct = originalGroup.products.find((product) => product.productGroupRole === 'primary') || originalGroup.products[0];
        const primaryDraft = primaryProduct ? getDraft(primaryProduct) : {};

        await saveProductGroupHeader(originalGroup, primaryDraft, { suppressSuccessAlert: true });
        const savedRows = await saveDraftRowsForGroup(originalGroup);
        const savedGroup = buildGroupWithSavedDraftRows(originalGroup, savedRows);

        await createShopifyDraftForGroup(savedGroup, {
          skipMissingConfirm: true,
          skipExistingConfirm: true,
          suppressSuccessAlert: true
        });
        clearPendingShopifySyncProducts((savedGroup.products || []).map((product) => product.id));
      }

      for (const group of editedSyncedShopifyGroups) {
        const originalGroup = groupedProducts.find((item) => item.key === group.key) || group;
        const primaryProduct = originalGroup.products.find((product) => product.productGroupRole === 'primary') || originalGroup.products[0];
        const primaryDraft = primaryProduct ? getDraft(primaryProduct) : {};

        await saveProductGroupHeader(originalGroup, primaryDraft, { suppressSuccessAlert: true });
        const savedRows = await saveDraftRowsForGroup(originalGroup);
        const savedGroup = buildGroupWithSavedDraftRows(originalGroup, savedRows);

        await updateShopifyProductForGroup(savedGroup, {
          suppressSuccessAlert: true
        });
        clearPendingShopifySyncProducts((savedGroup.products || []).map((product) => product.id));
      }

      alert(`Shopify同期が完了しました。下書き作成: ${editedShopifyGroups.length}件 / 更新: ${editedSyncedShopifyGroups.length}件`);
    } catch (error) {
      console.error('failed to sync edited shopify groups', error);
      alert(`Shopify同期に失敗しました: ${error?.message || error}`);
    } finally {
      setShopifyBulkSyncing(false);
    }
  };

  const saveProductGroupShopifyEnabled = async (group, enabled) => {
    if (!group?.products?.length) return;

    const primaryProduct = group.products.find((product) => product.productGroupRole === 'primary') || group.products[0];
    if (!primaryProduct?.id) return;

    setSavingKey(`shopify:${group.key}`);

    try {
      const savedProductIds = [];

      for (const product of group.products) {
        const draft = getDraft(product);
        const payload = buildProductSavePayload({
          ...draft,
          id: product.id,
          productGroupId: product.productGroupId,
          productGroupRole: product.productGroupRole || (product.id === primaryProduct.id ? 'primary' : 'variant'),
          shopifyCreateEnabled: Boolean(enabled),
          shopifyEnabled: Boolean(enabled)
        });
        await onSaveProduct(payload);
        rememberSavedProduct(payload);
        savedProductIds.push(product.id);
      }

      if (enabled) {
        markPendingShopifySyncProducts(savedProductIds);
      } else {
        clearPendingShopifySyncProducts(savedProductIds);
      }

      setDraftRows((current) => {
        const next = { ...current };
        for (const product of group.products) {
          delete next[product.id];
        }
        return next;
      });

      onSaved?.();
    } catch (error) {
      console.error('failed to save shopify enabled', error);
      alert(`Shopify設定の保存に失敗しました: ${error?.message || error}`);
    } finally {
      setSavingKey('');
    }
  };

  const updateProductGroupShopifyDraft = (group, enabled) => {
    setDraftRows((current) => {
      const next = { ...current };

      for (const product of group.products || []) {
        const base = next[product.id] || { ...product };
        next[product.id] = {
          ...base,
          id: product.id,
          productGroupId: product.productGroupId,
          productGroupRole: product.productGroupRole,
          shopifyCreateEnabled: Boolean(enabled),
          shopifyEnabled: Boolean(enabled)
        };
      }

      return next;
    });
  };


  const saveProductMasterChanges = async () => {
    if (hasNewProductDraft) {
      await saveNew();
    }

    if (editedProductRowCount > 0) {
      await saveEditedProductRows();
    }
  };

  const deleteProduct = async (product) => {
    if (!product?.id) return;
    if (!window.confirm(`${product.name || '商品'}を削除しますか？`)) return;
    clearProductDraftState(product.id);

    await onDeleteProduct(product.id);
    onSaved?.();
  };

  const renderEditableRow = (row, options = {}) => {
    const isNew = options.isNew === true;
    const rowKey = options.rowKey || (isNew ? '__new__' : row.id);
    const update = isNew ? (options.onNewSkuChange || updateNewRow) : (patch) => updateDraft(row.id, patch);
    const isSaving = savingKey === rowKey;
    const registeredAtText = formatProductMasterDateTimeText(row.createdAt || row.created_at);

    return (
      <div
        key={rowKey}
        className={classNames(
          'rounded-xl border p-2 shadow-sm',
          isNew ? 'border-orange-100 bg-orange-50/60 shadow-orange-100/50' : 'border-slate-200 bg-white'
        )}
      >
        {isNew && options.showNewHeader !== false && (
          <div className="mb-2 rounded-lg border border-orange-100 bg-white/80 px-3 py-2">
            <div className="grid grid-cols-[minmax(540px,2.55fr)_minmax(360px,1.75fr)_300px] gap-2 xl:gap-2.5">
              <div className="min-w-0">
                <div className="grid grid-cols-[minmax(210px,1.2fr)_minmax(320px,1.8fr)] gap-2">
                  <div>
                    <FieldLabel>ブランド</FieldLabel>
                    <TableSelect value={row.brandId} onChange={(value) => update({ brandId: value })} alertWhenEmpty>
                      <option value="">ブランド</option>
                      {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                    </TableSelect>
                  </div>

                  <div>
                    <FieldLabel>商品名</FieldLabel>
                    <TableTextInput value={row.name} onChange={(value) => update({ name: value })} placeholder="商品名" />
                  </div>
                </div>

                <div className="mt-1.5 grid grid-cols-[minmax(210px,1.2fr)_minmax(320px,1.8fr)] gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={addNewSkuRow}
                      className="inline-flex h-8 min-w-[96px] flex-1 items-center justify-center rounded-lg bg-slate-900 px-2 text-xs font-black text-white transition hover:bg-slate-700"
                    >
                      +SKU追加
                    </button>

                    <div className="flex h-8 min-w-[58px] items-center justify-center rounded-lg bg-blue-50 px-2 text-xs font-black text-blue-600">
                      {newProductEntryCount.toLocaleString()} SKU
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center justify-start">
                    <PillToggle
                      checked={row.labelEnabled}
                      onChange={(value) => update({ labelEnabled: value })}
                      onLabel="ラベル"
                      offLabel="ラベル"
                      className="!h-8 !min-w-[72px] !px-3 text-[11px]"
                    />
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-400">
                      登録 {isNew ? '未登録' : registeredAtText}
                    </span>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <ProductClassificationControl
                  value={row}
                  onChange={update}
                  productSalesAreas={getSalesAreaOptions()}
                  productCategoryGroups={productCategoryGroups}
                  productCategories={productCategories}
                  productSubCategories={productSubCategories}
                />
              </div>

              <div className="grid h-[4.5rem] w-[300px] self-end grid-cols-3 grid-rows-2 gap-1 justify-self-end">
                <PillToggle
                  checked={Boolean(row.shopifyCreateEnabled || row.shopifyEnabled)}
                  onChange={(value) => update({
                    shopifyCreateEnabled: value,
                    shopifyEnabled: value
                  })}
                  onLabel="Shopify"
                  offLabel="Shopify"
                  className="!h-8 !min-w-0 !w-full !px-2 text-[10px]"
                  activeClassName="border border-slate-600 bg-slate-600 text-white shadow-sm shadow-slate-200"
                  inactiveClassName="border border-slate-300 bg-slate-200 text-slate-600 shadow-sm"
                />

                {['BASE', 'STORES', '楽天', 'Amazon'].map((label) => (
                  <div
                    key={`new-ec-placeholder-${label}`}
                    className="flex h-8 w-full min-w-0 cursor-default items-center justify-center truncate rounded-full border border-dashed border-slate-200 bg-white/60 px-2 text-[10px] font-black text-slate-300"
                    title={`${label}連携は保存後に利用できます`}
                  >
                    {label}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={clearNewProductEntry}
                  className="inline-flex h-8 w-full items-center justify-center rounded-full bg-rose-50 text-rose-500 transition hover:bg-rose-100"
                  title="新規入力をクリア"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(120px,1fr)_minmax(148px,1.05fr)_72px_76px_92px_66px_74px_74px_84px_170px_72px_44px] gap-2">
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
            <FieldLabel>税抜売価</FieldLabel>
            <TableTextInput type="number" value={row.priceTaxExcluded} onChange={(value) => update({ priceTaxExcluded: value })} placeholder="税抜売価" className="text-right" />
            <div className="mt-1 text-right text-[11px] font-bold text-slate-400">
              税込 {Number(calculateProductMasterTaxIncludedPrice(row.priceTaxExcluded, row.taxRate ?? 10) || 0).toLocaleString()}
            </div>
          </div>

          <div>
            <FieldLabel>LOT</FieldLabel>
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
            <FieldLabel>在庫数</FieldLabel>
            <div className="flex h-9 items-center justify-end rounded-lg border border-slate-200 bg-blue-50 px-2 text-sm font-black text-blue-700">
              {Number(row.inventoryQuantity ?? row.quantity ?? 0).toLocaleString()}
            </div>
          </div>

          <div>
            <FieldLabel>入庫履歴</FieldLabel>
            <button
              type="button"
              className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-slate-100 px-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-200"
              title="入庫履歴を表示"
            >
              {Number(row.lastStockInQuantity || 0) > 0 ? `入庫: ${Number(row.lastStockInQuantity).toLocaleString()}` : '入庫: 未登録'}
            </button>
          </div>

          <div>
            <FieldLabel>入庫数</FieldLabel>
            <TableTextInput
              type="number"
              value={row.stockInQuantityDraft || ''}
              onChange={(value) => update({ stockInQuantityDraft: value })}
              placeholder="数"
              className="text-right"
            />
          </div>

          <div className="flex h-9 items-center justify-center">
            <FieldLabel>削除</FieldLabel>
            {isNew ? (
              <button
                type="button"
                onClick={options.onRemoveNewSku || clearNewProductEntry}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-rose-50 text-rose-500 transition hover:bg-rose-100"
                title={options.onRemoveNewSku ? 'この新規SKU行を削除' : '新規入力をクリア'}
              >
                <Trash2 size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => deleteProduct(row)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-rose-50 text-rose-500 transition hover:bg-rose-100"
                title="削除"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

      </div>
    );
  };

  return (
    <section className="rounded-[2rem] border border-slate-100 bg-white shadow-sm xl:min-h-[calc(100vh-13rem)]">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
        <div>
          <h3 className="text-base font-black text-slate-900">商品マスター</h3>
          <p className="mt-0.5 text-[11px] font-bold text-slate-400">
            商品グループを見出しにし、SKU行では品番・バーコード・サイズ・価格などのバリアント情報を編集します。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-black text-slate-600">
            {(products || []).length.toLocaleString()}件
          </div>
          <button
            type="button"
            onClick={saveProductMasterChanges}
            disabled={productMasterBulkSaving || shopifyBulkSyncing || shopifySyncingGroupId !== null || (editedProductRowCount === 0 && !hasNewProductDraft)}
            className={classNames(
              'inline-flex h-10 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50',
              hasNewProductDraft || editedProductRowCount > 0
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-slate-100 text-slate-400'
            )}
            title={hasNewProductDraft || editedProductRowCount > 0 ? `新規 ${newProductEntryCount}件 / 更新 ${editedProductRowCount}件 / 入庫 ${stockInTargetRows.length}件` : '変更された商品はありません'}
          >
            {productMasterBulkSaving ? <LoadingSpinner size={14} /> : null}
            {hasNewProductDraft && editedProductRowCount > 0
              ? '新規登録・更新'
              : hasNewProductDraft
                ? '新規登録'
                : '更新'}
            {hasNewProductDraft || editedProductRowCount > 0 ? `(${newProductEntryCount + editedProductRowCount})` : ''}
          </button>
          <button
            type="button"
            onClick={syncEditedShopifyGroups}
            disabled={shopifyBulkSyncing || shopifySyncingGroupId !== null || shopifySyncTargetGroupCount === 0}
            className={classNames(
              'inline-flex h-10 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50',
              shopifySyncTargetGroupCount > 0
                ? 'bg-slate-900 text-white hover:bg-slate-700'
                : 'bg-slate-100 text-slate-400'
            )}
            title={shopifySyncTargetGroupCount > 0 ? `Shopify同期対象 ${shopifySyncTargetGroupCount}件 / 下書き作成 ${editedShopifyGroups.length}件 / 更新 ${editedSyncedShopifyGroups.length}件` : 'Shopify同期対象はありません。Shopify ONにして保存してください。'}
          >
            {shopifyBulkSyncing ? <LoadingSpinner size={14} /> : null}
            Shopify同期
            {shopifySyncTargetGroupCount > 0 ? `(${shopifySyncTargetGroupCount})` : ''}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-sky-100/60 px-4 py-3 xl:px-5">
        <div className="min-w-[1420px] space-y-3 2xl:min-w-0">
          <div className="rounded-xl bg-white/60 px-3 py-2 text-[11px] font-black tracking-widest text-slate-400">
            <div>グループ見出し：ブランド / 商品名 / カテゴリー / Shopify / BASE / STORES / 楽天 / Amazon。右上の更新で変更・入庫を反映し、Shopify同期で下書き作成・既存商品更新を実行します。</div>
            <div className="mt-1">SKU行：品番 / バーコード / サイズ / 色 / 価格 / LOT / 発注点 / 発注数 / 在庫数 / 入庫履歴 / 入庫数 / 削除</div>
          </div>

          {renderEditableRow(newRow, { isNew: true })}
          {newSkuRows.map((row, index) => renderEditableRow(
            {
              ...newRow,
              ...row,
              name: newRow.name,
              brandId: newRow.brandId,
              brandName: newRow.brandName,
              labelEnabled: newRow.labelEnabled,
              salesAreaId: newRow.salesAreaId,
              categoryGroupId: newRow.categoryGroupId,
              categoryId: newRow.categoryId,
              subCategoryId: newRow.subCategoryId
            },
            {
              isNew: true,
              rowKey: row.id || `__new_sku_${index}`,
              onNewSkuChange: (patch) => updateNewSkuRow(index, patch),
              onRemoveNewSku: () => removeNewSkuRow(index),
              showNewHeader: false
            }
          ))}

          {(products || []).length > 0 && groupedProducts.map((group) => (
            <div key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                {(() => {
                  const primaryProduct = group.products.find((product) => product.productGroupRole === 'primary') || group.products[0];
                  const primaryDraft = primaryProduct ? getDraft(primaryProduct) : {};
                  const groupRegisteredAtText = formatProductMasterDateTimeText(primaryProduct?.createdAt || primaryProduct?.created_at || group.createdAt || group.created_at);
                  const updatePrimary = primaryProduct
                    ? (patch) => updateDraft(primaryProduct.id, patch)
                    : () => {};

                  return (
                    <div className="grid grid-cols-[minmax(540px,2.55fr)_minmax(360px,1.75fr)_300px] gap-2 xl:gap-2.5">
                      <div className="min-w-0">
                        <div className="grid grid-cols-[minmax(210px,1.2fr)_minmax(320px,1.8fr)] gap-2">
                          <div>
                            <FieldLabel>ブランド</FieldLabel>
                            <TableSelect
                              value={primaryDraft.brandId || ''}
                              onChange={(value) => updatePrimary({ brandId: value })}
                              alertWhenEmpty
                            >
                              <option value="">ブランド</option>
                              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                            </TableSelect>
                          </div>

                          <div>
                            <FieldLabel>商品名</FieldLabel>
                            <TableTextInput
                              value={primaryDraft.name || ''}
                              onChange={(value) => updatePrimary({ name: value })}
                              placeholder="商品名"
                            />
                          </div>
                        </div>

                        <div className="mt-1.5 grid grid-cols-[minmax(210px,1.2fr)_minmax(320px,1.8fr)] gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => addSkuToProductGroup(primaryProduct)}
                              disabled={!primaryProduct}
                              className="inline-flex h-8 min-w-[96px] flex-1 items-center justify-center rounded-lg bg-slate-900 px-2 text-xs font-black text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
                            >
                              +SKU追加
                            </button>

                            <div className="flex h-8 min-w-[58px] items-center justify-center rounded-lg bg-blue-50 px-2 text-xs font-black text-blue-600">
                              {group.products.length.toLocaleString()} SKU
                            </div>
                          </div>

                          <div className="flex min-w-0 items-center justify-start">
                            <PillToggle
                              checked={Boolean(primaryDraft.labelEnabled)}
                              onChange={(value) => updatePrimary({ labelEnabled: value })}
                              onLabel="ラベル"
                              offLabel="ラベル"
                              className="!h-8 !min-w-[72px] !px-3 text-[11px]"
                            />
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-400">
                              登録 {groupRegisteredAtText}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <ProductClassificationControl
                          value={primaryDraft}
                          onChange={updatePrimary}
                          productSalesAreas={getSalesAreaOptions()}
                          productCategoryGroups={productCategoryGroups}
                          productCategories={productCategories}
                          productSubCategories={productSubCategories}
                        />
                      </div>

                      <div className="grid h-[4.5rem] w-[300px] self-end grid-cols-3 grid-rows-2 gap-1 justify-self-end">
                        {(() => {
                          const isShopifySynced = Boolean(getGroupShopifyProductId(group));
                          const draftProducts = group.products
                            .map((product) => draftRows[product.id])
                            .filter(Boolean);
                          const hasShopifyDraft = draftProducts.some(
                            (draft) =>
                              Object.prototype.hasOwnProperty.call(draft, 'shopifyCreateEnabled') ||
                              Object.prototype.hasOwnProperty.call(draft, 'shopifyEnabled')
                          );
                          const hasSavedShopifyFlag = group.products.some(
                            (product) =>
                              Object.prototype.hasOwnProperty.call(product, 'shopifyCreateEnabled') ||
                              Object.prototype.hasOwnProperty.call(product, 'shopifyEnabled')
                          );
                          const savedShopifyTarget = hasSavedShopifyFlag
                            ? group.products.some((product) => Boolean(product.shopifyCreateEnabled || product.shopifyEnabled))
                            : Boolean(group.shopifyCreateEnabled || isShopifySynced);
                          const draftShopifyTarget = draftProducts.some((draft) => {
                            if (Object.prototype.hasOwnProperty.call(draft, 'shopifyCreateEnabled')) {
                              return Boolean(draft.shopifyCreateEnabled);
                            }
                            if (Object.prototype.hasOwnProperty.call(draft, 'shopifyEnabled')) {
                              return Boolean(draft.shopifyEnabled);
                            }
                            return false;
                          });
                          const isPendingShopifySync = group.products.some((product) => pendingShopifySyncProductIds.has(product.id));
                          const isSavedUnsyncedShopifyReservation = groupHasSavedUnsyncedShopifyReservation(group);
                          const isShopifyTarget = isPendingShopifySync || isSavedUnsyncedShopifyReservation || (hasShopifyDraft ? draftShopifyTarget : savedShopifyTarget);
                          const isShopifyActive = isShopifyTarget && isShopifySynced && !isPendingShopifySync && !isSavedUnsyncedShopifyReservation;
                          const isShopifyPending = isPendingShopifySync || isSavedUnsyncedShopifyReservation || (isShopifyTarget && (!isShopifySynced || hasShopifyDraft));

                          return (
                            <PillToggle
                              checked={isShopifyTarget}
                              onChange={(value) => updateProductGroupShopifyDraft(group, value)}
                              disabled={savingKey === `shopify:${group.key}`}
                              onLabel="Shopify"
                              offLabel="Shopify"
                              activeClassName={
                                isShopifyActive && !isShopifyPending
                                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                                  : 'bg-slate-600 text-white shadow-sm shadow-slate-200'
                              }
                              inactiveClassName="border border-slate-300 bg-slate-200 text-slate-600 shadow-sm"
                              className="!h-8 !min-w-0 !w-full !px-2 text-[10px]"
                              title={
                                isShopifyActive && !isShopifyPending
                                  ? 'Shopify連携済みです。OFFにするとShopify IDは残したまま同期対象から外します。'
                                  : isShopifyPending
                                    ? 'Shopify同期対象です。Shopify同期ボタンから下書き作成または更新を実行します。'
                                    : 'Shopify IDは残したまま同期対象外です。ONにするとShopify同期対象になります。'
                              }
                            />
                          );
                        })()}

                        {['BASE', 'STORES', '楽天', 'Amazon'].map((label) => (
                          <div
                            key={`${group.key}-ec-placeholder-${label}`}
                            className="flex h-8 w-full min-w-0 cursor-default items-center justify-center truncate rounded-full border border-dashed border-slate-200 bg-white/60 px-2 text-[10px] font-black text-slate-300"
                            title={`${label}連携は今後追加予定です`}
                          >
                            {label}
                          </div>
                        ))}
                      </div>
                    </div>

                  );
                })()}
              </div>

              <div className="space-y-2 bg-slate-50/60 p-2.5">
                {group.products.map((product) => renderEditableRow(getDraft(product)))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(products || []).length === 0 && (
        <div className="border-t border-slate-100 px-5 py-4 text-sm font-bold text-slate-400">
          まずは最上段の新規行に商品名を入力して保存してください。
        </div>
      )}
    </section>
  );
};


export const ShopifySettingsPanel = ({
  storeId,
  settings,
  onSave,
  onSaved
}) => {
  const [shopifyPriceSyncMode, setShopifyPriceSyncMode] = useState('taxIncluded');
  const [shopifyPriceSyncLoading, setShopifyPriceSyncLoading] = useState(true);
  const [shopifyPriceSyncSaving, setShopifyPriceSyncSaving] = useState(false);

  useEffect(() => {
    if (!storeId) {
      setShopifyPriceSyncLoading(false);
      return;
    }

    let cancelled = false;

    const loadShopifyPriceSyncMode = async () => {
      setShopifyPriceSyncLoading(true);
      try {
        const snapshot = await getDoc(doc(db, 'stores', storeId, 'settings', 'taxPrice'));
        if (cancelled) return;

        const data = snapshot.exists() ? snapshot.data() : {};
        setShopifyPriceSyncMode(data.shopifyPriceSyncMode || 'taxIncluded');
      } catch (error) {
        console.error('Failed to load Shopify price sync mode', error);
      } finally {
        if (!cancelled) {
          setShopifyPriceSyncLoading(false);
        }
      }
    };

    loadShopifyPriceSyncMode();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const saveShopifyPriceSyncMode = async () => {
    if (!storeId) return;

    setShopifyPriceSyncSaving(true);
    try {
      await setDoc(
        doc(db, 'stores', storeId, 'settings', 'taxPrice'),
        {
          shopifyPriceSyncMode,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      onSaved?.('Shopify価格同期設定を保存しました。');
    } finally {
      setShopifyPriceSyncSaving(false);
    }
  };


  const [draft, setDraft] = useState({
    shopDomain: '',
    clientId: '',
    clientSecret: '',
    locationId: '',
    syncEnabled: false
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      shopDomain: settings?.shopDomain || '',
      clientId: settings?.clientId || '',
      clientSecret: settings?.clientSecret || '',
      locationId: settings?.locationId || '',
      syncEnabled: Boolean(settings?.syncEnabled)
    });
  }, [settings?.shopDomain, settings?.clientId, settings?.clientSecret, settings?.locationId, settings?.syncEnabled]);

  const update = (patch) => {
    setDraft((current) => ({
      ...current,
      ...patch
    }));
  };

  const save = async () => {
    const shopDomain = String(draft.shopDomain || '').trim();
    const clientId = String(draft.clientId || '').trim();
    const clientSecret = String(draft.clientSecret || '').trim();
    const locationId = String(draft.locationId || '').trim();

    if (!shopDomain) {
      alert('Shopifyのショップドメインを入力してください。例: your-store.myshopify.com');
      return;
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
      alert('ショップドメインは xxxx.myshopify.com の形式で入力してください。メールアドレスでは保存できません。');
      return;
    }

    if (!clientId) {
      alert('Dev DashboardのクライアントIDを入力してください。');
      return;
    }

    if (clientId.length < 20) {
      alert('クライアントIDが短すぎます。Shopify Dev Dashboardの資格情報を確認してください。');
      return;
    }

    if (!clientSecret) {
      alert('Dev Dashboardのシークレットを入力してください。');
      return;
    }

    if (clientSecret.length < 20) {
      alert('シークレットが短すぎます。Shopify Dev Dashboardの資格情報を確認してください。');
      return;
    }

    setSaving(true);
    try {
      await onSave?.({
        shopDomain,
        clientId,
        clientSecret,
        locationId,
        syncEnabled: Boolean(draft.syncEnabled),
        authMode: 'devDashboard'
      });
      onSaved?.();
      alert('Shopify連携設定を保存しました。');
    } catch (error) {
      console.error('failed to save shopify settings', error);
      alert(`Shopify連携設定の保存に失敗しました: ${error?.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-slate-100 bg-white shadow-sm">

      <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Price Sync</p>
          <h4 className="mt-2 text-lg font-black text-slate-900">Shopifyへ同期する価格</h4>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
            Akuto POSの税抜価格を基準に、Shopifyへ送る価格を税込・税抜のどちらにするかを設定します。
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <select
            value={shopifyPriceSyncMode}
            onChange={(event) => setShopifyPriceSyncMode(event.target.value)}
            disabled={shopifyPriceSyncLoading || shopifyPriceSyncSaving}
            className="h-12 rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-400 disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="taxIncluded">税込価格を同期する</option>
            <option value="taxExcluded">税抜価格を同期する</option>
          </select>

          <button
            type="button"
            onClick={saveShopifyPriceSyncMode}
            disabled={shopifyPriceSyncLoading || shopifyPriceSyncSaving}
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {shopifyPriceSyncSaving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900">Shopify連携設定</h3>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-400">
              Shopify Dev Dashboardで作成したAkuto POS用アプリの資格情報を保存します。このSTEPでは保存のみ行い、商品同期の実通信はまだ行いません。
            </p>
          </div>
          <span className={classNames(
            'rounded-full px-3 py-1 text-xs font-black',
            draft.syncEnabled
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-slate-100 text-slate-500'
          )}>
            {draft.syncEnabled ? '同期ON' : '同期OFF'}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1.35fr_1.35fr]">
          <label className="block">
            <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">Shopifyストアドメイン</span>
            <input
              value={draft.shopDomain}
              onChange={(event) => update({ shopDomain: event.target.value })}
              placeholder="your-store.myshopify.com"
              className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-400"
            />
            <span className="mt-1.5 block text-[11px] font-bold text-slate-400">
              メールアドレスではなく、xxxx.myshopify.com の形式で入力します。
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">クライアントID</span>
            <input
              value={draft.clientId}
              onChange={(event) => update({ clientId: event.target.value })}
              placeholder="Dev DashboardのクライアントID"
              className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-400"
            />
            <span className="mt-1.5 block text-[11px] font-bold text-slate-400">
              Dev Dashboard &gt; 設定 &gt; 資格情報 のクライアントIDです。
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">シークレット</span>
            <input
              type="password"
              value={draft.clientSecret}
              onChange={(event) => update({ clientSecret: event.target.value })}
              placeholder="Dev Dashboardのシークレット"
              className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-400"
            />
            <span className="mt-1.5 block text-[11px] font-bold text-slate-400">
              パスワード相当の情報です。ログやスクリーンショットに出さないように扱います。
            </span>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-2 block text-[11px] font-black tracking-widest text-slate-400">Shopify Location ID</span>
            <input
              value={draft.locationId}
              onChange={(event) => update({ locationId: event.target.value })}
              placeholder="未取得なら空欄でOK"
              className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-white px-4 text-sm font-bold text-slate-700 outline-none transition focus:border-orange-400"
            />
            <span className="mt-1.5 block text-[11px] font-bold text-slate-400">
              次STEPでShopify APIからロケーション一覧を取得して設定します。
            </span>
          </label>

          <label className="flex min-w-[180px] items-end gap-3 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3">
            <input
              type="checkbox"
              checked={draft.syncEnabled}
              onChange={(event) => update({ syncEnabled: event.target.checked })}
              className="h-5 w-5 rounded border-slate-300"
            />
            <span className="text-sm font-black text-slate-700">同期を有効にする</span>
          </label>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold leading-relaxed text-blue-700">
          現在の方式はShopify Dev DashboardのクライアントID/シークレットを保存する方式です。商品作成・在庫同期の実通信はCloud Functions側で追加します。
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60"
          >
            {saving ? <LoadingSpinner size={14} /> : <Save size={16} />}
            Shopify設定を保存
          </button>
        </div>
      </div>
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

const getClassificationGroupName = (value, productCategoryGroups = []) => {
  if (value?.categoryGroupName) return String(value.categoryGroupName || '').trim();

  const matchedGroup = productCategoryGroups.find((group) => (
    group.id === value?.categoryGroupId
    || group.name === value?.categoryGroupName
  ));

  return String(matchedGroup?.name || '').trim();
};

const getClassificationCategoryName = (value, productCategories = []) => {
  if (value?.categoryName) return String(value.categoryName || '').trim();

  const matchedCategory = productCategories.find((category) => category.id === value?.categoryId);
  return String(matchedCategory?.name || '').trim();
};

const buildClassificationBreadcrumb = (value, productCategoryGroups = [], productCategories = []) => {
  const crumbs = [
    String(value?.salesAreaName || '').trim(),
    getClassificationGroupName(value, productCategoryGroups),
    getClassificationCategoryName(value, productCategories),
    String(value?.subCategoryName || '').trim()
  ].filter(Boolean);

  return crumbs.length > 0 ? crumbs.join(' ＞ ') : '分類未設定';
};

const ClassificationChoiceButton = ({
  label,
  subLabel = '',
  active = false,
  disabled = false,
  onClick
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={classNames(
      'group rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-orange-200',
      disabled
        ? 'cursor-default border-slate-200 bg-white text-slate-500 opacity-45'
        : active
          ? 'hover:border-slate-900 hover:bg-slate-900 hover:text-white'
          : 'hover:border-orange-300 hover:bg-orange-50 hover:text-slate-950',
      active
        ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10'
        : 'border-slate-200 bg-white text-slate-800'
    )}
  >
    <div className="text-sm font-black">{label}</div>
    {subLabel ? (
      <div
        className={classNames(
          'mt-0.5 text-[11px] font-bold transition',
          active ? 'text-slate-200 group-hover:text-slate-200' : 'text-slate-500 group-hover:text-slate-700',
          disabled ? 'group-hover:text-slate-500' : ''
        )}
      >
        {subLabel}
      </div>
    ) : null}
  </button>
);

const ProductClassificationControl = ({
  value,
  onChange,
  productSalesAreas = [],
  productCategoryGroups = [],
  productCategories = [],
  productSubCategories = []
}) => {
  const [open, setOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState(value || {});

  const activeValue = open ? modalDraft : (value || {});

  const openModal = () => {
    setModalDraft({ ...(value || {}) });
    setOpen(true);
  };

  const closeModal = () => {
    setModalDraft({ ...(value || {}) });
    setOpen(false);
  };

  const applyModalDraft = () => {
    onChange(modalDraft || {});
    setOpen(false);
  };

  const updateModalDraft = (patch) => {
    setModalDraft((current) => ({
      ...(current || {}),
      ...patch
    }));
  };

  const selectedSalesArea = productSalesAreas.find((salesArea) => salesArea.name === activeValue?.salesAreaName) || null;
  const selectedGroupName = getClassificationGroupName(activeValue, productCategoryGroups);
  const selectedGroup = productCategoryGroups.find((group) => (
    group.id === activeValue?.categoryGroupId
    || group.name === selectedGroupName
  )) || null;
  const selectedCategory = productCategories.find((category) => category.id === activeValue?.categoryId) || null;

  const allowedGroupNames = Array.isArray(selectedSalesArea?.allowedCategoryGroupNames)
    ? selectedSalesArea.allowedCategoryGroupNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];

  const groupOptions = allowedGroupNames.length > 0
    ? productCategoryGroups.filter((group) => allowedGroupNames.includes(String(group.name || '').trim()))
    : productCategoryGroups;

  const categoryOptions = selectedGroup
    ? productCategories.filter((category) => (
      category.groupId === selectedGroup.id
      || category.categoryGroupId === selectedGroup.id
      || category.groupName === selectedGroup.name
      || category.categoryGroupName === selectedGroup.name
    ))
    : [];

  const subCategoryOptions = selectedCategory
    ? productSubCategories.filter((subCategory) => (
      subCategory.categoryId === selectedCategory.id
      || subCategory.categoryName === selectedCategory.name
    ))
    : [];

  const breadcrumb = buildClassificationBreadcrumb(activeValue, productCategoryGroups, productCategories);

  const selectSalesArea = (salesArea) => {
    updateModalDraft({
      salesAreaName: salesArea?.name || '',
      categoryGroupId: '',
      categoryGroupName: '',
      categoryId: '',
      categoryName: '',
      subCategoryName: ''
    });
  };

  const selectGroup = (group) => {
    updateModalDraft({
      categoryGroupId: group?.id || '',
      categoryGroupName: group?.name || '',
      categoryId: '',
      categoryName: '',
      subCategoryName: ''
    });
  };

  const selectCategory = (category) => {
    updateModalDraft({
      categoryId: category?.id || '',
      categoryName: category?.name || '',
      categoryGroupId: category?.groupId || category?.categoryGroupId || activeValue?.categoryGroupId || '',
      categoryGroupName: selectedGroup?.name || category?.groupName || category?.categoryGroupName || activeValue?.categoryGroupName || '',
      departmentId: category?.departmentId || activeValue?.departmentId || 'retail',
      subCategoryName: ''
    });
  };

  const selectSubCategory = (subCategory) => {
    updateModalDraft({
      subCategoryName: subCategory?.name || ''
    });
  };

  const modalNode = open ? (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Product Classification</p>
            <h3 className="mt-1 text-xl font-black text-slate-900">商品分類を選択</h3>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              売場から順番に選ぶと、候補が自動で絞り込まれます。
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-xl font-black text-slate-500 transition hover:bg-slate-200"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-6 py-4">
          <div className="text-xs font-black text-slate-400">現在の分類</div>
          <div className="mt-1 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-800 shadow-sm">
            {breadcrumb}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-4">
            <section className="space-y-3">
              <div>
                <div className="text-sm font-black text-slate-900">1. 売場</div>
                <div className="mt-1 text-xs font-bold text-slate-400">最初に店頭の売場を選びます。</div>
              </div>
              <div className="space-y-2">
                {productSalesAreas.map((salesArea) => (
                  <ClassificationChoiceButton
                    key={salesArea.id || salesArea.name}
                    label={salesArea.displayName || salesArea.name}
                    subLabel={salesArea.name}
                    active={activeValue?.salesAreaName === salesArea.name}
                    onClick={() => selectSalesArea(salesArea)}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-sm font-black text-slate-900">2. カテゴリーグループ</div>
                <div className="mt-1 text-xs font-bold text-slate-400">売場に紐付いたグループだけ表示します。</div>
              </div>
              <div className="space-y-2">
                {groupOptions.map((group) => (
                  <ClassificationChoiceButton
                    key={group.id || group.name}
                    label={group.name}
                    active={selectedGroup?.id === group.id || selectedGroupName === group.name}
                    disabled={!activeValue?.salesAreaName}
                    onClick={() => selectGroup(group)}
                  />
                ))}
                {activeValue?.salesAreaName && groupOptions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold leading-relaxed text-slate-400">
                    この売場に紐付いたカテゴリーグループがありません。
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-sm font-black text-slate-900">3. カテゴリー</div>
                <div className="mt-1 text-xs font-bold text-slate-400">グループ配下のカテゴリーを選びます。</div>
              </div>
              <div className="space-y-2">
                {categoryOptions.map((category) => (
                  <ClassificationChoiceButton
                    key={category.id || category.name}
                    label={category.name}
                    active={activeValue?.categoryId === category.id}
                    disabled={!selectedGroup}
                    onClick={() => selectCategory(category)}
                  />
                ))}
                {selectedGroup && categoryOptions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold leading-relaxed text-slate-400">
                    このグループにカテゴリーがありません。
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-sm font-black text-slate-900">4. サブカテゴリー</div>
                <div className="mt-1 text-xs font-bold text-slate-400">必要な場合だけ選択します。</div>
              </div>
              <div className="space-y-2">
                <ClassificationChoiceButton
                  label="サブカテゴリーなし"
                  active={!activeValue?.subCategoryName}
                  disabled={!selectedCategory}
                  onClick={() => selectSubCategory(null)}
                />
                {subCategoryOptions.map((subCategory) => (
                  <ClassificationChoiceButton
                    key={subCategory.id || subCategory.name}
                    label={subCategory.name}
                    active={activeValue?.subCategoryName === subCategory.name}
                    disabled={!selectedCategory}
                    onClick={() => selectSubCategory(subCategory)}
                  />
                ))}
                {selectedCategory && subCategoryOptions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-xs font-bold leading-relaxed text-slate-400">
                    このカテゴリーにサブカテゴリーはありません。
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-4">
          <div className="min-w-0 text-sm font-black text-slate-700">
            {breadcrumb}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-100 px-5 text-sm font-black text-slate-500 transition hover:bg-slate-200"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={applyModalDraft}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-orange-500 px-5 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600"
            >
              決定
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-1.5">
      <FieldLabel>分類</FieldLabel>
      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
        <div className="line-clamp-2 text-xs font-black leading-relaxed text-slate-700">
          {breadcrumb}
        </div>
        <button
          type="button"
          onClick={openModal}
          className="mt-2 inline-flex h-8 items-center justify-center rounded-xl bg-slate-900 px-3 text-[11px] font-black text-white transition hover:bg-slate-700"
        >
          分類を変更
        </button>
      </div>

      {modalNode && createPortal(modalNode, document.body)}
    </div>
  );
};

export const SimpleMasterPanel = ({
  label,
  blank,
  items,
  fields,
  onSave,
  onDelete,
  onSaved,
  suppliers = [],
  productCategories = [],
  productCategoryGroups = [],
  productSubCategories = [],
  onSaveSupplier,
  onSaveCategoryGroup,
  defaultTaxRate = 10,
  storeId = '',
  products = [],
  cascadeTaxLevel = ''
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

  const toggleAllowedCategoryGroupName = (groupName) => {
    setDraft((current) => {
      const normalizedGroupName = String(groupName || '').trim();
      if (!normalizedGroupName) return current;

      const currentNames = Array.isArray(current.allowedCategoryGroupNames)
        ? current.allowedCategoryGroupNames
        : [];

      const nextNames = currentNames.includes(normalizedGroupName)
        ? currentNames.filter((name) => name !== normalizedGroupName)
        : [...currentNames, normalizedGroupName];

      return {
        ...current,
        allowedCategoryGroupNames: nextNames
      };
    });
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
        ...(draft.taxRateType !== undefined ? {
          taxRateType: normalizeMasterTaxRateType(draft.taxRateType),
          taxRate: resolveMasterTaxRate(draft.taxRateType, draft.taxRate)
        } : {}),
        ...(draft.allowedCategoryGroupNames !== undefined ? {
          allowedCategoryGroupNames: Array.isArray(draft.allowedCategoryGroupNames)
            ? draft.allowedCategoryGroupNames.map((name) => String(name || '').trim()).filter(Boolean)
            : []
        } : {}),
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
      const shouldCascadeTaxRate = Boolean(
        editingId &&
        cascadeTaxLevel &&
        draft.taxRateType !== undefined &&
        hasMasterTaxRateChanged(selectedSnapshot || {}, payload || {})
      );

      await onSave(payload);

      if (shouldCascadeTaxRate) {
        const cascadeResult = await cascadeMasterTaxRateToProducts({
          storeId,
          products,
          cascadeTaxLevel,
          masterId: editingId,
          masterName: payload.name || draft.name || selectedSnapshot?.name || '',
          taxRate: payload.taxRate,
          taxRateType: payload.taxRateType
        });

        if (cascadeResult.updated > 0) {
          alert(`税率を配下商品 ${cascadeResult.updated.toLocaleString()} 件へ反映しました。`);
        }
      }

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
    if (label === '売場') {
      const allowedNames = Array.isArray(item.allowedCategoryGroupNames)
        ? item.allowedCategoryGroupNames.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
      const displayName = String(item.displayName || '').trim();

      return (
        <div className="mt-2 space-y-2">
          {displayName && displayName !== item.name && (
            <div className="text-xs font-bold text-slate-400">
              表示名：{displayName}
            </div>
          )}

          {allowedNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {allowedNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-600"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs font-bold text-orange-500">
              カテゴリーグループ未紐付け
            </div>
          )}
        </div>
      );
    }

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
        {[
          item.groupName || productCategoryGroups.find((group) => group.id === item.groupId)?.name || item.supplierName || item.kana || item.contactName || item.paymentTerms || item.brandProfile || item.note || item.id,
          item.taxRateType !== undefined ? `税率: ${formatMasterTaxRateLabel(item, defaultTaxRate)}` : ''
        ].filter(Boolean).join(' / ')}
      </div>
    );
  };

  const getChildCategoriesForDraft = () => {
    if (label !== 'カテゴリーグループ') return [];

    const groupId = String(draft.id || editingId || '').trim();
    const groupName = String(draft.name || '').trim();

    return (productCategories || [])
      .filter((category) => {
        const categoryGroupId = String(category.groupId || category.categoryGroupId || '').trim();
        const categoryGroupName = String(category.groupName || category.categoryGroupName || '').trim();

        if (groupId) {
          return categoryGroupId === groupId;
        }

        return Boolean(groupName && categoryGroupName === groupName);
      })
      .filter((category, index, array) => (
        array.findIndex((candidate) => (
          String(candidate.id || '').trim() === String(category.id || '').trim()
          || (
            String(candidate.name || '').trim() === String(category.name || '').trim()
            && String(candidate.groupId || candidate.categoryGroupId || '').trim()
              === String(category.groupId || category.categoryGroupId || '').trim()
          )
        )) === index
      ))
      .sort((a, b) => {
        const aSort = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 999999;
        const bSort = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 999999;
        if (aSort !== bSort) return aSort - bSort;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      });
  };

  const getSubCategoriesForCategory = (category) => {
    const categoryId = String(category?.id || '').trim();
    const categoryName = String(category?.name || '').trim();

    return (productSubCategories || [])
      .filter((subCategory) => {
        const subCategoryCategoryId = String(subCategory.categoryId || '').trim();
        const subCategoryCategoryName = String(subCategory.categoryName || '').trim();

        if (categoryId) {
          return subCategoryCategoryId === categoryId;
        }

        return Boolean(categoryName && subCategoryCategoryName === categoryName);
      })
      .filter((subCategory, index, array) => (
        array.findIndex((candidate) => (
          String(candidate.id || '').trim() === String(subCategory.id || '').trim()
          || (
            String(candidate.name || '').trim() === String(subCategory.name || '').trim()
            && String(candidate.categoryId || '').trim() === String(subCategory.categoryId || '').trim()
          )
        )) === index
      ))
      .sort((a, b) => {
        const aSort = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 999999;
        const bSort = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 999999;
        if (aSort !== bSort) return aSort - bSort;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      });
  };

  const getChildSubCategoriesForDraft = () => {
    if (label !== 'カテゴリー') return [];

    const categoryId = String(draft.id || editingId || '').trim();
    const categoryName = String(draft.name || '').trim();

    return (productSubCategories || [])
      .filter((subCategory) => {
        const subCategoryCategoryId = String(subCategory.categoryId || '').trim();
        const subCategoryCategoryName = String(subCategory.categoryName || '').trim();

        if (categoryId) {
          return subCategoryCategoryId === categoryId;
        }

        return Boolean(categoryName && subCategoryCategoryName === categoryName);
      })
      .filter((subCategory, index, array) => (
        array.findIndex((candidate) => (
          String(candidate.id || '').trim() === String(subCategory.id || '').trim()
          || (
            String(candidate.name || '').trim() === String(subCategory.name || '').trim()
            && String(candidate.categoryId || '').trim() === String(subCategory.categoryId || '').trim()
          )
        )) === index
      ))
      .sort((a, b) => {
        const aSort = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 999999;
        const bSort = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 999999;
        if (aSort !== bSort) return aSort - bSort;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      });
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
            field.type === 'taxRateSelect' ? (
              <label key={field.id} className="block">
                <FieldLabel>{field.label}</FieldLabel>
                <select
                  value={normalizeMasterTaxRateType(draft[field.id])}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const nextType = normalizeMasterTaxRateType(event.target.value);
                    setDraft((current) => ({
                      ...current,
                      [field.id]: nextType,
                      taxRate: resolveMasterTaxRate(nextType, current.taxRate)
                    }));
                    onSaved?.();
                  }}
                  className="mt-1 h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none transition focus:border-orange-300 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {getMasterTaxRateOptions(defaultTaxRate).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-400">
                  標準税率を使用する場合は、税・価格設定の標準税率に追従します。例外だけ 8% / 10% / 0% を指定します。
                </p>
              </label>
            ) : field.type === 'categoryGroupMultiSelect' ? (
              <div key={field.id} className="space-y-2">
                <FieldLabel>{field.label}</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(productCategoryGroups || []).map((group) => {
                    const groupName = String(group.name || '').trim();
                    const checked = Array.isArray(draft.allowedCategoryGroupNames)
                      && draft.allowedCategoryGroupNames.includes(groupName);

                    return (
                      <label
                        key={group.id || groupName}
                        className={classNames(
                          'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition',
                          !canEdit ? 'cursor-default opacity-70' : 'cursor-pointer',
                          checked
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          disabled={!canEdit}
                          onChange={() => toggleAllowedCategoryGroupName(groupName)}
                        />
                        <span>{groupName}</span>
                      </label>
                    );
                  })}
                </div>
                {(productCategoryGroups || []).length === 0 && (
                  <div className="text-xs font-bold text-slate-400">
                    先にカテゴリーグループを登録してください。
                  </div>
                )}
              </div>
            ) : field.type === 'categorySelect' ? (
              <PosModalSelect
                key={field.id}
                label={field.label}
                value={draft[field.id]}
                options={productCategories}
                disabled={!canEdit}
                placeholder="親カテゴリーを選択"
                searchPlaceholder="カテゴリー名・IDで検索"
                createLabel="カテゴリーを新規作成"
                onCreateSave={undefined}
                createFields={[
                  { id: 'name', label: 'カテゴリー名' }
                ]}
                createInitialValue={{ name: '', sortOrder: 0, taxRateType: 'inherit', taxRate: null, isActive: true }}
                onCreate={reset}
                getOptionLabel={(option) => {
                  const groupName = option.groupName || productCategoryGroups.find((group) => group.id === option.groupId)?.name || '';
                  return groupName ? `${groupName} / ${option.name}` : option.name;
                }}
                getOptionSubLabel={(option) => option.id}
                onChange={(value, category) => {
                  const group = productCategoryGroups.find((item) => item.id === category?.groupId);
                  setDraft((current) => ({
                    ...current,
                    [field.id]: value,
                    categoryName: category?.name || '',
                    categoryGroupId: category?.groupId || '',
                    categoryGroupName: group?.name || category?.groupName || category?.categoryGroupName || '',
                    groupId: category?.groupId || '',
                    groupName: group?.name || category?.groupName || category?.categoryGroupName || ''
                  }));
                  onSaved?.();
                }}
              />
            ) : field.type === 'categoryGroupSelect' ? (
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
                  { id: 'sortOrder', label: '並び順', type: 'number' },
                  { id: 'taxRateType', label: '税率', type: 'taxRateSelect' }
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

          {label === 'カテゴリーグループ' && editingId && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black text-slate-500">含まれるカテゴリー</div>
                  <div className="mt-0.5 text-[11px] font-bold text-slate-400">
                    このグループ配下のカテゴリーとサブカテゴリーを確認できます。
                  </div>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 shadow-sm">
                  {getChildCategoriesForDraft().length}件
                </span>
              </div>

              {getChildCategoriesForDraft().length > 0 ? (
                <div className="mt-3 space-y-2.5">
                  {getChildCategoriesForDraft().map((category) => {
                    const childSubCategories = getSubCategoriesForCategory(category);

                    return (
                      <div
                        key={category.id || category.name}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-black text-slate-700">
                            {category.name}
                          </div>
                          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-400">
                            {childSubCategories.length}件
                          </span>
                        </div>

                        {childSubCategories.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {childSubCategories.map((subCategory) => (
                              <span
                                key={subCategory.id || `${category.id || category.name}:${subCategory.name}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-600"
                              >
                                {subCategory.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] font-bold text-slate-400">
                            サブカテゴリーなし
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-400">
                  まだカテゴリーが紐付いていません。
                </div>
              )}
            </div>
          )}

          {label === 'カテゴリー' && editingId && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black text-slate-500">含まれるサブカテゴリー</div>
                  <div className="mt-0.5 text-[11px] font-bold text-slate-400">
                    このカテゴリー配下のサブカテゴリーを確認できます。
                  </div>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 shadow-sm">
                  {getChildSubCategoriesForDraft().length}件
                </span>
              </div>

              {getChildSubCategoriesForDraft().length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {getChildSubCategoriesForDraft().map((subCategory) => (
                    <span
                      key={subCategory.id || subCategory.name}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600"
                    >
                      {subCategory.name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-400">
                  まだサブカテゴリーが紐付いていません。
                </div>
              )}
            </div>
          )}

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
  storeId,
  products = [],
  productGroups = [],
  productCategories = [],
  productCategoryGroups = [],
  productSubCategories = [],
  productSalesAreas = [],
  brands = [],
  suppliers = [],
  loading,
  onSaveProduct,
  onDeleteProduct,
  onCreateShopifyDraftProduct,
  onUpdateShopifyProduct,
  onSaveCategory,
  onDeleteCategory,
  onSaveCategoryGroup,
  onDeleteCategoryGroup,
  onSaveSubCategory,
  onDeleteSubCategory,
  onSaveBrand,
  onDeleteBrand,
  onSaveSupplier,
  onDeleteSupplier,
  shopifySettings,
  onSaveShopifySettings,
  onSaved,
  defaultTaxRate = 10,
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
  const filteredSubCategories = useMemo(() => filterItems(productSubCategories), [keyword, productSubCategories]);
  const filteredBrands = useMemo(() => filterItems(brands), [keyword, brands]);
  const filteredSuppliers = useMemo(() => filterItems(suppliers), [keyword, suppliers]);
  const [headerSearchResults, setHeaderSearchResults] = useState([]);
  const [headerSearchLoading, setHeaderSearchLoading] = useState(false);
  const [headerSearchError, setHeaderSearchError] = useState('');

  const headerSearchKeyword = useMemo(() => normalizeProductMasterSearchText(keyword), [keyword]);
  const isHeaderProductSearchActive = Boolean(storeId && headerSearchKeyword);

  useEffect(() => {
    if (!storeId || !headerSearchKeyword) {
      setHeaderSearchResults([]);
      setHeaderSearchError('');
      setHeaderSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const searchTerms = buildProductMasterHeaderSearchTerms(headerSearchKeyword);
      const requiredTerms = buildProductMasterRequiredSearchTerms(headerSearchKeyword);

      if (!searchTerms.length) {
        if (!cancelled) {
          setHeaderSearchResults([]);
          setHeaderSearchError('');
          setHeaderSearchLoading(false);
        }
        return;
      }

      setHeaderSearchLoading(true);
      setHeaderSearchError('');

      try {
        const productsRef = collection(db, 'stores', storeId, 'products');

        const candidateTermGroups = requiredTerms.length > 1
          ? requiredTerms.map((term) => buildProductMasterHeaderSearchTerms(term).slice(0, 10)).filter((terms) => terms.length)
          : [searchTerms];

        const candidateSnapshots = await Promise.all(
          candidateTermGroups.map(async (candidateTerms) => {
            const candidateQuery = query(
              productsRef,
              where('searchKeywords', 'array-contains-any', candidateTerms),
              limit(PRODUCT_MASTER_HEADER_CANDIDATE_LIMIT)
            );
            const snapshot = await getDocs(candidateQuery);
            return {
              terms: candidateTerms,
              docs: snapshot.docs
            };
          })
        );

        const bestCandidate = candidateSnapshots
          .filter((candidate) => candidate.docs.length > 0)
          .sort((a, b) => a.docs.length - b.docs.length)[0];

        const sourceDocs = bestCandidate?.docs || [];

        const nextResults = sourceDocs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data()
          }))
          .filter((product) => productMatchesAllHeaderSearchTerms(product, requiredTerms))
          .slice(0, PRODUCT_MASTER_HEADER_SEARCH_LIMIT);

        if (!cancelled) {
          setHeaderSearchResults(nextResults);
        }
      } catch (searchError) {
        console.error('[product master header search] failed', searchError);
        if (!cancelled) {
          setHeaderSearchResults([]);
          setHeaderSearchError(searchError?.message || '全商品検索に失敗しました。');
        }
      } finally {
        if (!cancelled) {
          setHeaderSearchLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [headerSearchKeyword, storeId]);

  const displayedProducts = isHeaderProductSearchActive ? headerSearchResults : filteredProducts;


  return (
    <div className="space-y-5">
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          {activeTab === 'products' && (
            <>
              {isHeaderProductSearchActive && (
                <div className="mb-3 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-bold text-slate-600">
                  {headerSearchLoading ? (
                    <span>全商品から検索中...</span>
                  ) : headerSearchError ? (
                    <span className="text-rose-600">全商品検索エラー: {headerSearchError}</span>
                  ) : (
                    <span>
                      全商品検索: 「{headerSearchKeyword}」 / {displayedProducts.length.toLocaleString()}件表示
                      {headerSearchKeyword.includes(' ') || headerSearchKeyword.includes('　') ? '（複数ワードAND・代表候補検索）' : ''}
                      {displayedProducts.length >= PRODUCT_MASTER_HEADER_SEARCH_LIMIT ? `（表示上限${PRODUCT_MASTER_HEADER_SEARCH_LIMIT}件）` : ''}
                    </span>
                  )}
                </div>
              )}

              <ProductMasterTable
                products={displayedProducts}
                productGroups={productGroups}
                productCategories={productCategories}
                productCategoryGroups={productCategoryGroups}
                productSubCategories={productSubCategories}
                productSalesAreas={productSalesAreas}
                brands={brands}
                suppliers={suppliers}
                onSaveProduct={onSaveProduct}
                onDeleteProduct={onDeleteProduct}
                onCreateShopifyDraftProduct={onCreateShopifyDraftProduct}
                onUpdateShopifyProduct={onUpdateShopifyProduct}
                onSaved={onSaved}
              />
            </>
          )}

          {false && activeTab === 'products' && (
            <SimpleMasterPanel
              label="カテゴリー"
              blank={blankCategory}
              items={filteredCategories}
              fields={[
                { id: 'name', label: 'カテゴリー名' },
                { id: 'groupId', label: 'グループID' },
                { id: 'sortOrder', label: '並び順', type: 'number' },
                  { id: 'taxRateType', label: '税率', type: 'taxRateSelect' },
                { id: 'color', label: 'カラー' }
              ]}
              onSave={onSaveCategory}
              onDelete={onDeleteCategory}
              onSaved={onSaved}
              defaultTaxRate={defaultTaxRate}
            />
          )}

          {false && activeTab === 'subCategories' && (
            <SimpleMasterPanel
              label="サブカテゴリー"
              blank={blankCategory}
              items={filteredSubCategories}
              fields={[
                { id: 'name', label: 'サブカテゴリー名' },
                { id: 'categoryId', label: '親カテゴリーID' },
                { id: 'categoryName', label: '親カテゴリー名' },
                { id: 'categoryGroupName', label: 'カテゴリーグループ名' },
                { id: 'sortOrder', label: '並び順', type: 'number' },
                  { id: 'taxRateType', label: '税率', type: 'taxRateSelect' },
                { id: 'color', label: 'カラー' }
              ]}
              onSave={onSaveSubCategory}
              onDelete={onDeleteSubCategory}
              onSaved={onSaved}
              defaultTaxRate={defaultTaxRate}
            />
          )}

          {false && activeTab === 'groups' && (
            <SimpleMasterPanel
              label="カテゴリーグループ"
              blank={blankGroup}
              items={filteredGroups}
              fields={[
                { id: 'name', label: 'グループ名' },
                { id: 'sortOrder', label: '並び順', type: 'number' },
                  { id: 'taxRateType', label: '税率', type: 'taxRateSelect' }
              ]}
              onSave={onSaveCategoryGroup}
              onDelete={onDeleteCategoryGroup}
              onSaved={onSaved}
              defaultTaxRate={defaultTaxRate}
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
              defaultTaxRate={defaultTaxRate}
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
              defaultTaxRate={defaultTaxRate}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ProductMasterSettings;
