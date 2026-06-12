export const MASTER_CSV_FIELD_OPTIONS = {
  suppliers: [
    { id: '', label: '取り込まない' },
    { id: 'supplierId', label: '仕入先ID', required: false },
    { id: 'name', label: '仕入先名', required: true },
    { id: 'contactName', label: '担当者' },
    { id: 'tel', label: '電話番号' },
    { id: 'fax', label: 'FAX番号' },
    { id: 'email', label: 'メールアドレス' },
    { id: 'address', label: '住所' },
    { id: 'backorderValidDays', label: '受注残有効日数' },
    { id: 'orderListPrice', label: '発注上代' },
    { id: 'defaultCostRate', label: '掛率' },
    { id: 'note', label: 'メモ' }
  ],
  brands: [
    { id: '', label: '取り込まない' },
    { id: 'brandId', label: 'ブランドID', required: false },
    { id: 'name', label: 'ブランド名', required: true },
    { id: 'stocktakingTypeCode', label: '棚卸区分コード' },
    { id: 'supplierId', label: '仕入先ID' },
    { id: 'supplierName', label: '仕入先名' },
    { id: 'note', label: 'メモ' }
  ],
  categories: [
    { id: '', label: '取り込まない' },
    { id: 'categoryGroupId', label: 'カテゴリーグループID' },
    { id: 'categoryGroupName', label: 'カテゴリーグループ名' },
    { id: 'categoryId', label: 'カテゴリーID' },
    { id: 'categoryName', label: 'カテゴリー名', required: true },
    { id: 'subCategoryId', label: 'サブカテゴリーID' },
    { id: 'subCategoryName', label: 'サブカテゴリー名' },
    { id: 'sortOrder', label: '並び順' },
    { id: 'note', label: 'メモ' }
  ]
};

const MASTER_CSV_HEADER_ALIASES = {
  suppliers: {
    supplierId: ['仕入先ID', 'supplierId', 'supplier_id', 'supplierCode', 'smaregiSupplierId', '仕入先コード'],
    name: ['仕入先名', 'name', 'supplierName', 'supplier_name'],
    contactName: ['担当者', '担当者名', 'contactName', 'contact'],
    tel: ['電話番号', '電話', 'TEL', 'tel', 'phone'],
    fax: ['FAX番号', 'FAX', 'fax'],
    email: ['メールアドレス', 'メール', 'email', 'mail'],
    address: ['住所', '所在地', 'address'],
    backorderValidDays: ['受注残有効日数', 'backorderValidDays'],
    orderListPrice: ['発注上代', 'orderListPrice'],
    defaultCostRate: ['掛率', '標準掛率', 'defaultCostRate', 'costRate'],
    note: ['メモ', '備考', 'note']
  },
  brands: {
    brandId: ['ブランドID', 'brandId', 'brand_id', 'brandCode', 'smaregiBrandId', 'ブランドコード'],
    name: ['ブランド名', 'name', 'brandName', 'brand_name'],
    stocktakingTypeCode: ['棚卸区分コード', 'stocktakingTypeCode', '棚卸区分'],
    supplierId: ['仕入先ID', 'supplierId', 'supplier_id', 'supplierCode', 'supplierSmaregiId', 'smaregiSupplierId', '仕入先コード'],
    supplierName: ['仕入先名', 'supplierName', 'supplier_name'],
    note: ['メモ', '備考', 'note']
  },
  categories: {
    smaregiCategoryGroupId: [
      '部門グループID',
      '部門グループコード',
      '部門グループ',
      'グループID',
      'グループコード',
      'カテゴリーグループID',
      'カテゴリーグループコード',
      'categoryGroupId',
      'category_group_id',
      'categoryGroupCode',
      'groupId',
      'group_id',
      'groupCode'
    ],
    categoryGroupName: [
      '部門グループ名',
      'カテゴリーグループ名',
      'カテゴリーグループ',
      'グループ名',
      'categoryGroupName',
      'category_group_name',
      'groupName',
      'Product Category'
    ],
    smaregiCategoryId: [
      '部門コード',
      'カテゴリーID',
      'カテゴリーコード',
      'categoryId',
      'category_id',
      'categoryCode',
      'Type ID'
    ],
    categoryName: ['部門名', 'カテゴリー名', 'categoryName', 'category_name', 'Type', 'カテゴリ名'],
    smaregiSubCategoryId: ['サブカテゴリーID', 'サブカテゴリーコード', 'subCategoryId', 'sub_category_id', 'subCategoryCode'],
    subCategoryName: ['サブカテゴリー名', 'サブカテゴリー', '小カテゴリー', '小分類', 'subCategoryName', 'sub_category_name', 'Shopify Sub Category'],
    sortOrder: ['表示順', '並び順', 'sortOrder', 'order'],
    note: ['メモ', '備考', 'note']
  }
};

