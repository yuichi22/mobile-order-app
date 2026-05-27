//useCustomerCart.js
import { useMemo, useState } from 'react';

import { calculateItemTotal } from '../../../shared/utils/money';

const buildOptionKey = (options = []) => (
  options
    .map((option) => `${option.groupId || option.groupName || ''}:${option.optionId || option.name || ''}`)
    .sort()
    .join(',')
);

const getPriceMode = (item) => (
  item?.appliedPriceMode === 'crossSell' ? 'crossSell' : 'normal'
);

const buildCartLineKey = (item, options = []) => (
  [
    item?.id || '',
    buildOptionKey(options),
    getPriceMode(item),
    item?.crossSellSourceKey || '',
    item?.serviceTiming || ''
  ].join('|')
);

export const useCustomerCart = (showToast) => {
  const [cart, setCart] = useState([]);

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + (Number(item.unitPrice || 0) * Number(item.quantity || 0)), 0),
    [cart]
  );

  const confirmAddToCart = (item, quantity, options = [], extraPayload = {}) => {
    const normalizedQuantity = Math.max(1, Number(quantity || 1));
    const priceMode = getPriceMode(item);

    const orderLimit = Number(item.orderLimitPerOrder) || 0;
    const hasLimitedQuantity = item.hasLimitedQuantity === true;
    const limitedRemaining = hasLimitedQuantity ? Number(item.remainingQuantity) : null;
    const unitPrice = calculateItemTotal(item.price, options);

    setCart((previous) => {
      const currentQuantity = previous
        .filter((cartItem) => cartItem.id === item.id)
        .reduce((total, cartItem) => total + Number(cartItem.quantity || 0), 0);

      if (orderLimit > 0 && currentQuantity + normalizedQuantity > orderLimit) {
        showToast(`${item.name} は1回の注文で ${orderLimit} 点までです`, 'error');
        return previous;
      }

      if (hasLimitedQuantity && Number.isFinite(limitedRemaining) && limitedRemaining <= 0) {
        showToast(`${item.name} は本日の販売数に達しました`, 'error');
        return previous;
      }

      if (hasLimitedQuantity && Number.isFinite(limitedRemaining) && currentQuantity + normalizedQuantity > limitedRemaining) {
        showToast(`${item.name} の残りは ${limitedRemaining} 点です`, 'error');
        return previous;
      }

      const newCartItem = {
        ...item,
        quantity: normalizedQuantity,
        selectedOptions: options,
        unitPrice,
        appliedPriceMode: priceMode,
        priceLabelText: item.priceLabelText || '',
        originalPrice: item.originalPrice ?? null,
        originalPriceLabelText: item.originalPriceLabelText || '',
        ...extraPayload,
        cartId: crypto.randomUUID()
      };

      // セット価格商品は、同じ商品IDでも「料理ごとのセット追加分」として扱う。
      // 通常商品のように同一行へマージすると、2品目以降のセット追加が弾かれるため、
      // crossSell は常に別 cartId の新しい行として追加する。
      if (priceMode === 'crossSell') {
        return [
          ...previous,
          newCartItem
        ];
      }

      const incomingLineKey = buildCartLineKey({ ...item, ...extraPayload }, options);

      const existingIndex = previous.findIndex((cartItem) => (
        buildCartLineKey(cartItem, cartItem.selectedOptions) === incomingLineKey
      ));

      if (existingIndex > -1) {
        const nextCart = [...previous];
        nextCart[existingIndex] = {
          ...nextCart[existingIndex],
          quantity: Number(nextCart[existingIndex].quantity || 0) + normalizedQuantity,
          remainingQuantity: item.remainingQuantity,
          limitedQuantity: item.limitedQuantity,
          dailySoldCount: item.dailySoldCount,
          dailySoldDate: item.dailySoldDate
        };
        return nextCart;
      }

      return [
        ...previous,
        newCartItem
      ];
    });

    //showToast(`${item.name} をカートに追加しました`);
  };

  const decreaseCartItem = (cartId) => {
    setCart((previous) => {
      const existingItem = previous.find((item) => item.cartId === cartId);
      if (!existingItem) return previous;

      // クロスセル商品は数量変更不可。減らす場合は削除ボタンで消す。
      if (getPriceMode(existingItem) === 'crossSell') {
        return previous;
      }

      if (Number(existingItem.quantity || 0) <= 1) {
        return previous.filter((item) => item.cartId !== cartId);
      }

      return previous.map((item) => (
        item.cartId === cartId
          ? { ...item, quantity: Number(item.quantity || 0) - 1 }
          : item
      ));
    });
  };

  const removeCartItem = (cartId) => {
    setCart((previous) => previous.filter((item) => item.cartId !== cartId));
  };

  const normalizeCartItems = (normalizer) => {
    if (typeof normalizer !== 'function') return;

    setCart((previous) => {
      const next = normalizer(previous);
      return Array.isArray(next) ? next : previous;
    });
  };

  return {
    cart,
    setCart,
    cartTotal,
    confirmAddToCart,
    decreaseCartItem,
    removeCartItem,
    normalizeCartItems
  };
};