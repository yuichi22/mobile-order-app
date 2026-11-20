import test from "node:test";
import assert from "node:assert/strict";
import {
  jstDateKey,
  isDateKey,
  reservationRule,
  checkReservation,
  reservationIncrements,
  fullDatesFor,
} from "./takeoutReservation.js";

test("日本時間の暦日で判定する（UTCでは前日の15:00以降が翌日）", () => {
  assert.equal(jstDateKey(new Date("2026-12-23T14:59:00Z")), "2026-12-23");
  assert.equal(jstDateKey(new Date("2026-12-23T15:00:00Z")), "2026-12-24");
});

test("日付の形式チェック", () => {
  assert.equal(isDateKey("2026-12-24"), true);
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2026/12/24"), false);
  assert.equal(isDateKey(""), false);
});

test("予約品でない品は null", () => {
  assert.equal(reservationRule({}), null);
  assert.equal(reservationRule({ webOrderReservation: false }), null);
});

test("予約品の決まりを取り出す。上限0や空は「上限なし」", () => {
  assert.deepEqual(
    reservationRule({
      webOrderReservation: true,
      reservationPickupFrom: "2026-12-22",
      reservationPickupTo: "2026-12-25",
      reservationDailyLimit: 30,
    }),
    { from: "2026-12-22", to: "2026-12-25", dailyLimit: 30, invalid: false }
  );
  assert.equal(
    reservationRule({
      webOrderReservation: true,
      reservationPickupFrom: "2026-12-22",
      reservationPickupTo: "2026-12-25",
      reservationDailyLimit: 0,
    }).dailyLimit,
    null
  );
});

test("期間が壊れている予約品は invalid（受けない側に倒す）", () => {
  const rule = reservationRule({
    webOrderReservation: true,
    reservationPickupFrom: "2026-12-25",
    reservationPickupTo: "2026-12-22",
  });
  assert.equal(rule.invalid, true);
  const r = checkReservation([{ menuItemId: "cake", name: "ケーキ", quantity: 1, rule }], "2026-12-24");
  assert.equal(r.error, "reservation_not_configured");
});

const cake = {
  menuItemId: "cake",
  name: "苺のショートケーキ",
  quantity: 2,
  rule: { from: "2026-12-22", to: "2026-12-25", dailyLimit: 30, invalid: false },
};
const chicken = { menuItemId: "chicken", name: "チキン南蛮", quantity: 1, rule: null };

test("期間外の受取日は断る", () => {
  const r = checkReservation([cake], "2026-12-26");
  assert.equal(r.ok, false);
  assert.equal(r.error, "pickup_outside_reservation_period");
  assert.equal(r.name, "苺のショートケーキ");
});

test("期間内で上限に余裕があれば通す。予約品でない品は数えない", () => {
  assert.deepEqual(checkReservation([cake, chicken], "2026-12-24", { cake: 28 }), { ok: true });
});

test("上限を超える数は断り、残り数を返す", () => {
  const r = checkReservation([cake], "2026-12-24", { cake: 29 });
  assert.equal(r.error, "reservation_full");
  assert.equal(r.remaining, 1);
});

test("同じ品が2行に分かれていても合計で上限を見る", () => {
  const r = checkReservation([cake, { ...cake, quantity: 1 }], "2026-12-24", { cake: 28 });
  assert.equal(r.error, "reservation_full");
  assert.deepEqual(reservationIncrements([cake, { ...cake, quantity: 1 }, chicken]), { cake: 3 });
});

test("上限なしの予約品は数に関係なく通す", () => {
  const free = { ...cake, rule: { ...cake.rule, dailyLimit: null } };
  assert.deepEqual(checkReservation([free], "2026-12-24", { cake: 999 }), { ok: true });
});

