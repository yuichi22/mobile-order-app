import React, { useEffect, useMemo, useRef, useState } from 'react';
import { printReceiptViaBridge } from '../../shared/api/printBridge';
import { buildPosReceiptPrintPayload } from '../../shared/utils/posReceiptPrint';
import { getTableDisplayName } from '../../shared/utils/tableDisplay';
import {
  CheckCircle2, ChevronDown, CreditCard, Filter, Printer, QrCode, Receipt, Tag, XCircle, LogOut
} from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query, doc, getDocs, serverTimestamp, where, writeBatch, Timestamp } from 'firebase/firestore';

import { db } from '../../shared/api/firebase/client';
import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import { useStoreSettings } from '../store/hooks';

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

const formatTransactionDateTime = (ticket = {}) => {
  const date =
    toDateValue(ticket.cancelledAt) ||
    toDateValue(ticket.canceledAt) ||
    toDateValue(ticket.cancelAt) ||
    toDateValue(ticket.voidedAt) ||
    toDateValue(ticket.refundedAt) ||
    toDateValue(ticket.paidAt) ||
    toDateValue(ticket.completedAt) ||
    toDateValue(ticket.createdAt) ||
    toDateValue(ticket.updatedAt);

  if (!date) return '';

  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
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
      const payload = buildPosReceiptPrintPayload(ticket, settings);
      await printReceiptViaBridge(payload, settings);
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

    const receiptWindow = window.open('', '_blank', 'width=420,height=760');
    if (!receiptWindow) return;

    // ここから下は今のHTML印刷処理をそのまま残す

  const issuedAt = new Date();
  const rows = buildReceiptRows(ticket.items || []);

  receiptWindow.document.write(`
    <!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>レシート再印刷</title>
        <style>
          body {
            margin: 0;
            padding: 24px;
            background: #f3f4f6;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          }
          .paper {
            width: 58mm;
            margin: 0 auto;
            background: #fff;
            color: #111827;
            padding: 0 0 8px;
          }
          .section {
            margin: 0 8px;
            padding: 10px 0;
            border-bottom: 1px dashed #111827;
          }
          .title {
            text-align: center;
          }
          .title h1 {
            margin: 0 0 6px;
            font-size: 18px;
          }
          .title p {
            margin: 2px 0;
            font-size: 10px;
          }
          .row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
            margin: 2px 0;
            font-size: 10px;
          }
          .item-row {
            margin: 6px 0;
          }
          .item-info {
            flex: 1;
          }
          .item-name {
            font-weight: 700;
          }
          .item-sub {
            margin-top: 2px;
            color: #6b7280;
            font-size: 9px;
          }
          .item-price {
            white-space: nowrap;
            font-weight: 700;
          }
          .total {
            font-size: 14px;
            font-weight: 700;
          }
          .footer {
            margin-top: 10px;
            text-align: center;
            font-size: 9px;
          }
        </style>
      </head>
      <body>
        <div class="paper">
          <div class="section title">
            <h1>${settings?.name || 'Akuto Order System'}</h1>
            ${settings?.address ? `<p>${settings.address}</p>` : ''}
            ${settings?.tel ? `<p>TEL: ${settings.tel}</p>` : ''}
            ${settings?.invoiceNumber ? `<p>登録番号: ${settings.invoiceNumber}</p>` : ''}
          </div>
          <div class="section">
            <div class="row"><span>発行日時</span><span>${issuedAt.toLocaleString('ja-JP')}</span></div>
            <div class="row"><span>テーブル</span><span>${getTableDisplayName(ticket) || 'テイクアウト'}</span></div>
            <div class="row"><span>支払い方法</span><span>${formatPaymentMethod(ticket.paymentMethod)}</span></div>
          </div>
          <div class="section">${rows}</div>
          <div class="section">
            <div class="row"><span>小計</span><span>¥${Number(ticket.subtotal || 0).toLocaleString()}</span></div>
            ${Number(ticket.discountAmount || 0) > 0 ? `<div class="row"><span>値引き</span><span>-¥${Number(ticket.discountAmount).toLocaleString()}</span></div>` : ''}
            ${Number(ticket.taxAmountReduced || 0) > 0 ? `<div class="row"><span>消費税 ${ticket.taxRates?.reducedRate ?? settings?.taxRateReduced ?? 8}% (軽減税率)</span><span>¥${Number(ticket.taxAmountReduced).toLocaleString()}</span></div>` : ''}
            ${Number(ticket.taxAmountStandard || 0) > 0 ? `<div class="row"><span>消費税 ${ticket.taxRates?.standardRate ?? settings?.taxRate ?? 10}%</span><span>¥${Number(ticket.taxAmountStandard).toLocaleString()}</span></div>` : ''}
          </div>
          <div class="section">
            <div class="row total"><span>合計</span><span>¥${Number(ticket.totalPrice || 0).toLocaleString()}</span></div>
          </div>
          <div class="footer">
            <p>ご利用ありがとうございました。</p>
            <p>またのご来店をお待ちしております。</p>
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
          };
        </script>
      </body>
    </html>
  `);
  receiptWindow.document.close();
};

