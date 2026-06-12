import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { ref as storageRef, uploadBytes } from 'firebase/storage';

import {
  PRODUCT_CSV_FIELD_OPTIONS,
  buildProductCsvMappingDraft,
  buildProductCsvPreview,
  parseProductCsvText
} from '../utils/productCsvImport';
import { auth, db, storage } from '../../../shared/api/firebase/client';

const PRODUCT_CSV_IMPORT_PROCESSING_MODE = 'function';
const PRODUCT_CSV_IMPORT_EXECUTE_PRODUCT_WRITES = true;

const getSafeArrayLength = (value) => (Array.isArray(value) ? value.length : 0);


const getImportJobProductProgressText = (job = {}) => {
  const summary = job.functionSaveSummary || {};
  const saved = summary.savedProductCount ?? job.importedProductCount ?? job.processedProducts;
  const total = summary.productCandidateCount ?? job.totalProductCount ?? job.totalProducts ?? job.csvImportableRows;

  if (saved === undefined && total === undefined) return '-';
  if (saved === undefined) return `- / ${total ?? '-'}`;
  if (total === undefined) return `${saved} / -`;
  return `${Number(saved || 0).toLocaleString()} / ${Number(total || 0).toLocaleString()}`;
};

const getImportJobGroupProgressText = (job = {}) => {
  const summary = job.functionSaveSummary || {};
  const saved = summary.savedGroupCount ?? job.importedGroupCount ?? job.processedProductGroups;
  const total = summary.groupCandidateCount ?? job.totalGroupCount ?? job.totalProductGroups ?? job.functionWritePlan?.groupCandidateCount;

  if (saved === undefined && total === undefined) return '-';
  if (saved === undefined) return `- / ${total ?? '-'}`;
  if (total === undefined) return `${saved} / -`;
  return `${Number(saved || 0).toLocaleString()} / ${Number(total || 0).toLocaleString()}`;
};


const getPreviewImportableProductCount = (preview = {}) => getSafeArrayLength(preview.importableProducts);

const getPreviewGroupCount = (preview = {}) => {
  if (Array.isArray(preview.productGroupPayloads)) return preview.productGroupPayloads.length;
  if (Array.isArray(preview.importableProductGroups)) return preview.importableProductGroups.length;
  if (Array.isArray(preview.productGroups)) return preview.productGroups.length;
  if (preview.productGroupPayloadsById && typeof preview.productGroupPayloadsById === 'object') {
    return Object.keys(preview.productGroupPayloadsById).length;
  }
  if (preview.productGroupsById && typeof preview.productGroupsById === 'object') {
    return Object.keys(preview.productGroupsById).length;
  }
  if (preview.groupCount !== undefined) return Number(preview.groupCount || 0);
  return 0;
};

const getImportResultProductCount = (result = {}) => {
  if (result.queuedForFunction) return Number(result.totalProductCount || 0);
  if (Array.isArray(result.importedProducts)) return getSafeArrayLength(result.importedProducts);
  if (result.importedProductCount !== undefined) return Number(result.importedProductCount || 0);
  return 0;
};

const getImportResultGroupCount = (result = {}) => {
  if (result.queuedForFunction) return Number(result.totalGroupCount || 0);
  if (Array.isArray(result.importedGroups)) return getSafeArrayLength(result.importedGroups);
  if (result.importedGroupCount !== undefined) return Number(result.importedGroupCount || 0);
  return 0;
};

const getImportResultMessage = (result = {}) => {
  const productCount = getImportResultProductCount(result);
  const groupCount = getImportResultGroupCount(result);

  if (result.queuedForFunction) {
    return `CSVをバックグラウンド取込に登録しました（商品 ${productCount}件 / グループ ${groupCount}件）。履歴で完了状態を確認してください。`;
  }

  return `商品CSV取込を完了しました（商品 ${productCount}件 / グループ ${groupCount}件）。`;
};

const normalizeNumberOrNullForImport = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};




const sanitizeStorageFileName = (fileName = 'products.csv') => (
  String(fileName || 'products.csv')
    .trim()
    .replace(/[^\w.\-ぁ-んァ-ヶ一-龠々ー]/g, '_')
    .slice(0, 120)
    || 'products.csv'
);

