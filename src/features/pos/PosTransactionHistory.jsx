import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildPosReceiptPrintPayload } from '../../shared/utils/posReceiptPrint';
import { openPosReceiptBrowserPrint } from '../../shared/utils/posReceiptBrowserPrint';
import { issueReceipt, printPayloadByMode, resolveReceiptMode } from '../../shared/utils/receiptPrinting';
import { getTableDisplayName } from '../../shared/utils/tableDisplay';
import {
  CheckCircle2, ChevronDown, ChevronLeft, CreditCard, Filter, PauseCircle, Printer, QrCode, Receipt, Tag, XCircle, LogOut
} from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query, doc, getDocs, increment, serverTimestamp, where, writeBatch, Timestamp } from 'firebase/firestore';

import { db } from '../../shared/api/firebase/client';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { useStoreSettings } from '../store/hooks';

const formatInvoiceNumber = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.startsWith('T') ? normalized : `T${normalized}`;
};

const getJstDateInputValue = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(date);
};


const toDateValue = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value?.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  return null;
};

const formatDateTimeShort = (value) => {
  const date = toDateValue(value);

  if (!date) return '';

  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const resolveCancelDateValue = (ticket = {}) => (
  toDateValue(ticket.cancelledAt) ||
  toDateValue(ticket.canceledAt) ||
  toDateValue(ticket.cancelAt) ||
  toDateValue(ticket.voidedAt) ||
  toDateValue(ticket.refundedAt) ||
  toDateValue(ticket.closedAt) ||
  toDateValue(ticket.updatedAt) ||
  null
);

const resolvePaidDateValue = (ticket = {}) => (
  toDateValue(ticket.paidAt) ||
  toDateValue(ticket.completedAt) ||
  null
);

const resolveOrderDateValue = (ticket = {}) => (
  toDateValue(ticket.timestamp) ||
  toDateValue(ticket.createdAt) ||
  toDateValue(ticket.updatedAt) ||
  null
);

const resolveHistoryDateValue = (ticket = {}) => {
  if (ticket?.status === 'cancelled') {
    return resolveCancelDateValue(ticket) || resolveOrderDateValue(ticket);
  }

  if (ticket?.status === 'paid') {
    return resolvePaidDateValue(ticket) || resolveOrderDateValue(ticket);
  }

  return resolveOrderDateValue(ticket);
};

const formatTransactionDateTime = (ticket = {}) => {
  const date = resolveCancelDateValue(ticket);

  return formatDateTimeShort(date);
};


const buildDateRangeFromInput = (dateInputValue) => {
  if (!dateInputValue) return null;

  const [year, month, day] = String(dateInputValue).split('-').map((value) => Number(value));
  if (!year || !month || !day) return null;

  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

  return {
    start,
    end,
    startTimestamp: Timestamp.fromDate(start),
    endTimestamp: Timestamp.fromDate(end)
  };
};

const mergeDocsById = (...docLists) => {
  const map = new Map();

  docLists.flat().forEach((docSnap) => {
    if (!docSnap?.id || map.has(docSnap.id)) return;
    map.set(docSnap.id, docSnap);
  });

  return Array.from(map.values());
};

const chunkArray = (items = [], size = 10) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const hydrateOrderSessions = async (ordersCollection, docs = []) => {
  const sessionIds = [
    ...new Set(
      docs
        .map((docSnap) => String(docSnap.data()?.sessionId || '').trim())
        .filter((sessionId) => sessionId && !sessionId.startsWith('single-'))
    )
  ];

  if (sessionIds.length === 0) return docs;

  const sessionSnapshots = await Promise.all(
    chunkArray(sessionIds, 10).map((sessionIdChunk) => (
      getDocs(query(
        ordersCollection,
        where('sessionId', 'in', sessionIdChunk),
        limit(1000)
      ))
    ))
  );

  return mergeDocsById(
    docs,
    ...sessionSnapshots.map((snapshot) => snapshot.docs)
  );
};


const formatPaymentMethod = (method) => {
  if (method === 'mixed') return '混在';
  if (method === 'cash') return '現金';
  if (method === 'card' || method === 'credit') return 'カード';
  if (method === 'qr' || method === 'paypay') return 'QR決済';
  return method || '未設定';
};

const getPaymentMethodKey = (value) => {
  const method = String(value || '').trim();
  if (method === 'credit') return 'card';
  if (method === 'paypay') return 'qr';
  if (['cash', 'card', 'qr'].includes(method)) return method;
  return method || 'other';
};

const buildPaymentBreakdown = (transactions = []) => {
  const map = new Map();

  transactions.forEach((transaction) => {
    if (transaction?.isPaid === false) return;

    const method = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);
    const current = map.get(method) || {
      method,
      label: formatPaymentMethod(method),
      count: 0,
      total: 0
    };

    current.count += 1;
    current.total += Number(transaction.totalAmount || transaction.totalPrice || transaction.amount || 0);
    map.set(method, current);
  });

  return Array.from(map.values()).filter((entry) => Number(entry.total || 0) !== 0 || Number(entry.count || 0) > 0);
};

const resolveTicketPaymentMethod = (paymentBreakdown = [], fallbackMethod = '') => {
  if (paymentBreakdown.length === 0) return fallbackMethod || '';
  if (paymentBreakdown.length === 1) return paymentBreakdown[0].method;
  return 'mixed';
};

const formatPaymentBreakdownText = (paymentBreakdown = []) => (
  paymentBreakdown
    .map((entry) => `${entry.label} ¥${Number(entry.total || 0).toLocaleString()}`)
    .join(' / ')
);

const buildPaymentSummaryFromTickets = (tickets = []) => {
  const base = {
    cash: { method: 'cash', label: '現金', count: 0, total: 0 },
    card: { method: 'card', label: 'カード', count: 0, total: 0 },
    qr: { method: 'qr', label: 'QR決済', count: 0, total: 0 }
  };

  tickets.forEach((ticket) => {
    const breakdown = Array.isArray(ticket.paymentBreakdown) && ticket.paymentBreakdown.length > 0
      ? ticket.paymentBreakdown
      : [{
          method: getPaymentMethodKey(ticket.paymentMethod),
          count: 1,
          total: Number(ticket.totalPrice || 0)
        }];

    breakdown.forEach((entry) => {
      const method = getPaymentMethodKey(entry.method);
      if (!base[method]) return;

      base[method].count += Number(entry.count || 0);
      base[method].total += Number(entry.total || 0);
    });
  });

  return [base.cash, base.card, base.qr];
};

const isRetailExtraItem = (item) => (
  item?.isOrderRetailExtra === true ||
  item?.sourceType === 'retail' ||
  String(item?.id || '').startsWith('order-retail:')
);

const buildTicketItemKey = (item) => {
  const optionsKey = Array.isArray(item?.options) ? item.options.join('|') : '';
  return [
    isRetailExtraItem(item) ? 'retail' : 'order',
    item?.productId || item?.id || item?.name || '',
    Number(item?.unitPrice || 0),
    item?.isTakeout === true ? 'takeout' : 'store',
    item?.taxRate || '',
    optionsKey
  ].join('::');
};

const consolidateTicketItems = (items = []) => {
  const grouped = new Map();

  items.forEach((item) => {
    const key = buildTicketItemKey(item);
    const quantity = Number(item?.quantity || 1);

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...item,
        quantity,
        totalPrice: Number(item?.unitPrice || 0) * quantity
      });
      return;
    }

    const existing = grouped.get(key);
    const nextQuantity = Number(existing.quantity || 0) + quantity;
    grouped.set(key, {
      ...existing,
      quantity: nextQuantity,
      totalPrice: Number(existing.unitPrice || 0) * nextQuantity
    });
  });

  return Array.from(grouped.values());
};

const resolveTicketTaxRates = (items = [], settings = {}) => {
  const reducedFromItems = items.find((item) => item?.isTakeout === true && Number.isFinite(Number(item?.taxRate)))?.taxRate;
  const standardFromItems = items.find((item) => item?.isTakeout !== true && Number.isFinite(Number(item?.taxRate)))?.taxRate;

  return {
    reducedRate: Number(reducedFromItems || settings?.taxRateReduced || 8),
    standardRate: Number(standardFromItems || settings?.taxRate || 10)
  };
};

