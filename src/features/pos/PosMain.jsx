import React, { useState, useRef, useEffect, useMemo } from 'react';
import { getTableDisplayName, getTableDisplayLabel } from '../../shared/utils/tableDisplay';
import { collection, doc, getDocs, increment, limit, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Barcode, ChevronLeft, MoveRight, X, Clock, ShoppingBag, Plus, Minus, Trash2, DollarSign, CreditCard, ScanQrCode, Check, ClipboardList, PauseCircle, RotateCcw, Percent, Star } from 'lucide-react';

import { getActiveRegisterContext, getAvailableRegisters, getAvailableDepartments } from './utils/registerContext';
import { db } from '../../shared/api/firebase/client';
import { normalizeScannedCode } from '../../shared/utils/halfWidth';
import { useGlobalBarcodeScanner } from '../../shared/hooks/useGlobalBarcodeScanner';
import { useScannerBufferedInput } from '../../shared/hooks/useScannerBufferedInput';

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
  splitTaxIncludedAmount,
  resolveModeTaxSettings,
  computeLineTaxBreakdown
} from '../../shared/utils/tax';
import { useKitchenBoard } from '../kitchen/hooks/useKitchenBoard';
import { useTableMenuOverrides } from './hooks/useTableMenuOverrides';
import PosTransactionHistoryPage from './pages/PosTransactionHistoryPage';
import UncodedSaleModal from './components/UncodedSaleModal';
import PosFavoritesModal from './components/PosFavoritesModal';
import { PosModals } from './PosRegister/components/PosModals';
import { computePaymentSplit, getSplitActionLabel, getSplitMethodLabel } from './utils/paymentSplit';

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

