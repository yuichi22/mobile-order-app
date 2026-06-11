const admin = require('../functions/node_modules/firebase-admin');
const fs = require('fs');
const path = require('path');

const projectId = 'mobile-order-dev-5f7fd';
const storeId = 'store_0dtao';
const csvPath = 'local_exports/product-master-brand-canonical-salesarea-fixed-20260610/product-master-final-brand-canonical-salesarea-fixed-ready.csv';
const expectedProductRows = 31985;
const expectedProductGroups = 19683;

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const nowStamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outDir = `local_exports/dev-import-job-product-csv-${nowStamp()}`;

const normalize = (value) => String(value ?? '').trim();

const normalizeProductSearchText = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
);

const addSearchTerm = (terms, value) => {
  const normalized = normalizeProductSearchText(value);
  if (!normalized) return;

  terms.add(normalized);

  normalized.split(/[\s　/／・,，、.。_\-ー]+/).forEach((part) => {
    const token = normalizeProductSearchText(part);
    if (token) terms.add(token);
  });

  const compact = normalized.replace(/[\s　/／・,，、.。_\-ー]+/g, '');
  if (compact) terms.add(compact);

  [normalized, compact].filter(Boolean).forEach((source) => {
    const maxPrefix = Math.min(source.length, 24);
    for (let length = 1; length <= maxPrefix; length += 1) {
      terms.add(source.slice(0, length));
    }

    if (source.length >= 2 && source.length <= 80) {
      for (let index = 0; index < source.length - 1; index += 1) {
        terms.add(source.slice(index, index + 2));
      }
    }

    if (source.length >= 3 && source.length <= 80) {
      for (let index = 0; index < source.length - 2; index += 1) {
        terms.add(source.slice(index, index + 3));
      }
    }
  });
};

const buildProductSearchKeywords = (product = {}) => {
  const terms = new Set();

  [
    product.name,
    product.sku,
    product.productCode,
    product.barcode,
    product.brandName,
    product.categoryGroupName,
    product.categoryName,
    product.subCategoryName,
    product.salesAreaName,
    product.productGroupName,
    product.groupCode
  ].forEach((value) => addSearchTerm(terms, value));

  return Array.from(terms).filter(Boolean).slice(0, 250);
};

const normalizeKey = (value) => normalize(value).toLowerCase().replace(/\s+/g, '');
const normalizeId = (value) => normalize(value);

const parseCsvLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
};

const parseCsv = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const headers = parseCsvLine(lines[0]).map((header) => normalize(header));

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = { __rowNumber: index + 2 };
    headers.forEach((header, i) => {
      row[header] = values[i] ?? '';
    });
    return row;
  });
};

