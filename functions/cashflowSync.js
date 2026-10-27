// cashflowSync.js
// AKUTO 資金繰り(akuto-cashflow-app)へ、POS の発注と仕入先を送る。
// - 発注書(stores/{id}/purchaseOrders)が書き換わったら、発注書と入庫(stockIns)と仕入先の写しを receivePosPurchaseOrder へ。
//   資金繰り側が仕入先の支払条件で支払予定(未入荷・入荷済み)を作り直す
// - 発注書を通さない入庫(stockIns に purchaseOrderId が無いもの: 商品マスター入庫・棚卸し中入庫)は
//   入庫ごとに receivePosStockIn へ。単価は入庫ロット原価(costLayers、無ければ今の原価連鎖)の税抜
// - 仕入先(stores/{id}/suppliers)が書き換わったら receivePosSupplier へ。資金繰り側が取引先へ取り込む
//   （支払いサイト paymentTerms から支払条件を読む）
// - 送り先: CASHFLOW_FUNCTIONS_URL（資金繰りの Functions の URL の共通部分。末尾に関数名を付ける）。未設定なら何もしない
// - 認証: Authorization: Bearer <CORE_SALES_SECRET>（資金繰り側は CORE_PROVISION_SECRET。どちらも Core の CRM_WEBHOOK_SECRET と同値運用）
// - 店舗の対応付けは資金繰り側が持つ（Core のポータル連携で拠点に POS の storeId が入る）。結び付いていない店舗は linked:false が返るだけ
// - 冪等: 毎回その発注書の全体(明細＋全入庫)を送り、資金繰り側が作り直す。送り損ねても次の書き換えか手動の再送で追いつく
// - 入庫は stockIns を先に書き、最後に発注書の lines を書くため（storeDataService.receivePurchaseOrderLines）、
//   発注書のトリガーの時点で入庫は揃っている
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { resolveCurrentUnitCost } from "./costLayers.js";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// JSTの YYYY-MM-DD
const jstDate = (date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// 'YYYY-MM-DD' / ISO 文字列 / Timestamp を JST の日付に。読めなければ null
function toJstDate(v) {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : jstDate(d);
}

// 1個あたりの税抜仕入概算。発注時の estimatedUnitCost、無ければ estimatedAmount ÷ 数量
function unitCostOf(line) {
  if (line.estimatedUnitCost !== null && line.estimatedUnitCost !== undefined && Number.isFinite(Number(line.estimatedUnitCost))) {
    return Math.max(Number(line.estimatedUnitCost), 0);
  }
  const qty = num(line.qty);
  return qty > 0 ? Math.max(num(line.estimatedAmount) / qty, 0) : 0;
}

// 資金繰りへ送る仕入先の項目（POS の仕入先マスタから、支払いと連絡に要るものだけ）
const supplierPayload = (supplierId, s) => ({
  supplierId,
  name: str(s.name),
  kana: str(s.kana),
  contactName: str(s.contactName),
  tel: str(s.tel),
  email: str(s.email),
  paymentTerms: str(s.paymentTerms),
});

async function buildPayload(storeId, poId, po) {
  if (!po) return { storeId, poId, deleted: true };
  const supplierId = str(po.supplierId);
  const [stockIns, supplier] = await Promise.all([
    db.collection(`stores/${storeId}/stockIns`).where("purchaseOrderId", "==", poId).get(),
    supplierId ? db.doc(`stores/${storeId}/suppliers/${supplierId}`).get() : null,
  ]);
  return {
    ...(supplier?.exists ? { supplier: supplierPayload(supplierId, supplier.data()) } : {}),
    storeId,
    poId,
    po: {
      supplierId: str(po.supplierId),
      supplierName: str(po.supplierName),
      status: str(po.status),
      orderedDate: toJstDate(po.orderedAt) || toJstDate(po.createdAt) || jstDate(new Date()),
      eta: toJstDate(po.eta),
      lines: (po.lines || []).map((line) => ({
        productId: str(line.productId),
        qty: num(line.qty),
        unitCost: unitCostOf(line),
        canceled: Boolean(line.canceled),
        eta: toJstDate(line.eta),
      })),
    },
    receipts: stockIns.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.type === "stock_in" || s.type === undefined)
      .map((s) => ({
        id: s.id,
        productId: str(s.productId),
        quantity: num(s.quantity),
        date: toJstDate(s.createdAt) || jstDate(new Date()),
      })),
  };
}

