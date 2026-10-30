// Shopify 在庫通知(INVENTORY_LEVELS_UPDATE)の自動登録で使う、Firestore にも Shopify にも触れない純粋関数。
// 仕様: 在庫連携を ON にするときは「鍵 → 権限 → ロケーション → 通知の登録 → 読み戻し」が全部通ったときだけ ON にする。
// 失敗した段階ごとに「何が起きたか」と「どう直すか」を画面に出す(2026-10-29 石原さん決定)。

export const INVENTORY_WEBHOOK_TOPIC = 'INVENTORY_LEVELS_UPDATE';
export const REQUIRED_INVENTORY_SCOPES = ['read_inventory', 'write_inventory', 'read_locations'];

const SCOPE_LABELS = {
  read_inventory: '在庫の読み取り(read_inventory)',
  write_inventory: '在庫の書き込み(write_inventory)',
  read_locations: 'ロケーションの読み取り(read_locations)'
};

// Shopify は write_x を持っていれば read_x を返さないことがあるので、write で read を満たす。
export const findMissingScopes = (granted = []) => {
  const set = new Set((Array.isArray(granted) ? granted : String(granted || '').split(','))
    .map((scope) => String(scope || '').trim())
    .filter(Boolean));
  return REQUIRED_INVENTORY_SCOPES.filter((scope) => {
    if (set.has(scope)) return false;
    if (scope.startsWith('read_') && set.has(`write_${scope.slice(5)}`)) return false;
    return true;
  });
};

// 送り先は実行中の環境から組み立てる(dev で ON にしても prod の受け口は登録しない)。
export const buildInventoryWebhookUri = ({ projectId, region, storeId }) => {
  if (!projectId || !region || !storeId) throw new Error('webhook uri requires projectId, region, storeId');
  return `https://${region}-${projectId}.cloudfunctions.net/shopifyInventoryWebhook?storeId=${encodeURIComponent(storeId)}`;
};

export const toLocationGid = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('gid://') ? raw : `gid://shopify/Location/${raw.split('/').pop()}`;
};

// この店舗向けの通知か。dev と prod は同じ Shopify ストアにつながるので、送り先の関数名と storeId で見分ける
// (店舗IDは環境ごとに違う)。cloudfunctions.net と run.app のどちらの形の URL でも同じ受け口とみなす。
export const isSubscriptionForStore = (uri, storeId) => {
  try {
    const url = new URL(String(uri || ''));
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const pointsToReceiver = path.endsWith('/shopifyinventorywebhook') || host.startsWith('shopifyinventorywebhook-');
    return pointsToReceiver && url.searchParams.get('storeId') === storeId;
  } catch {
    return false;
  }
};

// 既存の通知一覧から、何をすれば「この店舗向けが1件だけ・送り先と形式が正しい」になるかを決める。
export const planInventoryWebhook = ({ subscriptions = [], desiredUri, storeId }) => {
  const mine = subscriptions.filter((sub) => sub?.topic === INVENTORY_WEBHOOK_TOPIC && isSubscriptionForStore(sub.uri, storeId));
  if (mine.length === 0) return { action: 'create', remove: [] };
  const exact = mine.find((sub) => sub.uri === desiredUri && sub.format === 'JSON');
  const keep = exact || mine[0];
  const remove = mine.filter((sub) => sub.id !== keep.id).map((sub) => sub.id);
  return exact ? { action: 'keep', id: keep.id, remove } : { action: 'update', id: keep.id, remove };
};

export class ShopifySetupError extends Error {
  constructor({ step, code, title, howTo, detail = '' }) {
    super(title);
    this.name = 'ShopifySetupError';
    this.step = step;
    this.code = code;
    this.title = title;
    this.howTo = howTo;
    this.detail = String(detail || '').slice(0, 500);
  }

  toJSON() {
    return { step: this.step, code: this.code, title: this.title, howTo: this.howTo, detail: this.detail };
  }
}

