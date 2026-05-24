export const resolveOrderCustomerId = (order) => (
  String(
    order?.customerId
    || order?.participantId
    || order?.userId
    || 'guest'
  ).trim() || 'guest'
);

export const isOrderOwnedByCustomer = (order, customerId) => (
  Boolean(customerId && resolveOrderCustomerId(order) === String(customerId).trim())
);

export const formatOrderCustomerLabel = (customerId) => {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId || normalizedCustomerId === 'guest') return 'ゲスト';
  return `ID: ${normalizedCustomerId.slice(-6)}`;
};

export const groupOrdersByCustomer = (orders = []) => orders.reduce((accumulator, order) => {
  if (!order) return accumulator;

  const customerId = resolveOrderCustomerId(order);
  if (!accumulator[customerId]) accumulator[customerId] = [];
  accumulator[customerId].push(order);
  return accumulator;
}, {});