const isDirectStockIn = (s) => s && (s.type === "stock_in" || s.type === undefined) && !s.purchaseOrderId;

const positive = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

// 原価(税抜)が 0 や未設定の商品は、税抜定価 × 掛け率(商品 > ブランド > 仕入先 > 売り場)で出す。
// resolveCurrentUnitCost は原価 0 を「原価 0」として扱うため、資金繰り向けにはここで掛け率へ回す
async function rateBasedUnitCost(storeRef, product, brand, supplier) {
  let rate = positive(product.supplierCostRate) ?? positive(brand?.defaultCostRate) ?? positive(supplier?.defaultCostRate);
  if (rate === null && product.salesAreaId) {
    const area = await storeRef.collection("productSalesAreas").doc(String(product.salesAreaId)).get();
    rate = positive(area.exists ? area.data().costRate : null);
  }
  const price = positive(product.priceTaxExcluded);
  return rate !== null && price !== null ? Math.round((price * Math.min(rate, 100)) / 100) : null;
}

// 発注書なしの入庫1件。仕入先は商品(無ければブランド)の仕入先
async function buildStockInPayload(storeId, stockInId, s) {
  if (!isDirectStockIn(s)) return { storeId, stockInId, deleted: true };
  const productId = str(s.productId).replace(/^product:/, "");
  const storeRef = db.collection("stores").doc(storeId);
  const productSnap = productId ? await storeRef.collection("products").doc(productId).get() : null;
  const product = productSnap?.exists ? productSnap.data() : {};
  const brandSnap = product.brandId ? await storeRef.collection("brands").doc(String(product.brandId)).get() : null;
  const brand = brandSnap?.exists ? brandSnap.data() : null;
  const supplierId = str(product.supplierId) || str(brand?.supplierId);
  const [layer, supplier] = await Promise.all([
    productId ? storeRef.collection("products").doc(productId).collection("costLayers").doc(stockInId).get() : null,
    supplierId ? storeRef.collection("suppliers").doc(supplierId).get() : null,
  ]);
  // 入庫ロットの原価(入庫時点) → 今の原価連鎖 → 掛け率、の順に、0 より大きいものを使う
  const unitCost =
    positive(layer?.exists ? layer.data().unitCostTaxExcluded : null) ??
    positive((await resolveCurrentUnitCost(storeRef, product))?.unitCostTaxExcluded) ??
    (await rateBasedUnitCost(storeRef, product, brand, supplier?.exists ? supplier.data() : null));
  return {
    storeId,
    stockInId,
    stockIn: {
      supplierId,
      supplierName: str(supplier?.exists ? supplier.data().name : product.supplierName),
      productName: str(product.name),
      quantity: num(s.quantity),
      // null は原価を出せなかった入庫(資金繰り側で「原価不明」に数える)
      unitCost,
      date: toJstDate(s.createdAt) || jstDate(new Date()),
    },
    ...(supplier?.exists ? { supplier: supplierPayload(supplierId, supplier.data()) } : {}),
  };
}

const cashflowBase = () => str(process.env.CASHFLOW_FUNCTIONS_URL).replace(/\/+$/, "");

