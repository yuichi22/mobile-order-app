import React, { useState, useRef, useEffect, useMemo } from 'react';
import { getTableDisplayName, getTableDisplayLabel } from '../../shared/utils/tableDisplay';
import { collection, doc, getDocs, increment, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Barcode, ChevronLeft, MoveRight, X, Clock, ShoppingBag, Plus, Minus, Trash2, DollarSign, CreditCard, ScanQrCode, Check, ClipboardList, PauseCircle, RotateCcw, Percent } from 'lucide-react';

import { getActiveRegisterContext, getAvailableRegisters } from './utils/registerContext';
import { db } from '../../shared/api/firebase/client';
import { normalizeScannedCode } from '../../shared/utils/halfWidth';

import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import FloorMapCanvas from '../../shared/components/floor-map/FloorMapCanvas';
import TableMenuOverrideModal from './components/TableMenuOverrideModal';
import { saveTableMenuOverride } from './services/tableMenuOverrideService';
import {
  useCategoryData,
  useFloorLayout,
  useMenuData,
  usePeriodData,
  useProductMasterData,
  useStoreSettings,
  useDiscountData
} from '../store/hooks';
import {
  normalizeTaxRounding,
  splitTaxIncludedAmount
} from '../../shared/utils/tax';
import { useKitchenBoard } from '../kitchen/hooks/useKitchenBoard';
import { useTableMenuOverrides } from './hooks/useTableMenuOverrides';
import PosTransactionHistoryPage from './pages/PosTransactionHistoryPage';
import UncodedSaleModal from './components/UncodedSaleModal';
import { PosModals } from './PosRegister/components/PosModals';

const TAKEOUT_PAYMENT_METHOD_OPTIONS = [
  {
    id: 'cash',
    label: '現金',
    buttonLabel: '現金で会計する',
    icon: DollarSign,
    activeClassName: 'border-gray-950 bg-gray-950 text-white shadow-md ring-2 ring-gray-200',
    inactiveClassName: 'border-gray-300 bg-white text-gray-950 shadow-sm hover:border-gray-600 hover:bg-gray-50',
    panelClassName: 'border-gray-300 bg-gray-50 text-gray-900',
    panelIconClassName: 'bg-white text-gray-950 shadow-lg shadow-gray-200',
    panelTitleClassName: 'text-gray-950',
    panelTextClassName: 'text-gray-500',
    actionClassName: 'bg-gray-950 text-white hover:bg-black hover:shadow-xl'
  },
  {
    id: 'card',
    label: 'カード',
    buttonLabel: 'カードで会計する',
    icon: CreditCard,
    activeClassName: 'border-blue-600 bg-blue-600 text-white shadow-md ring-2 ring-blue-100',
    inactiveClassName: 'border-blue-200 bg-blue-50 text-blue-800 shadow-sm hover:border-blue-500 hover:bg-blue-100',
    panelClassName: 'border-blue-300 bg-blue-50 text-blue-700',
    panelIconClassName: 'bg-white text-blue-600 shadow-lg shadow-blue-100',
    panelTitleClassName: 'text-blue-700',
    panelTextClassName: 'text-blue-500',
    actionClassName: 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-xl'
  },
  {
    id: 'qr',
    label: 'QR決済',
    buttonLabel: 'QR決済で会計する',
    icon: ScanQrCode,
    activeClassName: 'border-purple-600 bg-purple-600 text-white shadow-md ring-2 ring-purple-100',
    inactiveClassName: 'border-purple-200 bg-purple-50 text-purple-800 shadow-sm hover:border-purple-500 hover:bg-purple-100',
    panelClassName: 'border-purple-300 bg-purple-50 text-purple-700',
    panelIconClassName: 'bg-white text-purple-600 shadow-lg shadow-purple-100',
    panelTitleClassName: 'text-purple-700',
    panelTextClassName: 'text-purple-500',
    actionClassName: 'bg-purple-600 text-white hover:bg-purple-700 hover:shadow-xl'
  }
];

const POS_HOLD_STORAGE_VERSION = 1;

const getPosHoldStorageKey = (storeId) => `akuto-pos-holds:${storeId || 'unknown'}`;

