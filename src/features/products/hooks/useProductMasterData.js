import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';

import {
  createShopifyDraftProductFromGroup,
  updateShopifyProductFromGroup,
  syncShopifyProductLinks,
  deleteProductMasterDoc,
  isValidStoreId,
  saveProductBrand,
  saveProductCategory,
  saveProductCategoryGroup,
  saveProductSubCategory,
  saveProductSalesArea,
  saveProductGroup,
  saveProductMasterItem,
  saveShopifySettings,
  saveSupplier,
  subscribeToProductBrands,
  subscribeToProductCategories,
  subscribeToProductCategoryGroups,
  subscribeToProductSubCategories,
  subscribeToProductSalesAreas,
  subscribeToProductGroups,
  subscribeToProductMasterItems,
  subscribeToShopifySettings,
  subscribeToSuppliers
} from '../../store/services/storeDataService';

const useStoreCollectionState = (storeId, subscribeFn, label) => {
  const hasStoreId = isValidStoreId(storeId);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    return subscribeFn(
      storeId,
      (nextItems) => {
        setItems(Array.isArray(nextItems) ? nextItems : []);
        setLoading(false);
      },
      (error) => {
        console.error(`[${label}] subscribe failed`, error);
        setLoading(false);
      }
    );
  }, [hasStoreId, label, storeId, subscribeFn]);

  return {
    items: hasStoreId ? items : [],
    loading: hasStoreId ? loading : false
  };
};

const useStoreDocState = (storeId, subscribeFn, label) => {
  const hasStoreId = isValidStoreId(storeId);
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) {
      setItem(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    return subscribeFn(
      storeId,
      (nextItem) => {
        setItem(nextItem || null);
        setLoading(false);
      },
      (error) => {
        console.error(`[${label}] subscribe failed`, error);
        setLoading(false);
      }
    );
  }, [hasStoreId, label, storeId, subscribeFn]);

  return {
    item: hasStoreId ? item : null,
    loading: hasStoreId ? loading : false
  };
};

export const useProductMasterData = (storeId) => {
  const productsState = useStoreCollectionState(storeId, subscribeToProductMasterItems, 'products');
  const productGroupsState = useStoreCollectionState(storeId, subscribeToProductGroups, 'productGroups');
  const categoriesState = useStoreCollectionState(storeId, subscribeToProductCategories, 'productCategories');
  const categoryGroupsState = useStoreCollectionState(storeId, subscribeToProductCategoryGroups, 'productCategoryGroups');
  const subCategoriesState = useStoreCollectionState(storeId, subscribeToProductSubCategories, 'productSubCategories');
  const salesAreasState = useStoreCollectionState(storeId, subscribeToProductSalesAreas, 'productSalesAreas');
  const brandsState = useStoreCollectionState(storeId, subscribeToProductBrands, 'brands');
  const suppliersState = useStoreCollectionState(storeId, subscribeToSuppliers, 'suppliers');
  const shopifySettingsState = useStoreDocState(storeId, subscribeToShopifySettings, 'shopifySettings');

  const hasStoreId = isValidStoreId(storeId);

  const saveProduct = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductMasterItem(storeId, itemData);
  };

  const saveGroup = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductGroup(storeId, itemData);
  };

  const deleteProduct = async (productId) => {
    if (!hasStoreId || !productId) return;
    await deleteProductMasterDoc(storeId, 'products', productId);
  };

  const saveCategory = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductCategory(storeId, itemData);
  };

  const deleteCategory = async (categoryId) => {
    if (!hasStoreId || !categoryId) return;
    await deleteProductMasterDoc(storeId, 'productCategories', categoryId);
  };

  const saveCategoryGroup = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductCategoryGroup(storeId, itemData);
  };

  const deleteCategoryGroup = async (groupId) => {
    if (!hasStoreId || !groupId) return;
    await deleteProductMasterDoc(storeId, 'productCategoryGroups', groupId);
  };

  const saveSubCategory = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductSubCategory(storeId, itemData);
  };

  const deleteSubCategory = async (subCategoryId) => {
    if (!hasStoreId || !subCategoryId) return;
    await deleteProductMasterDoc(storeId, 'productSubCategories', subCategoryId);
  };

  const saveSalesArea = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductSalesArea(storeId, itemData);
  };

  const deleteSalesArea = async (salesAreaId) => {
    if (!hasStoreId || !salesAreaId) return;
    await deleteProductMasterDoc(storeId, 'productSalesAreas', salesAreaId);
  };

  const saveBrand = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveProductBrand(storeId, itemData);
  };

  const deleteBrand = async (brandId) => {
    if (!hasStoreId || !brandId) return;
    await deleteProductMasterDoc(storeId, 'brands', brandId);
  };

  const saveSupplierData = async (itemData) => {
    if (!hasStoreId) return undefined;
    return await saveSupplier(storeId, itemData);
  };

  const deleteSupplier = async (supplierId) => {
    if (!hasStoreId || !supplierId) return;
    await deleteProductMasterDoc(storeId, 'suppliers', supplierId);
  };

  const createShopifyDraftProductData = async (productGroupId) => {
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken?.();

    return await createShopifyDraftProductFromGroup({
      storeId,
      productGroupId,
      idToken
    });
  };

  const updateShopifyProductData = async (productGroupId) => {
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken?.();

    return await updateShopifyProductFromGroup({
      storeId,
      productGroupId,
      idToken
    });
  };

  const saveShopifySettingsData = async (settings) => {
    if (!hasStoreId) return undefined;
    return await saveShopifySettings(storeId, settings);
  };

  const syncShopifyProductLinksData = async (statuses = ['ACTIVE']) => {
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken?.();

    return await syncShopifyProductLinks({ storeId, statuses, idToken });
  };

  return {
    products: productsState.items,
    productGroups: productGroupsState.items,
    productCategories: categoriesState.items,
    productCategoryGroups: categoryGroupsState.items,
    productSubCategories: subCategoriesState.items,
    productSalesAreas: salesAreasState.items,
    brands: brandsState.items,
    suppliers: suppliersState.items,
    shopifySettings: shopifySettingsState.item,
    loading:
      productsState.loading ||
      productGroupsState.loading ||
      categoriesState.loading ||
      categoryGroupsState.loading ||
      subCategoriesState.loading ||
      salesAreasState.loading ||
      brandsState.loading ||
      suppliersState.loading ||
      shopifySettingsState.loading,
    saveProduct,
    saveProductGroup: saveGroup,
    deleteProduct,
    saveCategory,
    deleteCategory,
    saveCategoryGroup,
    deleteCategoryGroup,
    saveSubCategory,
    deleteSubCategory,
    saveSalesArea,
    deleteSalesArea,
    saveBrand,
    deleteBrand,
    saveSupplier: saveSupplierData,
    deleteSupplier,
    saveShopifySettings: saveShopifySettingsData,
    createShopifyDraftProduct: createShopifyDraftProductData,
    updateShopifyProduct: updateShopifyProductData,
    syncShopifyProductLinks: syncShopifyProductLinksData
  };
};
