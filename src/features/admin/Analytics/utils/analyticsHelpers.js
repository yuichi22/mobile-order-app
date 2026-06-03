export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export const toDate = (value) => {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateDisplay = (date) => {
  const target = toDate(date);
  if (!target) return '';
  return `${target.getFullYear()}/${target.getMonth() + 1}/${target.getDate()}`;
};

export const formatYAxisLabel = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0';
  return `¥${value.toLocaleString()}`;
};

export const formatDateKey = (date) => {
  const target = toDate(date);
  if (!target) return '';

  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export const formatMonthKey = (date) => {
  const target = toDate(date);
  if (!target) return '';
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
};

export const formatYearKey = (date) => {
  const target = toDate(date);
  if (!target) return '';
  return `${target.getFullYear()}`;
};

const parseTimeToHour = (value, fallbackHour) => {
  if (typeof value !== 'string') return fallbackHour;

  const [hourText] = value.split(':');
  const hour = Number(hourText);

  if (!Number.isFinite(hour)) return fallbackHour;
  return Math.min(Math.max(hour, 0), 23);
};

const getDayBusinessHours = (businessSettings, currentDate) => {
  const target = toDate(currentDate) || new Date();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayKey = dayKeys[target.getDay()];

  const businessHours = businessSettings?.businessHours || {};
  const dayValue = businessHours?.[dayKey] || {};

  const isOpen =
    dayValue.isOpen ??
    dayValue.open ??
    dayValue.enabled ??
    true;

  if (isOpen === false) {
    return {
      isClosed: true,
      startHour: 0,
      endHour: 23
    };
  }

  const startText =
    dayValue.start ??
    dayValue.openTime ??
    dayValue.startTime ??
    businessSettings?.start ??
    businessSettings?.openTime ??
    '09:00';

  const endText =
    dayValue.end ??
    dayValue.closeTime ??
    dayValue.endTime ??
    businessSettings?.end ??
    businessSettings?.closeTime ??
    '22:00';

  const startHour = parseTimeToHour(startText, 9);
  const endHour = parseTimeToHour(endText, 22);

  return {
    isClosed: false,
    startHour,
    endHour
  };
};

const parseTimeToMinutes = (value) => {
  if (typeof value !== 'string') return null;

  const [hourText, minuteText = '0'] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return Math.min(Math.max(hour, 0), 23) * 60 + Math.min(Math.max(minute, 0), 59);
};

const normalizeAnalyticsPeriods = (periods = []) => (
  Array.isArray(periods)
    ? periods
        .map((period, index) => {
          const startMinutes = parseTimeToMinutes(period?.start);
          const endMinutes = parseTimeToMinutes(period?.end);

          if (!period?.id || !period?.name || startMinutes === null || endMinutes === null) {
            return null;
          }

          return {
            id: String(period.id),
            label: period.name,
            start: period.start,
            end: period.end,
            startMinutes,
            endMinutes,
            index
          };
        })
        .filter(Boolean)
    : []
);

const isMinutesWithinPeriod = (targetMinutes, period) => {
  if (!period) return false;

  // 設定画面の終了時刻は「その分まで含む」扱いにする。
  // 例: 11:30〜13:59 なら 13:59 台の注文も含める。
  if (period.startMinutes <= period.endMinutes) {
    return targetMinutes >= period.startMinutes && targetMinutes <= period.endMinutes;
  }

  // 日跨ぎ: 17:00〜02:00 など
  return targetMinutes >= period.startMinutes || targetMinutes <= period.endMinutes;
};

const resolvePeriodKey = (date, analyticsPeriods = []) => {
  const target = toDate(date);
  if (!target) return null;

  const minutes = target.getHours() * 60 + target.getMinutes();
  const matched = analyticsPeriods.find((period) => isMinutesWithinPeriod(minutes, period));

  return matched?.id || null;
};

const buildDailyHourKeys = ({ businessSettings, currentDate }) => {
  const { startHour, endHour } = getDayBusinessHours(businessSettings, currentDate);

  // 24時間営業に近い設定なら 0〜23 を表示
  if (startHour <= 1 && endHour >= 23) {
    return Array.from({ length: 24 }, (_, index) => index);
  }

  // 同日内営業: 9:00〜18:00 => 8〜19
  if (startHour <= endHour) {
    const displayStart = Math.max(0, startHour - 1);
    const displayEnd = Math.min(23, endHour + 1);

    const keys = [];
    for (let hour = displayStart; hour <= displayEnd; hour += 1) {
      keys.push(hour);
    }

    return keys;
  }

  // 日跨ぎ営業: 18:00〜2:00 => 17〜23, 0〜3
  const keys = [];

  for (let hour = Math.max(0, startHour - 1); hour <= 23; hour += 1) {
    keys.push(hour);
  }

  for (let hour = 0; hour <= Math.min(23, endHour + 1); hour += 1) {
    keys.push(hour);
  }

  return keys;
};

const getTrailingWeekIndex52 = (date, endDate) => {
  const target = toDate(date) || new Date();
  const end = toDate(endDate) || new Date();

  const normalizedTarget = new Date(target);
  normalizedTarget.setHours(0, 0, 0, 0);

  const normalizedEnd = new Date(end);
  normalizedEnd.setHours(0, 0, 0, 0);

  const start = new Date(normalizedEnd);
  start.setDate(start.getDate() - (52 * 7) + 1);
  start.setHours(0, 0, 0, 0);

  const diffMs = normalizedTarget.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return null;

  const weekIndex = Math.floor(diffDays / 7) + 1;

  if (weekIndex < 1 || weekIndex > 52) return null;

  return weekIndex;
};

const getWeeklyComparisonBucket = (date, baseDate) => {
  const target = toDate(date) || new Date();
  const end = toDate(baseDate) || new Date();

  const normalizedTarget = new Date(target);
  normalizedTarget.setHours(0, 0, 0, 0);

  const normalizedEnd = new Date(end);
  normalizedEnd.setHours(0, 0, 0, 0);

  const currentStart = new Date(normalizedEnd);
  currentStart.setDate(currentStart.getDate() - 6);
  currentStart.setHours(0, 0, 0, 0);

  const previousEnd = new Date(normalizedEnd);
  previousEnd.setDate(previousEnd.getDate() - (52 * 7));
  previousEnd.setHours(0, 0, 0, 0);

  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - 6);
  previousStart.setHours(0, 0, 0, 0);

  if (normalizedTarget >= currentStart && normalizedTarget <= normalizedEnd) {
    return 'current';
  }

  if (normalizedTarget >= previousStart && normalizedTarget <= previousEnd) {
    return 'previous';
  }

  return null;
};

