import { useEffect, useState } from 'react';

import {
  completeKitchenRequest,
  restoreKitchenStock,
  subscribeKitchenMenu,
  subscribeKitchenOrders,
  subscribeKitchenRequests,
  updateKitchenOrderItems,
  subscribeKitchenSettings,
  updateKitchenOrderStatus,
  updateKitchenOrderMeta
} from '../services/kitchenBoardService';

export const useKitchenBoard = (storeId) => {
  const hasStoreId = Boolean(storeId);
  const [orders, setOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [menuItemLookup, setMenuItemLookup] = useState({});
  const [kitchens, setKitchens] = useState([]);
  const [cookingCategories, setCookingCategories] = useState([]);
  const [soldOutItems, setSoldOutItems] = useState([]);
  const [calls, setCalls] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(() => hasStoreId);

  useEffect(() => {
    if (!hasStoreId) return undefined;

    const unsubSettings = subscribeKitchenSettings(storeId, (settings) => {
      setKitchens(settings.kitchens || []);
      setCookingCategories(settings.cookingCategories || []);
    });
    const unsubMenu = subscribeKitchenMenu(storeId, ({ lookup, soldOut }) => {
      setMenuItemLookup(lookup);
      setSoldOutItems(soldOut);
    });
    const unsubOrders = subscribeKitchenOrders(storeId, ({ orders: nextOrders, completedOrders: nextCompleted }) => {
      setOrders(nextOrders);
      setCompletedOrders(nextCompleted);
      setLoading(false);
    });
    const unsubRequests = subscribeKitchenRequests(storeId, ({ calls: nextCalls, checks: nextChecks }) => {
      setCalls(nextCalls);
      setChecks(nextChecks);
    });

    return () => {
      unsubSettings();
      unsubMenu();
      unsubOrders();
      unsubRequests();
    };
  }, [hasStoreId, storeId]);

  const updateStatus = async (orderId, status) => {
    if (!storeId) return;
    try {
      await updateKitchenOrderStatus(storeId, orderId, status);
    } catch (e) {
      console.error("KDS Status update error:", e);
    }
  };

    const updateOrderItems = async (orderId, items, status = null) => {
      if (!storeId) return;
      try {
        await updateKitchenOrderItems(storeId, orderId, items, status);
      } catch (e) {
        console.error('KDS Item update error:', e);
      }
    };

  const updateOrderMeta = async (orderId, payload = {}) => {
    if (!storeId) return;
    try {
      await updateKitchenOrderMeta(storeId, orderId, payload);
    } catch (e) {
      console.error('KDS Order meta update error:', e);
    }
  };    

  const restoreStock = async (itemId) => {
    if (!storeId) return;
    try {
      await restoreKitchenStock(storeId, itemId);
    } catch (e) {
      console.error("KDS Restore stock error:", e);
    }
  };

  const completeRequest = async (requestId) => {
    if (!storeId) return;
    try {
      await completeKitchenRequest(storeId, requestId);
    } catch (e) {
      console.error("KDS Request completion error:", e);
    }
  };

  return {
    orders,
    completedOrders,
    menuItemLookup,
    kitchens,
    cookingCategories,
    soldOutItems,
    calls,
    checks,
    loading: hasStoreId ? loading : false,
    updateOrderStatus: updateStatus,
    updateOrderItems,
    updateOrderMeta,
    restoreStock,
    completeRequest
  };
};
