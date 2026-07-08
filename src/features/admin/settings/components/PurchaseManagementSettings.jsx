import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  List,
  Mail,
  PackageCheck,
  Printer,
  RefreshCw,
  Send,
  Truck,
  X,
  XCircle
} from 'lucide-react';

import { auth } from '../../../../shared/api/firebase/client';
import { appConfirm } from '../../../../shared/components/feedback/AppConfirmDialog';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  fetchProductsForReorder,
  fetchScopedProductsForPurchase,
  purchaseLoadedScopesCache,
  purchaseProductPoolCache,
  purchaseReorderCache as reorderProductsCache,
  receivePurchaseOrderLines,
  sendPurchaseOrderEmail,
  subscribeToPurchaseOrders,
  subscribeToStoreSettings,
  updateProductPurchaseSettings,
  updatePurchaseOrder
} from '../../../store/services/storeDataService';

// ===== 共通ヘルパ =====

const formatYen = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `¥${Math.round(number).toLocaleString()}`;
};

const formatDateText = (value) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ja-JP');
};

const PO_STATUS_META = {
  ordered: { label: '発注済み', className: 'bg-blue-50 text-blue-700 border-blue-100' },
  partiallyReceived: { label: '一部入庫', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  received: { label: '入庫完了', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  canceled: { label: '取消', className: 'bg-slate-100 text-slate-500 border-slate-200' }
};

const PO_METHOD_LABELS = { fax: 'FAX', email: 'メール' };

// 発注リストからその場で変更できる商品マスタの発注設定フィールド
const MASTER_EDIT_FIELDS = {
  reorderPoint: '発注点',
  reorderQuantity: '発注数',
  reorderLot: 'LOT'
};
const StatusBadge = ({ status }) => {
  const meta = PO_STATUS_META[status] || { label: status || '-', className: 'bg-slate-100 text-slate-500 border-slate-200' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-black ${meta.className}`}>
      {meta.label}
    </span>
  );
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

// ===== 発注候補の算出 =====

const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const resolveInventoryQuantity = (product) => Math.max(Number(product.inventoryQuantity ?? product.quantity ?? 0), 0);

// 発注数量: reorderQuantity を基本に、無ければ発注点を超えるまでの不足数。ロットで切り上げる。
const suggestOrderQty = (product) => {
  const inventory = resolveInventoryQuantity(product);
  const reorderPoint = toNumberOrNull(product.reorderPoint) ?? 0;
  const shortage = Math.max(reorderPoint - inventory, 0) + 1;
  const reorderQuantity = toNumberOrNull(product.reorderQuantity);
  const base = reorderQuantity > 0 ? reorderQuantity : shortage;
  const lot = [product.reorderLot, product.orderLot]
    .map(toNumberOrNull)
    .find((value) => Number.isFinite(value) && value > 0) || 1;
  return Math.ceil(base / lot) * lot;
};

// 仕入概算単価: 原価(税抜)があればそれ、無ければ 税抜定価 × 掛け率(商品固有 > ブランド固有 > 仕入先標準)。
const resolveEstimatedUnitCost = (product, brand, supplier) => {
  const cost = toNumberOrNull(product.costTaxExcluded);
  if (cost !== null) return cost;

  const rate = [product.supplierCostRate, brand?.defaultCostRate, supplier?.defaultCostRate]
    .map(toNumberOrNull)
    .find((value) => Number.isFinite(value) && value > 0);
  const price = toNumberOrNull(product.priceTaxExcluded);
  if (!rate || price === null) return null;
  return Math.round((price * rate) / 100);
};

// 発注済み商品の「欠品キャンセル再掲」判定。autoCancel 仕入先で判定日数を過ぎても未入庫なら再び候補に上げる。
const isExpiredBackorder = (product, supplier) => {
  if (!supplier || supplier.backorderHandling !== 'autoCancel') return false;
  const days = toNumberOrNull(supplier.stockoutCancelDays);
  if (!days || days <= 0) return false;
  const orderedAt = product.orderedAt ? new Date(product.orderedAt) : null;
  if (!orderedAt || Number.isNaN(orderedAt.getTime())) return false;
  return Date.now() - orderedAt.getTime() > days * 24 * 60 * 60 * 1000;
};

const buildReorderCandidates = ({ products, brandById, supplierById }) => {
  if (!Array.isArray(products)) return [];

  return products
    .map((product) => {
      if (product.isArchived || product.isActive === false) return null;

      // 発注数0は廃盤同等（在庫は売り切るが再発注しない）。発注候補に上げない。
      // 未設定(null)は従来どおり対象で、明示的に0を入れた商品だけ除外する。
      if (toNumberOrNull(product.reorderQuantity) === 0) return null;

      const reorderPoint = toNumberOrNull(product.reorderPoint);
      if (reorderPoint === null) return null;

      const inventory = resolveInventoryQuantity(product);
      if (inventory > reorderPoint) return null;

      const brand = brandById.get(String(product.brandId || '')) || null;
      const supplierId = String(product.supplierId || brand?.supplierId || '').trim();
      const supplier = supplierById.get(supplierId) || null;

      // 発注済み商品: 注残「あり」は入庫まで対象外。「なし」は判定日数超過で欠品キャンセル扱いとして再掲。
      const isRelisted = product.orderStatus === 'ordered' && isExpiredBackorder(product, supplier);
      if (product.orderStatus === 'ordered' && !isRelisted) return null;

      const unitPrice = toNumberOrNull(product.priceTaxExcluded);
      const estimatedUnitCost = resolveEstimatedUnitCost(product, brand, supplier);
      const suggestedQty = suggestOrderQty(product);

      return {
        productId: product.id,
        productName: product.name || '(名称未設定)',
        sku: product.sku || '',
        brandId: String(product.brandId || ''),
        brandName: brand?.name || 'ブランド未設定',
        supplierId,
        supplier,
        inventory,
        reorderPoint,
        reorderQuantity: toNumberOrNull(product.reorderQuantity),
        reorderLot: toNumberOrNull(product.reorderLot),
        orderLot: toNumberOrNull(product.orderLot),
        suggestedQty,
        unitPrice,
        estimatedUnitCost,
        isRelisted,
        previousPoId: isRelisted ? String(product.activePoId || '') : ''
      };
    })
    .filter(Boolean);
};

// ===== 発注書HTML（印刷/PDF保存用） =====
// メール送信は Functions 側(sendPurchaseOrderEmail)が purchaseOrders doc から同趣旨のHTMLを組み立てる。

const buildPurchaseOrderHtml = ({ storeName, supplier, brandGroups, totalAmount, dateText }) => {
  const brandSections = brandGroups.map((group) => `
    <tbody>
      <tr class="brand-row">
        <td colspan="4">${escapeHtml(group.brandName)}</td>
        <td class="num">${escapeHtml(formatYen(group.subtotal))}</td>
      </tr>
      ${group.lines.map((line) => `
        <tr>
          <td>${escapeHtml(line.productName)}</td>
          <td>${escapeHtml(line.sku || '-')}</td>
          <td class="num">${escapeHtml(String(line.qty))}</td>
          <td class="num">${line.unitPrice === null ? '-' : escapeHtml(formatYen(line.unitPrice))}</td>
          <td class="num">${escapeHtml(formatYen(line.amount))}</td>
        </tr>
      `).join('')}
    </tbody>
  `).join('');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>発注書 - ${escapeHtml(supplier?.name || '')}</title>
<style>
  body { font-family: "Hiragino Sans", "Yu Gothic", sans-serif; color: #0f172a; margin: 32px; }
  h1 { font-size: 24px; letter-spacing: 0.3em; text-align: center; margin-bottom: 28px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px; }
  .meta .to { font-size: 16px; font-weight: 700; }
  .meta .to small { display: block; font-size: 12px; font-weight: 400; color: #475569; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; }
  td.num, th.num { text-align: right; }
  tr.brand-row td { background: #e2e8f0; font-weight: 700; }
  .total { margin-top: 16px; text-align: right; font-size: 16px; font-weight: 700; }
  .note { margin-top: 20px; font-size: 11px; color: #64748b; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
<h1>発注書</h1>
<div class="meta">
  <div class="to">
    ${escapeHtml(supplier?.name || '')} 御中
    <small>
      ${supplier?.contactName ? `ご担当: ${escapeHtml(supplier.contactName)} 様<br/>` : ''}
      ${supplier?.fax ? `FAX: ${escapeHtml(supplier.fax)}<br/>` : ''}
      ${supplier?.tel ? `TEL: ${escapeHtml(supplier.tel)}` : ''}
    </small>
  </div>
  <div>
    発注日: ${escapeHtml(dateText)}<br/>
    発注元: ${escapeHtml(storeName || '')}
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>商品名</th>
      <th>SKU</th>
      <th class="num">数量</th>
      <th class="num">単価(税抜定価)</th>
      <th class="num">金額</th>
    </tr>
  </thead>
  ${brandSections}
</table>
<div class="total">合計（税抜定価）: ${escapeHtml(formatYen(totalAmount))}</div>
<div class="note">※金額は税抜定価（上代）ベースです。仕入価格は貴社との取り決め（掛け率）に基づきます。</div>
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
};

const openPrintWindow = (html) => {
  const printWindow = window.open('', '_blank', 'width=960,height=1200');
  if (!printWindow) {
    alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
};

// 発注書明細をブランドごとに束ね、ブランド合計の多い順に並べる。
const groupLinesByBrand = (lines) => {
  const groups = new Map();

  lines.forEach((line) => {
    const key = line.brandId || '';
    if (!groups.has(key)) {
      groups.set(key, { brandId: key, brandName: line.brandName || 'ブランド未設定', lines: [], subtotal: 0, estimatedSubtotal: 0 });
    }
    const group = groups.get(key);
    group.lines.push(line);
    group.subtotal += line.amount;
    group.estimatedSubtotal += line.estimatedAmount || 0;
  });

  return [...groups.values()].sort((a, b) => b.subtotal - a.subtotal);
};

// ===== 仕入先別発注確認 =====

const SupplierPurchaseCheckPanel = ({
  storeId,
  candidates,
  loading,
  storeName,
  brandById,
  onReload,
  onPatchProduct,
  onSaveSupplier,
  onSaved
}) => {
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  // 仕入先が非常に多い(SaaSで数百件)と、一度に全カードを描画してメインスレッドがフリーズする。
  // 初期は上位N件だけ描画し、残りは「さらに表示」で追加する。
  const [visibleSupplierCount, setVisibleSupplierCount] = useState(30);
  const [qtyDrafts, setQtyDrafts] = useState({});
  const [excludedBrandIds, setExcludedBrandIds] = useState([]);
  // 商品一覧から手動で発注書に追加した商品ID（発注点未達の商品も発注できる）
  const [extraProductIds, setExtraProductIds] = useState([]);
  const [processing, setProcessing] = useState(false);
  // 最低発注金額の入力モーダル { supplier, value }
  const [minOrderModal, setMinOrderModal] = useState(null);
  // Shift+クリックの範囲選択（まとめて廃盤扱い用）
  const [selectionAnchor, setSelectionAnchor] = useState('');
  const [bulkSelection, setBulkSelection] = useState([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // 別の仕入先を開いたとき、上の展開パネルが閉じてページが縮み、クリックした行ごと
  // 画面外(上)へ流れることがある。展開した行が見える位置までスクロールを補正する。
  useEffect(() => {
    if (!selectedSupplierId) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-supplier-card="${CSS.escape(selectedSupplierId)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, [selectedSupplierId]);
  // 発注点/発注数/LOT の変更モーダル { line, field, current, value }
  const [masterEditModal, setMasterEditModal] = useState(null);
  // 展開中に変更したマスタ値のオーバーレイ {productId: {field: value}}。
  // 発注点を下げても行が即座に消えてスクロールが飛ばないよう、候補データへの反映は
  // 折りたたみ/切り替え時にまとめて行い、展開中は表示だけ上書きする。
  const [masterOverrides, setMasterOverrides] = useState({});

  // マスタ値の保存は楽観更新。表示を即時に書き換えてモーダルを閉じ、
  // Firestoreへの書き込みはバックグラウンドで行う（失敗時のみ通知して元に戻す）。
  const saveMasterEdit = () => {
    if (!masterEditModal?.line) return;
    const { line, field } = masterEditModal;
    const productId = line.productId;
    const raw = String(masterEditModal.value ?? '').trim();
    const value = raw === '' ? null : Math.max(Number(raw) || 0, 0);

    // 表示中の「今回の数量」を先にドラフトへ固定する。マスタ値を変えても提案値が
    // 再計算されて数量が勝手に増減しないようにするため。
    // 発注数0は廃盤同等なので、今回の数量も0にして即座に発注対象から外す（行はグレーで残る）。
    const isDiscontinued = field === 'reorderQuantity' && value === 0;
    const pinnedQty = isDiscontinued ? 0 : Number(line.qty);
    if (Number.isFinite(pinnedQty) && pinnedQty >= 0) {
      setQtyDrafts((current) => ({ ...current, [productId]: String(pinnedQty) }));
    }

    const applyValue = (nextValue) => {
      setMasterOverrides((current) => ({
        ...current,
        [productId]: { ...current[productId], [field]: nextValue }
      }));
      patchAllProducts([productId], { [field]: nextValue });
    };

    applyValue(value);
    setMasterEditModal(null);

    updateProductPurchaseSettings(storeId, productId, { [field]: value }).catch((error) => {
      applyValue(toNumberOrNull(line[field]));
      alert(`${MASTER_EDIT_FIELDS[field]}の保存に失敗したため元に戻しました: ${error.message}`);
    });
  };

  const openMasterEdit = (line, field) => {
    const currentValue = field === 'reorderLot'
      ? (line.reorderLot ?? line.orderLot)
      : line[field];
    setMasterEditModal({
      line,
      field,
      current: currentValue ?? '-',
      value: String(currentValue ?? '')
    });
  };

  // 数量欄: Enterで次の数量欄へ移動する（フォーカス時は全選択なので数字を打ち直すだけで進められる）。
  const handleQtyInputKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = [...document.querySelectorAll('input[data-qty-input="true"]')];
    const index = inputs.indexOf(event.currentTarget);
    const next = inputs[index + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      event.currentTarget.blur();
    }
  };
  // 商品一覧モーダル { scope: 'supplier'|'brand', brandId, title }
  const [productBrowser, setProductBrowser] = useState(null);
  // 取得済み商品のプール(複数スコープの和集合)。スコープを跨いで手動追加した商品の参照元になる。
  const [allProducts, setAllProducts] = useState(() => {
    const pool = purchaseProductPoolCache.get(storeId);
    return pool ? [...pool.values()] : null;
  });
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserKeyword, setBrowserKeyword] = useState('');

  const mergeIntoProductPool = (products) => {
    const pool = purchaseProductPoolCache.get(storeId) || new Map();
    products.forEach((product) => pool.set(product.id, product));
    purchaseProductPoolCache.set(storeId, pool);
    setAllProducts([...pool.values()]);
  };

  // 商品プール(商品一覧モーダル用)とそのセッションキャッシュへ同じパッチを当てる。
  const patchAllProducts = (ids, patch) => {
    const pool = purchaseProductPoolCache.get(storeId);
    if (pool) {
      ids.forEach((id) => {
        const product = pool.get(id);
        if (product) pool.set(id, { ...product, ...patch });
      });
    }
    setAllProducts((current) => (Array.isArray(current)
      ? current.map((product) => (ids.includes(product.id) ? { ...product, ...patch } : product))
      : current));
  };

  const openProductBrowser = async (browserConfig) => {
    setProductBrowser(browserConfig);
    setBrowserKeyword('');
    if (!selectedGroup) return;

    // 開いたスコープ(仕入先/ブランド)の商品だけを取得する(全商品スキャン廃止)。
    // 取得済みスコープは即表示し、裏で最新を取得して差し替える。
    const scopeKey = browserConfig.scope === 'brand'
      ? `brand:${browserConfig.brandId || `none-of-${selectedGroup.supplierId}`}`
      : `supplier:${selectedGroup.supplierId}`;
    const loadedScopes = purchaseLoadedScopesCache.get(storeId) || new Set();
    const isLoaded = loadedScopes.has(scopeKey);
    if (!isLoaded) setBrowserLoading(true);

    try {
      // ブランドスコープはそのブランドIDのみ。ブランド未設定グループと仕入先スコープは
      // 仕入先直付け(supplierId)＋仕入先配下ブランドの商品を集める。
      const supplierBrandIds = browserConfig.scope === 'brand'
        ? (browserConfig.brandId ? [browserConfig.brandId] : [])
        : [...(brandById?.values() || [])]
          .filter((brand) => brand.supplierId === selectedGroup.supplierId)
          .map((brand) => brand.id);

      const products = await fetchScopedProductsForPurchase(storeId, {
        supplierId: browserConfig.scope === 'brand' && browserConfig.brandId ? '' : selectedGroup.supplierId,
        brandIds: supplierBrandIds
      });

      mergeIntoProductPool(products);
      loadedScopes.add(scopeKey);
      purchaseLoadedScopesCache.set(storeId, loadedScopes);
    } catch (error) {
      if (!isLoaded) {
        alert(`商品一覧の取得に失敗しました: ${error.message}`);
        setProductBrowser(null);
      }
    } finally {
      setBrowserLoading(false);
    }
  };

  const toggleExtraProduct = (productId) => {
    setExtraProductIds((current) => (
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
    ));
  };

  const saveMinOrderAmount = async () => {
    if (!minOrderModal?.supplier || !onSaveSupplier) return;
    const raw = String(minOrderModal.value ?? '').trim();
    const value = raw === '' ? null : Math.max(Number(raw) || 0, 0);

    setProcessing(true);
    try {
      // saveSupplier は merge 保存だが createdAt を上書きしないよう既存フィールドごと渡す。
      await onSaveSupplier({ ...minOrderModal.supplier, minOrderAmount: value });
      setMinOrderModal(null);
      onSaved?.();
    } catch (error) {
      alert(`最低発注金額の保存に失敗しました: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // 展開中に変更したマスタ値を候補データへ反映する。発注点を在庫以下に下げた行は
  // この時点（折りたたみ/切り替え時）で発注リストから消える。
  const flushMasterOverrides = () => {
    Object.entries(masterOverrides).forEach(([productId, patch]) => onPatchProduct?.(productId, patch));
    setMasterOverrides({});
  };

  const resetLineSelection = () => {
    setSelectionAnchor('');
    setBulkSelection([]);
    setBulkModalOpen(false);
  };

  // 行クリックで展開/折りたたみ。切り替え時は数量・除外ブランド・手動追加の編集内容を破棄する。
  const toggleSupplier = (supplierId) => {
    flushMasterOverrides();
    setSelectedSupplierId((current) => (current === supplierId ? '' : supplierId));
    setQtyDrafts({});
    setExcludedBrandIds([]);
    setExtraProductIds([]);
    resetLineSelection();
  };

  const collapseSupplier = () => {
    flushMasterOverrides();
    setSelectedSupplierId('');
    setQtyDrafts({});
    setExcludedBrandIds([]);
    setExtraProductIds([]);
    resetLineSelection();
  };

  const supplierGroups = useMemo(() => {
    const groups = new Map();

    candidates.forEach((candidate) => {
      const key = candidate.supplierId;
      if (!groups.has(key)) {
        groups.set(key, {
          supplierId: key,
          supplier: candidate.supplier,
          candidates: [],
          totalAmount: 0,
          estimatedCostTotal: 0
        });
      }
      const group = groups.get(key);
      group.candidates.push(candidate);
      const qty = candidate.suggestedQty;
      group.totalAmount += (candidate.unitPrice || 0) * qty;
      group.estimatedCostTotal += (candidate.estimatedUnitCost || 0) * qty;
    });

    return [...groups.values()].sort((a, b) => b.totalAmount - a.totalAmount);
  }, [candidates]);

  const selectedGroup = supplierGroups.find((group) => group.supplierId === selectedSupplierId) || null;

  // 商品一覧から手動追加した商品を発注候補と同じ形に整える（発注点未達・未設定でも発注書に載せられる）。
  const extraCandidates = useMemo(() => {
    if (!selectedGroup || !extraProductIds.length || !Array.isArray(allProducts)) return [];

    const candidateIds = new Set(selectedGroup.candidates.map((candidate) => candidate.productId));

    return extraProductIds
      .filter((productId) => !candidateIds.has(productId))
      .map((productId) => allProducts.find((product) => product.id === productId))
      .filter(Boolean)
      .map((product) => {
        const brand = brandById?.get(String(product.brandId || '')) || null;
        return {
          productId: product.id,
          productName: product.name || '(名称未設定)',
          sku: product.sku || '',
          brandId: String(product.brandId || ''),
          brandName: brand?.name || 'ブランド未設定',
          supplierId: selectedGroup.supplierId,
          supplier: selectedGroup.supplier,
          inventory: resolveInventoryQuantity(product),
          reorderPoint: toNumberOrNull(product.reorderPoint),
          reorderQuantity: toNumberOrNull(product.reorderQuantity),
          reorderLot: toNumberOrNull(product.reorderLot),
          orderLot: toNumberOrNull(product.orderLot),
          suggestedQty: suggestOrderQty(product),
          unitPrice: toNumberOrNull(product.priceTaxExcluded),
          estimatedUnitCost: resolveEstimatedUnitCost(product, brand, selectedGroup.supplier),
          isRelisted: false,
          previousPoId: '',
          isManual: true
        };
      });
  }, [selectedGroup, extraProductIds, allProducts, brandById]);

  // 発注書の明細（数量編集・マスタ値オーバーレイを反映した確定前データ）。
  // 数量0の行も残す（グレーアウトして「今回は0発注」として表示し、発注対象からは外す）。
  const sheetLines = useMemo(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.candidates, ...extraCandidates].map((candidate) => {
      const overrides = masterOverrides[candidate.productId];
      const merged = overrides ? { ...candidate, ...overrides } : candidate;
      const qtyRaw = Number(qtyDrafts[merged.productId] ?? merged.suggestedQty);
      const qty = Number.isFinite(qtyRaw) ? Math.max(qtyRaw, 0) : 0;
      return {
        ...merged,
        qty,
        amount: (merged.unitPrice || 0) * qty,
        estimatedAmount: (merged.estimatedUnitCost || 0) * qty
      };
    });
  }, [selectedGroup, extraCandidates, qtyDrafts, masterOverrides]);

  const brandGroups = useMemo(() => groupLinesByBrand(sheetLines), [sheetLines]);

  // 発注候補として既に発注書に載っている商品（商品一覧モーダルでの状態表示用）
  const candidateProductIds = useMemo(
    () => new Set((selectedGroup?.candidates || []).map((candidate) => candidate.productId)),
    [selectedGroup]
  );

  // 商品一覧モーダル: 発注書に掲載済み(発注候補＋手動追加)の商品を除いた「その他の商品」だけを出す。
  const scopedBrowserProducts = useMemo(() => {
    if (!productBrowser || !selectedGroup || !Array.isArray(allProducts)) return [];

    return allProducts
      .filter((product) => {
        if (product.isArchived || product.isActive === false) return false;
        if (candidateProductIds.has(product.id) || extraProductIds.includes(product.id)) return false;
        const brand = brandById?.get(String(product.brandId || '')) || null;
        const resolvedSupplierId = String(product.supplierId || brand?.supplierId || '').trim();
        if (resolvedSupplierId !== selectedGroup.supplierId) return false;
        if (productBrowser.scope === 'brand' && String(product.brandId || '') !== productBrowser.brandId) return false;
        return true;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  }, [productBrowser, selectedGroup, allProducts, brandById, candidateProductIds, extraProductIds]);

  const browserProducts = useMemo(() => {
    const keyword = browserKeyword.trim().toLowerCase();
    if (!keyword) return scopedBrowserProducts;
    return scopedBrowserProducts.filter((product) => (
      [product.name, product.sku, product.barcode].some((value) => String(value || '').toLowerCase().includes(keyword))
    ));
  }, [scopedBrowserProducts, browserKeyword]);

  const includedBrandGroups = brandGroups.filter((group) => !excludedBrandIds.includes(group.brandId));
  const includedTotal = includedBrandGroups.reduce((sum, group) => sum + group.subtotal, 0);
  const includedEstimatedTotal = includedBrandGroups.reduce((sum, group) => sum + group.estimatedSubtotal, 0);

  // 数量0(今回は0発注)の明細を除いた実際の発注対象。発注・印刷はこちらを使う。
  const toOrderableGroup = (group) => ({ ...group, lines: group.lines.filter((line) => line.qty > 0) });
  const orderableBrandGroups = includedBrandGroups
    .map(toOrderableGroup)
    .filter((group) => group.lines.length > 0);

  // 商品名クリックで選択、Shift+クリックで表示順にその間を範囲選択して一括操作モーダルを開く。
  const handleLineSelectClick = (event, productId) => {
    if (event.shiftKey && selectionAnchor) {
      const visibleIds = includedBrandGroups.flatMap((group) => group.lines.map((line) => line.productId));
      const anchorIndex = visibleIds.indexOf(selectionAnchor);
      const clickedIndex = visibleIds.indexOf(productId);
      if (anchorIndex >= 0 && clickedIndex >= 0) {
        const [from, to] = anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
        setBulkSelection(visibleIds.slice(from, to + 1));
        setBulkModalOpen(true);
        return;
      }
    }

    if (bulkSelection.length === 1 && bulkSelection[0] === productId) {
      resetLineSelection();
      return;
    }
    setSelectionAnchor(productId);
    setBulkSelection([productId]);
  };

  // 選択した商品をまとめて廃盤扱い(発注数0)にする。表示は即時反映し、保存はバックグラウンド。
  const applyBulkDiscontinue = () => {
    const ids = [...bulkSelection];
    if (!ids.length) return;

    setQtyDrafts((current) => {
      const next = { ...current };
      ids.forEach((id) => { next[id] = '0'; });
      return next;
    });
    setMasterOverrides((current) => {
      const next = { ...current };
      ids.forEach((id) => { next[id] = { ...next[id], reorderQuantity: 0 }; });
      return next;
    });
    patchAllProducts(ids, { reorderQuantity: 0 });
    resetLineSelection();

    Promise.allSettled(ids.map((id) => updateProductPurchaseSettings(storeId, id, { reorderQuantity: 0 })))
      .then((results) => {
        const failedCount = results.filter((result) => result.status === 'rejected').length;
        if (failedCount) {
          alert(`${failedCount}件の廃盤設定の保存に失敗しました。画面を再読み込みして確認してください。`);
        }
      });
  };

  const toggleBrandExcluded = (brandId) => {
    setExcludedBrandIds((current) => (
      current.includes(brandId) ? current.filter((id) => id !== brandId) : [...current, brandId]
    ));
  };

  const buildPoPayload = ({ method, targetBrandGroups }) => ({
    supplierId: selectedGroup.supplierId,
    supplierName: selectedGroup.supplier?.name || '',
    method,
    excludedBrandIds,
    lines: targetBrandGroups.flatMap((group) => group.lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      sku: line.sku,
      brandId: line.brandId,
      brandName: line.brandName,
      qty: line.qty,
      unitPrice: line.unitPrice,
      amount: line.amount,
      estimatedUnitCost: line.estimatedUnitCost,
      estimatedAmount: line.estimatedAmount
    }))),
    supersede: targetBrandGroups.flatMap((group) => group.lines
      .filter((line) => line.isRelisted && line.previousPoId)
      .map((line) => ({ poId: line.previousPoId, productId: line.productId })))
  });

  const executeOrder = async ({ method, targetBrandGroups, label }) => {
    if (!selectedGroup || !targetBrandGroups.length) return;
    if (!(await appConfirm(`${selectedGroup.supplier?.name || '仕入先'} へ${label}で発注を確定します。よろしいですか？`, { title: '発注確定', okLabel: '発注する' }))) return;

    setProcessing(true);
    try {
      const poId = await createPurchaseOrder(storeId, buildPoPayload({ method, targetBrandGroups }));

      if (method === 'email') {
        try {
          const idToken = await auth.currentUser?.getIdToken?.();
          await sendPurchaseOrderEmail({ storeId, purchaseOrderId: poId, idToken });
        } catch (mailError) {
          alert(`発注は記録しましたが、メール送信に失敗しました。発注履歴から再送してください。\n(${mailError.message})`);
        }
      }

      collapseSupplier();
      await onReload();
      onSaved?.();
    } catch (error) {
      alert(`発注に失敗しました: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const printSheet = (targetBrandGroups) => {
    openPrintWindow(buildPurchaseOrderHtml({
      storeName,
      supplier: selectedGroup?.supplier,
      brandGroups: targetBrandGroups,
      totalAmount: targetBrandGroups.reduce((sum, group) => sum + group.subtotal, 0),
      dateText: new Date().toLocaleDateString('ja-JP')
    }));
  };

  if (loading) {
    return (
      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500">
        発注候補を集計しています…
      </div>
    );
  }

  // ===== 仕入先一覧ビュー（行クリックでブランド別明細をその場に展開） =====
  const orderableGroups = supplierGroups.filter((group) => group.supplierId);
  const unassignedGroup = supplierGroups.find((group) => !group.supplierId) || null;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-500">
          在庫が発注点を下回った商品を仕入先ごとにまとめています。行をクリックすると、ブランドごとの発注金額と商品リストが展開されます。
        </p>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:border-blue-200"
        >
          <RefreshCw size={14} /> 再集計
        </button>
      </div>

      {!orderableGroups.length && !unassignedGroup && (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
          <p className="mt-3 text-sm font-black text-slate-700">発注が必要な商品はありません</p>
          <p className="mt-1 text-xs font-bold text-slate-400">在庫が発注点(reorderPoint)を下回るとここに表示されます。</p>
        </div>
      )}

      {orderableGroups.slice(0, visibleSupplierCount).map((group) => {
        const isExpanded = group.supplierId === selectedSupplierId;
        const supplier = group.supplier;
        const canEmail = Boolean(supplier?.email);
        const minOrderAmount = toNumberOrNull(supplier?.minOrderAmount);
        // 最低発注金額に未達の仕入先はグレー表示（展開・発注は可能なまま）。
        const belowMinOrder = minOrderAmount !== null && minOrderAmount > 0
          && (isExpanded ? includedTotal : group.totalAmount) < minOrderAmount;

        return (
          <div
            key={group.supplierId}
            data-supplier-card={group.supplierId}
            className={`scroll-mt-64 rounded-3xl border transition-all ${
              isExpanded
                ? 'border-blue-300 bg-white shadow-sm'
                : belowMinOrder
                  ? 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm'
            }`}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleSupplier(group.supplierId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleSupplier(group.supplierId);
                }
              }}
              className="flex w-full cursor-pointer items-center justify-between px-6 py-4 text-left"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${belowMinOrder && !isExpanded ? 'bg-slate-100 text-slate-400' : 'bg-blue-50 text-blue-600'}`}>
                  <ClipboardList size={20} />
                </div>
                <div>
                  <p className={`text-base font-black ${belowMinOrder && !isExpanded ? 'text-slate-400' : 'text-slate-900'}`}>{supplier?.name || group.supplierId}</p>
                  <p className="text-xs font-bold text-slate-400">
                    対象 {group.candidates.length} 品目
                    {group.candidates.some((candidate) => candidate.isRelisted) && (
                      <span className="ml-2 text-amber-600">欠品キャンセル再掲あり</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs font-bold">
                    {minOrderAmount !== null ? (
                      <>
                        <span className={belowMinOrder ? 'text-amber-600' : 'text-slate-400'}>
                          最低発注金額 {formatYen(minOrderAmount)}{belowMinOrder ? '（未達）' : ''}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMinOrderModal({ supplier, value: String(minOrderAmount) });
                          }}
                          className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-500 hover:border-blue-200 hover:text-blue-600"
                        >
                          変更
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-300">最低発注金額 未設定</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMinOrderModal({ supplier, value: '' });
                          }}
                          className="ml-2 rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600 hover:bg-blue-100"
                        >
                          設定する
                        </button>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className={`text-lg font-black ${belowMinOrder ? 'text-slate-400' : 'text-slate-900'}`}>{formatYen(isExpanded ? includedTotal : group.totalAmount)}</p>
                  <p className="text-xs font-bold text-slate-400">仕入概算 {formatYen(isExpanded ? includedEstimatedTotal : group.estimatedCostTotal)}</p>
                </div>
                {isExpanded
                  ? <ChevronDown size={18} className="text-blue-400" />
                  : <ChevronRight size={18} className="text-slate-300" />}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-slate-100 px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-500">
                      {supplier?.contactName ? `担当: ${supplier.contactName} / ` : ''}
                      {supplier?.fax ? `FAX: ${supplier.fax} / ` : ''}
                      {supplier?.email ? `メール: ${supplier.email}` : 'メール未登録'}
                    </p>
                    {supplier?.backorderHandling === 'autoCancel' && (
                      <p className="mt-1 text-xs font-bold text-amber-600">
                        注残なし（発注から{supplier?.stockoutCancelDays || '-'}日で欠品キャンセル判定）
                      </p>
                    )}
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-400">
                      カーソル移動
                      <span className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 font-black text-blue-600">Enter ↓</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openProductBrowser({ scope: 'supplier', title: `${supplier?.name || '仕入先'} のその他の商品` })}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:border-blue-200"
                    >
                      <List size={16} /> この仕入先のその他の商品
                    </button>
                    <button
                      type="button"
                      disabled={processing || !orderableBrandGroups.length}
                      onClick={() => printSheet(orderableBrandGroups)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:border-blue-200 disabled:opacity-40"
                    >
                      <Printer size={16} /> 印刷 / PDF保存
                    </button>
                    <button
                      type="button"
                      disabled={processing || !orderableBrandGroups.length || !canEmail}
                      onClick={() => executeOrder({ method: 'email', targetBrandGroups: orderableBrandGroups, label: 'メール' })}
                      title={canEmail ? '' : '仕入先マスタにメールアドレスが登録されていません'}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Mail size={16} /> メールで発注
                    </button>
                    <button
                      type="button"
                      disabled={processing || !orderableBrandGroups.length}
                      onClick={() => executeOrder({ method: 'fax', targetBrandGroups: orderableBrandGroups, label: 'FAX' })}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-black text-white hover:bg-slate-900 disabled:opacity-40"
                    >
                      <Send size={16} /> FAX発注（発注済みにする）
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {brandGroups.map((brandGroup) => {
                    const isExcluded = excludedBrandIds.includes(brandGroup.brandId);

                    return (
                      <div key={brandGroup.brandId || '__none__'} className={`rounded-2xl border ${isExcluded ? 'border-slate-100 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-black ${isExcluded ? 'text-slate-400' : 'text-slate-900'}`}>{brandGroup.brandName}</span>
                            <span className={`text-sm font-black ${isExcluded ? 'text-slate-300 line-through' : 'text-blue-700'}`}>
                              {formatYen(brandGroup.subtotal)}
                            </span>
                            <span className="text-xs font-bold text-slate-400">{brandGroup.lines.length}品目</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {!isExcluded && (
                              <button
                                type="button"
                                onClick={() => openProductBrowser({ scope: 'brand', brandId: brandGroup.brandId, title: `${brandGroup.brandName} のその他の商品` })}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200"
                              >
                                <List size={12} className="inline" /> このブランドのその他の商品
                              </button>
                            )}
                            {!isExcluded && (
                              <button
                                type="button"
                                disabled={processing || !toOrderableGroup(brandGroup).lines.length}
                                onClick={() => executeOrder({ method: 'fax', targetBrandGroups: [toOrderableGroup(brandGroup)], label: `FAX（${brandGroup.brandName}のみ）` })}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200 hover:text-blue-600 disabled:opacity-40"
                              >
                                このブランドのみ発注
                              </button>
                            )}
                            {!isExcluded && (
                              <button
                                type="button"
                                disabled={!toOrderableGroup(brandGroup).lines.length}
                                onClick={() => printSheet([toOrderableGroup(brandGroup)])}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200 disabled:opacity-40"
                              >
                                <Printer size={14} className="inline" /> ブランド発注書
                              </button>
                            )}
                            {/* ブランドが1つだけの発注書では除外＝発注しないと同義のため非表示 */}
                            {brandGroups.length > 1 && (
                              <label className="flex items-center gap-1.5 text-xs font-black text-slate-500">
                                <input
                                  type="checkbox"
                                  checked={isExcluded}
                                  onChange={() => toggleBrandExcluded(brandGroup.brandId)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                発注書から除外
                              </label>
                            )}
                          </div>
                        </div>

                        {!isExcluded && (
                          <div className="overflow-x-auto border-t border-slate-100">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs font-black uppercase tracking-wider text-slate-400">
                                  <th className="px-4 py-2">商品</th>
                                  <th className="px-2 py-2 text-right">在庫</th>
                                  <th className="px-2 py-2 text-right">発注点</th>
                                  <th className="px-2 py-2 text-right">発注数</th>
                                  <th className="px-2 py-2 text-right">今回の数量</th>
                                  <th className="px-2 py-2 text-right">LOT</th>
                                  <th className="px-2 py-2 text-right">単価(税抜定価)</th>
                                  <th className="px-4 py-2 text-right">金額</th>
                                </tr>
                              </thead>
                              <tbody>
                                {brandGroup.lines.map((line) => {
                                  // 数量0 = 今回だけ0発注。行は残してグレーアウトし、発注対象から外す。
                                  const isZero = line.qty === 0;
                                  const isSelected = bulkSelection.includes(line.productId);

                                  return (
                                  <tr
                                    key={line.productId}
                                    className={`border-t border-slate-100 ${
                                      isSelected ? 'bg-blue-50' : isZero ? 'bg-slate-50 opacity-50' : ''
                                    }`}
                                  >
                                    <td
                                      className="cursor-pointer select-none px-4 py-2 font-bold text-slate-800"
                                      title="クリックで選択 / Shift+クリックで範囲選択"
                                      onMouseDown={(event) => {
                                        if (event.shiftKey) event.preventDefault();
                                      }}
                                      onClick={(event) => handleLineSelectClick(event, line.productId)}
                                    >
                                      {line.productName}
                                      {line.sku && <span className="ml-2 text-xs font-bold text-slate-400">{line.sku}</span>}
                                      {line.isRelisted && (
                                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                          欠品キャンセル再掲
                                        </span>
                                      )}
                                      {line.isManual && (
                                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">
                                          手動追加
                                          <button
                                            type="button"
                                            title="発注書から外す"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              toggleExtraProduct(line.productId);
                                            }}
                                            className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
                                          >
                                            <X size={10} />
                                          </button>
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2 text-right font-bold text-slate-600">{line.inventory}</td>
                                    <td className="px-2 py-2 text-right">
                                      <button
                                        type="button"
                                        title="クリックで発注点を変更"
                                        onClick={() => openMasterEdit(line, 'reorderPoint')}
                                        className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 font-bold text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                                      >
                                        {line.reorderPoint ?? '-'}
                                      </button>
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      <button
                                        type="button"
                                        title="クリックで発注数を変更"
                                        onClick={() => openMasterEdit(line, 'reorderQuantity')}
                                        className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 font-bold text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                                      >
                                        {line.reorderQuantity ?? '-'}
                                      </button>
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      <input
                                        type="number"
                                        min="0"
                                        data-qty-input="true"
                                        value={qtyDrafts[line.productId] ?? line.qty}
                                        onChange={(event) => setQtyDrafts((current) => ({ ...current, [line.productId]: event.target.value }))}
                                        onFocus={(event) => event.target.select()}
                                        onKeyDown={handleQtyInputKeyDown}
                                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                      />
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      <button
                                        type="button"
                                        title="クリックでLOTを変更"
                                        onClick={() => openMasterEdit(line, 'reorderLot')}
                                        className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 font-bold text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                                      >
                                        {line.reorderLot ?? line.orderLot ?? '-'}
                                      </button>
                                    </td>
                                    <td className="px-2 py-2 text-right font-bold text-slate-600">
                                      {line.unitPrice === null ? <span className="text-amber-600">未設定</span> : formatYen(line.unitPrice)}
                                    </td>
                                    <td className="px-4 py-2 text-right font-black text-slate-800">
                                      {isZero ? <span className="text-slate-400">今回0発注</span> : formatYen(line.amount)}
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {orderableGroups.length > visibleSupplierCount && (
        <button
          type="button"
          onClick={() => setVisibleSupplierCount((current) => current + 30)}
          className="w-full rounded-2xl border border-dashed border-slate-300 bg-white py-4 text-sm font-black text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
        >
          さらに表示（残り {orderableGroups.length - visibleSupplierCount} 仕入先）
        </button>
      )}

      {unassignedGroup && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-black text-amber-700">
            <AlertTriangle size={16} />
            仕入先未設定の発注候補が {unassignedGroup.candidates.length} 品目あります
          </div>
          <p className="mt-1 text-xs font-bold text-amber-600">
            商品マスタでブランドまたは仕入先を設定すると発注できます:
            {' '}{unassignedGroup.candidates.slice(0, 5).map((candidate) => candidate.productName).join('、')}
            {unassignedGroup.candidates.length > 5 ? ' ほか' : ''}
          </p>
        </div>
      )}

      {productBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setProductBrowser(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-3xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-base font-black text-slate-900">{productBrowser.title}</h3>
                <p className="mt-0.5 text-xs font-bold text-slate-400">
                  発注書にまだ載っていない商品の一覧です。発注点に達していない商品も「発注書に追加」で取り込めます。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProductBrowser(null)}
                className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:border-slate-300 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            {!browserLoading && scopedBrowserProducts.length > 0 && (
              <div className="px-6 py-3">
                <input
                  type="text"
                  value={browserKeyword}
                  onChange={(event) => setBrowserKeyword(event.target.value)}
                  placeholder="商品名・SKU・バーコードで検索"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 pb-5">
              {browserLoading ? (
                <p className="py-8 text-center text-sm font-bold text-slate-400">商品一覧を読み込んでいます…</p>
              ) : !scopedBrowserProducts.length ? (
                <div className="py-10 text-center">
                  <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                  <p className="mt-3 text-sm font-black text-slate-700">
                    {productBrowser.scope === 'brand' ? 'このブランド' : 'この仕入先'}の商品はすべて発注書に掲載されています
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-400">追加できるその他の商品はありません。</p>
                </div>
              ) : !browserProducts.length ? (
                <p className="py-8 text-center text-sm font-bold text-slate-400">検索に該当する商品がありません。</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs font-black uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-3">商品</th>
                      <th className="px-2 py-2">ブランド</th>
                      <th className="px-2 py-2 text-right">在庫</th>
                      <th className="px-2 py-2 text-right">発注点</th>
                      <th className="px-2 py-2 text-right">税抜定価</th>
                      <th className="px-2 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {browserProducts.slice(0, 300).map((product) => {
                      const isOrdered = product.orderStatus === 'ordered';
                      const brand = brandById?.get(String(product.brandId || '')) || null;

                      return (
                        <tr key={product.id} className="border-t border-slate-100">
                          <td className="py-2 pr-3 font-bold text-slate-800">
                            {product.name || '(名称未設定)'}
                            {product.sku && <span className="ml-2 text-xs font-bold text-slate-400">{product.sku}</span>}
                            {toNumberOrNull(product.reorderQuantity) === 0 && (
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                発注数0・廃盤扱い
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs font-bold text-slate-500">{brand?.name || '-'}</td>
                          <td className="px-2 py-2 text-right font-bold text-slate-600">{resolveInventoryQuantity(product)}</td>
                          <td className="px-2 py-2 text-right font-bold text-slate-400">{toNumberOrNull(product.reorderPoint) ?? '-'}</td>
                          <td className="px-2 py-2 text-right font-bold text-slate-600">
                            {toNumberOrNull(product.priceTaxExcluded) === null ? '-' : formatYen(product.priceTaxExcluded)}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {isOrdered ? (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">発注済み</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleExtraProduct(product.id)}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-700"
                              >
                                発注書に追加
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {browserProducts.length > 300 && (
                <p className="mt-3 text-center text-xs font-bold text-amber-600">
                  表示件数が多いため先頭300件のみ表示しています。検索で絞り込んでください。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {masterEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setMasterEditModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-black text-slate-900">{MASTER_EDIT_FIELDS[masterEditModal.field]}の変更</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">{masterEditModal.line.productName}</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="shrink-0 text-lg font-black text-slate-400">
                {masterEditModal.current} →
              </span>
              <input
                type="number"
                min="0"
                autoFocus
                value={masterEditModal.value}
                onFocus={(event) => event.target.select()}
                onChange={(event) => setMasterEditModal((current) => ({ ...current, value: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveMasterEdit();
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-lg font-black text-slate-800 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMasterEditModal(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:border-slate-300"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={saveMasterEdit}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkModalOpen && bulkSelection.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setBulkModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-black text-slate-900">選択した商品をまとめて操作</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {bulkSelection.length}件の商品を選択中です。廃盤扱い（発注数0）にすると発注候補に上がらなくなります。
            </p>
            <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
              {sheetLines
                .filter((line) => bulkSelection.includes(line.productId))
                .map((line) => (
                  <p key={line.productId} className="py-0.5 text-xs font-bold text-slate-600">
                    {line.productName}
                    {line.sku && <span className="ml-2 text-slate-400">{line.sku}</span>}
                  </p>
                ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetLineSelection}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:border-slate-300"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={applyBulkDiscontinue}
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-black text-white hover:bg-slate-900"
              >
                選択した商品を廃盤扱いにする（発注数0）
              </button>
            </div>
          </div>
        </div>
      )}

      {minOrderModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setMinOrderModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-black text-slate-900">最低発注金額の設定</h3>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
              {minOrderModal.supplier?.name || '仕入先'} の最低発注金額（税抜定価）を入力してください。
              発注金額がこの金額に達しない場合、リストでグレー表示されます。空欄で保存すると未設定に戻ります。
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm font-black text-slate-400">¥</span>
              <input
                type="number"
                min="0"
                autoFocus
                value={minOrderModal.value}
                onChange={(event) => setMinOrderModal((current) => ({ ...current, value: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveMinOrderAmount();
                }}
                placeholder="例: 30000"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-base font-black text-slate-800"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMinOrderModal(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:border-slate-300"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={saveMinOrderAmount}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== 発注履歴 =====

const PurchaseHistoryPanel = ({ storeId, purchaseOrders, storeName, suppliers, onReloadCandidates, onSaved }) => {
  const [expandedPoId, setExpandedPoId] = useState('');
  const [etaDraft, setEtaDraft] = useState('');
  const [lineEtaDrafts, setLineEtaDrafts] = useState({});
  const [receiptDrafts, setReceiptDrafts] = useState({});
  const [processing, setProcessing] = useState(false);

  const supplierById = useMemo(() => new Map((suppliers || []).map((supplier) => [supplier.id, supplier])), [suppliers]);

  const toggleExpand = (po) => {
    if (expandedPoId === po.id) {
      setExpandedPoId('');
      return;
    }
    setExpandedPoId(po.id);
    setEtaDraft(po.eta || '');
    setLineEtaDrafts(Object.fromEntries((po.lines || []).map((line) => [line.productId, line.eta || ''])));
    setReceiptDrafts({});
  };

  const saveEta = async (po) => {
    setProcessing(true);
    try {
      const nextLines = (po.lines || []).map((line) => ({
        ...line,
        eta: lineEtaDrafts[line.productId] || null
      }));
      await updatePurchaseOrder(storeId, po.id, { eta: etaDraft || null, lines: nextLines, status: po.status });
      onSaved?.();
    } catch (error) {
      alert(`納期の保存に失敗しました: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const receive = async (po) => {
    const receipts = Object.entries(receiptDrafts)
      .map(([productId, quantity]) => ({ productId, quantity: Number(quantity) }))
      .filter((receipt) => receipt.quantity > 0);

    if (!receipts.length) {
      alert('入庫数を入力してください。');
      return;
    }

    setProcessing(true);
    try {
      await receivePurchaseOrderLines(storeId, po, receipts);
      setReceiptDrafts({});
      await onReloadCandidates();
      onSaved?.();
    } catch (error) {
      alert(`入庫登録に失敗しました: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const cancel = async (po) => {
    if (!(await appConfirm('この発注書を取り消します。未入庫の明細は発注候補に戻ります。よろしいですか？', { okLabel: '取り消す', tone: 'danger' }))) return;
    setProcessing(true);
    try {
      await cancelPurchaseOrder(storeId, po);
      await onReloadCandidates();
      onSaved?.();
    } catch (error) {
      alert(`取消に失敗しました: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const resendEmail = async (po) => {
    setProcessing(true);
    try {
      const idToken = await auth.currentUser?.getIdToken?.();
      await sendPurchaseOrderEmail({ storeId, purchaseOrderId: po.id, idToken });
      alert('発注書メールを送信しました。');
      onSaved?.();
    } catch (error) {
      alert(`メール送信に失敗しました: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const reprint = (po) => {
    const activeLines = (po.lines || []).filter((line) => !line.canceled);
    openPrintWindow(buildPurchaseOrderHtml({
      storeName,
      supplier: supplierById.get(po.supplierId) || { name: po.supplierName },
      brandGroups: groupLinesByBrand(activeLines.map((line) => ({ ...line, amount: Number(line.amount || 0) }))),
      totalAmount: activeLines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
      dateText: formatDateText(po.orderedAt)
    }));
  };

  if (!purchaseOrders.length) {
    return (
      <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
        <Truck size={28} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm font-black text-slate-600">発注履歴はまだありません</p>
        <p className="mt-1 text-xs font-bold text-slate-400">仕入先別発注確認から発注すると、ここに発注書単位で記録されます。</p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      {purchaseOrders.map((po) => {
        const isExpanded = expandedPoId === po.id;
        const activeLines = (po.lines || []).filter((line) => !line.canceled);
        const receivedCount = activeLines.filter((line) => Number(line.receivedQty || 0) >= Number(line.qty || 0)).length;

        return (
          <div key={po.id} className="rounded-3xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => toggleExpand(po)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                <div>
                  <p className="text-sm font-black text-slate-900">
                    {po.supplierName || po.supplierId}
                    <span className="ml-2 text-xs font-bold text-slate-400">{formatDateText(po.orderedAt)} 発注</span>
                    {po.method && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {PO_METHOD_LABELS[po.method] || po.method}
                      </span>
                    )}
                  </p>
                  <p className="text-xs font-bold text-slate-400">
                    {activeLines.length}品目 / 入庫 {receivedCount}品目
                    {po.eta ? ` / 納期(発注書): ${formatDateText(po.eta)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-black text-slate-800">{formatYen(po.totalAmount)}</span>
                <StatusBadge status={po.status} />
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-slate-100 px-6 py-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="text-xs font-black text-slate-500">
                    発注書の納期(ETA)
                    <input
                      type="date"
                      value={etaDraft}
                      onChange={(event) => setEtaDraft(event.target.value)}
                      className="ml-2 rounded-lg border border-slate-200 px-2 py-1.5 font-bold text-slate-700"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => saveEta(po)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      納期を保存
                    </button>
                    <button
                      type="button"
                      onClick={() => reprint(po)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200"
                    >
                      <Printer size={13} /> 再印刷
                    </button>
                    {po.method === 'email' && po.status !== 'canceled' && (
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => resendEmail(po)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200 disabled:opacity-40"
                      >
                        <Mail size={13} /> メール再送
                      </button>
                    )}
                    {po.status === 'ordered' && (
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => cancel(po)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-100 px-3 py-1.5 text-xs font-black text-red-500 hover:bg-red-50 disabled:opacity-40"
                      >
                        <XCircle size={13} /> 発注取消
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-black uppercase tracking-wider text-slate-400">
                        <th className="py-2 pr-3">商品</th>
                        <th className="px-2 py-2">ブランド</th>
                        <th className="px-2 py-2 text-right">数量</th>
                        <th className="px-2 py-2 text-right">金額</th>
                        <th className="px-2 py-2 text-right">入庫済</th>
                        <th className="px-2 py-2">納期(商品別)</th>
                        <th className="px-2 py-2 text-right">今回入庫数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(po.lines || []).map((line) => {
                        const remaining = Math.max(Number(line.qty || 0) - Number(line.receivedQty || 0), 0);
                        const fulfilled = !line.canceled && remaining === 0;

                        return (
                          <tr key={line.productId} className={`border-t border-slate-100 ${line.canceled ? 'opacity-40' : ''}`}>
                            <td className="py-2 pr-3 font-bold text-slate-800">
                              {line.productName}
                              {line.canceled && <span className="ml-2 text-[10px] font-black text-slate-400">キャンセル</span>}
                              {fulfilled && <PackageCheck size={13} className="ml-1 inline text-emerald-500" />}
                            </td>
                            <td className="px-2 py-2 font-bold text-slate-500">{line.brandName || '-'}</td>
                            <td className="px-2 py-2 text-right font-bold text-slate-600">{line.qty}</td>
                            <td className="px-2 py-2 text-right font-bold text-slate-600">{formatYen(line.amount)}</td>
                            <td className="px-2 py-2 text-right font-bold text-slate-600">{Number(line.receivedQty || 0)}</td>
                            <td className="px-2 py-2">
                              {/* 表示優先は 商品別 > 発注書別。未入力なら発注書ETAを薄く表示する。 */}
                              <input
                                type="date"
                                value={lineEtaDrafts[line.productId] ?? (line.eta || '')}
                                onChange={(event) => setLineEtaDrafts((current) => ({ ...current, [line.productId]: event.target.value }))}
                                disabled={line.canceled}
                                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 disabled:bg-slate-50"
                              />
                              {!line.eta && !lineEtaDrafts[line.productId] && po.eta && (
                                <span className="ml-1 text-[10px] font-bold text-slate-400">({formatDateText(po.eta)})</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              {!line.canceled && remaining > 0 && po.status !== 'canceled' ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  placeholder={String(remaining)}
                                  value={receiptDrafts[line.productId] ?? ''}
                                  onChange={(event) => setReceiptDrafts((current) => ({ ...current, [line.productId]: event.target.value }))}
                                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs font-bold"
                                />
                              ) : (
                                <span className="text-xs font-bold text-slate-300">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {po.status !== 'canceled' && po.status !== 'received' && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => receive(po)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      <PackageCheck size={16} /> 入庫登録
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ===== 発注管理ルート =====

const PurchaseManagementSettings = ({ storeId, activeTab = 'supplierPurchaseCheck', productMaster, onSaved }) => {
  const [reorderProducts, setReorderProducts] = useState(() => reorderProductsCache.get(storeId) ?? null);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [storeSettings, setStoreSettings] = useState(null);

  const suppliers = useMemo(() => productMaster?.suppliers || [], [productMaster?.suppliers]);
  const brands = useMemo(() => productMaster?.brands || [], [productMaster?.brands]);

  const reloadCandidates = useCallback(async () => {
    if (!storeId) return;
    try {
      const products = await fetchProductsForReorder(storeId);
      reorderProductsCache.set(storeId, products);
      setReorderProducts(products);
    } catch (error) {
      console.error('発注候補の取得に失敗しました', error);
      setReorderProducts([]);
    }
  }, [storeId]);

  // 発注点変更などの単項目更新は全件再フェッチせず、手元の候補データとキャッシュへ直接反映する。
  const patchReorderProduct = useCallback((productId, patch) => {
    const applyPatch = (list) => list.map((product) => (product.id === productId ? { ...product, ...patch } : product));
    const cached = reorderProductsCache.get(storeId);
    if (Array.isArray(cached)) reorderProductsCache.set(storeId, applyPatch(cached));
    setReorderProducts((current) => (Array.isArray(current) ? applyPatch(current) : current));
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    if (!storeId) return undefined;

    // キャッシュがあれば初期stateで即表示済み。ここでは裏で最新を取得して置き換えるだけ。
    fetchProductsForReorder(storeId)
      .then((products) => {
        reorderProductsCache.set(storeId, products);
        if (!cancelled) setReorderProducts(products);
      })
      .catch((error) => {
        console.error('発注候補の取得に失敗しました', error);
        if (!cancelled) setReorderProducts((current) => current ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return undefined;
    const unsubscribeOrders = subscribeToPurchaseOrders(storeId, setPurchaseOrders, (error) => {
      console.error('発注履歴の購読に失敗しました', error);
    });
    const unsubscribeSettings = subscribeToStoreSettings(storeId, setStoreSettings, () => {});
    return () => {
      unsubscribeOrders();
      unsubscribeSettings();
    };
  }, [storeId]);

  const brandById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand])), [brands]);
  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);

  const candidates = useMemo(
    () => buildReorderCandidates({ products: reorderProducts, brandById, supplierById }),
    [reorderProducts, brandById, supplierById]
  );

  if (activeTab === 'purchaseHistory') {
    return (
      <PurchaseHistoryPanel
        storeId={storeId}
        purchaseOrders={purchaseOrders}
        storeName={storeSettings?.name || ''}
        suppliers={suppliers}
        onReloadCandidates={reloadCandidates}
        onSaved={onSaved}
      />
    );
  }

  return (
    <SupplierPurchaseCheckPanel
      storeId={storeId}
      candidates={candidates}
      loading={reorderProducts === null}
      storeName={storeSettings?.name || ''}
      brandById={brandById}
      onReload={reloadCandidates}
      onPatchProduct={patchReorderProduct}
      onSaveSupplier={productMaster?.saveSupplier}
      onSaved={onSaved}
    />
  );
};

export default PurchaseManagementSettings;