export const normalizeMasterCsvHeader = (value) => (
  String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[,_-]/g, '')
);

export const parseMasterCsvText = (sourceText) => {
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

export const resolveMasterCsvHeaderKey = (type, header) => {
  const aliases = MASTER_CSV_HEADER_ALIASES[type] || {};
  const normalized = normalizeMasterCsvHeader(header);

  for (const [key, values] of Object.entries(aliases)) {
    if (values.some((alias) => normalizeMasterCsvHeader(alias) === normalized)) {
      return key;
    }
  }

  return '';
};

export const buildMasterCsvMappingDraft = (type, headers = []) => {
  const usedKeys = new Set();

  return headers.map((header, index) => {
    const guessedKey = resolveMasterCsvHeaderKey(type, header);
    const fieldKey = guessedKey && !usedKeys.has(guessedKey) ? guessedKey : '';

    if (fieldKey) usedKeys.add(fieldKey);

    return {
      columnIndex: index,
      header,
      fieldKey
    };
  });
};

export const buildMasterCsvRecordsFromMapping = (rows, mappingDraft = []) => (
  rows.slice(1).map((row, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };

    mappingDraft.forEach((mapping) => {
      if (!mapping?.fieldKey) return;
      record[mapping.fieldKey] = String(row[mapping.columnIndex] ?? '').trim();
    });

    return record;
  })
);

const normalizeText = (value) => String(value ?? '').trim();

const normalizeNumber = (value, fallback = null) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const numberValue = Number(raw.replace(/[¥￥,%\s]/g, ''));
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const normalizeMasterName = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
);

const findByName = (items, name) => {
  const normalized = normalizeMasterName(name);
  if (!normalized) return null;
  return (items || []).find((item) => normalizeMasterName(item.name) === normalized) || null;
};

const findCategoryGroup = (groups, groupExternalId, groupName) => {
  const normalizedId = normalizeText(groupExternalId);

  if (normalizedId) {
    const matchedById = (groups || []).find((group) => (
      normalizeText(group.smaregiCategoryGroupId) === normalizedId ||
      normalizeText(group.categoryGroupExternalId) === normalizedId ||
      normalizeText(group.externalCategoryGroupId) === normalizedId ||
      normalizeText(group.groupExternalId) === normalizedId
    ));

    if (matchedById) return matchedById;
  }

  return findByName(groups, groupName);
};

const findSupplier = (suppliers, supplierSmaregiId, supplierName) => {
  const normalizedId = normalizeText(supplierSmaregiId);
  if (normalizedId) {
    const matchedById = (suppliers || []).find((supplier) => (
      normalizeText(supplier.smaregiSupplierId) === normalizedId ||
      normalizeText(supplier.supplierExternalId) === normalizedId ||
      normalizeText(supplier.externalSupplierId) === normalizedId ||
      normalizeText(supplier.supplierCode) === normalizedId ||
      normalizeText(supplier.id) === normalizedId
    ));
    if (matchedById) return matchedById;
  }

  return findByName(suppliers, supplierName);
};

const findCategory = (categories, categoryExternalId, categoryName) => {
  const normalizedId = normalizeText(categoryExternalId);

  if (normalizedId) {
    const matchedById = (categories || []).find((category) => (
      normalizeText(category.smaregiCategoryId) === normalizedId ||
      normalizeText(category.categoryExternalId) === normalizedId ||
      normalizeText(category.externalCategoryId) === normalizedId ||
      normalizeText(category.categoryCode) === normalizedId ||
      normalizeText(category.id) === normalizedId
    ));

    if (matchedById) return matchedById;
  }

  return findByName(categories, categoryName);
};