const formatComparisonDate = (date) => {
  const target = toDate(date);
  if (!target) return '';

  return `${target.getFullYear()}/${target.getMonth() + 1}/${target.getDate()}`;
};

const buildWeeklyComparisonRange = (baseDate) => {
  const end = toDate(baseDate) || new Date();
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const previousEnd = new Date(end);
  previousEnd.setDate(previousEnd.getDate() - (52 * 7));
  previousEnd.setHours(0, 0, 0, 0);

  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - 6);
  previousStart.setHours(0, 0, 0, 0);

  return {
    currentStartDate: start,
    currentEndDate: end,
    previousStartDate: previousStart,
    previousEndDate: previousEnd,
    currentRangeLabel: `${formatComparisonDate(start)}〜${formatComparisonDate(end)}`,
    previousRangeLabel: `${formatComparisonDate(previousStart)}〜${formatComparisonDate(previousEnd)}`
  };
};

const getTransactionAmount = (record) => (
  Number(
    record?.totalAmount ??
    record?.totalPrice ??
    record?.amount ??
    0
  ) || 0
);

const getRecordDate = (record) => (
  toDate(record?.paidAt) ||
  toDate(record?.timestamp) ||
  toDate(record?.createdAt) ||
  new Date()
);

const getRecordGuestCount = (record) => {
  const value = Number(
    record?.guestCount ??
    record?.partySize ??
    record?.numberOfGuests ??
    record?.peopleCount ??
    0
  );

  return Number.isFinite(value) && value > 0 ? value : 0;
};

const getRecordSessionKey = (record) => (
  String(
    record?.sessionId ||
    record?.tableSessionId ||
    record?.tableKey ||
    record?.id ||
    ''
  )
);

const upsertSessionGuestCount = (map, sessionKey, guestCount) => {
  if (!sessionKey) return;
  const current = Number(map.get(sessionKey) || 0);
  map.set(sessionKey, Math.max(current, Number(guestCount || 0)));
};

const sumSessionGuestCounts = (map) => (
  Array.from(map.values()).reduce((sum, value) => sum + Number(value || 0), 0)
);

