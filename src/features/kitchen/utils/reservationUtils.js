/**
 * 予約品（クリスマスケーキ等）の予約一覧で使う集計。
 *
 * ⚠ 日付は日本時間の YYYY-MM-DD（createTakeoutOrder が pickupDate に入れる値と同じ）。
 */

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const jstDateKey = (date = new Date()) => {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}`;
};

/** "2026-12-24" から n 日ずらした日付キー */
export const shiftDateKey = (dateKey, days) => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** "2026-12-24" → "12/24(木)" */
export const formatDateKey = (dateKey) => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey || '';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
};

const toDate = (value) => (
  value?.toDate ? value.toDate() : value instanceof Date ? value : null
);

/** 受取時刻 "HH:MM"（日本時間） */
export const pickupTimeLabel = (value) => {
  const date = toDate(value);
  if (!date) return '--:--';
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
};

const cleanName = (name) => String(name || '').replace(/\s*\n\s*/g, ' ');

/** 予約の注文は、Webからのテイクアウトのうち isReservation が真のもの */
export const isReservationOrder = (order) => order?.isReservation === true;

/**
 * キッチンのサイドバーに出すテイクアウト注文。
 * ⚠ 予約品の注文は受取当日（と、渡し忘れの過去分）だけ出す。
 *   数日前に受けたものが「いま作るもの」と並ぶと当日の即時オーダーが埋もれるため。
 */
export const splitTakeoutForKitchen = (takeoutOrders = [], todayKey) => {
  const regular = [];
  const reservationToday = [];
  let reservationUpcoming = 0;
  takeoutOrders.forEach((order) => {
    if (!isReservationOrder(order)) {
      regular.push(order);
      return;
    }
    const key = String(order.pickupDate || '');
    if (key && key > todayKey) {
      reservationUpcoming += 1;
      return;
    }
    reservationToday.push(order);
  });
  return { regular, reservationToday, reservationUpcoming };
};

/**
 * 受取日ごとの一覧（日付タブ用）。取消は数えない。
 * @returns [{ dateKey, orderCount, itemCount, handedCount }]
 */
export const summarizeDays = (orders = []) => {
  const map = new Map();
  orders.forEach((order) => {
    if (order.status === 'cancelled') return;
    const key = String(order.pickupDate || '');
    if (!key) return;
    const row = map.get(key) || { dateKey: key, orderCount: 0, itemCount: 0, handedCount: 0 };
    row.orderCount += 1;
    row.itemCount += (order.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    if (order.status === 'handed') row.handedCount += 1;
    map.set(key, row);
  });
  return [...map.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
};

/**
 * 1日分の仕込み表。
 * @returns {
 *   items: [{ menuItemId, name, quantity, isReservation }],   // 品目ごとの合計（多い順ではなく予約品→その他、名前順）
 *   slots: [{ time, orderCount, lines: [{ name, quantity }] }],  // 受取時刻ごと
 *   orders: [...]                                               // 受取時刻順（取消は末尾）
 * }
 */
export const buildPrepSheet = (orders = [], dateKey) => {
  const dayOrders = orders.filter((o) => String(o.pickupDate || '') === dateKey);
  const active = dayOrders.filter((o) => o.status !== 'cancelled');

  const itemMap = new Map();
  const slotMap = new Map();
  active.forEach((order) => {
    const time = pickupTimeLabel(order.pickupAt);
    const slot = slotMap.get(time) || { time, orderCount: 0, lineMap: new Map() };
    slot.orderCount += 1;
    (order.items || []).forEach((item) => {
      const id = String(item.menuItemId || item.name || '');
      const quantity = Number(item.quantity) || 0;
      const row = itemMap.get(id) || {
        menuItemId: item.menuItemId || '',
        name: cleanName(item.name),
        quantity: 0,
        isReservation: item.isReservation === true
      };
      row.quantity += quantity;
      itemMap.set(id, row);
      slot.lineMap.set(id, {
        name: cleanName(item.name),
        quantity: (slot.lineMap.get(id)?.quantity || 0) + quantity
      });
    });
    slotMap.set(time, slot);
  });

  const items = [...itemMap.values()].sort((a, b) => {
    if (a.isReservation !== b.isReservation) return a.isReservation ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
  const slots = [...slotMap.values()]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map(({ lineMap, ...rest }) => ({ ...rest, lines: [...lineMap.values()] }));

  const sortedOrders = [...dayOrders].sort((a, b) => {
    const ac = a.status === 'cancelled' ? 1 : 0;
    const bc = b.status === 'cancelled' ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return (toDate(a.pickupAt)?.getTime() || 0) - (toDate(b.pickupAt)?.getTime() || 0);
  });

  return { items, slots, orders: sortedOrders };
};
