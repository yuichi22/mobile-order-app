import test from "node:test";
import assert from "node:assert/strict";
import { splitAmountBySalesArea } from "./crmAreaAmounts.js";

test("売り場ごとに会計金額を按分し、売り場の無い明細は含めない", () => {
  const items = [
    { price: 1000, quantity: 2, salesAreaName: "雑貨" },
    { price: 500, quantity: 1, salesAreaName: "食品" },
    { price: 500, quantity: 1, salesAreaName: "" },
  ];
  // 定価 3000 → 値引後 2700
  assert.deepEqual(splitAmountBySalesArea(items, 2700), [
    { name: "雑貨", amount: 1800 },
    { name: "食品", amount: 450 },
  ]);
});

test("同じ売り場はまとめ、端数を合わせる", () => {
  const items = [
    { unitPrice: 333, quantity: 1, salesAreaName: "A" },
    { unitPrice: 333, quantity: 1, salesAreaName: "B" },
    { unitPrice: 334, quantity: 1, salesAreaName: "A" },
  ];
  const r = splitAmountBySalesArea(items, 999);
  assert.equal(r.reduce((s, x) => s + x.amount, 0), 999);
  assert.deepEqual(r.map((x) => x.name), ["A", "B"]);
});

test("返品(マイナス)も按分する", () => {
  const items = [{ price: 1000, quantity: 1, salesAreaName: "雑貨" }];
  assert.deepEqual(splitAmountBySalesArea(items, -1000), [{ name: "雑貨", amount: -1000 }]);
});

test("売り場が無い・金額0・明細なしは空", () => {
  assert.deepEqual(splitAmountBySalesArea([{ price: 1000, quantity: 1 }], 1000), []);
  assert.deepEqual(splitAmountBySalesArea([{ price: 1000, salesAreaName: "A" }], 0), []);
  assert.deepEqual(splitAmountBySalesArea(null, 1000), []);
});
