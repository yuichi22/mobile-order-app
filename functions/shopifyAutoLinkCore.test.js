import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexShopifyVariantsByBarcode, planBarcodeAutoLinks } from './shopifyAutoLinkCore.js';

const v = (barcode, n, status = 'ACTIVE') => ({
  barcode,
  productId: `gid://shopify/Product/${n}`,
  variantId: `gid://shopify/ProductVariant/${n}`,
  inventoryItemId: `gid://shopify/InventoryItem/${n}`,
  productStatus: status
});

test('バーコードで引ける・非公開とバーコード重複は使わない', () => {
  const { byBarcode, ambiguous } = indexShopifyVariantsByBarcode([
    v('111', 1), v('222', 2), v('222', 3), v('333', 4, 'ARCHIVED'), v('', 5), v('444', 6, 'DRAFT')
  ]);
  assert.equal(byBarcode.get('111').inventoryItemId, 'gid://shopify/InventoryItem/1');
  assert.equal(byBarcode.has('222'), false);
  assert.ok(ambiguous.has('222'));
  assert.equal(byBarcode.has('333'), false);
  assert.equal(byBarcode.get('444').status, 'DRAFT');
});

test('非公開の古い商品と同じバーコードでも、公開中が1つならそれにひも付く', () => {
  const { byBarcode } = indexShopifyVariantsByBarcode([v('111', 1, 'ARCHIVED'), v('111', 2)]);
  assert.equal(byBarcode.get('111').variantId, 'gid://shopify/ProductVariant/2');
});

test('未ひも付けの商品だけをひも付ける', () => {
  const { byBarcode } = indexShopifyVariantsByBarcode([v('111', 1), v('222', 2), v('555', 5)]);
  const { links, skipped } = planBarcodeAutoLinks({
    byBarcode,
    products: [
      { id: 'a', barcode: '111' },
      { id: 'b', barcode: '222', shopifyInventoryItemId: 'gid://shopify/InventoryItem/2' },
      { id: 'c', barcode: '999' },
      { id: 'd', barcode: '' },
      { id: 'e', barcode: '555', shopifyInventorySyncDisabled: true }
    ]
  });
  assert.deepEqual(links.map((l) => l.productId), ['a']);
  assert.equal(links[0].inventoryItemId, 'gid://shopify/InventoryItem/1');
  assert.deepEqual(skipped, { duplicateInPos: 0, itemAlreadyLinked: 0 });
});

test('レジ側のバーコード重複・ほかの商品にひも付き済みの在庫アイテムは使わない', () => {
  const { byBarcode } = indexShopifyVariantsByBarcode([v('111', 1), v('222', 2)]);
  const { links, skipped } = planBarcodeAutoLinks({
    byBarcode,
    products: [
      { id: 'a', barcode: '111' },
      { id: 'b', barcode: '111' },
      { id: 'c', barcode: '222' },
      { id: 'd', barcode: 'old', shopifyInventoryItemId: 'gid://shopify/InventoryItem/2' }
    ]
  });
  assert.equal(links.length, 0);
  assert.deepEqual(skipped, { duplicateInPos: 2, itemAlreadyLinked: 1 });
});