const getItemQuantity = (item) => {
  const quantity = Number(item?.quantity ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const getItemTotal = (item) => {
  const quantity = getItemQuantity(item);
  const directTotal = Number(item?.totalPrice ?? item?.totalAmount);

  if (Number.isFinite(directTotal) && directTotal > 0) {
    return directTotal;
  }

  return (Number(item?.unitPrice || 0) || 0) * quantity;
};

const resolveCategoryId = (item, itemCategoryMap) => (
  item?.categoryId ||
  item?.category ||
  itemCategoryMap?.[item?.name] ||
  'other'
);

const getOrderAnalyticsRecords = (record) => (
  Array.isArray(record?.orderAnalyticsRecords) && record.orderAnalyticsRecords.length > 0
    ? record.orderAnalyticsRecords
    : [{
        id: record?.id,
        transactionId: record?.id,
        sessionId: record?.sessionId,
        tableId: record?.tableId,
        timestamp: getRecordDate(record),
        totalAmount: getTransactionAmount(record),
        guestCount: getRecordGuestCount(record),
        items: Array.isArray(record?.items) ? record.items : []
      }]
);

export const buildAnalyticsSummary = ({
  orders,
  period,
  currentDate,
  customRange,
  itemCategoryMap,
  categoryColorMap,
  isDayOfWeekMode,
  abcThresholds,
  categories,
  businessSettings,
  periods,
  selectedPeriodId = 'all'
}) => {
  let totalSales = 0;
  const analyticsPeriods = normalizeAnalyticsPeriods(periods);
  const normalizedSelectedPeriodId = String(selectedPeriodId || 'all');
  const shouldFilterByPeriod = normalizedSelectedPeriodId !== 'all';

  const sessionGuestCounts = new Map();
  const weeklyCurrentSessionGuestCounts = new Map();
  const weeklyPreviousSessionGuestCounts = new Map();
  const weeklyCurrentSessionKeys = new Set();
  const weeklyPreviousSessionKeys = new Set();

  let weeklyCurrentSales = 0;
  let weeklyPreviousSales = 0;

  const itemStats = {};
  const timeSlots = {};

  let currentGranularity = 'day';

  if (isDayOfWeekMode && (period === 'monthly' || period === 'custom')) {
    currentGranularity = 'weekday';
  } else if (period === 'daily') {
    // 分析の日次グラフは、提供時間帯ではなく営業時間内の1時間単位で表示する。
    currentGranularity = 'hour';
  } else if (period === 'weekly') {
    currentGranularity = 'week';
  } else if (period === 'monthly') {
    currentGranularity = 'day';
  } else {
    const start = toDate(customRange.start) || new Date();
    const end = toDate(customRange.end) || new Date();
    const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));

    if (diffDays > 365 * 3) currentGranularity = 'year';
    else if (diffDays > 62) currentGranularity = 'month';
    else currentGranularity = 'day';
  }

  if (currentGranularity === 'weekday') {
    for (let index = 0; index < 7; index += 1) {
      timeSlots[index] = {
        total: 0,
        customers: 0,
        transactions: 0,
        sessionGuestCounts: new Map(),
        sessionKeys: new Set(),
        categories: {}
      };
    }
  } else if (currentGranularity === 'period') {
    analyticsPeriods.forEach((analyticsPeriod) => {
      timeSlots[analyticsPeriod.id] = {
        total: 0,
        customers: 0,
        transactions: 0,
        sessionGuestCounts: new Map(),
        sessionKeys: new Set(),
        label: analyticsPeriod.label,
        start: analyticsPeriod.start,
        end: analyticsPeriod.end,
        categories: {}
      };
    });
  } else if (period === 'daily') {
    const dailyHourKeys = buildDailyHourKeys({ businessSettings, currentDate });

    dailyHourKeys.forEach((hour) => {
      timeSlots[hour] = {
        total: 0,
        customers: 0,
        transactions: 0,
        sessionGuestCounts: new Map(),
        sessionKeys: new Set(),
        categories: {}
      };
    });
  } else if (period === 'weekly') {
    for (let week = 1; week <= 52; week += 1) {
      timeSlots[week] = {
        total: 0,
        customers: 0,
        transactions: 0,
        sessionGuestCounts: new Map(),
        sessionKeys: new Set(),
        categories: {}
      };
    }
  } else {
    let currentIter = new Date();
    let endIter = new Date();

    if (period === 'monthly') {
      currentIter = new Date(currentDate);
      currentIter.setDate(1);
      currentIter.setHours(0, 0, 0, 0);

      endIter = new Date(currentDate);
      endIter.setMonth(endIter.getMonth() + 1);
      endIter.setDate(0);
      endIter.setHours(23, 59, 59, 999);
    } else {
      currentIter = toDate(customRange.start) || new Date();
      currentIter.setHours(0, 0, 0, 0);

      endIter = toDate(customRange.end) || new Date();
      endIter.setHours(23, 59, 59, 999);
    }

    let loopCount = 0;

    while (currentIter <= endIter && loopCount < 3000) {
      let key;

      if (currentGranularity === 'year') {
        key = formatYearKey(currentIter);
        currentIter.setFullYear(currentIter.getFullYear() + 1);
      } else if (currentGranularity === 'month') {
        key = formatMonthKey(currentIter);
        currentIter.setDate(1);
        currentIter.setMonth(currentIter.getMonth() + 1);
      } else {
        key = period === 'monthly' ? currentIter.getDate() : formatDateKey(currentIter);
        currentIter.setDate(currentIter.getDate() + 1);
      }

      timeSlots[key] = {
        total: 0,
        customers: 0,
        transactions: 0,
        sessionGuestCounts: new Map(),
        sessionKeys: new Set(),
        categories: {}
      };
      loopCount += 1;
    }
  }

  (orders || []).forEach((record) => {
    if (record?.isPaid === false) return;

    const recordDate = getRecordDate(record);
    const guestCount = getRecordGuestCount(record);
    const sessionKey = getRecordSessionKey(record);

    let includedRecordAmount = 0;
    let hasIncludedOrderRecord = false;

    getOrderAnalyticsRecords(record).forEach((orderRecord) => {
      const orderRecordDate = getRecordDate(orderRecord);
      const orderAmount = getTransactionAmount(orderRecord);
      const orderPeriodKey = resolvePeriodKey(orderRecordDate, analyticsPeriods);

      if (shouldFilterByPeriod && orderPeriodKey !== normalizedSelectedPeriodId) {
        return;
      }

      includedRecordAmount += orderAmount;
      hasIncludedOrderRecord = true;

      let orderKey;

      if (currentGranularity === 'weekday') {
        orderKey = orderRecordDate.getDay();
      } else if (currentGranularity === 'period') {
        orderKey = orderPeriodKey;
      } else if (period === 'daily') {
        orderKey = orderRecordDate.getHours();
      } else if (period === 'weekly') {
        orderKey = getTrailingWeekIndex52(orderRecordDate, currentDate);
      } else if (period === 'monthly') {
        orderKey = orderRecordDate.getDate();
      } else if (currentGranularity === 'year') {
        orderKey = formatYearKey(orderRecordDate);
      } else if (currentGranularity === 'month') {
        orderKey = formatMonthKey(orderRecordDate);
      } else {
        orderKey = formatDateKey(orderRecordDate);
      }

      if (orderKey === null || orderKey === undefined) return;

      // 売上合計・客単価は会計transactionベース、時間帯グラフは注文時刻ベースで配分する
      if (timeSlots[orderKey]) {
        timeSlots[orderKey].total += orderAmount;
        upsertSessionGuestCount(timeSlots[orderKey].sessionGuestCounts, sessionKey, guestCount);
        timeSlots[orderKey].sessionKeys.add(sessionKey);
        timeSlots[orderKey].customers = sumSessionGuestCounts(timeSlots[orderKey].sessionGuestCounts);
        timeSlots[orderKey].transactions = timeSlots[orderKey].sessionKeys.size;
      }

      if (Array.isArray(orderRecord.items)) {
        orderRecord.items.forEach((item) => {
          const name = item?.name || '商品名未設定';
          const quantity = getItemQuantity(item);
          const itemTotal = getItemTotal(item);

          if (!itemStats[name]) {
            itemStats[name] = {
              count: 0,
              sales: 0
            };
          }

          itemStats[name].count += quantity;
          itemStats[name].sales += itemTotal;

          const categoryId = resolveCategoryId(item, itemCategoryMap);

          if (timeSlots[orderKey]) {
            if (!timeSlots[orderKey].categories[categoryId]) {
              timeSlots[orderKey].categories[categoryId] = 0;
            }

            timeSlots[orderKey].categories[categoryId] += itemTotal;
          }
        });
      }
    });

    if (!hasIncludedOrderRecord) return;

    totalSales += includedRecordAmount;
    upsertSessionGuestCount(sessionGuestCounts, sessionKey, guestCount);

    if (period === 'weekly') {
      const comparisonBucket = getWeeklyComparisonBucket(recordDate, currentDate);

      if (comparisonBucket === 'current') {
        weeklyCurrentSales += includedRecordAmount;
        weeklyCurrentSessionKeys.add(sessionKey);
        upsertSessionGuestCount(weeklyCurrentSessionGuestCounts, sessionKey, guestCount);
      } else if (comparisonBucket === 'previous') {
        weeklyPreviousSales += includedRecordAmount;
        weeklyPreviousSessionKeys.add(sessionKey);
        upsertSessionGuestCount(weeklyPreviousSessionGuestCounts, sessionKey, guestCount);
      }
    }
  });

  const totalOrders = sessionGuestCounts.size;
  const customerCount = sumSessionGuestCounts(sessionGuestCounts);

  const averageSpendPerCustomer = customerCount > 0
    ? Math.round(totalSales / customerCount)
    : 0;

  const averageSpendPerTransaction = totalOrders > 0
    ? Math.round(totalSales / totalOrders)
    : 0;

  const averagePartySize = totalOrders > 0
    ? Number((customerCount / totalOrders).toFixed(1))
    : 0;

  const itemRanking = Object.entries(itemStats)
    .map(([name, data]) => ({
      name,
      ...data
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);

  const allItems = Object.entries(itemStats)
    .map(([name, data]) => ({
      name,
      ...data
    }))
    .sort((left, right) => right.sales - left.sales);

  const abcTotalSales = allItems.reduce((sum, item) => sum + item.sales, 0);
  let cumulativeSales = 0;

  const abcItems = allItems.map((item) => {
    cumulativeSales += item.sales;

    const percentage = abcTotalSales > 0
      ? (cumulativeSales / abcTotalSales) * 100
      : 0;

    let rank = 'C';

    if (percentage <= abcThresholds.a) rank = 'A';
    else if (percentage <= abcThresholds.b) rank = 'B';

    return {
      ...item,
      cumulativeSales,
      percentage,
      rank
    };
  });

  const abcSummary = {
    A: { count: 0, sales: 0, items: [] },
    B: { count: 0, sales: 0, items: [] },
    C: { count: 0, sales: 0, items: [] }
  };

  abcItems.forEach((item) => {
    abcSummary[item.rank].count += 1;
    abcSummary[item.rank].sales += item.sales;
    abcSummary[item.rank].items.push(item);
  });

  const insertionOrderKeys = Object.keys(timeSlots);

  const chartKeys = Object.keys(timeSlots).sort((left, right) => {
    if (currentGranularity === 'weekday') return Number(left) - Number(right);

    if (currentGranularity === 'period') {
      return insertionOrderKeys.indexOf(String(left)) - insertionOrderKeys.indexOf(String(right));
    }

    if (period === 'daily') {
      return insertionOrderKeys.indexOf(String(left)) - insertionOrderKeys.indexOf(String(right));
    }

    if (period === 'custom') return String(left).localeCompare(String(right));

    return Number(left) - Number(right);
  });

  const rawMaxVal = Math.max(...Object.values(timeSlots).map((slot) => slot.total), 0);
  let step = 10000;

  if (rawMaxVal > 0) {
    const targetStep = rawMaxVal / 5;
    const powerOf10 = Math.pow(10, Math.floor(Math.log10(targetStep)));
    const normalized = targetStep / powerOf10;

    let scale = 1;

    if (normalized < 1.5) scale = 1;
    else if (normalized < 3.5) scale = 2;
    else scale = 5;

    step = scale * powerOf10;
  }

  step = Math.max(step, 1000);

  const maxChartValue = Math.ceil(rawMaxVal / step) * step;
  const finalMax = maxChartValue === 0 ? 10000 : maxChartValue;
  const finalStep = maxChartValue === 0 ? 2000 : step;

  const yAxisTicks = [];
  const tickCount = Math.min(Math.round(finalMax / finalStep), 10);

  for (let index = tickCount; index >= 0; index -= 1) {
    yAxisTicks.push(index * finalStep);
  }

  const chartData = chartKeys.map((key, index) => {
    const slot = timeSlots[key];

    const stacks = Object.entries(slot.categories)
      .map(([categoryId, value]) => ({
        color: categoryColorMap[categoryId] || '#9ca3af',
        height: slot.total > 0 ? (value / slot.total) * 100 : 0,
        value,
        name: categories.find((category) => category.id === categoryId)?.name || '未分類'
      }))
      .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, 'ja'));

    let label = key;
    let shouldShowLabel = true;

    if (currentGranularity === 'weekday') {
      label = WEEKDAY_LABELS[key];
    } else if (currentGranularity === 'period') {
      label = slot.label || key;
    } else if (period === 'daily') {
      label = `${key}時`;
    } else if (period === 'weekly') {
      label = String(key);

      const week = Number(key);

      shouldShowLabel =
        week === 1 ||
        week === 5 ||
        week === 10 ||
        week === 15 ||
        week === 20 ||
        week === 25 ||
        week === 30 ||
        week === 35 ||
        week === 40 ||
        week === 45 ||
        week === 50 ||
        week === 52;
    } else if (period === 'monthly') {
      label = String(key);

      const day = Number(key);
      const lastDay = chartKeys.length;

      shouldShowLabel =
        day === 1 ||
        day === 5 ||
        day === 10 ||
        day === 15 ||
        day === 20 ||
        day === 25 ||
        day === lastDay;
    } else if (period === 'custom') {
      if (currentGranularity === 'month') {
        const parts = String(key).split('-');
        if (parts.length === 2) label = `${parts[0]}/${parseInt(parts[1], 10)}`;
      } else if (currentGranularity === 'day') {
        const date = toDate(key);
        label = date ? `${date.getMonth() + 1}/${date.getDate()}` : key;

        if (chartKeys.length > 14) {
          shouldShowLabel = index % Math.ceil(chartKeys.length / 8) === 0 || index === chartKeys.length - 1;
        }
      }
    }

  const slotSales = Number(slot.total || 0);
  const slotCustomers = Number(slot.customers || 0);
  const slotTransactions = Number(slot.transactions || 0);

  const customerUnitPrice = slotCustomers > 0
    ? Math.round(slotSales / slotCustomers)
    : 0;

  const transactionUnitPrice = slotTransactions > 0
    ? Math.round(slotSales / slotTransactions)
    : 0;

  const averagePartySize = slotTransactions > 0
    ? Number((slotCustomers / slotTransactions).toFixed(1))
    : 0;

  return {
    label,
    showLabel: shouldShowLabel,
    value: slotSales,
    totalHeight: finalMax > 0 ? (slotSales / finalMax) * 100 : 0,
    stacks,
    metrics: {
      sales: slotSales,
      customers: slotCustomers,
      customerUnitPrice,
      transactionUnitPrice,
      averagePartySize
    }
  };
  });

    const weeklyRange = buildWeeklyComparisonRange(currentDate);

  const weeklyDifference = weeklyCurrentSales - weeklyPreviousSales;
  const weeklyRate = weeklyPreviousSales > 0
    ? Number(((weeklyCurrentSales / weeklyPreviousSales) * 100).toFixed(1))
    : null;

  const weeklyCurrentCustomers = sumSessionGuestCounts(weeklyCurrentSessionGuestCounts);
  const weeklyPreviousCustomers = sumSessionGuestCounts(weeklyPreviousSessionGuestCounts);
  const weeklyCurrentTransactions = weeklyCurrentSessionKeys.size;
  const weeklyPreviousTransactions = weeklyPreviousSessionKeys.size;

  const weeklyComparison = {
    currentSales: weeklyCurrentSales,
    previousSales: weeklyPreviousSales,
    difference: weeklyDifference,
    rate: weeklyRate,

    currentCustomers: weeklyCurrentCustomers,
    previousCustomers: weeklyPreviousCustomers,
    currentTransactions: weeklyCurrentTransactions,
    previousTransactions: weeklyPreviousTransactions,

    currentCustomerUnitPrice: weeklyCurrentCustomers > 0
      ? Math.round(weeklyCurrentSales / weeklyCurrentCustomers)
      : 0,
    previousCustomerUnitPrice: weeklyPreviousCustomers > 0
      ? Math.round(weeklyPreviousSales / weeklyPreviousCustomers)
      : 0,

    currentTransactionUnitPrice: weeklyCurrentTransactions > 0
      ? Math.round(weeklyCurrentSales / weeklyCurrentTransactions)
      : 0,
    previousTransactionUnitPrice: weeklyPreviousTransactions > 0
      ? Math.round(weeklyPreviousSales / weeklyPreviousTransactions)
      : 0,

    ...weeklyRange
  };

  return {
    totalSales,
    totalOrders,
    customerCount,
    averageSpendPerCustomer,
    averageSpendPerTransaction,
    averagePartySize,
    weeklyComparison,
    itemRanking,
    abcAnalysis: {
      items: abcItems,
      summary: abcSummary,
      totalSales: abcTotalSales
    },
    chartData,
    maxChartValue: finalMax,
    yAxisTicks,
    granularity: currentGranularity
  };
};