test("埋まった日は期間内かつ上限に達した日だけ", () => {
  const days = [
    { date: "2026-12-21", counts: { cake: 99 } },
    { date: "2026-12-23", counts: { cake: 30 } },
    { date: "2026-12-24", counts: { cake: 29 } },
    { date: "2026-12-25", counts: { other: 50 } },
  ];
  assert.deepEqual(fullDatesFor("cake", cake.rule, days), ["2026-12-23"]);
  assert.deepEqual(fullDatesFor("cake", { ...cake.rule, dailyLimit: null }, days), []);
});

import {
  timeToMinutes,
  blockedDatesOf,
  normalizePickupWindows,
  pickupWindowsOf,
  checkBlockedDate,
  checkPickupTime,
} from "./takeoutReservation.js";

const DEFAULT_WINDOW = { fromMinutes: 11 * 60 + 30, toMinutes: 19 * 60 + 30 };

test("時刻の変換", () => {
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(timeToMinutes("24:00"), null);
  assert.equal(timeToMinutes("9:30"), null);
});

test("受付できない日は壊れた値を捨て、重複を除いて並べる", () => {
  assert.deepEqual(
    blockedDatesOf({ webOrderBlockedDates: ["2026-12-31", "bad", "2026-12-30", "2026-12-31"] }),
    ["2026-12-30", "2026-12-31"]
  );
  assert.deepEqual(blockedDatesOf({}), []);
});

test("受取時間帯は開始<終了だけ残し、早い順に並べる", () => {
  assert.deepEqual(
    normalizePickupWindows([
      { from: "15:00", to: "18:00" },
      { from: "10:00", to: "12:00" },
      { from: "13:00", to: "13:00" },
      { from: "x", to: "12:00" },
      { from: "10:00", to: "12:00" },
    ]),
    [
      { from: "10:00", to: "12:00" },
      { from: "15:00", to: "18:00" },
    ]
  );
});

test("受取時間帯は予約品のときだけ効く", () => {
  const w = [{ from: "10:00", to: "12:00" }];
  assert.deepEqual(pickupWindowsOf({ webOrderReservation: false, reservationPickupWindows: w }), []);
  assert.deepEqual(pickupWindowsOf({ webOrderReservation: true, reservationPickupWindows: w }), w);
});

test("カートのどれか1品でも受付できない日なら断る", () => {
  const lines = [
    { name: "ケーキ", blockedDates: [] },
    { name: "オードブル", blockedDates: ["2026-12-31"] },
  ];
  assert.deepEqual(checkBlockedDate(lines, "2026-12-30"), { ok: true });
  assert.equal(checkBlockedDate(lines, "2026-12-31").name, "オードブル");
});

test("時間帯の指定が無ければ店の既定で判定する", () => {
  const lines = [{ name: "チキン", pickupWindows: [] }];
  assert.equal(checkPickupTime(lines, 11 * 60 + 30, DEFAULT_WINDOW).ok, true);
  assert.equal(checkPickupTime(lines, 10 * 60, DEFAULT_WINDOW).error, "pickup_out_of_window");
});

test("予約品の時間帯は既定の代わりに使い、両端を含む。複数の品はすべての時間帯に入ること", () => {
  const cake = { name: "ケーキ", pickupWindows: [{ from: "10:00", to: "12:00" }, { from: "15:00", to: "18:00" }] };
  assert.equal(checkPickupTime([cake], 10 * 60, DEFAULT_WINDOW).ok, true); // 既定より早くても可
  assert.equal(checkPickupTime([cake], 12 * 60, DEFAULT_WINDOW).ok, true);
  assert.equal(checkPickupTime([cake], 13 * 60, DEFAULT_WINDOW).error, "pickup_out_of_item_window");
  const plate = { name: "オードブル", pickupWindows: [{ from: "16:00", to: "19:00" }] };
  assert.equal(checkPickupTime([cake, plate], 17 * 60, DEFAULT_WINDOW).ok, true);
  assert.equal(checkPickupTime([cake, plate], 11 * 60, DEFAULT_WINDOW).name, "オードブル");
});
