import { useEffect, useState } from 'react';

import {
  deleteProductMasterDoc,
  isValidStoreId,
  saveProductBrand,
  saveProductCategory,
  saveProductCategoryGroup,
  saveProductMasterItem,
  saveSupplier,
  subscribeToProductBrands,
  subscribeToProductCategories,
  subscribeToProductCategoryGroups,
  subscribeToProductMasterItems,
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

export const useProductMasterData = (storeId) => {
  const productsState = useStoreCollectionState(storeId, subscribeToProductMasterItems, 'products');
  const categoriesState = useStoreCollectionState(storeId, subscribeToProductCategories, 'productCategories');
  const categoryGroupsState = useStoreCollectionState(storeId, subscribeToProductCategoryGroups, 'productCategoryGroups');
  const brandsState = useStoreCollectionState(storeId, subscribeToProductBrands, 'brands');
  const suppliersState = useStoreCollectionState(storeId, subscribeToSuppliers, 'suppliers');

  const hasStoreId = isValidStoreId(storeId);

  const saveProduct = async (itemData) => {
    if (!hasStoreId) return;
    await saveProductMasterItem(storeId, itemData);
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

  return {
    products: productsState.items,
    productCategories: categoriesState.items,
    productCategoryGroups: categoryGroupsState.items,
    brands: brandsState.items,
    suppliers: suppliersState.items,
    loading:
      productsState.loading ||
      categoriesState.loading ||
      categoryGroupsState.loading ||
      brandsState.loading ||
      suppliersState.loading,
    saveProduct,
    deleteProduct,
    saveCategory,
    deleteCategory,
    saveCategoryGroup,
    deleteCategoryGroup,
    saveBrand,
    deleteBrand,
    saveSupplier: saveSupplierData,
    deleteSupplier
  };
};
