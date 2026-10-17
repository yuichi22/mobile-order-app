// スマホで開いたときの画面(提供 / オーダー / PC版)の切り替えと記憶【10-17】。
//
// - スマホ判定は起動時に1回だけ行う。PC版では viewport を PC 幅に広げるため、
//   その後に matchMedia で測るとスマホでも「PC」と判定されてしまう。
// - 最後に選んだ画面を端末(localStorage)に覚え、URL にモード指定が無いときの起動先にする。
// - PC版はレジ操作をしない閲覧用。PC と同じ幅で全体を描き、指で拡大して見る。

const STORAGE_KEY = 'akuto.mobileMode';
export const MOBILE_MODES = ['serve', 'staffOrder', 'admin'];
const DESKTOP_VIEWPORT_WIDTH = 1180;

export const IS_PHONE_AT_BOOT = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(max-width: 767px)').matches;

export const loadMobileMode = () => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return MOBILE_MODES.includes(value) ? value : null;
  } catch {
    return null;
  }
};

export const saveMobileMode = (mode) => {
  if (!MOBILE_MODES.includes(mode)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // プライベートモード等で保存できなくても切り替え自体は続ける
  }
};

let originalViewportContent = null;

// PC版のとき viewport を PC 幅にする(initial-scale を外して、端末幅に収まるよう縮小表示させる)。
export const applyDesktopViewport = (enabled) => {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  if (originalViewportContent === null) originalViewportContent = meta.getAttribute('content') || '';
  const next = enabled
    ? `width=${DESKTOP_VIEWPORT_WIDTH}, viewport-fit=cover`
    : originalViewportContent;
  if (meta.getAttribute('content') !== next) meta.setAttribute('content', next);
};