// 1カート行の金額figure。商品個別割引(lineDiscount, percentのみ)を適用した
// 税込/税抜/税(割引後)と、割引前税込(includedRaw)・割引額(discountMoney=税込)を返す。
// 割引は入力ライン額(価格×数量)に対して適用するため、無割引時は従来計算と完全に一致する。
const computeCartLineFigures = (item, modeTax, registerMode) => {
  const price = Number(item.takeoutPrice ?? item.unitPrice ?? item.priceTaxIncluded ?? 0);
  const quantity = Number(item.quantity || 0);
  const lineAmount = price * quantity;
  const itemRate = Number.isFinite(Number(item.taxRate)) && Number(item.taxRate) > 0
    ? Number(item.taxRate)
    : (registerMode === 'order' ? modeTax.reducedRate : modeTax.standardRate);

  const ld = item.lineDiscount;
  const pct = ld && ld.type === 'percent'
    ? Math.max(0, Math.min(100, Number(ld.value) || 0))
    : 0;
  const discountInput = pct > 0 ? Math.floor(lineAmount * (pct / 100)) : 0;
  const netInput = Math.max(0, lineAmount - discountInput);

  const rawBreakdown = computeLineTaxBreakdown(lineAmount, itemRate, modeTax.priceBase, modeTax.rounding);
  const netBreakdown = computeLineTaxBreakdown(netInput, itemRate, modeTax.priceBase, modeTax.rounding);
  const discountMoney = Math.max(0, rawBreakdown.includedAmount - netBreakdown.includedAmount);

  return {
    itemRate,
    isReducedItem: itemRate <= modeTax.reducedRate,
    includedRaw: rawBreakdown.includedAmount,
    includedNet: netBreakdown.includedAmount,
    baseNet: netBreakdown.baseAmount,
    taxNet: netBreakdown.taxAmount,
    discountPercent: pct,
    discountMoney
  };
};

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
    brands: productMasterBrands = [],
    suppliers: productMasterSuppliers = [],
    loading: productMasterLoading
    // POSレジは商品リストを表示しないため、重い products 購読をスキップする。
    // バーコード検索は Firestore 直接検索(searchKeywords)で動作する。
  } = useProductMasterData(storeId, { includeProducts: registerMode !== 'pos' });
  const { discounts } = useDiscountData(storeId) || { discounts: [] };
  // 既定は右ペイン=履歴。POSでも待機中は履歴を表示し、商品がカートに入ったら会計画面へ切替える。
  const [isTakeoutMode, setIsTakeoutMode] = useState(false);
  const [posProductMessage, setPosProductMessage] = useState(null);
  // バーコード未登録商品の会計モーダル(売り場起点・POSレジ用)。null=閉
  const [uncodedSalesArea, setUncodedSalesArea] = useState(null);
  // お気に入り(よく売る商品)モーダルの開閉。
  const [favoritesModalOpen, setFavoritesModalOpen] = useState(false);
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
  // 商品個別割引(percent)モーダルの対象カート行ID。null=閉。
  const [lineDiscountTargetId, setLineDiscountTargetId] = useState(null);
  const [lineDiscountManualValue, setLineDiscountManualValue] = useState('');
  // 単品割引の会計区分(売上値引き/販促費)。
  const [lineDiscountCategory, setLineDiscountCategory] = useState('sales_discount');
  const [isTakeoutSubmitting, setIsTakeoutSubmitting] = useState(false);
  // 全額売掛のワンタップ会計: stateを全額売掛に切り替えた後、派生値(memo)が更新されてから会計確定を発火する。
  const [pendingTakeoutFullCredit, setPendingTakeoutFullCredit] = useState(false);
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
      // 日計「売り場別売上」用に売り場・カテゴリーグループを明細へ保存する。
      salesAreaId: product.salesAreaId || '',
      salesAreaName: product.salesAreaName || '',
      categoryGroupId: product.categoryGroupId || '',
      categoryGroupName: product.categoryGroupName || '',
      // 原価計算(掛け率連鎖)用: ブランド・商品固有掛け率・商品個別原価(単価)を明細へ持たせる。
      brandId: product.brandId || '',
      brandName: product.brandName || '',
      productSupplierCostRate: Number.isFinite(Number(product.supplierCostRate)) ? Number(product.supplierCostRate) : null,
      productCostTaxIncludedUnit: Number.isFinite(Number(product.costTaxIncluded)) ? Number(product.costTaxIncluded) : null,
      productCostTaxExcludedUnit: Number.isFinite(Number(product.costTaxExcluded)) ? Number(product.costTaxExcluded) : null,
      takeoutPrice: Number(product.resolvedPrice || 0),
      unitPrice: Number(product.resolvedPrice || 0),
      priceTaxIncluded: Number(product.resolvedPrice || 0),
      taxRate: Number.isFinite(Number(product.taxRate)) ? Number(product.taxRate) : null,
      barcode: product.barcode || '',
      sku: product.sku || product.productCode || '',
      stockQuantity,
      quantity: 1
    });

    setPosMessage(`${product.name || '商品'} を追加しました。`, 'success');
    return true;
  };

  // バーコード未登録商品(売り場→分類選択＋金額・数量手入力)を会計リストへ追加する。
  const addUncodedItemToCart = ({ salesAreaId, salesAreaName, categoryGroupId, categoryGroupName, categoryId, categoryName, price, quantity }) => {
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
      taxRate: resolveCategoryTaxRate(categoryId),
      // 日計「売り場別売上」用に売り場・カテゴリーグループを明細へ保存する。
      salesAreaId: salesAreaId || '',
      salesAreaName: salesAreaName || '',
      categoryGroupId: categoryGroupId || '',
      categoryGroupName: categoryGroupName || '',
      quantity: normalizedQuantity
    });

    setUncodedSalesArea(null);
    setPosMessage(`${label} を会計リストに追加しました。`, 'success');
  };

  // カテゴリー(→所属グループ)の税率設定から税率を解決する。FOOD等の軽減=8%、既定=標準10%。
  const resolveCategoryTaxRate = (categoryId) => {
    const reducedTax = Number(storeSettings?.taxRateReduced ?? 8);
    const standardTax = Number(storeSettings?.taxRate ?? 10);
    const category = (productMasterCategories || []).find((c) => c.id === categoryId);
    const groupId = category?.groupId || category?.categoryGroupId;
    const group = (productMasterCategoryGroups || []).find((g) => g.id === groupId);
    const ownType = category?.taxRateType && category.taxRateType !== 'inherit' ? category.taxRateType : '';
    const type = ownType || group?.taxRateType || '';
    if (type === 'reduced') return reducedTax;
    if (type === 'taxFree') return 0;
    return standardTax;
  };

  // メモリ(直近200件)に無い商品を Firestore から直接引くための整形。
  const buildResolvedPosProduct = (raw) => ({
    ...raw,
    resolvedPrice: Number(raw.priceTaxIncluded ?? raw.price ?? 0) || 0,
    resolvedStock: getProductStockQuantity(raw),
    resolvedCategoryName: posCategoryNameMap[raw.categoryId] || raw.categoryName || 'カテゴリー'
  });

  const addPosProductByCode = async (codeText) => {
    const rawCode = String(codeText || '').trim();
    const normalizedCode = rawCode.toLowerCase();
    if (!normalizedCode) return false;

    // スキャン値と「バーコード/SKU/品番が完全一致」する商品を探す。
    // 同一SKUグループは sku/productCode(=ブランド名)を共有するため、まず barcode の
    // 完全一致を最優先し、無ければ sku/productCode の完全一致でフォールバックする。
    const exactFieldMatch = (product, field) => (
      String(product?.[field] || '').trim().toLowerCase() === normalizedCode
    );
    let matchedProduct = activePosProducts.find((product) => exactFieldMatch(product, 'barcode'))
      || activePosProducts.find((product) => (
        exactFieldMatch(product, 'sku') || exactFieldMatch(product, 'productCode')
      ));

    // メモリ(直近200件)に無ければ Firestore を直接検索する。
    // barcode 等の単一フィールドはインデックス対象外のため、検索用の searchKeywords(配列)で引く。
    // ただし searchKeywords は前方一致(prefix)・ブランド名・品名断片も含むため、
    // limit(1) の先頭ではなく「完全一致(バーコード優先)」を選び、別バリアントの先頭価格を拾わないようにする。
    if (!matchedProduct && storeId) {
      try {
        const productsRef = collection(db, 'stores', storeId, 'products');
        const candidates = Array.from(new Set([rawCode, normalizedCode])).filter(Boolean);
        for (const term of candidates) {
          const termLower = String(term).trim().toLowerCase();
          const snapshot = await getDocs(query(productsRef, where('searchKeywords', 'array-contains', term), limit(30)));
          if (snapshot.empty) continue;

          const docs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
          const eq = (product, field) => String(product?.[field] || '').trim().toLowerCase() === termLower;
          const resolved = docs.find((product) => eq(product, 'barcode'))
            || docs.find((product) => eq(product, 'sku') || eq(product, 'productCode'))
            || docs[0];
          matchedProduct = buildResolvedPosProduct(resolved);
          break;
        }
      } catch (error) {
        console.error('[pos barcode lookup]', error);
      }
    }

    if (!matchedProduct) {
      setPosMessage('商品マスターに一致するバーコード / 品番 / SKU がありません。', 'error');
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

  // 各カート行のfigure(個別割引・税込/税抜/税)。価格が税抜入力(priceBase=taxExcluded)でも税込で算出する。
  const takeoutCartLineFigures = useMemo(() => {
    const modeTax = resolveModeTaxSettings(storeSettings, registerMode === 'pos' ? 'pos' : 'order');
    return takeoutCart.map((item) => ({
      item,
      figures: computeCartLineFigures(item, modeTax, registerMode)
    }));
  }, [takeoutCart, storeSettings, registerMode]);

  // カート合計(全割引前・税込)。
  const takeoutCartRawTotal = useMemo(() => (
    takeoutCartLineFigures.reduce((sum, { figures }) => sum + Number(figures.includedRaw || 0), 0)
  ), [takeoutCartLineFigures]);

  // 商品個別割引の合計(税込)。
  const takeoutLineDiscountTotal = useMemo(() => (
    takeoutCartLineFigures.reduce((sum, { figures }) => sum + Number(figures.discountMoney || 0), 0)
  ), [takeoutCartLineFigures]);

  // 個別割引適用後の小計(税込)。全体割引はこの残額に対して掛ける。
  const takeoutSubtotalAfterLine = useMemo(() => (
    Math.max(Number(takeoutCartRawTotal || 0) - Number(takeoutLineDiscountTotal || 0), 0)
  ), [takeoutCartRawTotal, takeoutLineDiscountTotal]);

  // 個別割引の値引き額を会計区分ごとに保持(日計の区分別集計用)。
  const takeoutLineDiscountItems = useMemo(() => (
    takeoutCartLineFigures
      .filter(({ figures }) => Number(figures.discountMoney || 0) > 0)
      .map(({ item, figures }) => ({
        id: item.lineDiscount?.discountId || null,
        name: item.lineDiscount?.name
          ? `${item.name} / ${item.lineDiscount.name}`
          : `${item.name} ${figures.discountPercent}%OFF`,
        accountingCategory: item.lineDiscount?.accountingCategory || 'sales_discount',
        amount: Number(figures.discountMoney || 0)
      }))
  ), [takeoutCartLineFigures]);

  // 全体割引は「個別割引適用後の小計(残額)」に対して計算する(個別→残額に全体でスタック)。
  const takeoutDiscountAmount = useMemo(() => {
    const base = Number(takeoutSubtotalAfterLine || 0);
    if (base <= 0) return 0;

    if (takeoutDiscountType === 'percent') {
      return Math.min(
        base,
        Math.floor(base * ((Number(takeoutDiscountValue) || 0) / 100))
      );
    }

    if (takeoutDiscountType === 'amount') {
      return Math.min(base, Number(takeoutDiscountValue || 0));
    }

    return 0;
  }, [takeoutSubtotalAfterLine, takeoutDiscountType, takeoutDiscountValue]);

  const takeoutCartTotal = useMemo(() => (
    Math.max(Number(takeoutSubtotalAfterLine || 0) - Number(takeoutDiscountAmount || 0), 0)
  ), [takeoutSubtotalAfterLine, takeoutDiscountAmount]);

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
  // 現金預かりを入れたままカード/QRタブへ移ったら「現金＋カード/QR」の分割会計にする。
  const takeoutPaymentSplit = useMemo(
    () => computePaymentSplit(takeoutPaymentMethod, takeoutPaymentAmount, takeoutCartTotal),
    [takeoutPaymentMethod, takeoutPaymentAmount, takeoutCartTotal]
  );
  const takeoutPaymentActionLabel = takeoutPaymentSplit.isSplit
    ? getSplitActionLabel(takeoutPaymentSplit.otherMethod)
    : (selectedTakeoutPaymentMethodOption?.buttonLabel || '支払い方法を選択してください');
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

          // 在庫制限は POS_ENFORCE_STOCK_LIMIT で一括ON/OFF。棚卸し中など在庫が
          // 未確立(0/不正確)の段階では false にして数量を増やせるようにする。
          // 追加パス・+ボタンの disabled と条件を揃える。
          if (
            POS_ENFORCE_STOCK_LIMIT &&
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

  // 商品個別割引(percent)を対象カート行に適用/解除する。
  const applyLineDiscount = (itemId, lineDiscount) => {
    setTakeoutCart((current) => current.map((item) => (
      item.id === itemId ? { ...item, lineDiscount } : item
    )));
  };

  const clearLineDiscount = (itemId) => {
    setTakeoutCart((current) => current.map((item) => {
      if (item.id !== itemId) return item;
      const next = { ...item };
      delete next.lineDiscount;
      return next;
    }));
  };

  const lineDiscountTarget = useMemo(
    () => takeoutCart.find((item) => item.id === lineDiscountTargetId) || null,
    [takeoutCart, lineDiscountTargetId]
  );

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
      // 現金＋カード/QR の分割会計。成立時は payments[] に現金/カードの内訳を持たせて記録する。
      const paymentSplit = computePaymentSplit(takeoutPaymentMethod, takeoutPaymentAmount, takeoutCartTotal);
      const paymentMethodLabel = paymentSplit.isSplit
        ? `現金＋${getSplitMethodLabel(paymentSplit.otherMethod)}`
        : takeoutPaymentMethod === 'credit'
          ? '売掛'
          : (selectedPaymentOption?.label || takeoutPaymentMethod);
      const paymentAmountNumber = takeoutPaymentMethod === 'cash'
        ? Number(takeoutPaymentAmount || 0)
        : Number(takeoutCartTotal);
      const modeTax = resolveModeTaxSettings(storeSettings, registerMode === 'pos' ? 'pos' : 'order');
      const reducedTax = modeTax.reducedRate;
      const standardTax = modeTax.standardRate;
      const taxRounding = modeTax.rounding;
      const transactionRef = doc(collection(db, 'stores', storeId, 'transactions'));
      const sessionId = `takeout-${transactionRef.id}`;
      const nowIso = new Date().toISOString();
      const businessDate = nowIso.slice(0, 10);

      // 原価(掛け率)連鎖の解決。優先度: 商品個別原価 > 商品掛け率 > ブランド掛け率 > 仕入先掛け率 > 売り場原価率。
      // 既存の掛け率(brand/supplier.defaultCostRate, product.supplierCostRate)は読むだけ(編集中の値は上書きしない)。
      const pickRate = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
      const brandById = new Map();
      (productMasterBrands || []).forEach((brand) => {
        if (brand?.id) brandById.set(String(brand.id), brand);
      });
      const supplierById = new Map();
      (productMasterSuppliers || []).forEach((supplier) => {
        if (supplier?.id) supplierById.set(String(supplier.id), supplier);
      });
      const salesAreaRateById = new Map();
      const salesAreaRateByName = new Map();
      (productMasterSalesAreas || []).forEach((area) => {
        const rate = pickRate(area?.costRate);
        if (rate === null) return;
        if (area.id) salesAreaRateById.set(String(area.id), rate);
        if (area.name) salesAreaRateByName.set(String(area.name), rate);
      });
      const resolveSalesAreaRate = (item) => {
        if (item.salesAreaId && salesAreaRateById.has(String(item.salesAreaId))) return salesAreaRateById.get(String(item.salesAreaId));
        if (item.salesAreaName && salesAreaRateByName.has(String(item.salesAreaName))) return salesAreaRateByName.get(String(item.salesAreaName));
        return null;
      };
      const resolveItemCost = (item) => {
        // 1) 商品個別原価(単価・登録あれば)＝正確な原価。
        const unitIncl = pickRate(item.productCostTaxIncludedUnit);
        if (unitIncl !== null) {
          const unitExcl = pickRate(item.productCostTaxExcludedUnit);
          return { source: 'product_cost', unitIncl, unitExcl: unitExcl !== null ? unitExcl : unitIncl, rate: null };
        }
        // 2) 掛け率連鎖。
        const brand = item.brandId ? brandById.get(String(item.brandId)) : null;
        const supplier = brand?.supplierId ? supplierById.get(String(brand.supplierId)) : null;
        const productRate = pickRate(item.productSupplierCostRate);
        if (productRate !== null) return { source: 'product_rate', rate: productRate };
        const brandRate = pickRate(brand?.defaultCostRate);
        if (brandRate !== null) return { source: 'brand_rate', rate: brandRate };
        const supplierRate = pickRate(supplier?.defaultCostRate);
        if (supplierRate !== null) return { source: 'supplier_rate', rate: supplierRate };
        const areaRate = resolveSalesAreaRate(item);
        if (areaRate !== null) return { source: 'sales_area_rate', rate: areaRate };
        return { source: null, rate: null };
      };

      // 商品ごとの税率・商品個別割引(percent)を適用して明細を作る。
      // totalPrice/salesTax* は個別割引後の税込/税抜/税。元の税込は originalLineTotal に保持。
      const items = takeoutCart.map((item) => {
        const quantity = Number(item.quantity || 1);
        const figures = computeCartLineFigures(item, modeTax, registerMode);
        const itemRate = figures.itemRate;
        const isReducedItem = figures.isReducedItem;
        const hasLineDiscount = Number(figures.discountMoney || 0) > 0;

        // 原価スナップ: 掛け率連鎖(商品原価>商品掛け率>ブランド>仕入先>売り場)で原価を算出して保存する。
        // 集計(日計)はこのスナップを読むため、ここで保存しないと粗利に入らない。
        const costInfo = resolveItemCost(item);
        const hasCost = costInfo.source !== null;
        let costTaxIncludedAmount = null;
        let costTaxExcludedAmount = null;
        let unitCostSnapshot = null;
        let costRateValue = null;
        if (costInfo.source === 'product_cost') {
          unitCostSnapshot = costInfo.unitIncl;
          costTaxIncludedAmount = Math.round(costInfo.unitIncl * quantity);
          costTaxExcludedAmount = Math.round(costInfo.unitExcl * quantity);
        } else if (costInfo.rate !== null) {
          costRateValue = costInfo.rate;
          const costFraction = Math.max(0, Math.min(100, Number(costInfo.rate))) / 100;
          costTaxIncludedAmount = Math.round(figures.includedNet * costFraction);
          costTaxExcludedAmount = Math.round(figures.baseNet * costFraction);
          unitCostSnapshot = Math.round(Number(item.takeoutPrice || 0) * costFraction);
        }
        const grossProfitTaxIncluded = hasCost ? (figures.includedNet - costTaxIncludedAmount) : null;
        const grossProfitTaxExcluded = hasCost ? (figures.baseNet - costTaxExcludedAmount) : null;

        return {
          id: item.id,
          menuItemId: item.id,
          productId: item.productId || '',
          sourceType: item.sourceType || 'takeout',
          name: item.name || '未設定商品',
          categoryId: item.categoryId || '',
          categoryName: item.categoryName || 'カテゴリー未設定',
          salesAreaId: item.salesAreaId || '',
          salesAreaName: item.salesAreaName || '',
          categoryGroupId: item.categoryGroupId || '',
          categoryGroupName: item.categoryGroupName || '',
          unitPrice: Number(item.takeoutPrice || 0),
          quantity,
          totalPrice: figures.includedNet,
          originalLineTotal: figures.includedRaw,
          lineDiscount: hasLineDiscount
            ? {
                type: 'percent',
                value: figures.discountPercent,
                amount: figures.discountMoney,
                discountId: item.lineDiscount?.discountId || null,
                name: item.lineDiscount?.name || `${figures.discountPercent}%OFF`,
                accountingCategory: item.lineDiscount?.accountingCategory || 'sales_discount'
              }
            : null,
          barcode: item.barcode || '',
          sku: item.sku || '',
          stockQuantity: item.stockQuantity ?? null,
          isTakeout: isReducedItem,
          allowsTakeout: true,
          taxRate: itemRate,
          salesTaxRate: itemRate,
          salesTaxRateType: isReducedItem ? 'reduced' : 'standard',
          salesTaxIncludedAmount: figures.includedNet,
          salesTaxExcludedAmount: figures.baseNet,
          salesTaxAmount: figures.taxNet,
          taxIncludedAmount: figures.includedNet,
          // 原価スナップ(掛け率連鎖)。日計の粗利集計はこれを読む。costSource で原価の出所が分かる。
          costPrice: hasCost ? unitCostSnapshot : null,
          costRate: costRateValue,
          costSource: costInfo.source,
          costTaxIncludedAmount,
          costTaxExcludedAmount,
          grossProfitTaxIncluded,
          grossProfitTaxExcluded,
          status: 'paid',
          paymentStatus: 'paid',
          paidAtClient: nowIso
        };
      });

      // 税率ブロック別に集計。明細は個別割引適用後なので、ここで按分するのは全体割引のみ。
      const sumItemsBy = (predicate, key) => items
        .filter(predicate)
        .reduce((sum, it) => sum + Number(it[key] || 0), 0);
      const reducedInclRaw = sumItemsBy((it) => it.salesTaxRateType === 'reduced', 'salesTaxIncludedAmount');
      const standardInclRaw = sumItemsBy((it) => it.salesTaxRateType === 'standard', 'salesTaxIncludedAmount');
      const grossLineTotal = reducedInclRaw + standardInclRaw;
      const discountRatio = grossLineTotal > 0 ? Number(takeoutCartTotal) / grossLineTotal : 1;
      const reducedIncluded = Math.round(reducedInclRaw * discountRatio);
      const standardIncluded = Math.round(standardInclRaw * discountRatio);
      const reducedBreakdown = splitTaxIncludedAmount(reducedIncluded, reducedTax, taxRounding);
      const standardBreakdown = splitTaxIncludedAmount(standardIncluded, standardTax, taxRounding);
      const subTotalAmount = Number(reducedBreakdown.baseAmount) + Number(standardBreakdown.baseAmount);
      const totalTaxAmount = Number(reducedBreakdown.taxAmount) + Number(standardBreakdown.taxAmount);

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

      // 値引き総額を会計区分(売上値引き/販促費/金券・売掛)に振り分ける。
      // テイクアウト経路は従来すべて discountAmount(売上値引き)に寄せていたが、
      // 全額売掛などは voucher_payment として日計で別枠集計する必要があるため分解する。
      // 商品個別割引(takeoutLineDiscountItems)も区分付きでここに合算する。
      const settlementByCategory = { sales_discount: 0, promo_expense: 0, voucher_payment: 0 };
      const totalSettlementAmount = Math.max(
        0,
        (Number(takeoutLineDiscountTotal) || 0) + (Number(takeoutDiscountAmount) || 0)
      );
      if (totalSettlementAmount > 0) {
        const combinedAdjustmentItems = [
          ...takeoutLineDiscountItems,
          ...selectedAccountingAdjustmentItems
        ];
        const allocationItems = combinedAdjustmentItems.length > 0
          ? combinedAdjustmentItems
          : [{ accountingCategory: 'sales_discount', amount: totalSettlementAmount }];
        const rawItemsTotal = allocationItems.reduce(
          (sum, item) => sum + Math.max(Number(item.amount) || 0, 0),
          0
        );

        if (rawItemsTotal > 0) {
          let allocated = 0;
          allocationItems.forEach((item, index) => {
            const category = item.accountingCategory === 'promo_expense' || item.accountingCategory === 'voucher_payment'
              ? item.accountingCategory
              : 'sales_discount';
            const isLast = index === allocationItems.length - 1;
            const portion = isLast
              ? totalSettlementAmount - allocated
              : Math.floor(totalSettlementAmount * (Math.max(Number(item.amount) || 0, 0) / rawItemsTotal));
            settlementByCategory[category] += portion;
            allocated += portion;
          });
        } else {
          settlementByCategory.sales_discount = totalSettlementAmount;
        }
      }

      const salesDiscountFinal = Math.max(0, settlementByCategory.sales_discount);
      const promoExpenseFinal = Math.max(0, settlementByCategory.promo_expense);
      const voucherFinal = Math.max(0, settlementByCategory.voucher_payment);
      const settlementAdjustmentTotalFinal = promoExpenseFinal + voucherFinal;
      const salesAmountBeforeSettlementFinal = Math.max(0, Number(takeoutCartRawTotal) - salesDiscountFinal);
      const voucherItemsFinal = voucherFinal > 0
        ? [{ id: appliedDiscount?.id || 'voucher_payment', name: appliedDiscount?.name || '金券/売掛', amount: voucherFinal, value: voucherFinal, count: 1, quantity: 1 }]
        : [];
      const promoExpenseItemsFinal = promoExpenseFinal > 0
        ? [{ id: appliedDiscount?.id || 'promo_expense', name: appliedDiscount?.name || '販促費', amount: promoExpenseFinal, value: promoExpenseFinal, count: 1, quantity: 1 }]
        : [];

      const taxSummary = {
        reducedTaxRate: Number(reducedTax),
        standardTaxRate: Number(standardTax),
        reducedTaxIncluded: Number(reducedIncluded),
        reducedTaxExcluded: Number(reducedBreakdown.baseAmount),
        reducedTaxAmount: Number(reducedBreakdown.taxAmount),
        standardTaxIncluded: Number(standardIncluded),
        standardTaxExcluded: Number(standardBreakdown.baseAmount),
        standardTaxAmount: Number(standardBreakdown.taxAmount)
      };

      const taxBreakdown = {
        reduced: {
          rate: Number(reducedTax),
          sales: Number(reducedIncluded),
          baseAmount: Number(reducedBreakdown.baseAmount),
          tax: Number(reducedBreakdown.taxAmount)
        },
        standard: {
          rate: Number(standardTax),
          sales: Number(standardIncluded),
          baseAmount: Number(standardBreakdown.baseAmount),
          tax: Number(standardBreakdown.taxAmount)
        }
      };

      const registerContext = getActiveRegisterContext(storeId, storeSettings?.registers, storeSettings?.departments);
      // 売上の部門/モードは「会計時のpos/orderトグル(=売上種別)」で決める。
      // registerId/Name(締め用)は物理レジ(registerContext)のまま。
      const saleMode = registerMode === 'pos' ? 'pos' : 'order';
      const saleDepartment = (() => {
        if (registerContext.registerMode === saleMode) {
          return {
            id: registerContext.departmentId || (saleMode === 'pos' ? 'retail' : 'restaurant'),
            name: registerContext.departmentName || (saleMode === 'pos' ? '物販' : '飲食')
          };
        }
        const dept = getAvailableDepartments(storeSettings?.departments).find((d) => d.registerMode === saleMode);
        return dept
          ? { id: dept.id, name: dept.name }
          : { id: saleMode === 'pos' ? 'retail' : 'restaurant', name: saleMode === 'pos' ? '物販' : '飲食' };
      })();
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
        payments: paymentSplit.payments || null,
        isSplitPayment: paymentSplit.isSplit,
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
        subTotal: Number(subTotalAmount),
        taxAmount: Number(totalTaxAmount),
        taxAmountReduced: Number(reducedBreakdown.taxAmount),
        taxAmountStandard: Number(standardBreakdown.taxAmount),
        discountAmount: Number(salesDiscountFinal),
        promoExpenseAmount: Number(promoExpenseFinal),
        voucherAmount: Number(voucherFinal),
        settlementAdjustmentTotal: Number(settlementAdjustmentTotalFinal),
        salesAmountBeforeSettlementAdjustments: Number(salesAmountBeforeSettlementFinal),
        lineDiscountTotal: Number(takeoutLineDiscountTotal) || 0,
        lineDiscountItems: takeoutLineDiscountItems,
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
          departmentId: saleDepartment.id,
          departmentName: saleDepartment.name,
          registerMode: saleMode,
          salesChannel: saleMode === 'pos' ? 'pos_register' : 'order_register',
          salesChannelLabel: saleMode === 'pos' ? 'POSレジ' : 'ORDERレジ',
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

          subTotal: Number(subTotalAmount),
          subtotal: Number(subTotalAmount),
          rawTotalAmount: Number(takeoutCartRawTotal),
          discountAmount: Number(salesDiscountFinal),
          promoExpenseAmount: Number(promoExpenseFinal),
          voucherAmount: Number(voucherFinal),
          settlementAdjustmentTotal: Number(settlementAdjustmentTotalFinal),
          salesAmountBeforeSettlementAdjustments: Number(salesAmountBeforeSettlementFinal),
          lineDiscountTotal: Number(takeoutLineDiscountTotal) || 0,
          lineDiscountItems: takeoutLineDiscountItems,
          promoExpenseItems: promoExpenseItemsFinal,
          vouchers: voucherItemsFinal,
          totalAmount: Number(takeoutCartTotal),
          totalPrice: Number(takeoutCartTotal),

          taxAmount: Number(totalTaxAmount),
          taxAmountReduced: Number(reducedBreakdown.taxAmount),
          taxAmountStandard: Number(standardBreakdown.taxAmount),
          taxRateReduced: Number(reducedTax),
          taxRateStandard: Number(standardTax),

          totalReducedIncl: Number(reducedIncluded),
          totalStandardIncl: Number(standardIncluded),

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
          paymentMethodLabel,
          ...(paymentSplit.isSplit ? { payments: paymentSplit.payments, isSplitPayment: true } : {}),

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

  // 全額売掛ボタン: 全額を売掛にして即会計確定する。
  // state更新は非同期なので、ここでは全額売掛の状態をセットするだけにし、
  // 派生値(takeoutDiscountAmount等)が反映された後に下のeffectで会計を発火する。
  const requestTakeoutFullCreditCheckout = () => {
    if (takeoutCart.length === 0 || isTakeoutSubmitting) return;
    // 全額売掛は「個別割引適用後の残額」を売掛に計上する。
    const fullAmount = Math.max(0, Math.floor(Number(takeoutSubtotalAfterLine) || 0));
    if (fullAmount <= 0) return;

    setTakeoutDiscountType('amount');
    setTakeoutDiscountValue(fullAmount);
    setTakeoutSelectedDiscount({
      id: 'full_credit',
      name: '全額売掛',
      type: 'full_credit',
      value: fullAmount,
      accountingCategory: 'voucher_payment',
      count: 1,
      quantity: 1,
      amount: fullAmount
    });
    setTakeoutDiscountQuantities({});
    setTakeoutPaymentMethod('credit');
    setTakeoutPaymentAmount('0');
    setPendingTakeoutFullCredit(true);
  };

  useEffect(() => {
    if (!pendingTakeoutFullCredit) return;
    // 全額売掛の状態が反映され、支払方法も売掛に切り替わってから確定する。
    if (takeoutSelectedDiscount?.id !== 'full_credit' || takeoutPaymentMethod !== 'credit') return;
    setPendingTakeoutFullCredit(false);
    handleSubmitTakeoutTransaction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTakeoutFullCredit, takeoutSelectedDiscount, takeoutPaymentMethod]);

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

  // 箱のインクリメンタル検索(POSのみ)の候補。
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // スキャンはグローバル一本化: フォーカス位置に関係なくスキャナ読取をカートへ流す。
  // 検索窓(箱)にフォーカス中はグローバル側は捕捉せず(入力欄を壊さない)、箱自身の
  // バッファ式ハンドラ(posScanKeyDown)がスキャン速度を検出してカートへ流す。
  useGlobalBarcodeScanner({
    active: registerMode === 'pos' || isTakeoutMode,
    onScan: processScannedValue
  });

  // 箱フォーカス中のスキャン: 高速連続入力はバッファして1回でカート確定。
  // 低速の手入力(検索)はそのまま onChange に通す(検索に使う)。
  const posScanKeyDown = useScannerBufferedInput({
    commit: (value) => {
      processScannedValue(value);
      setScanInput('');
      setSearchResults([]);
    }
  });

  // 入力に応じて searchKeywords を前方一致で引き候補表示(250msデバウンス)。
  useEffect(() => {
    if (registerMode !== 'pos' || isTakeoutMode || !storeId) { setSearchResults([]); setSearchLoading(false); return undefined; }
    const term = scanInput.trim().toLowerCase();
    if (term.length < 2) { setSearchResults([]); setSearchLoading(false); return undefined; }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const productsRef = collection(db, 'stores', storeId, 'products');
        const snapshot = await getDocs(query(productsRef, where('searchKeywords', 'array-contains', term), limit(20)));
        if (cancelled) return;
        setSearchResults(snapshot.docs.map((docSnap) => buildResolvedPosProduct({ id: docSnap.id, ...docSnap.data() })));
      } catch (error) {
        if (!cancelled) setSearchResults([]);
        console.error('[pos search]', error);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [scanInput, registerMode, isTakeoutMode, storeId]);

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
    <div className="flex min-h-0 min-w-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-100 p-4">
        {registerMode === 'pos' ? (
          // POSは税込合計を右の会計パネルに集約。ここは 割引・売掛 / 保留 / クリア の3ボタン横並び。
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setShowTakeoutDiscountModal(true)}
              disabled={takeoutCart.length === 0}
              className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border text-xs font-black transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                takeoutDiscountAmount > 0
                  ? 'border-orange-200 bg-orange-100 text-orange-700 shadow-sm'
                  : 'border-orange-100 bg-orange-50 text-orange-600 hover:border-orange-200 hover:bg-orange-100'
              }`}
            >
              <Percent size={15} />
              割引・売掛
            </button>
            <button
              type="button"
              onClick={holdCurrentPosCart}
              disabled={takeoutCart.length === 0}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-amber-500 text-xs font-black text-white shadow-sm transition-all hover:bg-amber-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
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
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-500 shadow-sm transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={15} />
              クリア
            </button>
          </div>
        ) : (
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
              割引・売掛
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
            {takeoutCart.map((item) => {
              const lineAmount = Number(item.takeoutPrice || 0) * Number(item.quantity || 0);
              const linePct = item.lineDiscount?.type === 'percent'
                ? Math.max(0, Math.min(100, Number(item.lineDiscount.value) || 0))
                : 0;
              const lineDiscountInput = linePct > 0 ? Math.floor(lineAmount * (linePct / 100)) : 0;
              const lineNet = Math.max(0, lineAmount - lineDiscountInput);
              const hasLineDiscount = lineDiscountInput > 0;
              return (
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
                    {hasLineDiscount && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-black text-orange-700">
                        <Percent size={11} />
                        {item.lineDiscount?.name
                          ? `${item.lineDiscount.name} (${linePct}%)`
                          : `${linePct}%OFF`}
                        <span className="font-mono">-¥{lineDiscountInput.toLocaleString()}</span>
                      </div>
                    )}
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

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLineDiscountManualValue(hasLineDiscount ? String(linePct) : '');
                        setLineDiscountCategory(item.lineDiscount?.accountingCategory || 'sales_discount');
                        setLineDiscountTargetId(item.id);
                      }}
                      className={`flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-black transition-all active:scale-95 ${
                        hasLineDiscount
                          ? 'border-orange-200 bg-orange-100 text-orange-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600'
                      }`}
                    >
                      <Percent size={13} />
                      割引
                    </button>

                    <div className="text-right">
                      {hasLineDiscount && (
                        <div className="font-mono text-xs font-bold text-slate-400 line-through">
                          ¥{lineAmount.toLocaleString()}
                        </div>
                      )}
                      <div className={`font-mono text-lg font-black ${hasLineDiscount ? 'text-orange-600' : 'text-slate-900'}`}>
                        ¥{lineNet.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
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
                  // POSは商品名(日本語)でも検索するため生テキスト。ORDERは卓番号/バーコードなので従来通り正規化。
                  onChange={(event) => setScanInput(registerMode === 'pos' ? event.target.value : normalizeScannedCode(event.target.value))}
                  onKeyDown={registerMode === 'pos' ? posScanKeyDown : undefined}
                  className="h-11 w-full rounded-lg border-2 border-gray-300 pl-9 pr-3 text-base"
                  placeholder={registerMode === 'pos' ? '商品名 / 品番 / バーコードで検索・スキャン...' : '卓番号・バーコードをスキャン...'}
                />
                {registerMode === 'pos' && scanInput.trim().length >= 2 && (searchLoading || searchResults.length > 0) && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl">
                    {searchResults.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { addPosProductToCart(product); setScanInput(''); setSearchResults([]); }}
                        className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left hover:bg-blue-50 active:bg-blue-100"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-gray-900">{product.name || '商品'}</span>
                          <span className="block truncate text-xs text-gray-400">
                            {[product.barcode, product.sku || product.productCode].filter(Boolean).join(' / ') || 'コードなし'}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-bold text-gray-700">¥{Number(product.resolvedPrice || 0).toLocaleString()}</span>
                      </button>
                    ))}
                    {searchLoading && searchResults.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-400">検索中...</div>
                    )}
                    {!searchLoading && searchResults.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-400">一致する商品がありません</div>
                    )}
                  </div>
                )}
              </div>
              <button type="submit" className="h-11 whitespace-nowrap rounded-lg bg-blue-600 px-4 font-bold text-white">
                開く
              </button>
            </form>
          </div>
        </div>

        <div className="relative flex flex-grow flex-col overflow-hidden rounded-xl bg-white shadow-sm">
          {!isTakeoutMode && registerMode !== 'pos' && (
            <div className="z-10 flex items-center justify-between gap-3 border-b bg-gray-50 p-3 font-bold text-gray-700">
              <span>{`利用中テーブル (${displaySessions.length})`}</span>
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
                {/* iPad小画面でもカートを広く見せるため、売り場カラムは細め(約1/3)・カートを中央で広く。 */}
                <div className="grid min-h-0 flex-1 grid-cols-[minmax(96px,1fr)_minmax(0,2fr)] gap-0">
                  <div className="min-h-0 overflow-y-auto border-r border-slate-100 bg-slate-50/70 p-2">
                    {/* よく売る商品をワンタップで出せるお気に入り(モーダル)。売り場ボタンの一番上に配置。 */}
                    <button
                      type="button"
                      onClick={() => setFavoritesModalOpen(true)}
                      className="mb-2 flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-left shadow-sm transition-all hover:bg-slate-900 active:scale-[0.99]"
                    >
                      <Star size={16} className="shrink-0 text-slate-200" />
                      <span className="text-xs font-black leading-tight text-white">お気に入り</span>
                    </button>

                    {productMasterSalesAreas.length === 0 ? (
                      <div className="mb-4 rounded-xl border border-dashed border-slate-200 bg-white p-3 text-center text-[11px] font-bold text-slate-400">
                        売り場が未登録です。商品マスター設定で追加してください。
                      </div>
                    ) : (
                      <div className="mb-4 grid grid-cols-1 gap-1.5">
                        {productMasterSalesAreas.map((salesArea) => (
                          <button
                            key={salesArea.id || salesArea.name}
                            type="button"
                            onClick={() => setUncodedSalesArea(salesArea)}
                            className="flex min-h-[48px] items-center rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition-all hover:border-orange-300 hover:bg-orange-50 active:scale-[0.99]"
                          >
                            <span className="whitespace-normal break-words text-xs font-black leading-tight text-slate-800">
                              {salesArea.displayName || salesArea.name}
                            </span>
                          </button>
                        ))}
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
            <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-3 border-b bg-gray-50 px-4 py-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <ShoppingBag size={22} />
                  {registerMode === 'pos' ? 'POS会計' : 'テイクアウト会計'}
                </h2>
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
                takeoutPaymentSplit.isSplit ? (
                  <div className="mb-3 flex min-h-[360px] flex-col justify-center gap-3 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-5">
                    <div className="mb-1 text-center text-sm font-black text-blue-700">
                      現金・{getSplitMethodLabel(takeoutPaymentSplit.otherMethod)}の分割会計
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm">
                      <span className="text-sm font-bold text-gray-500">現金預かり</span>
                      <span className="font-mono text-3xl font-black tracking-tight text-gray-900">
                        ¥{takeoutPaymentSplit.cashPortion.toLocaleString()}
                      </span>
                    </div>
                    <div className={`flex items-center justify-between rounded-2xl px-5 py-4 shadow-sm ${
                      takeoutPaymentSplit.otherMethod === 'qr' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      <span className="text-sm font-bold opacity-90">
                        {getSplitMethodLabel(takeoutPaymentSplit.otherMethod)}支払い
                      </span>
                      <span className="font-mono text-3xl font-black tracking-tight">
                        ¥{takeoutPaymentSplit.otherPortion.toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-center text-xs font-bold text-gray-400">
                      会計額 ¥{takeoutCartTotal.toLocaleString()} − 現金預かり ¥{takeoutPaymentSplit.cashPortion.toLocaleString()}
                    </p>
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
                )
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
      totalAmount={takeoutSubtotalAfterLine}
      rawTotalAmount={takeoutSubtotalAfterLine}
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
      onFullCreditCheckout={requestTakeoutFullCreditCheckout}
      showAbortModal={false}
      setShowAbortModal={() => {}}
      abortReason="manual_abort"
      setAbortReason={() => {}}
      onConfirmAbort={() => {}}
      tableId="takeout"
      tableDisplayName="テイクアウト"
    />

    {lineDiscountTarget && (() => {
      const targetLineAmount = Number(lineDiscountTarget.takeoutPrice || 0) * Number(lineDiscountTarget.quantity || 0);
      const currentPct = lineDiscountTarget.lineDiscount?.type === 'percent'
        ? Number(lineDiscountTarget.lineDiscount.value) || 0
        : 0;
      const category = lineDiscountCategory === 'promo_expense' ? 'promo_expense' : 'sales_discount';
      const categoryLabel = category === 'promo_expense' ? '販促費' : '売上値引き';
      const closeModal = () => { setLineDiscountTargetId(null); setLineDiscountManualValue(''); };
      const inputPct = Math.max(0, Math.min(100, Number(lineDiscountManualValue) || 0));
      const previewDiscount = inputPct > 0 ? Math.floor(targetLineAmount * (inputPct / 100)) : 0;

      const appendDigit = (digit) => setLineDiscountManualValue((prev) => {
        const base = (prev && prev !== '0') ? prev : '';
        const next = (base + digit).slice(0, 3);
        return String(Math.min(100, Number(next) || 0));
      });
      const backspaceDigit = () => setLineDiscountManualValue((prev) => String(prev || '').slice(0, -1));
      const applyManual = () => {
        if (inputPct <= 0) return;
        applyLineDiscount(lineDiscountTarget.id, {
          type: 'percent',
          value: inputPct,
          discountId: null,
          name: `${categoryLabel} ${inputPct}%引き`,
          accountingCategory: category
        });
        closeModal();
      };

      const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'back'];

      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b bg-orange-500 px-6 py-5 text-white">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-white/70">
                  <Percent size={14} />
                  単品割引
                </div>
                <h3 className="mt-1 truncate text-lg font-black">{lineDiscountTarget.name}</h3>
                <p className="text-xs font-bold text-white/80">
                  対象金額 ¥{targetLineAmount.toLocaleString()}（{Number(lineDiscountTarget.quantity || 0)}点）
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 transition-all hover:bg-white/20 active:scale-95"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">会計区分</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'sales_discount', label: '売上値引き', desc: '通常の値引き' },
                    { id: 'promo_expense', label: '販促費', desc: '社割・販促など' }
                  ].map((option) => {
                    const isSelected = category === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setLineDiscountCategory(option.id)}
                        className={`rounded-xl border-2 px-4 py-3 text-left transition-all active:scale-95 ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50'
                            : 'border-slate-100 bg-white hover:border-orange-200 hover:bg-orange-50/40'
                        }`}
                      >
                        <div className={`text-sm font-black ${isSelected ? 'text-orange-700' : 'text-slate-700'}`}>{option.label}</div>
                        <div className="mt-0.5 text-[11px] font-bold text-slate-400">{option.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">割引率</span>
                  {previewDiscount > 0 && (
                    <span className="text-sm font-black text-orange-600">
                      -¥{previewDiscount.toLocaleString()} → ¥{(targetLineAmount - previewDiscount).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex h-16 items-center justify-end rounded-xl border-2 border-slate-200 bg-slate-50 px-5">
                  <span className="font-mono text-4xl font-black text-slate-800">{lineDiscountManualValue || '0'}</span>
                  <span className="ml-1 text-2xl font-black text-slate-300">%</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {keypadKeys.map((key) => {
                  if (key === 'C') {
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setLineDiscountManualValue('')}
                        className="flex h-14 items-center justify-center rounded-xl border-2 border-slate-100 bg-white text-base font-black text-slate-500 transition-all hover:bg-slate-50 active:scale-95"
                      >
                        C
                      </button>
                    );
                  }
                  if (key === 'back') {
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={backspaceDigit}
                        className="flex h-14 items-center justify-center rounded-xl border-2 border-slate-100 bg-white text-slate-500 transition-all hover:bg-slate-50 active:scale-95"
                        aria-label="1文字削除"
                      >
                        <ChevronLeft size={22} />
                      </button>
                    );
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => appendDigit(key)}
                      className="flex h-14 items-center justify-center rounded-xl border-2 border-slate-100 bg-white text-2xl font-black text-slate-800 transition-all hover:border-orange-200 hover:bg-orange-50/40 active:scale-95"
                    >
                      {key}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={inputPct <= 0}
                onClick={applyManual}
                className="flex h-14 w-full items-center justify-center rounded-xl bg-orange-500 font-black text-white shadow-lg shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              >
                {categoryLabel}で適用
              </button>

              {currentPct > 0 && (
                <button
                  type="button"
                  onClick={() => { clearLineDiscount(lineDiscountTarget.id); closeModal(); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-100 py-3 text-sm font-black text-slate-500 transition-all hover:bg-slate-50 active:scale-95"
                >
                  <X size={16} />
                  この商品の割引を解除
                </button>
              )}
            </div>
          </div>
        </div>
      );
    })()}


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

    <PosFavoritesModal
      storeId={storeId}
      open={favoritesModalOpen}
      onClose={() => setFavoritesModalOpen(false)}
      onPickProduct={(rawProduct) => addPosProductToCart(buildResolvedPosProduct(rawProduct))}
    />
    </>
  );
};