const buildReceiptRows = (items) => consolidateTicketItems(items).map((item) => `
  <div class="row item-row">
    <div class="item-info">
      <div class="item-name">${item.name || '未設定商品'}</div>
      <div class="item-sub">¥${Number(item.unitPrice || 0).toLocaleString()} x ${Number(item.quantity || 1)}</div>
    </div>
    <div class="item-price">¥${(Number(item.unitPrice || 0) * Number(item.quantity || 1)).toLocaleString()}</div>
  </div>
`).join('');

  const printReceipt = async (ticket, settings) => {
    try {
      await issueReceipt({ data: ticket, settings, mode: resolveReceiptMode(ticket) });
      return;
    } catch (error) {
      console.error('[pos transaction receipt print error]', error);

      const shouldFallback = window.confirm(
        'レシートプリンターへの印刷に失敗しました。ブラウザ印刷を開きますか？'
      );

      if (!shouldFallback) {
        return;
      }
    }
    const payload = buildPosReceiptPrintPayload({
      ...ticket,
      tableName: getTableDisplayName(ticket) || 'テイクアウト'
    }, settings);

    openPosReceiptBrowserPrint(payload);
  };

  const buildPaymentReceiptTicket = (payment = {}, parentTicket = {}) => ({
    ...parentTicket,
    ...payment,
    id: payment.id || payment.sourceTransactionId || parentTicket.id,
    sourceTransactionId: payment.sourceTransactionId || payment.id || parentTicket.sourceTransactionId,
    sessionId: parentTicket.sessionId || payment.sessionId || parentTicket.sourceSessionId || '',
    tableId: parentTicket.tableId || payment.tableId || '',
    tableDisplayName:
      parentTicket.tableDisplayName ||
      parentTicket.tableName ||
      payment.tableDisplayName ||
      payment.tableName ||
      '',
    tableName:
      parentTicket.tableName ||
      parentTicket.tableDisplayName ||
      payment.tableName ||
      payment.tableDisplayName ||
      '',
    timestamp: payment.timestamp || payment.paidAt || parentTicket.timestamp || null,
    paidAt: payment.paidAt || payment.timestamp || parentTicket.paidAt || null,
    status: 'paid',
    title: payment.title || '領収書',
    receiptType: payment.receiptType || 'partial',
    receiptScopeLabel: payment.receiptScopeLabel || '個別会計',
    totalPrice: Number(payment.totalPrice ?? payment.totalAmount ?? payment.amount ?? 0) || 0,
    totalAmount: Number(payment.totalPrice ?? payment.totalAmount ?? payment.amount ?? 0) || 0,
    subtotal: Number(payment.subtotal ?? payment.subTotal ?? payment.totalPrice ?? payment.totalAmount ?? 0) || 0,
    subTotal: Number(payment.subtotal ?? payment.subTotal ?? payment.totalPrice ?? payment.totalAmount ?? 0) || 0,
    taxAmountReduced: Number(payment.taxAmountReduced || 0),
    taxAmountStandard: Number(payment.taxAmountStandard || 0),
    taxAmount: Number(payment.taxAmount || payment.tax || 0),
    discountAmount: Number(payment.discountAmount || 0),
    paymentMethod: payment.paymentMethod || parentTicket.paymentMethod,
    paymentMethodGroup: payment.paymentMethod || parentTicket.paymentMethod,
    items: Array.isArray(payment.items) ? payment.items : [],
    lineItems: Array.isArray(payment.items) ? payment.items : []
  });

  const printPaymentReceipt = async (payment, parentTicket, settings) => {
    await printReceipt(buildPaymentReceiptTicket(payment, parentTicket), settings);
  };

  const buildTicketStatementPayload = (ticket = {}, settings = {}) => {
    const paymentRows = Array.isArray(ticket.paidOrders) && ticket.paidOrders.length > 0
      ? ticket.paidOrders
      : Array.isArray(ticket.paymentBreakdown)
        ? ticket.paymentBreakdown.map((entry, index) => ({
            id: `${ticket.id || 'payment'}-${entry.method || 'payment'}-${index}`,
            sourceTransactionId: entry.sourceTransactionId || '',
            paymentMethod: entry.method,
            totalPrice: Number(entry.total || 0),
            paidAt: ticket.paidAt || ticket.timestamp,
            timestamp: ticket.timestamp
          }))
        : [];

    const totalAmount = Number(ticket.totalPrice || ticket.totalAmount || 0);
    const tableName = getTableDisplayName(ticket) || ticket.tableName || ticket.tableDisplayName || 'テイクアウト';

    const statementItems = paymentRows.map((payment, index) => {
      const method = payment.paymentMethod || payment.method || '';
      const paidAtText = formatDateTimeShort(payment.paidAt || payment.timestamp) || formatTime(payment.paidAt || payment.timestamp) || '';
      const sourceId = String(payment.sourceTransactionId || payment.id || '').slice(-8);

      return {
        id: payment.id || payment.sourceTransactionId || `${ticket.id || 'payment'}-${index}`,
        name: `${index + 1}. ${formatPaymentMethod(method)} ${sourceId ? `/${sourceId}` : ''}`,
        unitPrice: Number(payment.totalPrice ?? payment.totalAmount ?? payment.total ?? payment.amount ?? 0) || 0,
        quantity: 1,
        totalPrice: Number(payment.totalPrice ?? payment.totalAmount ?? payment.total ?? payment.amount ?? 0) || 0,
        options: paidAtText ? [`会計 ${paidAtText}`] : []
      };
    });

    return {
      title: '会計明細',
      receiptScopeLabel: '会計明細',
      storeName: settings?.name || 'Akuto Order System',
      address: settings?.address || '',
      tel: settings?.tel || '',
      tableName,
      tableDisplayName: tableName,
      issuedAtText: new Date().toLocaleString('ja-JP'),
      paymentMethod: '複数',
      items: statementItems,
      lineItems: statementItems,
      totalPrice: totalAmount,
      totalAmount,
      subtotal: totalAmount,
      subTotal: totalAmount,
      taxAmount: 0,
      taxAmountReduced: 0,
      taxAmountStandard: 0,
      discountAmount: 0,
      note: 'これは領収書ではなく、同一伝票内の支払い内訳を確認するための会計明細です。',
      recipientLabel: '',
      provisoLabel: '',
      hideRecipientAndProviso: true
    };
  };

  const printTicketStatement = async (ticket = {}, settings = {}) => {
    const payload = buildTicketStatementPayload(ticket, settings);

    try {
      await printPayloadByMode({ payload, settings, mode: resolveReceiptMode(ticket) });
    } catch (error) {
      console.error('[pos statement print error]', error, { ticket, payload });
      openPosReceiptBrowserPrint(payload);
    }
  };