const formatImportJobDate = (value) => {
  if (!value) return '-';

  const date = typeof value?.toDate === 'function'
    ? value.toDate()
    : new Date(value);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const getImportJobStatusLabel = (job = {}) => {
  if (job.status === 'completed') return '完了';
  if (job.status === 'failed') return '失敗';
  if (job.status === 'running') return '実行中';
  return job.status || '-';
};

const PRODUCT_CSV_IMPORT_BATCH_SIZE = 400;

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const omitInternalImportFields = (item = {}) => {
  const { __rowNumber, ...payload } = item;
  return payload;
};

const buildImportProductPayload = ({ product, jobId }) => {
  const payload = normalizeImportedProductPayload(omitInternalImportFields(product));
  const { id, ...data } = payload;

  return {
    id,
    data: {
      ...data,
      importJobId: jobId,
      updatedAt: serverTimestamp()
    }
  };
};

const buildImportGroupPayload = ({ group, jobId }) => {
  const payload = omitInternalImportFields(group);
  const id = String(payload.id || payload.productGroupId || '').trim();

  return {
    id,
    data: {
      ...payload,
      id,
      importJobId: jobId,
      updatedAt: serverTimestamp()
    }
  };
};

const runProductCsvImportJob = async ({
  storeId,
  fileName,
  file,
  preview,
  onProgress
}) => {
  const normalizedStoreId = String(storeId || '').trim();
  if (!normalizedStoreId) throw new Error('storeId が見つかりません。');

  const products = Array.isArray(preview?.importableProducts) ? preview.importableProducts : [];
  const productGroups = Array.isArray(preview?.importableProductGroups) ? preview.importableProductGroups : [];

  if (!products.length) {
    throw new Error('取込対象の商品がありません。');
  }

  const storeRef = doc(db, 'stores', normalizedStoreId);
  const importJobRef = doc(collection(storeRef, 'importJobs'));
  const jobId = importJobRef.id;
  const currentUser = auth.currentUser;

  if (!currentUser?.uid) {
    throw new Error('CSVアップロードにはログイン状態が必要です。再ログインしてからお試しください。');
  }

  const storagePath = `stores/${normalizedStoreId}/importJobs/${jobId}/${Date.now()}-${sanitizeStorageFileName(fileName)}`;
  const startedAt = serverTimestamp();

  const initialBatch = writeBatch(db);
  initialBatch.set(importJobRef, {
    id: jobId,
    type: 'productCsvImport',
    processingMode: PRODUCT_CSV_IMPORT_PROCESSING_MODE,
    executeProductWrites: PRODUCT_CSV_IMPORT_EXECUTE_PRODUCT_WRITES,
    createdByUid: currentUser.uid,
    fileName: fileName || '',
    storagePath,
    storageUploaded: false,
    status: 'running',
    phase: 'initializing',
    totalProducts: products.length,
    totalProductGroups: productGroups.length,
    processedProducts: 0,
    processedProductGroups: 0,
    totalRows: Number(preview?.totalRows || products.length),
    skippedProducts: Number(preview?.skippedProducts?.length || 0),
    warningsCount: Number(preview?.warnings?.length || 0),
    errorsCount: Number(preview?.errors?.length || 0),
    createdAt: startedAt,
    updatedAt: startedAt
  });
  await initialBatch.commit();

  if (file) {
    const uploadingBatch = writeBatch(db);
    uploadingBatch.set(importJobRef, {
      phase: 'uploadingCsv',
      updatedAt: serverTimestamp()
    }, { merge: true });
    await uploadingBatch.commit();

    await uploadBytes(
      storageRef(storage, storagePath),
      file,
      {
        contentType: file.type || 'text/csv',
        customMetadata: {
          storeId: normalizedStoreId,
          jobId,
          type: 'productCsvImport',
          createdByUid: currentUser.uid
        }
      }
    );

    const uploadedBatch = writeBatch(db);
    uploadedBatch.set(importJobRef, {
      storageUploaded: true,
      storageUploadedAt: serverTimestamp(),
      phase: 'initializing',
      updatedAt: serverTimestamp()
    }, { merge: true });
    await uploadedBatch.commit();

    if (PRODUCT_CSV_IMPORT_PROCESSING_MODE === 'function') {
      const queuedBatch = writeBatch(db);
      queuedBatch.set(importJobRef, {
        status: 'queued',
        phase: 'queued',
        processingMode: PRODUCT_CSV_IMPORT_PROCESSING_MODE,
        executeProductWrites: PRODUCT_CSV_IMPORT_EXECUTE_PRODUCT_WRITES,
        functionReadOnly: false,
        functionWritePlanOnly: false,
        queuedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      await queuedBatch.commit();

      onProgress?.({
        status: 'queued',
        phase: 'queued',
        savedProducts: 0,
        totalProducts: getPreviewImportableProductCount(preview),
        savedGroups: 0,
        totalGroups: getPreviewGroupCount(preview)
      });

      return {
        jobId,
        storagePath,
        processingMode: PRODUCT_CSV_IMPORT_PROCESSING_MODE,
        queuedForFunction: true,
        importedProductCount: 0,
        totalProductCount: getPreviewImportableProductCount(preview),
        importedGroupCount: 0,
        totalGroupCount: getPreviewGroupCount(preview)
      };
    }

  }

  const updateJob = async (patch) => {
    const batch = writeBatch(db);
    batch.set(importJobRef, {
      ...patch,
      updatedAt: serverTimestamp()
    }, { merge: true });
    await batch.commit();
  };

  let processedProductGroups = 0;
  let processedProducts = 0;

  try {
    if (productGroups.length) {
      await updateJob({ phase: 'writingProductGroups' });

      for (const groupChunk of chunkArray(productGroups, PRODUCT_CSV_IMPORT_BATCH_SIZE)) {
        const batch = writeBatch(db);

        groupChunk.forEach((group) => {
          const { id, data } = buildImportGroupPayload({ group, jobId });
          if (!id) return;

          batch.set(doc(collection(storeRef, 'productGroups'), id), data, { merge: true });
        });

        processedProductGroups += groupChunk.length;

        batch.set(importJobRef, {
          phase: 'writingProductGroups',
          processedProductGroups,
          updatedAt: serverTimestamp()
        }, { merge: true });

        await batch.commit();
        onProgress?.({ jobId, phase: 'writingProductGroups', processedProductGroups, processedProducts });
      }
    }

    await updateJob({ phase: 'writingProducts' });

    for (const productChunk of chunkArray(products, PRODUCT_CSV_IMPORT_BATCH_SIZE)) {
      const batch = writeBatch(db);

      productChunk.forEach((product) => {
        const { id, data } = buildImportProductPayload({ product, jobId });
        const productRef = id
          ? doc(collection(storeRef, 'products'), id)
          : doc(collection(storeRef, 'products'));

        batch.set(productRef, data, { merge: true });
      });

      processedProducts += productChunk.length;

      batch.set(importJobRef, {
        phase: 'writingProducts',
        processedProducts,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();
      onProgress?.({ jobId, phase: 'writingProducts', processedProductGroups, processedProducts });
    }

    await updateJob({
      status: 'completed',
      phase: 'completed',
      processedProducts,
      processedProductGroups,
      completedAt: serverTimestamp()
    });

    return {
      jobId,
      storagePath,
      processedProducts,
      processedProductGroups
    };
  } catch (error) {
    await updateJob({
      status: 'failed',
      phase: 'failed',
      errorMessage: error?.message || String(error),
      processedProducts,
      processedProductGroups,
      failedAt: serverTimestamp()
    });

    throw error;
  }
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
        <div data-ui-id="商品CSV_IMPORT_FIXED_MODE_NOTICE" className="mx-6 mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black text-blue-700">
            <span>取込モード</span>
            <span className="rounded-full bg-white px-2 py-1 text-blue-700 shadow-sm">新規追加・既存更新</span>
            <span className="rounded-full bg-white px-2 py-1 text-blue-700 shadow-sm">判定キー：バーコード優先</span>
          </div>
          <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">
            バーコード一致は既存更新し、未登録の商品は新規追加します。
          </p>
        </div>
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
  storeId,
  products = [],
  productCategories = [],
  productCategoryGroups = [],
  productSubCategories = [],
  defaultTaxRate = 10,
  productSalesAreas = [],
  brands = [],
  suppliers = [],
  onSaveProduct,
  onSaveProductGroup,
  onSaved
}) => {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importJobs, setImportJobs] = useState([]);
  const [importJobsError, setImportJobsError] = useState('');
  const [csvRows, setCsvRows] = useState([]);
  const [mappingDraft, setMappingDraft] = useState([]);
  const [showMappingModal, setShowMappingModal] = useState(false);

  const headers = csvRows[0] || [];

  useEffect(() => {
    const normalizedStoreId = String(storeId || '').trim();

    if (!normalizedStoreId) {
      setImportJobs([]);
      setImportJobsError('');
      return undefined;
    }

    let unsubscribeJobs = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeJobs) {
        unsubscribeJobs();
        unsubscribeJobs = null;
      }

      if (!currentUser) {
        setImportJobs([]);
        setImportJobsError('');
        return;
      }

      const jobsQuery = query(
        collection(db, 'stores', normalizedStoreId, 'importJobs'),
        orderBy('createdAt', 'desc'),
        limit(8)
      );

      unsubscribeJobs = onSnapshot(
        jobsQuery,
        (snapshot) => {
          setImportJobs(snapshot.docs
            .map((documentSnapshot) => ({ id: documentSnapshot.id, ...documentSnapshot.data() }))
            .filter((job) => job.type === 'productCsvImport'));
          setImportJobsError('');
        },
        (nextError) => {
          console.error('[ProductCsvImportPanel] importJobs subscribe failed', nextError);
          setImportJobs([]);
          setImportJobsError('取込履歴の読み込みに失敗しました。');
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeJobs) unsubscribeJobs();
    };
  }, [storeId]);


  const reset = () => {
    setPreview(null);
    setFileName('');
    setSelectedFile(null);
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
      productSubCategories,
      defaultTaxRate,
      productSalesAreas,
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
    setSelectedFile(file || null);
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

    if (!storeId && typeof onSaveProduct !== 'function') {
      setError('商品保存処理が未接続です。');
      return;
    }

    if (storeId && !selectedFile) {
      setError('CSVファイル本体が見つかりません。もう一度CSVを選択してください。');
      return;
    }

    setSaving(true);
    setError('');
    setImportProgress(null);

    try {
      if (storeId) {
        const result = await runProductCsvImportJob({
          storeId,
          fileName,
          file: selectedFile,
          preview,
          onProgress: (progress) => setImportProgress(progress)
        });

        setImportProgress({
          jobId: result.jobId,
          phase: 'completed',
          processedProducts: result.processedProducts,
          processedProductGroups: result.processedProductGroups,
          storagePath: result.storagePath
        });

        reset();
        onSaved?.();
        window.alert(getImportResultMessage(result));
        return;
      }

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

      const savedCount = getPreviewImportableProductCount(preview);
      const savedGroupCount = productGroups.length;
      reset();
      onSaved?.();
      window.alert(`${savedGroupCount.toLocaleString()}件の商品グループ、${savedCount.toLocaleString()}件の商品を取り込みました。`);
    } catch (nextError) {
      console.error('[ProductCsvImportPanel] CSV save failed', nextError);
      setError(nextError?.message || 'CSV取込の保存に失敗しました。一部だけ保存された可能性があります。商品一覧を確認してください。');
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
              CSV選択後、列の紐付けを確認してからプレビューします。バーコード一致は既存更新し、未登録の商品は新規追加します。
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

        {importProgress?.jobId && (
          <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-700">
            importJob: {importProgress.jobId} / {importProgress.phase}
            {typeof importProgress.processedProductGroups === 'number' ? ` / グループ ${importProgress.processedProductGroups.toLocaleString()}件` : ''}
            {typeof importProgress.processedProducts === 'number' ? ` / 商品 ${importProgress.processedProducts.toLocaleString()}件` : ''}
          </div>
        )}

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
                  <th className="px-3 py-2 text-right">売価（税抜）</th>
                  <th className="px-3 py-2 text-right">税率</th>
                  <th className="px-3 py-2 text-right">税込参考</th>
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
                    <td className="px-3 py-2 text-right">{Number(product.priceTaxExcluded || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(product.taxRate ?? 0).toLocaleString()}%</td>
                    <td className="px-3 py-2 text-right">{Number(product.priceTaxIncluded || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{Number(product.inventoryQuantity || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {getPreviewImportableProductCount(preview) > 5 && (
              <div className="border-t border-slate-100 px-3 py-2 text-xs font-bold text-slate-400">
                先頭5件のみ表示しています。
              </div>
            )}
          </div>
        )}
        <div className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-black text-slate-900">直近のCSV取込履歴</div>
              <div className="mt-1 text-[11px] font-bold text-slate-400">
                importJobs に記録された商品CSV取込の履歴です。
              </div>
            </div>
            <div className="text-[11px] font-black text-slate-400">
              {importJobs.length.toLocaleString()}件
            </div>
          </div>

          {importJobsError && (
            <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
              {importJobsError}
            </div>
          )}

          {!importJobsError && importJobs.length === 0 && (
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-400">
              まだ商品CSV取込履歴はありません。
            </div>
          )}

          {!importJobsError && importJobs.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead className="bg-slate-50 font-black text-slate-400">
                  <tr>
                    <th className="px-3 py-2">日時</th>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2">phase</th>
                    <th className="px-3 py-2">Storage</th>
                    <th className="px-3 py-2">CSV</th>
                    <th className="px-3 py-2 text-right">商品</th>
                    <th className="px-3 py-2 text-right">グループ</th>
                    <th className="px-3 py-2">jobId</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold text-slate-600">
                  {importJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatImportJobDate(job.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{getImportJobStatusLabel(job)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{job.phase || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{job.storageUploaded ? '保存済み' : '-'}</td>
                      <td className="max-w-[220px] truncate px-3 py-2">{job.fileName || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {getImportJobProductProgressText(job)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {getImportJobGroupProgressText(job)}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 font-mono text-slate-400">{job.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
