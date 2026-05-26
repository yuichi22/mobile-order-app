export const isCancelledOrderItem = (item) => {
  if (!item) return true;
  return item.status === 'cancelled' || item.kitchenStatus === 'cancelled';
};

export const getOrderItemKitchenStatus = (item) => (
  String(item?.kitchenStatus || item?.status || 'pending')
);

export const isPreparedOrderItem = (item) => (
  item?.isPrepared === true
  || getOrderItemKitchenStatus(item) === 'prepared'
  || getOrderItemKitchenStatus(item) === 'served'
);

export const isCustomerEditableOrderItem = (order, item) => {
  if (!order || !item) return false;

  if (order.status === 'cancelled') return false;
  if (order.paymentStatus === 'cancelled') return false;
  if (order.paymentStatus === 'paid') return false;
  if (order.orderFlow === 'prepay') return false;

  if (isCancelledOrderItem(item)) return false;
  if (isPreparedOrderItem(item)) return false;

  return getOrderItemKitchenStatus(item) === 'pending';
};

export const getActiveOrderItems = (items = []) => (
  Array.isArray(items)
    ? items.filter((item) => !isCancelledOrderItem(item))
    : []
);

export const getOrderItemUnitPrice = (item) => (
  Number(item?.unitPrice ?? item?.price ?? 0) || 0
);

export const getOrderItemQuantity = (item) => (
  Math.max(Number(item?.quantity || 0), 0)
);

export const getOrderItemLineTotal = (item) => (
  getOrderItemUnitPrice(item) * getOrderItemQuantity(item)
);

export const getActiveOrderItemsTotal = (items = []) => (
  getActiveOrderItems(items).reduce((sum, item) => (
    sum + getOrderItemLineTotal(item)
  ), 0)
);

export const getOrderItemIdentity = (item, index = 0) => (
  String(
    item?.id
    || item?.itemId
    || item?.cartId
    || item?.menuItemId
    || item?.productId
    || item?.name
    || `item-${index}`
  )
);
