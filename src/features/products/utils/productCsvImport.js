export const PRODUCT_CSV_FIELD_OPTIONS = [
  { id: '', label: '取り込まない', required: false },
  { id: 'sku', label: 'SKU / 品番（補助）', required: false },
  { id: 'name', label: '商品名', required: true },
  { id: 'barcode', label: 'バーコード', required: false },
  { id: 'productGroupId', label: '商品グループID', required: false },
  { id: 'productGroupRole', label: '商品グループ役割', required: false },
  { id: 'productGroupName', label: '商品グループ名', required: false },
  { id: 'groupCode', label: 'グループコード', required: false },
  { id: 'categoryGroupId', label: 'カテゴリーグループID', required: false },
  { id: 'categoryGroup', label: 'カテゴリーグループ名', required: false },
  { id: 'categoryId', label: 'カテゴリーID', required: false },
  { id: 'category', label: 'カテゴリー名', required: false },
  { id: 'subCategoryId', label: 'サブカテゴリーID', required: false },
  { id: 'subCategory', label: 'サブカテゴリー名', required: false },
  { id: 'salesAreaId', label: '売場ID', required: false },
  { id: 'salesAreaName', label: '売場名', required: false },
  { id: 'brand', label: 'ブランド名', required: false },
  { id: 'supplier', label: '仕入先名', required: false },
  { id: 'size', label: 'サイズ', required: false },
  { id: 'colorName', label: '色 / カラー', required: false },
  { id: 'priceTaxIncluded', label: '売価（税込）', required: false },
  { id: 'costTaxExcluded', label: '原価（税抜）', required: false },
  { id: 'taxRate', label: '税率', required: false },
  { id: 'inventoryQuantity', label: '在庫数', required: false },
  { id: 'reorderPoint', label: '発注点', required: false },
  { id: 'reorderQuantity', label: '発注数', required: false },
  { id: 'orderLot', label: 'LOT', required: false },
  { id: 'labelEnabled', label: '表示', required: false },
  { id: 'shopifyCreateEnabled', label: 'Shopify連携', required: false },
  { id: 'note', label: 'メモ', required: false },
  { id: 'shopifyProductId', label: 'Shopify Product ID', required: false },
  { id: 'shopifyVariantId', label: 'Shopify Variant ID', required: false },
  { id: 'shopifyInventoryItemId', label: 'Shopify Inventory Item ID', required: false }
];

const PRODUCT_CSV_HEADER_ALIASES = {
  sku: ['sku', 'Variant SKU'],
  productCode: ['productCode', 'product_code', '品番', '商品コード'],
  name: ['name', 'productName', '商品名', 'Title', 'Variant Title'],
  barcode: ['barcode', 'バーコード', 'jan', 'JAN', 'Variant Barcode'],
  productGroupId: ['productGroupId', '商品グループID', 'groupId', 'group_id'],
  productGroupRole: ['productGroupRole', '商品グループ役割', 'groupRole', 'role'],
  productGroupName: ['productGroupName', 'productGroupTitle', '商品グループ名', 'groupName', 'Product Group Name'],
  groupCode: ['groupCode', 'グループコード', 'group_code'],
  categoryGroupId: ['categoryGroupId', 'カテゴリーグループID', 'category_group_id'],
  categoryId: ['categoryId', 'カテゴリーID', 'category_id'],
  category: ['category', 'categoryName', 'カテゴリー', 'カテゴリー名', 'カテゴリ', '部門', '部門名', 'Type'],
  subCategoryId: ['subCategoryId', 'サブカテゴリーID', 'sub_category_id'],
  subCategory: ['subCategory', 'subCategoryName', 'サブカテゴリー', 'サブカテゴリー名', '小カテゴリー', '小分類', 'Shopify Sub Category'],
  salesAreaId: ['salesAreaId', '売場ID', '販売エリアID', 'sales_area_id'],
  salesAreaName: ['salesAreaName', 'salesArea', '売場', '売場名', '販売エリア', '売場分類'],
  categoryGroup: ['categoryGroup', 'categoryGroupName', 'category_group', 'カテゴリーグループ', 'カテゴリーグループ名', '部門グループ', '部門グループ名', 'Product Category'],
  brand: ['brand', 'brandName', 'ブランド', 'ブランド名', 'Vendor'],
  supplier: ['supplier', 'supplierName', '仕入先', '仕入先名'],
  size: ['size', 'サイズ', 'Option1 Value', 'Option2 Value'],
  colorName: ['colorName', 'color', '色', 'カラー', 'Option2 Value', 'Option3 Value'],
  priceTaxIncluded: ['priceTaxIncluded', 'price', '売価', '販売価格', 'Variant Price'],
  costTaxExcluded: ['costTaxExcluded', 'cost', '原価', 'Variant Cost'],
  taxRate: ['taxRate', '税率'],
  inventoryQuantity: ['inventoryQuantity', '在庫数', '在庫', 'quantity', 'Variant Inventory Qty'],
  reorderPoint: ['reorderPoint', '発注点'],
  reorderQuantity: ['reorderQuantity', '発注数'],
  orderLot: ['orderLot', 'reorderLot', 'lot', 'LOT', 'ロット'],
  labelEnabled: ['labelEnabled', '表示', 'ラベル表示'],
  shopifyCreateEnabled: ['shopifyCreateEnabled', 'Shopify', 'shopify', 'Shopify連携'],
  note: ['note', 'メモ', '備考', 'Body (HTML)'],
  shopifyProductId: ['shopifyProductId', 'Shopify Product ID'],
  shopifyVariantId: ['shopifyVariantId', 'Shopify Variant ID'],
  shopifyInventoryItemId: ['shopifyInventoryItemId', 'Shopify Inventory Item ID']
};

