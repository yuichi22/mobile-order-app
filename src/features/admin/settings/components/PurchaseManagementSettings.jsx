import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Mail,
  PackageCheck,
  Printer,
  RefreshCw,
  Send,
  Truck,
  XCircle
} from 'lucide-react';

import { auth } from '../../../../shared/api/firebase/client';
import { appConfirm } from '../../../../shared/components/feedback/AppConfirmDialog';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  fetchProductsForReorder,
  receivePurchaseOrderLines,
  sendPurchaseOrderEmail,
  subscribeToPurchaseOrders,
  subscribeToStoreSettings,
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
  onReload,
  onSaved
}) => {
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [qtyDrafts, setQtyDrafts] = useState({});
  const [excludedBrandIds, setExcludedBrandIds] = useState([]);
  const [processing, setProcessing] = useState(false);

  // 仕入先の選択/解除時は数量・除外ブランドの編集内容を破棄する。
  const selectSupplier = (supplierId) => {
    setSelectedSupplierId(supplierId);
    setQtyDrafts({});
    setExcludedBrandIds([]);
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

  // 発注書の明細（数量編集を反映した確定前データ）
  const sheetLines = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.candidates.map((candidate) => {
      const qty = Math.max(Number(qtyDrafts[candidate.productId] ?? candidate.suggestedQty), 0);
      return {
        ...candidate,
        qty,
        amount: (candidate.unitPrice || 0) * qty,
        estimatedAmount: (candidate.estimatedUnitCost || 0) * qty
      };
    }).filter((line) => line.qty > 0);
  }, [selectedGroup, qtyDrafts]);

  const brandGroups = useMemo(() => groupLinesByBrand(sheetLines), [sheetLines]);

  const includedBrandGroups = brandGroups.filter((group) => !excludedBrandIds.includes(group.brandId));
  const includedTotal = includedBrandGroups.reduce((sum, group) => sum + group.subtotal, 0);
  const includedEstimatedTotal = includedBrandGroups.reduce((sum, group) => sum + group.estimatedSubtotal, 0);

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

      selectSupplier('');
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

  // ===== 発注書ビュー =====
  if (selectedGroup) {
    const supplier = selectedGroup.supplier;
    const canEmail = Boolean(supplier?.email);

    return (
      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => selectSupplier('')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:border-blue-200 hover:text-blue-600"
          >
            ← 仕入先一覧へ戻る
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={processing || !includedBrandGroups.length}
              onClick={() => printSheet(includedBrandGroups)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:border-blue-200 disabled:opacity-40"
            >
              <Printer size={16} /> 印刷 / PDF保存
            </button>
            <button
              type="button"
              disabled={processing || !includedBrandGroups.length || !canEmail}
              onClick={() => executeOrder({ method: 'email', targetBrandGroups: includedBrandGroups, label: 'メール' })}
              title={canEmail ? '' : '仕入先マスタにメールアドレスが登録されていません'}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <Mail size={16} /> メールで発注
            </button>
            <button
              type="button"
              disabled={processing || !includedBrandGroups.length}
              onClick={() => executeOrder({ method: 'fax', targetBrandGroups: includedBrandGroups, label: 'FAX' })}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-black text-white hover:bg-slate-900 disabled:opacity-40"
            >
              <Send size={16} /> FAX発注（発注済みにする）
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">{supplier?.name || '仕入先'} への発注書</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {supplier?.contactName ? `担当: ${supplier.contactName} / ` : ''}
                {supplier?.fax ? `FAX: ${supplier.fax} / ` : ''}
                {supplier?.email ? `メール: ${supplier.email}` : 'メール未登録'}
              </p>
              {supplier?.backorderHandling === 'autoCancel' && (
                <p className="mt-1 text-xs font-bold text-amber-600">
                  注残なし（発注から{supplier?.stockoutCancelDays || '-'}日で欠品キャンセル判定）
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">発注合計（税抜定価）</p>
              <p className="text-2xl font-black text-slate-900">{formatYen(includedTotal)}</p>
              <p className="text-xs font-bold text-slate-500">仕入概算: {formatYen(includedEstimatedTotal)}</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {brandGroups.map((group) => {
              const isExcluded = excludedBrandIds.includes(group.brandId);

              return (
                <div key={group.brandId || '__none__'} className={`rounded-2xl border ${isExcluded ? 'border-slate-100 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-black ${isExcluded ? 'text-slate-400' : 'text-slate-900'}`}>{group.brandName}</span>
                      <span className={`text-sm font-black ${isExcluded ? 'text-slate-300 line-through' : 'text-blue-700'}`}>
                        {formatYen(group.subtotal)}
                      </span>
                      <span className="text-xs font-bold text-slate-400">{group.lines.length}品目</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {!isExcluded && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => executeOrder({ method: 'fax', targetBrandGroups: [group], label: `FAX（${group.brandName}のみ）` })}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200 hover:text-blue-600 disabled:opacity-40"
                        >
                          このブランドのみ発注
                        </button>
                      )}
                      {!isExcluded && (
                        <button
                          type="button"
                          onClick={() => printSheet([group])}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 hover:border-blue-200"
                        >
                          <Printer size={14} className="inline" /> ブランド発注書
                        </button>
                      )}
                      <label className="flex items-center gap-1.5 text-xs font-black text-slate-500">
                        <input
                          type="checkbox"
                          checked={isExcluded}
                          onChange={() => toggleBrandExcluded(group.brandId)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        発注書から除外
                      </label>
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
                            <th className="px-2 py-2 text-right">数量</th>
                            <th className="px-2 py-2 text-right">単価(税抜定価)</th>
                            <th className="px-4 py-2 text-right">金額</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.lines.map((line) => (
                            <tr key={line.productId} className="border-t border-slate-100">
                              <td className="px-4 py-2 font-bold text-slate-800">
                                {line.productName}
                                {line.sku && <span className="ml-2 text-xs font-bold text-slate-400">{line.sku}</span>}
                                {line.isRelisted && (
                                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                    欠品キャンセル再掲
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right font-bold text-slate-600">{line.inventory}</td>
                              <td className="px-2 py-2 text-right font-bold text-slate-400">{line.reorderPoint}</td>
                              <td className="px-2 py-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  value={qtyDrafts[line.productId] ?? line.qty}
                                  onChange={(event) => setQtyDrafts((current) => ({ ...current, [line.productId]: event.target.value }))}
                                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right font-bold"
                                />
                              </td>
                              <td className="px-2 py-2 text-right font-bold text-slate-600">
                                {line.unitPrice === null ? <span className="text-amber-600">未設定</span> : formatYen(line.unitPrice)}
                              </td>
                              <td className="px-4 py-2 text-right font-black text-slate-800">{formatYen(line.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ===== 仕入先一覧ビュー =====
  const orderableGroups = supplierGroups.filter((group) => group.supplierId);
  const unassignedGroup = supplierGroups.find((group) => !group.supplierId) || null;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-500">
          在庫が発注点を下回った商品を仕入先ごとにまとめています。行をクリックすると発注書を確認できます。
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

      {orderableGroups.map((group) => (
        <button
          key={group.supplierId}
          type="button"
          onClick={() => selectSupplier(group.supplierId)}
          className="flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-white px-6 py-4 text-left transition-all hover:border-blue-300 hover:shadow-sm"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <ClipboardList size={20} />
            </div>
            <div>
              <p className="text-base font-black text-slate-900">{group.supplier?.name || group.supplierId}</p>
              <p className="text-xs font-bold text-slate-400">
                対象 {group.candidates.length} 品目
                {group.candidates.some((candidate) => candidate.isRelisted) && (
                  <span className="ml-2 text-amber-600">欠品キャンセル再掲あり</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-lg font-black text-slate-900">{formatYen(group.totalAmount)}</p>
              <p className="text-xs font-bold text-slate-400">仕入概算 {formatYen(group.estimatedCostTotal)}</p>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </div>
        </button>
      ))}

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
  const [reorderProducts, setReorderProducts] = useState(null);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [storeSettings, setStoreSettings] = useState(null);

  const suppliers = useMemo(() => productMaster?.suppliers || [], [productMaster?.suppliers]);
  const brands = useMemo(() => productMaster?.brands || [], [productMaster?.brands]);

  const reloadCandidates = useCallback(async () => {
    if (!storeId) return;
    try {
      const products = await fetchProductsForReorder(storeId);
      setReorderProducts(products);
    } catch (error) {
      console.error('発注候補の取得に失敗しました', error);
      setReorderProducts([]);
    }
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    if (!storeId) return undefined;

    fetchProductsForReorder(storeId)
      .then((products) => {
        if (!cancelled) setReorderProducts(products);
      })
      .catch((error) => {
        console.error('発注候補の取得に失敗しました', error);
        if (!cancelled) setReorderProducts([]);
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
      onReload={reloadCandidates}
      onSaved={onSaved}
    />
  );
};

export default PurchaseManagementSettings;
