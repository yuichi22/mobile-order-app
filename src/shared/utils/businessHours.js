export const BUSINESS_DAY_OPTIONS = [
  { key: 'sun', label: '日' },
  { key: 'mon', label: '月' },
  { key: 'tue', label: '火' },
  { key: 'wed', label: '水' },
  { key: 'thu', label: '木' },
  { key: 'fri', label: '金' },
  { key: 'sat', label: '土' }
];

const DEFAULT_DAY_VALUE = {
  isOpen: true,
  open: '09:00',
  close: '21:00'
};

export const createDefaultBusinessHours = () => BUSINESS_DAY_OPTIONS.reduce(
  (result, day) => ({
    ...result,
    [day.key]: { ...DEFAULT_DAY_VALUE }
  }),
  {}
);

export const DEFAULT_BUSINESS_SETTINGS = {
  businessHours: createDefaultBusinessHours(),
  lastOrderMinutesBeforeClose: 30,
  orderFlow: 'postpay'
};

export const normalizeBusinessSettings = (settings = {}) => {
  const businessHours = createDefaultBusinessHours();
  const normalizedLastOrder = Number(settings?.lastOrderMinutesBeforeClose);

  BUSINESS_DAY_OPTIONS.forEach(({ key }) => {
    const nextValue = settings?.businessHours?.[key] || {};
    businessHours[key] = {
      isOpen: typeof nextValue.isOpen === 'boolean' ? nextValue.isOpen : DEFAULT_DAY_VALUE.isOpen,
      open: nextValue.open || DEFAULT_DAY_VALUE.open,
      close: nextValue.close || DEFAULT_DAY_VALUE.close
    };
  });

  const orderFlow = settings?.orderFlow === 'prepay' ? 'prepay' : 'postpay';

  return {
    businessHours,
    lastOrderMinutesBeforeClose: Number.isFinite(normalizedLastOrder) && normalizedLastOrder >= 0
      ? normalizedLastOrder
      : DEFAULT_BUSINESS_SETTINGS.lastOrderMinutesBeforeClose,
    orderFlow
  };

};

export const parseTimeToMinutes = (timeString) => {
  const [hourText = '0', minuteText = '0'] = String(timeString || '0:0').split(':');
  return (Number(hourText) * 60) + Number(minuteText);
};

const setDateMinutes = (baseDate, minutes) => {
  const nextDate = new Date(baseDate);
  nextDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return nextDate;
};

const buildWindow = (baseDate, dayConfig) => {
  if (!dayConfig?.isOpen) return null;

  const startMinutes = parseTimeToMinutes(dayConfig.open);
  const endMinutes = parseTimeToMinutes(dayConfig.close);
  const startAt = setDateMinutes(baseDate, startMinutes);
  const endAt = setDateMinutes(baseDate, endMinutes);

  if (endMinutes <= startMinutes) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return {
    startAt,
    endAt,
    open: dayConfig.open,
    close: dayConfig.close
  };
};

const getDayKey = (date) => BUSINESS_DAY_OPTIONS[date.getDay()]?.key || 'sun';

const resolveCurrentWindow = (businessHours, now) => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const yesterdayWindow = buildWindow(yesterday, businessHours[getDayKey(yesterday)]);
  if (yesterdayWindow && now >= yesterdayWindow.startAt && now < yesterdayWindow.endAt) {
    return yesterdayWindow;
  }

  const todayWindow = buildWindow(today, businessHours[getDayKey(today)]);
  if (todayWindow && now >= todayWindow.startAt && now < todayWindow.endAt) {
    return todayWindow;
  }

  return null;
};

const formatShortTime = (date) => date.toLocaleTimeString('ja-JP', {
  hour: '2-digit',
  minute: '2-digit'
});

export const getBusinessStatus = (settings, now = new Date()) => {
  const { businessHours, lastOrderMinutesBeforeClose } = normalizeBusinessSettings(settings);
  const todayKey = getDayKey(now);
  const todayConfig = businessHours[todayKey];
  const activeWindow = resolveCurrentWindow(businessHours, now);

  if (!activeWindow) {
    return {
      isOpen: false,
      isTakingOrders: false,
      status: todayConfig?.isOpen === false ? 'closed-day' : 'closed',
      message: todayConfig?.isOpen === false ? '本日は定休日です' : '営業時間外',
      detail: todayConfig?.isOpen === false
        ? '営業日にあらためてご利用ください。'
        : `営業時間 ${todayConfig?.open || '09:00'} - ${todayConfig?.close || '21:00'}`,
      closeAt: null
    };
  }

  const closeAt = activeWindow.endAt;
  const lastOrderAt = new Date(closeAt.getTime() - (lastOrderMinutesBeforeClose * 60 * 1000));

  if (now >= lastOrderAt) {
    return {
      isOpen: true,
      isTakingOrders: false,
      status: 'last-order-closed',
      message: 'ラストオーダー終了後です',
      detail: `本日の営業は ${formatShortTime(closeAt)} までです。`,
      closeAt
    };
  }

  return {
    isOpen: true,
    isTakingOrders: true,
    status: 'open',
    message: 'ただいま営業中です',
    detail: `ラストオーダーは ${formatShortTime(lastOrderAt)} です。`,
    closeAt
  };
};