export const normalizeCsvHeader = (value) => (
  String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_-]/g, '')
);

export const resolveProductCsvHeaderKey = (header) => {
  const normalized = normalizeCsvHeader(header);

  for (const [key, aliases] of Object.entries(PRODUCT_CSV_HEADER_ALIASES)) {
    if (aliases.some((alias) => normalizeCsvHeader(alias) === normalized)) {
      return key;
    }
  }

  return '';
};

export const parseProductCsvText = (sourceText) => {
  const csvText = String(sourceText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"') {
      if (quoted && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n' && !quoted) {
      row.push(cell);
      if (row.some((value) => String(value || '').trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value || '').trim())) rows.push(row);

  return rows;
};

export const buildProductCsvMappingDraft = (headers = []) => {
  const usedKeys = new Set();

  return headers.map((header, index) => {
    const guessedKey = resolveProductCsvHeaderKey(header);
    const fieldKey = guessedKey && !usedKeys.has(guessedKey) ? guessedKey : '';

    if (fieldKey) usedKeys.add(fieldKey);

    return {
      columnIndex: index,
      header,
      fieldKey
    };
  });
};

const normalizeCsvText = (value) => String(value ?? '').trim();

const normalizeCsvNumber = (value, fallback = 0) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const normalized = raw.replace(/[¥￥,\s]/g, '').replace(/%$/, '');
  const numberValue = Number(normalized);

  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const normalizeCsvBoolean = (value, fallback = false) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;

  if (['true', '1', 'yes', 'y', 'on', '表示', '有効', 'active', '公開', 'する', '対象'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', '非表示', '無効', 'inactive', '非公開', 'しない', '対象外'].includes(normalized)) return false;

  return fallback;
};

const normalizeMasterName = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
);

const findMasterByName = (items, name) => {
  const normalizedName = normalizeMasterName(name);
  if (!normalizedName) return null;
  return (items || []).find((item) => normalizeMasterName(item.name) === normalizedName) || null;
};

const normalizeMasterId = (value) => String(value || '').trim();

const findMasterById = (items, id) => {
  const normalizedId = normalizeMasterId(id);
  if (!normalizedId) return null;
  return (items || []).find((item) => normalizeMasterId(item.id) === normalizedId) || null;
};

const getMasterGroupId = (item) => (
  normalizeMasterId(item?.categoryGroupId)
  || normalizeMasterId(item?.groupId)
);

const getMasterGroupName = (item) => (
  normalizeCsvText(item?.categoryGroupName)
  || normalizeCsvText(item?.groupName)
);

const getMasterCategoryId = (item) => normalizeMasterId(item?.categoryId);

const findCategoryByHierarchy = (productCategories, categoryName, matchedGroup, categoryGroupName) => {
  const normalizedCategoryName = normalizeMasterName(categoryName);
  if (!normalizedCategoryName) return null;

  const candidates = (productCategories || []).filter((category) => (
    normalizeMasterName(category.name) === normalizedCategoryName
  ));

  if (candidates.length <= 1) return candidates[0] || null;

  const groupId = normalizeMasterId(matchedGroup?.id);
  const groupNameKey = normalizeMasterName(matchedGroup?.name || categoryGroupName);

  if (groupId) {
    const matchedByGroupId = candidates.find((category) => getMasterGroupId(category) === groupId);
    if (matchedByGroupId) return matchedByGroupId;
  }

  if (groupNameKey) {
    const matchedByGroupName = candidates.find((category) => normalizeMasterName(getMasterGroupName(category)) === groupNameKey);
    if (matchedByGroupName) return matchedByGroupName;
  }

  return candidates[0] || null;
};

const findSubCategoryByHierarchy = (
  productSubCategories,
  subCategoryName,
  matchedCategory,
  matchedGroup,
  categoryName,
  categoryGroupName
) => {
  const normalizedSubCategoryName = normalizeMasterName(subCategoryName);
  if (!normalizedSubCategoryName) return null;

  const candidates = (productSubCategories || []).filter((subCategory) => (
    normalizeMasterName(subCategory.name) === normalizedSubCategoryName
  ));

  if (candidates.length <= 1) return candidates[0] || null;

  const categoryId = normalizeMasterId(matchedCategory?.id);
  const categoryNameKey = normalizeMasterName(matchedCategory?.name || categoryName);
  const groupId = normalizeMasterId(matchedGroup?.id);
  const groupNameKey = normalizeMasterName(matchedGroup?.name || categoryGroupName);

  if (categoryId) {
    const matchedByCategoryId = candidates.find((subCategory) => getMasterCategoryId(subCategory) === categoryId);
    if (matchedByCategoryId) return matchedByCategoryId;
  }

  let scopedCandidates = candidates;

  if (categoryNameKey) {
    const byCategoryName = scopedCandidates.filter((subCategory) => (
      normalizeMasterName(subCategory.categoryName) === categoryNameKey
    ));
    if (byCategoryName.length === 1) return byCategoryName[0];
    if (byCategoryName.length > 1) scopedCandidates = byCategoryName;
  }

  if (groupId) {
    const matchedByGroupId = scopedCandidates.find((subCategory) => getMasterGroupId(subCategory) === groupId);
    if (matchedByGroupId) return matchedByGroupId;
  }

  if (groupNameKey) {
    const matchedByGroupName = scopedCandidates.find((subCategory) => (
      normalizeMasterName(getMasterGroupName(subCategory)) === groupNameKey
    ));
    if (matchedByGroupName) return matchedByGroupName;
  }

  return scopedCandidates[0] || candidates[0] || null;
};

export const buildProductCsvRecordsFromMapping = (rows, mappingDraft = []) => {
  const records = rows.slice(1).map((row, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };

    mappingDraft.forEach((mapping) => {
      if (!mapping?.fieldKey) return;
      record[mapping.fieldKey] = String(row[mapping.columnIndex] ?? '').trim();
    });

    return record;
  });

  return records;
};

