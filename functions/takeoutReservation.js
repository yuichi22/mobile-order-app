/**
 * テイクアウトの「予約品」（クリスマスケーキ等）の判定。純粋関数だけを置く（テストあり）。
 *
 * 予約品とは:
 *   ・受取日を期間で限定して受ける品（例: 12/22〜12/25 のみ受取）
 *   ・受取日ごとに作れる数の上限がある品（例: 1日30台まで）
 *
 * ⚠ 予約品を含む注文は、受取当日になるまでキッチンモニターに出さない。
 *   数日前に受けた注文が「いま作るもの」と並ぶと、当日の即時オーダーが埋もれるため。
 *   受取日ごとの集計（仕込み表・受け渡しチェック）は予約一覧で見る。
 *
 * ⚠ 受取日の判定は日本時間の暦日（YYYY-MM-DD）。サーバーのタイムゾーンに依存させない。
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, "0");

/** 日本時間の暦日を "YYYY-MM-DD" で返す。 */
export function jstDateKey(date) {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}`;
}

export function isDateKey(value) {
  if (typeof value !== "string" || !DATE_KEY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * メニューの品から予約品の決まりを取り出す。予約品でなければ null。
 * ⚠ 期間が壊れている（片方だけ・逆転）ものは予約品として扱わない＝受けない側に倒すため、
 *   呼び出し側は `invalid: true` を見て注文を止めること。
 */
export function reservationRule(menuData = {}) {
  if (menuData.webOrderReservation !== true) return null;
  const from = String(menuData.reservationPickupFrom || "");
  const to = String(menuData.reservationPickupTo || "");
  const limitRaw = Number(menuData.reservationDailyLimit);
  const dailyLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;
  if (!isDateKey(from) || !isDateKey(to) || from > to) {
    return { from, to, dailyLimit, invalid: true };
  }
  return { from, to, dailyLimit, invalid: false };
}

/**
 * 受取日が期間内か、上限を超えないかを確かめる。
 * @param lines   [{ menuItemId, name, quantity, rule }]（rule は reservationRule の戻り値）
 * @param pickupDate "YYYY-MM-DD"（日本時間）
 * @param counts  その受取日にすでに受けている数 { [menuItemId]: number }
 * @returns { ok: true } または { ok: false, error, name, remaining? }
 */
export function checkReservation(lines, pickupDate, counts = {}) {
  const totals = new Map();
  for (const line of lines) {
    if (!line.rule) continue;
    const { rule } = line;
    if (rule.invalid) return { ok: false, error: "reservation_not_configured", name: line.name };
    if (pickupDate < rule.from || pickupDate > rule.to) {
      return {
        ok: false,
        error: "pickup_outside_reservation_period",
        name: line.name,
        from: rule.from,
        to: rule.to,
      };
    }
    const prev = totals.get(line.menuItemId) || { quantity: 0, line };
    prev.quantity += Number(line.quantity) || 0;
    totals.set(line.menuItemId, prev);
  }

  for (const [menuItemId, { quantity, line }] of totals) {
    const limit = line.rule.dailyLimit;
    if (!limit) continue;
    const already = Math.max(Number(counts[menuItemId]) || 0, 0);
    if (already + quantity > limit) {
      return {
        ok: false,
        error: "reservation_full",
        name: line.name,
        remaining: Math.max(limit - already, 0),
      };
    }
  }
  return { ok: true };
}

/** 予約品の受取日ごとの数を、品目ごとに足し上げる（同じ品が2行に分かれていても1つにまとめる）。 */
export function reservationIncrements(lines) {
  const out = {};
  for (const line of lines) {
    if (!line.rule) continue;
    out[line.menuItemId] = (out[line.menuItemId] || 0) + (Number(line.quantity) || 0);
  }
  return out;
}

/**
 * サイトに返す「埋まった日」。上限のある品だけ。
 * @param rule reservationRule の戻り値
 * @param days [{ date, counts }]（reservationDays のドキュメント）
 */
export function fullDatesFor(menuItemId, rule, days = []) {
  if (!rule || rule.invalid || !rule.dailyLimit) return [];
  return days
    .filter((d) => d.date >= rule.from && d.date <= rule.to)
    .filter((d) => (Number(d.counts?.[menuItemId]) || 0) >= rule.dailyLimit)
    .map((d) => d.date)
    .sort();
}
