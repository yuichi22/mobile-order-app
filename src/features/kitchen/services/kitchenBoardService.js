import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../../shared/api/firebase/client';

export const updateKitchenOrderMeta = (storeId, orderId, payload = {}) => {
  return updateDoc(doc(db, 'stores', storeId, 'orders', orderId), {
    ...payload,
    updatedAt: new Date()
  });
};

export const subscribeKitchenSettings = (storeId, onChange) => {
  let kitchens = [];
  let cookingCategories = [];

  const emit = () => {
    onChange({
      kitchens,
      cookingCategories
    });
  };

  const unsubBasic = onSnapshot(doc(db, 'stores', storeId, 'settings', 'basic'), (docSnap) => {
    kitchens = docSnap.exists() ? (docSnap.data().kitchens || []) : [];
    emit();
  });

  const unsubCookingCategories = onSnapshot(
    doc(db, 'stores', storeId, 'settings', 'cookingCategories'),
    (docSnap) => {
      const data = docSnap.exists() ? docSnap.data() : {};
      cookingCategories = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.cookingCategories)
          ? data.cookingCategories
          : [];

      cookingCategories = cookingCategories
        .filter((item) => item?.id && item?.name)
        .sort((left, right) => {
          const leftOrder = Number(left.sortOrder ?? 999999);
          const rightOrder = Number(right.sortOrder ?? 999999);
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return String(left.name || '').localeCompare(String(right.name || ''), 'ja');
        });

      emit();
    }
  );

  return () => {
    unsubBasic();
    unsubCookingCategories();
  };
};

export const subscribeKitchenMenu = (storeId, onChange) => {
  return onSnapshot(collection(db, 'stores', storeId, 'menuItems'), (snapshot) => {
    const lookup = {};
    const soldOut = [];

    snapshot.docs.forEach((docSnap) => {
      const item = { id: docSnap.id, ...docSnap.data() };
      lookup[docSnap.id] = item;
      if (item.isSoldOut) soldOut.push(item);
    });

    onChange({ lookup, soldOut });
  });
};

export const subscribeKitchenOrders = (storeId, onChange) => {
  return onSnapshot(query(collection(db, 'stores', storeId, 'orders'), orderBy('timestamp', 'asc')), (snapshot) => {
    const allOrders = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    const activeOrders = allOrders.filter((order) => {
      if (!order) return false;
      if (order.status === 'completed') return false;
      if (order.status === 'cancelled' || order.paymentStatus === 'cancelled') return false;
      return true;
    });

    onChange({
      orders: activeOrders,
      completedOrders: allOrders
        .filter((order) => order.status === 'completed')
        .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
        .slice(0, 20)
    });
  });
};

export const subscribeKitchenRequests = (storeId, onChange) => {
  return onSnapshot(query(collection(db, 'stores', storeId, 'serviceRequests'), orderBy('createdAt', 'desc')), (snapshot) => {
    const calls = [];
    const checks = [];

    snapshot.docs.forEach((docSnap) => {
      const request = {
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt?.toDate ? docSnap.data().createdAt.toDate() : new Date()
      };

      if (request.status === 'completed') return;
      if (request.type === 'call') calls.push(request);
      if (request.type === 'check') checks.push(request);
    });

    onChange({ calls, checks });
  });
};

export const updateKitchenOrderStatus = (storeId, orderId, status) => {
  return updateDoc(doc(db, 'stores', storeId, 'orders', orderId), {
    status,
    updatedAt: new Date()
  });
};

export const updateKitchenOrderItems = (storeId, orderId, items, status = null, extraPayload = {}) => {
  const payload = {
    items,
    ...extraPayload,
    updatedAt: new Date()
  };

  if (status) {
    payload.status = status;
  }

  return updateDoc(doc(db, 'stores', storeId, 'orders', orderId), payload);
};

export const restoreKitchenStock = (storeId, itemId) => {
  return updateDoc(doc(db, 'stores', storeId, 'menuItems', itemId), { isSoldOut: false });
};

export const completeKitchenRequest = (storeId, requestId) => {
  return updateDoc(doc(db, 'stores', storeId, 'serviceRequests', requestId), { status: 'completed' });
};