export const buildProductCsvPreview = ({
  csvText,
  rows: providedRows,
  mappingDraft,
  products = [],
  productCategories = [],
  productCategoryGroups = [],
  productSubCategories = [],
  productSalesAreas = [],
  brands = [],
  suppliers = []
}) => {
  const rows = Array.isArray(providedRows) ? providedRows : parseProductCsvText(csvText);
  const headers = rows[0]?.map((header) => String(header || '').replace(/^\uFEFF/, '').trim()) || [];
  const effectiveMapping = Array.isArray(mappingDraft) ? mappingDraft : buildProductCsvMappingDraft(headers);
  const records = buildProductCsvRecordsFromMapping(rows, effectiveMapping);

  const existingSkuSet = new Set(
    products
      .map((product) => normalizeCsvText(product.sku || product.productCode))
      .filter(Boolean)
  );
  const existingProductsByBarcode = new Map(
    products
      .map((product) => [normalizeCsvText(product.barcode), product])
      .filter(([barcode]) => Boolean(barcode))
  );
  const seenImportBarcodeSet = new Set();

  const mappedFieldKeys = new Set(effectiveMapping.map((mapping) => mapping.fieldKey).filter(Boolean));
  const warnings = [];
  const errors = [];
  const importableProducts = [];
  const skippedProducts = [];

  if (!records.length) {
    errors.push('取込可能なデータ行がありません。');
  }

  if (!mappedFieldKeys.has('name')) {
    errors.push('商品名に紐づく列を選択してください。');
  }

  records.forEach((record) => {
    const sku = normalizeCsvText(record.sku);
    const name = normalizeCsvText(record.name);
    const barcode = normalizeCsvText(record.barcode);

    if (!sku && !name && !barcode) {
      skippedProducts.push({ rowNumber: record.__rowNumber, reason: '空行扱い' });
      return;
    }

    if (!name) {
      errors.push(`${record.__rowNumber}行目：商品名が空です。`);
      skippedProducts.push({ rowNumber: record.__rowNumber, reason: '商品名なし' });
      return;
    }

    // SKUは商品グループ内の複数variantで重複する運用を許容する。
    // barcodeはvariant識別子として同一CSV内の重複だけ禁止する。
    // 既存バーコードはスキップせず、既存商品の更新として取り込む。

    const existingProduct = barcode ? existingProductsByBarcode.get(barcode) : null;

    if (barcode && seenImportBarcodeSet.has(barcode)) {
      warnings.push(`${record.__rowNumber}行目：CSV内でバーコード「${barcode}」が重複するためスキップします。`);
      skippedProducts.push({ rowNumber: record.__rowNumber, reason: `CSV内バーコード重複: ${barcode}` });
      return;
    }

    if (existingProduct) {
      warnings.push(`${record.__rowNumber}行目：既存バーコード「${barcode}」の商品を更新対象として取り込みます。`);
    }

    const categoryGroupId = normalizeCsvText(record.categoryGroupId);
    const categoryId = normalizeCsvText(record.categoryId);
    const subCategoryId = normalizeCsvText(record.subCategoryId);
    const categoryName = normalizeCsvText(record.category);
    const subCategoryName = normalizeCsvText(record.subCategory);
    const salesAreaId = normalizeCsvText(record.salesAreaId);
    const salesAreaName = normalizeCsvText(record.salesAreaName || record.salesArea);
    const categoryGroupName = normalizeCsvText(record.categoryGroup);
    const brandName = normalizeCsvText(record.brand);
    const supplierName = normalizeCsvText(record.supplier);

    const matchedGroup = findMasterById(productCategoryGroups, categoryGroupId) || findMasterByName(productCategoryGroups, categoryGroupName);
    const matchedCategory = findMasterById(productCategories, categoryId) || findCategoryByHierarchy(productCategories, categoryName, matchedGroup, categoryGroupName);
    const matchedSubCategory = findMasterById(productSubCategories, subCategoryId) || findSubCategoryByHierarchy(
      productSubCategories,
      subCategoryName,
      matchedCategory,
      matchedGroup,
      categoryName,
      categoryGroupName
    );
    const matchedSalesArea = findMasterById(productSalesAreas, salesAreaId) || findMasterByName(productSalesAreas, salesAreaName);
    const matchedBrand = findMasterByName(brands, brandName);
    const matchedSupplier = findMasterByName(suppliers, supplierName);

    if ((categoryGroupId || categoryGroupName) && !matchedGroup) warnings.push(`${record.__rowNumber}行目：カテゴリーグループ「${categoryGroupName || categoryGroupId}」は未登録です。入力値のみ保持します。`);
    if ((categoryId || categoryName) && !matchedCategory) warnings.push(`${record.__rowNumber}行目：カテゴリー「${categoryGroupName ? `${categoryGroupName} / ` : ''}${categoryName || categoryId}」は未登録です。入力値のみ保持します。`);
    if ((subCategoryId || subCategoryName) && !matchedSubCategory) warnings.push(`${record.__rowNumber}行目：サブカテゴリー「${categoryGroupName ? `${categoryGroupName} / ` : ''}${categoryName ? `${categoryName} / ` : ''}${subCategoryName || subCategoryId}」は未登録です。入力値のみ保持します。`);
    if ((salesAreaId || salesAreaName) && !matchedSalesArea) warnings.push(`${record.__rowNumber}行目：売場「${salesAreaName || salesAreaId}」は未登録です。入力値のみ保持します。`);
    if (brandName && !matchedBrand) warnings.push(`${record.__rowNumber}行目：ブランド「${brandName}」は未登録です。nameのみ保持します。`);
    if (supplierName && !matchedSupplier) warnings.push(`${record.__rowNumber}行目：仕入先「${supplierName}」は未登録です。nameのみ保持します。`);

    const orderLot = normalizeCsvNumber(record.orderLot, 0);

    importableProducts.push({
      __rowNumber: record.__rowNumber,
      id: existingProduct?.id || '',
      sku: sku || normalizeCsvText(existingProduct?.sku || existingProduct?.productCode),
      productCode: sku || normalizeCsvText(existingProduct?.productCode || existingProduct?.sku),
      name,
      barcode,
      categoryId: matchedCategory?.id || categoryId,
      categoryName: matchedCategory?.name || categoryName,
      subCategoryId: matchedSubCategory?.id || subCategoryId,
      subCategoryName: matchedSubCategory?.name || subCategoryName,
      salesAreaId: matchedSalesArea?.id || salesAreaId,
      salesAreaName: matchedSalesArea?.name || salesAreaName,
      categoryGroupId: matchedGroup?.id || categoryGroupId || getMasterGroupId(matchedCategory) || '',
      categoryGroupName: matchedGroup?.name || getMasterGroupName(matchedCategory) || categoryGroupName,
      brandId: matchedBrand?.id || '',
      brandName: matchedBrand?.name || brandName,
      supplierId: matchedSupplier?.id || '',
      supplierName: matchedSupplier?.name || supplierName,
      size: normalizeCsvText(record.size),
      colorName: normalizeCsvText(record.colorName),
      priceTaxIncluded: normalizeCsvNumber(record.priceTaxIncluded, 0),
      costTaxExcluded: normalizeCsvNumber(record.costTaxExcluded, 0),
      taxRate: normalizeCsvNumber(record.taxRate, 10),
      inventoryQuantity: normalizeCsvNumber(record.inventoryQuantity, 0),
      reorderPoint: normalizeCsvNumber(record.reorderPoint, 0),
      reorderQuantity: normalizeCsvNumber(record.reorderQuantity, 0),
      orderLot,
      reorderLot: orderLot,
      labelEnabled: normalizeCsvBoolean(record.labelEnabled, true),
      shopifyCreateEnabled: normalizeCsvBoolean(record.shopifyCreateEnabled, false),
      note: normalizeCsvText(record.note),
      isActive: true,
      isArchived: false,
      shopifyProductId: normalizeCsvText(record.shopifyProductId),
      shopifyVariantId: normalizeCsvText(record.shopifyVariantId),
      shopifyInventoryItemId: normalizeCsvText(record.shopifyInventoryItemId),
      productGroupId: normalizeCsvText(record.productGroupId),
      productGroupRole: normalizeCsvText(record.productGroupRole) || 'primary',
      productGroupName: normalizeCsvText(record.productGroupName),
      groupCode: normalizeCsvText(record.groupCode)
    });

    if (barcode) seenImportBarcodeSet.add(barcode);
  });

  const productsByGroupId = new Map();

  importableProducts.forEach((product) => {
    const productGroupId = normalizeCsvText(product.productGroupId);
    if (!productGroupId) return;
    if (!productsByGroupId.has(productGroupId)) productsByGroupId.set(productGroupId, []);
    productsByGroupId.get(productGroupId).push(product);
  });

  const productGroupPayloadsById = new Map();

  productsByGroupId.forEach((groupProducts, productGroupId) => {
    const primaryProduct = groupProducts.find((product) => product.productGroupRole === 'primary') || groupProducts[0];
    if (!primaryProduct) return;

    const groupName = normalizeCsvText(primaryProduct.productGroupName || primaryProduct.name);
    productGroupPayloadsById.set(productGroupId, {
      id: productGroupId,
      name: groupName,
      productGroupName: groupName,
      groupCode: normalizeCsvText(primaryProduct.groupCode),
      brandId: primaryProduct.brandId || '',
      brandName: primaryProduct.brandName || '',
      categoryId: primaryProduct.categoryId || '',
      categoryName: primaryProduct.categoryName || '',
      subCategoryId: primaryProduct.subCategoryId || '',
      subCategoryName: primaryProduct.subCategoryName || '',
      salesAreaId: primaryProduct.salesAreaId || '',
      salesAreaName: primaryProduct.salesAreaName || '',
      categoryGroupId: primaryProduct.categoryGroupId || '',
      categoryGroupName: primaryProduct.categoryGroupName || '',
      shopifyEnabled: groupProducts.some((product) => Boolean(product.shopifyCreateEnabled)),
      shopifyProductId: normalizeCsvText(primaryProduct.shopifyProductId || groupProducts.find((product) => product.shopifyProductId)?.shopifyProductId),
      isActive: true,
      isArchived: false
    });
  });

  return {
    headers,
    mappingDraft: effectiveMapping,
    recognizedHeaders: effectiveMapping.filter((mapping) => mapping.fieldKey).map((mapping) => mapping.header),
    totalRows: records.length,
    importableProducts,
    importableProductGroups: [...productGroupPayloadsById.values()],
    skippedProducts,
    warnings,
    errors
  };
};
