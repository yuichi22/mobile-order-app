import React, { useMemo, useRef, useState } from 'react';

import {
  PRODUCT_CSV_FIELD_OPTIONS,
  buildProductCsvMappingDraft,
  buildProductCsvPreview,
  parseProductCsvText
} from '../utils/productCsvImport';

const normalizeNumberOrNullForImport = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const normalizeImportedProductPayload = (product) => ({
  ...product,
  name: String(product.name || '').trim(),
  sku: String(product.sku || '').trim(),
  productCode: String(product.productCode || product.sku || '').trim(),
  barcode: String(product.barcode || '').trim(),
  categoryId: String(product.categoryId || '').trim(),
  subCategoryName: String(product.subCategoryName || '').trim(),
  categoryGroupId: String(product.categoryGroupId || '').trim(),
  brandId: String(product.brandId || '').trim(),
  supplierId: String(product.supplierId || '').trim(),
  departmentId: product.departmentId || 'retail',
  productType: product.productType || 'retail',
  size: String(product.size || '').trim(),
  colorName: String(product.colorName || '').trim(),
  priceTaxIncluded: normalizeNumberOrNullForImport(product.priceTaxIncluded),
  priceTaxExcluded: normalizeNumberOrNullForImport(product.priceTaxExcluded),
  taxRateType: product.taxRateType || 'standard',
  taxRate: normalizeNumberOrNullForImport(product.taxRate) ?? 10,
  costTaxExcluded: normalizeNumberOrNullForImport(product.costTaxExcluded),
  costTaxIncluded: normalizeNumberOrNullForImport(product.costTaxIncluded),
  supplierCostRate: normalizeNumberOrNullForImport(product.supplierCostRate),
  orderLot: normalizeNumberOrNullForImport(product.orderLot),
  reorderLot: normalizeNumberOrNullForImport(product.reorderLot || product.orderLot),
  reorderPoint: normalizeNumberOrNullForImport(product.reorderPoint),
  reorderQuantity: normalizeNumberOrNullForImport(product.reorderQuantity),
  labelEnabled: Boolean(product.labelEnabled),
  shopifyCreateEnabled: Boolean(product.shopifyCreateEnabled),
  isActive: product.isActive !== false,
  isArchived: Boolean(product.isArchived),
  shopifyProductId: String(product.shopifyProductId || '').trim(),
  shopifyVariantId: String(product.shopifyVariantId || '').trim(),
  shopifyInventoryItemId: String(product.shopifyInventoryItemId || '').trim(),
  productGroupId: String(product.productGroupId || '').trim(),
  productGroupRole: product.productGroupRole || 'primary',
  productGroupName: String(product.productGroupName || '').trim(),
  groupCode: String(product.groupCode || '').trim()
});

const getFieldLabel = (fieldKey) => (
  PRODUCT_CSV_FIELD_OPTIONS.find((option) => option.id === fieldKey)?.label || '取り込まない'
);