const findSubCategory = (subCategories, subCategoryExternalId, subCategoryName, matchedCategory, categoryName, matchedGroup, categoryGroupName) => {
  const normalizedId = normalizeText(subCategoryExternalId);
  const normalizedName = normalizeMasterName(subCategoryName);

  if (normalizedId) {
    const matchedById = (subCategories || []).find((subCategory) => (
      normalizeText(subCategory.smaregiSubCategoryId) === normalizedId ||
      normalizeText(subCategory.subCategoryExternalId) === normalizedId ||
      normalizeText(subCategory.externalSubCategoryId) === normalizedId ||
      normalizeText(subCategory.subCategoryCode) === normalizedId ||
      normalizeText(subCategory.id) === normalizedId
    ));
    if (matchedById) return matchedById;
  }

  if (!normalizedName) return null;

  let candidates = (subCategories || []).filter((subCategory) => (
    normalizeMasterName(subCategory.name || subCategory.subCategoryName) === normalizedName
  ));

  if (!candidates.length) return null;

  const categoryId = normalizeText(matchedCategory?.id);
  const categoryNameKey = normalizeMasterName(matchedCategory?.name || categoryName);
  const groupId = normalizeText(matchedGroup?.id || matchedCategory?.groupId || matchedCategory?.categoryGroupId);
  const groupNameKey = normalizeMasterName(matchedGroup?.name || matchedCategory?.categoryGroupName || categoryGroupName);

  if (categoryId) {
    const scoped = candidates.filter((subCategory) => normalizeText(subCategory.categoryId) === categoryId);
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) candidates = scoped;
  }

  if (categoryNameKey) {
    const scoped = candidates.filter((subCategory) => normalizeMasterName(subCategory.categoryName) === categoryNameKey);
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) candidates = scoped;
  }

  if (groupId) {
    const scoped = candidates.filter((subCategory) => (
      normalizeText(subCategory.categoryGroupId) === groupId ||
      normalizeText(subCategory.groupId) === groupId
    ));
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) candidates = scoped;
  }

  if (groupNameKey) {
    const scoped = candidates.filter((subCategory) => (
      normalizeMasterName(subCategory.categoryGroupName || subCategory.groupName) === groupNameKey
    ));
    if (scoped.length === 1) return scoped[0];
  }

  return candidates.length === 1 ? candidates[0] : null;
};