// 画面に出す文言の表(仕様書「エラーと直し方」)。Shopify の実際の応答の形は dev で確かめて調整する。
export const setupError = (code, { detail = '', missingScopes = [], locationName = '' } = {}) => {
  switch (code) {
    case 'credentials':
      return new ShopifySetupError({
        step: 'key', code, detail,
        title: 'クライアントIDかシークレットが違います',
        howTo: 'Shopify Dev Dashboard でその店の連携アプリを開き、「設定」のクライアントID・シークレットを貼り直して保存してください。別の店のアプリの鍵を入れていないかも確かめてください。'
      });
    case 'notInstalled':
      return new ShopifySetupError({
        step: 'key', code, detail,
        title: '連携アプリがこのストアに入っていません',
        howTo: 'Dev Dashboard でアプリをそのストアにインストールしてから、保存し直してください。'
      });
    case 'domain':
      return new ShopifySetupError({
        step: 'key', code, detail,
        title: 'ストアのドメインが違います',
        howTo: '「xxxx.myshopify.com」の形で入れてください（独自ドメインではなく）。'
      });
    case 'scopes':
      return new ShopifySetupError({
        step: 'scopes', code, detail,
        title: `アプリに${missingScopes.length ? missingScopes.map((scope) => SCOPE_LABELS[scope] || scope).join('・') : '必要'}の権限がありません`,
        howTo: 'Dev Dashboard でアプリのアクセス範囲に read_inventory・write_inventory・read_locations を足し、新しいバージョンを出してストアで権限を承認してください。そのあと保存し直してください。'
      });
    case 'locationMissing':
      return new ShopifySetupError({
        step: 'location', code, detail,
        title: locationName ? `ロケーション「${locationName}」が Shopify にありません` : 'ロケーションが Shopify にありません',
        howTo: 'Shopify の「設定 > ロケーション」にある名前から選び直してください。'
      });
    case 'locationInactive':
      return new ShopifySetupError({
        step: 'location', code, detail,
        title: locationName ? `ロケーション「${locationName}」が Shopify で無効になっています` : 'ロケーションが Shopify で無効になっています',
        howTo: 'Shopify の「設定 > ロケーション」で有効にしてから、保存し直してください。'
      });
    case 'webhookTaken':
      return new ShopifySetupError({
        step: 'webhook', code, detail,
        title: '同じ通知が別の方法で登録されています',
        howTo: 'Shopify 管理画面（設定 > 通知 > Webhook）に同じ送り先の通知があれば削除してから保存し直してください（管理画面で作った通知は署名が合わず使えません）。'
      });
    case 'webhook':
      return new ShopifySetupError({
        step: 'webhook', code, detail,
        title: '通知を登録できませんでした',
        howTo: '数分おいて保存し直してください。同じエラーが続くときは、下のエラー文を開発担当に送ってください。'
      });
    case 'verify':
    default:
      return new ShopifySetupError({
        step: 'verify', code: 'verify', detail,
        title: '通知の登録を確かめられませんでした',
        howTo: '保存し直してください。続くときは開発担当へ連絡してください。'
      });
  }
};

// アクセストークン取得の失敗を分類する。error.status / error.shopifyBody / error.cause を見る。
export const classifyTokenError = (error) => {
  const body = error?.shopifyBody || {};
  const text = [body.error, body.error_description, error?.message].filter(Boolean).join(' ');
  const causeCode = error?.cause?.code || error?.code || '';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'CERT_HAS_EXPIRED'].includes(causeCode) || error?.status === 404) {
    return setupError('domain', { detail: text || causeCode });
  }
  if (/not.?installed|install/i.test(text)) return setupError('notInstalled', { detail: text });
  if (error?.status === 400 || error?.status === 401 || error?.status === 403 || /invalid_client|unauthorized/i.test(text)) {
    return setupError('credentials', { detail: text });
  }
  return setupError('credentials', { detail: text || 'アクセストークンを取得できませんでした。' });
};

export const isAccessDenied = (error) => (error?.shopifyErrors || [])
  .some((entry) => entry?.extensions?.code === 'ACCESS_DENIED');

export const classifyUserErrors = (userErrors = []) => {
  const detail = userErrors.map((entry) => entry?.message).filter(Boolean).join(' / ');
  if (/already been taken|already exists|taken/i.test(detail)) return setupError('webhookTaken', { detail });
  return setupError('webhook', { detail });
};
