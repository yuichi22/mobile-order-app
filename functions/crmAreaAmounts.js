// crmAreaAmounts.js
// 会計の金額を売り場ごとに分ける(Core の「売り場限定ポイントアップ」で、対象売り場の分だけ倍率をかけるため)。
// 明細の定価合計の比で会計金額(税込・値引後)を按分する。端数は最後の売り場で合わせ、合計は会計金額と一致する。
// 売り場の無い明細(飲食など)の分は含めない(=倍率の対象外の通常ポイント)。
const str = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {Array} items 会計の明細(tx.items)
 * @param {number} amount 会計金額(税込・値引後。返品はマイナス)
 * @returns {Array<{name:string, amount:number}>} 売り場ごとの金額。按分できないときは空
 */
export function splitAmountBySalesArea(items, amount) {
  const total = num(amount);
  if (!total || !Array.isArray(items)) return [];
  const gross = new Map(); // 売り場名 → 定価合計
  let grossAll = 0;
  for (const it of items) {
    const line = num(it?.unitPrice ?? it?.price) * (num(it?.quantity) || 1);
    if (line <= 0) continue;
    grossAll += line;
    const name = str(it?.salesAreaName);
    if (name) gross.set(name, (gross.get(name) || 0) + line);
  }
  if (grossAll <= 0 || gross.size === 0) return [];
  const areas = [...gross.entries()].slice(0, 20);
  const areaGross = areas.reduce((s, [, g]) => s + g, 0);
  // 売り場のある明細の合計(按分後)。端数はここに合わせる
  const areaTotal = Math.round(total * areaGross / grossAll);
  let rest = areaTotal;
  return areas.map(([name, g], i) => {
    const a = i === areas.length - 1 ? rest : Math.round(total * g / grossAll);
    rest -= a;
    return { name, amount: a };
  });
}
