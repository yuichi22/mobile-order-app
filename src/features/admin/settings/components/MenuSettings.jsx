import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChefHat,
  ChevronDown,
  Clock,
  Edit,
  Filter,
  GripVertical,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  List as ListIcon,
  ListPlus,
  Plus,
  Save,
  Search,
  StretchHorizontal,
  Trash2,
  Utensils,
  X
} from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { useCategoryData, usePeriodData } from '../../../store/hooks';
import { ALLERGEN_OPTIONS, getAllergenLabel } from '../../../../shared/constants/menuMetadata';
import ColorPicker from '../../../../shared/components/inputs/ColorPicker';

const PreviewImage = ({
  src,
  alt,
  isSoldOut,
  labelText,
  labelColor,
  className
}) => (
  <div className={`relative overflow-hidden bg-gray-100 ${className}`}>
    {src ? (
      <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-gray-300">
        <Utensils size={24} strokeWidth={1.5} />
      </div>
    )}

    {labelText && (
      <div className="absolute left-3 top-3 z-20">
        <span
          className="inline-flex max-w-[160px] items-center rounded-full px-3 py-1 text-[10px] font-black tracking-[0.08em] text-white shadow-lg ring-1 ring-white/40"
          style={{ backgroundColor: labelColor || '#F97316' }}
        >
          {labelText}
        </span>
      </div>
    )}

    {isSoldOut && (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
        <span className="bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-red-600">
          SOLD OUT
        </span>
      </div>
    )}
  </div>
);

const PreviewOrderButton = ({ size = 'md', disabled = false }) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12'
  };

  return (
    <div
      className={`${sizeClasses[size]} flex items-center justify-center rounded-full shadow-lg ${
        disabled ? 'bg-gray-100 text-gray-300 shadow-none' : 'bg-orange-500 text-white shadow-orange-200'
      }`}
    >
      <Plus size={size === 'sm' ? 16 : 24} strokeWidth={3} />
    </div>
  );
};

const buildMenuMetaChips = (item) => {
  const chips = [];

  if (Number(item.orderLimitPerOrder) > 0) {
    chips.push({ key: 'order-limit', label: `1回 ${Number(item.orderLimitPerOrder)}点まで`, tone: 'orange' });
  }

  if (Number(item.limitedQuantity) > 0) {
    const remainingQuantity = Number.isFinite(Number(item.remainingQuantity))
      ? Number(item.remainingQuantity)
      : Number(item.limitedQuantity);

    chips.push({
      key: 'limited-quantity',
      label: `本日残り ${Math.max(remainingQuantity, 0)}点`,
      tone: remainingQuantity <= 0 ? 'rose' : 'orange'
    });
  }

  if (item.allowsTakeout === false) {
    chips.push({ key: 'takeout', label: '店内のみ', tone: 'slate' });
  }

  (item.allergens || []).forEach((allergenId) => {
    chips.push({ key: `allergen-${allergenId}`, label: getAllergenLabel(allergenId), tone: 'amber' });
  });

  return chips;
};

const toneClasses = {
  orange: 'bg-orange-50 text-orange-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-600'
};

const DEFAULT_PRESET_COLORS = [
  { id: 'blue', value: '#3b82f6' },
  { id: 'red', value: '#ef4444' },
  { id: 'green', value: '#22c55e' },
  { id: 'yellow', value: '#facc15' },
  { id: 'purple', value: '#a855f7' },
  { id: 'pink', value: '#ec4899' },
  { id: 'orange', value: '#f97316' },
  { id: 'gray', value: '#64748b' },
  { id: 'black', value: '#1f2937' }
];

