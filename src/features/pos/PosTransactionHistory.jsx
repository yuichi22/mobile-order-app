import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildPosReceiptPrintPayload } from '../../shared/utils/posReceiptPrint';
import { openPosReceiptBrowserPrint } from '../../shared/utils/posReceiptBrowserPrint';
import { issueReceipt, printPayloadByMode, resolveReceiptMode } from '../../shared/utils/receiptPrinting';
import { getTableDisplayName } from '../../shared/utils/tableDisplay';
import {
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Filter, PauseCircle, Printer, QrCode, Receipt, Tag, XCircle, LogOut, RotateCcw
} from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query, doc, getDoc, getDocs, increment, serverTimestamp, where, writeBatch, Timestamp, arrayUnion, deleteField } from 'firebase/firestore';

import { db } from '../../shared/api/firebase/client';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { useStoreSettings } from '../store/hooks';
import { pushInventoryToShopify } from '../store/services/storeDataService';
import { getAuth } from 'firebase/auth';
import {
  CORRECTION_TYPES,
  getJstBusinessDate,
  isDayLocked,
  buildReversalItems,
  buildReversalTransaction
} from './corrections/correctionModel';

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
  const ld = item?.lineDiscount;
  const lineDiscountKey = ld && Number(ld.amount || 0) > 0
    ? `${ld.type || ''}:${ld.value || ''}:${ld.accountingCategory || ''}`
    : '';
  return [
    isRetailExtraItem(item) ? 'retail' : 'order',
    item?.productId || item?.id || item?.name || '',
    Number(item?.unitPrice || 0),
    item?.isTakeout === true ? 'takeout' : 'store',
    item?.taxRate || '',
    optionsKey,
    lineDiscountKey
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
      const errorText = error?.message || error?.errorMessage || error?.code || JSON.stringify(error) || String(error);
      console.error('[pos transaction receipt print error]', errorText, error);

      const shouldFallback = window.confirm(
        `レシートプリンターへの印刷に失敗しました。\n\n${errorText}\n\nブラウザ印刷を開きますか？`
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
  // 日計と同じ曜日表示（日〜土）＋日付ピッカー起動用ref。
  const paidDateInputRef = useRef(null);
  const paidDateWeekLabel = useMemo(() => (
    selectedPaidDate
      ? ['日', '月', '火', '水', '木', '金', '土'][new Date(`${selectedPaidDate}T00:00:00+09:00`).getDay()]
      : ''
  ), [selectedPaidDate]);
  const openPaidDatePicker = () => {
    const el = paidDateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.click();
  };

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

  // 会計後キャンセル（全額/一部）。cancelTarget={transactions:[束ねた全取引], entries:[{key,txnId,index,item}]}、
  // cancelQty={`${txnId}#${index}`:取消数量}。同一テーブルの個別会計をまとめた履歴伝票は塊ごと取消する。
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelQty, setCancelQty] = useState({});
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  // 取消モード: 'cancel'(会計取消) or 'return'(返品)。返品は在庫を戻す/戻さないを選べる。
  const [cancelMode, setCancelMode] = useState('cancel');
  const [returnRestoreStock, setReturnRestoreStock] = useState(true);
  const isReturnMode = cancelMode === 'return';

  // 支払方法の訂正。methodEditTarget={ticket, rows:[{txnId,currentMethod,amount,businessDate,isSplit}]}、
  // methodEditChoices={txnId:新method}。当日=元伝票を直接訂正 / 締め後=当日付の付替え伝票。
  const [methodEditTarget, setMethodEditTarget] = useState(null);
  const [methodEditChoices, setMethodEditChoices] = useState({});
  const [isEditingMethod, setIsEditingMethod] = useState(false);

  // 締め状態(dailyClosings/{dateKey}.status)。対象伝票の営業日がロック済み(締め後/過去日)なら
  // 取消は「その場減額」ではなく「操作日のマイナス伝票(反対仕訳)」で計上する(設計 D1/P1)。
  const [closingsByDate, setClosingsByDate] = useState({});
  useEffect(() => {
    if (!storeId) return undefined;
    const unsubscribe = onSnapshot(
      collection(db, 'stores', storeId, 'dailyClosings'),
      (snapshot) => {
        const map = {};
        snapshot.forEach((closingDoc) => { map[closingDoc.id] = { status: closingDoc.data()?.status }; });
        setClosingsByDate(map);
      }
    );
    return () => unsubscribe();
  }, [storeId]);

  const openCancelModal = (ticket, mode = 'cancel') => {
    // 同一テーブルの個別会計をまとめた履歴伝票では、束ねた全取引の明細を取消対象にする。
    // (履歴表示の ticket.items は消費統合されて元取引との対応が失われるため、
    //  取消は元取引の生 items から txnId+index 付きで組み立てる)
    const txIds = Array.isArray(ticket?.sourceTransactionIds) && ticket.sourceTransactionIds.length > 0
      ? ticket.sourceTransactionIds
      : (ticket?.sourceTransactionId ? [ticket.sourceTransactionId] : []);
    const targetTransactions = txIds
      .map((txId) => transactions.find((item) => item.id === txId))
      // 反対仕訳(マイナス伝票)自体は取消対象にしない。
      .filter((tx) => tx && !tx.isReversal && !tx.reversalOf && Array.isArray(tx.items) && tx.items.length > 0);

    if (targetTransactions.length === 0) {
      window.alert('取消対象の取引明細が見つかりません。');
      return;
    }

    // すでに反対仕訳で取消済みの数量を明細ごとに集計(再取消の二重計上を防ぐ)。
    const reversedQtyOf = (tx, index) => (Array.isArray(tx.reversalEntries) ? tx.reversalEntries : [])
      .filter((entry) => Number(entry?.itemIndex) === index)
      .reduce((sum, entry) => sum + Math.abs(Number(entry?.quantity || 0)), 0);

    const entries = [];
    const initial = {};
    targetTransactions.forEach((tx) => {
      // 割引後率(取引の純額 / 明細グロス合計)。返金額を割引後にするため各行に持たせる。
      const grossTotal = (tx.items || []).reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0) || 0;
      const netRatio = grossTotal > 0 ? (Number(tx.totalAmount) || 0) / grossTotal : 1;
      tx.items.forEach((item, index) => {
        const maxQty = (Number(item.quantity || 0) || 1) - reversedQtyOf(tx, index);
        if (maxQty <= 0) return; // 全数取消済みの明細は出さない
        const key = `${tx.id}#${index}`;
        entries.push({ key, txnId: tx.id, index, item, maxQty, netRatio });
        initial[key] = 0;
      });
    });

    if (entries.length === 0) {
      window.alert('取消できる明細がありません（すべて取消済みです）。');
      return;
    }

    setCancelMode(mode === 'return' ? 'return' : 'cancel');
    setReturnRestoreStock(true);
    setCancelTarget({ ticketId: ticket?.id || '', transactions: targetTransactions, entries });
    setCancelQty(initial);
    setCancelReason('');
  };

  const closeCancelModal = () => {
    if (isCancelling) return;
    setCancelTarget(null);
    setCancelQty({});
    setCancelReason('');
    setCancelMode('cancel');
  };

  // --- 取消の取消(戻す) ---------------------------------------------------
  // 締め後取消(反対仕訳)を戻す。未締めなら反対仕訳伝票を削除して元伝票のマーカーを解除。
  // 締め後(反対仕訳を作った営業日が締め済み)は戻せない(U1=B)。
  const [undoTarget, setUndoTarget] = useState(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const openUndoModal = (ticket) => {
    const reversalTxnId = ticket?.reversalTxnId;
    const reversalTxn = transactions.find((item) => item.id === reversalTxnId);
    if (!reversalTxn) {
      window.alert('戻す対象の取消伝票が見つかりません。');
      return;
    }
    setUndoTarget({ ticket, reversalTxn });
  };

  const closeUndoModal = () => {
    if (isUndoing) return;
    setUndoTarget(null);
  };

  const executeUndoReversal = async () => {
    if (!undoTarget || isUndoing || !storeId) return;
    const { reversalTxn } = undoTarget;
    const num = (value) => Number(value || 0);
    const today = getJstBusinessDate();

    // 反対仕訳を作った営業日が締め済みなら戻せない(過去確定を動かさないため)。
    if (isDayLocked(reversalTxn.businessDate, { closings: closingsByDate, today })) {
      window.alert('この取消は締め済みのため戻せません。');
      return;
    }

    setIsUndoing(true);
    try {
      const batch = writeBatch(db);

      // 反対仕訳伝票を削除。
      batch.delete(doc(db, 'stores', storeId, 'transactions', reversalTxn.id));

      // 元伝票は過去日で現在の transactions state に無いことがあるため、ID で直接取得して更新する。
      // (ローカルの find に頼ると原本のマーカー解除が抜け、「取消済み」が残る不具合になる)
      let originalPatch = null;
      const originalId = reversalTxn.reversalOf;
      if (originalId) {
        const originalRef = doc(db, 'stores', storeId, 'transactions', originalId);
        const originalSnap = await getDoc(originalRef);
        if (originalSnap.exists()) {
          const original = { id: originalSnap.id, ...originalSnap.data() };
          const remainingEntries = (Array.isArray(original.reversalEntries) ? original.reversalEntries : [])
            .filter((entry) => entry.reversalTransactionId !== reversalTxn.id);
          const remainingTxnIds = (Array.isArray(original.reversalTransactionIds) ? original.reversalTransactionIds : [])
            .filter((id) => id !== reversalTxn.id);
          const reversedByIndex = {};
          remainingEntries.forEach((entry) => {
            reversedByIndex[entry.itemIndex] = (reversedByIndex[entry.itemIndex] || 0) + Math.abs(num(entry.quantity));
          });
          const stillFully = remainingEntries.length > 0
            && (original.items || []).every((it, i) => (reversedByIndex[i] || 0) >= (num(it.quantity) || 1));

          const cleared = remainingEntries.length === 0;
          const dbPayload = cleared
            ? {
              reversalEntries: [],
              reversalTransactionIds: [],
              hasReversal: false,
              reversalStatus: deleteField(),
              reversedAt: deleteField(),
              updatedAt: serverTimestamp()
            }
            : {
              reversalEntries: remainingEntries,
              reversalTransactionIds: remainingTxnIds,
              hasReversal: true,
              reversalStatus: stillFully ? 'fully_reversed' : 'partially_reversed',
              updatedAt: serverTimestamp()
            };
          batch.update(originalRef, dbPayload);

          // ローカル反映用(deleteField/serverTimestamp のセンチネルは含めない)。
          originalPatch = cleared
            ? { ...original, reversalEntries: [], reversalTransactionIds: [], hasReversal: false, reversalStatus: undefined, reversedAt: undefined }
            : { ...original, reversalEntries: remainingEntries, reversalTransactionIds: remainingTxnIds, hasReversal: true, reversalStatus: stillFully ? 'fully_reversed' : 'partially_reversed' };
        }
      }

      // 在庫: 取消時に戻した retail 在庫を再度引き落とす(戻し取消=売れた状態に戻す)。
      const redeductByProduct = new Map();
      (reversalTxn.items || []).forEach((item) => {
        if (item.sourceType === 'retail') {
          const productId = String(item.productId || item.id || '').replace(/^product:/, '');
          if (productId) redeductByProduct.set(productId, (redeductByProduct.get(productId) || 0) + Math.abs(num(item.quantity)));
        }
      });
      redeductByProduct.forEach((qty, productId) => {
        batch.update(doc(db, 'stores', storeId, 'products', productId), {
          inventoryQuantity: increment(-qty),
          quantity: increment(-qty),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();

      if (redeductByProduct.size > 0) {
        const productIds = [...redeductByProduct.keys()];
        void (async () => {
          try {
            const idToken = await getAuth().currentUser?.getIdToken?.();
            if (idToken) await pushInventoryToShopify({ storeId, productIds, idToken });
          } catch (shopifyError) {
            console.error('Shopify在庫反映エラー(取消戻し):', shopifyError);
          }
        })();
      }

      // ローカル反映: 反対仕訳を除去し、元伝票を patch。
      setTransactions((prev) => prev
        .filter((item) => item.id !== reversalTxn.id)
        .map((item) => (originalPatch && item.id === originalPatch.id ? originalPatch : item)));
      setUndoTarget(null);
    } catch (error) {
      console.error('[pos undo reversal error]', error);
      window.alert(`取消の戻しに失敗しました${error?.message ? `: ${error.message}` : ''}`);
    } finally {
      setIsUndoing(false);
    }
  };

  // --- 支払方法の訂正 -----------------------------------------------------
  const openMethodEditModal = (ticket) => {
    const txIds = Array.isArray(ticket?.sourceTransactionIds) && ticket.sourceTransactionIds.length > 0
      ? ticket.sourceTransactionIds
      : (ticket?.sourceTransactionId ? [ticket.sourceTransactionId] : []);
    const rows = txIds
      .map((txId) => transactions.find((item) => item.id === txId))
      .filter((tx) => tx && !tx.isReversal && !tx.reversalOf && !tx.isMethodAdjustment)
      .map((tx) => ({
        txnId: tx.id,
        currentMethod: getPaymentMethodKey(tx.paymentMethodGroup || tx.paymentMethod),
        amount: Number(tx.totalAmount || 0),
        businessDate: tx.businessDate || '',
        isSplit: Array.isArray(tx.payments) && tx.payments.length > 1
      }));
    if (rows.length === 0) {
      window.alert('支払方法を修正できる会計が見つかりません。');
      return;
    }
    const initial = {};
    rows.forEach((row) => { initial[row.txnId] = row.currentMethod; });
    setMethodEditTarget({ ticket, rows });
    setMethodEditChoices(initial);
  };

  const closeMethodEditModal = () => {
    if (isEditingMethod) return;
    setMethodEditTarget(null);
    setMethodEditChoices({});
  };

  const executeMethodEdit = async () => {
    if (!methodEditTarget || isEditingMethod || !storeId) return;
    const today = getJstBusinessDate();
    const opRegister = registers.find((register) => register.id === ownRegisterId) || null;
    const changed = methodEditTarget.rows.filter(
      (row) => !row.isSplit && methodEditChoices[row.txnId] && methodEditChoices[row.txnId] !== row.currentMethod
    );
    if (changed.length === 0) {
      window.alert('変更する支払方法を選んでください。');
      return;
    }

    setIsEditingMethod(true);
    try {
      const batch = writeBatch(db);
      const localPatches = new Map();
      const newAdjustmentTxns = [];
      const methodLabel = (m) => (m === 'cash' ? '現金' : m === 'card' ? 'カード' : m === 'qr' ? 'QR決済' : m);

      changed.forEach((row) => {
        const transaction = transactions.find((item) => item.id === row.txnId);
        if (!transaction) return;
        const newMethod = methodEditChoices[row.txnId];
        const locked = isDayLocked(row.businessDate, { closings: closingsByDate, today });

        const adjustmentLog = {
          from: row.currentMethod,
          to: newMethod,
          amount: Math.abs(Number(row.amount || 0)),
          businessDate: today,
          sameDay: !locked
        };

        if (!locked) {
          // 当日・未締め: 元伝票の支払方法を直接訂正(その日の入金内訳が正しくなる)。
          const nextAdjustments = [...(Array.isArray(transaction.methodAdjustments) ? transaction.methodAdjustments : []), adjustmentLog];
          batch.update(doc(db, 'stores', storeId, 'transactions', transaction.id), {
            paymentMethod: newMethod,
            paymentMethodGroup: newMethod,
            methodAdjustments: nextAdjustments,
            methodCorrectedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          localPatches.set(transaction.id, {
            ...transaction,
            paymentMethod: newMethod,
            paymentMethodGroup: newMethod,
            methodAdjustments: nextAdjustments
          });
          return;
        }

        // 締め後: 過去日は動かさず、当日付の付替え伝票(売上ゼロ・方法振替)を起こす。
        const amount = Math.abs(Number(row.amount || 0));
        const adjRef = doc(collection(db, 'stores', storeId, 'transactions'));
        const adjPayload = {
          sessionId: transaction.sessionId || '',
          tableId: transaction.tableId || '',
          tableName: transaction.tableName || transaction.tableDisplayName || '',
          registerId: ownRegisterId || transaction.registerId || '',
          registerName: opRegister?.name || opRegister?.registerName || transaction.registerName || '',
          departmentId: transaction.departmentId || '',
          departmentName: transaction.departmentName || '',
          registerMode: transaction.registerMode || 'order',
          salesChannel: transaction.salesChannel || '',
          isMethodAdjustment: true,
          adjustmentOf: transaction.id,
          originalBusinessDate: transaction.businessDate || '',
          methodFrom: row.currentMethod,
          methodTo: newMethod,
          items: [],
          totalAmount: 0,
          subTotal: 0,
          taxAmount: 0,
          taxAmountReduced: 0,
          taxAmountStandard: 0,
          discountAmount: 0,
          promoExpenseAmount: 0,
          voucherAmount: 0,
          settlementAdjustmentTotal: 0,
          paymentMethod: 'mixed',
          paymentMethodGroup: 'mixed',
          payments: [
            { method: row.currentMethod, amount: -amount },
            { method: newMethod, amount }
          ],
          isSplitPayment: true,
          customerIds: [],
          guestCount: 0,
          isPaid: true,
          status: 'method_adjustment',
          paymentStatus: 'method_adjustment',
          businessDate: today,
          reversalReason: `支払方法訂正: ${methodLabel(row.currentMethod)}→${methodLabel(newMethod)}`,
          timestamp: serverTimestamp(),
          paidAt: serverTimestamp(),
          createdAt: serverTimestamp()
        };
        batch.set(adjRef, adjPayload);
        newAdjustmentTxns.push({ ...adjPayload, id: adjRef.id, timestamp: new Date(), paidAt: new Date() });

        // 元伝票(過去日)は金額不変、監査マーカーだけ付ける(履歴に「付替え済み」を出すため)。
        const nextAdjustments = [...(Array.isArray(transaction.methodAdjustments) ? transaction.methodAdjustments : []), { ...adjustmentLog, adjustmentTxnId: adjRef.id }];
        batch.update(doc(db, 'stores', storeId, 'transactions', transaction.id), {
          methodAdjustments: nextAdjustments,
          updatedAt: serverTimestamp()
        });
        localPatches.set(transaction.id, { ...transaction, methodAdjustments: nextAdjustments });
      });

      await batch.commit();

      setTransactions((prev) => [
        ...prev.map((item) => (localPatches.has(item.id) ? localPatches.get(item.id) : item)),
        ...newAdjustmentTxns
      ]);
      setMethodEditTarget(null);
      setMethodEditChoices({});
    } catch (error) {
      console.error('[pos method edit error]', error);
      window.alert(`支払方法の訂正に失敗しました${error?.message ? `: ${error.message}` : ''}`);
    } finally {
      setIsEditingMethod(false);
    }
  };

  const executeCancellation = async () => {
    if (!cancelTarget || isCancelling || !storeId) return;
    const targetTransactions = Array.isArray(cancelTarget.transactions) ? cancelTarget.transactions : [];
    if (targetTransactions.length === 0) return;
    const num = (value) => Number(value || 0);

    // 取消 or 返品。返品は「在庫を戻す/戻さない」を選べる(取消は常に戻す)。
    const correctionType = isReturnMode ? CORRECTION_TYPES.RETURN : CORRECTION_TYPES.CANCEL;
    const shouldRestoreStock = !isReturnMode || returnRestoreStock;

    // 束ねた各取引ごとに「取消後の明細」と取消記録を算出する。取消数量は
    // cancelQty[`${txnId}#${index}`] で取引×明細単位に持つ。
    const today = getJstBusinessDate();
    const opRegister = registers.find((register) => register.id === ownRegisterId) || null;
    const operator = {
      registerId: ownRegisterId || '',
      registerName: opRegister?.name || opRegister?.registerName || ''
    };
    const perTransaction = [];
    const restoreByProduct = new Map();
    let anyCancel = false;

    targetTransactions.forEach((transaction) => {
      const items = Array.isArray(transaction.items) ? transaction.items : [];
      const cancelledEntries = [];
      const reversalSourceEntries = []; // {item, quantity} 反対仕訳の元(締め後用)
      let txnHasCancel = false;

      // すでに反対仕訳で取消済みの数量(明細index別)。再取消の二重計上を防ぐキャップ。
      const reversedQtyOf = (index) => (Array.isArray(transaction.reversalEntries) ? transaction.reversalEntries : [])
        .filter((entry) => Number(entry?.itemIndex) === index)
        .reduce((sum, entry) => sum + Math.abs(Number(entry?.quantity || 0)), 0);

      // 割引反映用の純額率: 明細は割引前グロス(item.totalPrice)を持つが、実際の決済額は
      // transaction.totalAmount(割引後・税込)。取消/返品金額はこの純額率で割引後にする。
      const grossTotal = items.reduce((sum, it) => sum + num(it.totalPrice), 0) || 0;
      const txnNet = num(transaction.totalAmount);
      const netRatio = grossTotal > 0 ? txnNet / grossTotal : 1;

      const updatedItems = items.map((item, index) => {
        const key = `${transaction.id}#${index}`;
        const qty = num(item.quantity) || 1;
        const available = qty - reversedQtyOf(index); // 取消可能な残数
        const cQty = Math.min(Math.max(num(cancelQty[key]), 0), Math.max(available, 0));
        if (cQty <= 0) return item;
        txnHasCancel = true;
        anyCancel = true;
        reversalSourceEntries.push({ item, index, quantity: cQty });
        const remainingQty = qty - cQty;
        const ratio = qty > 0 ? remainingQty / qty : 0;
        const scale = (value) => Math.round(num(value) * ratio);
        const grossPortion = num(item.totalPrice) - scale(item.totalPrice); // 取消ぶんの割引前グロス
        cancelledEntries.push({
          name: item.name || '商品',
          // 在庫戻し先は実商品docのID。明細の id は `product:<docId>`(UI用キー)なので
          // productId を優先し、保険で `product:` プレフィックスを剥がす(既存取引も救済)。
          productId: String(item.productId || item.id || '').replace(/^product:/, ''),
          sourceType: item.sourceType || '',
          index,
          quantity: cQty,
          grossAmount: grossPortion,
          amount: Math.round(grossPortion * netRatio) // 割引後の返金額
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

      if (!txnHasCancel) return; // この取引は取消なし → 更新しない

      // 返金額・残額を「取引の純額(割引後)」を基準に按分する(割引を正しく反映)。
      const cancelledTotal = cancelledEntries.reduce((sum, entry) => sum + num(entry.amount), 0); // 割引後の返金額
      const grossCancelled = cancelledEntries.reduce((sum, entry) => sum + num(entry.grossAmount), 0);
      const ratioCancelled = grossTotal > 0 ? grossCancelled / grossTotal : 1;
      const remainingRatio = Math.max(0, 1 - ratioCancelled);
      const refundSubTotal = Math.round(num(transaction.subTotal) * ratioCancelled);
      const refundTaxStandard = Math.round(num(transaction.taxAmountStandard) * ratioCancelled);
      const refundTaxReduced = Math.round(num(transaction.taxAmountReduced) * ratioCancelled);

      // 在庫戻し(retailのみ)。返品で「戻さない」を選んだ時は在庫を戻さない。
      if (shouldRestoreStock) {
        cancelledEntries.forEach((entry) => {
          if (entry.sourceType === 'retail' && entry.productId) {
            restoreByProduct.set(entry.productId, (restoreByProduct.get(entry.productId) || 0) + entry.quantity);
          }
        });
      }

      // 対象伝票の営業日がロック済み(締め後/過去日)か。ロック時は元伝票を触らず反対仕訳。
      const locked = isDayLocked(transaction.businessDate, { closings: closingsByDate, today });

      perTransaction.push({
        transaction,
        locked,
        updatedItems,
        cancelledEntries,
        reversalSourceEntries,
        netRatio,
        cancelledTotal, // 割引後の返金額
        refundSubTotal,
        refundTaxStandard,
        refundTaxReduced,
        // 一部取消(その場減額)後に残す取引の各額(純額ベースで按分)。
        remaining: {
          totalAmount: txnNet - cancelledTotal,
          subTotal: num(transaction.subTotal) - refundSubTotal,
          taxAmountStandard: num(transaction.taxAmountStandard) - refundTaxStandard,
          taxAmountReduced: num(transaction.taxAmountReduced) - refundTaxReduced,
          discountAmount: Math.round(num(transaction.discountAmount) * remainingRatio),
          promoExpenseAmount: Math.round(num(transaction.promoExpenseAmount) * remainingRatio),
          voucherAmount: Math.round(num(transaction.voucherAmount) * remainingRatio)
        },
        fullyCancelled: updatedItems.length === 0
      });
    });

    if (!anyCancel) {
      window.alert('取消する数量を選択してください。');
      return;
    }

    setIsCancelling(true);
    try {
      const batch = writeBatch(db);

      // 在庫を戻す（retail商品のみ／全取引分をまとめて）。在庫は会計日と切り離し操作日に戻す。
      restoreByProduct.forEach((qty, productId) => {
        batch.update(doc(db, 'stores', storeId, 'products', productId), {
          inventoryQuantity: increment(qty),
          quantity: increment(qty),
          updatedAt: serverTimestamp()
        });
      });

      // 取引ごとに更新内容を作成しバッチに積む＋ローカル反映用パッチを用意。
      const localPatches = new Map();
      const newReversalTxns = [];
      perTransaction.forEach(({
        transaction, locked, updatedItems, cancelledEntries, reversalSourceEntries,
        netRatio, cancelledTotal, refundSubTotal, refundTaxStandard, refundTaxReduced, remaining, fullyCancelled
      }) => {
        if (locked) {
          // 締め後/過去日: 元伝票は数値を触らず、操作日付のマイナス伝票(反対仕訳)を新規作成する。
          // 明細は割引後(netRatio)にスケールし、合計は取引の純額按分を使う(割引を正しく反映)。
          const reversalItems = buildReversalItems(reversalSourceEntries, netRatio);
          const totals = {
            totalAmount: cancelledTotal,
            subTotal: refundSubTotal,
            taxAmountReduced: refundTaxReduced,
            taxAmountStandard: refundTaxStandard,
            taxAmount: refundTaxReduced + refundTaxStandard
          };
          const reversalPayload = buildReversalTransaction({
            original: transaction,
            reversalItems,
            totals,
            correctionType,
            reason: cancelReason.trim(),
            operator,
            businessDate: today
          });
          const reversalRef = doc(collection(db, 'stores', storeId, 'transactions'));
          batch.set(reversalRef, {
            ...reversalPayload,
            timestamp: serverTimestamp(),
            paidAt: serverTimestamp(),
            createdAt: serverTimestamp()
          });

          // 元伝票は数値・isPaid不変(過去日の売上/締めを動かさない)。取消記録は
          // `cancellations`(その場減額用)とは別の `reversalEntries` に明細index付きで残す。
          // これにより履歴表示が二重計上せず、再取消の残数キャップにも使える。
          const newReversalEntries = cancelledEntries.map((entry) => ({
            name: entry.name,
            itemIndex: entry.index,
            quantity: entry.quantity,
            amount: entry.amount,
            reversalTransactionId: reversalRef.id,
            businessDate: today,
            reason: cancelReason.trim()
          }));
          const nextReversalEntries = [
            ...(Array.isArray(transaction.reversalEntries) ? transaction.reversalEntries : []),
            ...newReversalEntries
          ];
          // 全明細が全数取消済みになったか(履歴の「取消済み」判定用)。
          const reversedTotalByIndex = {};
          nextReversalEntries.forEach((entry) => {
            reversedTotalByIndex[entry.itemIndex] = (reversedTotalByIndex[entry.itemIndex] || 0) + Math.abs(num(entry.quantity));
          });
          const fullyReversed = (transaction.items || [])
            .every((it, i) => (reversedTotalByIndex[i] || 0) >= (num(it.quantity) || 1));

          batch.update(doc(db, 'stores', storeId, 'transactions', transaction.id), {
            reversedAt: serverTimestamp(),
            hasReversal: true,
            reversalStatus: fullyReversed ? 'fully_reversed' : 'partially_reversed',
            reversalTransactionIds: arrayUnion(reversalRef.id),
            reversalEntries: nextReversalEntries,
            updatedAt: serverTimestamp()
          });

          localPatches.set(transaction.id, {
            ...transaction,
            reversedAt: new Date(),
            hasReversal: true,
            reversalStatus: fullyReversed ? 'fully_reversed' : 'partially_reversed',
            reversalTransactionIds: [...(transaction.reversalTransactionIds || []), reversalRef.id],
            reversalEntries: nextReversalEntries
          });
          newReversalTxns.push({ ...reversalPayload, id: reversalRef.id, timestamp: new Date(), paidAt: new Date() });
          return;
        }

        // 当日・未締め: 従来どおり元伝票をその場で減額する。
        const cancellationLog = {
          cancelledAt: new Date().toISOString(),
          reason: cancelReason.trim(),
          amount: cancelledTotal,
          type: fullyCancelled ? 'full' : 'partial',
          correctionType,
          items: cancelledEntries
        };
        const nextCancellations = [
          ...(Array.isArray(transaction.cancellations) ? transaction.cancellations : []),
          cancellationLog
        ];
        // 残額は取引の純額(割引後)ベースで按分した値を使う(割引を保つ)。
        const remainingFields = {
          totalAmount: remaining.totalAmount,
          subTotal: remaining.subTotal,
          taxAmountStandard: remaining.taxAmountStandard,
          taxAmountReduced: remaining.taxAmountReduced,
          taxAmount: remaining.taxAmountStandard + remaining.taxAmountReduced,
          discountAmount: remaining.discountAmount,
          promoExpenseAmount: remaining.promoExpenseAmount,
          voucherAmount: remaining.voucherAmount
        };
        const updatePayload = {
          items: updatedItems,
          ...remainingFields,
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
        localPatches.set(transaction.id, {
          ...transaction,
          items: updatedItems,
          ...remainingFields,
          cancellations: nextCancellations,
          hasCancellations: true,
          ...(fullyCancelled
            ? { status: 'cancelled', paymentStatus: 'cancelled', isPaid: false, voidedAt: new Date() }
            : {})
        });
      });

      await batch.commit();
      // 永続化の確証用(検証中): コミット成功なら反対仕訳ID・更新元IDをコンソールに出す。
      console.info('[cancel] committed', {
        reversalTxnIds: newReversalTxns.map((txn) => txn.id),
        patchedTxnIds: [...localPatches.keys()],
        storeId
      });

      // 取消で在庫を戻したretail商品を Shopify へ反映する(在庫連携ON=prodのみ。関数側でゲート)。
      // 戻し後のFirestore在庫を絶対値pushするので、Shopify側も戻って増える。
      if (restoreByProduct.size > 0) {
        const restoredProductIds = [...restoreByProduct.keys()];
        void (async () => {
          try {
            const idToken = await getAuth().currentUser?.getIdToken?.();
            if (idToken) {
              await pushInventoryToShopify({ storeId, productIds: restoredProductIds, idToken });
            }
          } catch (shopifyError) {
            console.error('Shopify在庫反映エラー(取消):', shopifyError);
          }
        })();
      }

      // ローカル(getDocs取得)を即時反映。締め後の反対仕訳は新規伝票として追加する。
      setTransactions((prev) => [
        ...prev.map((item) => (localPatches.has(item.id) ? localPatches.get(item.id) : item)),
        ...newReversalTxns
      ]);
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
    const entries = Array.isArray(cancelTarget.entries) ? cancelTarget.entries : [];
    return entries.reduce((sum, { key, item, maxQty, netRatio }) => {
      const qty = Number(item.quantity || 0) || 1;
      const cap = Number(maxQty ?? qty);
      const c = Math.min(Math.max(Number(cancelQty[key] || 0), 0), cap);
      if (c <= 0) return sum;
      const remaining = qty - c;
      const total = Number(item.totalPrice || 0);
      const grossPortion = total - Math.round((total * remaining) / qty);
      return sum + Math.round(grossPortion * (Number(netRatio ?? 1))); // 割引後の返金額
    }, 0);
  })();

  const selectAllForCancel = () => {
    if (!cancelTarget) return;
    const all = {};
    (cancelTarget.entries || []).forEach(({ key, item, maxQty }) => {
      all[key] = Number(maxQty ?? (item.quantity || 0)) || 1;
    });
    setCancelQty(all);
  };

  // 対象伝票が締め後/過去日か。UI で「本日のマイナス伝票として計上」の注意表示に使う。
  const cancelTargetLocked = (() => {
    if (!cancelTarget) return false;
    const today = getJstBusinessDate();
    return (cancelTarget.transactions || []).some(
      (transaction) => isDayLocked(transaction.businessDate, { closings: closingsByDate, today })
    );
  })();

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
      // 反対仕訳(締め後取消)や支払方法の付替え伝票は「会計済み」履歴には出さない。
      .filter((transaction) => !transaction.isReversal && !transaction.reversalOf && !transaction.isMethodAdjustment)
      .filter((transaction) => {
        // 表示中の登録レジの取引のみ（自レジ or 選択した他レジ）。
        if (ownRegisterId && !transactionMatchesViewingRegister(transaction)) return false;

        const transactionDate =
          toDateInputValue(transaction.paidAt) ||
          toDateInputValue(transaction.timestamp);

        if (selectedPaidDate && transactionDate !== selectedPaidDate) return false;

        // 分割会計は内訳のいずれかが絞り込み手段に一致すれば表示する。
        const paymentMethodKeys = Array.isArray(transaction.payments) && transaction.payments.length > 0
          ? transaction.payments.map((payment) => getPaymentMethodKey(payment.method))
          : [getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod)];
        if (paidPaymentFilter !== 'all' && !paymentMethodKeys.includes(paidPaymentFilter)) return false;

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
          promoExpenseAmount: Number(transaction.promoExpenseAmount || 0),
          voucherAmount: Number(transaction.voucherAmount || 0),
          // 再印刷レシートでも使用レジ名・割引内訳を出すため、取引の元データを引き継ぐ。
          registerName: transaction.registerName || '',
          registerMode: transaction.registerMode || '',
          appliedDiscounts: Array.isArray(transaction.appliedDiscounts) && transaction.appliedDiscounts.length > 0
            ? transaction.appliedDiscounts
            : (transaction.appliedDiscount ? [transaction.appliedDiscount] : []),
          promoExpenseItems: Array.isArray(transaction.promoExpenseItems) ? transaction.promoExpenseItems : [],
          vouchers: Array.isArray(transaction.vouchers) ? transaction.vouchers : [],
          discountLabelName: String(transaction.appliedDiscount?.name || transaction.discountName || '').trim(),
          promoLabelName: (Array.isArray(transaction.promoExpenseItems)
            ? transaction.promoExpenseItems.map((entry) => entry?.name).filter(Boolean).join('、')
            : '').trim(),
          voucherLabelName: (Array.isArray(transaction.vouchers)
            ? transaction.vouchers.map((entry) => entry?.name).filter(Boolean).join('、')
            : '').trim(),
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
          // 現金＋カード/QR の分割会計は、表示用に内訳を持たせる(1取引=1レシートのまま)。
          splitPayments: Array.isArray(transaction.payments) && transaction.payments.length > 1
            ? transaction.payments.map((payment) => {
                const method = getPaymentMethodKey(payment.method);
                return {
                  method,
                  label: formatPaymentMethod(method),
                  total: Number(payment.amount || 0)
                };
              })
            : null,
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
          // 締め後の反対仕訳(取消・返品)の明細記録。履歴伝票に「取消済み」表示するために持つ。
          reversalEntries: Array.isArray(transaction.reversalEntries) ? transaction.reversalEntries : [],
          hasReversal: transaction.hasReversal === true,
          reversalStatus: transaction.reversalStatus || '',
          // 支払方法の訂正履歴(監査用)。履歴伝票に「現金→カード」を出す。
          methodAdjustments: Array.isArray(transaction.methodAdjustments) ? transaction.methodAdjustments : [],
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

  // 会計後キャンセルをキャンセルタブ用のチケットに変換。
  // (a) 当日・未締めの「その場減額」取消 + (b) 締め後の反対仕訳(マイナス伝票)。
  const cancelledTransactionTickets = useMemo(() => {
    const matchesViewingRegister = (transaction) => {
      if (!ownRegisterId) return true;
      const rid = String(transaction.registerId || '');
      if (!rid) return viewingRegisterId === ownRegisterId;
      return rid === viewingRegisterId;
    };

    // (a) その場減額(当日・未締め)。反対仕訳は(b)で扱う。
    const inPlace = transactions
      .filter((transaction) => !transaction.isReversal && Array.isArray(transaction.cancellations) && transaction.cancellations.length > 0)
      .filter(matchesViewingRegister)
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
          correctionKind: 'in_place',
          correctionType: cancellation.correctionType || 'cancel',
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

    // (b) 締め後取消 = 反対仕訳(マイナス伝票)。操作日の「取消」として表示し、戻せる。
    const reversals = transactions
      .filter((transaction) => transaction.isReversal && Array.isArray(transaction.items) && transaction.items.length > 0)
      .filter(matchesViewingRegister)
      .map((transaction) => {
        const when = toDateValue(transaction.paidAt) || toDateValue(transaction.timestamp) || null;
        return {
          id: `reversal-${transaction.id}`,
          status: 'cancelled',
          correctionKind: 'reversal',
          correctionType: transaction.correctionType || 'cancel',
          reversalTxnId: transaction.id,
          reversalOf: transaction.reversalOf || '',
          businessDate: transaction.businessDate || '',
          originalBusinessDate: transaction.originalBusinessDate || '',
          sourceTransactionId: transaction.reversalOf || '',
          tableId: transaction.tableId || 'takeout',
          tableDisplayName: transaction.tableName || transaction.tableDisplayName || (String(transaction.tableId || '').toLowerCase() === 'takeout' ? 'テイクアウト' : ''),
          tableName: transaction.tableName || transaction.tableDisplayName || (String(transaction.tableId || '').toLowerCase() === 'takeout' ? 'テイクアウト' : ''),
          totalPrice: Math.abs(Number(transaction.totalAmount || 0)),
          totalAmount: Math.abs(Number(transaction.totalAmount || 0)),
          timestamp: when,
          paidAt: when,
          cancelledAt: when,
          items: (transaction.items || []).map((it) => ({
            name: it.name || '商品',
            quantity: Math.abs(Number(it.quantity || 0)),
            totalPrice: Math.abs(Number(it.totalPrice || 0)),
            unitPrice: Number(it.unitPrice || 0)
          })),
          cancelType: 'reversal',
          cancelReason: transaction.reversalReason || '',
          paymentMethod: transaction.paymentMethod || '',
          paidOrders: [],
          paymentBreakdown: [],
          excludedOrders: [],
          taxRates: {}
        };
      });

    return [...inPlace, ...reversals];
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
          // 束ねる各取引ぶんを下で集約するので初期化(重複防止)。
          cancellations: [],
          reversalEntries: [],
          methodAdjustments: [],
          hasReversal: false,
          totalPrice: 0,
          subtotal: 0,
          taxAmountReduced: 0,
          taxAmountStandard: 0,
          discountAmount: 0,
          promoExpenseAmount: 0,
          voucherAmount: 0,
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

      // 取消記録は束ねた全取引ぶんを集約する({...ticket}スプレッドだと先頭取引ぶんしか
      // 残らず、別取引で取消した商品(例:別会計のデミカツ)が履歴に出ない不具合になる)。
      groupedTicket.cancellations = [
        ...(Array.isArray(groupedTicket.cancellations) ? groupedTicket.cancellations : []),
        ...(Array.isArray(ticket.cancellations) ? ticket.cancellations : [])
      ];
      groupedTicket.reversalEntries = [
        ...(Array.isArray(groupedTicket.reversalEntries) ? groupedTicket.reversalEntries : []),
        ...(Array.isArray(ticket.reversalEntries) ? ticket.reversalEntries : [])
      ];
      groupedTicket.methodAdjustments = [
        ...(Array.isArray(groupedTicket.methodAdjustments) ? groupedTicket.methodAdjustments : []),
        ...(Array.isArray(ticket.methodAdjustments) ? ticket.methodAdjustments : [])
      ];
      groupedTicket.hasReversal = groupedTicket.hasReversal || ticket.hasReversal === true;

      groupedTicket.totalPrice += ticketAmount;
      groupedTicket.subtotal += Number(ticket.subtotal || ticket.subTotal || ticketAmount || 0) || 0;
      groupedTicket.taxAmountReduced += Number(ticket.taxAmountReduced || 0);
      groupedTicket.taxAmountStandard += Number(ticket.taxAmountStandard || 0);
      groupedTicket.discountAmount += Number(ticket.discountAmount || 0);
      groupedTicket.promoExpenseAmount += Number(ticket.promoExpenseAmount || 0);
      groupedTicket.voucherAmount += Number(ticket.voucherAmount || 0);
      // 割引/クーポン名は最初に出たものを採用(同一伝票内の代表名)。
      if (!groupedTicket.discountLabelName && ticket.discountLabelName) groupedTicket.discountLabelName = ticket.discountLabelName;
      if (!groupedTicket.promoLabelName && ticket.promoLabelName) groupedTicket.promoLabelName = ticket.promoLabelName;
      if (!groupedTicket.voucherLabelName && ticket.voucherLabelName) groupedTicket.voucherLabelName = ticket.voucherLabelName;

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

      // 売上履歴の支払サマリは、リスト(伝票)と同じく「表示中レジ」のみを対象にする。
      // (これが無いと他レジ・他部門の売上まで合算され、締め/日計とズレる)
      if (!transactionMatchesViewingRegister(transaction)) return;

      const transactionDate =
        toDateInputValue(transaction.paidAt) ||
        toDateInputValue(transaction.timestamp);

      if (selectedPaidDate && transactionDate !== selectedPaidDate) return;

      // 分割会計(現金＋カード/QR)は payments[] の内訳を手段ごとに加算する。
      // 締め/日計(dailyClosingHelpers)と同じ集計にして、履歴と締めの支払方法別をズラさない。
      // 単一手段・旧データ(payments無し)は従来通り会計総額を1手段に加算する。
      //   totalAmount が 0 の取引(全額売掛・0円会計など)は実際の決済額が0なので 0 とする。
      //   `||` だと 0 を欠損扱いして totalPrice/raw を拾い、締め/日計(totalAmount基準)と乖離する。
      //   旧データで totalAmount 自体が無い場合のみ totalPrice/amount にフォールバックする。
      const paymentEntries = Array.isArray(transaction.payments) && transaction.payments.length > 0
        ? transaction.payments.map((payment) => ({
            method: getPaymentMethodKey(payment.method),
            amount: Number(payment.amount || 0)
          }))
        : [{
            method: getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod),
            amount: Number(transaction.totalAmount ?? transaction.totalPrice ?? transaction.amount ?? 0)
          }];

      paymentEntries.forEach(({ method, amount }) => {
        if (paidPaymentFilter !== 'all' && method !== paidPaymentFilter) return;
        if (!base[method]) return;
        base[method].count += 1;
        base[method].total += amount;
      });
    });

    return [base.cash, base.card, base.qr];
  }, [paidPaymentFilter, selectedPaidDate, transactions, viewingRegisterId, ownRegisterId]);

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
      <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-3 border-b bg-gray-50 px-4 py-3 font-black text-gray-700">
        <div className="flex min-w-0 items-center gap-2">
          <Receipt size={18} className="shrink-0 text-gray-500" />
          <span className="shrink-0">{filter === 'hold' ? '保留伝票' : '履歴'}</span>
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-bold tabular-nums text-gray-500">
            {filter === 'hold' ? posHolds.length : displayTickets.length}件
          </span>
        </div>

        {(filter === 'paid' || filter === 'cancelled') && (
          <div className="flex min-h-[40px] shrink-0 items-center gap-2">
            {/* 日付ステッパー（chevron・オーバル日付＋曜日）。日計と統一。 */}
            <button
              type="button"
              onClick={() => shiftSelectedPaidDate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-100 transition-colors hover:bg-blue-50 hover:text-blue-700"
              aria-label="前日"
            >
              <ChevronLeft size={18} strokeWidth={3} />
            </button>

            <button
              type="button"
              onClick={openPaidDatePicker}
              className="min-w-[150px] rounded-full bg-white px-4 py-2.5 text-center text-xs font-black text-gray-800 shadow-sm ring-1 ring-gray-100 transition-colors hover:bg-blue-50 hover:text-blue-700"
            >
              {selectedPaidDate ? `${selectedPaidDate}（${paidDateWeekLabel}）` : '日付を選択'}
            </button>

            <button
              type="button"
              onClick={() => shiftSelectedPaidDate(1)}
              disabled={isSelectedPaidDateToday}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-100 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400 disabled:opacity-40"
              aria-label="翌日"
            >
              <ChevronRight size={18} strokeWidth={3} />
            </button>

            {/* 今日（右端）。当日表示中はオレンジで強調。 */}
            <button
              type="button"
              onClick={() => setSelectedPaidDate(todayDateValue)}
              className={`h-10 rounded-full px-4 text-xs font-black shadow-sm ring-1 transition-colors ${
                isSelectedPaidDateToday
                  ? 'bg-orange-500 text-white ring-orange-500'
                  : 'bg-white text-gray-600 ring-gray-100 hover:bg-orange-100 hover:text-orange-700'
              }`}
            >
              今日
            </button>

            <input
              ref={paidDateInputRef}
              type="date"
              value={selectedPaidDate || ''}
              max={todayDateValue}
              onChange={(event) => setSelectedPaidDate(event.target.value)}
              className="sr-only"
            />
          </div>
        )}
        {filter === 'unpaid' && (
          <div
            aria-hidden="true"
            className="pointer-events-none invisible flex min-h-[40px] shrink-0 items-center gap-2"
          >
            <span className="h-10 w-10 rounded-full" />
            <span className="h-10 w-[150px] rounded-full" />
            <span className="h-10 w-10 rounded-full" />
            <span className="h-10 w-[64px] rounded-full" />
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
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-300">
            <PauseCircle size={56} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-black">
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
                  : '該当する履歴がありません'}
            </p>
          </div>
        )}

        {filter !== 'hold' && !loading && displayTickets.map((ticket, index) => {
          const isExpanded = expandedTicketId === ticket.id;
          const isPaid = ticket.status === 'paid';
          const isCancelled = ticket.status === 'cancelled';
          // 締め後取消(反対仕訳)か / 取消済みの原本(会計済みだが反対仕訳で取消された)か。
          const isReversalCancel = ticket.correctionKind === 'reversal';
          const isReversedOriginal = isPaid && ticket.hasReversal === true;
          // 日付ラベル(YYYY-MM-DD → M/D)。取消済み原本=取消された日、締め後取消=元売上の日。
          const monthDay = (dateKey) => {
            const parts = String(dateKey || '').split('-');
            return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : '';
          };
          const reversedOnLabel = monthDay(
            Array.isArray(ticket.reversalEntries) && ticket.reversalEntries[0]?.businessDate
          );
          const reversalOriginLabel = monthDay(ticket.originalBusinessDate);
          const correctionWord = ticket.correctionType === 'return' ? '返品' : '取消';
          const methodAdjustments = Array.isArray(ticket.methodAdjustments) ? ticket.methodAdjustments : [];
          const methodLabelOf = (m) => (m === 'cash' ? '現金' : m === 'card' ? 'カード' : m === 'qr' ? 'QR' : m || '—');
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
              } ${isReversedOriginal ? 'border-l-4 border-l-red-400' : isReversalCancel ? 'border-l-4 border-l-amber-400' : ''}`}
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
                          ? isReversalCancel
                            ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                            : 'bg-red-50 text-red-600'
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
                      {isCancelled
                        ? (isReversalCancel
                          ? `締め後${correctionWord}${reversalOriginLabel ? `（${reversalOriginLabel}分）` : ''}`
                          : correctionWord)
                        : isPaid ? '会計済み' : '未会計'}
                    </span>
                    {isReversedOriginal && (
                      <span className="rounded px-2 py-0.5 text-[10px] font-black tracking-wider bg-red-50 text-red-600 ring-1 ring-red-100">
                        {reversedOnLabel ? `${reversedOnLabel} ` : ''}取消済み
                      </span>
                    )}
                    {isPaid && methodAdjustments.length > 0 && (
                      <span className="rounded px-2 py-0.5 text-[10px] font-black tracking-wider bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                        支払方法訂正
                      </span>
                    )}
                    {isPaid && ticket.hasCancelledLinkedOrder && (
                      <span className="rounded px-2 py-0.5 text-[10px] font-black tracking-wider bg-red-50 text-red-600 ring-1 ring-red-100">
                        注文キャンセルあり
                      </span>
                    )}
                    {(Number(ticket.discountAmount || 0) > 0
                      || Number(ticket.promoExpenseAmount || 0) > 0
                      || Number(ticket.voucherAmount || 0) > 0) && (
                      <span className="inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-[10px] font-black tracking-wider bg-rose-50 text-rose-600 ring-1 ring-rose-100">
                        <Tag size={10} />
                        割引・クーポン
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
                    {viewedRegisterMode !== 'pos' && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-gray-300" />
                        <span>{formatGuestCount(ticket)}</span>
                      </>
                    )}
                    <span className="h-1 w-1 rounded-full bg-gray-300" />
                    <span>{totalItemsCount}点</span>
                    {Array.isArray(ticket.splitPayments) && ticket.splitPayments.length > 1 && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-gray-300" />
                        <span className="font-black text-gray-600">
                          {ticket.splitPayments.map((entry) => `${entry.label} ¥${Number(entry.total || 0).toLocaleString()}`).join(' / ')}
                        </span>
                      </>
                    )}
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

                    {isCancelled && isReversalCancel && (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); openUndoModal(ticket); }}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-white py-2.5 text-xs font-black text-amber-600 shadow-sm transition-colors hover:bg-amber-50"
                      >
                        <XCircle size={14} />
                        この{correctionWord}を戻す
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
                            {Array.isArray(ticket.splitPayments) && ticket.splitPayments.length > 1
                              ? `${ticket.splitPayments.length}種別`
                              : `${ticket.paidOrders.length}件`}
                          </span>
                        </div>

                        {Array.isArray(ticket.splitPayments) && ticket.splitPayments.length > 1 ? (
                          <div className="space-y-2">
                            {ticket.splitPayments.map((entry, index) => (
                              <div
                                key={`${ticket.id}-split-${entry.method}-${index}`}
                                className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs shadow-sm"
                              >
                                <span className="font-black text-gray-700">
                                  {entry.label}での支払い
                                </span>
                                <div className="flex shrink-0 items-center gap-2 pl-3">
                                  <span className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-black sm:inline-flex ${formatPaymentBadgeClass(entry.method)}`}>
                                    {entry.label}
                                  </span>
                                  <span className="text-sm font-black tabular-nums text-gray-900">
                                    ¥{Number(entry.total || 0).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
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
                        )}

                        {(ticket.sourceTransactionId || (Array.isArray(ticket.sourceTransactionIds) && ticket.sourceTransactionIds.length > 0)) && (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openCancelModal(ticket, 'cancel');
                              }}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white py-2.5 text-xs font-black text-red-500 shadow-sm transition-colors hover:bg-red-50"
                            >
                              <XCircle size={14} />
                              この会計を取消
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openCancelModal(ticket, 'return');
                              }}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-teal-200 bg-white py-2.5 text-xs font-black text-teal-600 shadow-sm transition-colors hover:bg-teal-50"
                            >
                              <RotateCcw size={14} />
                              返品
                            </button>
                          </div>
                        )}

                        {(ticket.sourceTransactionId || (Array.isArray(ticket.sourceTransactionIds) && ticket.sourceTransactionIds.length > 0)) && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openMethodEditModal(ticket);
                            }}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2.5 text-xs font-black text-gray-500 shadow-sm transition-colors hover:bg-gray-50"
                          >
                            <CreditCard size={14} />
                            支払方法を修正
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
                                    {item.lineDiscount && Number(item.lineDiscount.amount || 0) > 0 && (
                                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-red-500">
                                        <Tag size={10} />
                                        <span>
                                          {item.lineDiscount.accountingCategory === 'promo_expense' ? '販促費' : '売上値引'}
                                          {item.lineDiscount.type === 'percent' && Number(item.lineDiscount.value) > 0
                                            ? `（${Number(item.lineDiscount.value)}%）`
                                            : ''}
                                        </span>
                                        <span className="tabular-nums">-¥{Number(item.lineDiscount.amount || 0).toLocaleString()}</span>
                                      </span>
                                    )}
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

                        {Array.isArray(ticket.reversalEntries) && ticket.reversalEntries.length > 0 && (
                          <div className="mt-2 rounded-xl border border-dashed border-red-300 bg-red-50/40 p-3">
                            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-red-500">
                              <XCircle size={12} />
                              取消・返品（本日のマイナス伝票で計上）
                            </div>
                            <ul className="space-y-1">
                              {ticket.reversalEntries.map((entry, ri) => (
                                <li key={`rev-${ri}`} className="flex items-start justify-between text-sm text-red-600">
                                  <span className="font-bold leading-tight">
                                    {entry.name || '商品'} 取消 {Math.abs(Number(entry.quantity || 0))}点
                                  </span>
                                  <span className="shrink-0 font-black tabular-nums">
                                    −¥{Math.abs(Number(entry.amount || 0)).toLocaleString()}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {methodAdjustments.length > 0 && (
                          <div className="mt-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3">
                            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-500">
                              <CreditCard size={12} />
                              支払方法の訂正
                            </div>
                            <ul className="space-y-1">
                              {methodAdjustments.map((adj, ai) => (
                                <li key={`madj-${ai}`} className="flex items-center justify-between text-sm text-indigo-700">
                                  <span className="font-bold leading-tight">
                                    {methodLabelOf(adj.from)} → {methodLabelOf(adj.to)}
                                    {adj.sameDay ? '' : `（${monthDay(adj.businessDate)} 付替え）`}
                                  </span>
                                  <span className="shrink-0 font-black tabular-nums">¥{Number(adj.amount || 0).toLocaleString()}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="mt-6 space-y-2 border-t-2 border-dashed border-gray-200 pt-4 text-xs font-bold text-gray-500">
                          {(() => {
                            // 商品ごとのline割引は各商品の下に表示するため、合計表示からは差し引く。
                            // (全体手入力値引きは廃止済みのため、line割引分を引くと通常はゼロ＝非表示)
                            const sumLine = (cat) => (ticket.items || []).reduce((sum, it) => {
                              const ld = it.lineDiscount;
                              if (!ld || Number(ld.amount || 0) <= 0) return sum;
                              const c = ld.accountingCategory === 'promo_expense' ? 'promo_expense'
                                : ld.accountingCategory === 'voucher_payment' ? 'voucher_payment' : 'sales_discount';
                              return c === cat ? sum + Number(ld.amount || 0) : sum;
                            }, 0);
                            const overallSales = Math.max(0, Number(ticket.discountAmount || 0) - sumLine('sales_discount'));
                            const overallPromo = Math.max(0, Number(ticket.promoExpenseAmount || 0) - sumLine('promo_expense'));
                            return (
                              <>
                                {overallSales > 0 && (
                                  <div className="flex justify-between pb-1 text-red-500">
                                    <div className="flex items-center gap-1">
                                      <Tag size={12} />
                                      <span>{ticket.discountLabelName ? `売上値引（${ticket.discountLabelName}）` : '売上値引'}</span>
                                    </div>
                                    <span className="tabular-nums">-¥{overallSales.toLocaleString()}</span>
                                  </div>
                                )}
                                {overallPromo > 0 && (
                                  <div className="flex justify-between pb-1 text-emerald-600">
                                    <div className="flex items-center gap-1">
                                      <Tag size={12} />
                                      <span>{ticket.promoLabelName ? `販促費（${ticket.promoLabelName}）` : '販促費'}</span>
                                    </div>
                                    <span className="tabular-nums">-¥{overallPromo.toLocaleString()}</span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {Number(ticket.voucherAmount || 0) > 0 && (
                            <div className="flex justify-between pb-1 text-sky-600">
                              <div className="flex items-center gap-1">
                                <Tag size={12} />
                                <span>{ticket.voucherLabelName ? `金券/売掛（${ticket.voucherLabelName}）` : '金券/売掛'}</span>
                              </div>
                              <span className="tabular-nums">-¥{Number(ticket.voucherAmount || 0).toLocaleString()}</span>
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
                <h3 className="text-lg font-black text-gray-900">{isReturnMode ? '返品' : '会計の取消'}</h3>
                <p className="mt-1 text-xs font-bold text-gray-400">
                  {isReturnMode
                    ? '返品する商品の数量を選んで確定します。'
                    : '取消する商品の数量を選んで確定します。在庫は自動で戻ります。'}
                </p>
                {cancelTargetLocked && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-black leading-snug text-amber-700">
                    この伝票は締め済み（過去日）です。元の会計は変更せず、
                    <span className="whitespace-nowrap">本日の「取消・返品」</span>としてマイナス伝票で計上します。
                  </p>
                )}
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
              {(cancelTarget.entries || []).map(({ key, item, maxQty }) => {
                const qty = Number(maxQty ?? (item.quantity || 0)) || 1;
                const sel = Math.min(Math.max(Number(cancelQty[key] || 0), 0), qty);
                return (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-800">{item.name || '商品'}</div>
                      <div className="text-xs font-bold text-gray-400">
                        ¥{Number(item.totalPrice || 0).toLocaleString()} / {qty}点
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCancelQty((prev) => ({ ...prev, [key]: Math.max(sel - 1, 0) }))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white font-black text-gray-600 hover:bg-gray-50"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-base font-black tabular-nums text-gray-900">{sel}</span>
                      <button
                        type="button"
                        onClick={() => setCancelQty((prev) => ({ ...prev, [key]: Math.min(sel + 1, qty) }))}
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
                className={`mt-1 w-full rounded-xl py-2 text-xs font-black ${
                  isReturnMode ? 'bg-teal-50 text-teal-600 hover:bg-teal-100' : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                {isReturnMode ? '全部返品（すべて選択）' : '全額取消（すべて選択）'}
              </button>

              {isReturnMode && (
                <button
                  type="button"
                  onClick={() => setReturnRestoreStock((prev) => !prev)}
                  className="mt-2 flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-black text-gray-700"
                >
                  <span>在庫を戻す（物販のみ）</span>
                  <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${returnRestoreStock ? 'bg-teal-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${returnRestoreStock ? 'translate-x-5' : 'translate-x-1'}`} />
                  </span>
                </button>
              )}

              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder={isReturnMode ? '返品理由（任意）' : '取消理由（任意）'}
                rows={2}
                className="mt-2 w-full rounded-xl border border-gray-200 p-2 text-sm font-bold outline-none focus:border-red-300"
              />
            </div>

            <div className="border-t border-gray-100 p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-black text-gray-500">{isReturnMode ? '返金額' : '取消金額'}</span>
                <span className={`font-mono text-2xl font-black ${isReturnMode ? 'text-teal-600' : 'text-red-600'}`}>¥{cancelRefundTotal.toLocaleString()}</span>
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
                  className={`flex-1 rounded-2xl py-4 text-sm font-black text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none ${
                    isReturnMode ? 'bg-teal-500 shadow-teal-100 hover:bg-teal-600' : 'bg-red-500 shadow-red-100 hover:bg-red-600'
                  }`}
                >
                  {isCancelling
                    ? (isReturnMode ? '返品処理中...' : '取消処理中...')
                    : (isReturnMode ? '返品を確定' : '取消を確定')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {undoTarget && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-[2rem] border border-amber-100 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-gray-900">取消を戻す</h3>
            <p className="mt-1 text-xs font-bold text-gray-400">
              この締め後取消（本日のマイナス伝票）を取り消して、元の会計を戻します。
            </p>
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-1 text-sm font-black text-gray-800">
                {getTableDisplayName(undoTarget.ticket) || 'テイクアウト'} / ¥{Number(undoTarget.ticket?.totalAmount || 0).toLocaleString()}
              </div>
              <ul className="space-y-0.5">
                {(undoTarget.ticket?.items || []).map((item, i) => (
                  <li key={`undo-${i}`} className="flex justify-between text-xs font-bold text-gray-500">
                    <span>{item.name} × {Number(item.quantity || 0)}</span>
                    <span className="tabular-nums">¥{Number(item.totalPrice || 0).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] font-bold text-amber-600">
                戻すと在庫は再度引き落とされます（売れた状態に戻ります）。
              </p>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={closeUndoModal}
                disabled={isUndoing}
                className="flex-1 rounded-2xl bg-gray-100 py-4 text-sm font-black text-gray-500 hover:bg-gray-200 disabled:opacity-50"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={executeUndoReversal}
                disabled={isUndoing}
                className="flex-1 rounded-2xl bg-amber-500 py-4 text-sm font-black text-white shadow-lg shadow-amber-100 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {isUndoing ? '戻し処理中...' : '取消を戻す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {methodEditTarget && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-6 backdrop-blur-md">
          <div className="flex max-h-[88vh] w-full max-w-md flex-col rounded-[2rem] border border-gray-100 bg-white shadow-2xl">
            <div className="border-b border-gray-100 p-5">
              <h3 className="text-lg font-black text-gray-900">支払方法を修正</h3>
              <p className="mt-1 text-xs font-bold text-gray-400">
                打ち間違えた支払方法を正しい方法に変更します。締め済みの会計は、本日の付替え伝票で振り替えます（過去の売上は変わりません）。
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {methodEditTarget.rows.map((row) => {
                const locked = isDayLocked(row.businessDate, { closings: closingsByDate, today: getJstBusinessDate() });
                const methods = [
                  { key: 'cash', label: '現金' },
                  { key: 'card', label: 'カード' },
                  { key: 'qr', label: 'QR' }
                ];
                return (
                  <div key={row.txnId} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-black text-gray-500">
                        支払い {formatShortOrderId(row.txnId)} / ¥{Number(row.amount || 0).toLocaleString()}
                      </span>
                      {locked && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">締め後→付替え</span>
                      )}
                    </div>
                    {row.isSplit ? (
                      <div className="text-xs font-bold text-gray-400">分割会計のため個別修正は非対応です。</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {methods.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setMethodEditChoices((prev) => ({ ...prev, [row.txnId]: m.key }))}
                            className={`rounded-lg py-2 text-sm font-black transition-colors ${
                              methodEditChoices[row.txnId] === m.key
                                ? 'bg-gray-800 text-white'
                                : 'bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-100 p-5">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeMethodEditModal}
                  disabled={isEditingMethod}
                  className="flex-1 rounded-2xl bg-gray-100 py-4 text-sm font-black text-gray-500 hover:bg-gray-200 disabled:opacity-50"
                >
                  やめる
                </button>
                <button
                  type="button"
                  onClick={executeMethodEdit}
                  disabled={isEditingMethod}
                  className="flex-1 rounded-2xl bg-gray-800 py-4 text-sm font-black text-white shadow-lg transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {isEditingMethod ? '修正中...' : '支払方法を修正'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
