// スキャン照会用のクエリ実行（RESTフォールバック付き）。
//
// 背景: getDocs(一発クエリ)は購読と同じ常時接続チャネル(WebChannel)に相乗りする。
// iPad + 店舗Wi-Fi ではこのチャネルが黙り込むことがあり、その間に投げた照会は
// 「次の通信が発生するまで」返ってこない(現場症状: 2品目以降が表示されず、
// 次の品をスキャンすると前の品と一緒に出る)。
// 対策: タイムアウトしたら Firestore REST(単発HTTPS・チャネル非依存)で同じ
// クエリを引き直し、先に返った方を採用する(遅れて返った方は捨てる=二重追加なし)。
import { auth, firebaseProjectId } from './client';

// client.js の FIRESTORE_DATABASE_ID と同一(名前付きDB)。
const DATABASE_ID = 'main';

// REST の Value → プレーンJS値。ネスト(map/array)も再帰変換する。
const decodeRestValue = (value) => {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) {
    const out = {};
    Object.entries(value.mapValue?.fields || {}).forEach(([k, v]) => { out[k] = decodeRestValue(v); });
    return out;
  }
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeRestValue);
  return null;
};

const decodeRestDocument = (docBody) => {
  const out = { id: String(docBody.name || '').split('/').pop() };
  Object.entries(docBody.fields || {}).forEach(([k, v]) => { out[k] = decodeRestValue(v); });
  return out;
};

// REST runQuery。where: { fieldPath, op: 'EQUAL'|'ARRAY_CONTAINS', value: string }
const runRestQuery = async ({ parentPath, collectionId, where, limit }) => {
  const user = auth.currentUser;
  if (!user) throw new Error('rest-fallback: not signed in');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${DATABASE_ID}/documents/${parentPath}:runQuery`;
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: where.fieldPath },
              op: where.op,
              value: { stringValue: where.value }
            }
          },
          limit
        }
      })
    });
    if (!response.ok) throw new Error(`rest-fallback: HTTP ${response.status}`);
    const rows = await response.json();
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.document)
      .map((row) => decodeRestDocument(row.document));
  } finally {
    clearTimeout(abortTimer);
  }
};

/**
 * SDKクエリ(sdkPromise: getDocs(...)の Promise)と REST フォールバックを競走させる。
 * - timeoutMs 以内に SDK が返ればそのまま採用(通常時は追加コストゼロ)。
 * - 返らなければ REST を発射し、先に成功した方の結果だけを返す。
 * - 両方失敗した場合のみ reject。
 * 戻り値: プレーンな [{id, ...fields}] 配列。
 */
export const queryDocsWithRestFallback = ({ sdkPromise, rest, timeoutMs = 1500, label = 'scan' }) => (
  new Promise((resolve, reject) => {
    let settled = false;
    let sdkFailed = false;
    let restFailed = false;
    let restStarted = false;

    const win = (docs, source) => {
      if (settled) return;
      settled = true;
      if (source === 'rest') console.warn(`[${label}] WebChannel応答なし→RESTで解決`);
      resolve(docs);
    };
    const lose = (which, error) => {
      if (which === 'sdk') sdkFailed = true; else restFailed = true;
      // SDK失敗時はタイマーを待たず即RESTへ。両方倒れたら reject。
      if (sdkFailed && !restStarted) { startRest(); return; }
      if (settled) return;
      if (sdkFailed && restFailed) { settled = true; reject(error); }
    };

    const startRest = () => {
      if (restStarted || settled) return;
      restStarted = true;
      runRestQuery(rest)
        .then((docs) => win(docs, 'rest'))
        .catch((error) => lose('rest', error));
    };

    sdkPromise
      .then((snapshot) => win(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })), 'sdk'))
      .catch((error) => lose('sdk', error));

    setTimeout(startRest, timeoutMs);
  })
);

export default queryDocsWithRestFallback;
