// 端末ごとの Star プリンタ選択（localStorage）。
//
// なぜ端末別か：レシートプリンタは「その iPad に物理的に紐づく」機器であり、店舗テナントの
// 属性ではない。1店舗に iPad が複数台あれば各台がそれぞれ自分のプリンタへ印刷する必要がある。
// 従来は stores/{storeId}/settings/basic の receiptModeSettings[mode].starIdentifier に
// 店舗共通で1つだけ保存していたため、複数台構成では後から選んだ端末の設定が全台を上書きしていた。
//
// 保存単位はモード(pos/order)別ではなく「端末に1台」。同じ iPad に POS用/ORDER用で別々の
// プリンタを繋ぐ運用は存在しないため、モードで分けると設定漏れを生むだけになる。
// （従来コードもモード間でフォールバックしており、実質1台前提だった）
const STORAGE_KEY = 'akuto.pos.starPrinter.v1';

const normalizeInterface = (value) => {
  const text = String(value || '').toLowerCase();
  if (text === 'lan' || text === 'usb' || text === 'bluetoothle') return text;
  return 'bluetooth';
};

// この端末で選択済みのプリンタ。未選択なら null。
export const getDeviceStarPrinter = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const identifier = String(parsed?.identifier || '').trim();
    if (!identifier) return null;
    return { identifier, interface: normalizeInterface(parsed?.interface) };
  } catch {
    // localStorage 不可(プライベートモード等)や壊れたJSONは「未選択」として扱う。
    return null;
  }
};

export const setDeviceStarPrinter = ({ identifier, interface: starInterface } = {}) => {
  const normalizedIdentifier = String(identifier || '').trim();
  if (!normalizedIdentifier) return clearDeviceStarPrinter();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      identifier: normalizedIdentifier,
      interface: normalizeInterface(starInterface)
    }));
  } catch {
    // 保存できなくても印刷自体は自動探索で継続できるため握りつぶす。
  }
  return true;
};

export const clearDeviceStarPrinter = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
  return true;
};

export default getDeviceStarPrinter;
