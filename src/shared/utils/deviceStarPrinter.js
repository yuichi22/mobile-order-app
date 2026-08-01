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
const PAPER_WIDTH_KEY = 'akuto.pos.starPaperWidth.v1';

// 用紙幅。プリンタ本体の物理特性なので、プリンタ選択と同じく端末ごとに持つ。
// 桁数は Font A 基準（80mm=48桁 / 58mm=32桁）で、ネイティブ側へは桁数で渡す。
export const PAPER_WIDTHS = [
  { id: '80', label: '80mm（幅広・標準）', columns: 48 },
  { id: '58', label: '58mm（小型・モバイル）', columns: 32 }
];
export const DEFAULT_PAPER_WIDTH = '80';

const normalizePaperWidth = (value) => (String(value) === '58' ? '58' : DEFAULT_PAPER_WIDTH);

// 用紙幅ID → ネイティブへ渡す桁数。
export const paperColumnsFor = (paperWidth) =>
  PAPER_WIDTHS.find((entry) => entry.id === normalizePaperWidth(paperWidth))?.columns ?? 48;

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

// 用紙幅はプリンタ選択とは別キーで持つ。プリンタを明示選択せず自動探索に任せている端末でも
// 用紙幅だけは効かせたいため（選択解除しても用紙幅の設定が消えない）。
export const getDevicePaperWidth = () => {
  try {
    return normalizePaperWidth(localStorage.getItem(PAPER_WIDTH_KEY));
  } catch {
    return DEFAULT_PAPER_WIDTH;
  }
};

export const setDevicePaperWidth = (paperWidth) => {
  try {
    localStorage.setItem(PAPER_WIDTH_KEY, normalizePaperWidth(paperWidth));
  } catch {
    // 保存できなくても既定(80mm)で印刷は続行できるため握りつぶす。
  }
  return true;
};

// この端末の用紙幅に対応する桁数。ネイティブへ paperColumns として渡す。
export const getDevicePaperColumns = () => paperColumnsFor(getDevicePaperWidth());

export default getDeviceStarPrinter;
