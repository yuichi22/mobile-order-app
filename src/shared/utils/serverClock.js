// 営業時間・時間帯の判定は端末の時計に依存させない。
// 端末の時刻/タイムゾーンがズレていると(海外設定のまま等)、営業中なのに
// 「営業時間外」や全商品非表示になり、人数モーダルの直後で詰まる。
// サーバー応答に載る serverNow との差分を控え、判定には補正後の時刻を使う。
const STORAGE_KEY = 'akuto_server_clock_offset';

let offsetMs = 0;

const readStoredOffset = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

offsetMs = readStoredOffset();

export const syncServerClock = (serverNowMs) => {
  const serverNow = Number(serverNowMs);
  if (!Number.isFinite(serverNow) || serverNow <= 0) return;

  offsetMs = serverNow - Date.now();

  try {
    window.localStorage.setItem(STORAGE_KEY, String(offsetMs));
  } catch {
    // 記憶できない環境では都度の応答で補正する
  }
};

export const getServerClockOffsetMs = () => offsetMs;

export const serverNow = () => new Date(Date.now() + offsetMs);
