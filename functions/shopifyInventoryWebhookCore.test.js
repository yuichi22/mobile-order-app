import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryWebhookUri,
  classifyTokenError,
  classifyUserErrors,
  findMissingScopes,
  isSubscriptionForStore,
  planInventoryWebhook,
  toLocationGid
} from './shopifyInventoryWebhookCore.js';

const PROD_URI = 'https://asia-northeast1-mobile-order-prod.cloudfunctions.net/shopifyInventoryWebhook?storeId=store_110ec';
const DEV_URI = 'https://asia-northeast1-mobile-order-dev-5f7fd.cloudfunctions.net/shopifyInventoryWebhook?storeId=store_0dtao';

test('送り先は実行中のプロジェクトから組み立てる', () => {
  assert.equal(buildInventoryWebhookUri({ projectId: 'mobile-order-prod', region: 'asia-northeast1', storeId: 'store_110ec' }), PROD_URI);
  assert.equal(buildInventoryWebhookUri({ projectId: 'mobile-order-dev-5f7fd', region: 'asia-northeast1', storeId: 'store_0dtao' }), DEV_URI);
});

test('write 権限があれば read は満たす', () => {
  assert.deepEqual(findMissingScopes('write_inventory,read_locations'), []);
  assert.deepEqual(findMissingScopes('read_inventory'), ['write_inventory', 'read_locations']);
  assert.deepEqual(findMissingScopes(['read_products']), ['read_inventory', 'write_inventory', 'read_locations']);
});

test('ロケーションIDは数値でも gid でも受け付ける', () => {
  assert.equal(toLocationGid('123'), 'gid://shopify/Location/123');
  assert.equal(toLocationGid('gid://shopify/Location/123'), 'gid://shopify/Location/123');
  assert.equal(toLocationGid(''), '');
});

test('店舗の見分けは受け口の関数名と storeId', () => {
  assert.equal(isSubscriptionForStore(PROD_URI, 'store_110ec'), true);
  assert.equal(isSubscriptionForStore('https://shopifyinventorywebhook-abc123-an.a.run.app/?storeId=store_110ec', 'store_110ec'), true);
  // dev の店舗から見た prod の通知は別物(同じ Shopify ストアでも触らない)
  assert.equal(isSubscriptionForStore(PROD_URI, 'store_0dtao'), false);
  assert.equal(isSubscriptionForStore('https://example.com/hook?storeId=store_110ec', 'store_110ec'), false);
  assert.equal(isSubscriptionForStore('not a url', 'store_110ec'), false);
});

test('無ければ登録・あればそのまま・何度でも1件', () => {
  assert.deepEqual(planInventoryWebhook({ subscriptions: [], desiredUri: PROD_URI, storeId: 'store_110ec' }), { action: 'create', remove: [] });
  const existing = [{ id: 'w1', topic: 'INVENTORY_LEVELS_UPDATE', format: 'JSON', uri: PROD_URI }];
  assert.deepEqual(planInventoryWebhook({ subscriptions: existing, desiredUri: PROD_URI, storeId: 'store_110ec' }), { action: 'keep', id: 'w1', remove: [] });
});

test('手で登録した run.app 形式は送り先を直す・重複は消す・他店と他環境は触らない', () => {
  const subs = [
    { id: 'manual', topic: 'INVENTORY_LEVELS_UPDATE', format: 'JSON', uri: 'https://shopifyinventorywebhook-abc123-an.a.run.app/?storeId=store_110ec' },
    { id: 'dup', topic: 'INVENTORY_LEVELS_UPDATE', format: 'JSON', uri: 'https://shopifyinventorywebhook-abc123-an.a.run.app/?storeId=store_110ec' },
    { id: 'dev', topic: 'INVENTORY_LEVELS_UPDATE', format: 'JSON', uri: DEV_URI },
    { id: 'other', topic: 'ORDERS_CREATE', format: 'JSON', uri: PROD_URI }
  ];
  assert.deepEqual(planInventoryWebhook({ subscriptions: subs, desiredUri: PROD_URI, storeId: 'store_110ec' }), { action: 'update', id: 'manual', remove: ['dup'] });
});

test('正しいものが既にあれば、重複の方を消してそれを残す', () => {
  const subs = [
    { id: 'old', topic: 'INVENTORY_LEVELS_UPDATE', format: 'XML', uri: PROD_URI },
    { id: 'good', topic: 'INVENTORY_LEVELS_UPDATE', format: 'JSON', uri: PROD_URI }
  ];
  assert.deepEqual(planInventoryWebhook({ subscriptions: subs, desiredUri: PROD_URI, storeId: 'store_110ec' }), { action: 'keep', id: 'good', remove: ['old'] });
});

test('トークン取得の失敗を段階ごとの文言に分ける', () => {
  const dns = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  assert.equal(classifyTokenError(dns).code, 'domain');
  const bad = Object.assign(new Error('x'), { status: 400, shopifyBody: { error: 'invalid_client' } });
  assert.equal(classifyTokenError(bad).code, 'credentials');
  const notInstalled = Object.assign(new Error('x'), { status: 400, shopifyBody: { error: 'app_not_installed' } });
  assert.equal(classifyTokenError(notInstalled).code, 'notInstalled');
});

test('通知登録の userErrors を分類する', () => {
  assert.equal(classifyUserErrors([{ message: 'Address for this topic has already been taken' }]).code, 'webhookTaken');
  const other = classifyUserErrors([{ message: 'Something else' }]);
  assert.equal(other.code, 'webhook');
  assert.equal(other.detail, 'Something else');
});
