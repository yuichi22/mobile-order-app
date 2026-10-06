// haus-netstore: 商品画像の空altを自動で埋める定期ジョブ（週2回・月木 04:00 JST）
// ・altが空の画像だけが対象。手入力済みのaltは絶対に上書きしない
// ・alt = 商品名（バリエーション代表写真には（色名）を付加）
// ・認証は Dev Dashboard アプリ「haus-alt-script」の client credentials（シークレットはSecret Manager）
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';

const REGION = 'asia-northeast1';
const SHOP = 'haus-netstore.myshopify.com';
const CLIENT_ID = 'ee7cc3f1f8cdc7d7eab9020078ac2a69';
const HAUS_ALT_CLIENT_SECRET = defineSecret('HAUS_ALT_CLIENT_SECRET');
const COLOR_OPTION = /^(color|colour|カラー|色)$/i;
const TIME_BUDGET_MS = 8 * 60 * 1000; // 540秒制限の手前で安全に切り上げる（次回続きから）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken(secret) {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: secret }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`token取得失敗: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function gql(token, query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors?.some((e) => e.extensions?.code === 'THROTTLED')) { await sleep(1500); continue; }
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error('THROTTLED が解消しませんでした');
}

const PRODUCTS_QUERY = `
  query ($cursor: String) {
    products(first: 50, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title
        options { name values }
        media(first: 50) { nodes { id alt mediaContentType } }
        variants(first: 100) {
          nodes { selectedOptions { name value } media(first: 1) { nodes { id } } }
        }
      }
    }
  }`;

const UPDATE_MUTATION = `
  mutation ($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      mediaUserErrors { field message }
    }
  }`;

export const scheduledHausImageAltFill = onSchedule(
  {
    region: REGION,
    schedule: '0 4 * * 1,4',
    timeZone: 'Asia/Tokyo',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [HAUS_ALT_CLIENT_SECRET],
  },
  async () => {
    const started = Date.now();
    const token = await getToken(HAUS_ALT_CLIENT_SECRET.value());
    let cursor = null, scanned = 0, filled = 0, errors = 0;
    for (;;) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        console.log('[hausAltFill] 時間切れで切り上げ（残りは次回）', { scanned, filled });
        break;
      }
      const data = await gql(token, PRODUCTS_QUERY, { cursor });
      const page = data.products;
      for (const p of page.nodes) {
        scanned++;
        const colorByMediaId = {};
        if (p.options.some((o) => COLOR_OPTION.test(o.name.trim()))) {
          for (const v of p.variants.nodes) {
            const mid = v.media.nodes[0]?.id;
            if (!mid || colorByMediaId[mid]) continue;
            const c = v.selectedOptions.find((o) => COLOR_OPTION.test(o.name.trim()))?.value;
            if (c) colorByMediaId[mid] = c;
          }
        }
        const updates = [];
        for (const m of p.media.nodes) {
          if (m.mediaContentType !== 'IMAGE') continue;
          if (m.alt && m.alt.trim()) continue;
          const color = colorByMediaId[m.id];
          let alt = color ? `${p.title}（${color}）` : p.title;
          if (alt.length > 125) alt = alt.slice(0, 124) + '…';
          updates.push({ id: m.id, alt });
        }
        if (!updates.length) continue;
        try {
          const res = await gql(token, UPDATE_MUTATION, { productId: p.id, media: updates });
          const errs = res.productUpdateMedia.mediaUserErrors;
          if (errs.length) { errors++; console.error('[hausAltFill] userErrors', p.title, errs); }
          else filled += updates.length;
          await sleep(200);
        } catch (e) {
          errors++;
          console.error('[hausAltFill] update failed', p.title, e.message);
        }
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
      await sleep(200);
    }
    console.log('[hausAltFill] 完了', { scanned, filled, errors });
  }
);