async function postToCashflow(fn, payload) {
  const base = cashflowBase();
  const secret = str(process.env.CORE_SALES_SECRET);
  if (!base || !secret) return { skipped: "unconfigured" };
  const res = await fetch(`${base}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(`cashflow ${res.status}: ${body?.error || ""}`);
  return body;
}

export const syncPurchaseOrderToCashflow = onDocumentWritten(
  { region: REGION, database: DB_ID, document: "stores/{storeId}/purchaseOrders/{poId}" },
  async (event) => {
    if (!cashflowBase()) return;
    const { storeId, poId } = event.params;
    const after = event.data?.after;
    try {
      const result = await postToCashflow("receivePosPurchaseOrder", await buildPayload(storeId, poId, after?.exists ? after.data() : null));
      if (result?.linked === false) return; // 資金繰りを使っていない店舗
      console.log(`[cashflowSync] ${storeId}/${poId} → 資金繰り`, result);
    } catch (e) {
      // 再試行はしない（次の書き換えか resyncToCashflow で追いつく）
      console.error(`[cashflowSync] ${storeId}/${poId} の送信に失敗`, e);
    }
  }
);

export const syncStockInToCashflow = onDocumentWritten(
  { region: REGION, database: DB_ID, document: "stores/{storeId}/stockIns/{stockInId}" },
  async (event) => {
    if (!cashflowBase()) return;
    const { storeId, stockInId } = event.params;
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    // 発注入庫は発注書の側で送る。直接入庫だったことが一度も無ければ何もしない
    if (!isDirectStockIn(before) && !isDirectStockIn(after)) return;
    try {
      const result = await postToCashflow("receivePosStockIn", await buildStockInPayload(storeId, stockInId, after));
      if (result?.linked === false) return;
      console.log(`[cashflowSync] 入庫 ${storeId}/${stockInId} → 資金繰り`, result);
    } catch (e) {
      console.error(`[cashflowSync] 入庫 ${storeId}/${stockInId} の送信に失敗`, e);
    }
  }
);

export const syncSupplierToCashflow = onDocumentWritten(
  { region: REGION, database: DB_ID, document: "stores/{storeId}/suppliers/{supplierId}" },
  async (event) => {
    if (!cashflowBase()) return;
    const { storeId, supplierId } = event.params;
    const before = event.data?.before?.exists ? supplierPayload(supplierId, event.data.before.data()) : null;
    const after = event.data?.after?.exists ? supplierPayload(supplierId, event.data.after.data()) : null;
    // 資金繰りに関係しない項目（掛け率・最低発注金額など）だけの変更は送らない
    if (before && after && JSON.stringify(before) === JSON.stringify(after)) return;
    try {
      const result = await postToCashflow(
        "receivePosSupplier",
        after ? { storeId, supplier: after } : { storeId, supplierId, deleted: true }
      );
      if (result?.linked === false) return;
      console.log(`[cashflowSync] 仕入先 ${storeId}/${supplierId} → 資金繰り`, result);
    } catch (e) {
      console.error(`[cashflowSync] 仕入先 ${storeId}/${supplierId} の送信に失敗`, e);
    }
  }
);

// 手動の再送（つないだ直後の取り込みや、送り損ねの回復用）。資金繰りと同じ Bearer で保護。
// body: { storeId, since: 'YYYY-MM-DD' }  その店の仕入先をすべてと、since 以降に作った発注書・発注書なしの入庫を送り直す
export const resyncToCashflow = onRequest({ region: REGION, timeoutSeconds: 540 }, async (req, res) => {
  const secret = str(process.env.CORE_SALES_SECRET);
  const authz = req.get("authorization") || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!secret || bearer !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const storeId = str(req.body?.storeId);
  const since = str(req.body?.since);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(storeId) || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    res.status(400).json({ error: "storeId と since(YYYY-MM-DD) を指定してください" });
    return;
  }
  const failed = [];
  const suppliers = await db.collection(`stores/${storeId}/suppliers`).get();
  let suppliersSent = 0;
  for (const d of suppliers.docs) {
    if (d.data().isActive === false) continue;
    try {
      const result = await postToCashflow("receivePosSupplier", { storeId, supplier: supplierPayload(d.id, d.data()) });
      if (result?.linked === false) {
        res.json({ ok: true, linked: false });
        return;
      }
      suppliersSent += 1;
    } catch (e) {
      failed.push({ supplierId: d.id, error: String(e?.message || e) });
    }
  }
  const sinceDate = new Date(`${since}T00:00:00+09:00`);
  const pos = await db.collection(`stores/${storeId}/purchaseOrders`).where("createdAt", ">=", sinceDate).get();
  let sent = 0;
  for (const d of pos.docs) {
    try {
      await postToCashflow("receivePosPurchaseOrder", await buildPayload(storeId, d.id, d.data()));
      sent += 1;
    } catch (e) {
      failed.push({ poId: d.id, error: String(e?.message || e) });
    }
  }
  const stockIns = await db.collection(`stores/${storeId}/stockIns`).where("createdAt", ">=", sinceDate).get();
  let stockInsSent = 0;
  for (const d of stockIns.docs) {
    if (!isDirectStockIn(d.data())) continue;
    try {
      await postToCashflow("receivePosStockIn", await buildStockInPayload(storeId, d.id, d.data()));
      stockInsSent += 1;
    } catch (e) {
      failed.push({ stockInId: d.id, error: String(e?.message || e) });
    }
  }
  res.json({ ok: failed.length === 0, suppliersSent, sent, stockInsSent, failed });
});