export const PosTransactionHistory = ({ storeId }) => {
  const [orders, setOrders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [selectedPaidDate, setSelectedPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const selectedPaidDateRange = useMemo(() => buildDateRangeFromInput(selectedPaidDate), [selectedPaidDate]);
  const [paidPaymentFilter, setPaidPaymentFilter] = useState('all');
  const todayDateValue = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [closeTicketTarget, setCloseTicketTarget] = useState(null);
  const [isClosingTicket, setIsClosingTicket] = useState(false);
  const closeTicketTimerRef = useRef(null);
  const [filter, setFilter] = useState('unpaid');
  const { settings } = useStoreSettings(storeId);

  useEffect(() => {
    if (!storeId) return undefined;

    setLoading(true);

    const ordersCollection = collection(db, 'stores', storeId, 'orders');

    if (!selectedPaidDateRange) {
      const ordersQuery = query(
        ordersCollection,
        orderBy('timestamp', 'desc'),
        limit(300)
      );

      return onSnapshot(ordersQuery, (snapshot) => {
        setOrders(snapshot.docs.map((orderDoc) => ({
          id: orderDoc.id,
          ...orderDoc.data(),
          timestamp: orderDoc.data().timestamp?.toDate ? orderDoc.data().timestamp.toDate() : new Date(),
          paidAt: orderDoc.data().paidAt?.toDate ? orderDoc.data().paidAt.toDate() : null
        })));
        setLoading(false);
      });
    }

    let isActive = true;

    const loadOrdersForSelectedDate = async () => {
      try {
        const paidAtQuery = query(
          ordersCollection,
          where('paidAt', '>=', selectedPaidDateRange.startTimestamp),
          where('paidAt', '<', selectedPaidDateRange.endTimestamp),
          orderBy('paidAt', 'desc'),
          limit(1000)
        );

        const timestampQuery = query(
          ordersCollection,
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

        setOrders(mergedDocs.map((orderDoc) => ({
          id: orderDoc.id,
          ...orderDoc.data(),
          timestamp: orderDoc.data().timestamp?.toDate ? orderDoc.data().timestamp.toDate() : new Date(),
          paidAt: orderDoc.data().paidAt?.toDate ? orderDoc.data().paidAt.toDate() : null
        })));
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
    const grouped = new Map();

    orders.forEach((order) => {
      const isPaidActiveOrder =
        order?.paymentStatus === 'paid' &&
        order?.status !== 'cancelled' &&
        order?.paymentStatus !== 'cancelled';

      const matchesPaidDate = !selectedPaidDate || (
        toDateInputValue(order.paidAt) === selectedPaidDate ||
        toDateInputValue(order.paidAt || order.timestamp) === selectedPaidDate
      );

      if (!isPaidActiveOrder || !matchesPaidDate) return;

      const sessionKey = order.sessionId || `single-${order.id}`;

      if (!grouped.has(sessionKey)) {
        grouped.set(sessionKey, {
          id: `paid-session-${sessionKey}`,
          sourceSessionId: sessionKey,
          sessionId: order.sessionId || '',
          tableId: order.tableId,
          tableDisplayName: order.tableDisplayName || order.tableName || '',
          tableName: order.tableName || order.tableDisplayName || '',
          timestamp: order.timestamp,
          paidAt: order.paidAt,
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
          paymentMethod: '',
          paymentBreakdown: [],
          orderIds: [],
          sourceTransactionIds: [],
          items: [],
          paidOrders: [],
          excludedOrders: []
        });
      }

      const ticket = grouped.get(sessionKey);

      if (order.timestamp && (!ticket.timestamp || order.timestamp < ticket.timestamp)) {
        ticket.timestamp = order.timestamp;
      }

      if (order.paidAt && (!ticket.paidAt || order.paidAt > ticket.paidAt)) {
        ticket.paidAt = order.paidAt;
      }

      const orderTotal = Number(order.totalPrice || 0);
      const paymentMethod = paymentMethodByOrderId.get(order.id) || getPaymentMethodKey(order.paymentMethod);
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

      if (isPaidActiveOrder) {
        if (paidPaymentFilter !== 'all' && paymentMethod !== paidPaymentFilter) return;

        ticket.orderIds.push(order.id);
        ticket.paidOrders.push({
          id: order.id,
          totalPrice: orderTotal,
          paymentMethod,
          timestamp: order.timestamp,
          paidAt: order.paidAt,
          items: Array.isArray(order.items) ? order.items : []
        });

        ticket.totalPrice += orderTotal;
        ticket.subtotal += Number(order.subtotal || orderTotal || 0);
        ticket.taxAmountReduced += Number(order.taxAmountReduced || 0);
        ticket.taxAmountStandard += Number(order.taxAmountStandard || 0);
        ticket.discountAmount += Number(order.discountAmount || 0);

        if (Array.isArray(order.items)) {
          ticket.items = [...ticket.items, ...order.items];
        }

        const existingBreakdown = ticket.paymentBreakdown.find((entry) => entry.method === paymentMethod);
        if (existingBreakdown) {
          existingBreakdown.count += 1;
          existingBreakdown.total += orderTotal;
        } else {
          ticket.paymentBreakdown.push({
            method: paymentMethod,
            label: formatPaymentMethod(paymentMethod),
            count: 1,
            total: orderTotal
          });
        }

        ticket.paymentMethod = ticket.paymentBreakdown.length === 1
          ? ticket.paymentBreakdown[0].method
          : 'mixed';

        return;
      }

      ticket.excludedOrders.push({
        id: order.id,
        totalPrice: orderTotal,
        status: order.status,
        paymentStatus: order.paymentStatus,
        timestamp: order.timestamp,
        paidAt: order.paidAt
      });
    });

    transactions.forEach((transaction) => {
      if (!transaction || transaction?.isPaid === false) return;

      const sessionKey = transaction.sessionId || transaction.sourceSessionId || '';
      if (!sessionKey || !grouped.has(sessionKey)) return;

      const retailExtraItems = Array.isArray(transaction.items)
        ? transaction.items.filter((item) => isRetailExtraItem(item))
        : [];

      if (retailExtraItems.length === 0) return;

      const ticket = grouped.get(sessionKey);
      const paymentMethod = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);
      const transactionAmount = Number(transaction.totalAmount || transaction.totalPrice || 0);

      ticket.sourceTransactionIds = Array.isArray(ticket.sourceTransactionIds)
        ? [...new Set([...ticket.sourceTransactionIds, transaction.id].filter(Boolean))]
        : [transaction.id].filter(Boolean);

      ticket.items = [...ticket.items, ...retailExtraItems];

      if (transaction.paidAt && (!ticket.paidAt || transaction.paidAt > ticket.paidAt)) {
        ticket.paidAt = transaction.paidAt;
      }

      const existingPaidOrder = ticket.paidOrders.find((entry) => entry.id === transaction.id);
      if (!existingPaidOrder) {
        ticket.paidOrders.push({
          id: transaction.id,
          totalPrice: transactionAmount,
          paymentMethod,
          timestamp: transaction.timestamp,
          paidAt: transaction.paidAt || transaction.timestamp,
          items: retailExtraItems,
          isTransaction: true
        });
      }
    });

    const orderBackedTickets = Array.from(grouped.values())
      .filter((ticket) => ticket.paidOrders.length > 0)
      .map((ticket) => {
        const items = consolidateTicketItems(ticket.items);

        return {
          ...ticket,
          items,
          taxRates: resolveTicketTaxRates(items, settings)
        };
      });

    const standaloneTakeoutTickets = transactions
      .filter((transaction) => {
        const isTakeoutTransaction =
          transaction?.isTakeout === true ||
          transaction?.orderType === 'takeout' ||
          transaction?.serviceType === 'takeout';

        if (!isTakeoutTransaction || transaction?.isPaid === false) return false;

        const hasLinkedOrder = Array.isArray(transaction.customerSummaries) &&
          transaction.customerSummaries.some((summary) => (
            Array.isArray(summary?.orderIds) && summary.orderIds.length > 0
          ));

        if (hasLinkedOrder) return false;

        const matchesPaidDate = !selectedPaidDate || (
          toDateInputValue(transaction.paidAt) === selectedPaidDate ||
          toDateInputValue(transaction.paidAt || transaction.timestamp) === selectedPaidDate
        );

        if (!matchesPaidDate) return false;

        const paymentMethod = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);
        if (paidPaymentFilter !== 'all' && paymentMethod !== paidPaymentFilter) return false;

        return true;
      })
      .map((transaction) => {
        const items = consolidateTicketItems(
          Array.isArray(transaction.items) ? transaction.items : []
        );
        const paymentMethod = getPaymentMethodKey(transaction.paymentMethodGroup || transaction.paymentMethod);

        return {
          id: `paid-transaction-${transaction.id}`,
          sourceTransactionId: transaction.id,
          sourceSessionId: transaction.sessionId || '',
          sessionId: transaction.sessionId || '',
          tableId: transaction.tableId || 'takeout',
          tableDisplayName: transaction.tableDisplayName || transaction.tableName || 'テイクアウト',
          tableName: transaction.tableName || transaction.tableDisplayName || 'テイクアウト',
          timestamp: transaction.timestamp,
          paidAt: transaction.paidAt || transaction.timestamp,
          status: 'paid',
          totalPrice: Number(transaction.totalAmount || transaction.totalPrice || 0),
          subtotal: Number(transaction.subTotal || transaction.subtotal || 0),
          taxAmountReduced: Number(transaction.taxAmountReduced || 0),
          taxAmountStandard: Number(transaction.taxAmountStandard || 0),
          discountAmount: Number(transaction.discountAmount || 0),
          guestCount: Number(transaction.guestCount || 0),
          paymentMethod,
          paymentBreakdown: [{
            method: paymentMethod,
            label: formatPaymentMethod(paymentMethod),
            count: 1,
            total: Number(transaction.totalAmount || transaction.totalPrice || 0)
          }],
          orderIds: [],
          items,
          paidOrders: [{
            id: transaction.id,
            totalPrice: Number(transaction.totalAmount || transaction.totalPrice || 0),
            paymentMethod,
            timestamp: transaction.timestamp,
            paidAt: transaction.paidAt || transaction.timestamp,
            items
          }],
          excludedOrders: [],
          isTakeout: true,
          taxRates: resolveTicketTaxRates(items, settings)
        };
      });

    return [...orderBackedTickets, ...standaloneTakeoutTickets]
      .sort((left, right) => {
        const leftTime = left.paidAt?.getTime?.() || left.timestamp?.getTime?.() || 0;
        const rightTime = right.paidAt?.getTime?.() || right.timestamp?.getTime?.() || 0;
        return rightTime - leftTime;
      });
  }, [orders, paidPaymentFilter, paymentMethodByOrderId, selectedPaidDate, settings, transactions]);

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
    const targetDate = ticket?.paidAt || ticket?.timestamp || null;
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
      return groupedTickets.filter((ticket) => ticket.status === 'unpaid');
    }

    if (filter === 'cancelled') {
      return groupedTickets.filter((ticket) => ticket.status === 'cancelled');
    }

    return groupedTickets;
  }, [filter, groupedTickets, paidSessionTickets]);

  const paidPaymentSummary = useMemo(() => {
    const base = {
      cash: { method: 'cash', label: '現金', count: 0, total: 0 },
      card: { method: 'card', label: 'カード', count: 0, total: 0 },
      qr: { method: 'qr', label: 'QR決済', count: 0, total: 0 }
    };

    orders.forEach((order) => {
      const isPaidActiveOrder =
        order?.paymentStatus === 'paid' &&
        order?.status !== 'cancelled' &&
        order?.paymentStatus !== 'cancelled';

      if (!isPaidActiveOrder) return;
      if (selectedPaidDate && (
        toDateInputValue(order.paidAt) !== selectedPaidDate &&
        toDateInputValue(order.paidAt || order.timestamp) !== selectedPaidDate
      )) return;

      const method = paymentMethodByOrderId.get(order.id) || getPaymentMethodKey(order.paymentMethod);
      if (paidPaymentFilter !== 'all' && method !== paidPaymentFilter) return;
      if (!base[method]) return;

      base[method].count += 1;
      base[method].total += Number(order.totalPrice || 0);
    });

    return [base.cash, base.card, base.qr];
  }, [orders, paidPaymentFilter, paymentMethodByOrderId, selectedPaidDate]);

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

  const formatTicketPaidTime = (ticket, isPaid, isCancelled) => {
    if (isCancelled) {
      const cancelledTime = formatTransactionDateTime(ticket);
      return cancelledTime ? `キャンセル ${cancelledTime}` : 'キャンセル';
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-gray-50 p-4 font-black text-gray-700">
        <div className="flex min-w-0 items-center gap-2">
          <Receipt size={18} className="shrink-0 text-gray-500" />
          <span className="shrink-0">会計履歴</span>
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-bold tabular-nums text-gray-500">
            {filteredTickets.length}件
          </span>
        </div>

        {filter === 'paid' && (
          <div className="flex shrink-0 items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setSelectedPaidDate(todayDateValue)}
              className={`h-8 rounded-xl px-3 text-xs font-black transition-colors ${
                selectedPaidDate === todayDateValue
                  ? 'bg-green-500 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-green-50 hover:text-green-700'
              }`}
            >
              今日
            </button>

            <button
              type="button"
              onClick={() => setSelectedPaidDate('')}
              className={`h-8 rounded-xl px-3 text-xs font-black transition-colors ${
                !selectedPaidDate
                  ? 'bg-green-500 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-green-50 hover:text-green-700'
              }`}
            >
              すべて
            </button>

            <input
              type="date"
              value={selectedPaidDate || ''}
              onChange={(event) => setSelectedPaidDate(event.target.value)}
              className="h-8 rounded-xl border border-gray-200 bg-gray-50 px-2 text-xs font-black text-gray-700 outline-none focus:border-green-400"
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-1 border-b border-gray-100 bg-white p-2">
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
          キャンセル
        </button>
      </div>

      {filter === 'paid' && (
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
        {loading && (
          <div className="py-10 text-center">
              <LoadingSpinner size={32} className="inline" />
          </div>
        )}

        {!loading && filteredTickets.length === 0 && (
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
                : '該当する会計履歴がありません'}
            </p>
          </div>
        )}

        {!loading && filteredTickets.map((ticket, index) => {
          const isExpanded = expandedTicketId === ticket.id;
          const isPaid = ticket.status === 'paid';
          const isCancelled = ticket.status === 'cancelled';
          const totalItemsCount = ticket.items?.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 0;
          const ticketCardDomId = `pos-ticket-card-${String(ticket.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          const previousTicket = filteredTickets[index - 1] || null;
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
                      {isCancelled ? 'キャンセル' : isPaid ? '会計済み' : '未会計'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold tabular-nums text-gray-400">
                    <span>注文 {formatTime(ticket.timestamp)}</span>
                    <span className="h-1 w-1 rounded-full bg-gray-300" />
                    <span>会計 {formatTicketPaidTime(ticket, isPaid, isCancelled)}</span>
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
                        printReceipt(ticket, settings);
                      }}
                      className="hidden h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-black text-gray-600 shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 sm:flex"
                    >
                      <Printer size={13} />
                      レシート再印刷
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
                                  <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-black ${formatPaymentBadgeClass(order.paymentMethod)}`}>
                                    {formatPaymentMethod(order.paymentMethod)}
                                  </span>
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
                              </div>
                            </div>
                          ))}
                        </div>
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
                          <span className="text-[10px] font-bold tabular-nums text-gray-400">計 {totalItemsCount} 点</span>
                        </div>

                        <ul className="space-y-3">
                          {ticket.items.map((item, index) => {
                            const isTakeoutItem = item.isTakeout === true;
                            const isRetailItem = isRetailExtraItem(item);
                            const itemTaxRate = item.taxRate || (
                              isTakeoutItem ? ticket.taxRates.reducedRate : ticket.taxRates.standardRate
                            );

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
                                      ¥{Number(item.unitPrice || 0).toLocaleString()} x {Number(item.quantity || 1)}
                                    </span>
                                    {Array.isArray(item.options) && item.options.length > 0 && (
                                      <span className="mt-1 text-[11px] text-gray-400">
                                        オプション: {item.options.join(' / ')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span className="shrink-0 font-black tabular-nums text-gray-800">
                                  ¥{(Number(item.unitPrice || 0) * Number(item.quantity || 1)).toLocaleString()}
                                </span>
                              </li>
                            );
                          })}
                        </ul>

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

    </div>
  );
};
