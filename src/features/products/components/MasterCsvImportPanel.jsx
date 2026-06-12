import React, { useMemo, useRef, useState } from 'react';

import {
  MASTER_CSV_FIELD_OPTIONS,
  buildMasterCsvMappingDraft,
  buildMasterCsvPreview,
  parseMasterCsvText
} from '../utils/masterCsvImport';

const IMPORT_LABELS = {
  suppliers: {
    title: '仕入先CSV取込',
    requiredLabel: '仕入先名',
    previewColumns: [
      ['処理', 'importActionLabel'],
      ['仕入先ID', 'supplierId'],
      ['仕入先名', 'name'],
      ['担当者', 'contactName'],
      ['電話番号', 'tel'],
      ['掛率', 'defaultCostRate']
    ]
  },
  brands: {
    title: 'ブランドCSV取込',
    requiredLabel: 'ブランド名',
    previewColumns: [
      ['処理', 'importActionLabel'],
      ['ブランドID', 'brandId'],
      ['ブランド名', 'name'],
      ['棚卸区分', 'stocktakingTypeCode'],
      ['仕入先ID', 'supplierId'],
      ['仕入先名', 'supplierName']
    ]
  },
  categories: {
    title: 'カテゴリー / カテゴリーグループCSV取込',
    requiredLabel: 'カテゴリー名',
    previewColumns: [
      ['処理', 'importActionLabel'],
      ['グループID', 'categoryGroupId'],
      ['グループ名', 'categoryGroupName'],
      ['カテゴリーID', 'categoryId'],
      ['カテゴリー名', 'categoryName'],
      ['並び順', 'sortOrder']
    ]
  }
};

const normalizeNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const normalizeSupplierPayload = (item) => ({
  ...(item.id ? { id: String(item.id).trim() } : {}),
  name: String(item.name || '').trim(),
  kana: String(item.kana || '').trim(),
  smaregiSupplierId: String(item.smaregiSupplierId || item.supplierId || item.supplierCode || '').trim(),
  supplierExternalId: String(item.supplierExternalId || item.smaregiSupplierId || item.supplierId || item.supplierCode || '').trim(),
  supplierCode: String(item.supplierCode || item.supplierId || item.smaregiSupplierId || item.supplierExternalId || '').trim(),
  contactName: String(item.contactName || '').trim(),
  tel: String(item.tel || '').trim(),
  fax: String(item.fax || '').trim(),
  backorderValidDays: normalizeNumberOrNull(item.backorderValidDays),
  orderListPrice: normalizeNumberOrNull(item.orderListPrice),
  defaultCostRate: normalizeNumberOrNull(item.defaultCostRate),
  paymentTerms: String(item.paymentTerms || '').trim(),
  note: String(item.note || '').trim(),
  isActive: item.isActive !== false
});

const normalizeBrandPayload = (item) => ({
  ...item,
  ...(item.id ? { id: String(item.id).trim() } : {}),
  name: String(item.name || '').trim(),
  kana: String(item.kana || '').trim(),
  smaregiBrandId: String(item.smaregiBrandId || item.brandId || item.brandCode || '').trim(),
  brandExternalId: String(item.brandExternalId || item.smaregiBrandId || item.brandId || item.brandCode || '').trim(),
  brandCode: String(item.brandCode || item.brandId || item.smaregiBrandId || item.brandExternalId || '').trim(),
  stocktakingTypeCode: String(item.stocktakingTypeCode || '').trim(),
  supplierId: String(item.supplierId || '').trim(),
  supplierSmaregiId: String(item.supplierSmaregiId || item.supplierExternalId || '').trim(),
  supplierExternalId: String(item.supplierExternalId || item.supplierSmaregiId || '').trim(),
  supplierName: String(item.supplierName || '').trim(),
  note: String(item.note || '').trim(),
  isActive: item.isActive !== false
});

const normalizeGroupPayload = (item) => ({
  ...item,
  name: String(item.name || '').trim(),
  smaregiCategoryGroupId: String(item.smaregiCategoryGroupId || '').trim(),
  categoryGroupExternalId: String(item.categoryGroupExternalId || item.smaregiCategoryGroupId || '').trim(),
  sortOrder: normalizeNumberOrNull(item.sortOrder) ?? 0,
  departmentId: item.departmentId || 'retail',
  isActive: item.isActive !== false
});