const toNumber = (value, fallback = 0) => {
  const raw = normalize(value);
  if (!raw) return fallback;
  const normalized = raw.replace(/[¥￥,\s]/g, '').replace(/%$/, '');
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const toBoolean = (value, fallback = false) => {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'y', 'on', '表示', '有効', 'active', '公開', 'する', '対象'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', '非表示', '無効', 'inactive', '非公開', 'しない', '対象外'].includes(normalized)) return false;
  return fallback;
};

const collectionRef = (name) => db.collection('stores').doc(storeId).collection(name);
const importJobsRef = () => db.collection('stores').doc(storeId).collection('importJobs');

const getAll = async (name) => {
  const snapshot = await collectionRef(name).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

const makeNameMap = (items) => {
  const map = new Map();
  for (const item of items || []) {
    const key = normalizeKey(item.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
};

const firstByName = (map, name) => {
  const items = map.get(normalizeKey(name)) || [];
  return items[0] || null;
};

const getGroupId = (item) => normalizeId(item?.categoryGroupId || item?.groupId);
const getGroupName = (item) => normalize(item?.categoryGroupName || item?.groupName);
const getCategoryId = (item) => normalizeId(item?.categoryId);

const findCategory = (categoryName, groupName, group, categoryNameMap) => {
  const candidates = categoryNameMap.get(normalizeKey(categoryName)) || [];
  if (candidates.length <= 1) return candidates[0] || null;

  const groupId = normalizeId(group?.id);
  const groupKey = normalizeKey(group?.name || groupName);

  if (groupId) {
    const byId = candidates.find((category) => getGroupId(category) === groupId);
    if (byId) return byId;
  }

  if (groupKey) {
    const byName = candidates.find((category) => normalizeKey(getGroupName(category)) === groupKey);
    if (byName) return byName;
  }

  return candidates[0] || null;
};

const findSubCategory = (subCategoryName, categoryName, groupName, category, group, subCategoryNameMap) => {
  const candidates = subCategoryNameMap.get(normalizeKey(subCategoryName)) || [];
  if (candidates.length <= 1) return candidates[0] || null;

  const categoryId = normalizeId(category?.id);
  const categoryKey = normalizeKey(category?.name || categoryName);
  const groupId = normalizeId(group?.id);
  const groupKey = normalizeKey(group?.name || groupName);

  if (categoryId) {
    const byCategoryId = candidates.find((subCategory) => getCategoryId(subCategory) === categoryId);
    if (byCategoryId) return byCategoryId;
  }

  let scoped = candidates;

  if (categoryKey) {
    const byCategoryName = scoped.filter((subCategory) => normalizeKey(subCategory.categoryName) === categoryKey);
    if (byCategoryName.length === 1) return byCategoryName[0];
    if (byCategoryName.length > 1) scoped = byCategoryName;
  }

  if (groupId) {
    const byGroupId = scoped.find((subCategory) => getGroupId(subCategory) === groupId);
    if (byGroupId) return byGroupId;
  }

  if (groupKey) {
    const byGroupName = scoped.find((subCategory) => normalizeKey(getGroupName(subCategory)) === groupKey);
    if (byGroupName) return byGroupName;
  }

  return scoped[0] || candidates[0] || null;
};

const safeDocIdPart = (value) => (
  normalize(value)
    .replace(/[\/?#\[\]\s]+/g, '_')
    .replace(/[^\w\-ぁ-んァ-ヶ一-龠ー]/g, '_')
    .slice(0, 40)
    || 'group'
);

const hashCode = (value) => {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 12);
};

const fallbackProductGroupId = (row) => {
  const base = [
    normalize(row.brandName || row.brand || row.shopifyVendor),
    normalize(row.sku),
    normalize(row.productGroupName || row.name || row.productName),
    normalize(row.categoryGroupName || row.categoryGroup),
    normalize(row.categoryName || row.category)
  ].filter(Boolean).join('_');

  return `pg_new_${safeDocIdPart(base)}_${hashCode(base)}`;
};

const chunk = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const writeBatches = async ({
  operations,
  label,
  jobRef,
  progressBase,
  progressField,
  batchSize = 400
}) => {
  const chunks = chunk(operations, batchSize);
  let done = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const batch = db.batch();

    for (const op of chunks[i]) {
      batch.set(op.ref, op.data, { merge: true });
    }

    await batch.commit();
    done += chunks[i].length;

    await jobRef.set({
      status: 'running',
      phase: label,
      [progressField]: done,
      processedOperations: progressBase + done,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`${label}: ${done}/${operations.length}`);
  }
};

const compactProductForBackup = (product) => ({
  id: product.id,
  barcode: product.barcode || '',
  sku: product.sku || product.productCode || '',
  name: product.name || '',
  productGroupId: product.productGroupId || '',
  brandName: product.brandName || '',
  categoryGroupName: product.categoryGroupName || '',
  categoryName: product.categoryName || '',
  subCategoryName: product.subCategoryName || '',
  salesAreaName: product.salesAreaName || '',
  shopifyProductId: product.shopifyProductId || '',
  shopifyVariantId: product.shopifyVariantId || ''
});

const countBy = (items, getKey) => {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const main = async () => {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const jobRef = importJobsRef().doc();
  const jobId = jobRef.id;

  await jobRef.set({
    id: jobId,
    type: 'productCsvImport',
    source: 'devImportProductCsvJob',
    csvPath,
    projectId,
    storeId,
    status: 'running',
    phase: 'initializing',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  try {
    console.log(`importJob: ${jobId}`);
    console.log(`output dir: ${outDir}`);

    const rows = parseCsv(csvPath);
    const validRows = rows.filter((row) => normalize(row.barcode) && normalize(row.name || row.productName));

    await jobRef.set({
      totalRows: rows.length,
      validRows: validRows.length,
      expectedProductRows,
      expectedProductGroups,
      phase: 'loadingMasters',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    const [
      existingProducts,
      existingProductGroups,
      brands,
      categoryGroups,
      categories,
      subCategories,
      salesAreas,
      suppliers
    ] = await Promise.all([
      getAll('products'),
      getAll('productGroups'),
      getAll('brands'),
      getAll('productCategoryGroups'),
      getAll('productCategories'),
      getAll('productSubCategories'),
      getAll('productSalesAreas'),
      getAll('suppliers')
    ]);

    fs.writeFileSync(path.join(outDir, 'backup-products-before.compact.json'), JSON.stringify(existingProducts.map(compactProductForBackup), null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'backup-productGroups-before.compact.json'), JSON.stringify(existingProductGroups.map((group) => ({
      id: group.id,
      name: group.name || group.productGroupName || '',
      productGroupName: group.productGroupName || '',
      brandName: group.brandName || '',
      categoryGroupName: group.categoryGroupName || '',
      categoryName: group.categoryName || '',
      subCategoryName: group.subCategoryName || '',
      salesAreaName: group.salesAreaName || ''
    })), null, 2), 'utf8');

    const existingProductByBarcode = new Map(
      existingProducts
        .map((product) => [normalize(product.barcode), product])
        .filter(([barcode]) => Boolean(barcode))
    );

    const existingGroupById = new Map(
      existingProductGroups
        .map((group) => [normalize(group.id), group])
        .filter(([id]) => Boolean(id))
    );

    const brandNameMap = makeNameMap(brands);
    const groupNameMap = makeNameMap(categoryGroups);
    const categoryNameMap = makeNameMap(categories);
    const subCategoryNameMap = makeNameMap(subCategories);
    const salesAreaNameMap = makeNameMap(salesAreas);
    const supplierNameMap = makeNameMap(suppliers);

    const productOps = [];
    const productGroupMap = new Map();
    const seenBarcodes = new Set();
    const warnings = [];

    await jobRef.set({
      phase: 'buildingPayloads',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    for (const row of validRows) {
      const barcode = normalize(row.barcode);
      if (!barcode) continue;

      if (seenBarcodes.has(barcode)) {
        warnings.push({
          rowNumber: row.__rowNumber,
          type: 'duplicateCsvBarcode',
          barcode
        });
        continue;
      }

      seenBarcodes.add(barcode);

      const sku = normalize(row.sku || row.productCode || row.productCodeName);
      const name = normalize(row.name || row.productName);
      const brandName = normalize(row.brandName || row.brand || row.shopifyVendor);
      const supplierName = normalize(row.supplierName || row.supplier);
      const salesAreaName = normalize(row.salesAreaName || row.salesArea);
      const categoryGroupName = normalize(row.categoryGroupName || row.categoryGroup);
      const categoryName = normalize(row.categoryName || row.category);
      const subCategoryName = normalize(row.subCategoryName || row.subCategory);

      const matchedBrand = firstByName(brandNameMap, brandName);
      const matchedSupplier = firstByName(supplierNameMap, supplierName);
      const matchedGroup = firstByName(groupNameMap, categoryGroupName);
      const matchedCategory = findCategory(categoryName, categoryGroupName, matchedGroup, categoryNameMap);
      const matchedSubCategory = findSubCategory(subCategoryName, categoryName, categoryGroupName, matchedCategory, matchedGroup, subCategoryNameMap);
      const matchedSalesArea = firstByName(salesAreaNameMap, salesAreaName);

      if (brandName && !matchedBrand) warnings.push({ rowNumber: row.__rowNumber, type: 'missingBrand', brandName });
      if (categoryGroupName && !matchedGroup) warnings.push({ rowNumber: row.__rowNumber, type: 'missingCategoryGroup', categoryGroupName });
      if (categoryName && !matchedCategory) warnings.push({ rowNumber: row.__rowNumber, type: 'missingCategory', categoryGroupName, categoryName });
      if (subCategoryName && !matchedSubCategory) warnings.push({ rowNumber: row.__rowNumber, type: 'missingSubCategory', categoryGroupName, categoryName, subCategoryName });
      if (salesAreaName && !matchedSalesArea) warnings.push({ rowNumber: row.__rowNumber, type: 'missingSalesArea', salesAreaName });

      const productGroupId = normalize(row.productGroupId) || fallbackProductGroupId(row);
      const productGroupName = normalize(row.productGroupName) || name;
      const existingProduct = existingProductByBarcode.get(barcode);

      const productRef = existingProduct?.id
        ? collectionRef('products').doc(existingProduct.id)
        : collectionRef('products').doc();

      const productPayload = {
        id: productRef.id,
        sku,
        productCode: sku,
        name,
        barcode,
        brandId: matchedBrand?.id || '',
        brandName: matchedBrand?.name || brandName,
        supplierId: matchedSupplier?.id || matchedBrand?.supplierId || '',
        supplierName: matchedSupplier?.name || matchedBrand?.supplierName || supplierName,
        salesAreaId: matchedSalesArea?.id || '',
        salesAreaName: matchedSalesArea?.name || salesAreaName,
        categoryGroupId: matchedGroup?.id || getGroupId(matchedCategory) || '',
        categoryGroupName: matchedGroup?.name || getGroupName(matchedCategory) || categoryGroupName,
        categoryId: matchedCategory?.id || '',
        categoryName: matchedCategory?.name || categoryName,
        subCategoryId: matchedSubCategory?.id || '',
        subCategoryName: matchedSubCategory?.name || subCategoryName,
        size: normalize(row.size),
        colorName: normalize(row.colorName),
        priceTaxIncluded: toNumber(row.priceTaxIncluded, 0),
        costTaxExcluded: toNumber(row.costTaxExcluded, 0),
        taxRate: toNumber(row.taxRate, 10),
        inventoryQuantity: toNumber(row.inventoryQuantity, 0),
        reorderPoint: toNumber(row.reorderPoint, 0),
        reorderQuantity: toNumber(row.reorderQuantity, 0),
        orderLot: toNumber(row.orderLot, 0),
        reorderLot: toNumber(row.orderLot, 0),
        labelEnabled: toBoolean(row.labelEnabled, true),
        shopifyCreateEnabled: toBoolean(row.shopifyCreateEnabled, false),
        note: normalize(row.note),
        isActive: true,
        isArchived: false,
        shopifyProductId: normalize(row.shopifyProductId),
        shopifyVariantId: normalize(row.shopifyVariantId),
        shopifyInventoryItemId: normalize(row.shopifyInventoryItemId),
        productGroupId,
        productGroupRole: normalize(row.productGroupRole) || 'primary',
        productGroupName,
        groupCode: normalize(row.groupCode),
        importJobId: jobId,
        searchKeywords: buildProductSearchKeywords(productPayload),
      importSource: 'productCsvImportJob',
        updatedAt: FieldValue.serverTimestamp(),
        ...(existingProduct?.createdAt ? {} : { createdAt: FieldValue.serverTimestamp() })
      };

      productOps.push({
        ref: productRef,
        data: productPayload,
        mode: existingProduct?.id ? 'update' : 'create'
      });

      if (!productGroupMap.has(productGroupId)) {
        const existingGroup = existingGroupById.get(productGroupId);
        productGroupMap.set(productGroupId, {
          id: productGroupId,
          name: productGroupName,
          productGroupName,
          groupCode: normalize(row.groupCode),
          brandId: productPayload.brandId,
          brandName: productPayload.brandName,
          categoryId: productPayload.categoryId,
          categoryName: productPayload.categoryName,
          subCategoryId: productPayload.subCategoryId,
          subCategoryName: productPayload.subCategoryName,
          salesAreaId: productPayload.salesAreaId,
          salesAreaName: productPayload.salesAreaName,
          categoryGroupId: productPayload.categoryGroupId,
          categoryGroupName: productPayload.categoryGroupName,
          shopifyEnabled: Boolean(productPayload.shopifyCreateEnabled),
          shopifyProductId: productPayload.shopifyProductId,
          isActive: true,
          isArchived: false,
          importJobId: jobId,
          importSource: 'productCsvImportJob',
          updatedAt: FieldValue.serverTimestamp(),
          ...(existingGroup?.createdAt ? {} : { createdAt: FieldValue.serverTimestamp() })
        });
      } else {
        const group = productGroupMap.get(productGroupId);
        group.shopifyEnabled = group.shopifyEnabled || Boolean(productPayload.shopifyCreateEnabled);
        if (!group.shopifyProductId && productPayload.shopifyProductId) group.shopifyProductId = productPayload.shopifyProductId;
      }
    }

    const groupOps = [...productGroupMap.values()].map((group) => ({
      ref: collectionRef('productGroups').doc(group.id),
      data: group
    }));

    const plannedSummary = {
      jobId,
      projectId,
      storeId,
      csvPath,
      csvRows: rows.length,
      validRows: validRows.length,
      productOps: productOps.length,
      productCreates: productOps.filter((op) => op.mode === 'create').length,
      productUpdates: productOps.filter((op) => op.mode === 'update').length,
      productGroupOps: groupOps.length,
      existingProductsBefore: existingProducts.length,
      existingProductGroupsBefore: existingProductGroups.length,
      warningCount: warnings.length,
      warningTypes: countBy(warnings, (warning) => warning.type)
    };

    fs.writeFileSync(path.join(outDir, 'planned-summary.json'), JSON.stringify(plannedSummary, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'warnings.json'), JSON.stringify(warnings.slice(0, 10000), null, 2), 'utf8');

    console.log('PLANNED SUMMARY');
    console.log(JSON.stringify(plannedSummary, null, 2));

    if (productOps.length !== expectedProductRows) {
      throw new Error(`Unexpected productOps count: ${productOps.length}, expected ${expectedProductRows}`);
    }

    if (groupOps.length !== expectedProductGroups) {
      throw new Error(`Unexpected productGroupOps count: ${groupOps.length}, expected ${expectedProductGroups}`);
    }

    await jobRef.set({
      ...plannedSummary,
      status: 'running',
      phase: 'writingProductGroups',
      processedOperations: 0,
      processedProductGroups: 0,
      processedProducts: 0,
      warningCount: warnings.length,
      warningTypes: plannedSummary.warningTypes,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log('');
    console.log('Writing productGroups...');
    await writeBatches({
      operations: groupOps,
      label: 'writingProductGroups',
      jobRef,
      progressBase: 0,
      progressField: 'processedProductGroups'
    });

    console.log('');
    console.log('Writing products...');
    await writeBatches({
      operations: productOps,
      label: 'writingProducts',
      jobRef,
      progressBase: groupOps.length,
      progressField: 'processedProducts'
    });

    await jobRef.set({
      status: 'running',
      phase: 'validating',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    const [
      productsAfter,
      productGroupsAfter
    ] = await Promise.all([
      getAll('products'),
      getAll('productGroups')
    ]);

    const productBarcodeSetAfter = new Set(productsAfter.map((product) => normalize(product.barcode)).filter(Boolean));
    const csvBarcodeSet = new Set(validRows.map((row) => normalize(row.barcode)).filter(Boolean));
    const missingAfter = [...csvBarcodeSet].filter((barcode) => !productBarcodeSetAfter.has(barcode));

    const duplicateBarcodesAfter = countBy(
      productsAfter.filter((product) => normalize(product.barcode)),
      (product) => normalize(product.barcode)
    ).filter(([, count]) => count > 1);

    const missingCategoryId = productsAfter.filter((product) => !normalize(product.categoryId));
    const missingCategoryGroupId = productsAfter.filter((product) => !normalize(product.categoryGroupId));
    const missingSubCategoryIdWithName = productsAfter.filter((product) => normalize(product.subCategoryName) && !normalize(product.subCategoryId));
    const missingSalesAreaIdWithName = productsAfter.filter((product) => normalize(product.salesAreaName) && !normalize(product.salesAreaId));
    const missingBrandIdWithName = productsAfter.filter((product) => normalize(product.brandName) && !normalize(product.brandId));

    const finalSummary = {
      jobId,
      projectId,
      storeId,
      csvRows: rows.length,
      validRows: validRows.length,
      productsAfter: productsAfter.length,
      productGroupsAfter: productGroupsAfter.length,
      csvBarcodesMissingAfter: missingAfter.length,
      duplicateBarcodesAfter: duplicateBarcodesAfter.length,
      classificationIssuesAfter: {
        missingCategoryId: missingCategoryId.length,
        missingCategoryGroupId: missingCategoryGroupId.length,
        missingSubCategoryIdWithName: missingSubCategoryIdWithName.length,
        missingSalesAreaIdWithName: missingSalesAreaIdWithName.length,
        missingBrandIdWithName: missingBrandIdWithName.length
      },
      topSalesAreasAfter: countBy(productsAfter, (product) => normalize(product.salesAreaName) || '(empty)').slice(0, 20),
      topCategoryGroupsAfter: countBy(productsAfter, (product) => normalize(product.categoryGroupName) || '(empty)').slice(0, 20),
      topBrandsAfter: countBy(productsAfter, (product) => normalize(product.brandName) || '(empty)').slice(0, 20),
      examples: {
        csvBarcodesMissingAfter: missingAfter.slice(0, 20),
        duplicateBarcodesAfter: duplicateBarcodesAfter.slice(0, 20),
        missingSubCategoryIdWithName: missingSubCategoryIdWithName.slice(0, 20).map((product) => ({
          barcode: product.barcode || '',
          name: product.name || '',
          categoryGroupName: product.categoryGroupName || '',
          categoryName: product.categoryName || '',
          subCategoryName: product.subCategoryName || ''
        })),
        missingSalesAreaIdWithName: missingSalesAreaIdWithName.slice(0, 20).map((product) => ({
          barcode: product.barcode || '',
          name: product.name || '',
          salesAreaName: product.salesAreaName || ''
        })),
        missingBrandIdWithName: missingBrandIdWithName.slice(0, 20).map((product) => ({
          barcode: product.barcode || '',
          name: product.name || '',
          brandName: product.brandName || ''
        }))
      }
    };

    fs.writeFileSync(path.join(outDir, 'final-summary.json'), JSON.stringify(finalSummary, null, 2), 'utf8');

    await jobRef.set({
      status: 'completed',
      phase: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      finalSummary
    }, { merge: true });

    console.log('');
    console.log('FINAL SUMMARY');
    console.log(JSON.stringify(finalSummary, null, 2));
    console.log('');
    console.log(`output dir: ${outDir}`);
  } catch (error) {
    await jobRef.set({
      status: 'failed',
      phase: 'failed',
      errorMessage: error?.message || String(error),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    throw error;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
