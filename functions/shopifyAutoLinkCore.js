// 夜間の在庫点検で、Shopify とまだひも付いていないレジ商品をバーコードで自動ひも付けする純粋関数。
// POS で「新商品」として登録し、Shopify 側に手で variant を足したものは、ひも付け(shopifyInventoryItemId)が
// 無いため在庫が同期されなかった(2026-11-24 報告)。どちらの数が正しいか分からないので、ひも付けた商品は
// 数が一致するまで自動補正・在庫の送受信をせず、差分一覧で人が決める(2026-11-24 石原さん決定)。

const text = (value) => String(value ?? '').trim();

// Shopify の variant 一覧から「バーコード → variant」を作る。非公開(ARCHIVED)の商品は候補にしない。
// 同じバーコードが2つ以上あるものはどれか決められないので ambiguous に入れて使わない。
export const indexShopifyVariantsByBarcode = (variants = []) => {
  const byBarcode = new Map();
  const ambiguous = new Set();
  for (const variant of variants) {
    const barcode = text(variant?.barcode);
    const inventoryItemId = text(variant?.inventoryItemId);
    if (!barcode || !inventoryItemId) continue;
    if (text(variant?.productStatus).toUpperCase() === 'ARCHIVED') continue;
    if (byBarcode.has(barcode)) {
      ambiguous.add(barcode);
      continue;
    }
    byBarcode.set(barcode, {
      shopifyProductId: text(variant?.productId),
      variantId: text(variant?.variantId),
      inventoryItemId,
      status: text(variant?.productStatus).toUpperCase()
    });
  }
  for (const barcode of ambiguous) byBarcode.delete(barcode);
  return { byBarcode, ambiguous };
};

// レジ商品のうち、自動でひも付けてよいものを決める。
// products: { id, barcode, shopifyInventoryItemId, shopifyInventorySyncDisabled }
// - すでにひも付いている商品・在庫同期 OFF の商品・バーコードの無い商品は対象外
// - レジ側に同じバーコードの未ひも付け商品が2つ以上あるときは対象外
// - その在庫アイテムに、この店舗の別の商品がもうひも付いているときは対象外(通知が片方にしか届かないため)
export const planBarcodeAutoLinks = ({ products = [], byBarcode = new Map() }) => {
  const linkedItemIds = new Set(products.map((p) => text(p?.shopifyInventoryItemId)).filter(Boolean));
  const unlinkedByBarcode = new Map();
  for (const product of products) {
    if (text(product?.shopifyInventoryItemId)) continue;
    if (product?.shopifyInventorySyncDisabled === true) continue;
    const barcode = text(product?.barcode);
    if (!barcode || !byBarcode.has(barcode)) continue;
    const list = unlinkedByBarcode.get(barcode) || [];
    list.push(product);
    unlinkedByBarcode.set(barcode, list);
  }

  const links = [];
  const skipped = { duplicateInPos: 0, itemAlreadyLinked: 0 };
  for (const [barcode, list] of unlinkedByBarcode) {
    if (list.length > 1) { skipped.duplicateInPos += list.length; continue; }
    const target = byBarcode.get(barcode);
    if (linkedItemIds.has(target.inventoryItemId)) { skipped.itemAlreadyLinked += 1; continue; }
    linkedItemIds.add(target.inventoryItemId);
    links.push({ ...target, productId: text(list[0].id), barcode });
  }
  return { links, skipped };
};