export const buildMasterCsvPreview = ({
  type,
  rows,
  mappingDraft,
  suppliers = [],
  brands = [],
  productCategories = [],
  productCategoryGroups = [],
  productSubCategories = [],
  duplicateHandlingMode = 'skip'
}) => {
  const headers = rows[0]?.map((header) => String(header || '').replace(/^\uFEFF/, '').trim()) || [];
  const effectiveMapping = Array.isArray(mappingDraft) ? mappingDraft : buildMasterCsvMappingDraft(type, headers);
  const records = buildMasterCsvRecordsFromMapping(rows, effectiveMapping);
  const mappedFieldKeys = new Set(effectiveMapping.map((mapping) => mapping.fieldKey).filter(Boolean));

  const errors = [];
  const warnings = [];
  const importableItems = [];
  const skippedItems = [];

  if (!records.length) errors.push('取込可能なデータ行がありません。');

  if (type === 'suppliers' && !mappedFieldKeys.has('name')) {
    errors.push('仕入先名に紐づく列を選択してください。');
  }

  if (type === 'brands' && !mappedFieldKeys.has('name')) {
    errors.push('ブランド名に紐づく列を選択してください。');
  }

  if (type === 'categories' && !mappedFieldKeys.has('categoryName')) {
    errors.push('カテゴリー名に紐づく列を選択してください。');
  }

  const existingSupplierNames = new Set((suppliers || []).map((item) => normalizeMasterName(item.name)).filter(Boolean));
  const existingSupplierIds = new Set((suppliers || []).map((item) => normalizeText(item.smaregiSupplierId || item.supplierExternalId || item.externalSupplierId || item.supplierCode || item.id)).filter(Boolean));
  const existingSuppliersById = new Map();
  const existingSuppliersByName = new Map();

  (suppliers || []).forEach((supplier) => {
    [
      supplier.smaregiSupplierId,
      supplier.supplierExternalId,
      supplier.externalSupplierId,
      supplier.supplierCode,
      supplier.id
    ].forEach((supplierIdCandidate) => {
      const normalizedSupplierId = normalizeText(supplierIdCandidate);
      if (normalizedSupplierId && !existingSuppliersById.has(normalizedSupplierId)) {
        existingSuppliersById.set(normalizedSupplierId, supplier);
      }
    });

    const normalizedSupplierName = normalizeMasterName(supplier.name || supplier.supplierName);
    if (normalizedSupplierName && !existingSuppliersByName.has(normalizedSupplierName)) {
      existingSuppliersByName.set(normalizedSupplierName, supplier);
    }
  });
  const existingBrandNames = new Set((brands || []).map((item) => normalizeMasterName(item.name)).filter(Boolean));
  const existingBrandIds = new Set((brands || []).map((item) => normalizeText(item.smaregiBrandId || item.brandExternalId || item.externalBrandId || item.brandCode || item.id)).filter(Boolean));
  const existingBrandsById = new Map();
  const existingBrandsByName = new Map();

  (brands || []).forEach((brand) => {
    [
      brand.smaregiBrandId,
      brand.brandExternalId,
      brand.externalBrandId,
      brand.brandCode,
      brand.id
    ].forEach((brandIdCandidate) => {
      const normalizedBrandId = normalizeText(brandIdCandidate);
      if (normalizedBrandId && !existingBrandsById.has(normalizedBrandId)) {
        existingBrandsById.set(normalizedBrandId, brand);
      }
    });

    const normalizedBrandName = normalizeMasterName(brand.name || brand.brandName);
    if (normalizedBrandName && !existingBrandsByName.has(normalizedBrandName)) {
      existingBrandsByName.set(normalizedBrandName, brand);
    }
  });

  const existingCategoryNames = new Set((productCategories || []).map((item) => normalizeMasterName(item.name)).filter(Boolean));
  const existingGroupNames = new Set((productCategoryGroups || []).map((item) => normalizeMasterName(item.name)).filter(Boolean));
  const existingSubCategoryNames = new Set((productSubCategories || []).map((item) => normalizeMasterName(item.name || item.subCategoryName)).filter(Boolean));

  records.forEach((record) => {
    if (type === 'suppliers') {
      const smaregiSupplierId = normalizeText(record.supplierId || record.smaregiSupplierId);
      const name = normalizeText(record.name);

      if (!smaregiSupplierId && !name) {
        skippedItems.push({ rowNumber: record.__rowNumber, reason: '空行扱い' });
        return;
      }

      if (!name) {
        errors.push(`${record.__rowNumber}行目：仕入先名が空です。`);
        skippedItems.push({ rowNumber: record.__rowNumber, reason: '仕入先名なし' });
        return;
      }

      const normalizedSupplierName = normalizeMasterName(name);
      const matchedExistingSupplier = (
        (smaregiSupplierId && existingSuppliersById.get(smaregiSupplierId))
        || existingSuppliersByName.get(normalizedSupplierName)
        || null
      );

      if (matchedExistingSupplier && duplicateHandlingMode !== 'update') {
        const reason = smaregiSupplierId && existingSuppliersById.get(smaregiSupplierId)
          ? `仕入先ID重複: ${smaregiSupplierId}`
          : `仕入先名重複: ${name}`;
        warnings.push(`${record.__rowNumber}行目：既存仕入先「${name}」と重複するためスキップします。`);
        skippedItems.push({ rowNumber: record.__rowNumber, reason });
        return;
      }

      importableItems.push({
        __rowNumber: record.__rowNumber,
        ...(matchedExistingSupplier ? {
          id: matchedExistingSupplier.id,
          importAction: 'update',
          importActionLabel: '既存更新'
        } : {
          importAction: 'create',
          importActionLabel: '新規追加'
        }),
        supplierId: smaregiSupplierId,
        smaregiSupplierId,
        supplierExternalId: smaregiSupplierId,
        name,
        contactName: normalizeText(record.contactName),
        tel: normalizeText(record.tel),
        fax: normalizeText(record.fax),
        email: normalizeText(record.email),
        address: normalizeText(record.address),
        backorderValidDays: normalizeNumber(record.backorderValidDays, null),
        orderListPrice: normalizeNumber(record.orderListPrice, null),
        defaultCostRate: normalizeNumber(record.defaultCostRate, null),
        note: normalizeText(record.note),
        isActive: true
      });

      if (smaregiSupplierId) existingSupplierIds.add(smaregiSupplierId);
      if (smaregiSupplierId && !existingSuppliersById.has(smaregiSupplierId)) {
        existingSuppliersById.set(smaregiSupplierId, { id: '', name, smaregiSupplierId });
      }
      existingSupplierNames.add(normalizedSupplierName);
      if (normalizedSupplierName && !existingSuppliersByName.has(normalizedSupplierName)) {
        existingSuppliersByName.set(normalizedSupplierName, { id: '', name, smaregiSupplierId });
      }
      return;
    }

    if (type === 'brands') {
      const smaregiBrandId = normalizeText(record.brandId || record.smaregiBrandId);
      const name = normalizeText(record.name);
      const supplierSmaregiId = normalizeText(record.supplierId || record.supplierSmaregiId || record.smaregiSupplierId);
      const supplierName = normalizeText(record.supplierName);
      const matchedSupplier = findSupplier(suppliers, supplierSmaregiId, supplierName);

      if (!smaregiBrandId && !name) {
        skippedItems.push({ rowNumber: record.__rowNumber, reason: '空行扱い' });
        return;
      }

      if (!name) {
        errors.push(`${record.__rowNumber}行目：ブランド名が空です。`);
        skippedItems.push({ rowNumber: record.__rowNumber, reason: 'ブランド名なし' });
        return;
      }

      const normalizedBrandName = normalizeMasterName(name);
      const matchedExistingBrand = (
        (smaregiBrandId && existingBrandsById.get(smaregiBrandId))
        || existingBrandsByName.get(normalizedBrandName)
        || null
      );

      if (matchedExistingBrand && duplicateHandlingMode !== 'update') {
        const reason = smaregiBrandId && existingBrandsById.get(smaregiBrandId)
          ? `ブランドID重複: ${smaregiBrandId}`
          : `ブランド名重複: ${name}`;
        warnings.push(`${record.__rowNumber}行目：既存ブランド「${name}」と重複するためスキップします。`);
        skippedItems.push({ rowNumber: record.__rowNumber, reason });
        return;
      }

      if ((supplierSmaregiId || supplierName) && !matchedSupplier) {
        warnings.push(`${record.__rowNumber}行目：仕入先「${supplierSmaregiId || supplierName}」は未登録です。name/idのみ保持します。`);
      }

      importableItems.push({
        __rowNumber: record.__rowNumber,
        ...(matchedExistingBrand ? {
          id: matchedExistingBrand.id,
          importAction: 'update',
          importActionLabel: '既存更新'
        } : {
          importAction: 'create',
          importActionLabel: '新規追加'
        }),
        brandId: smaregiBrandId,
        smaregiBrandId,
        brandExternalId: smaregiBrandId,
        name,
        stocktakingTypeCode: normalizeText(record.stocktakingTypeCode),
        supplierId: matchedSupplier?.id || matchedExistingBrand?.supplierId || '',
        supplierExternalId: supplierSmaregiId,
        supplierSmaregiId,
        supplierName: matchedSupplier?.name || supplierName,
        note: normalizeText(record.note),
        isActive: true
      });

      if (smaregiBrandId) existingBrandIds.add(smaregiBrandId);
      if (smaregiBrandId && !existingBrandsById.has(smaregiBrandId)) {
        existingBrandsById.set(smaregiBrandId, { id: '', name, smaregiBrandId });
      }
      existingBrandNames.add(normalizedBrandName);
      if (normalizedBrandName && !existingBrandsByName.has(normalizedBrandName)) {
        existingBrandsByName.set(normalizedBrandName, { id: '', name, smaregiBrandId });
      }
      return;
    }

    if (type === 'categories') {
      const smaregiCategoryGroupId = normalizeText(record.categoryGroupId || record.smaregiCategoryGroupId);
      const categoryGroupName = normalizeText(record.categoryGroupName);
      const smaregiCategoryId = normalizeText(record.categoryId || record.smaregiCategoryId);
      const categoryName = normalizeText(record.categoryName);
      const smaregiSubCategoryId = normalizeText(record.subCategoryId || record.smaregiSubCategoryId);
      const subCategoryName = normalizeText(record.subCategoryName);

      if (!categoryGroupName && !categoryName) {
        skippedItems.push({ rowNumber: record.__rowNumber, reason: '空行扱い' });
        return;
      }

      if (!categoryName) {
        errors.push(`${record.__rowNumber}行目：カテゴリー名が空です。`);
        skippedItems.push({ rowNumber: record.__rowNumber, reason: 'カテゴリー名なし' });
        return;
      }

      const groupNameKey = normalizeMasterName(categoryGroupName);
      const categoryNameKey = normalizeMasterName(categoryName);
      const subCategoryNameKey = normalizeMasterName(subCategoryName);

      if (existingCategoryNames.has(categoryNameKey)) {
        warnings.push(`${record.__rowNumber}行目：既存カテゴリー名「${categoryName}」と重複するため、カテゴリーはスキップ対象です。`);
      }

      const matchedGroup = findCategoryGroup(productCategoryGroups, smaregiCategoryGroupId, categoryGroupName);
      const matchedCategory = findCategory(productCategories, smaregiCategoryId, categoryName);
      const matchedSubCategory = findSubCategory(productSubCategories, smaregiSubCategoryId, subCategoryName, matchedCategory, categoryName, matchedGroup, categoryGroupName);
      const shouldCreateGroup = !!categoryGroupName && !matchedGroup && !existingGroupNames.has(groupNameKey);
      const shouldUpdateGroup = !!categoryGroupName && !!matchedGroup?.id && duplicateHandlingMode === 'update';
      const shouldCreateCategory = !matchedCategory && !existingCategoryNames.has(categoryNameKey);
      const shouldUpdateCategory = !!matchedCategory?.id && duplicateHandlingMode === 'update';
      const shouldCreateSubCategory = !!subCategoryName && !matchedSubCategory && !existingSubCategoryNames.has(subCategoryNameKey);
      const shouldUpdateSubCategory = !!matchedSubCategory?.id && duplicateHandlingMode === 'update';

      const categoryGroupPayload = shouldUpdateGroup
        ? {
          id: matchedGroup.id,
          smaregiCategoryGroupId,
          categoryGroupExternalId: smaregiCategoryGroupId,
          externalCategoryGroupId: smaregiCategoryGroupId,
          name: categoryGroupName || matchedGroup.name || '',
          sortOrder: normalizeNumber(record.sortOrder, null) ?? matchedGroup.sortOrder ?? 0,
          departmentId: matchedGroup.departmentId || 'retail',
          isActive: true
        }
        : shouldCreateGroup
          ? {
            smaregiCategoryGroupId,
            categoryGroupExternalId: smaregiCategoryGroupId,
            externalCategoryGroupId: smaregiCategoryGroupId,
            name: categoryGroupName,
            sortOrder: normalizeNumber(record.sortOrder, 0) ?? 0,
            departmentId: 'retail',
            isActive: true
          }
          : null;

      const categoryPayload = shouldUpdateCategory
        ? {
          id: matchedCategory.id,
          smaregiCategoryId,
          categoryExternalId: smaregiCategoryId,
          externalCategoryId: smaregiCategoryId,
          name: categoryName || matchedCategory.name || '',
          groupId: matchedGroup?.id || matchedCategory.groupId || '',
          groupName: matchedGroup?.name || categoryGroupName || matchedCategory.groupName || '',
          categoryGroupName: matchedGroup?.name || categoryGroupName || matchedCategory.categoryGroupName || '',
          smaregiCategoryGroupId,
          categoryGroupExternalId: smaregiCategoryGroupId,
          sortOrder: normalizeNumber(record.sortOrder, null) ?? matchedCategory.sortOrder ?? 0,
          departmentId: matchedCategory.departmentId || 'retail',
          note: normalizeText(record.note) || matchedCategory.note || '',
          isActive: true
        }
        : shouldCreateCategory
          ? {
            smaregiCategoryId,
            categoryExternalId: smaregiCategoryId,
            externalCategoryId: smaregiCategoryId,
            name: categoryName,
            groupId: matchedGroup?.id || '',
            groupName: matchedGroup?.name || categoryGroupName,
            categoryGroupName: matchedGroup?.name || categoryGroupName,
            smaregiCategoryGroupId,
            categoryGroupExternalId: smaregiCategoryGroupId,
            sortOrder: normalizeNumber(record.sortOrder, 0) ?? 0,
            departmentId: 'retail',
            note: normalizeText(record.note),
            isActive: true
          }
          : null;

      const effectiveCategoryId = matchedCategory?.id || categoryPayload?.id || '';
      const effectiveCategoryName = matchedCategory?.name || categoryName || categoryPayload?.name || '';
      const effectiveGroupId = matchedGroup?.id || matchedCategory?.groupId || categoryPayload?.groupId || '';
      const effectiveGroupName = matchedGroup?.name || categoryGroupName || matchedCategory?.categoryGroupName || categoryPayload?.categoryGroupName || '';

      const subCategoryPayload = shouldUpdateSubCategory
        ? {
          id: matchedSubCategory.id,
          smaregiSubCategoryId,
          subCategoryExternalId: smaregiSubCategoryId,
          externalSubCategoryId: smaregiSubCategoryId,
          name: subCategoryName || matchedSubCategory.name || matchedSubCategory.subCategoryName || '',
          subCategoryName: subCategoryName || matchedSubCategory.subCategoryName || matchedSubCategory.name || '',
          categoryId: effectiveCategoryId || matchedSubCategory.categoryId || '',
          categoryName: effectiveCategoryName || matchedSubCategory.categoryName || '',
          categoryGroupId: effectiveGroupId || matchedSubCategory.categoryGroupId || matchedSubCategory.groupId || '',
          categoryGroupName: effectiveGroupName || matchedSubCategory.categoryGroupName || '',
          groupId: effectiveGroupId || matchedSubCategory.groupId || matchedSubCategory.categoryGroupId || '',
          sortOrder: normalizeNumber(record.sortOrder, null) ?? matchedSubCategory.sortOrder ?? 0,
          note: normalizeText(record.note) || matchedSubCategory.note || '',
          isActive: true
        }
        : shouldCreateSubCategory
          ? {
            smaregiSubCategoryId,
            subCategoryExternalId: smaregiSubCategoryId,
            externalSubCategoryId: smaregiSubCategoryId,
            name: subCategoryName,
            subCategoryName,
            categoryId: effectiveCategoryId,
            categoryName: effectiveCategoryName || categoryName,
            categoryGroupId: effectiveGroupId,
            categoryGroupName: effectiveGroupName || categoryGroupName,
            groupId: effectiveGroupId,
            sortOrder: normalizeNumber(record.sortOrder, 0),
            note: normalizeText(record.note),
            isActive: true
          }
          : null;


      if (!categoryGroupPayload && !categoryPayload && !subCategoryPayload) {
        warnings.push(`${record.__rowNumber}行目：既存カテゴリー「${categoryName}」と重複するためスキップします。`);
        skippedItems.push({ rowNumber: record.__rowNumber, reason: `カテゴリー重複: ${categoryName}` });
        return;
      }

      importableItems.push({
        __rowNumber: record.__rowNumber,
        importAction: shouldUpdateCategory || shouldUpdateGroup || shouldUpdateSubCategory ? 'update' : 'create',
        importActionLabel: shouldUpdateCategory || shouldUpdateGroup || shouldUpdateSubCategory ? '既存更新' : '新規追加',
        smaregiCategoryGroupId,
        categoryGroupName,
        matchedCategoryGroupId: matchedGroup?.id || '',
        categoryGroupPayload,
        smaregiCategoryId,
        categoryId: smaregiCategoryId,
        categoryName,
        categoryPayload,
        smaregiSubCategoryId,
        subCategoryId: smaregiSubCategoryId,
        subCategoryName,
        matchedSubCategoryId: matchedSubCategory?.id || '',
        subCategoryPayload
      });

      if (groupNameKey) existingGroupNames.add(groupNameKey);
      if (categoryNameKey) existingCategoryNames.add(categoryNameKey);
      if (subCategoryNameKey) existingSubCategoryNames.add(subCategoryNameKey);
    }
  });

  return {
    headers,
    mappingDraft: effectiveMapping,
    totalRows: records.length,
    importableItems,
    skippedItems,
    warnings,
    errors
  };
};