const ProductCsvMappingModal = ({
  fileName,
  headers,
  rows,
  mappingDraft,
  setMappingDraft,
  onClose,
  onApply
}) => {
  const mappedFieldKeys = useMemo(
    () => new Set(mappingDraft.map((mapping) => mapping.fieldKey).filter(Boolean)),
    [mappingDraft]
  );
  const hasNameMapping = mappedFieldKeys.has('name');

  const updateMapping = (columnIndex, fieldKey) => {
    setMappingDraft((current) => current.map((mapping) => {
      if (mapping.columnIndex === columnIndex) {
        return { ...mapping, fieldKey };
      }

      if (fieldKey && mapping.fieldKey === fieldKey) {
        return { ...mapping, fieldKey: '' };
      }

      return mapping;
    }));
  };

  const firstDataRow = rows?.[1] || [];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-sky-50/80 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-500">Column Mapping</p>
              <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-900">CSV列の紐付け</h3>
              <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
                {fileName || 'CSVファイル'} の先頭行をヘッダーとして読み取り、Akutoの商品項目へ紐付けます。
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-500 shadow-sm"
            >
              閉じる
            </button>
          </div>

          {!hasNameMapping && (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              商品名に紐づく列を選択してください。商品名は必須です。
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-400">
                <tr>
                  <th className="w-16 px-4 py-3">列</th>
                  <th className="px-4 py-3">CSVヘッダー</th>
                  <th className="px-4 py-3">先頭データ例</th>
                  <th className="w-72 px-4 py-3">Akuto項目</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mappingDraft.map((mapping) => (
                  <tr key={`${mapping.columnIndex}-${mapping.header}`}>
                    <td className="px-4 py-3 font-mono text-xs font-black text-slate-400">
                      {mapping.columnIndex + 1}
                    </td>
                    <td className="px-4 py-3 font-black text-slate-800">
                      {headers[mapping.columnIndex] || `列${mapping.columnIndex + 1}`}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-xs font-bold text-slate-500">
                      {firstDataRow[mapping.columnIndex] || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={mapping.fieldKey}
                        onChange={(event) => updateMapping(mapping.columnIndex, event.target.value)}
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      >
                        {PRODUCT_CSV_FIELD_OPTIONS.map((option) => (
                          <option key={option.id || 'none'} value={option.id}>
                            {option.label}{option.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs font-bold leading-relaxed text-slate-400">
            同じAkuto項目を複数列に割り当てた場合は、最後に選んだ列だけが有効になります。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-5">
          <div className="text-xs font-bold text-slate-400">
            紐付け済み: {mappingDraft.filter((mapping) => mapping.fieldKey).length.toLocaleString()} / {mappingDraft.length.toLocaleString()}列
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-500"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!hasNameMapping}
              className="rounded-2xl bg-sky-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              この紐付けでプレビュー
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProductCsvImportPanel = ({
  products = [],
  productCategories = [],
  productCategoryGroups = [],
  brands = [],
  suppliers = [],
  onSaveProduct,
  onSaveProductGroup,
  onSaved
}) => {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [mappingDraft, setMappingDraft] = useState([]);
  const [showMappingModal, setShowMappingModal] = useState(false);

  const headers = csvRows[0] || [];

  const reset = () => {
    setPreview(null);
    setFileName('');
    setError('');
    setCsvRows([]);
    setMappingDraft([]);
    setShowMappingModal(false);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const buildPreviewFromMapping = (nextMappingDraft = mappingDraft) => {
    const nextPreview = buildProductCsvPreview({
      rows: csvRows,
      mappingDraft: nextMappingDraft,
      products,
      productCategories,
      productCategoryGroups,
      brands,
      suppliers
    });

    setPreview(nextPreview);
    setShowMappingModal(false);
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];

    setPreview(null);
    setError('');
    setCsvRows([]);
    setMappingDraft([]);
    setShowMappingModal(false);
    setFileName(file?.name || '');

    if (!file) return;

    try {
      const csvText = await file.text();
      const parsedRows = parseProductCsvText(csvText);
      const parsedHeaders = parsedRows[0] || [];
      const nextMappingDraft = buildProductCsvMappingDraft(parsedHeaders);

      if (!parsedHeaders.length) {
        setError('CSVヘッダーを読み取れませんでした。');
        return;
      }

      setCsvRows(parsedRows);
      setMappingDraft(nextMappingDraft);
      setShowMappingModal(true);
    } catch (nextError) {
      console.error('[ProductCsvImportPanel] CSV parse failed', nextError);
      setError('CSVの読み込みに失敗しました。ファイル形式を確認してください。');
    }
  };

  const executeImport = async () => {
    if (!preview?.importableProducts?.length || saving) return;

    if (typeof onSaveProduct !== 'function') {
      setError('商品保存処理が未接続です。');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const productGroups = Array.isArray(preview.importableProductGroups)
        ? preview.importableProductGroups
        : [];

      if (productGroups.length > 0 && typeof onSaveProductGroup !== 'function') {
        setError('商品グループ保存処理が未接続です。');
        return;
      }

      for (const group of productGroups) {
        await onSaveProductGroup(group);
      }

      for (const product of preview.importableProducts) {
        const { __rowNumber, ...payload } = product;
        await onSaveProduct(normalizeImportedProductPayload(payload));
      }

      const savedCount = preview.importableProducts.length;
      const savedGroupCount = productGroups.length;
      reset();
      onSaved?.();
      window.alert(`${savedGroupCount.toLocaleString()}件の商品グループ、${savedCount.toLocaleString()}件の商品を取り込みました。`);
    } catch (nextError) {
      console.error('[ProductCsvImportPanel] CSV save failed', nextError);
      setError('CSV取込の保存に失敗しました。一部だけ保存された可能性があります。商品一覧を確認してください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-slate-100 bg-white px-5 py-4">
      <div className="rounded-3xl border-2 border-sky-100 bg-sky-50/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-slate-900">CSV取込</div>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
              CSV選択後、列の紐付けを確認してからプレビューします。既存品番・既存バーコードはスキップします。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={saving}
              className="rounded-2xl border-2 border-sky-100 bg-white px-4 py-2 text-xs font-black text-sky-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:opacity-60"
            >
              CSVを選択
            </button>
            {!!csvRows.length && (
              <button
                type="button"
                onClick={() => setShowMappingModal(true)}
                disabled={saving}
                className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                列の紐付け
              </button>
            )}
            {(preview || error || csvRows.length > 0) && (
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-500 shadow-sm disabled:opacity-60"
              >
                取消
              </button>
            )}
            <button
              type="button"
              onClick={executeImport}
              disabled={saving || !preview?.importableProducts?.length || typeof onSaveProduct !== 'function'}
              className="rounded-2xl bg-sky-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              {saving ? '取込中...' : '取込実行'}
            </button>
          </div>
        </div>

        {!!mappingDraft.length && (
          <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs font-bold text-slate-500">
            列の紐付け:
            <span className="ml-2 text-slate-900">
              {mappingDraft.filter((mapping) => mapping.fieldKey).length.toLocaleString()} / {mappingDraft.length.toLocaleString()}列
            </span>
            <span className="ml-3 text-slate-400">
              商品名: {mappingDraft.some((mapping) => mapping.fieldKey === 'name') ? '設定済み' : '未設定'}
            </span>
          </div>
        )}

        {(fileName || preview) && (
          <p className="mt-3 text-xs font-bold text-slate-500">
            {fileName || 'CSVファイル'} / データ行 {Number(preview?.totalRows || Math.max(csvRows.length - 1, 0)).toLocaleString()}件 / グループ {Number(preview?.importableProductGroups?.length || 0).toLocaleString()}件 / 取込対象 {Number(preview?.importableProducts?.length || 0).toLocaleString()}件 / スキップ {Number(preview?.skippedProducts?.length || 0).toLocaleString()}件
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
            {error}
          </div>
        )}

        {!!preview?.errors?.length && (
          <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold text-red-600">
            <div className="mb-1 font-black">エラー</div>
            {preview.errors.slice(0, 5).map((message) => (
              <div key={message}>・{message}</div>
            ))}
            {preview.errors.length > 5 && <div>ほか {preview.errors.length - 5}件</div>}
          </div>
        )}

        {!!preview?.warnings?.length && (
          <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
            <div className="mb-1 font-black">警告</div>
            {preview.warnings.slice(0, 8).map((message) => (
              <div key={message}>・{message}</div>
            ))}
            {preview.warnings.length > 8 && <div>ほか {preview.warnings.length - 8}件</div>}
          </div>
        )}

        {!!preview?.importableProducts?.length && (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-sky-100 bg-white">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-black text-slate-400">
                <tr>
                  <th className="px-3 py-2">行</th>
                  <th className="px-3 py-2">品番</th>
                  <th className="px-3 py-2">商品名</th>
                  <th className="px-3 py-2">カテゴリー</th>
                  <th className="px-3 py-2">ブランド</th>
                  <th className="px-3 py-2 text-right">売価</th>
                  <th className="px-3 py-2 text-right">在庫</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                {preview.importableProducts.slice(0, 5).map((product) => (
                  <tr key={`${product.__rowNumber}-${product.sku}-${product.barcode}`}>
                    <td className="px-3 py-2">{product.__rowNumber}</td>
                    <td className="px-3 py-2">{product.sku || '-'}</td>
                    <td className="px-3 py-2 text-slate-900">{product.name}</td>
                    <td className="px-3 py-2">{product.subCategoryName ? `${product.categoryName || '-'} / ${product.subCategoryName}` : (product.categoryName || '-')}</td>
                    <td className="px-3 py-2">{product.brandName || '-'}</td>
                    <td className="px-3 py-2 text-right">{Number(product.priceTaxIncluded || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(product.inventoryQuantity || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.importableProducts.length > 5 && (
              <div className="border-t border-slate-100 px-3 py-2 text-xs font-bold text-slate-400">
                先頭5件のみ表示しています。
              </div>
            )}
          </div>
        )}
      </div>

      {showMappingModal && (
        <ProductCsvMappingModal
          fileName={fileName}
          headers={headers}
          rows={csvRows}
          mappingDraft={mappingDraft}
          setMappingDraft={setMappingDraft}
          onClose={() => setShowMappingModal(false)}
          onApply={() => buildPreviewFromMapping()}
        />
      )}
    </div>
  );
};

export default ProductCsvImportPanel;