const readPosHoldsFromStorage = (storeId) => {
  if (typeof window === 'undefined' || !storeId) return [];

  try {
    const raw = window.localStorage.getItem(getPosHoldStorageKey(storeId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[PosMain] failed to read POS holds', error);
    return [];
  }
};

const writePosHoldsToStorage = (storeId, holds) => {
  if (typeof window === 'undefined' || !storeId) return;

  try {
    window.localStorage.setItem(getPosHoldStorageKey(storeId), JSON.stringify(Array.isArray(holds) ? holds : []));
  } catch (error) {
    console.warn('[PosMain] failed to write POS holds', error);
  }
};

// POSレジで在庫数による販売制限を行うか。
// 在庫が未確立(CSV取込直後で全0など)の段階では false=制限なしにしないと一切打てないため、
// 既定は false。棚卸しで在庫を確定し、在庫数を信頼できるようになったら true に戻すと品切れ商品の販売を防げる。
const POS_ENFORCE_STOCK_LIMIT = false;

export const PosMain = ({ activeSessions, onScanSession, onSelectSession, storeId, onBack, onPaymentResult, registerMode = 'order' }) => {
  const { settings: storeSettings } = useStoreSettings(storeId);

  // この端末の登録レジ(基本設定)＝自レジ。履歴は既定でこのレジ。全レジ一覧は「その他のレジ」選択用。
  const activeRegister = useMemo(
    () => getActiveRegisterContext(storeId, storeSettings?.registers, storeSettings?.departments),
    [storeId, storeSettings]
  );
  const allRegisters = useMemo(
    () => getAvailableRegisters(storeSettings?.registers, storeSettings?.departments),
    [storeSettings]
  );

  const [scanInput, setScanInput] = useState('');
  const [viewMode, setViewMode] = useState('map');
  const inputRef = useRef(null);
  const [movingSession, setMovingSession] = useState(null);
  const [moveError, setMoveError] = useState('');
  const [isMovingTable, setIsMovingTable] = useState(false);

  const [splitRatio, setSplitRatio] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  const mapWrapperRef = useRef(null);
  const [mapDimensions, setMapDimensions] = useState({ width: 0, height: 0 });

  const { layoutItems, loading: mapLoading } = useFloorLayout(storeId);
  const { periods = [] } = usePeriodData(storeId);
  const { menuItems = [] } = useMenuData(storeId);
  const { categories = [] } = useCategoryData(storeId);
  const { settings } = useStoreSettings(storeId);
  const {
    products: productMasterProducts = [],
    productCategories: productMasterCategories = [],
    productCategoryGroups: productMasterCategoryGroups = [],
    productSalesAreas: productMasterSalesAreas = [],
    loading: productMasterLoading
  } = useProductMasterData(storeId);
  const { discounts } = useDiscountData(storeId) || { discounts: [] };
  // 既定は右ペイン=履歴。POSでも待機中は履歴を表示し、商品がカートに入ったら会計画面へ切替える。
  const [isTakeoutMode, setIsTakeoutMode] = useState(false);
  const [posProductKeyword, setPosProductKeyword] = useState('');
  const [posProductCategoryId, setPosProductCategoryId] = useState('');
  const [posManualName, setPosManualName] = useState('');
  const [posManualPrice, setPosManualPrice] = useState('');
  const [posProductMessage, setPosProductMessage] = useState(null);
  // バーコード未登録商品の会計モーダル(売り場起点・POSレジ用)。null=閉
  const [uncodedSalesArea, setUncodedSalesArea] = useState(null);
  // ORDERテイクアウトの商品リスト絞り込みカテゴリー。''=すべて
  const [takeoutCategoryFilter, setTakeoutCategoryFilter] = useState('');
  const [posHolds, setPosHolds] = useState([]);
  const [activePosHoldId, setActivePosHoldId] = useState('');
  const [takeoutCart, setTakeoutCart] = useState([]);
  const [takeoutPaymentMethod, setTakeoutPaymentMethod] = useState('');
  const [takeoutPaymentAmount, setTakeoutPaymentAmount] = useState('');
  const [takeoutDiscountType, setTakeoutDiscountType] = useState('none');
  const [takeoutDiscountValue, setTakeoutDiscountValue] = useState(0);
  const [takeoutSelectedDiscount, setTakeoutSelectedDiscount] = useState(null);
  const [takeoutDiscountQuantities, setTakeoutDiscountQuantities] = useState({});
  const [showTakeoutDiscountModal, setShowTakeoutDiscountModal] = useState(false);
  const [isTakeoutSubmitting, setIsTakeoutSubmitting] = useState(false);
  const [menuOverrideOpen, setMenuOverrideOpen] = useState(false);
  const [menuOverrideProcessing, setMenuOverrideProcessing] = useState(false);
  const { orders, calls, checks } = useKitchenBoard(storeId);
  const tableMenuOverrides = useTableMenuOverrides(storeId);

  const displaySessions = activeSessions.filter((session) => session.status === 'active');

  useEffect(() => {
    if (registerMode !== 'pos' || !storeId) return;
    setPosHolds(readPosHoldsFromStorage(storeId));
  }, [registerMode, storeId]);

  const savePosHolds = (nextHolds) => {
    setPosHolds(nextHolds);
    writePosHoldsToStorage(storeId, nextHolds);
  };

  const posCategoryNameMap = useMemo(() => {
    const map = {};

    if (Array.isArray(productMasterCategories)) {
      productMasterCategories.forEach((category) => {
        if (!category?.id) return;
        map[category.id] = category.name || 'カテゴリー';
      });
    }

    return map;
  }, [productMasterCategories]);

  const getProductStockQuantity = (product) => {
    const stockValue = product?.inventoryQuantity ?? product?.quantity ?? 0;
    const stockNumber = Number(stockValue);
    return Number.isFinite(stockNumber) ? Math.max(Math.floor(stockNumber), 0) : 0;
  };

  const activePosProducts = useMemo(() => (
    Array.isArray(productMasterProducts)
      ? productMasterProducts
        .filter((product) => product && product.isArchived !== true && product.isActive !== false)
        .map((product) => ({
          ...product,
          resolvedPrice: Number(product.priceTaxIncluded ?? product.price ?? 0) || 0,
          resolvedStock: getProductStockQuantity(product),
          resolvedCategoryName: posCategoryNameMap[product.categoryId] || product.categoryName || 'カテゴリー'
        }))
        .filter((product) => Number(product.resolvedPrice || 0) >= 0)
        .sort((left, right) => (
          String(left.resolvedCategoryName || '').localeCompare(String(right.resolvedCategoryName || ''), 'ja')
          || String(left.brandName || '').localeCompare(String(right.brandName || ''), 'ja')
          || String(left.name || '').localeCompare(String(right.name || ''), 'ja')
        ))
      : []
  ), [posCategoryNameMap, productMasterProducts]);

  const filteredPosProducts = useMemo(() => {
    const normalizedKeyword = posProductKeyword.trim().toLowerCase();

    return activePosProducts.filter((product) => {
      if (posProductCategoryId && product.categoryId !== posProductCategoryId) return false;

      if (!normalizedKeyword) return true;

      return [
        product.name,
        product.sku,
        product.productCode,
        product.barcode,
        product.resolvedCategoryName
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [activePosProducts, posProductCategoryId, posProductKeyword]);

  const getRetailCartQuantity = (productId) => (
    takeoutCart
      .filter((item) => item.sourceType === 'retail' && item.productId === productId)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  );

  const setPosMessage = (message, type = 'info') => {
    setPosProductMessage({ message, type, key: Date.now() });
  };

  const clearTakeoutDiscount = () => {
    setTakeoutDiscountType('none');
    setTakeoutDiscountValue(0);
    setTakeoutSelectedDiscount(null);
    setTakeoutDiscountQuantities({});
  };

  const addPosCartItem = (payload) => {
    if (!payload?.id) return;

    // POSでは商品がカートに入ったら右ペインを会計画面に切替える（待機=履歴 → 会計）。
    if (registerMode === 'pos') setIsTakeoutMode(true);

    setTakeoutCart((current) => {
      const existing = current.find((item) => item.id === payload.id);

      if (existing) {
        return current.map((item) => (
          item.id === payload.id
            ? { ...item, quantity: Number(item.quantity || 0) + Number(payload.quantity || 1) }
            : item
        ));
      }

      return [
        ...current,
        {
          ...payload,
          quantity: Number(payload.quantity || 1)
        }
      ];
    });
  };

  const addPosProductToCart = (product) => {
    if (!product?.id) return false;

    const stockQuantity = Number(product.resolvedStock ?? getProductStockQuantity(product));
    const currentQuantity = getRetailCartQuantity(product.id);

    if (POS_ENFORCE_STOCK_LIMIT && stockQuantity <= 0) {
      setPosMessage(`${product.name || '商品'} は在庫がありません。`, 'error');
      return false;
    }

    if (POS_ENFORCE_STOCK_LIMIT && currentQuantity >= stockQuantity) {
      setPosMessage(`${product.name || '商品'} は在庫数 ${stockQuantity} 点を超えて追加できません。`, 'error');
      return false;
    }

    addPosCartItem({
      id: `product:${product.id}`,
      productId: product.id,
      sourceType: 'retail',
      name: product.name || '商品',
      categoryId: product.categoryId || '',
      categoryName: product.resolvedCategoryName || 'カテゴリー',
      takeoutPrice: Number(product.resolvedPrice || 0),
      unitPrice: Number(product.resolvedPrice || 0),
      priceTaxIncluded: Number(product.resolvedPrice || 0),
      barcode: product.barcode || '',
      sku: product.sku || product.productCode || '',
      stockQuantity,
      quantity: 1
    });

    setPosMessage(`${product.name || '商品'} を追加しました。`, 'success');
    return true;
  };

  const addManualPosItem = () => {
    const normalizedName = posManualName.trim() || '手入力商品';
    const normalizedPrice = Math.max(Number(posManualPrice || 0) || 0, 0);

    if (normalizedPrice <= 0) {
      setPosMessage('手入力商品の金額を入力してください。', 'error');
      return;
    }

    addPosCartItem({
      id: `manual:${Date.now()}`,
      sourceType: 'manual',
      name: normalizedName,
      categoryId: posProductCategoryId || '',
      categoryName: posCategoryNameMap[posProductCategoryId] || '手入力',
      takeoutPrice: normalizedPrice,
      unitPrice: normalizedPrice,
      priceTaxIncluded: normalizedPrice,
      quantity: 1
    });

    setPosManualName('');
    setPosManualPrice('');
    setPosMessage(`${normalizedName} を追加しました。`, 'success');
  };

  // バーコード未登録商品(売り場→分類選択＋金額・数量手入力)を会計リストへ追加する。
  const addUncodedItemToCart = ({ salesAreaName, categoryGroupName, categoryId, categoryName, price, quantity }) => {
    const normalizedPrice = Math.max(Number(price || 0) || 0, 0);
    const normalizedQuantity = Math.max(Number(quantity || 1) || 1, 1);
    if (normalizedPrice <= 0) return;

    const label = String(categoryName || categoryGroupName || salesAreaName || '商品').trim();
    const detailLabel = [salesAreaName, categoryGroupName].filter(Boolean).join(' / ') || 'バーコード未登録';

    addPosCartItem({
      id: `uncoded:${Date.now()}`,
      sourceType: 'manual',
      name: label,
      categoryId: categoryId || '',
      categoryName: detailLabel,
      takeoutPrice: normalizedPrice,
      unitPrice: normalizedPrice,
      priceTaxIncluded: normalizedPrice,
      salesAreaName: salesAreaName || '',
      quantity: normalizedQuantity
    });

    setUncodedSalesArea(null);
    setPosMessage(`${label} を会計リストに追加しました。`, 'success');
  };

  const addPosProductByCode = (codeText) => {
    const normalizedCode = String(codeText || '').trim().toLowerCase();
    if (!normalizedCode) return false;

    const matchedProduct = activePosProducts.find((product) => (
      [product.barcode, product.sku, product.productCode]
        .filter(Boolean)
        .some((value) => String(value).trim().toLowerCase() === normalizedCode)
    ));

    if (!matchedProduct) {
      setPosProductKeyword(codeText);
      setPosMessage('商品マスターに一致するバーコード / 品番 / SKU がありません。検索欄に入力しました。', 'error');
      return false;
    }

    return addPosProductToCart(matchedProduct);
  };

  useEffect(() => {
    // モード切替時は待機状態（履歴表示）へ戻す。
    setIsTakeoutMode(false);
  }, [registerMode]);

  const openStaffOrderTerminal = () => {
    if (!storeId || typeof window === 'undefined') return;

    const params = new URLSearchParams();
    params.set('store_id', storeId);

    const nextUrl = `${window.location.origin}/staff-order?${params.toString()}`;
    window.open(nextUrl, '_blank', 'noopener,noreferrer');
  };

  const categoryNameMap = useMemo(() => {
    const map = {};
    if (Array.isArray(categories)) {
      categories.forEach((category) => {
        if (!category?.id) return;
        map[category.id] = category.name || 'カテゴリー未設定';
      });
    }
    return map;
  }, [categories]);

  const takeoutMenuItems = useMemo(() => (
    Array.isArray(menuItems)
      ? menuItems
        .filter((item) => (
          item &&
          item.isSoldOut !== true &&
          item.allowsTakeout !== false &&
          Number(item.takeoutPrice || 0) > 0
        ))
        .map((item) => ({
          ...item,
          takeoutPrice: Math.max(Number(item.takeoutPrice || 0), 0),
          resolvedCategoryId: String(item.category || item.categoryId || ''),
          categoryName: categoryNameMap[item.category || item.categoryId] || item.categoryName || 'カテゴリー未設定'
        }))
        .sort((left, right) => (
          String(left.categoryName || '').localeCompare(String(right.categoryName || ''), 'ja')
          || Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
          || String(left.name || '').localeCompare(String(right.name || ''), 'ja')
        ))
      : []
  ), [categoryNameMap, menuItems]);

  // ORDERテイクアウト: 商品リストに存在するカテゴリーだけをボタン化(メニューカテゴリー)。
  const takeoutCategories = useMemo(() => {
    const seen = new Map();
    takeoutMenuItems.forEach((item) => {
      const id = item.resolvedCategoryId || '';
      if (!seen.has(id)) {
        seen.set(id, { id, name: item.categoryName || 'カテゴリー未設定' });
      }
    });
    return Array.from(seen.values());
  }, [takeoutMenuItems]);

  const filteredTakeoutMenuItems = useMemo(() => (
    takeoutCategoryFilter
      ? takeoutMenuItems.filter((item) => (item.resolvedCategoryId || '') === takeoutCategoryFilter)
      : takeoutMenuItems
  ), [takeoutCategoryFilter, takeoutMenuItems]);

  const takeoutCartRawTotal = useMemo(() => (
    takeoutCart.reduce((sum, item) => (
      sum + (Number(item.takeoutPrice || item.unitPrice || item.priceTaxIncluded || 0) * Number(item.quantity || 0))
    ), 0)
  ), [takeoutCart]);

  const takeoutDiscountAmount = useMemo(() => {
    const rawTotal = Number(takeoutCartRawTotal || 0);
    if (rawTotal <= 0) return 0;

    if (takeoutDiscountType === 'percent') {
      return Math.min(
        rawTotal,
        Math.floor(rawTotal * ((Number(takeoutDiscountValue) || 0) / 100))
      );
    }

    if (takeoutDiscountType === 'amount') {
      return Math.min(rawTotal, Number(takeoutDiscountValue || 0));
    }

    return 0;
  }, [takeoutCartRawTotal, takeoutDiscountType, takeoutDiscountValue]);

  const takeoutCartTotal = useMemo(() => (
    Math.max(Number(takeoutCartRawTotal || 0) - Number(takeoutDiscountAmount || 0), 0)
  ), [takeoutCartRawTotal, takeoutDiscountAmount]);

  const takeoutDiscountLabel = useMemo(() => {
    if (takeoutDiscountType === 'none' || takeoutDiscountAmount <= 0) return '未設定';

    if (takeoutSelectedDiscount?.label) return takeoutSelectedDiscount.label;

    if (takeoutSelectedDiscount?.name) {
      if (takeoutSelectedDiscount.type === 'amount') {
        return `${takeoutSelectedDiscount.name} × ${Number(takeoutSelectedDiscount.quantity || takeoutSelectedDiscount.count || 1)}枚`;
      }

      return takeoutSelectedDiscount.name;
    }

    if (takeoutDiscountType === 'percent') {
      return `${Number(takeoutDiscountValue) || 0}%割引`;
    }

    return `¥${Number(takeoutDiscountValue || 0).toLocaleString()} 値引き`;
  }, [takeoutDiscountAmount, takeoutDiscountType, takeoutDiscountValue, takeoutSelectedDiscount]);

  const takeoutChangeAmount = useMemo(() => (
    Math.max((Number(takeoutPaymentAmount) || 0) - Number(takeoutCartTotal || 0), 0)
  ), [takeoutCartTotal, takeoutPaymentAmount]);

  const selectedTakeoutPaymentMethodOption = useMemo(
    () => TAKEOUT_PAYMENT_METHOD_OPTIONS.find((option) => option.id === takeoutPaymentMethod) || null,
    [takeoutPaymentMethod]
  );

  const TakeoutPaymentIcon = selectedTakeoutPaymentMethodOption?.icon || null;
  const takeoutPaymentActionLabel = selectedTakeoutPaymentMethodOption?.buttonLabel || '支払い方法を選択してください';
  const takeoutPaymentActionClassName = selectedTakeoutPaymentMethodOption?.actionClassName || 'bg-gray-300 text-gray-500';

  const addTakeoutCartItem = (menuItem) => {
    if (!menuItem?.id) return;

    setTakeoutCart((current) => {
      const existing = current.find((item) => item.id === menuItem.id);
      if (existing) {
        return current.map((item) => (
          item.id === menuItem.id
            ? { ...item, quantity: Number(item.quantity || 0) + 1 }
            : item
        ));
      }

      return [
        ...current,
        {
          id: menuItem.id,
          name: menuItem.name || '未設定商品',
          categoryId: menuItem.category || menuItem.categoryId || '',
          categoryName: menuItem.categoryName || 'カテゴリー未設定',
          takeoutPrice: Number(menuItem.takeoutPrice || 0),
          quantity: 1
        }
      ];
    });
  };

  const updateTakeoutCartQuantity = (itemId, delta) => {
    setTakeoutCart((current) => (
      current
        .map((item) => {
          if (item.id !== itemId) return item;

          const currentQuantity = Number(item.quantity || 0);
          const nextQuantity = Math.max(currentQuantity + delta, 0);

          if (
            registerMode === 'pos' &&
            item.sourceType === 'retail' &&
            delta > 0 &&
            nextQuantity > Number(item.stockQuantity || 0)
          ) {
            setPosMessage(`${item.name || '商品'} は在庫数 ${Number(item.stockQuantity || 0)} 点を超えて追加できません。`, 'error');
            return item;
          }

          return { ...item, quantity: nextQuantity };
        })
        .filter((item) => Number(item.quantity || 0) > 0)
    ));
  };

  const removeTakeoutCartItem = (itemId) => {
    setTakeoutCart((current) => current.filter((item) => item.id !== itemId));
  };

  const holdCurrentPosCart = () => {
    if (registerMode !== 'pos' || takeoutCart.length === 0) {
      setPosMessage('保留する商品がありません。', 'error');
      return;
    }

    const now = new Date();
    const holdId = activePosHoldId || `hold-${now.getTime()}`;
    const holdTotal = takeoutCart.reduce((sum, item) => (
      sum + Number(item.takeoutPrice || 0) * Number(item.quantity || 0)
    ), 0);

    const hold = {
      id: holdId,
      version: POS_HOLD_STORAGE_VERSION,
      title: `保留 ${now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`,
      cart: takeoutCart,
      totalAmount: Number(holdTotal),
      itemCount: takeoutCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      createdAt: activePosHoldId
        ? (posHolds.find((item) => item.id === activePosHoldId)?.createdAt || now.toISOString())
        : now.toISOString(),
      updatedAt: now.toISOString()
    };

    const nextHolds = [
      hold,
      ...posHolds.filter((item) => item.id !== holdId)
    ].slice(0, 20);

    savePosHolds(nextHolds);
    setTakeoutCart([]);
    setTakeoutPaymentAmount('');
    setTakeoutPaymentMethod('');
    setActivePosHoldId('');
    // 会計画面から履歴(保留タブ)へ切り替え、保留できたことを確認できるようにする。
    setIsTakeoutMode(false);
    setPosMessage('仮伝票を保留しました。', 'success');
  };

  const restorePosHold = (holdId) => {
    const hold = posHolds.find((item) => item.id === holdId);
    if (!hold) return;

    if (takeoutCart.length > 0 && !window.confirm('現在の仮伝票を置き換えて、保留を復帰しますか？')) {
      return;
    }

    setTakeoutCart(Array.isArray(hold.cart) ? hold.cart : []);
    if (registerMode === 'pos') setIsTakeoutMode(true);
    setTakeoutPaymentAmount('');
    setTakeoutPaymentMethod('');
    setActivePosHoldId(hold.id);
    setPosMessage(`${hold.title || '保留'} を復帰しました。`, 'success');
  };

  const deletePosHold = (holdId) => {
    const hold = posHolds.find((item) => item.id === holdId);
    if (!hold) return;
    if (!window.confirm(`${hold.title || '保留'} を削除しますか？`)) return;

    const nextHolds = posHolds.filter((item) => item.id !== holdId);
    savePosHolds(nextHolds);

    if (activePosHoldId === holdId) {
      setActivePosHoldId('');
    }

    setPosMessage('保留を削除しました。', 'success');
  };

  const clearActivePosHoldAfterPayment = () => {
    if (!activePosHoldId) return;

    const nextHolds = posHolds.filter((item) => item.id !== activePosHoldId);
    savePosHolds(nextHolds);
    setActivePosHoldId('');
  };

  const closeTakeoutMode = () => {
    setIsTakeoutMode(false);
  };

  const handleSubmitTakeoutTransaction = async () => {
    if (!storeId || isTakeoutSubmitting || takeoutCart.length === 0) return;

    if (!takeoutPaymentMethod) {
      alert('支払い方法を選択してください');
      return;
    }

    if (takeoutPaymentMethod === 'cash' && (Number(takeoutPaymentAmount) || 0) < takeoutCartTotal) {
      alert('お預かり金額が不足しています');
      return;
    }

    setIsTakeoutSubmitting(true);

    try {
      const selectedPaymentOption = TAKEOUT_PAYMENT_METHOD_OPTIONS.find((option) => option.id === takeoutPaymentMethod);
      const paymentMethodLabel = selectedPaymentOption?.label || takeoutPaymentMethod;
      const paymentAmountNumber = takeoutPaymentMethod === 'cash'
        ? Number(takeoutPaymentAmount || 0)
        : Number(takeoutCartTotal);
      const reducedTax = Number(settings?.taxRateReduced ?? 8);
      const standardTax = Number(settings?.taxRate ?? 10);
      const taxRounding = normalizeTaxRounding(settings?.taxRounding);
      const reducedBreakdown = splitTaxIncludedAmount(takeoutCartTotal, reducedTax, taxRounding);
      const transactionRef = doc(collection(db, 'stores', storeId, 'transactions'));
      const sessionId = `takeout-${transactionRef.id}`;
      const nowIso = new Date().toISOString();
      const businessDate = nowIso.slice(0, 10);

      const items = takeoutCart.map((item) => ({
        id: item.id,
        menuItemId: item.id,
        productId: item.productId || '',
        sourceType: item.sourceType || 'takeout',
        name: item.name || '未設定商品',
        categoryId: item.categoryId || '',
        categoryName: item.categoryName || 'カテゴリー未設定',
        unitPrice: Number(item.takeoutPrice || 0),
        quantity: Number(item.quantity || 1),
        totalPrice: Number(item.takeoutPrice || 0) * Number(item.quantity || 1),
        barcode: item.barcode || '',
        sku: item.sku || '',
        stockQuantity: item.stockQuantity ?? null,
        isTakeout: true,
        allowsTakeout: true,
        taxRate: reducedTax,
        status: 'paid',
        paymentStatus: 'paid',
        paidAtClient: nowIso
      }));

      const selectedAccountingAdjustmentItems = Array.isArray(takeoutSelectedDiscount?.items) && takeoutSelectedDiscount.items.length > 0
        ? takeoutSelectedDiscount.items
        : takeoutSelectedDiscount
          ? [{
              id: takeoutSelectedDiscount.id || null,
              name: takeoutSelectedDiscount.name || '',
              type: takeoutSelectedDiscount.type || takeoutDiscountType,
              value: Number(takeoutSelectedDiscount.value ?? takeoutDiscountValue) || 0,
              accountingCategory: takeoutSelectedDiscount.accountingCategory || 'sales_discount',
              count: takeoutSelectedDiscount.type === 'amount'
                ? Number(takeoutSelectedDiscount.quantity || takeoutSelectedDiscount.count || 1)
                : 1,
              quantity: takeoutSelectedDiscount.type === 'amount'
                ? Number(takeoutSelectedDiscount.quantity || takeoutSelectedDiscount.count || 1)
                : 1,
              amount: Number(takeoutDiscountType === 'percent' ? takeoutDiscountAmount : takeoutDiscountValue || 0)
            }]
          : [];

      const appliedDiscount = Number(takeoutDiscountAmount) > 0
        ? {
            id: takeoutSelectedDiscount?.id || null,
            name: takeoutDiscountLabel,
            type: takeoutSelectedDiscount?.type || takeoutDiscountType,
            value: Number(takeoutSelectedDiscount?.value ?? takeoutDiscountValue) || 0,
            count: takeoutSelectedDiscount?.type === 'amount'
              ? Number(takeoutSelectedDiscount?.quantity || takeoutSelectedDiscount?.count || 1)
              : 1,
            quantity: takeoutSelectedDiscount?.type === 'amount'
              ? Number(takeoutSelectedDiscount?.quantity || takeoutSelectedDiscount?.count || 1)
              : 1,
            amount: Number(takeoutDiscountAmount),
            accountingCategory: takeoutSelectedDiscount?.accountingCategory || 'sales_discount',
            items: selectedAccountingAdjustmentItems
          }
        : null;

      const taxSummary = {
        reducedTaxRate: Number(reducedTax),
        standardTaxRate: Number(standardTax),
        reducedTaxIncluded: Number(takeoutCartTotal),
        reducedTaxExcluded: Number(reducedBreakdown.baseAmount),
        reducedTaxAmount: Number(reducedBreakdown.taxAmount),
        standardTaxIncluded: 0,
        standardTaxExcluded: 0,
        standardTaxAmount: 0
      };

      const taxBreakdown = {
        reduced: {
          rate: Number(reducedTax),
          sales: Number(takeoutCartTotal),
          baseAmount: Number(reducedBreakdown.baseAmount),
          tax: Number(reducedBreakdown.taxAmount)
        },
        standard: {
          rate: Number(standardTax),
          sales: 0,
          baseAmount: 0,
          tax: 0
        }
      };

      const registerContext = getActiveRegisterContext(storeId, storeSettings?.registers, storeSettings?.departments);
      const hasManualSale = items.some((item) => item?.sourceType === 'manual');
      const hasBarcodeSale = items.some((item) => item?.sourceType === 'barcode');
      const hasRetailSale = items.some((item) => item?.sourceType === 'retail');

      const salesSubChannel = registerMode === 'pos'
        ? hasManualSale
          ? 'pos_manual'
          : hasBarcodeSale
            ? 'pos_barcode'
            : hasRetailSale
              ? 'pos_product_master'
              : 'pos_sale'
        : 'order_takeout';

      const salesSubChannelLabel = registerMode === 'pos'
        ? hasManualSale
          ? '手入力販売'
          : hasBarcodeSale
            ? 'バーコード販売'
            : hasRetailSale
              ? '商品マスター販売'
              : 'POS販売'
        : 'テイクアウト注文会計';

      const takeoutPaymentResultPayload = {
        totalAmount: Number(takeoutCartTotal),
        total: Number(takeoutCartTotal),
        paymentAmount: Number(paymentAmountNumber),
        amountPaid: Number(paymentAmountNumber),
        receivedAmount: Number(paymentAmountNumber),
        changeAmount: Number(takeoutPaymentMethod === 'cash' ? takeoutChangeAmount : 0),
        change: Number(takeoutPaymentMethod === 'cash' ? takeoutChangeAmount : 0),
        method: takeoutPaymentMethod,
        paymentMethod: takeoutPaymentMethod,
        paymentMethodLabel,
        transactionId: transactionRef.id,
        sessionId,
        tableId: 'takeout',
        tableDisplayName: registerMode === 'pos' ? 'POSレジ' : 'テイクアウト',
        tableName: registerMode === 'pos' ? 'POSレジ' : 'テイクアウト',
        isSessionComplete: true,
        canPrintReceipt: true,
        receiptType: 'takeout',
        receiptScopeLabel: registerMode === 'pos' ? 'POSレジ' : 'テイクアウト',
        title: '領収書',
        items,
        subTotal: Number(reducedBreakdown.baseAmount),
        taxAmount: Number(reducedBreakdown.taxAmount),
        taxAmountReduced: Number(reducedBreakdown.taxAmount),
        taxAmountStandard: 0,
        discountAmount: Number(takeoutDiscountAmount),
        promoExpenseAmount: 0,
        voucherAmount: 0,
        settlementAdjustmentTotal: Number(takeoutDiscountAmount),
        salesAmountBeforeSettlementAdjustments: Number(takeoutCartRawTotal),
        storeId,
        isTakeout: true,
        orderType: 'takeout',
        serviceType: 'takeout'
      };

      const batch = writeBatch(db);

      batch.set(transactionRef, {
          sessionId,
          tableId: 'takeout',
          tableDisplayName: registerMode === 'pos' ? 'POSレジ' : 'テイクアウト',
          tableName: registerMode === 'pos' ? 'POSレジ' : 'テイクアウト',

          registerId: registerContext.id,
          registerName: registerContext.name,
          departmentId: registerContext.departmentId || 'retail',
          departmentName: registerContext.departmentName || '物販',
          registerMode: registerContext.registerMode || (registerMode === 'pos' ? 'pos' : 'order'),
          salesChannel: (registerContext.registerMode || registerMode) === 'pos' ? 'pos_register' : 'order_register',
          salesChannelLabel: (registerContext.registerMode || registerMode) === 'pos' ? 'POSレジ' : 'ORDERレジ',
          salesSubChannel,
          salesSubChannelLabel,

          orderType: 'takeout',
          serviceType: 'takeout',
          isTakeout: true,
          orderFlow: 'postpay',

          customerIds: ['takeout_guest'],
          customerSummaries: [{
            customerId: 'takeout_guest',
            orderIds: [],
            orderCount: 1,
            totalAmount: Number(takeoutCartTotal)
          }],

          items,
          guestCount: 0,

          periodId: 'takeout',
          periodName: 'テイクアウト',

          subTotal: Number(reducedBreakdown.baseAmount),
          subtotal: Number(reducedBreakdown.baseAmount),
          rawTotalAmount: Number(takeoutCartRawTotal),
          discountAmount: Number(takeoutDiscountAmount),
          totalAmount: Number(takeoutCartTotal),
          totalPrice: Number(takeoutCartTotal),

          taxAmount: Number(reducedBreakdown.taxAmount),
          taxAmountReduced: Number(reducedBreakdown.taxAmount),
          taxAmountStandard: 0,
          taxRateReduced: Number(reducedTax),
          taxRateStandard: Number(standardTax),

          totalReducedIncl: Number(takeoutCartTotal),
          totalStandardIncl: 0,

          taxSummary,
          taxBreakdown,

          discountType: takeoutDiscountType || 'none',
          discountValue: Number(takeoutDiscountValue) || 0,
          discountName: Number(takeoutDiscountAmount) > 0 ? takeoutDiscountLabel : '',
          discountDetail: appliedDiscount,
          appliedDiscount,
          appliedDiscounts: appliedDiscount ? [appliedDiscount] : [],

          paymentMethod: takeoutPaymentMethod,
          paymentMethodGroup: takeoutPaymentMethod,

          timestamp: serverTimestamp(),
          paidAt: serverTimestamp(),
          businessDate,

          isPaid: true
        });

      const retailQuantityByProductId = new Map();
      takeoutCart.forEach((item) => {
        if (item.sourceType !== 'retail' || !item.productId) return;
        const quantity = Math.max(Number(item.quantity || 0), 0);
        if (quantity <= 0) return;
        retailQuantityByProductId.set(
          item.productId,
          (retailQuantityByProductId.get(item.productId) || 0) + quantity
        );
      });

      retailQuantityByProductId.forEach((quantity, productId) => {
        const productRef = doc(db, 'stores', storeId, 'products', productId);
        batch.update(productRef, {
          inventoryQuantity: increment(-quantity),
          quantity: increment(-quantity),
          lastPosSoldAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();

      clearActivePosHoldAfterPayment();
      setTakeoutCart([]);
      setTakeoutPaymentAmount('');
      setTakeoutPaymentMethod('');
      clearTakeoutDiscount();
      setIsTakeoutMode(false);
      onPaymentResult?.(takeoutPaymentResultPayload);
    } catch (error) {
      console.error('[PosMain] takeout transaction failed', {
        message: error?.message,
        code: error?.code,
        stack: error?.stack,
        error
      });
      alert(`テイクアウト会計の保存に失敗しました${error?.message ? `: ${error.message}` : ''}`);
    } finally {
      setIsTakeoutSubmitting(false);
    }
  };

  const getSessionByTableId = (tableId) => (
    displaySessions.find((session) => String(session.tableId) === String(tableId)) || null
  );

  const resetMoveMode = () => {
    setMovingSession(null);
    setMoveError('');
  };

  const moveSessionToTable = async ({ session, nextTableId }) => {
    if (!storeId || !session?.id || !nextTableId) return;

    const oldTableId = String(session.tableId || '').trim();
    const normalizedNextTableId = String(nextTableId || '').trim();

    const nextLayoutItem = layoutItems.find((item) =>
      item.type === 'table' &&
      String(item.label || '') === String(normalizedNextTableId)
    );

    const nextTableDisplayName = String(
      nextLayoutItem?.displayName || ''
    ).trim();

    if (!oldTableId || !normalizedNextTableId) return;

    if (oldTableId === normalizedNextTableId) {
      resetMoveMode();
      return;
    }

    const occupiedSession = getSessionByTableId(normalizedNextTableId);
    if (occupiedSession) {
      setMoveError(`テーブル ${normalizedNextTableId} は利用中です。空席を選んでください。`);
      return;
    }

    setIsMovingTable(true);
    setMoveError('');

    try {
      const batch = writeBatch(db);

      batch.set(doc(db, 'stores', storeId, 'tables', oldTableId), {
        tableId: oldTableId,
        currentSessionId: null,
        currentSessionStatus: 'idle',
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableSessions', oldTableId), {
        tableId: oldTableId,
        sessionId: null,
        status: 'idle',
        updatedAt: serverTimestamp(),
        movedToTableId: normalizedNextTableId,
        lastMovedSessionId: session.id,
        lastMovedAt: serverTimestamp()
      }, { merge: true });

      batch.delete(doc(db, 'stores', storeId, 'tableEntryGuards', oldTableId));

      batch.set(doc(db, 'stores', storeId, 'tables', normalizedNextTableId), {
        tableId: normalizedNextTableId,
        currentSessionId: session.id,
        currentSessionStatus: 'active',
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableSessions', normalizedNextTableId), {
        tableId: normalizedNextTableId,
        sessionId: session.id,
        status: 'active',
        updatedAt: serverTimestamp(),
        movedFromTableId: oldTableId,
        movedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableEntryGuards', normalizedNextTableId), {
        tableId: normalizedNextTableId,
        sessionId: session.id,
        movedFromTableId: oldTableId,
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.update(doc(db, 'stores', storeId, 'sessions', session.id), {
        tableId: normalizedNextTableId,
        tableNumber: normalizedNextTableId,
        tableDisplayName: nextTableDisplayName,
        tableName: nextTableDisplayName,
        movedFromTableId: oldTableId,
        movedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const ordersQuery = query(
        collection(db, 'stores', storeId, 'orders'),
        where('sessionId', '==', session.id)
      );
      const ordersSnapshot = await getDocs(ordersQuery);
      ordersSnapshot.forEach((orderDoc) => {
      batch.update(orderDoc.ref, {
        tableId: normalizedNextTableId,
        tableNumber: normalizedNextTableId,
        tableDisplayName: nextTableDisplayName,
        tableName: nextTableDisplayName,
        updatedAt: serverTimestamp()
      });
      });

      const requestsQuery = query(
        collection(db, 'stores', storeId, 'serviceRequests'),
        where('sessionId', '==', session.id)
      );
      const requestsSnapshot = await getDocs(requestsQuery);
      requestsSnapshot.forEach((requestDoc) => {
      batch.update(requestDoc.ref, {
        tableId: normalizedNextTableId,
        tableNumber: normalizedNextTableId,
        tableDisplayName: nextTableDisplayName,
        tableName: nextTableDisplayName,
        updatedAt: serverTimestamp()
      });
      });

      await batch.commit();

      resetMoveMode();
    } catch (error) {
      console.error('[PosMain] moveSessionToTable failed', error);
      setMoveError('席移動に失敗しました。通信状況を確認して、もう一度お試しください。');
    } finally {
      setIsMovingTable(false);
    }
  };

  const handleApplyTableMenuOverride = async ({
    tableId,
    tableName,
    periodId,
    periodName,
    durationMinutes
  }) => {
    setMenuOverrideProcessing(true);

    try {
      await saveTableMenuOverride({
        storeId,
        tableId,
        tableName,
        periodId,
        periodName,
        durationMinutes
      });

      setMenuOverrideOpen(false);
    } catch (error) {
      console.error('Failed to save table menu override:', error);
      alert('時間帯メニューの変更に失敗しました。通信状況を確認して、もう一度お試しください。');
    } finally {
      setMenuOverrideProcessing(false);
    }
  };

  const handleTableAction = (tableId) => {
    const targetTableId = String(tableId || '').trim();
    if (!targetTableId) return;

    if (movingSession) {
      moveSessionToTable({
        session: movingSession,
        nextTableId: targetTableId
      });
      return;
    }

    const session = getSessionByTableId(targetTableId);
    if (session) {
      onSelectSession(session.id);
    }
  };

  const handleTableLongPress = (tableId) => {
    const targetTableId = String(tableId || '').trim();
    if (!targetTableId) return;

    const session = getSessionByTableId(targetTableId);

    // 空席を長押ししても移動元にはしない
    if (!session) return;

    setMovingSession(session);
    setMoveError('');
  };


  // バーコード/卓番号の確定処理(手入力Enter・グローバルスキャナ共通)。
  const processScannedValue = (raw) => {
    const normalizedInput = normalizeScannedCode(raw).trim();
    if (!normalizedInput) return;

    // POSレジ、またはテイクアウト会計中はバーコードを会計リストへ直接追加する。
    if (registerMode === 'pos' || isTakeoutMode) {
      addPosProductByCode(normalizedInput);
      return;
    }
    onScanSession(normalizedInput);
  };

  const handleScanSubmit = (event) => {
    event.preventDefault();
    if (!scanInput.trim()) return;
    processScannedValue(scanInput);
    setScanInput('');
  };

  // レジ画面表示中、フォーカス位置に関係なくバーコードリーダーの読取を捕捉して即実行する。
  // スキャナ=高速連続入力(短間隔)＋Enterで終端、という特性で手入力と区別する。
  const scanCaptureActiveRef = useRef(false);
  const runGlobalScanRef = useRef(() => {});
  useEffect(() => {
    scanCaptureActiveRef.current = registerMode === 'pos' || isTakeoutMode;
    runGlobalScanRef.current = (value) => {
      inputRef.current?.focus();
      setScanInput(value);
      processScannedValue(value);
      setScanInput('');
    };
  });

  useEffect(() => {
    let buffer = '';
    let lastTime = 0;
    const SCAN_INTERVAL_MS = 40; // これより速い連続入力＝スキャナ
    const MIN_SCAN_LENGTH = 3;

    const onKeyDown = (event) => {
      if (!scanCaptureActiveRef.current) { buffer = ''; return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;

      if (event.key === 'Enter') {
        if (buffer.length >= MIN_SCAN_LENGTH && gap < SCAN_INTERVAL_MS) {
          event.preventDefault();
          event.stopPropagation();
          const value = buffer;
          buffer = '';
          runGlobalScanRef.current(value);
        } else {
          buffer = '';
        }
        return;
      }

      if (event.key.length === 1) {
        if (gap > SCAN_INTERVAL_MS) buffer = ''; // 新しい入力列
        buffer += event.key;
        // 入力欄にフォーカス中は手入力を壊さないので奪わない。
        // 非入力要素にフォーカス中(=どこにも入らない)のみ横取りして取りこぼしを防ぐ。
        const el = document.activeElement;
        const editable = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!editable) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const handleMouseDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!isDragging || !containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const newRatio = (event.clientX / containerWidth) * 100;

      if (newRatio > 30 && newRatio < 75) {
        setSplitRatio(newRatio);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!mapWrapperRef.current) return undefined;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMapDimensions({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height)
        });
      }
    });

    resizeObserver.observe(mapWrapperRef.current);
    return () => resizeObserver.disconnect();
  }, [viewMode]);

  // 中央の会計リスト列。POSレジ・ORDERテイクアウトの両方で共有する。
  const renderTakeoutCartColumn = () => (
    <div className="flex min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-100 p-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowTakeoutDiscountModal(true)}
            disabled={takeoutCart.length === 0}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-black transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
              takeoutDiscountAmount > 0
                ? 'border-orange-200 bg-orange-100 text-orange-700 shadow-sm'
                : 'border-orange-100 bg-orange-50 text-orange-600 hover:border-orange-200 hover:bg-orange-100'
            }`}
          >
            <Percent size={16} />
            割引/金券
          </button>

          <div className="text-right">
            {takeoutDiscountAmount > 0 && (
              <div className="mb-1 flex items-center justify-end gap-2 text-xs font-black text-orange-600">
                <span className="max-w-[160px] truncate">{takeoutDiscountLabel}</span>
                <span className="font-mono">-¥{takeoutDiscountAmount.toLocaleString()}</span>
              </div>
            )}
            <div className="text-xs font-black text-slate-400">税込合計</div>
            <div className="font-mono text-3xl font-black text-slate-900">
              ¥{takeoutCartTotal.toLocaleString()}
            </div>
          </div>
        </div>

        {registerMode === 'pos' && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={holdCurrentPosCart}
              disabled={takeoutCart.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-500 text-xs font-black text-white shadow-sm transition-all hover:bg-amber-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              <PauseCircle size={15} />
              保留する
            </button>
            <button
              type="button"
              onClick={() => {
                setTakeoutCart([]);
                setTakeoutPaymentAmount('');
                setTakeoutPaymentMethod('');
                setActivePosHoldId('');
                setPosMessage('仮伝票をクリアしました。', 'success');
              }}
              disabled={takeoutCart.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-500 shadow-sm transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={15} />
              クリア
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {takeoutCart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-300">
            <ShoppingBag size={56} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-black">
              商品を選択してください
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {takeoutCart.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-800">
                      {item.name}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-400">
                      ¥{Number(item.takeoutPrice || 0).toLocaleString()} / {item.categoryName}
                    </div>
                    {item.sourceType === 'retail' && (
                      <div className="mt-1 text-[11px] font-black text-emerald-600">
                        商品マスター在庫対象 / 在庫 {Number(item.stockQuantity ?? 0).toLocaleString()} / 選択 {Number(item.quantity || 0).toLocaleString()}
                      </div>
                    )}
                    {item.sourceType === 'manual' && (
                      <div className="mt-1 text-[11px] font-black text-slate-400">
                        手入力商品 / 在庫対象外
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeTakeoutCartItem(item.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-red-400 shadow-sm hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                    <button
                      type="button"
                      onClick={() => updateTakeoutCartQuantity(item.id, -1)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    >
                      <Minus size={15} />
                    </button>
                    <span className="w-10 text-center font-mono text-lg font-black text-slate-800">
                      {Number(item.quantity || 0)}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateTakeoutCartQuantity(item.id, 1)}
                      disabled={
                        POS_ENFORCE_STOCK_LIMIT &&
                        registerMode === 'pos' &&
                        item.sourceType === 'retail' &&
                        Number(item.quantity || 0) >= Number(item.stockQuantity || 0)
                      }
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                    >
                      <Plus size={15} />
                    </button>
                  </div>

                  <div className="font-mono text-lg font-black text-slate-900">
                    ¥{(Number(item.takeoutPrice || 0) * Number(item.quantity || 0)).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
    <div ref={containerRef} className="relative flex h-full select-none overflow-hidden bg-slate-100">
      <div style={{ width: `${splitRatio}%` }} className="flex h-full min-w-[300px] flex-col p-4 pr-1">
        <div className="mb-4 flex shrink-0 items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 active:scale-95"
              title="モード選択へ戻る"
              aria-label="モード選択へ戻る"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div className="flex-1 rounded-xl bg-white p-3 shadow-sm">
            <form onSubmit={handleScanSubmit} className="flex items-center gap-2">
              <div className="relative flex-grow">
                <Barcode className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                  ref={inputRef}
                  type="text"
                  value={scanInput}
                  onChange={(event) => setScanInput(normalizeScannedCode(event.target.value))}
                  className="h-11 w-full rounded-lg border-2 border-gray-300 pl-9 pr-3 font-mono text-base"
                  placeholder={registerMode === 'pos' ? 'バーコード / 品番 / SKU をスキャン...' : '卓番号・バーコードをスキャン...'}
                />
              </div>
              <button type="submit" className="h-11 whitespace-nowrap rounded-lg bg-blue-600 px-4 font-bold text-white">
                開く
              </button>
            </form>
          </div>
        </div>

        <div className="relative flex flex-grow flex-col overflow-hidden rounded-xl bg-white shadow-sm">
          {!isTakeoutMode && (
            <div className="z-10 flex items-center justify-between gap-3 border-b bg-gray-50 p-3 font-bold text-gray-700">
              <span>{registerMode === 'pos' ? 'POSレジ' : `利用中テーブル (${displaySessions.length})`}</span>
              {registerMode !== 'pos' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMenuOverrideOpen(true)}
                    className="flex h-9 items-center gap-2 rounded-lg bg-orange-500 px-3 text-xs font-black text-white shadow-sm transition-colors hover:bg-orange-600 active:scale-95"
                  >
                    <Clock size={15} />
                    時間帯メニュー変更
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsTakeoutMode(true)}
                    className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-black text-white shadow-sm transition-colors hover:bg-blue-700 active:scale-95"
                  >
                    <ShoppingBag size={15} />
                    {registerMode === 'pos' ? 'POSレジ' : 'テイクアウト注文'}
                  </button>

                  <button
                    type="button"
                    onClick={openStaffOrderTerminal}
                    className="flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white shadow-sm transition-colors hover:bg-black active:scale-95"
                  >
                    <ClipboardList size={15} />
                    スタッフ注文
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="relative flex-grow overflow-hidden bg-slate-100" ref={mapWrapperRef}>

            {registerMode === 'pos' ? (
              <div className="flex h-full min-h-0 flex-col bg-slate-50">
                <div className="shrink-0 border-b border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">商品入力</div>
                      <div className="mt-1 text-xs font-bold text-slate-400">
                        商品マスターから選択、または手入力で仮伝票に追加します。
                      </div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                      {filteredPosProducts.length}件
                    </div>
                  </div>

                  <div className="grid gap-2 xl:grid-cols-[1fr_160px]">
                    <input
                      value={posProductKeyword}
                      onChange={(event) => setPosProductKeyword(normalizeScannedCode(event.target.value))}
                      placeholder="商品名 / 品番 / バーコードで検索"
                      className="h-11 rounded-xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold text-slate-700 outline-none focus:border-blue-400"
                    />
                    <select
                      value={posProductCategoryId}
                      onChange={(event) => setPosProductCategoryId(event.target.value)}
                      className="h-11 rounded-xl border-2 border-slate-100 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400"
                    >
                      <option value="">すべて</option>
                      {productMasterCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-2">
                  <div className="min-h-0 overflow-y-auto border-r border-slate-100 bg-slate-50/70 p-4">
                    <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">
                      売り場（バーコード未登録商品）
                    </div>
                    {productMasterSalesAreas.length === 0 ? (
                      <div className="mb-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs font-bold text-slate-400">
                        売り場が登録されていません。商品マスター設定で追加してください。
                      </div>
                    ) : (
                      <div className="mb-4 grid grid-cols-2 gap-2">
                        {productMasterSalesAreas.map((salesArea) => (
                          <button
                            key={salesArea.id || salesArea.name}
                            type="button"
                            onClick={() => setUncodedSalesArea(salesArea)}
                            className="flex min-h-[56px] flex-col justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-orange-300 hover:bg-orange-50 active:scale-[0.99]"
                          >
                            <span className="truncate text-sm font-black text-slate-800">
                              {salesArea.displayName || salesArea.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-3">
                      <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">手入力</div>
                      <div className="grid grid-cols-[1fr_120px] gap-2">
                        <input
                          value={posManualName}
                          onChange={(event) => setPosManualName(event.target.value)}
                          placeholder="商品名（任意）"
                          className="h-11 rounded-xl border-2 border-slate-100 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400"
                        />
                        <input
                          type="number"
                          value={posManualPrice}
                          onChange={(event) => setPosManualPrice(event.target.value)}
                          placeholder="金額"
                          className="h-11 rounded-xl border-2 border-slate-100 bg-slate-50 px-3 text-right font-mono text-lg font-black text-slate-900 outline-none focus:border-blue-400"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={addManualPosItem}
                        className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white shadow-sm transition-all hover:bg-black active:scale-[0.98]"
                      >
                        <Plus size={16} />
                        手入力で追加
                      </button>
                    </div>

                    <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">
                      商品リスト（商品マスター）
                    </div>
                    {productMasterLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <LoadingSpinner />
                      </div>
                    ) : filteredPosProducts.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
                        <ShoppingBag size={48} className="text-slate-300" />
                        <p className="mt-3 text-sm font-black text-slate-500">
                          商品が見つかりません
                        </p>
                        <p className="mt-2 text-xs font-bold leading-relaxed text-slate-400">
                          POS設定の商品マスターに商品を登録してください。
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-2 grid-cols-1 2xl:grid-cols-2">
                        {filteredPosProducts.map((product) => {
                          const stockQuantity = Number(product.resolvedStock || 0);
                          const cartQuantity = getRetailCartQuantity(product.id);
                          const isOutOfStock = stockQuantity <= 0;
                          const isReachedCartLimit = cartQuantity >= stockQuantity;
                          const isDisabled = POS_ENFORCE_STOCK_LIMIT && (isOutOfStock || isReachedCartLimit);

                          return (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => addPosProductToCart(product)}
                              disabled={isDisabled}
                              className={`flex min-h-[98px] flex-col justify-between rounded-2xl border p-3 text-left shadow-sm transition-all active:scale-[0.99] ${
                                isDisabled
                                  ? 'cursor-not-allowed border-slate-100 bg-slate-100 opacity-70'
                                  : 'border-slate-100 bg-white hover:border-blue-200 hover:bg-blue-50'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className={`truncate text-sm font-black ${isDisabled ? 'text-slate-400' : 'text-slate-800'}`}>
                                  {product.name || '商品'}
                                </div>
                                <div className="mt-1 truncate text-[11px] font-bold text-slate-400">
                                  {product.sku || product.productCode || product.barcode || product.resolvedCategoryName}
                                </div>
                              </div>
                              <div className="mt-3 flex items-end justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] font-bold text-slate-400">
                                    {product.resolvedCategoryName}
                                  </div>
                                  <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${
                                    isOutOfStock
                                      ? 'bg-red-50 text-red-500'
                                      : isReachedCartLimit
                                        ? 'bg-orange-50 text-orange-500'
                                        : 'bg-emerald-50 text-emerald-600'
                                  }`}>
                                    在庫 {stockQuantity.toLocaleString()} / 選択 {cartQuantity.toLocaleString()}
                                  </div>
                                </div>
                                <span className={`font-mono text-base font-black ${isDisabled ? 'text-slate-400' : 'text-slate-900'}`}>
                                  ¥{Number(product.resolvedPrice || 0).toLocaleString()}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {renderTakeoutCartColumn()}
                </div>
              </div>
            ) : isTakeoutMode ? (
              <>
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm">
                <div className="flex shrink-0 items-center border-b bg-gray-50 px-5 py-3">
                  <button
                    type="button"
                    onClick={closeTakeoutMode}
                    className="flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-500 shadow-sm transition-colors hover:text-gray-800"
                  >
                    <ChevronLeft size={18} className="mr-1" />
                    戻る
                  </button>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-2">
                  <div className="min-h-0 overflow-y-auto border-r border-slate-100 bg-slate-50/70 p-4">
                    <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">
                      カテゴリー
                    </div>
                    {takeoutCategories.length === 0 ? (
                      <div className="mb-5 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs font-bold text-slate-400">
                        テイクアウト価格が設定された商品がありません。
                      </div>
                    ) : (
                      <div className="mb-5 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTakeoutCategoryFilter('')}
                          className={`flex min-h-[56px] flex-col justify-center rounded-2xl border px-4 py-3 text-left text-sm font-black shadow-sm transition-all active:scale-[0.99] ${
                            takeoutCategoryFilter === ''
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50'
                          }`}
                        >
                          すべて
                        </button>
                        {takeoutCategories.map((category) => (
                          <button
                            key={category.id || category.name}
                            type="button"
                            onClick={() => setTakeoutCategoryFilter(category.id)}
                            className={`flex min-h-[56px] flex-col justify-center rounded-2xl border px-4 py-3 text-left text-sm font-black shadow-sm transition-all active:scale-[0.99] ${
                              takeoutCategoryFilter === category.id
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                          >
                            <span className="leading-tight break-words">{category.name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">
                      商品リスト
                    </div>

                    {filteredTakeoutMenuItems.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
                        <p className="text-sm font-black text-slate-500">
                          {takeoutMenuItems.length === 0
                            ? 'テイクアウト価格が設定された商品がありません。'
                            : 'このカテゴリーに商品がありません。'}
                        </p>
                        {takeoutMenuItems.length === 0 && (
                          <p className="mt-2 text-xs font-bold leading-relaxed text-slate-400">
                            メニュー設定で「テイクアウト価格」を入力すると、ここに表示されます。
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredTakeoutMenuItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addTakeoutCartItem(item)}
                            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-blue-200 hover:bg-blue-50 active:scale-[0.99]"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-800">
                                {item.name || '未設定商品'}
                              </div>
                              <div className="mt-1 truncate text-[11px] font-bold text-slate-400">
                                {item.categoryName}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="font-mono text-base font-black text-slate-900">
                                ¥{Number(item.takeoutPrice || 0).toLocaleString()}
                              </span>
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white">
                                <Plus size={17} strokeWidth={3} />
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {renderTakeoutCartColumn()}
                </div>
              </div>
              </>
            ) : (
              <>

            {movingSession && (
              <div className="absolute left-4 right-4 top-4 z-20 rounded-2xl border border-blue-200 bg-white/95 p-4 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-black text-blue-600">
                      <MoveRight size={17} />
                      席移動モード
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate-700">
                      {getTableDisplayLabel(movingSession)} から移動先の空席を選択してください。
                    </p>
                    {moveError && (
                      <p className="mt-2 text-xs font-bold text-red-500">
                        {moveError}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={resetMoveMode}
                    disabled={isMovingTable}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>
            )}

            {viewMode === 'list' ? (
              <div className="grid h-full grid-cols-1 content-start gap-3 overflow-y-auto p-3 xl:grid-cols-2">
                {displaySessions.map((session) => {
                  const isMoveSource = movingSession?.id === session.id;

                  return (
                    <div
                      key={session.id}
                      className={`rounded-xl border bg-white p-3 text-left shadow-sm transition-all ${
                        isMoveSource ? 'border-blue-500 ring-2 ring-blue-200' : 'hover:bg-blue-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <div>
                          <span className="block text-lg font-bold">
                            {getTableDisplayLabel(session)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {session.createdAt?.toLocaleTimeString?.() || '--:--'} 開始
                          </span>
                        </div>
                        <ChevronLeft className="rotate-180 text-gray-300" />
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMovingSession(session);
                          setMoveError('');
                          setViewMode('map');
                        }}
                        className={`mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-black transition-all ${
                          isMoveSource
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                      >
                        <MoveRight size={15} />
                        席移動
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                {mapLoading ? (
                  <LoadingSpinner size={24} className="m-auto" />
                ) : (
                  mapDimensions.width > 0 &&
                  mapDimensions.height > 0 && (
                    <FloorMapCanvas
                      key={`map-${mapDimensions.width}-${mapDimensions.height}`}
                      mode="view"
                      items={layoutItems}
                      sessions={displaySessions}
                      orders={orders}
                      calls={calls}
                      checks={checks}
                      tableMenuOverrides={tableMenuOverrides}
                      width={mapDimensions.width}
                      height={mapDimensions.height}
                      darkTheme={false}
                      movingTableId={movingSession?.tableId || null}
                      onTableSelect={handleTableAction}
                      onTableLongPress={handleTableLongPress}
                    />
                  )
                )}
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-20 -ml-2 mr-[-8px] flex w-4 items-center justify-center">
        <div
          className={`h-12 w-1.5 cursor-col-resize rounded-full shadow-sm transition-all ${
            isDragging ? 'scale-110 bg-blue-500' : 'bg-gray-300 hover:bg-gray-400'
          }`}
          onMouseDown={handleMouseDown}
        />
      </div>

      <div style={{ width: `${100 - splitRatio}%` }} className="flex h-full min-w-[300px] flex-col p-4 pl-1">
        {isTakeoutMode ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b bg-gray-50 px-4 py-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <ShoppingBag size={22} />
                  {registerMode === 'pos' ? 'POS会計' : 'テイクアウト会計'}
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  左側で選択した商品を、通常レジと同じ流れで精算します。
                </p>
              </div>

              <button
                type="button"
                onClick={closeTakeoutMode}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={registerMode === 'pos' ? 'POS会計を閉じる' : 'テイクアウト会計を閉じる'}
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-400">
                  <span>商品 {takeoutCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString()}点</span>
                  {takeoutDiscountAmount > 0 && (
                    <span>割引 -¥{takeoutDiscountAmount.toLocaleString()}</span>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="shrink-0 text-sm font-black text-slate-600">お支払い額</span>
                  <span className="min-w-0 truncate font-mono text-4xl font-black tracking-tight text-slate-900">
                    ¥{takeoutCartTotal.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50 p-2 shadow-sm">
                <div className="grid grid-cols-3 gap-2">
                  {TAKEOUT_PAYMENT_METHOD_OPTIONS.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setTakeoutPaymentMethod(method.id)}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-black transition-all active:scale-[0.98] ${
                        takeoutPaymentMethod === method.id
                          ? method.activeClassName
                          : method.inactiveClassName
                      }`}
                    >
                      <method.icon size={15} />
                      {method.label}
                    </button>
                  ))}
                </div>
              </div>

              {takeoutPaymentMethod === 'cash' ? (
                <div className="flex min-h-0 flex-col pb-2">
                  <div className="mb-3 shrink-0 rounded-xl border-2 border-gray-200 bg-gray-50 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0 rounded-xl bg-white px-3 py-3 shadow-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="shrink-0 text-xs font-bold text-gray-500">お預かり</span>
                          <span className="min-w-0 truncate text-right font-mono text-3xl font-black tracking-tight text-gray-900">
                            ¥{(Number(takeoutPaymentAmount) || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0 rounded-xl bg-white px-3 py-3 shadow-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="shrink-0 text-xs font-bold text-gray-500">おつり</span>
                          <span className={`min-w-0 truncate text-right font-mono text-3xl font-black tracking-tight ${takeoutChangeAmount < 0 ? 'text-red-500' : 'text-blue-600'}`}>
                            ¥{takeoutChangeAmount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid min-h-[300px] grid-cols-[96px_1fr] gap-2">
                    <div className="grid grid-rows-4 gap-1.5">
                      {[1000, 5000, 10000].map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => setTakeoutPaymentAmount((previous) => String((parseInt(previous, 10) || 0) + amount))}
                          className="min-h-[56px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-black text-gray-600 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
                        >
                          +{amount.toLocaleString()}
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => setTakeoutPaymentAmount(String(takeoutCartTotal))}
                        className="min-h-[56px] rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-black text-blue-600 shadow-sm transition-all hover:bg-blue-100 active:scale-95"
                      >
                        ちょうど
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((number) => (
                        <button
                          key={number}
                          type="button"
                          onClick={() => setTakeoutPaymentAmount((previous) => `${previous}${number}`)}
                          className="min-h-[56px] rounded-xl border border-gray-200 bg-white text-xl font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
                        >
                          {number}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setTakeoutPaymentAmount((previous) => `${previous}0`)}
                        className="min-h-[56px] rounded-xl border border-gray-200 bg-white text-xl font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={() => setTakeoutPaymentAmount((previous) => `${previous}00`)}
                        className="min-h-[56px] rounded-xl border border-gray-200 bg-white text-lg font-bold text-gray-600 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
                      >
                        00
                      </button>
                      <button
                        type="button"
                        onClick={() => setTakeoutPaymentAmount((previous) => previous.slice(0, -1))}
                        className="min-h-[56px] rounded-xl border border-red-100 bg-red-50 text-sm font-black text-red-500 shadow-sm transition-all hover:bg-red-100 active:scale-95"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`mb-3 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-dashed ${
                  selectedTakeoutPaymentMethodOption?.panelClassName || 'border-gray-200 bg-gray-50 text-gray-400'
                }`}>
                  {!takeoutPaymentMethod && (
                    <>
                      <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-white text-gray-300 shadow-sm">
                        <CreditCard size={52} />
                      </div>
                      <p className="text-xl font-black text-gray-700">支払い方法を選択</p>
                      <p className="mt-2 text-sm font-bold text-gray-400">
                        現金・カード・QRのいずれかを選んでください
                      </p>
                    </>
                  )}

                  {takeoutPaymentMethod && selectedTakeoutPaymentMethodOption && (
                    <>
                      <div className={`mb-4 flex h-28 w-28 items-center justify-center rounded-[2rem] ${selectedTakeoutPaymentMethodOption.panelIconClassName}`}>
                        {TakeoutPaymentIcon ? <TakeoutPaymentIcon size={64} strokeWidth={2.5} /> : <CreditCard size={64} strokeWidth={2.5} />}
                      </div>
                      <p className={`text-2xl font-black ${selectedTakeoutPaymentMethodOption.panelTitleClassName}`}>
                        {selectedTakeoutPaymentMethodOption.label}
                      </p>
                      <p className={`mt-2 text-sm font-bold ${selectedTakeoutPaymentMethodOption.panelTextClassName}`}>
                        {selectedTakeoutPaymentMethodOption.label}でテイクアウト注文を会計します。
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-gray-200 bg-gray-50 p-3">
              <button
                type="button"
                disabled={
                  takeoutCart.length === 0 ||
                  !takeoutPaymentMethod ||
                  isTakeoutSubmitting ||
                  (takeoutPaymentMethod === 'cash' && (Number(takeoutPaymentAmount) || 0) < takeoutCartTotal)
                }
                onClick={handleSubmitTakeoutTransaction}
                className={`flex min-h-[56px] w-full items-center justify-center gap-3 rounded-xl px-3 text-lg font-black shadow-lg transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none ${takeoutPaymentActionClassName}`}
              >
                <Check size={24} />
                {isTakeoutSubmitting
                  ? '会計処理中...'
                  : takeoutCart.length === 0
                    ? '商品を選択してください'
                    : takeoutPaymentActionLabel}
                {isTakeoutSubmitting && (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <PosTransactionHistoryPage
            storeId={storeId}
            ownRegisterId={activeRegister?.id}
            registers={allRegisters}
            posHolds={posHolds}
            onResumeHold={restorePosHold}
            onDeleteHold={deletePosHold}
          />
        )}
      </div>
    </div>

    <PosModals
      showSuccessModal={false}
      setShowSuccessModal={() => {}}
      lastTransaction={null}
      setPaymentAmount={setTakeoutPaymentAmount}
      showSplitModal={false}
      setShowSplitModal={() => {}}
      totalAmount={takeoutCartRawTotal}
      splitCount={2}
      setSplitCount={() => {}}
      showDiscountModal={showTakeoutDiscountModal}
      setShowDiscountModal={setShowTakeoutDiscountModal}
      discounts={discounts}
      setDiscountType={setTakeoutDiscountType}
      setDiscountValue={setTakeoutDiscountValue}
      setSelectedDiscount={setTakeoutSelectedDiscount}
      discountQuantities={takeoutDiscountQuantities}
      setDiscountQuantities={setTakeoutDiscountQuantities}
      showAbortModal={false}
      setShowAbortModal={() => {}}
      abortReason="manual_abort"
      setAbortReason={() => {}}
      onConfirmAbort={() => {}}
      tableId="takeout"
      tableDisplayName="テイクアウト"
    />


    <TableMenuOverrideModal
      open={menuOverrideOpen}
      periods={periods}
      layoutItems={layoutItems}
      activeSessions={displaySessions}
      processing={menuOverrideProcessing}
      onClose={() => setMenuOverrideOpen(false)}
      onApply={handleApplyTableMenuOverride}
    />

    {uncodedSalesArea && (
      <UncodedSaleModal
        open
        salesArea={uncodedSalesArea}
        productCategoryGroups={productMasterCategoryGroups}
        productCategories={productMasterCategories}
        onClose={() => setUncodedSalesArea(null)}
        onConfirm={addUncodedItemToCart}
      />
    )}
    </>
  );
};
