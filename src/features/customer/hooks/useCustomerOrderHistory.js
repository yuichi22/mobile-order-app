import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';
import { isOrderOwnedByCustomer } from '../../../shared/utils/orderCustomerIdentity';

export const useCustomerOrderHistory = ({ sessionId, storeId, participantId }) => {
  const [orderHistory, setOrderHistory] = useState([]);
  const hasSessionContext = Boolean(sessionId && storeId && participantId);
  const [historyLoading, setHistoryLoading] = useState(() => hasSessionContext);

  useEffect(() => {
    if (!hasSessionContext) return undefined;
    const ordersQuery = query(
      collection(db, 'stores', storeId, 'orders'),
      where('sessionId', '==', sessionId)
    );

    return onSnapshot(
      ordersQuery,
      (snapshot) => {
        const fetchedOrders = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
          timestamp: snapshotDoc.data().timestamp?.toDate
            ? snapshotDoc.data().timestamp.toDate()
            : new Date()
        })).sort((left, right) => right.timestamp - left.timestamp);

        setOrderHistory(fetchedOrders);
        setHistoryLoading(false);
      },
      () => {
        setOrderHistory([]);
        setHistoryLoading(false);
      }
    );
  }, [hasSessionContext, participantId, sessionId, storeId]);

  const totals = useMemo(() => {
    if (!participantId) return { myTotal: 0, grandTotal: 0, myOrderHistory: [] };

    let myTotal = 0;
    let grandTotal = 0;
    const myOrderHistory = [];

    orderHistory.forEach((order) => {
      const orderTotal = order.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
      grandTotal += orderTotal;
      if (isOrderOwnedByCustomer(order, participantId)) {
        myTotal += orderTotal;
        myOrderHistory.push(order);
      }
    });

    return { myTotal, grandTotal, myOrderHistory };
  }, [orderHistory, participantId]);

  return {
    orderHistory: hasSessionContext ? orderHistory : [],
    historyLoading: hasSessionContext ? historyLoading : false,
    ...totals
  };
};
