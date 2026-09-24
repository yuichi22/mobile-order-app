import { collection, doc, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
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

// ⚠ orders/serviceRequests は日々増え続ける（prodで数千件）。全件購読すると
//   1回のタップごとに全件を再処理してモニターの反応が悪化するため、直近分に限定する。
const KITCHEN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const subscribeKitchenOrders = (storeId, onChange) => {
  const cutoff = new Date(Date.now() - KITCHEN_LOOKBACK_MS);

  return onSnapshot(query(
    collection(db, 'stores', storeId, 'orders'),
    where('timestamp', '>=', cutoff),
    orderBy('timestamp', 'asc')
  ), (snapshot) => {
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

/**
 * WebからのテイクアウトのWeb注文を購読する。
 *
 * ⚠ 通常の orders とは別コレクション。orders に混ぜると、2日後の受け取り分まで
 *   「いま作るもの」として注文ボードに並んでしまう。
 * ⚠ 受け取り日時の早い順。過ぎたものや引き渡し済みは出さない。
 */
export const subscribeTakeoutOrders = (storeId, onChange) => {
  return onSnapshot(
    query(collection(db, 'stores', storeId, 'takeoutOrders'), orderBy('pickupAt', 'asc')),
    (snapshot) => {
      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      // 引き渡し済み・取消は落とす。⚠ 受け取り前日までは残す（仕込みの予定表になる）
      const active = all.filter((o) => o.status !== 'handed' && o.status !== 'cancelled');
      onChange({ takeoutOrders: active });
    },
    (error) => {
      console.error('[kitchen] takeoutOrders subscribe failed', error);
      onChange({ takeoutOrders: [] });
    }
  );
};

export const updateTakeoutOrderStatus = (storeId, orderId, status) => {
  return updateDoc(doc(db, 'stores', storeId, 'takeoutOrders', orderId), {
    status,
    updatedAt: new Date()
  });
};

export const subscribeKitchenRequests = (storeId, onChange) => {
  const cutoff = new Date(Date.now() - KITCHEN_LOOKBACK_MS);

  return onSnapshot(query(
    collection(db, 'stores', storeId, 'serviceRequests'),
    where('createdAt', '>=', cutoff),
    orderBy('createdAt', 'desc')
  ), (snapshot) => {
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

// 売り切れ→販売再開。管理画面の「販売再開」と同じく残数設定ごと解除する。
// isSoldOut だけ戻すと、残数0のまま販売中になり注文がサーバーで弾かれ続ける。
export const restoreKitchenStock = (storeId, itemId) => {
  return updateDoc(doc(db, 'stores', storeId, 'menuItems', itemId), {
    isSoldOut: false,
    limitedQuantity: null,
    soldQuantity: 0,
    remainingQuantity: null,
    dailySoldCount: 0,
    dailySoldDate: null
  });
};

export const completeKitchenRequest = (storeId, requestId) => {
  return updateDoc(doc(db, 'stores', storeId, 'serviceRequests', requestId), { status: 'completed' });
};