export const PosTransactionHistory = ({
  storeId,
  ownRegisterId = null,
  registers = [],
  posHolds = [],
  onResumeHold = null,
  onDeleteHold = null
}) => {
  // 履歴は登録レジ単位。既定は自レジ(ownRegisterId)。「その他のレジ」で他レジを閲覧可。
  const [viewingRegisterId, setViewingRegisterId] = useState(ownRegisterId);
  const [pickingRegister, setPickingRegister] = useState(false);
  // 自レジが変わったら自レジ表示へ戻す。
  useEffect(() => {
    setViewingRegisterId(ownRegisterId);
    setPickingRegister(false);
  }, [ownRegisterId]);
  const viewedRegister = registers.find((register) => register.id === viewingRegisterId) || null;
  const viewedRegisterMode = viewedRegister?.registerMode || null;
  const isViewingOtherRegister = Boolean(ownRegisterId) && viewingRegisterId !== ownRegisterId;
  // 取引が表示中レジのものか。registerId 無しの旧データは自レジ表示時のみ含める。
  const transactionMatchesViewingRegister = (transaction) => {
    const rid = String(transaction?.registerId || '');
    if (!rid) return viewingRegisterId === ownRegisterId;
    return rid === viewingRegisterId;
  };
  const [orders, setOrders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [selectedPaidDate, setSelectedPaidDate] = useState(() => getJstDateInputValue());
  const selectedPaidDateRange = useMemo(() => buildDateRangeFromInput(selectedPaidDate), [selectedPaidDate]);
  const [paidPaymentFilter, setPaidPaymentFilter] = useState('all');
  const todayDateValue = useMemo(() => getJstDateInputValue(), []);
  const isSelectedPaidDateToday = Boolean(selectedPaidDate) && selectedPaidDate === todayDateValue;

  const shiftSelectedPaidDate = (days) => {
    const baseValue = selectedPaidDate || todayDateValue;
    const baseDate = new Date(`${baseValue}T00:00:00+09:00`);
    if (Number.isNaN(baseDate.getTime())) return;

    baseDate.setDate(baseDate.getDate() + days);
    const nextValue = getJstDateInputValue(baseDate);

    if (nextValue > todayDateValue) return;
    setSelectedPaidDate(nextValue);
  };
  const [closeTicketTarget, setCloseTicketTarget] = useState(null);
  const [isClosingTicket, setIsClosingTicket] = useState(false);
  const closeTicketTimerRef = useRef(null);
  // 待機既定: POS自レジ=保留(センターレジで売上履歴を常時見せない), POS他レジ=会計済み, ORDER=未会計。
  const [filter, setFilter] = useState(() => {
    const own = registers.find((register) => register.id === ownRegisterId);
    return own?.registerMode === 'order' ? 'unpaid' : 'hold';
  });
  // 表示中レジのモード/自他が定まる/変わるたびに既定タブへ寄せる。
  useEffect(() => {
    if (!viewedRegisterMode) return;
    if (viewedRegisterMode === 'pos') {
      setFilter(isViewingOtherRegister ? 'paid' : 'hold');
    } else {
      setFilter('unpaid');
    }
  }, [viewedRegisterMode, isViewingOtherRegister]);
  const { settings } = useStoreSettings(storeId);

  // 会計後キャンセル（全額/一部）。cancelTarget=対象の生取引、cancelQty={明細index:取消数量}。
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelQty, setCancelQty] = useState({});
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const openCancelModal = (ticket) => {
    const txId = ticket?.sourceTransactionId
      || (Array.isArray(ticket?.sourceTransactionIds) && ticket.sourceTransactionIds.length === 1
        ? ticket.sourceTransactionIds[0] : '');
    const transaction = transactions.find((item) => item.id === txId);
    if (!transaction || !Array.isArray(transaction.items) || transaction.items.length === 0) {
      window.alert('取消対象の取引明細が見つかりません。');
      return;
    }
    const initial = {};
    transaction.items.forEach((item, index) => { initial[index] = 0; });
    setCancelTarget(transaction);
    setCancelQty(initial);
    setCancelReason('');
  };

  const closeCancelModal = () => {
    if (isCancelling) return;
    setCancelTarget(null);
    setCancelQty({});
    setCancelReason('');
  };

  const executeCancellation = async () => {
    if (!cancelTarget || isCancelling || !storeId) return;
    const transaction = cancelTarget;
    const items = Array.isArray(transaction.items) ? transaction.items : [];
    const num = (value) => Number(value || 0);

    const cancelledEntries = [];
    let anyCancel = false;

    const updatedItems = items.map((item, index) => {
      const qty = num(item.quantity) || 1;
      const cQty = Math.min(Math.max(num(cancelQty[index]), 0), qty);
      if (cQty <= 0) return item;
      anyCancel = true;
      const remainingQty = qty - cQty;
      const ratio = qty > 0 ? remainingQty / qty : 0;
      const scale = (value) => Math.round(num(value) * ratio);
      cancelledEntries.push({
        name: item.name || '商品',
        productId: item.id || item.productId || '',
        sourceType: item.sourceType || '',
        quantity: cQty,
        amount: num(item.totalPrice) - scale(item.totalPrice)
      });
      if (remainingQty <= 0) return null;
      return {
        ...item,
        quantity: remainingQty,
        totalPrice: scale(item.totalPrice),
        taxIncludedAmount: scale(item.taxIncludedAmount),
        salesTaxIncludedAmount: scale(item.salesTaxIncludedAmount),
        salesTaxExcludedAmount: scale(item.salesTaxExcludedAmount),
        salesTaxAmount: scale(item.salesTaxAmount),
        costTaxIncludedAmount: scale(item.costTaxIncludedAmount),
        costTaxExcludedAmount: scale(item.costTaxExcludedAmount),
        costTaxAmount: scale(item.costTaxAmount),
        grossProfitTaxIncluded: scale(item.grossProfitTaxIncluded),
        grossProfitTaxExcluded: scale(item.grossProfitTaxExcluded)
      };
    }).filter((item) => item !== null);

    if (!anyCancel) {
      window.alert('取消する数量を選択してください。');
      return;
    }

    setIsCancelling(true);
    try {
      const batch = writeBatch(db);

      // 在庫を戻す（retail商品のみ）。
      const restoreByProduct = new Map();
      cancelledEntries.forEach((entry) => {
        if (entry.sourceType === 'retail' && entry.productId) {
          restoreByProduct.set(entry.productId, (restoreByProduct.get(entry.productId) || 0) + entry.quantity);
        }
      });
      restoreByProduct.forEach((qty, productId) => {
        batch.update(doc(db, 'stores', storeId, 'products', productId), {
          inventoryQuantity: increment(qty),
          quantity: increment(qty),
          updatedAt: serverTimestamp()
        });
      });

      // 残った明細から取引合計を再計算（日計は純額で自動整合）。
      const sumBy = (key) => updatedItems.reduce((sum, item) => sum + num(item[key]), 0);
      const taxByType = (type) => updatedItems
        .filter((item) => item.salesTaxRateType === type)
        .reduce((sum, item) => sum + (num(item.salesTaxIncludedAmount) - num(item.salesTaxExcludedAmount)), 0);
      const totalAmount = sumBy('totalPrice');
      const subTotal = sumBy('salesTaxExcludedAmount');
      const taxAmountStandard = taxByType('standard');
      const taxAmountReduced = taxByType('reduced');
      const cancelledTotal = cancelledEntries.reduce((sum, entry) => sum + num(entry.amount), 0);
      const fullyCancelled = updatedItems.length === 0;

      const cancellationLog = {
        cancelledAt: new Date().toISOString(),
        reason: cancelReason.trim(),
        amount: cancelledTotal,
        type: fullyCancelled ? 'full' : 'partial',
        items: cancelledEntries
      };
      const nextCancellations = [
        ...(Array.isArray(transaction.cancellations) ? transaction.cancellations : []),
        cancellationLog
      ];

      const updatePayload = {
        items: updatedItems,
        totalAmount,
        subTotal,
        taxAmountStandard,
        taxAmountReduced,
        taxAmount: taxAmountStandard + taxAmountReduced,
        cancellations: nextCancellations,
        hasCancellations: true,
        updatedAt: serverTimestamp()
      };
      if (fullyCancelled) {
        updatePayload.status = 'cancelled';
        updatePayload.paymentStatus = 'cancelled';
        updatePayload.isPaid = false;
        updatePayload.voidedAt = serverTimestamp();
      }

      batch.update(doc(db, 'stores', storeId, 'transactions', transaction.id), updatePayload);
      await batch.commit();

      // ローカル(getDocs取得)を即時反映。
      const localPatch = {
        ...transaction,
        items: updatedItems,
        totalAmount,
        subTotal,
        taxAmountStandard,
        taxAmountReduced,
        taxAmount: taxAmountStandard + taxAmountReduced,
        cancellations: nextCancellations,
        hasCancellations: true,
        ...(fullyCancelled
          ? { status: 'cancelled', paymentStatus: 'cancelled', isPaid: false, voidedAt: new Date() }
          : {})
      };
      setTransactions((prev) => prev.map((item) => (item.id === transaction.id ? localPatch : item)));
      setCancelTarget(null);
      setCancelQty({});
      setCancelReason('');
    } catch (error) {
      console.error('[pos cancel error]', error);
      window.alert(`取消に失敗しました${error?.message ? `: ${error.message}` : ''}`);
    } finally {
      setIsCancelling(false);
    }
  };

  const cancelRefundTotal = (() => {
    if (!cancelTarget) return 0;
    const items = Array.isArray(cancelTarget.items) ? cancelTarget.items : [];
    return items.reduce((sum, item, index) => {
      const qty = Number(item.quantity || 0) || 1;
      const c = Math.min(Math.max(Number(cancelQty[index] || 0), 0), qty);
      if (c <= 0) return sum;
      const remaining = qty - c;
      const total = Number(item.totalPrice || 0);
      return sum + (total - Math.round((total * remaining) / qty));
    }, 0);
  })();

  const selectAllForCancel = () => {
    if (!cancelTarget) return;
    const all = {};
    (cancelTarget.items || []).forEach((item, index) => { all[index] = Number(item.quantity || 0) || 1; });
    setCancelQty(all);
  };

  useEffect(() => {
    if (!storeId) return undefined;

    setLoading(true);

    const ordersCollection = collection(db, 'stores', storeId, 'orders');

    const mapOrderDoc = (orderDoc) => ({
      id: orderDoc.id,
      ...orderDoc.data(),
      timestamp: orderDoc.data().timestamp?.toDate ? orderDoc.data().timestamp.toDate() : new Date(),
      paidAt: orderDoc.data().paidAt?.toDate ? orderDoc.data().paidAt.toDate() : null
    });

    if (!selectedPaidDateRange) {
      const ordersQuery = query(
        ordersCollection,
        orderBy('timestamp', 'desc'),
        limit(300)
      );

      return onSnapshot(ordersQuery, (snapshot) => {
        setOrders(snapshot.docs.map(mapOrderDoc));
        setLoading(false);
      });
    }

    let isActive = true;

    const buildRangeQuery = (fieldName) => query(
      ordersCollection,
      where(fieldName, '>=', selectedPaidDateRange.startTimestamp),
      where(fieldName, '<', selectedPaidDateRange.endTimestamp),
      orderBy(fieldName, 'desc'),
      limit(1000)
    );

    const loadOrdersForSelectedDate = async () => {
      try {
        const [
          paidAtSnapshot,
          timestampSnapshot,
          cancelledAtSnapshot,
          closedAtSnapshot,
          updatedAtSnapshot
        ] = await Promise.all([
          getDocs(buildRangeQuery('paidAt')),
          getDocs(buildRangeQuery('timestamp')),
          getDocs(buildRangeQuery('cancelledAt')),
          getDocs(buildRangeQuery('closedAt')),
          getDocs(buildRangeQuery('updatedAt'))
        ]);

        if (!isActive) return;

        const mergedDocs = await hydrateOrderSessions(
          ordersCollection,
          mergeDocsById(
            paidAtSnapshot.docs,
            timestampSnapshot.docs,
            cancelledAtSnapshot.docs,
            closedAtSnapshot.docs,
            updatedAtSnapshot.docs
          )
        );

        if (!isActive) return;

        setOrders(mergedDocs.map(mapOrderDoc));
      } catch (error) {
        console.error('[PosTransactionHistory] failed to load orders for selected date', error);
        if (isActive) setOrders([]);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    loadOrdersForSelectedDate();

    return () => {
      isActive = false;
    };
  }, [storeId, selectedPaidDateRange]);

  useEffect(() => {
    if (!storeId) return undefined;

    const transactionsCollection = collection(db, 'stores', storeId, 'transactions');

    const mapTransactionDoc = (transactionDoc) => {
      const data = transactionDoc.data();

      return {
        id: transactionDoc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(),
        paidAt: data.paidAt?.toDate ? data.paidAt.toDate() : null
      };
    };

    if (!selectedPaidDateRange) {
      const transactionsQuery = query(
        transactionsCollection,
        orderBy('timestamp', 'desc'),
        limit(300)
      );

      return onSnapshot(transactionsQuery, (snapshot) => {
        setTransactions(snapshot.docs.map(mapTransactionDoc));
      });
    }

    let isActive = true;

    const loadTransactionsForSelectedDate = async () => {
      try {
        const paidAtQuery = query(
          transactionsCollection,
          where('paidAt', '>=', selectedPaidDateRange.startTimestamp),
          where('paidAt', '<', selectedPaidDateRange.endTimestamp),
          orderBy('paidAt', 'desc'),
          limit(1000)
        );

        const timestampQuery = query(
          transactionsCollection,
          where('timestamp', '>=', selectedPaidDateRange.startTimestamp),
          where('timestamp', '<', selectedPaidDateRange.endTimestamp),
          orderBy('timestamp', 'desc'),
          limit(1000)
        );

        const [paidAtSnapshot, timestampSnapshot] = await Promise.all([
          getDocs(paidAtQuery),
          getDocs(timestampQuery)
        ]);

        if (!isActive) return;

        const mergedDocs = mergeDocsById(paidAtSnapshot.docs, timestampSnapshot.docs);
        setTransactions(mergedDocs.map(mapTransactionDoc));
      } catch (error) {
        console.error('[PosTransactionHistory] failed to load transactions for selected date', error);
        if (isActive) setTransactions([]);
      }
    };

    loadTransactionsForSelectedDate();

    return () => {
      isActive = false;
    };
  }, [storeId, selectedPaidDateRange]);

  const transactionsBySession = useMemo(() => {
    const map = new Map();

    transactions.forEach((transaction) => {
      const sessionKey = transaction.sessionId || `single-transaction-${transaction.id}`;
      if (!map.has(sessionKey)) map.set(sessionKey, []);
      map.get(sessionKey).push(transaction);
    });

    return map;
  }, [transactions]);


  const paymentMethodByOrderId = useMemo(() => {
    const map = new Map();

    transactions.forEach((transaction) => {
      const method = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);

      if (Array.isArray(transaction.customerSummaries)) {
        transaction.customerSummaries.forEach((summary) => {
          if (!Array.isArray(summary?.orderIds)) return;

          summary.orderIds.forEach((orderId) => {
            const normalizedOrderId = String(orderId || '').trim();
            if (normalizedOrderId) {
              map.set(normalizedOrderId, method);
            }
          });
        });
      }
    });

    return map;
  }, [transactions]);

  const toDateInputValue = (dateObj) => {
    if (!dateObj) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const groupedTickets = useMemo(() => {
    const grouped = new Map();

    orders.forEach((order) => {
      const sessionKey = order.sessionId || `single-${order.id}`;

      if (!grouped.has(sessionKey)) {
        grouped.set(sessionKey, {
          id: sessionKey,
          sessionId: order.sessionId || '',
          tableId: order.tableId,
          tableDisplayName: order.tableDisplayName || order.tableName || '',
          tableName: order.tableName || order.tableDisplayName || '',
          timestamp: order.timestamp,
          paidAt: order.paidAt,
          cancelledAt: resolveCancelDateValue(order),
          status: 'paid',
          totalPrice: 0,
          subtotal: 0,
          taxAmountReduced: 0,
          taxAmountStandard: 0,
          discountAmount: 0,
          guestCount: Number(
            order.guestCount ||
            order.numberOfGuests ||
            order.partySize ||
            order.customerCount ||
            0
          ),
          paymentMethod: order.paymentMethod,
          orderIds: [],
          items: []
        });
      }

      const ticket = grouped.get(sessionKey);
      if (order.id && !ticket.orderIds.includes(order.id)) ticket.orderIds.push(order.id);
      if (!ticket.sessionId && order.sessionId) ticket.sessionId = order.sessionId;
      if (order.timestamp < ticket.timestamp) ticket.timestamp = order.timestamp;
      if (order.paidAt && (!ticket.paidAt || order.paidAt > ticket.paidAt)) ticket.paidAt = order.paidAt;

      const orderCancelledAt = resolveCancelDateValue(order);
      if (orderCancelledAt && (!ticket.cancelledAt || orderCancelledAt > ticket.cancelledAt)) {
        ticket.cancelledAt = orderCancelledAt;
      }

      const isCancelled = order.status === 'cancelled' || order.paymentStatus === 'cancelled';

      if (isCancelled) {
        ticket.status = 'cancelled';
      } else if (ticket.status !== 'cancelled' && order.paymentStatus !== 'paid') {
        ticket.status = 'unpaid';
      }

      ticket.totalPrice += Number(order.totalPrice || 0);
      ticket.subtotal += Number(order.subtotal || 0);
      ticket.taxAmountReduced += Number(order.taxAmountReduced || 0);
      ticket.taxAmountStandard += Number(order.taxAmountStandard || 0);
      ticket.discountAmount += Number(order.discountAmount || 0);
      ticket.guestCount = Math.max(
        Number(ticket.guestCount || 0),
        Number(
          order.guestCount ||
          order.numberOfGuests ||
          order.partySize ||
          order.customerCount ||
          0
        )
      );
      if (Array.isArray(order.items)) {
        ticket.items = [...ticket.items, ...order.items];
      }
      if (order.paymentMethod) ticket.paymentMethod = order.paymentMethod;
    });

    return Array.from(grouped.values())
      .map((ticket) => {
        const sessionTransactions = transactionsBySession.get(ticket.id) || [];
        const paymentBreakdown = buildPaymentBreakdown(sessionTransactions);
        const paymentMethod = resolveTicketPaymentMethod(paymentBreakdown, ticket.paymentMethod);

        return {
          ...ticket,
          paymentMethod,
          paymentBreakdown,
          items: consolidateTicketItems(ticket.items)
        };
      })
      .map((ticket) => ({
        ...ticket,
        taxRates: resolveTicketTaxRates(ticket.items, settings)
      }));
  }, [orders, settings, transactionsBySession]);

  const paidSessionTickets = useMemo(() => {
    const orderById = new Map();
    const ordersBySession = new Map();

    orders.forEach((order) => {
      if (order?.id) orderById.set(order.id, order);

      const sessionKey = String(order?.sessionId || '').trim();
      if (sessionKey) {
        if (!ordersBySession.has(sessionKey)) ordersBySession.set(sessionKey, []);
        ordersBySession.get(sessionKey).push(order);
      }
    });

    const resolveLinkedOrders = (transaction) => {
      const linkedOrderIds = [];

      if (Array.isArray(transaction?.customerSummaries)) {
        transaction.customerSummaries.forEach((summary) => {
          if (!Array.isArray(summary?.orderIds)) return;

          summary.orderIds.forEach((orderId) => {
            const normalizedOrderId = String(orderId || '').trim();
            if (normalizedOrderId && !linkedOrderIds.includes(normalizedOrderId)) {
              linkedOrderIds.push(normalizedOrderId);
            }
          });
        });
      }

      const linkedOrders = linkedOrderIds
        .map((orderId) => orderById.get(orderId))
        .filter(Boolean);

      if (linkedOrders.length > 0) return linkedOrders;

      const sessionKey = String(transaction?.sessionId || transaction?.sourceSessionId || '').trim();
      return sessionKey ? (ordersBySession.get(sessionKey) || []) : [];
    };

    const transactionTickets = transactions
      .filter((transaction) => transaction && transaction?.isPaid !== false)
      .filter((transaction) => {
        // 表示中の登録レジの取引のみ（自レジ or 選択した他レジ）。
        if (ownRegisterId && !transactionMatchesViewingRegister(transaction)) return false;

        const transactionDate =
          toDateInputValue(transaction.paidAt) ||
          toDateInputValue(transaction.timestamp);

        if (selectedPaidDate && transactionDate !== selectedPaidDate) return false;

        const paymentMethod = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);
        if (paidPaymentFilter !== 'all' && paymentMethod !== paidPaymentFilter) return false;

        return true;
      })
      .map((transaction) => {
        const linkedOrders = resolveLinkedOrders(transaction);
        const primaryOrder = linkedOrders[0] || null;
        const paymentMethod = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);
        const transactionTotal = Number(transaction.totalAmount || transaction.totalPrice || transaction.amount || 0);

        const transactionItems = Array.isArray(transaction.items) && transaction.items.length > 0
          ? transaction.items
          : linkedOrders.flatMap((order) => Array.isArray(order.items) ? order.items : []);

        const items = consolidateTicketItems(transactionItems);

        const hasCancelledLinkedOrder = linkedOrders.some((order) => (
          order?.status === 'cancelled' ||
          order?.paymentStatus === 'cancelled'
        ));

        const orderIds = linkedOrders
          .map((order) => order?.id)
          .filter(Boolean);

        return {
          id: `paid-transaction-${transaction.id}`,
          sourceTransactionId: transaction.id,
          sourceSessionId: transaction.sessionId || transaction.sourceSessionId || '',
          sessionId: transaction.sessionId || transaction.sourceSessionId || '',
          tableId: transaction.tableId || primaryOrder?.tableId || 'takeout',
          tableDisplayName:
            transaction.tableDisplayName ||
            transaction.tableName ||
            primaryOrder?.tableDisplayName ||
            primaryOrder?.tableName ||
            (transaction.isTakeout ? 'テイクアウト' : ''),
          tableName:
            transaction.tableName ||
            transaction.tableDisplayName ||
            primaryOrder?.tableName ||
            primaryOrder?.tableDisplayName ||
            (transaction.isTakeout ? 'テイクアウト' : ''),
          timestamp:
            transaction.timestamp ||
            primaryOrder?.timestamp ||
            transaction.paidAt ||
            null,
          paidAt:
            transaction.paidAt ||
            transaction.timestamp ||
            primaryOrder?.paidAt ||
            null,
          status: 'paid',
          receiptType: transaction.receiptType || (transaction.isSessionComplete ? 'final' : 'partial'),
          receiptScopeLabel:
            transaction.receiptScopeLabel ||
            (transaction.receiptType === 'final' || transaction.isSessionComplete ? '最終会計' : '個別会計'),
          title: transaction.title || '領収書',
          totalPrice: transactionTotal,
          totalAmount: transactionTotal,
          subtotal: Number(transaction.subTotal || transaction.subtotal || transactionTotal || 0),
          subTotal: Number(transaction.subTotal || transaction.subtotal || transactionTotal || 0),
          taxAmount: Number(transaction.taxAmount || 0),
          taxAmountReduced: Number(transaction.taxAmountReduced || 0),
          taxAmountStandard: Number(transaction.taxAmountStandard || 0),
          discountAmount: Number(transaction.discountAmount || 0),
          guestCount: Number(
            transaction.guestCount ||
            primaryOrder?.guestCount ||
            primaryOrder?.numberOfGuests ||
            primaryOrder?.partySize ||
            primaryOrder?.customerCount ||
            0
          ),
          paymentMethod,
          paymentBreakdown: [{
            method: paymentMethod,
            label: formatPaymentMethod(paymentMethod),
            count: 1,
            total: transactionTotal,
            sourceTransactionId: transaction.id
          }],
          orderIds,
          sourceTransactionIds: [transaction.id].filter(Boolean),
          items,
          paidOrders: [{
            id: transaction.id,
            sourceTransactionId: transaction.id,
            totalPrice: transactionTotal,
            totalAmount: transactionTotal,
            subtotal: Number(transaction.subTotal || transaction.subtotal || transactionTotal || 0),
            subTotal: Number(transaction.subTotal || transaction.subtotal || transactionTotal || 0),
            taxAmount: Number(transaction.taxAmount || 0),
            taxAmountReduced: Number(transaction.taxAmountReduced || 0),
            taxAmountStandard: Number(transaction.taxAmountStandard || 0),
            discountAmount: Number(transaction.discountAmount || 0),
            paymentMethod,
            receiptType: transaction.receiptType || (transaction.isSessionComplete ? 'final' : 'partial'),
            receiptScopeLabel:
              transaction.receiptScopeLabel ||
              (transaction.receiptType === 'final' || transaction.isSessionComplete ? '最終会計' : '個別会計'),
            title: transaction.title || '領収書',
            timestamp: transaction.timestamp,
            paidAt: transaction.paidAt || transaction.timestamp,
            status: 'paid',
            paymentStatus: 'paid',
            items
          }],
          excludedOrders: [],
          hasCancelledLinkedOrder,
          cancellations: Array.isArray(transaction.cancellations) ? transaction.cancellations : [],
          isTakeout:
            transaction?.isTakeout === true ||
            transaction?.orderType === 'takeout' ||
            transaction?.serviceType === 'takeout' ||
            String(transaction?.tableId || '').toLowerCase() === 'takeout',
          taxRates: resolveTicketTaxRates(items, settings)
        };
      });

    return transactionTickets.sort((left, right) => {
      const leftTime = left.paidAt?.getTime?.() || left.timestamp?.getTime?.() || 0;
      const rightTime = right.paidAt?.getTime?.() || right.timestamp?.getTime?.() || 0;
      return rightTime - leftTime;
    });
  }, [orders, paidPaymentFilter, selectedPaidDate, settings, transactions, ownRegisterId, viewingRegisterId]);

  // 会計後キャンセル（全額/一部）をキャンセルタブ用のチケットに変換。
  const cancelledTransactionTickets = useMemo(() => {
    return transactions
      .filter((transaction) => Array.isArray(transaction.cancellations) && transaction.cancellations.length > 0)
      .filter((transaction) => {
        if (!ownRegisterId) return true;
        const rid = String(transaction.registerId || '');
        if (!rid) return viewingRegisterId === ownRegisterId;
        return rid === viewingRegisterId;
      })
      .flatMap((transaction) => (transaction.cancellations || []).map((cancellation, index) => {
        const when = toDateValue(cancellation.cancelledAt)
          || toDateValue(transaction.voidedAt)
          || toDateValue(transaction.paidAt)
          || null;
        const items = Array.isArray(cancellation.items)
          ? cancellation.items.map((ci) => ({
            name: ci.name || '商品',
            quantity: Number(ci.quantity || 0),
            totalPrice: Number(ci.amount || 0),
            unitPrice: Number(ci.quantity) > 0
              ? Math.round(Number(ci.amount || 0) / Number(ci.quantity))
              : Number(ci.amount || 0)
          }))
          : [];
        return {
          id: `cancel-${transaction.id}-${index}`,
          status: 'cancelled',
          sourceTransactionId: transaction.id,
          sourceTransactionIds: [transaction.id],
          tableId: transaction.tableId || 'takeout',
          tableDisplayName: transaction.tableDisplayName || transaction.tableName || (transaction.isTakeout ? 'テイクアウト' : ''),
          tableName: transaction.tableName || transaction.tableDisplayName || (transaction.isTakeout ? 'テイクアウト' : ''),
          totalPrice: Number(cancellation.amount || 0),
          totalAmount: Number(cancellation.amount || 0),
          timestamp: when,
          paidAt: when,
          cancelledAt: when,
          items,
          cancelType: cancellation.type || 'full',
          cancelReason: cancellation.reason || '',
          paidOrders: [],
          paymentBreakdown: [],
          excludedOrders: [],
          taxRates: {}
        };
      }));
  }, [transactions, ownRegisterId, viewingRegisterId]);

  const clearCloseTicketLongPress = () => {
    if (closeTicketTimerRef.current) {
      window.clearTimeout(closeTicketTimerRef.current);
      closeTicketTimerRef.current = null;
    }
  };

  const startCloseTicketLongPress = (event, ticket) => {
    event?.stopPropagation?.();

    if (!ticket || ticket.status === 'paid' || ticket.status === 'cancelled' || isClosingTicket) return;

    clearCloseTicketLongPress();

    closeTicketTimerRef.current = window.setTimeout(() => {
      closeTicketTimerRef.current = null;
      setCloseTicketTarget(ticket);
    }, 850);
  };

  const closeCloseTicketModal = () => {
    if (isClosingTicket) return;
    setCloseTicketTarget(null);
  };

  const executeCloseUnpaidTicket = async () => {
    if (!closeTicketTarget || isClosingTicket || !storeId) return;

    const targetSessionId = closeTicketTarget.sessionId || closeTicketTarget.id;
    const targetOrderIds = Array.isArray(closeTicketTarget.orderIds) ? closeTicketTarget.orderIds : [];
    const targetTableId = String(closeTicketTarget.tableId || '').trim();

    if (!targetSessionId && targetOrderIds.length === 0) {
      alert('対象の伝票情報が見つかりません');
      return;
    }

    setIsClosingTicket(true);

    try {
      const batch = writeBatch(db);
      const closedAt = serverTimestamp();

      targetOrderIds.forEach((orderId) => {
        batch.update(doc(db, 'stores', storeId, 'orders', orderId), {
          status: 'cancelled',
          paymentStatus: 'cancelled',
          cancelledAt: closedAt,
          closedAt,
          closeReason: 'pos_history_manual_close',
          updatedAt: closedAt
        });
      });

      if (targetSessionId && !String(targetSessionId).startsWith('single-')) {
        batch.set(doc(db, 'stores', storeId, 'sessions', targetSessionId), {
          status: 'cancelled',
          paymentStatus: 'cancelled',
          cancelledAt: closedAt,
          closedAt,
          closeReason: 'pos_history_manual_close',
          updatedAt: closedAt
        }, { merge: true });
      }

      if (targetTableId) {
        batch.set(doc(db, 'stores', storeId, 'tables', targetTableId), {
          tableId: targetTableId,
          currentSessionId: null,
          currentSessionStatus: 'idle',
          updatedAt: closedAt
        }, { merge: true });

        batch.set(doc(db, 'stores', storeId, 'tableSessions', targetTableId), {
          tableId: targetTableId,
          sessionId: null,
          status: 'idle',
          updatedAt: closedAt,
          lastClosedSessionId: targetSessionId || '',
          lastClosedAt: closedAt
        }, { merge: true });

        batch.delete(doc(db, 'stores', storeId, 'tableEntryGuards', targetTableId));
      }

      if (targetSessionId && !String(targetSessionId).startsWith('single-')) {
        const inviteQuery = query(
          collection(db, 'stores', storeId, 'sessionInvites'),
          where('sessionId', '==', targetSessionId)
        );
        const inviteSnapshot = await getDocs(inviteQuery);
        inviteSnapshot.forEach((inviteDoc) => batch.delete(inviteDoc.ref));

        const requestQuery = query(
          collection(db, 'stores', storeId, 'serviceRequests'),
          where('sessionId', '==', targetSessionId)
        );
        const requestSnapshot = await getDocs(requestQuery);
        requestSnapshot.forEach((requestDoc) => {
          batch.update(requestDoc.ref, {
            status: 'completed',
            completedAt: closedAt,
            closeReason: 'pos_history_manual_close',
            updatedAt: closedAt
          });
        });
      }

      await batch.commit();

      setCloseTicketTarget(null);
      setExpandedTicketId(null);
    } catch (error) {
      console.error('未会計伝票クローズエラー:', error);
      alert('伝票を閉じる処理に失敗しました');
    } finally {
      setIsClosingTicket(false);
    }
  };




  const getTicketBusinessDate = (ticket) => {
    const targetDate = resolvePaidDateValue(ticket) || resolveOrderDateValue(ticket);
    return toDateInputValue(targetDate);
  };

  const getTicketCancelDate = (ticket) => {
    const targetDate = resolveCancelDateValue(ticket) || resolveOrderDateValue(ticket);
    return toDateInputValue(targetDate);
  };

  const getTicketHistoryDate = (ticket) => {
    const targetDate = resolveHistoryDateValue(ticket);
    return toDateInputValue(targetDate);
  };

  const ticketMatchesPaidPaymentFilter = (ticket) => {
    if (paidPaymentFilter === 'all') return true;

    const breakdown = Array.isArray(ticket?.paymentBreakdown)
      ? ticket.paymentBreakdown
      : [];

    if (breakdown.length > 0) {
      return breakdown.some((entry) => entry?.method === paidPaymentFilter);
    }

    const method = getPaymentMethodKey(ticket?.paymentMethod);
    return method === paidPaymentFilter;
  };

  const filteredTickets = useMemo(() => {
    if (filter === 'paid') {
      return paidSessionTickets;
    }

    if (filter === 'unpaid') {
      return groupedTickets
        .filter((ticket) => ticket.status === 'unpaid')
        .filter((ticket) => !selectedPaidDate || getTicketHistoryDate(ticket) === selectedPaidDate);
    }

    if (filter === 'cancelled') {
      return [
        ...groupedTickets.filter((ticket) => ticket.status === 'cancelled'),
        ...cancelledTransactionTickets
      ]
        .filter((ticket) => !selectedPaidDate || getTicketCancelDate(ticket) === selectedPaidDate)
        .sort((left, right) => {
          const leftTime = (resolveCancelDateValue(left) || resolveOrderDateValue(left))?.getTime?.() || 0;
          const rightTime = (resolveCancelDateValue(right) || resolveOrderDateValue(right))?.getTime?.() || 0;
          return rightTime - leftTime;
        });
    }

    return groupedTickets
      .filter((ticket) => !selectedPaidDate || getTicketHistoryDate(ticket) === selectedPaidDate)
      .sort((left, right) => {
        const leftTime = resolveHistoryDateValue(left)?.getTime?.() || 0;
        const rightTime = resolveHistoryDateValue(right)?.getTime?.() || 0;
        return rightTime - leftTime;
      });
  }, [filter, groupedTickets, paidSessionTickets, selectedPaidDate, cancelledTransactionTickets]);



  const displayTickets = useMemo(() => {
    if (filter !== 'paid') return filteredTickets;

    const grouped = new Map();

    const isTakeoutTicket = (ticket = {}) => (
      ticket.isTakeout === true ||
      String(ticket.tableId || '').toLowerCase() === 'takeout' ||
      String(ticket.sessionId || ticket.sourceSessionId || '').startsWith('takeout-')
    );

    const getTicketAmount = (ticket = {}) => (
      Number(ticket.totalPrice ?? ticket.totalAmount ?? ticket.amount ?? 0) || 0
    );

    const getTicketPaymentMethod = (ticket = {}) => (
      getPaymentMethodKey(ticket.paymentMethodGroup || ticket.paymentMethod)
    );

    const addPaymentBreakdown = (target, method, amount) => {
      const normalizedMethod = getPaymentMethodKey(method);
      const normalizedAmount = Number(amount || 0) || 0;

      const existing = target.paymentBreakdown.find((entry) => entry.method === normalizedMethod);
      if (existing) {
        existing.count += 1;
        existing.total += normalizedAmount;
        return;
      }

      target.paymentBreakdown.push({
        method: normalizedMethod,
        label: formatPaymentMethod(normalizedMethod),
        count: 1,
        total: normalizedAmount
      });
    };

    filteredTickets.forEach((ticket) => {
      const sessionKey = String(ticket.sourceSessionId || ticket.sessionId || '').trim();
      const orderKey = Array.isArray(ticket.orderIds) && ticket.orderIds.length > 0
        ? `orders-${ticket.orderIds.map((orderId) => String(orderId || '').trim()).filter(Boolean).sort().join('|')}`
        : '';

      // 会計済み履歴は、同一伝票の支払い内訳を表示するため sessionId を最優先でまとめる。
      // テイクアウトでも sessionId がある場合は同じ伝票としてまとめる。
      // sessionId がない古いデータだけ orderIds / ticket.id にフォールバックする。
      const groupKey = sessionKey
        ? `session-${sessionKey}`
        : orderKey || `ticket-${ticket.id}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          ...ticket,
          id: `display-${groupKey}`,
          sourceDisplayTicketIds: [],
          sourceTransactionIds: [],
          orderIds: [],
          items: [],
          paidOrders: [],
          excludedOrders: [],
          totalPrice: 0,
          subtotal: 0,
          taxAmountReduced: 0,
          taxAmountStandard: 0,
          discountAmount: 0,
          paymentBreakdown: [],
          paymentMethod: '',
          hasCancelledLinkedOrder: false
        });
      }

      const groupedTicket = grouped.get(groupKey);
      const ticketAmount = getTicketAmount(ticket);
      const ticketPaymentMethod = getTicketPaymentMethod(ticket);

      groupedTicket.sourceDisplayTicketIds = [
        ...new Set([
          ...(Array.isArray(groupedTicket.sourceDisplayTicketIds) ? groupedTicket.sourceDisplayTicketIds : []),
          ticket.id
        ].filter(Boolean))
      ];

      groupedTicket.sourceTransactionIds = [
        ...new Set([
          ...(Array.isArray(groupedTicket.sourceTransactionIds) ? groupedTicket.sourceTransactionIds : []),
          ...(Array.isArray(ticket.sourceTransactionIds) ? ticket.sourceTransactionIds : []),
          ticket.sourceTransactionId
        ].filter(Boolean))
      ];

      groupedTicket.orderIds = [
        ...new Set([
          ...(Array.isArray(groupedTicket.orderIds) ? groupedTicket.orderIds : []),
          ...(Array.isArray(ticket.orderIds) ? ticket.orderIds : [])
        ].filter(Boolean))
      ];

      groupedTicket.items = [
        ...(Array.isArray(groupedTicket.items) ? groupedTicket.items : []),
        ...(Array.isArray(ticket.items) ? ticket.items : [])
      ];

      groupedTicket.paidOrders = [
        ...(Array.isArray(groupedTicket.paidOrders) ? groupedTicket.paidOrders : []),
        ...(Array.isArray(ticket.paidOrders) ? ticket.paidOrders : [])
      ];

      groupedTicket.excludedOrders = [
        ...(Array.isArray(groupedTicket.excludedOrders) ? groupedTicket.excludedOrders : []),
        ...(Array.isArray(ticket.excludedOrders) ? ticket.excludedOrders : [])
      ];

      groupedTicket.totalPrice += ticketAmount;
      groupedTicket.subtotal += Number(ticket.subtotal || ticket.subTotal || ticketAmount || 0) || 0;
      groupedTicket.taxAmountReduced += Number(ticket.taxAmountReduced || 0);
      groupedTicket.taxAmountStandard += Number(ticket.taxAmountStandard || 0);
      groupedTicket.discountAmount += Number(ticket.discountAmount || 0);

      groupedTicket.guestCount = Math.max(
        Number(groupedTicket.guestCount || 0),
        Number(ticket.guestCount || 0)
      );

      if (ticket.hasCancelledLinkedOrder) {
        groupedTicket.hasCancelledLinkedOrder = true;
      }

      if (ticket.timestamp && (!groupedTicket.timestamp || ticket.timestamp < groupedTicket.timestamp)) {
        groupedTicket.timestamp = ticket.timestamp;
      }

      if (ticket.paidAt && (!groupedTicket.paidAt || ticket.paidAt > groupedTicket.paidAt)) {
        groupedTicket.paidAt = ticket.paidAt;
      }

      const breakdown = Array.isArray(ticket.paymentBreakdown) && ticket.paymentBreakdown.length > 0
        ? ticket.paymentBreakdown
        : [{ method: ticketPaymentMethod, total: ticketAmount }];

      breakdown.forEach((entry) => {
        addPaymentBreakdown(groupedTicket, entry.method, Number(entry.total || 0));
      });

      groupedTicket.paymentMethod = groupedTicket.paymentBreakdown.length === 1
        ? groupedTicket.paymentBreakdown[0].method
        : 'mixed';
    });

    return Array.from(grouped.values())
      .map((ticket) => {
        const items = consolidateTicketItems(ticket.items);

        const paymentBreakdown = ticket.paymentBreakdown.sort((left, right) => {
          const order = { cash: 1, card: 2, qr: 3, other: 4, mixed: 5 };
          return (order[left.method] || 99) - (order[right.method] || 99);
        });

        const displayPaidOrders = Array.isArray(ticket.paidOrders) && ticket.paidOrders.length > 0
          ? ticket.paidOrders.map((payment, index) => ({
              ...payment,
              id: payment.id || payment.sourceTransactionId || `${ticket.id || 'payment'}-${index}`,
              sourceTransactionId: payment.sourceTransactionId || payment.id || '',
              paymentMethod: getPaymentMethodKey(payment.paymentMethod || payment.paymentMethodGroup),
              totalPrice: Number(payment.totalPrice ?? payment.totalAmount ?? payment.amount ?? 0) || 0,
              totalAmount: Number(payment.totalPrice ?? payment.totalAmount ?? payment.amount ?? 0) || 0,
              subtotal: Number(payment.subtotal ?? payment.subTotal ?? payment.totalPrice ?? payment.totalAmount ?? 0) || 0,
              subTotal: Number(payment.subtotal ?? payment.subTotal ?? payment.totalPrice ?? payment.totalAmount ?? 0) || 0,
              taxAmount: Number(payment.taxAmount || 0),
              taxAmountReduced: Number(payment.taxAmountReduced || 0),
              taxAmountStandard: Number(payment.taxAmountStandard || 0),
              discountAmount: Number(payment.discountAmount || 0),
              receiptType: payment.receiptType || 'partial',
              receiptScopeLabel: payment.receiptScopeLabel || '個別会計',
              timestamp: payment.timestamp || ticket.timestamp,
              paidAt: payment.paidAt || ticket.paidAt,
              items: Array.isArray(payment.items) ? payment.items : []
            }))
          : paymentBreakdown.map((entry, index) => ({
              id: `${ticket.id || 'payment'}-${entry.method || 'payment'}-${index}`,
              paymentMethod: entry.method,
              totalPrice: Number(entry.total || 0),
              totalAmount: Number(entry.total || 0),
              timestamp: ticket.timestamp,
              paidAt: ticket.paidAt,
              isDisplayPaymentBreakdown: true,
              label: entry.label || formatPaymentMethod(entry.method),
              items
            }));

        return {
          ...ticket,
          items,
          taxRates: resolveTicketTaxRates(items, settings),
          paymentBreakdown,
          paidOrders: displayPaidOrders
        };
      })
      .sort((left, right) => {
        const leftTime = left.paidAt?.getTime?.() || left.timestamp?.getTime?.() || 0;
        const rightTime = right.paidAt?.getTime?.() || right.timestamp?.getTime?.() || 0;
        return rightTime - leftTime;
      });
  }, [filter, filteredTickets, settings]);


  const paidPaymentSummary = useMemo(() => {
    const base = {
      cash: { method: 'cash', label: '現金', count: 0, total: 0 },
      card: { method: 'card', label: 'カード', count: 0, total: 0 },
      qr: { method: 'qr', label: 'QR決済', count: 0, total: 0 }
    };

    transactions.forEach((transaction) => {
      if (!transaction || transaction?.isPaid === false) return;

      const transactionDate =
        toDateInputValue(transaction.paidAt) ||
        toDateInputValue(transaction.timestamp);

      if (selectedPaidDate && transactionDate !== selectedPaidDate) return;

      const method = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);
      if (paidPaymentFilter !== 'all' && method !== paidPaymentFilter) return;
      if (!base[method]) return;

      base[method].count += 1;
      base[method].total += Number(transaction.totalAmount || transaction.totalPrice || transaction.amount || 0);
    });

    return [base.cash, base.card, base.qr];
  }, [paidPaymentFilter, selectedPaidDate, transactions]);

  const paidPaymentSummaryTotal = paidPaymentSummary.reduce((sum, entry) => (
    sum + Number(entry.total || 0)
  ), 0);

  const formatOrderStatusLabel = (order) => {
    if (order?.status === 'cancelled' || order?.paymentStatus === 'cancelled') return 'キャンセル';
    if (order?.paymentStatus === 'paid') return '会計済み';
    if (order?.paymentStatus === 'unpaid') return '未会計';
    return order?.status || order?.paymentStatus || '未処理';
  };

  const formatOrderStatusClass = (order) => {
    if (order?.status === 'cancelled' || order?.paymentStatus === 'cancelled') {
      return 'bg-red-50 text-red-600';
    }

    if (order?.paymentStatus === 'paid') {
      return 'bg-green-50 text-green-600';
    }

    return 'bg-orange-50 text-orange-600';
  };

  const formatPaymentBadgeClass = (method) => {
    const key = getPaymentMethodKey(method);

    if (key === 'cash') {
      return 'border-slate-300 bg-slate-100 text-slate-900';
    }

    if (key === 'card') {
      return 'border-blue-200 bg-blue-50 text-blue-700';
    }

    if (key === 'qr') {
      return 'border-purple-200 bg-purple-50 text-purple-700';
    }

    return 'border-gray-200 bg-gray-50 text-gray-600';
  };

  const formatShortOrderId = (orderId) => {
    const value = String(orderId || '');
    return value ? value.slice(0, 6) : '------';
  };

  const formatSourceSessionLabel = (ticket) => {
    const value = String(ticket?.sourceSessionId || ticket?.sessionId || '').trim();
    if (!value || value.startsWith('single-')) return '';

    return value.slice(0, 8);
  };

  const formatGuestCount = (ticket) => {
    const count = Number(ticket?.guestCount || 0);
    return count > 0 ? `${count}名` : '人数未設定';
  };

  const isDifferentHistoryDate = (ticket, isPaid, isCancelled) => {
    const orderDate = toDateInputValue(resolveOrderDateValue(ticket));
    const historyDate = isCancelled
      ? toDateInputValue(resolveCancelDateValue(ticket))
      : isPaid
        ? toDateInputValue(resolvePaidDateValue(ticket))
        : '';

    return Boolean(orderDate && historyDate && orderDate !== historyDate);
  };

  const formatTicketPaidTime = (ticket, isPaid, isCancelled) => {
    if (isCancelled) {
      const cancelledTime = formatTransactionDateTime(ticket);
      return cancelledTime || '日時未記録';
    }

    if (!isPaid) return '未会計';
    return formatTime(ticket?.paidAt);
  };

  const formatTime = (dateObj) => {
    if (!dateObj) return '---';
    return dateObj.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex min-h-[96px] shrink-0 items-center justify-between gap-3 border-b bg-gray-50 p-4 font-black text-gray-700">
        <div className="flex min-w-0 items-center gap-2">
          <Receipt size={18} className="shrink-0 text-gray-500" />
          <span className="shrink-0">{filter === 'hold' ? '保留伝票' : '会計履歴'}</span>
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-bold tabular-nums text-gray-500">
            {filter === 'hold' ? posHolds.length : displayTickets.length}件
          </span>
        </div>

        {(filter === 'paid' || filter === 'cancelled') && (
          <div className="flex min-h-[40px] shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white p-1 shadow-sm">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedPaidDate(todayDateValue)}
                className={`h-10 min-w-[64px] rounded-full px-3 text-xs font-black transition-colors ${
                  selectedPaidDate === todayDateValue
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                今日
              </button>

              <button
                type="button"
                onClick={() => setSelectedPaidDate('')}
                className={`h-10 min-w-[64px] rounded-full px-3 text-xs font-black transition-colors ${
                  !selectedPaidDate
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                すべて
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftSelectedPaidDate(-1)}
                disabled={!selectedPaidDate}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400 disabled:opacity-50"
                aria-label="前日"
              >
                ＜
              </button>

              <input
                type="date"
                value={selectedPaidDate || ''}
                max={todayDateValue}
                onChange={(event) => setSelectedPaidDate(event.target.value)}
                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-800 outline-none transition-colors focus:border-blue-400"
              />

              <button
                type="button"
                onClick={() => shiftSelectedPaidDate(1)}
                disabled={!selectedPaidDate || isSelectedPaidDateToday}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400 disabled:opacity-50"
                aria-label="翌日"
              >
                ＞
              </button>
            </div>
          </div>
        )}
        {filter === 'unpaid' && (
          <div
            aria-hidden="true"
            className="pointer-events-none invisible flex min-h-[40px] shrink-0 items-center gap-2 rounded-full border border-transparent bg-transparent p-1"
          >
            <span className="h-10 min-w-[64px] rounded-full px-3 text-xs font-black">今日</span>
            <span className="h-10 min-w-[64px] rounded-full px-3 text-xs font-black">すべて</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full">＜</span>
            <span className="h-10 w-[136px] rounded-xl px-3 text-xs font-bold" />
            <span className="flex h-10 w-10 items-center justify-center rounded-full">＞</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-1 border-b border-gray-100 bg-white p-2">
        {viewedRegisterMode === 'pos' && !isViewingOtherRegister && (
          <button
            type="button"
            onClick={() => setFilter('hold')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold ${
              filter === 'hold'
                ? (posHolds.length > 0 ? 'bg-amber-500 text-white shadow-md' : 'bg-gray-200 text-gray-700')
                : (posHolds.length > 0 ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-500 hover:bg-gray-50')
            }`}
          >
            <PauseCircle size={14} />
            保留{posHolds.length > 0 ? `（${posHolds.length}）` : ''}
          </button>
        )}
        {viewedRegisterMode !== 'pos' && (
          <button
            type="button"
            onClick={() => setFilter('unpaid')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold ${
              filter === 'unpaid' ? 'bg-orange-500 text-white shadow-md' : 'text-gray-500 hover:bg-orange-50'
            }`}
          >
            <Filter size={14} />
            未会計
          </button>
        )}

        <button
          type="button"
          onClick={() => setFilter('paid')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold ${
            filter === 'paid' ? 'bg-green-500 text-white shadow-md' : 'text-gray-500 hover:bg-green-50'
          }`}
        >
          <CheckCircle2 size={14} />
          会計済み
        </button>
        <button
          type="button"
          onClick={() => setFilter('cancelled')}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold ${
            filter === 'cancelled' ? 'bg-red-500 text-white shadow-md' : 'text-gray-500 hover:bg-red-50'
          }`}
        >
          <XCircle size={14} />
          取消
        </button>
      </div>

      {registers.length > 1 && (
        <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            {isViewingOtherRegister ? (
              <button
                type="button"
                onClick={() => { setViewingRegisterId(ownRegisterId); setPickingRegister(false); }}
                className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200"
              >
                <ChevronLeft size={14} />
                自レジに戻る
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPickingRegister((value) => !value)}
                className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
              >
                その他のレジの履歴表示
              </button>
            )}
            <span className="truncate text-sm font-black text-gray-800">
              {viewedRegister?.name || '自レジ'}
              {viewedRegister?.departmentName && (
                <span className="ml-1 text-xs font-bold text-gray-400">{viewedRegister.departmentName}</span>
              )}
            </span>
          </div>

          {pickingRegister && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {registers.filter((register) => register.id !== ownRegisterId).map((register) => (
                <button
                  key={register.id}
                  type="button"
                  onClick={() => { setViewingRegisterId(register.id); setPickingRegister(false); }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                >
                  {register.name}
                  <span className="block text-[10px] font-bold text-gray-400">{register.departmentName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {(filter === 'paid' || filter === 'cancelled') && (
        <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-2">
          <div className="mb-2 rounded-2xl border border-gray-100 bg-gray-50 p-2.5">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-white p-1 shadow-sm">
              {[
                {
                  id: 'all',
                  label: 'すべて',
                  activeClassName: 'bg-green-500 text-white shadow-sm',
                  inactiveClassName: 'bg-white text-gray-700 hover:bg-gray-50'
                },
                {
                  id: 'cash',
                  label: '現金',
                  activeClassName: 'bg-slate-900 text-white shadow-sm',
                  inactiveClassName: 'bg-white text-slate-800 hover:bg-slate-100'
                },
                {
                  id: 'card',
                  label: 'カード',
                  activeClassName: 'bg-blue-600 text-white shadow-sm',
                  inactiveClassName: 'bg-white text-blue-700 hover:bg-blue-50'
                },
                {
                  id: 'qr',
                  label: 'QR',
                  activeClassName: 'bg-purple-600 text-white shadow-sm',
                  inactiveClassName: 'bg-white text-purple-700 hover:bg-purple-50'
                }
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPaidPaymentFilter(option.id)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-black transition-colors ${
                    paidPaymentFilter === option.id
                      ? `${option.activeClassName} border-transparent`
                      : `${option.inactiveClassName} border-gray-100`
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] font-bold text-green-700">
            <span className="font-black">
              合計 ¥{Number(paidPaymentSummaryTotal || 0).toLocaleString()}
            </span>
            {paidPaymentSummary.map((entry) => (
              <span key={entry.method} className="tabular-nums">
                {entry.label} ¥{Number(entry.total || 0).toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex-grow space-y-3 overflow-y-auto bg-slate-50/50 p-3">
        {filter === 'hold' && posHolds.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-gray-400">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
              <PauseCircle size={28} />
            </div>
            <p className="rounded-full bg-amber-50 px-4 py-2 text-sm font-black text-amber-700">
              保留中の伝票はありません
            </p>
          </div>
        )}

        {filter === 'hold' && posHolds.map((hold) => {
          const cart = Array.isArray(hold.cart) ? hold.cart : [];
          const count = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
          const total = cart.reduce(
            (sum, item) => sum + Number(item.totalPrice ?? (Number(item.unitPrice || item.price || 0) * Number(item.quantity || 1))),
            0
          );
          return (
            <div key={hold.id} className="rounded-2xl border border-amber-100 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-800">{hold.title || '保留'}</div>
                  <div className="text-xs font-bold text-slate-400">{count}点 ・ ¥{total.toLocaleString()}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onDeleteHold?.(hold.id)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50"
                  >
                    削除
                  </button>
                  <button
                    type="button"
                    onClick={() => onResumeHold?.(hold.id)}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-amber-600"
                  >
                    復帰
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filter !== 'hold' && loading && (
          <div className="py-10 text-center">
              <LoadingSpinner size={32} className="inline" />
          </div>
        )}

        {filter !== 'hold' && !loading && displayTickets.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-gray-400">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
              filter === 'paid' && paidPaymentFilter === 'cash'
                ? 'bg-slate-900 text-white shadow-sm'
                : filter === 'paid' && paidPaymentFilter === 'card'
                  ? 'bg-blue-50 text-blue-500'
                  : filter === 'paid' && paidPaymentFilter === 'qr'
                    ? 'bg-purple-50 text-purple-500'
                    : filter === 'paid'
                      ? 'bg-green-50 text-green-500'
                      : 'bg-gray-100 text-gray-400'
            }`}>
              <Filter size={28} />
            </div>
            <p className={`rounded-full px-4 py-2 text-sm font-black ${
              filter === 'paid' && paidPaymentFilter === 'cash'
                ? 'bg-slate-900 text-white shadow-sm'
                : filter === 'paid' && paidPaymentFilter === 'card'
                  ? 'bg-blue-50 text-blue-700'
                  : filter === 'paid' && paidPaymentFilter === 'qr'
                    ? 'bg-purple-50 text-purple-700'
                    : filter === 'paid'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500'
            }`}>
              {filter === 'paid'
                ? selectedPaidDate
                  ? '選択した日付・支払い方法の会計済み伝票がありません'
                  : '選択した支払い方法の会計済み伝票がありません'
                : filter === 'cancelled' && selectedPaidDate
                  ? '選択した日付の取消履歴がありません'
                  : '該当する会計履歴がありません'}
            </p>
          </div>
        )}

        {filter !== 'hold' && !loading && displayTickets.map((ticket, index) => {
          const isExpanded = expandedTicketId === ticket.id;
          const isPaid = ticket.status === 'paid';
          const isCancelled = ticket.status === 'cancelled';
          const hasDifferentHistoryDate = isDifferentHistoryDate(ticket, isPaid, isCancelled);
          const totalItemsCount = ticket.items?.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 0;
          // 取消数量を商品名ごとに集計（商品行を「元の数量」で表示するために残数へ足し戻す）。
          const cancelledByName = new Map();
          let cancelledTotalCount = 0;
          (Array.isArray(ticket.cancellations) ? ticket.cancellations : []).forEach((cancellation) => {
            (cancellation.items || []).forEach((cItem) => {
              const q = Number(cItem.quantity || 0);
              cancelledByName.set(cItem.name, (cancelledByName.get(cItem.name) || 0) + q);
              cancelledTotalCount += q;
            });
          });
          const paymentRowsCount = Array.isArray(ticket.paidOrders) ? ticket.paidOrders.length : 0;
          const breakdownRowsCount = Array.isArray(ticket.paymentBreakdown)
            ? ticket.paymentBreakdown.reduce((sum, entry) => sum + Math.max(Number(entry?.count || 1), 1), 0)
            : 0;
          const sourceTransactionRowsCount = Array.isArray(ticket.sourceTransactionIds) ? ticket.sourceTransactionIds.length : 0;
          const hasMultiplePayments = isPaid && Math.max(paymentRowsCount, breakdownRowsCount, sourceTransactionRowsCount) > 1;
          const ticketCardDomId = `pos-ticket-card-${String(ticket.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          const previousTicket = displayTickets[index - 1] || null;
          const previousTicketCardDomId = previousTicket
            ? `pos-ticket-card-${String(previousTicket.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`
            : '';

          return (
            <div
              id={ticketCardDomId}
              key={ticket.id}
              className={`relative overflow-hidden rounded-xl border bg-white ${
                isExpanded ? 'z-10 border-gray-200 shadow-lg ring-1 ring-gray-200' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              <div
                className="group flex cursor-pointer select-none items-center justify-between p-4"
                onClick={() => {
                  const nextExpandedTicketId = isExpanded ? null : ticket.id;
                  setExpandedTicketId(nextExpandedTicketId);

                  if (nextExpandedTicketId) {
                    window.setTimeout(() => {
                      const scrollTarget =
                        previousTicketCardDomId
                          ? document.getElementById(previousTicketCardDomId)
                          : document.getElementById(ticketCardDomId);

                      scrollTarget?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                      });
                    }, 80);
                  }
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black leading-none text-gray-800">
                      {getTableDisplayName(ticket) || 'テイクアウト'}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-black tracking-wider ${
                        isCancelled
                          ? 'bg-red-50 text-red-600'
                          : isPaid
                            ? getPaymentMethodKey(ticket.paymentMethod) === 'cash'
                              ? 'bg-slate-100 text-slate-900 ring-1 ring-slate-200'
                              : getPaymentMethodKey(ticket.paymentMethod) === 'card'
                                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                                : getPaymentMethodKey(ticket.paymentMethod) === 'qr'
                                  ? 'bg-purple-50 text-purple-700 ring-1 ring-purple-100'
                                  : 'bg-green-50 text-green-600'
                            : 'bg-orange-50 text-orange-600'
                      }`}
                    >
                      {isCancelled ? '取消' : isPaid ? '会計済み' : '未会計'}
                    </span>
                    {isPaid && ticket.hasCancelledLinkedOrder && (
                      <span className="rounded px-2 py-0.5 text-[10px] font-black tracking-wider bg-red-50 text-red-600 ring-1 ring-red-100">
                        注文キャンセルあり
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold tabular-nums text-gray-400">
                    <span>注文 {formatDateTimeShort(ticket.timestamp) || formatTime(ticket.timestamp)}</span>
                    <span className="h-1 w-1 rounded-full bg-gray-300" />
                    <span>{isCancelled ? '取消' : '会計'} {formatTicketPaidTime(ticket, isPaid, isCancelled)}</span>
                    {hasDifferentHistoryDate && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-gray-300" />
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 ring-1 ring-amber-100">
                          注文日違い
                        </span>
                      </>
                    )}
                    <span className="h-1 w-1 rounded-full bg-gray-300" />
                    <span>{formatGuestCount(ticket)}</span>
                    <span className="h-1 w-1 rounded-full bg-gray-300" />
                    <span>{totalItemsCount}点</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end">
                    <span className="text-xl font-black leading-none tabular-nums text-gray-900">
                      ¥{Number(ticket.totalPrice || 0).toLocaleString()}
                    </span>
                  </div>

                  {isPaid && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();

                        if (hasMultiplePayments) {
                          try {
                            void printTicketStatement(ticket, settings);
                          } catch (error) {
                            console.error('[pos statement print click error]', error, { ticket });
                            alert('会計明細の印刷処理に失敗しました。');
                          }
                          return;
                        }

                        const firstPayment = Array.isArray(ticket.paidOrders) ? ticket.paidOrders[0] : null;
                        if (firstPayment) {
                          printPaymentReceipt(firstPayment, ticket, settings);
                          return;
                        }

                        printReceipt(ticket, settings);
                      }}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-black text-gray-600 shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
                    >
                      <Printer size={13} />
                      {hasMultiplePayments ? (
                        '明細印刷'
                      ) : (
                        <span className="flex flex-col items-center leading-none">
                          <span>レシート</span>
                          <span>再印刷</span>
                        </span>
                      )}
                    </button>
                  )}

                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    isExpanded ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200 group-hover:text-gray-600'
                  }`}>
                    <ChevronDown size={18} className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-100 bg-slate-50/50 px-5 pb-5 pt-2">
                  <div className="space-y-4">
                    {!isPaid && !isCancelled && (
                      <button
                        type="button"
                        onPointerDown={(event) => startCloseTicketLongPress(event, ticket)}
                        onPointerUp={clearCloseTicketLongPress}
                        onPointerLeave={clearCloseTicketLongPress}
                        onPointerCancel={clearCloseTicketLongPress}
                        onContextMenu={(event) => event.preventDefault()}
                        disabled={isClosingTicket}
                        className="mt-3 flex w-full touch-none select-none items-center justify-center gap-2 rounded-xl border border-red-100 bg-white px-4 py-2.5 text-xs font-black text-red-500 shadow-sm transition-all hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <LogOut size={15} />
                        長押しでこの未会計伝票を閉じる
                      </button>
                    )}

                    {isPaid && Array.isArray(ticket.paidOrders) && ticket.paidOrders.length > 0 && (
                      <div className="mt-4 rounded-xl border border-green-100 bg-green-50/50 p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between border-b border-green-100 pb-2">
                          <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-green-700">
                              この会計に含まれる支払い
                            </h4>
                            {formatSourceSessionLabel(ticket) && (
                              <p className="mt-1 text-[10px] font-bold text-green-500">
                                同一伝票: {formatSourceSessionLabel(ticket)}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] font-black tabular-nums text-green-700">
                            {ticket.paidOrders.length}件
                          </span>
                        </div>

                        <div className="space-y-2">
                          {ticket.paidOrders.map((order) => (
                            <div
                              key={`${ticket.id}-paid-${order.id}`}
                              className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs shadow-sm"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-black tabular-nums text-gray-700">
                                    支払い {formatShortOrderId(order.id)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-2 pl-3">
                                <span className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-black sm:inline-flex ${formatPaymentBadgeClass(order.paymentMethod)}`}>
                                  {formatPaymentMethod(order.paymentMethod)}
                                </span>
                                <span className="text-sm font-black tabular-nums text-gray-900">
                                  ¥{Number(order.totalPrice || 0).toLocaleString()}
                                </span>
                                {hasMultiplePayments && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      printPaymentReceipt(order, ticket, settings);
                                    }}
                                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-black text-gray-500 shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
                                  >
                                    レシート再印刷
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {(ticket.sourceTransactionId || (Array.isArray(ticket.sourceTransactionIds) && ticket.sourceTransactionIds.length === 1)) && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openCancelModal(ticket);
                            }}
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white py-2.5 text-xs font-black text-red-500 shadow-sm transition-colors hover:bg-red-50"
                          >
                            <XCircle size={14} />
                            この会計を取消
                          </button>
                        )}
                      </div>
                    )}

                    {isPaid && Array.isArray(ticket.excludedOrders) && ticket.excludedOrders.length > 0 && (
                      <div className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            除外された注文
                          </h4>
                          <span className="text-[10px] font-black tabular-nums text-gray-400">
                            {ticket.excludedOrders.length}件
                          </span>
                        </div>

                        <div className="space-y-2">
                          {ticket.excludedOrders.map((order) => (
                            <div
                              key={`${ticket.id}-excluded-${order.id}`}
                              className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`rounded px-2 py-0.5 text-[10px] font-black ${formatOrderStatusClass(order)}`}>
                                    {formatOrderStatusLabel(order)}
                                  </span>
                                  <span className="font-black tabular-nums text-gray-600">
                                    注文 {formatShortOrderId(order.id)}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-[10px] font-bold text-gray-400">
                                  <span>注文 {formatTime(order.timestamp)}</span>
                                  {order.paidAt && (
                                    <>
                                      <span>/</span>
                                      <span>会計 {formatTime(order.paidAt)}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <span className="shrink-0 pl-3 text-sm font-black tabular-nums text-gray-400">
                                ¥{Number(order.totalPrice || 0).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {ticket.items && ticket.items.length > 0 && (
                      <div className="mt-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-end justify-between border-b-2 border-dashed border-gray-200 pb-2">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">注文内容</h4>
                          <span className="text-[10px] font-bold tabular-nums text-gray-400">計 {totalItemsCount + cancelledTotalCount} 点</span>
                        </div>

                        <ul className="space-y-3">
                          {ticket.items.map((item, index) => {
                            const isTakeoutItem = item.isTakeout === true;
                            const isRetailItem = isRetailExtraItem(item);
                            const itemTaxRate = item.taxRate || (
                              isTakeoutItem ? ticket.taxRates.reducedRate : ticket.taxRates.standardRate
                            );
                            // 商品行は「元の数量」(残数＋取消数)で表示。取消分は下の取消記録で差し引く。
                            const originalQty = Number(item.quantity || 1) + (cancelledByName.get(item.name) || 0);

                            return (
                              <li key={`${ticket.id}-${index}`} className="flex items-start justify-between py-1.5 text-sm">
                                <div className="pr-4">
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold leading-tight text-gray-700">{item.name}</span>
                                      {isRetailItem && (
                                        <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[9px] font-bold leading-none text-emerald-600">
                                          物販
                                        </span>
                                      )}
                                      {isTakeoutItem && (
                                        <span className="shrink-0 rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-[9px] font-bold leading-none text-orange-600">
                                          軽減税率 {itemTaxRate}%
                                        </span>
                                      )}
                                    </div>
                                    <span className="mt-1 text-[11px] font-medium tabular-nums text-gray-400">
                                      ¥{Number(item.unitPrice || 0).toLocaleString()} x {originalQty}
                                    </span>
                                    {Array.isArray(item.options) && item.options.length > 0 && (
                                      <span className="mt-1 text-[11px] text-gray-400">
                                        オプション: {item.options.join(' / ')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span className="shrink-0 font-black tabular-nums text-gray-800">
                                  ¥{(Number(item.unitPrice || 0) * originalQty).toLocaleString()}
                                </span>
                              </li>
                            );
                          })}
                        </ul>

                        {Array.isArray(ticket.cancellations) && ticket.cancellations.length > 0 && (
                          <ul className="mt-2 space-y-1.5 border-t border-dashed border-red-200 pt-3">
                            {ticket.cancellations.flatMap((cancellation, ci) =>
                              (cancellation.items || []).map((cItem, ii) => (
                                <li key={`cx-${ci}-${ii}`} className="flex items-start justify-between text-sm text-red-600">
                                  <span className="font-bold leading-tight">
                                    {cItem.name} 取消 {Number(cItem.quantity || 0)}点
                                  </span>
                                  <span className="shrink-0 font-black tabular-nums">
                                    −¥{Number(cItem.amount || 0).toLocaleString()}
                                  </span>
                                </li>
                              ))
                            )}
                          </ul>
                        )}

                        <div className="mt-6 space-y-2 border-t-2 border-dashed border-gray-200 pt-4 text-xs font-bold text-gray-500">
                          {Number(ticket.discountAmount || 0) > 0 && (
                            <div className="flex justify-between pb-1 text-red-500">
                              <div className="flex items-center gap-1">
                                <Tag size={12} />
                                <span>値引き適用</span>
                              </div>
                              <span className="tabular-nums">-¥{Number(ticket.discountAmount || 0).toLocaleString()}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>小計 (税抜)</span>
                            <span className="tabular-nums">¥{Number(ticket.subtotal || 0).toLocaleString()}</span>
                          </div>
                          {Number(ticket.taxAmountReduced || 0) > 0 && (
                            <div className="flex justify-between text-orange-600/80">
                              <span>消費税 {ticket.taxRates.reducedRate}% (軽減税率)</span>
                              <span className="tabular-nums">¥{Number(ticket.taxAmountReduced || 0).toLocaleString()}</span>
                            </div>
                          )}
                          {Number(ticket.taxAmountStandard || 0) > 0 && (
                            <div className="flex justify-between">
                              <span>消費税 {ticket.taxRates.standardRate}%</span>
                              <span className="tabular-nums">¥{Number(ticket.taxAmountStandard || 0).toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex items-end justify-between border-t-2 border-gray-800 pt-3">
                          <span className="font-black tracking-widest text-gray-800">合計 (税込)</span>
                          <span className="text-xl font-black tabular-nums text-gray-900">
                            ¥{Number(ticket.totalPrice || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {closeTicketTarget && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-[2rem] border border-red-100 bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
              <LogOut size={34} strokeWidth={2.5} />
            </div>

            <h3 className="text-xl font-black tracking-tight text-gray-900">
              未会計伝票を閉じますか？
            </h3>

            <p className="mt-3 text-sm font-bold leading-relaxed text-gray-500">
              <span className="mb-1 block text-base text-gray-800">
                {getTableDisplayName(closeTicketTarget) || 'テーブル未設定'}
              </span>
              この未会計伝票をキャンセル扱いにして、席を待機中に戻します。
              <br />
              会計済みの伝票には影響しません。
            </p>

            <div className="mt-7 flex gap-3">
              <button
                type="button"
                onClick={closeCloseTicketModal}
                disabled={isClosingTicket}
                className="flex-1 rounded-2xl bg-gray-100 py-4 text-sm font-black text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                やめる
              </button>

              <button
                type="button"
                onClick={executeCloseUnpaidTicket}
                disabled={isClosingTicket}
                className="flex-1 rounded-2xl bg-red-500 py-4 text-sm font-black text-white shadow-lg shadow-red-100 transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="flex max-h-[88vh] w-full max-w-md flex-col rounded-[2rem] border border-red-100 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
              <div className="min-w-0">
                <h3 className="text-lg font-black text-gray-900">会計の取消</h3>
                <p className="mt-1 text-xs font-bold text-gray-400">
                  取消する商品の数量を選んで確定します。在庫は自動で戻ります。
                </p>
              </div>
              <button
                type="button"
                onClick={closeCancelModal}
                disabled={isCancelling}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50"
                aria-label="閉じる"
              >
                <XCircle size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
              {(cancelTarget.items || []).map((item, index) => {
                const qty = Number(item.quantity || 0) || 1;
                const sel = Math.min(Math.max(Number(cancelQty[index] || 0), 0), qty);
                return (
                  <div key={index} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-800">{item.name || '商品'}</div>
                      <div className="text-xs font-bold text-gray-400">
                        ¥{Number(item.totalPrice || 0).toLocaleString()} / {qty}点
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCancelQty((prev) => ({ ...prev, [index]: Math.max(sel - 1, 0) }))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white font-black text-gray-600 hover:bg-gray-50"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-base font-black tabular-nums text-gray-900">{sel}</span>
                      <button
                        type="button"
                        onClick={() => setCancelQty((prev) => ({ ...prev, [index]: Math.min(sel + 1, qty) }))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white font-black text-red-500 hover:bg-red-50"
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={selectAllForCancel}
                className="mt-1 w-full rounded-xl bg-red-50 py-2 text-xs font-black text-red-600 hover:bg-red-100"
              >
                全額取消（すべて選択）
              </button>

              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="取消理由（任意）"
                rows={2}
                className="mt-2 w-full rounded-xl border border-gray-200 p-2 text-sm font-bold outline-none focus:border-red-300"
              />
            </div>

            <div className="border-t border-gray-100 p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-black text-gray-500">取消金額</span>
                <span className="font-mono text-2xl font-black text-red-600">¥{cancelRefundTotal.toLocaleString()}</span>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeCancelModal}
                  disabled={isCancelling}
                  className="flex-1 rounded-2xl bg-gray-100 py-4 text-sm font-black text-gray-500 hover:bg-gray-200 disabled:opacity-50"
                >
                  やめる
                </button>
                <button
                  type="button"
                  onClick={executeCancellation}
                  disabled={isCancelling || cancelRefundTotal <= 0}
                  className="flex-1 rounded-2xl bg-red-500 py-4 text-sm font-black text-white shadow-lg shadow-red-100 transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none"
                >
                  {isCancelling ? '取消処理中...' : '取消を確定'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