const normalizeCategoryPayload = (item) => ({
  ...item,
  name: String(item.name || '').trim(),
  smaregiCategoryId: String(item.smaregiCategoryId || '').trim(),
  categoryExternalId: String(item.categoryExternalId || item.smaregiCategoryId || '').trim(),
  groupId: String(item.groupId || '').trim(),
  groupName: String(item.groupName || '').trim(),
  sortOrder: normalizeNumberOrNull(item.sortOrder) ?? 0,
  departmentId: item.departmentId || 'retail',
  color: item.color || '#64748b',
  note: String(item.note || '').trim(),
  isActive: item.isActive !== false
});

const MasterCsvMappingModal = ({
  type,
  fileName,
  headers,
  rows,
  mappingDraft,
  setMappingDraft,
  onClose,
  onApply
}) => {
  const options = MASTER_CSV_FIELD_OPTIONS[type] || [];
  const label = IMPORT_LABELS[type] || IMPORT_LABELS.suppliers;
  const requiredFields = options.filter((option) => option.required).map((option) => option.id);
  const mappedFieldKeys = useMemo(
    () => new Set(mappingDraft.map((mapping) => mapping.fieldKey).filter(Boolean)),
    [mappingDraft]
  );
  const missingRequiredFields = requiredFields.filter((fieldKey) => !mappedFieldKeys.has(fieldKey));
  const firstDataRow = rows?.[1] || [];

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

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-blue-50/80 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-500">Column Mapping</p>
              <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{label.title} 列の紐付け</h3>
              <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
                {fileName || 'CSVファイル'} の先頭行をヘッダーとして読み取り、Akuto項目へ紐付けます。
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-500 shadow-sm">
              閉じる
            </button>
          </div>

          {!!missingRequiredFields.length && (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              必須項目「{label.requiredLabel}」に紐づく列を選択してください。
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
                    <td className="px-4 py-3 font-mono text-xs font-black text-slate-400">{mapping.columnIndex + 1}</td>
                    <td className="px-4 py-3 font-black text-slate-800">{headers[mapping.columnIndex] || `列${mapping.columnIndex + 1}`}</td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-xs font-bold text-slate-500">{firstDataRow[mapping.columnIndex] || '-'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={mapping.fieldKey}
                        onChange={(event) => updateMapping(mapping.columnIndex, event.target.value)}
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      >
                        {options.map((option) => (
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
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-5">
          <div className="text-xs font-bold text-slate-400">
            紐付け済み: {mappingDraft.filter((mapping) => mapping.fieldKey).length.toLocaleString()} / {mappingDraft.length.toLocaleString()}列
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-500">
              キャンセル
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!!missingRequiredFields.length}
              className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              この紐付けでプレビュー
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const MasterCsvImportPanel = ({
  type,
  suppliers = [],
  brands = [],
  productCategories = [],
  productCategoryGroups = [],
  onSaveSupplier,
  onSaveBrand,
  onSaveCategory,
  onSaveCategoryGroup,
  onSaved
}) => {
  const inputRef = useRef(null);
  const label = IMPORT_LABELS[type] || IMPORT_LABELS.suppliers;
  const [preview, setPreview] = useState(null);
  const [brandDuplicateMode, setBrandDuplicateMode] = useState('skip');
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
    if (inputRef.current) inputRef.current.value = '';
  };

  const buildPreviewFromMapping = (nextMappingDraft = mappingDraft) => {
    const nextPreview = buildMasterCsvPreview({
      type,
      rows: csvRows,
      mappingDraft: nextMappingDraft,
      suppliers,
      brands,
      productCategories,
      productCategoryGroups,
      duplicateHandlingMode: brandDuplicateMode
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
      const parsedRows = parseMasterCsvText(csvText);
      const parsedHeaders = parsedRows[0] || [];
      const nextMappingDraft = buildMasterCsvMappingDraft(type, parsedHeaders);

      if (!parsedHeaders.length) {
        setError('CSVヘッダーを読み取れませんでした。');
        return;
      }

      setCsvRows(parsedRows);
      setMappingDraft(nextMappingDraft);
      setShowMappingModal(true);
    } catch (nextError) {
      console.error('[MasterCsvImportPanel] CSV parse failed', nextError);
      setError('CSVの読み込みに失敗しました。ファイル形式を確認してください。');
    }
  };

  const handleBrandDuplicateModeChange = (nextMode) => {
    setBrandDuplicateMode(nextMode);

    if (type !== 'brands' || !Array.isArray(csvRows) || csvRows.length === 0) return;

    const nextPreview = buildMasterCsvPreview({
      type,
      rows: csvRows,
      mappingDraft,
      suppliers,
      brands,
      productCategories,
      productCategoryGroups,
      duplicateHandlingMode: nextMode
    });

    setPreview(nextPreview);
    setError(nextPreview.errors[0] || '');
  };

  const executeImport = async () => {
    if (!preview?.importableItems?.length || saving) return;

    setSaving(true);
    setError('');

    try {
      let savedCount = 0;

      if (type === 'suppliers') {
        if (typeof onSaveSupplier !== 'function') throw new Error('仕入先保存処理が未接続です。');
        for (const item of preview.importableItems) {
          const payload = normalizeSupplierPayload(item);
          await onSaveSupplier(payload);
          savedCount += 1;
        }
      }

      if (type === 'brands') {
        if (typeof onSaveBrand !== 'function') throw new Error('ブランド保存処理が未接続です。');
        for (const item of preview.importableItems) {
          const payload = normalizeBrandPayload(item);
          await onSaveBrand(payload);
          savedCount += 1;
        }
      }

      if (type === 'categories') {
        if (typeof onSaveCategory !== 'function' || typeof onSaveCategoryGroup !== 'function') {
          throw new Error('カテゴリー保存処理が未接続です。');
        }

        const groupIdByExternalId = new Map();
        const groupIdByName = new Map();

        for (const group of productCategoryGroups || []) {
          if (group?.id) {
            const externalId = String(
              group.smaregiCategoryGroupId ||
              group.categoryGroupExternalId ||
              group.externalCategoryGroupId ||
              group.groupExternalId ||
              ''
            ).trim();
            const name = String(group.name || '').trim().toLowerCase().replace(/\s+/g, '');

            if (externalId) groupIdByExternalId.set(externalId, group.id);
            if (name) groupIdByName.set(name, group.id);
          }
        }

        for (const item of preview.importableItems) {
          const groupExternalId = String(item.smaregiCategoryGroupId || '').trim();
          const groupNameKey = String(item.categoryGroupName || '').trim().toLowerCase().replace(/\s+/g, '');

          if (item.matchedCategoryGroupId) {
            if (groupExternalId) groupIdByExternalId.set(groupExternalId, item.matchedCategoryGroupId);
            if (groupNameKey) groupIdByName.set(groupNameKey, item.matchedCategoryGroupId);
          }

          if (item.categoryGroupPayload) {
            const createdGroupId = await onSaveCategoryGroup(normalizeGroupPayload(item.categoryGroupPayload));
            savedCount += 1;

            if (createdGroupId) {
              if (groupExternalId) groupIdByExternalId.set(groupExternalId, createdGroupId);
              if (groupNameKey) groupIdByName.set(groupNameKey, createdGroupId);
            }
          }
        }

        for (const item of preview.importableItems) {
          if (item.categoryPayload) {
            const groupExternalId = String(item.smaregiCategoryGroupId || '').trim();
            const groupNameKey = String(item.categoryGroupName || '').trim().toLowerCase().replace(/\s+/g, '');
            const resolvedGroupId = (
              item.categoryPayload.groupId ||
              groupIdByExternalId.get(groupExternalId) ||
              groupIdByName.get(groupNameKey) ||
              ''
            );

            await onSaveCategory(normalizeCategoryPayload({
              ...item.categoryPayload,
              groupId: resolvedGroupId,
              groupName: item.categoryPayload.groupName || item.categoryGroupName || '',
              categoryGroupName: item.categoryGroupName || item.categoryPayload.categoryGroupName || '',
              smaregiCategoryGroupId: item.smaregiCategoryGroupId || item.categoryPayload.smaregiCategoryGroupId || ''
            }));
            savedCount += 1;
          }
        }
      }

      reset();
      onSaved?.();
      window.alert(`${savedCount.toLocaleString()}件を取り込みました。`);
    } catch (nextError) {
      console.error('[MasterCsvImportPanel] CSV save failed', nextError);
      setError(nextError?.message || 'CSV取込の保存に失敗しました。一部だけ保存された可能性があります。');
    } finally {
      setSaving(false);
    }
  };

  const duplicateModeEnabled = ['suppliers', 'brands', 'categories'].includes(type);
  const updateCount = preview?.importableItems?.filter((item) => item.importAction === 'update').length || 0;
  const createCount = preview?.importableItems?.filter((item) => item.importAction !== 'update').length || 0;

  return (
    <div className="rounded-3xl border-2 border-blue-100 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">{label.title}</div>
          <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
            CSV選択後、列の紐付けを確認してからプレビューします。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={saving}
            className="rounded-2xl border-2 border-blue-100 bg-white px-4 py-2 text-xs font-black text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
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
            <button type="button" onClick={reset} disabled={saving} className="rounded-2xl bg-white px-4 py-2 text-xs font-black text-slate-500 shadow-sm disabled:opacity-60">
              取消
            </button>
          )}
          <button
            type="button"
            onClick={executeImport}
            disabled={saving || !preview?.importableItems?.length}
            className="rounded-2xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-500/20 disabled:opacity-50"
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
        </div>
      )}

      {['suppliers', 'brands', 'categories'].includes(type) && (
        <div className="mt-3 rounded-2xl border border-blue-100 bg-white px-4 py-3">
          <div className="text-xs font-black text-slate-700">取込モード</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleBrandDuplicateModeChange('skip')}
              disabled={saving}
              className={[
                'rounded-2xl px-4 py-2 text-xs font-black transition',
                brandDuplicateMode === 'skip'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              ].join(' ')}
            >
              新規のみ追加
            </button>
            <button
              type="button"
              onClick={() => handleBrandDuplicateModeChange('update')}
              disabled={saving}
              className={[
                'rounded-2xl px-4 py-2 text-xs font-black transition',
                brandDuplicateMode === 'update'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              ].join(' ')}
            >
              新規追加・既存更新
            </button>
          </div>
          <p className="mt-2 text-xs font-bold leading-relaxed text-slate-400">
            新規のみ追加は既存データを変更しません。新規追加・既存更新は新規を追加し、既存はCSV内容でmerge更新します。
          </p>
        </div>
      )}

      {(fileName || preview) && (
        <p className="mt-3 text-xs font-bold text-slate-500">
          {fileName || 'CSVファイル'} / データ行 {Number(preview?.totalRows || Math.max(csvRows.length - 1, 0)).toLocaleString()}件 / 取込対象 {Number(preview?.importableItems?.length || 0).toLocaleString()}件{duplicateModeEnabled ? ` / 新規 ${createCount.toLocaleString()}件 / 更新 ${updateCount.toLocaleString()}件` : ''} / スキップ {Number(preview?.skippedItems?.length || 0).toLocaleString()}件
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
          {preview.errors.slice(0, 5).map((message) => <div key={message}>・{message}</div>)}
          {preview.errors.length > 5 && <div>ほか {preview.errors.length - 5}件</div>}
        </div>
      )}

      {!!preview?.warnings?.length && (
        <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          <div className="mb-1 font-black">警告</div>
          {preview.warnings.slice(0, 8).map((message) => <div key={message}>・{message}</div>)}
          {preview.warnings.length > 8 && <div>ほか {preview.warnings.length - 8}件</div>}
        </div>
      )}

      {!!preview?.importableItems?.length && (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-blue-100 bg-white">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-black text-slate-400">
              <tr>
                <th className="px-3 py-2">行</th>
                {label.previewColumns.map(([columnLabel]) => (
                  <th key={columnLabel} className="px-3 py-2">{columnLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
              {preview.importableItems.slice(0, 5).map((item) => (
                <tr key={`${item.__rowNumber}-${JSON.stringify(item).slice(0, 80)}`}>
                  <td className="px-3 py-2">{item.__rowNumber}</td>
                  {label.previewColumns.map(([columnLabel, key]) => (
                    <td key={columnLabel} className="px-3 py-2">{String(item[key] ?? item.categoryPayload?.[key] ?? item.categoryGroupPayload?.[key] ?? '-')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {preview.importableItems.length > 5 && (
            <div className="border-t border-slate-100 px-3 py-2 text-xs font-bold text-slate-400">
              先頭5件のみ表示しています。
            </div>
          )}
        </div>
      )}

      {showMappingModal && (
        <MasterCsvMappingModal
          type={type}
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

export default MasterCsvImportPanel;
