export const getTodayKey = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
};

export const getLimitedQuantityStatus = (item, todayKey = getTodayKey()) => {
  const limitedQuantity = Number(item?.limitedQuantity);

  if (!Number.isFinite(limitedQuantity) || limitedQuantity <= 0) {
    return {
      hasLimitedQuantity: false,
      limitedQuantity: null,
      soldToday: 0,
      remainingQuantity: null,
      isLimitedSoldOut: false
    };
  }

  const soldToday = item?.dailySoldDate === todayKey
    ? Math.max(Number(item?.dailySoldCount) || 0, 0)
    : 0;

  const remainingQuantity = Math.max(limitedQuantity - soldToday, 0);

  return {
    hasLimitedQuantity: true,
    limitedQuantity,
    soldToday,
    remainingQuantity,
    isLimitedSoldOut: remainingQuantity <= 0
  };
};

export const decorateMenuItemAvailability = (item, todayKey = getTodayKey()) => {
  const stockStatus = getLimitedQuantityStatus(item, todayKey);

  return {
    ...item,
    ...stockStatus,
    isSoldOut: item?.isSoldOut === true || stockStatus.isLimitedSoldOut
  };
};