const MetaChipList = ({ item, compact = false }) => {
  const chips = buildMenuMetaChips(item);

  if (chips.length === 0) {
    return <span className="text-xs font-bold text-gray-300">設定なし</span>;
  }

  return (
    <div className={`flex flex-wrap ${compact ? 'gap-1.5' : 'gap-2'}`}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black ${toneClasses[chip.tone]}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
};

const PreviewMeta = ({ item }) => (
  <div className="mt-3">
    <MetaChipList item={item} />
  </div>
);

const createBlankItem = (categoryId, kitchenId, periodIds) => ({
  name: '',
  price: '',
  category: categoryId,
  kitchenIds: kitchenId ? [kitchenId] : [],
  cookingCategoryIds: [],
  description: '',
  image: '',
  photoLabelText: '',
  photoLabelColor: '#F97316',
  periods: periodIds,
  isSoldOut: false,
  allergens: [],
  orderLimitPerOrder: null,
  limitedQuantity: null,
  allowsTakeout: true,
  optionGroups: [],
  crossSellPrice: null,
  crossSellPriceLabelText: 'セット価格'
});

const MenuSettings = ({
  menuItems = [],
  kitchens = [{ id: 'k1', name: 'メインキッチン', isDefault: true }],
  cookingCategories = [],
  loading,
  onSave,
  onDelete,
  storeId,
  onSaved
}) => {
  const { categories } = useCategoryData(storeId);
  const { periods } = usePeriodData(storeId);

  const [editingItem, setEditingItem] = useState(null);
  const [editingOptionGroups, setEditingOptionGroups] = useState([]);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingMenu, setDeletingMenu] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [stockInputTarget, setStockInputTarget] = useState(null);
  const [stockInputValue, setStockInputValue] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [isSortMode, setIsSortMode] = useState(false);
  const [sortDraftItems, setSortDraftItems] = useState([]);
  const [draggingItemId, setDraggingItemId] = useState(null);
  const [filters, setFilters] = useState({
    categories: [],
    periods: [],
    kitchens: [],
    takeout: 'all',
    allergens: []
  });

  const defaultKitchenId = kitchens.find((kitchen) => kitchen.isDefault)?.id || kitchens[0]?.id || '';
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category])),
    [categories]
  );
  const selectedCategory = categories.find((category) => category.id === editingItem?.category);
  const displayLayout = selectedCategory?.layoutType || 'grid';
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.categories.length > 0) count += 1;
    if (filters.periods.length > 0) count += 1;
    if (filters.kitchens.length > 0) count += 1;
    if (filters.takeout !== 'all') count += 1;
    if (filters.allergens.length > 0) count += 1;
    return count;
  }, [filters]);

  const isSingleCategorySortReady =
    filters.categories.length === 1 &&
    filters.periods.length === 0 &&
    filters.kitchens.length === 0 &&
    filters.takeout === 'all' &&
    filters.allergens.length === 0 &&
    keyword.trim() === '';

  const activeSortCategoryId = isSingleCategorySortReady
    ? filters.categories[0]
    : null;

  const activeSortCategoryName = activeSortCategoryId
    ? categoryById[activeSortCategoryId]?.name || '選択中カテゴリ'
    : '';

  const filteredMenuItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return menuItems
      .filter((item) => {
        const matchesKeyword = !normalizedKeyword || [item.name, item.description, categoryById[item.category]?.name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedKeyword));

        const itemKitchenIds = item.kitchenIds || (item.kitchenId ? [item.kitchenId] : []);
        const itemPeriods = item.periods || [];
        const itemAllergens = item.allergens || [];
        const matchesCategory = filters.categories.length === 0 || filters.categories.includes(item.category);
        const matchesPeriod = filters.periods.length === 0 || itemPeriods.some((periodId) => filters.periods.includes(periodId));
        const matchesKitchen = filters.kitchens.length === 0 || itemKitchenIds.some((kitchenId) => filters.kitchens.includes(kitchenId));
        const matchesTakeout = filters.takeout === 'all'
          || (filters.takeout === 'allowed' && item.allowsTakeout !== false)
          || (filters.takeout === 'disabled' && item.allowsTakeout === false);
        const matchesAllergen = filters.allergens.length === 0 || filters.allergens.every((allergenId) => itemAllergens.includes(allergenId));

        return matchesKeyword && matchesCategory && matchesPeriod && matchesKitchen && matchesTakeout && matchesAllergen;
      })
      .sort((left, right) => {
        const leftOrder = Number(left.sortOrder ?? 999999);
        const rightOrder = Number(right.sortOrder ?? 999999);

        if (leftOrder !== rightOrder) return leftOrder - rightOrder;

        const leftCreated = left.createdAt?.toMillis?.() || 0;
        const rightCreated = right.createdAt?.toMillis?.() || 0;

        if (leftCreated !== rightCreated) return leftCreated - rightCreated;

        return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
      });
  }, [categoryById, filters, keyword, menuItems]);

  const visibleMenuItems = useMemo(() => {
    return filteredMenuItems.slice(0, visibleLimit);
  }, [filteredMenuItems, visibleLimit]);

  const displayMenuItems = isSingleCategorySortReady && sortDraftItems.length > 0
    ? sortDraftItems
    : visibleMenuItems;

  useEffect(() => {
    if (isSingleCategorySortReady) {
      setSortDraftItems(visibleMenuItems);
      return;
    }

    setSortDraftItems([]);
    setIsSortMode(false);
  }, [isSingleCategorySortReady, activeSortCategoryId, visibleMenuItems]);

  const hasMoreMenuItems = filteredMenuItems.length > visibleMenuItems.length;

  useEffect(() => {
    setVisibleLimit(20);
    setIsSortMode(false);
    setSortDraftItems([]);
    setDraggingItemId(null);
  }, [keyword, filters]);


  const toggleFilterValue = (field, value) => {
    setFilters((current) => {
      const nextValues = current[field].includes(value)
        ? current[field].filter((currentValue) => currentValue !== value)
        : [...current[field], value];

      return {
        ...current,
        [field]: nextValues
      };
    });
  };

  const resetFilters = () => {
    setFilters({
      categories: [],
      periods: [],
      kitchens: [],
      takeout: 'all',
      allergens: []
    });
  };

  const startCreating = () => {
    setEditingItem(
      createBlankItem(categories[0]?.id || '', defaultKitchenId, periods.map((period) => period.id))
    );
    setEditingOptionGroups([]);
    setImagePreview('');
    setIsCategoryOpen(false);

    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const startEditing = (item) => {
    setEditingItem({
      ...item,
      kitchenIds: item.kitchenIds || (item.kitchenId ? [item.kitchenId] : defaultKitchenId ? [defaultKitchenId] : []),
      cookingCategoryIds: Array.isArray(item.cookingCategoryIds) ? item.cookingCategoryIds : [],
      allergens: item.allergens || [],
      orderLimitPerOrder: item.orderLimitPerOrder ?? null,
      limitedQuantity: item.limitedQuantity ?? null,
      allowsTakeout: item.allowsTakeout !== false,
      photoLabelText: item.photoLabelText || '',
      photoLabelColor: item.photoLabelColor || '#F97316',
      priceLabelText: item.priceLabelText || '',
      crossSellPrice: item.crossSellPrice ?? null,
      crossSellPriceLabelText: item.crossSellPriceLabelText || 'セット価格',
      optionGroups: Array.isArray(item.optionGroups) ? item.optionGroups : []
    });

    setEditingOptionGroups(
      Array.isArray(item.optionGroups)
        ? item.optionGroups
            .map((group, groupIndex) => ({
              id: group.id || `group_${Date.now()}_${groupIndex}`,
              name: group.name || '',
              selectionType: group.selectionType || 'single',
              required: group.required === true,
              minSelect: Number(group.minSelect ?? 0),
              maxSelect: Number(group.maxSelect ?? (group.selectionType === 'multiple' ? 99 : 1)),
              sortOrder: Number(group.sortOrder ?? ((groupIndex + 1) * 1000)),
              options: Array.isArray(group.options)
                ? group.options
                    .map((option, optionIndex) => ({
                      id: option.id || `opt_${Date.now()}_${groupIndex}_${optionIndex}`,
                      name: option.name || '',
                      price: option.price ?? '',
                      sortOrder: Number(option.sortOrder ?? ((optionIndex + 1) * 1000))
                    }))
                    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
                : []
            }))
            .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
        : []
    );

    setImagePreview(item.image || '');
    setIsCategoryOpen(false);

    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const closeEditor = () => {
    setEditingItem(null);
    setEditingOptionGroups([]);
    setImagePreview('');
    setIsCategoryOpen(false);
  };

  const toggleArrayValue = (field, value, keepOne = false) => {
    const current = editingItem[field] || [];
    const next = current.includes(value)
      ? current.filter((currentValue) => currentValue !== value)
      : [...current, value];

    if (keepOne && next.length === 0) return;

    setEditingItem({ ...editingItem, [field]: next });
  };

  const addOptionGroup = () => {
    setEditingOptionGroups((previous) => [
      ...previous,
      {
        id: `group_${Date.now()}`,
        name: '',
        selectionType: 'single',
        required: false,
        minSelect: 0,
        maxSelect: 1,
        sortOrder: (previous.length + 1) * 1000,
        options: []
      }
    ]);
  };

  const addGroupOption = (groupIndex) => {
    setEditingOptionGroups((previous) => previous.map((group, index) => {
      if (index !== groupIndex) return group;

      return {
        ...group,
        options: [
          ...(group.options || []),
          {
            id: `opt_${Date.now()}_${groupIndex}`,
            name: '',
            price: '',
            sortOrder: ((group.options || []).length + 1) * 1000
          }
        ]
      };
    }));
  };

  const updateOptionGroup = (groupIndex, field, value) => {
    setEditingOptionGroups((previous) => previous.map((group, index) => (
      index === groupIndex
        ? { ...group, [field]: value }
        : group
    )));
  };

  const updateGroupOption = (groupIndex, optionIndex, field, value) => {
    setEditingOptionGroups((previous) => previous.map((group, index) => {
      if (index !== groupIndex) return group;

      return {
        ...group,
        options: (group.options || []).map((option, currentOptionIndex) => (
          currentOptionIndex === optionIndex
            ? { ...option, [field]: value }
            : option
        ))
      };
    }));
  };

  const removeOptionGroup = (groupIndex) => {
    setEditingOptionGroups((previous) => previous.filter((_, index) => index !== groupIndex));
  };

  const removeGroupOption = (groupIndex, optionIndex) => {
    setEditingOptionGroups((previous) => previous.map((group, index) => {
      if (index !== groupIndex) return group;

      return {
        ...group,
        options: (group.options || []).filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex)
      };
    }));
  };

  const moveOptionGroup = (groupIndex, direction) => {
    setEditingOptionGroups((previous) => {
      const nextIndex = groupIndex + direction;
      if (nextIndex < 0 || nextIndex >= previous.length) return previous;

      const next = [...previous];
      const [target] = next.splice(groupIndex, 1);
      next.splice(nextIndex, 0, target);

      return next.map((group, index) => ({
        ...group,
        sortOrder: (index + 1) * 1000
      }));
    });
  };

  const moveGroupOption = (groupIndex, optionIndex, direction) => {
    setEditingOptionGroups((previous) => previous.map((group, index) => {
      if (index !== groupIndex) return group;

      const options = [...(group.options || [])];
      const nextIndex = optionIndex + direction;

      if (nextIndex < 0 || nextIndex >= options.length) return group;

      const [target] = options.splice(optionIndex, 1);
      options.splice(nextIndex, 0, target);

      return {
        ...group,
        options: options.map((option, currentIndex) => ({
          ...option,
          sortOrder: (currentIndex + 1) * 1000
        }))
      };
    }));
  };


  const handleSave = async (event) => {
    event.preventDefault();
    setIsProcessing(true);

    try {
      const normalizedLimit = Number(editingItem.orderLimitPerOrder);
      const normalizedLimitedQuantity = Number(editingItem.limitedQuantity);
      const normalizedCrossSellPrice = Number(editingItem.crossSellPrice);

      await onSave({
        ...editingItem,

        optionGroups: editingOptionGroups
          .map((group, groupIndex) => ({
            id: group.id || `group_${Date.now()}_${groupIndex}`,
            name: String(group.name || '').trim(),
            selectionType: group.selectionType || 'single',
            required: group.required === true,
            minSelect: Number(group.minSelect ?? (group.required ? 1 : 0)),
            maxSelect: Number(group.maxSelect ?? (group.selectionType === 'single' ? 1 : 99)),
            sortOrder: Number(group.sortOrder ?? ((groupIndex + 1) * 1000)),
            options: Array.isArray(group.options)
              ? group.options
                  .map((option, optionIndex) => ({
                    id: option.id || `opt_${Date.now()}_${groupIndex}_${optionIndex}`,
                    name: String(option.name || '').trim(),
                    price: Number(option.price || 0),
                    sortOrder: Number(option.sortOrder ?? ((optionIndex + 1) * 1000))
                  }))
                  .filter((option) => option.name)
              : []
          }))
          .filter((group) => group.name && group.options.length > 0),

        options: [],

        cookingCategoryIds: Array.isArray(editingItem.cookingCategoryIds)
        ? editingItem.cookingCategoryIds
        : [],

        allergens: editingItem.allergens || [],
        orderLimitPerOrder: normalizedLimit > 0 ? normalizedLimit : null,
        limitedQuantity: normalizedLimitedQuantity > 0 ? normalizedLimitedQuantity : null,
        allowsTakeout: editingItem.allowsTakeout !== false,
        photoLabelText: String(editingItem.photoLabelText || '').trim(),
        photoLabelColor: editingItem.photoLabelColor || '#F97316',
        priceLabelText: String(editingItem.priceLabelText || '').trim(),
        crossSellPrice:
          editingItem.crossSellPrice === '' ||
          editingItem.crossSellPrice === null ||
          editingItem.crossSellPrice === undefined
            ? null
            : Math.max(0, normalizedCrossSellPrice),
        crossSellPriceLabelText: String(editingItem.crossSellPriceLabelText || 'セット価格').trim()
      });

      onSaved?.();
      closeEditor();
    } finally {
      setIsProcessing(false);
    }
  };
  const confirmDelete = async () => {
    if (!deletingMenu) return;

    setIsProcessing(true);
    try {
      await onDelete(deletingMenu.id);
      onSaved?.();
      setDeletingMenu(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const updateMenuStockState = async (item, nextStockState) => {
  if (!item?.id || isProcessing) return;

  setIsProcessing(true);

  try {
    await onSave({
      ...item,
      ...nextStockState
    });
    onSaved?.();
  } finally {
    setIsProcessing(false);
  }
};

const handleToggleSoldOut = async (event, item) => {
  event.stopPropagation();

  if (!item?.id || isProcessing) return;

  const nextIsSoldOut = !item.isSoldOut;

  // 売り切れ → 販売再開
  // 残数設定を解除して、通常販売に戻す。
  if (!nextIsSoldOut) {
    await updateMenuStockState(item, {
      isSoldOut: false,
      limitedQuantity: null,
      soldQuantity: 0,
      remainingQuantity: null,
      dailySoldCount: 0,
      dailySoldDate: null
    });

    return;
  }

  // 販売中 → 売り切れ
  await updateMenuStockState(item, {
    isSoldOut: true,
    remainingQuantity: 0
  });
};

const handleSetLimitedQuantity = (event, item) => {
  event.stopPropagation();

  const currentRemaining = Number.isFinite(Number(item.remainingQuantity))
    ? String(Number(item.remainingQuantity))
    : Number(item.limitedQuantity) > 0
      ? String(Number(item.limitedQuantity))
      : '';

  setStockInputTarget(item);
  setStockInputValue(currentRemaining);
};

const closeStockInputModal = () => {
  setStockInputTarget(null);
  setStockInputValue('');
};

const appendStockInputDigit = (digit) => {
  setStockInputValue((current) => {
    const nextValue = `${current}${digit}`.replace(/^0+(?=\d)/, '');

    if (nextValue.length > 3) return current;

    return nextValue;
  });
};

const deleteStockInputDigit = () => {
  setStockInputValue((current) => current.slice(0, -1));
};

const confirmStockInput = async () => {
  if (!stockInputTarget || isProcessing) return;

  const nextQuantity = Number(stockInputValue);

  if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
    return;
  }

  await updateMenuStockState(stockInputTarget, {
    limitedQuantity: nextQuantity,
    soldQuantity: 0,
    remainingQuantity: nextQuantity,
    isSoldOut: nextQuantity <= 0
  });

  closeStockInputModal();
};

const handleClearLimitedQuantity = async (event, item) => {
  event.stopPropagation();

  const ok = window.confirm(`${item.name || '商品'} の残数設定を解除しますか？`);

  if (!ok) return;

  await updateMenuStockState(item, {
    limitedQuantity: null,
    soldQuantity: 0,
    remainingQuantity: null,
    isSoldOut: false
  });
};

  const startSortMode = () => {
    if (!isSingleCategorySortReady) return;

    setSortDraftItems(filteredMenuItems.map((item) => ({ ...item })));
    setIsSortMode(true);
  };

  const cancelSortMode = () => {
    setIsSortMode(false);
    setSortDraftItems([]);
    setDraggingItemId(null);
  };

  const moveMenuItemImmediately = async (fromIndex, direction) => {
    const currentItems = displayMenuItems;
    const toIndex = fromIndex + direction;

    if (!isSingleCategorySortReady || isProcessing) return;
    if (toIndex < 0 || toIndex >= currentItems.length) return;

    const nextItems = [...currentItems];
    const [movedItem] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, movedItem);

    setSortDraftItems(nextItems);
    setIsProcessing(true);

    try {
      await Promise.all(
        nextItems.map((item, index) => (
          onSave({
            ...item,
            sortOrder: (index + 1) * 1000
          })
        ))
      );

      onSaved?.();
    } finally {
      setIsProcessing(false);
    }
  };

  const moveSortItem = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;

    setSortDraftItems((current) => {
      if (toIndex >= current.length) return current;

      const next = [...current];
      const [movedItem] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, movedItem);

      return next;
    });
  };

  const handleDragStart = (event, itemId) => {
    setDraggingItemId(itemId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
  };

  const handleDragOver = (event, overItemId) => {
    event.preventDefault();

    const draggingId = draggingItemId || event.dataTransfer.getData('text/plain');
    if (!draggingId || draggingId === overItemId) return;

    const fromIndex = sortDraftItems.findIndex((item) => String(item.id) === String(draggingId));
    const toIndex = sortDraftItems.findIndex((item) => String(item.id) === String(overItemId));

    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    moveSortItem(fromIndex, toIndex);
  };

  const handleDragEnd = () => {
    setDraggingItemId(null);
  };

  const saveSortOrder = async () => {
    if (!isSortMode || sortDraftItems.length === 0 || isProcessing) return;

    setIsProcessing(true);

    try {
      await Promise.all(
        sortDraftItems.map((item, index) => (
          onSave({
            ...item,
            sortOrder: (index + 1) * 1000
          })
        ))
      );

      onSaved?.();
      cancelSortMode();
    } finally {
      setIsProcessing(false);
    }
  };


  if (loading) {
    return (
      <div className="p-16 text-center text-orange-500">
        <LoadingSpinner size={32} className="mx-auto" />
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in duration-300 pb-20">
      {editingItem ? (
        <div className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl animate-in zoom-in-95 duration-300">
          <div className="flex h-24 items-center justify-between border-b bg-orange-500 px-8 text-white">
            <div className="flex items-center gap-5">
              <div className="rounded-2xl bg-white/20 p-3 shadow-inner">
                <Utensils size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight">
                  {editingItem.id ? 'メニューの編集' : '新しいメニューを追加'}
                </h3>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-white/60">
                  Configuration
                </p>
              </div>
            </div>
  <button
  type="button"
  onClick={closeEditor}
  className="flex h-11 items-center gap-2 rounded-full px-4 text-sm font-black text-white/90 transition-all hover:bg-white/20 active:scale-95"
  aria-label="閉じる"
>
  <span>閉じる</span>
  <X size={20} />
</button>
          </div>

          <form onSubmit={handleSave} className="bg-gray-50/30 p-8">
            <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-10 xl:grid-cols-12">
              <div className="flex flex-col gap-8 xl:col-span-7">
                <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-8 flex items-center gap-2 text-orange-500">
                    <Info size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">基本設定</span>
                  </div>
                  <div className="mb-8">
                    <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">商品名</label>
                    <input
                      value={editingItem.name}
                      onChange={(event) => setEditingItem({ ...editingItem, name: event.target.value })}
                      required
                      className="h-16 w-full rounded-2xl border-2 border-gray-100 px-6 text-2xl font-bold text-gray-800 outline-none transition-all focus:border-orange-500"
                      placeholder="例：厚切りトースト"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">価格</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={editingItem.price}
                          onChange={(event) => setEditingItem({ ...editingItem, price: Number(event.target.value) })}
                          required
                          className="h-16 w-full rounded-2xl border-2 border-gray-100 pl-14 pr-6 text-2xl font-black text-gray-800 outline-none transition-all focus:border-orange-500"
                        />
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-300">¥</span>
                      </div>
                    </div>
                    <div className="relative">
                      <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">カテゴリ</label>
                      <button
                        type="button"
                        onClick={() => setIsCategoryOpen(!isCategoryOpen)}
                        className="flex h-16 w-full items-center justify-between rounded-2xl border-2 border-gray-100 bg-white px-6"
                      >
                        <span className="flex items-center gap-3 truncate text-lg font-bold text-gray-700">
                          <div
                            className="h-3 w-3 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: selectedCategory?.hex || '#ccc' }}
                          />
                          {selectedCategory?.name || '未設定'}
                        </span>
                        <ChevronDown
                          size={20}
                          className={`text-gray-400 transition-transform ${isCategoryOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {isCategoryOpen && (
                        <div className="absolute left-0 right-0 top-full z-20 mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
                          {categories.map((category) => (
                            <button
                              key={category.id}
                              type="button"
                              onClick={() => {
                                setEditingItem({ ...editingItem, category: category.id });
                                setIsCategoryOpen(false);
                              }}
                              className={`flex h-14 w-full items-center gap-3 px-6 text-left font-bold ${
                                editingItem.category === category.id
                                  ? 'bg-orange-50 text-orange-700'
                                  : 'text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              <div
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: category.hex || '#ccc' }}
                              />
                              {category.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border-2 border-gray-100 p-6 md:col-span-2">
  <div className="mb-4">
    <div className="text-base font-black text-gray-800">
      クロスセル・セット価格
    </div>
    <p className="mt-1 text-sm text-gray-400">
      おすすめ表示中だけ、通常価格の代わりに使う価格です。
    </p>
  </div>

  <div className="grid gap-4 md:grid-cols-2">
    <div>
      <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">
        価格ラベル
      </label>
      <input
        value={editingItem.crossSellPriceLabelText || ''}
        onChange={(event) => setEditingItem({
          ...editingItem,
          crossSellPriceLabelText: event.target.value
        })}
        className="h-14 w-full rounded-2xl border-2 border-gray-100 px-5 text-sm font-bold text-gray-700 outline-none focus:border-orange-500"
        placeholder="例：セット価格"
      />
    </div>

    <div>
      <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">
        セット価格
      </label>
      <div className="relative">
        <input
          type="number"
          min="0"
          value={editingItem.crossSellPrice ?? ''}
          onChange={(event) => setEditingItem({
            ...editingItem,
            crossSellPrice: event.target.value
          })}
          className="h-14 w-full rounded-2xl border-2 border-gray-100 pl-11 pr-5 text-lg font-black text-gray-800 outline-none focus:border-orange-500"
          placeholder="未設定"
        />
        <span className="absolute left-5 top-1/2 -translate-y-1/2 text-lg font-bold text-gray-300">
          ¥
        </span>
      </div>
    </div>
  </div>
</div>


                <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-6 flex items-center gap-2 text-orange-500">
                    <Clock size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">提供時間帯</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {periods.map((period) => (
                      <button
                        key={period.id}
                        type="button"
                        onClick={() => toggleArrayValue('periods', period.id)}
                        className={`flex min-h-[60px] min-w-[120px] flex-col items-center justify-center rounded-2xl border-2 px-5 text-sm font-black text-center transition-all ${
                          editingItem.periods?.includes(period.id)
                            ? 'scale-105 border-orange-500 bg-orange-500 text-white shadow-lg'
                            : 'border-gray-100 bg-white text-gray-400 hover:border-orange-200'
                        }`}
                      >
                        <span className="leading-tight">{period.name}</span>
                        <span className={`mt-1 text-[12px] font-bold ${editingItem.periods?.includes(period.id) ? 'text-orange-100' : 'text-gray-300'}`}>
                          {period.start}-{period.end}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-6 flex items-center gap-2 text-orange-500">
                    <ChefHat size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">担当キッチン</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {kitchens.map((kitchen) => (
                      <button
                        key={kitchen.id}
                        type="button"
                        onClick={() => toggleArrayValue('kitchenIds', kitchen.id, true)}
                        className={`flex min-h-[60px] min-w-[120px] items-center justify-center rounded-2xl border-2 px-5 text-sm font-black transition-all ${
                          editingItem.kitchenIds?.includes(kitchen.id)
                            ? 'scale-105 border-orange-500 bg-orange-500 text-white shadow-lg'
                            : 'border-gray-100 bg-white text-gray-400 hover:border-orange-200'
                        }`}
                      >
                        {kitchen.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-6 flex items-center gap-2 text-orange-500">
                    <ListPlus size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">
                      調理分類
                    </span>
                  </div>

                  {cookingCategories.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm font-bold text-gray-400">
                      調理分類がまだ設定されていません
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {cookingCategories.map((cookingCategory) => {
                        const selected = editingItem.cookingCategoryIds?.includes(cookingCategory.id);

                        return (
                          <button
                            key={cookingCategory.id}
                            type="button"
                            onClick={() => toggleArrayValue('cookingCategoryIds', cookingCategory.id)}
                            className={`flex min-h-[52px] min-w-[120px] items-center justify-center rounded-2xl border-2 px-5 text-sm font-black transition-all ${
                              selected
                                ? 'scale-105 border-slate-900 bg-slate-900 text-white shadow-lg'
                                : 'border-gray-100 bg-white text-gray-400 hover:border-slate-300 hover:text-slate-700'
                            }`}
                          >
                            {cookingCategory.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <p className="mt-4 text-xs font-bold leading-relaxed text-gray-400">
                    キッチン画面の集計に使います。複数選択できます。
                  </p>
                </div>

                <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-6 flex items-center gap-2 text-orange-500">
                    <Check size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">注文・提供設定</span>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-3xl border-2 border-gray-100 p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-base font-black text-gray-800">テイクアウト可否</div>
                          <p className="mt-1 text-sm text-gray-400">店内のみの設定は会計時に持ち帰りへ切り替えられません。</p>
                        </div>
                        <label className="relative inline-flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            checked={editingItem.allowsTakeout !== false}
                            onChange={(event) => setEditingItem({ ...editingItem, allowsTakeout: event.target.checked })}
                            className="peer sr-only"
                          />
                          <div className="h-8 w-14 rounded-full bg-gray-200 peer-checked:bg-orange-500" />
                          <div className="absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform peer-checked:translate-x-6" />
                        </label>
                      </div>
                    </div>
                    <div className="grid gap-6 md:grid-cols-2 md:col-span-2">
                      <div className="rounded-3xl border-2 border-gray-100 p-6">
                        <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">1回の注文上限</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="1"
                            value={editingItem.orderLimitPerOrder ?? ''}
                            onChange={(event) => setEditingItem({ ...editingItem, orderLimitPerOrder: event.target.value })}
                            className="h-14 w-full rounded-2xl border-2 border-gray-100 px-5 text-lg font-black text-gray-800 outline-none focus:border-orange-500"
                            placeholder="未設定"
                          />
                          <span className="whitespace-nowrap text-sm font-bold text-gray-400">点まで</span>
                        </div>
                        <p className="mt-2 text-sm text-gray-400">未設定なら上限なしで注文できます。</p>
                      </div>
                      <div className="rounded-3xl border-2 border-gray-100 p-6">
                        <label className="mb-2 block text-[11px] font-black uppercase text-gray-400">本日の限定数</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="1"
                            value={editingItem.limitedQuantity ?? ''}
                            onChange={(event) => setEditingItem({ ...editingItem, limitedQuantity: event.target.value })}
                            className="h-14 w-full rounded-2xl border-2 border-gray-100 px-5 text-lg font-black text-gray-800 outline-none focus:border-orange-500"
                            placeholder="未設定"
                          />
                          <span className="whitespace-nowrap text-sm font-bold text-gray-400">点まで</span>
                        </div>
                        <p className="mt-2 text-sm text-gray-400">本日の販売上限です。上限到達で自動的に売り切れ表示になります。</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-6 flex items-center gap-2 text-orange-500">
                    <AlertTriangle size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">アレルゲン</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {ALLERGEN_OPTIONS.map((allergen) => (
                      <button
                        key={allergen.id}
                        type="button"
                        onClick={() => toggleArrayValue('allergens', allergen.id)}
                        className={`rounded-2xl border-2 px-4 py-3 text-sm font-black transition-all ${
                          editingItem.allergens?.includes(allergen.id)
                            ? 'scale-105 border-amber-400 bg-amber-50 text-amber-700 shadow-lg shadow-amber-100'
                            : 'border-gray-100 bg-white text-gray-400 hover:border-amber-200'
                        }`}
                      >
                        {allergen.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex min-h-[320px] flex-col rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-8 flex items-center gap-2 text-orange-500">
                    <ImageIcon size={18} strokeWidth={3} />
                    <span className="text-xs font-black uppercase tracking-widest">画像・説明</span>
                  </div>
                  <div className="mb-8">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">商品画像URL</label>
                    <input
                      value={editingItem.image}
                      onChange={(event) => {
                        setEditingItem({ ...editingItem, image: event.target.value });
                        setImagePreview(event.target.value);
                      }}
                      className="h-14 w-full rounded-2xl border-2 border-gray-100 px-6 font-mono text-sm text-gray-500 outline-none focus:border-orange-500"
                      placeholder="https://..."
                    />
                  </div>
                    <div className="mb-8 grid gap-6 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                          写真ラベル
                        </label>
                        <input
                          value={editingItem.photoLabelText || ''}
                          onChange={(event) => setEditingItem({
                            ...editingItem,
                            photoLabelText: event.target.value
                          })}
                          className="h-14 w-full rounded-2xl border-2 border-gray-100 px-6 text-sm font-bold text-gray-700 outline-none focus:border-orange-500"
                          placeholder="例：期間限定"
                        />
                        <p className="mt-2 text-xs font-bold text-gray-300">
                          写真の左上に表示されます。未入力なら表示されません。
                        </p>
                      </div>

                      <div>
                        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                          ラベル色
                        </label>
                        <div className="rounded-2xl border-2 border-gray-100 bg-white p-4">
                          <ColorPicker
                            selectedColor={editingItem.photoLabelColor || '#F97316'}
                            onChange={(hex) => setEditingItem({
                              ...editingItem,
                              photoLabelColor: hex
                            })}
                            presetColors={DEFAULT_PRESET_COLORS}
                          />
                        </div>
                      </div>
                    </div>


                  <textarea
                    value={editingItem.description}
                    onChange={(event) => setEditingItem({ ...editingItem, description: event.target.value })}
                    className="min-h-[160px] w-full flex-grow resize-none rounded-3xl border-2 border-gray-100 p-6 text-lg font-medium text-gray-700 outline-none focus:border-orange-500"
                    placeholder="商品のこだわりやおすすめポイントを入力してください"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-8 xl:col-span-5">
                <div className="rounded-[2.5rem] border-4 border-gray-200 bg-gray-100 p-6 shadow-inner">
                  <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-sm">
                      {displayLayout === 'grid' && <LayoutGrid size={14} className="text-orange-500" />}
                      {displayLayout === 'wide' && <StretchHorizontal size={14} className="text-orange-500" />}
                      {displayLayout === 'list' && <ListIcon size={14} className="text-orange-500" />}
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
                        {displayLayout} preview
                      </span>
                    </div>
                  </div>

                  <div className="min-h-[220px]">
                    {displayLayout === 'wide' && (
                      <div className={`overflow-hidden rounded-[40px] border border-gray-100 bg-white shadow-sm ${editingItem.isSoldOut ? 'grayscale opacity-70' : ''}`}>
                        <PreviewImage
                          src={imagePreview}
                          alt={editingItem.name}
                          isSoldOut={editingItem.isSoldOut}
                          labelText={editingItem.photoLabelText}
                          labelColor={editingItem.photoLabelColor}
                          className="h-48 w-full"
                        />
                        <div className="relative flex items-end justify-between p-5">
                          <div className="absolute -top-6 right-5 rounded-full border border-gray-50 bg-white px-4 py-1 shadow-md">
                            <span className="text-xl font-black text-gray-900">¥{(editingItem.price || 0).toLocaleString()}</span>
                          </div>
                          <div className="grow pr-4">
                            <h3 className="mb-1 text-lg font-black text-gray-800">{editingItem.name || 'メニュー名'}</h3>
                            <p className="line-clamp-2 text-xs text-gray-400">{editingItem.description || '商品の説明がここに表示されます。'}</p>
                            <PreviewMeta item={editingItem} />
                          </div>
                          <PreviewOrderButton size="lg" disabled={editingItem.isSoldOut} />
                        </div>
                      </div>
                    )}

                    {displayLayout === 'grid' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className={`flex h-full flex-col overflow-hidden rounded-[30px] border border-gray-100 bg-white shadow-sm ${editingItem.isSoldOut ? 'opacity-60' : ''}`}>
                          <PreviewImage
                            src={imagePreview}
                            alt={editingItem.name}
                            isSoldOut={editingItem.isSoldOut}
                            labelText={editingItem.photoLabelText}
                            labelColor={editingItem.photoLabelColor}
                            className="aspect-square w-full"
                          />
                          <div className="flex flex-grow flex-col p-3">
                            <h3 className="mb-1 line-clamp-2 text-base font-black text-gray-800">{editingItem.name || 'メニュー名'}</h3>
                            <PreviewMeta item={editingItem} />
                            <div className="mt-auto flex items-end justify-between">
                              <span className="text-xl font-bold text-gray-900">¥{(editingItem.price || 0).toLocaleString()}</span>
                              <PreviewOrderButton size="md" disabled={editingItem.isSoldOut} />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/40 opacity-40">
                          <Utensils size={20} className="text-gray-300" />
                        </div>
                      </div>
                    )}

                    {displayLayout === 'list' && (
                      <div className={`flex items-center gap-4 rounded-3xl border border-gray-100 bg-white px-2 py-2 shadow-sm ${editingItem.isSoldOut ? 'opacity-60' : ''}`}>
                        <div className="flex min-w-0 flex-grow flex-col pl-2">
                          <h3 className="mb-1 translate-y-[5px] truncate text-base font-bold text-gray-800">{editingItem.name || 'メニュー名'}</h3>
                          <PreviewMeta item={editingItem} />
                          <div className="mt-auto flex items-center justify-between pt-1">
                            <span className="text-xl font-bold text-gray-900">¥{(editingItem.price || 0).toLocaleString()}</span>
                            <PreviewOrderButton size="md" disabled={editingItem.isSoldOut} />
                          </div>
                        </div>
                        <PreviewImage
                          src={imagePreview}
                          alt={editingItem.name}
                          isSoldOut={editingItem.isSoldOut}
                          labelText={editingItem.photoLabelText}
                          labelColor={editingItem.photoLabelColor}
                          className="h-[108px] w-[108px] flex-shrink-0 rounded-2xl"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col rounded-[2rem] border-4 border-orange-200 bg-orange-50 p-8">
                  <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-orange-600">
                        <ListPlus size={20} />
                        追加オプション
                      </span>

                      <p className="mt-2 text-xs font-bold leading-relaxed text-orange-500/80">
                        単一選択では、先頭が初期選択になります。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={addOptionGroup}
                      className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 font-black text-white shadow-lg transition-all hover:bg-orange-600"
                    >
                      <Plus size={16} strokeWidth={3} />
                      オプショングループ追加
                    </button>
                  </div>

                  <div className="min-h-[160px] space-y-4">
                    {editingOptionGroups.length === 0 ? (
                      <div className="flex min-h-[160px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-orange-200 bg-white/60 text-center text-orange-500/80">
                        <ListPlus size={32} className="mb-2 opacity-80" />
                        <span className="text-sm font-bold">オプションはまだ設定されていません</span>
                        <span className="mt-1 text-xs font-medium">
                          例：ライス → 大盛り・普通・小盛り
                        </span>
                      </div>
                    ) : (
                      editingOptionGroups.map((group, groupIndex) => (
                        <div
                          key={group.id || groupIndex}
                          className="rounded-[1.5rem] border-2 border-orange-200 bg-white p-4 shadow-sm"
                        >
                          <div className="mb-4 flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => moveOptionGroup(groupIndex, -1)}
                                disabled={groupIndex === 0}
                                className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 text-gray-400 disabled:opacity-30"
                              >
                                ↑
                              </button>

                              <button
                                type="button"
                                onClick={() => moveOptionGroup(groupIndex, 1)}
                                disabled={groupIndex === editingOptionGroups.length - 1}
                                className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 text-gray-400 disabled:opacity-30"
                              >
                                ↓
                              </button>
                            </div>

                            <input
                              value={group.name}
                              onChange={(event) => updateOptionGroup(groupIndex, 'name', event.target.value)}
                              placeholder="例：ライス"
                              className="h-11 min-w-[180px] flex-1 rounded-xl border-2 border-gray-100 px-4 text-sm font-black text-gray-700 outline-none transition-all focus:border-orange-500"
                            />

                            <select
                              value={group.selectionType || 'single'}
                              onChange={(event) => {
                                const nextType = event.target.value;

                                setEditingOptionGroups((previous) => previous.map((targetGroup, index) => {
                                  if (index !== groupIndex) return targetGroup;

                                  return {
                                    ...targetGroup,
                                    selectionType: nextType,
                                    maxSelect: nextType === 'single' ? 1 : 99,
                                    minSelect: targetGroup.required ? 1 : 0
                                  };
                                }));
                              }}
                              className="h-11 rounded-xl border-2 border-gray-100 px-3 text-xs font-black text-gray-600 outline-none focus:border-orange-500"
                            >
                              <option value="single">単一選択</option>
                              <option value="multiple">複数選択</option>
                            </select>

                            <label className="flex h-11 items-center gap-2 rounded-xl border-2 border-gray-100 px-3 text-xs font-black text-gray-600">
                              <input
                                type="checkbox"
                                checked={group.required === true}
                                onChange={(event) => {
                                  const checked = event.target.checked;

                                  setEditingOptionGroups((previous) => previous.map((targetGroup, index) => {
                                    if (index !== groupIndex) return targetGroup;

                                    return {
                                      ...targetGroup,
                                      required: checked,
                                      minSelect: checked ? 1 : 0
                                    };
                                  }));
                                }}
                              />
                              必須
                            </label>

                            <button
                              type="button"
                              onClick={() => removeOptionGroup(groupIndex)}
                              className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
                              title="グループ削除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          <div className="space-y-2">
                            {(group.options || []).map((option, optionIndex) => (
                              <div
                                key={option.id || optionIndex}
                                className="rounded-2xl border border-gray-100 bg-gray-50 p-3"
                              >
                                <div className="flex items-center gap-2">
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => moveGroupOption(groupIndex, optionIndex, -1)}
                                      disabled={optionIndex === 0}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-400 disabled:opacity-30"
                                    >
                                      ↑
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => moveGroupOption(groupIndex, optionIndex, 1)}
                                      disabled={optionIndex === (group.options || []).length - 1}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-400 disabled:opacity-30"
                                    >
                                      ↓
                                    </button>
                                  </div>

                                  <input
                                    value={option.name}
                                    onChange={(event) => updateGroupOption(groupIndex, optionIndex, 'name', event.target.value)}
                                    placeholder="例：大盛り"
                                    className="h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 outline-none transition-all focus:border-orange-500"
                                  />

                                  <button
                                    type="button"
                                    onClick={() => removeGroupOption(groupIndex, optionIndex)}
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-orange-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                    title="選択肢削除"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>

                                <div className="mt-2 flex items-center justify-end gap-2">
                                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-300">
                                    追加価格
                                  </span>

                                  <div className="relative w-full max-w-[140px]">
                                    <input
                                      type="number"
                                      value={option.price}
                                      onChange={(event) => updateGroupOption(groupIndex, optionIndex, 'price', event.target.value)}
                                      placeholder="0"
                                      className="h-10 w-full rounded-xl border border-gray-200 bg-white pr-8 text-right text-sm font-bold outline-none transition-all focus:border-orange-500"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-orange-400">
                                      円
                                    </span>
                                  </div>
                                </div>
                              </div>                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => addGroupOption(groupIndex)}
                            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-orange-300 bg-orange-50 py-3 text-sm font-black text-orange-600 transition-colors hover:bg-orange-100"
                          >
                            <Plus size={16} strokeWidth={3} />
                            選択肢追加
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className={`flex items-center justify-between rounded-[2rem] border-2 p-6 shadow-sm ${
                  editingItem.isSoldOut ? 'border-red-100 bg-red-50' : 'border-green-100 bg-green-50'
                }`}>
                  <div className="flex items-center gap-4">
                    <div className={`rounded-2xl p-3 shadow-sm ${editingItem.isSoldOut ? 'bg-white text-red-500' : 'bg-white text-green-500'}`}>
                      <Utensils size={20} />
                    </div>
                    <span className={`text-sm font-black uppercase tracking-widest ${editingItem.isSoldOut ? 'text-red-800' : 'text-green-800'}`}>
                      売り切れ設定
                    </span>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={editingItem.isSoldOut}
                      onChange={(event) => setEditingItem({ ...editingItem, isSoldOut: event.target.checked })}
                      className="peer sr-only"
                    />
                    <div className="h-8 w-14 rounded-full bg-gray-200 peer-checked:bg-red-500" />
                    <div className="absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform peer-checked:translate-x-6" />
                  </label>
                </div>
              </div>
            </div>
            <div className="mx-auto mt-12 flex max-w-[1400px] justify-end gap-4 border-t border-gray-100 pt-10">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-xl px-10 py-4 font-bold text-gray-400 transition-colors hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={isProcessing || !editingItem.name}
                className="flex items-center gap-3 rounded-xl bg-orange-500 px-16 py-4 text-lg font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600"
              >
              {isProcessing ? <LoadingSpinner size={24} /> : <Save size={24} strokeWidth={3} />}
                保存して反映
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex min-h-24 flex-wrap items-center justify-between gap-4 border-b bg-orange-50/50 px-8 py-5 transition-none lg:h-24 lg:flex-nowrap lg:py-0">
            <div className="flex items-center gap-5">
              <div className="rounded-2xl bg-orange-500 p-3 text-white shadow-xl shadow-orange-200">
                <Utensils size={24} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">登録済みメニュー</h3>
                <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">
                  現在の登録数 / {filteredMenuItems.length}件
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="商品名で検索"
                  className="h-12 w-[220px] rounded-xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-bold text-gray-700 outline-none focus:border-orange-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsFilterModalOpen(true)}
                className="relative flex h-12 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 text-sm font-black text-orange-600 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-100/80"
              >
                <Filter size={16} />
                フィルタ
                {activeFilterCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={startCreating}
                className="flex items-center gap-3 rounded-xl bg-orange-500 px-6 py-3.5 font-black text-white shadow-xl shadow-orange-200 transition-colors hover:bg-orange-600 active:scale-95 transform whitespace-nowrap outline-none"
              >
                <Plus size={20} strokeWidth={3} />
                新メニュー追加
              </button>
            </div>
          </div>

          {isSingleCategorySortReady && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-white px-8 py-4">
              <div>
                <div className="text-sm font-black text-slate-800">
                  「{activeSortCategoryName}」の表示順
                </div>
                <p className="mt-0.5 text-xs font-bold text-slate-400">
                  左側の ↑↓ で、カテゴリ内の商品順をすぐに変更できます。
                </p>
              </div>

              {isProcessing && (
                <div className="flex items-center gap-2 rounded-xl bg-orange-50 px-4 py-2 text-xs font-black text-orange-600">
                  <LoadingSpinner size={16} />
                  保存中...
                </div>
              )}
            </div>
          )}

          {!isSingleCategorySortReady && activeFilterCount > 0 && (
            <div className="border-b border-gray-100 bg-gray-50 px-8 py-3 text-xs font-bold text-gray-400">
              表示順を変更するには、フィルタでカテゴリを1つだけ選択し、検索や他の条件を外してください。
            </div>
          )}

            <div className="bg-gray-50/50 p-4">
              {visibleMenuItems.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm font-bold text-gray-400">
                  メニューがありません
                </div>
              ) : (
                <div className="space-y-3">
                  {displayMenuItems.map((item, index) => {
                    const kitchenIds = item.kitchenIds || (
                      item.kitchenId
                        ? [item.kitchenId]
                        : defaultKitchenId
                          ? [defaultKitchenId]
                          : []
                    );

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          startEditing(item);
                        }}
                        className={`group flex flex-col gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm transition-all lg:flex-row lg:items-center ${
                          isSingleCategorySortReady
                            ? 'cursor-pointer border-orange-100 hover:border-orange-200 hover:bg-orange-50/30 hover:shadow-md'
                            : 'cursor-pointer border-gray-200 hover:border-orange-200 hover:bg-orange-50/30 hover:shadow-md'
                        }`}
                      >
                        <div className="flex items-center gap-4 lg:min-w-0 lg:flex-1">
                          <div
                            className={`flex min-h-10 w-16 shrink-0 items-center justify-center ${
                              isSingleCategorySortReady ? 'text-orange-500' : 'text-gray-300'
                            }`}
                          >
                            {isSingleCategorySortReady ? (
                              <div
                                className="flex items-center gap-1"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  disabled={index === 0 || isProcessing}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    moveMenuItemImmediately(index, -1);
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50 text-xs font-black text-orange-600 transition-colors hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-30"
                                  title="上へ"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  disabled={index === displayMenuItems.length - 1 || isProcessing}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    moveMenuItemImmediately(index, 1);
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50 text-xs font-black text-orange-600 transition-colors hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-30"
                                  title="下へ"
                                >
                                  ↓
                                </button>
                              </div>
                            ) : (
                              <span className="font-mono text-xs font-black">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                            )}
                          </div>

                          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gray-100 ring-1 ring-gray-100">
                            {item.image ? (
                              <img
                                src={item.image}
                                className="h-full w-full object-cover"
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <ImageIcon size={22} className="text-gray-300" />
                            )}

                            {item.isSoldOut && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                                <span className="rounded bg-white px-1.5 py-0.5 text-[8px] font-black tracking-widest text-red-600">
                                  SOLD
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <div className="truncate text-base font-black leading-tight text-gray-900">
                                {item.name}
                              </div>

                              {item.photoLabelText && (
                                <span
                                  className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black text-white"
                                  style={{ backgroundColor: item.photoLabelColor || '#F97316' }}
                                >
                                  {item.photoLabelText}
                                </span>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1.5">
                                <div
                                  className="h-2 w-2 rounded-full shadow-sm"
                                  style={{ backgroundColor: categoryById[item.category]?.hex || '#ccc' }}
                                />
                                <span className="text-[10px] font-black tracking-tight text-gray-400">
                                  {categoryById[item.category]?.name || '未設定'}
                                </span>
                              </div>

                              {kitchenIds.map((kitchenId) => (
                                <div
                                  key={kitchenId}
                                  className="flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-500"
                                >
                                  <ChefHat size={10} />
                                  {kitchens.find((kitchen) => kitchen.id === kitchenId)?.name || '未設定'}
                                </div>
                              ))}
                            </div>

                            <div className="mt-2">
                              <MetaChipList item={item} compact />
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col gap-2 border-t border-gray-100 pt-3 lg:min-w-[520px] lg:border-t-0 lg:pt-0">
                          <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 border-t border-gray-100 pt-3 lg:border-t-0 lg:pt-0 lg:justify-end">
                            <div className="inline-flex h-10 min-w-[92px] items-center justify-end px-2 text-base font-black leading-none text-gray-900 tabular-nums">
                              ¥{Number(item.price || 0).toLocaleString()}
                            </div>

                            <div
                              className={`inline-flex h-10 items-center justify-center rounded-xl border px-4 text-xs font-black leading-none ${
                                item.isSoldOut
                                  ? 'border-red-100 bg-red-50 text-red-600'
                                  : 'border-green-100 bg-green-50 text-green-600'
                              }`}
                            >
                              {item.isSoldOut ? '売り切れ' : '販売中'}
                            </div>

                            {Number(item.limitedQuantity) > 0 && (
                              <div className="inline-flex h-10 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 px-4 text-xs font-black leading-none text-orange-700">
                                本日残り {Number(item.remainingQuantity ?? item.limitedQuantity ?? 0)} 点
                              </div>
                            )}

                            {!isSortMode && (
                              <>
                                <div className="hidden w-2 lg:block" />

                                <button
                                  type="button"
                                  onClick={(event) => handleToggleSoldOut(event, item)}
                                  className={`inline-flex h-10 items-center justify-center rounded-xl border px-4 text-xs font-black leading-none shadow-sm transition-colors active:scale-95 ${
                                    item.isSoldOut
                                      ? 'border-green-100 bg-green-50 text-green-700 hover:bg-green-100'
                                      : 'border-red-100 bg-red-50 text-red-600 hover:bg-red-100'
                                  }`}
                                >
                                  {item.isSoldOut ? '販売再開' : '売切にする'}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => handleSetLimitedQuantity(event, item)}
                                  className="inline-flex h-10 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 px-4 text-xs font-black leading-none text-orange-700 shadow-sm transition-colors hover:bg-orange-100 active:scale-95"
                                >
                                  残数設定
                                </button>

                                {Number(item.limitedQuantity) > 0 && (
                                  <button
                                    type="button"
                                    onClick={(event) => handleClearLimitedQuantity(event, item)}
                                    className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-4 text-xs font-black leading-none text-gray-500 shadow-sm transition-colors hover:bg-gray-200 active:scale-95"
                                  >
                                    残数解除
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startEditing(item);
                                  }}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 bg-white text-blue-500 shadow-sm transition-colors hover:bg-blue-50"
                                  title="編集"
                                >
                                  <Edit size={17} />
                                </button>

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeletingMenu(item);
                                  }}
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 bg-white text-red-400 shadow-sm transition-colors hover:bg-red-50"
                                  title="削除"
                                >
                                  <Trash2 size={17} />
                                </button>
                              </>
                            )}
                          </div>                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {hasMoreMenuItems && (
                <div className="mt-5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((current) => current + 20)}
                    className="flex items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 px-8 py-4 text-sm font-black text-orange-600 transition-colors hover:bg-orange-100"
                  >
                    さらに表示する（{visibleMenuItems.length} / {filteredMenuItems.length}件）
                  </button>
                </div>
              )}
            </div>
            </div>
      )}

      {deletingMenu && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[2.5rem] bg-white p-10 text-center shadow-2xl">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 shadow-inner">
              <AlertTriangle size={40} className="text-red-500" />
            </div>
            <h3 className="mb-2 text-2xl font-black tracking-tight text-gray-900">メニューを削除しますか？</h3>
            <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
              <span className="font-black text-gray-800">「{deletingMenu.name}」</span> を削除します。<br />
              この操作は元に戻せません。
            </p>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={confirmDelete} disabled={isProcessing} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 font-black text-white shadow-lg transition-all hover:bg-red-600">
              {isProcessing ? <LoadingSpinner size={20} /> : '削除する'}
              </button>
              <button type="button" onClick={() => setDeletingMenu(null)} disabled={isProcessing} className="w-full rounded-2xl py-4 font-bold text-gray-400 transition-colors hover:bg-gray-50">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
{stockInputTarget && (
  <div
    className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm"
    onClick={closeStockInputModal}
  >
    <div
      className="w-full max-w-sm rounded-[2rem] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">
            Stock
          </p>
          <h3 className="mt-1 truncate text-xl font-black text-gray-900">
            残数設定
          </h3>
          <p className="mt-1 truncate text-sm font-bold text-gray-400">
            {stockInputTarget.name}
          </p>
        </div>

        <button
          type="button"
          onClick={closeStockInputModal}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          aria-label="閉じる"
        >
          <X size={20} />
        </button>
      </div>

      <div className="mb-5 rounded-3xl border border-orange-100 bg-orange-50 px-5 py-5 text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400">
          本日残数
        </div>
        <div className="mt-2 flex items-end justify-center gap-1">
          <span className="min-w-[72px] text-center text-5xl font-black tabular-nums text-orange-700">
            {stockInputValue || '0'}
          </span>
          <span className="pb-1 text-base font-black text-orange-500">点</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => appendStockInputDigit(digit)}
            className="flex h-14 items-center justify-center rounded-2xl bg-gray-100 text-2xl font-black text-gray-800 transition-colors hover:bg-orange-50 hover:text-orange-600 active:scale-95"
          >
            {digit}
          </button>
        ))}

        <button
          type="button"
          onClick={deleteStockInputDigit}
          className="flex h-14 items-center justify-center rounded-2xl bg-gray-100 text-sm font-black text-gray-500 transition-colors hover:bg-gray-200 active:scale-95"
        >
          削除
        </button>

        <button
          type="button"
          onClick={() => appendStockInputDigit(0)}
          className="flex h-14 items-center justify-center rounded-2xl bg-gray-100 text-2xl font-black text-gray-800 transition-colors hover:bg-orange-50 hover:text-orange-600 active:scale-95"
        >
          0
        </button>

        <button
          type="button"
          onClick={confirmStockInput}
          disabled={isProcessing}
          className="flex h-14 items-center justify-center rounded-2xl bg-orange-500 text-sm font-black text-white shadow-lg shadow-orange-200 transition-colors hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
        >
          {isProcessing ? <LoadingSpinner size={20} /> : '決定'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setStockInputValue('')}
          className="h-11 rounded-2xl bg-gray-50 text-sm font-black text-gray-400 transition-colors hover:bg-gray-100"
        >
          クリア
        </button>

        <button
          type="button"
          onClick={async () => {
            if (!stockInputTarget || isProcessing) return;

            await updateMenuStockState(stockInputTarget, {
              limitedQuantity: 0,
              soldQuantity: 0,
              remainingQuantity: 0,
              isSoldOut: true
            });

            closeStockInputModal();
          }}
          disabled={isProcessing}
          className="h-11 rounded-2xl bg-red-50 text-sm font-black text-red-500 transition-colors hover:bg-red-100 disabled:opacity-60"
        >
          0点で売切
        </button>
      </div>
    </div>
  </div>
)}
{isFilterModalOpen && (
  <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-slate-900/60 px-4 pb-8 pt-24 backdrop-blur-sm">
    <div className="flex max-h-[calc(100vh-128px)] w-full max-w-3xl flex-col overflow-hidden rounded-[2.5rem] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-orange-100 bg-orange-50/80 px-8 py-6">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl bg-orange-500 p-3 text-white shadow-lg shadow-orange-200">
                  <Filter size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight text-orange-600">メニューの絞り込み</h3>
                  <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">カテゴリや提供条件から一覧を絞り込めます。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFilterModalOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white hover:text-gray-600"
              >
                <X size={22} />
              </button>
            </div>

            <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2 md:p-8">
              <section className="rounded-3xl border border-orange-100 bg-orange-50/60 p-6">
                <div className="mb-4">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-500">
                      カテゴリ
                    </div>
                    <p className="mt-1 text-xs font-bold leading-relaxed text-orange-400">
                      1カテゴリ選択で、表示順を編集できます
                    </p>
                  </div>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleFilterValue('categories', category.id)}
                      className={`rounded-2xl border px-3 py-1.5 text-sm font-black transition-colors ${
                        filters.categories.includes(category.id)
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-orange-100 bg-white text-orange-600 hover:border-orange-300 hover:bg-orange-100/70'
                      }`}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-orange-100 bg-orange-50/60 p-6">
                <div className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-orange-500">提供時間帯</div>
                <div className="flex flex-wrap gap-2">
                  {periods.map((period) => (
                    <button
                      key={period.id}
                      type="button"
                      onClick={() => toggleFilterValue('periods', period.id)}
                      className={`rounded-2xl border px-3 py-1.5 text-sm font-black transition-colors ${
                        filters.periods.includes(period.id)
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-orange-100 bg-white text-orange-600 hover:border-orange-300 hover:bg-orange-100/70'
                      }`}
                    >
                      {period.name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-orange-100 bg-orange-50/60 p-6">
                <div className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-orange-500">担当キッチン</div>
                <div className="flex flex-wrap gap-2">
                  {kitchens.map((kitchen) => (
                    <button
                      key={kitchen.id}
                      type="button"
                      onClick={() => toggleFilterValue('kitchens', kitchen.id)}
                      className={`rounded-2xl border px-3 py-1.5 text-sm font-black transition-colors ${
                        filters.kitchens.includes(kitchen.id)
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-orange-100 bg-white text-orange-600 hover:border-orange-300 hover:bg-orange-100/70'
                      }`}
                    >
                      {kitchen.name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-orange-100 bg-orange-50/60 p-6">
                <div className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-orange-500">テイクアウト可否</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'all', label: 'すべて' },
                    { id: 'allowed', label: 'テイクアウト可' },
                    { id: 'disabled', label: '店内のみ' }
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFilters((current) => ({ ...current, takeout: option.id }))}
                      className={`rounded-2xl border px-3 py-1.5 text-sm font-black transition-colors ${
                        filters.takeout === option.id
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-orange-100 bg-white text-orange-600 hover:border-orange-300 hover:bg-orange-100/70'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-orange-100 bg-orange-50/60 p-6 md:col-span-2">
                <div className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-orange-500">アレルゲン</div>
                <div className="flex flex-wrap gap-2">
                  {ALLERGEN_OPTIONS.map((allergen) => (
                    <button
                      key={allergen.id}
                      type="button"
                      onClick={() => toggleFilterValue('allergens', allergen.id)}
                      className={`rounded-2xl border px-3 py-1.5 text-sm font-black transition-colors ${
                        filters.allergens.includes(allergen.id)
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-orange-100 bg-white text-orange-600 hover:border-orange-300 hover:bg-orange-100/70'
                      }`}
                    >
                      {allergen.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="shrink-0 flex items-center justify-between border-t border-gray-100 bg-white px-6 py-5 md:px-8 md:py-6">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-xl px-5 py-3 text-sm font-black text-gray-400 transition-colors hover:bg-gray-50"
              >
                絞り込みをリセット
              </button>
              <button
                type="button"
                onClick={() => setIsFilterModalOpen(false)}
                className="rounded-xl bg-orange-500 px-6 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition-colors hover:bg-orange-600"
              >
                この条件で表示
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuSettings;


