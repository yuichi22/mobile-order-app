// バーコード/品番などの入力を半角化する。
// 全角ASCII（数字・英字・記号 U+FF01–FF5E）→ 半角、全角スペース(U+3000)→ 半角スペース。
// 全角カナ・漢字など ASCII 範囲外は変換しない。
const FULLWIDTH_SPACE = new RegExp(String.fromCharCode(0x3000), 'g');

export const toHalfWidthCode = (value) => (
  String(value ?? '')
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(FULLWIDTH_SPACE, ' ')
);

// 「バーコードリーダーで読み取った時だけ」半角化するための判定付き変換。
// 人の手入力（ゆっくり）はそのまま、リーダー特有の高速連続入力のときだけ半角化する。
// 入力は同時に1フィールドずつなので、最後の入力時刻をモジュール内で共有して連続入力を検出する。
let lastCodeInputAt = 0;
const SCAN_INTERVAL_MS = 40; // この間隔より速い連続入力＝スキャナとみなす

export const normalizeScannedCode = (value, intervalMs = SCAN_INTERVAL_MS) => {
  const now = Date.now();
  const isScan = now - lastCodeInputAt < intervalMs;
  lastCodeInputAt = now;
  return isScan ? toHalfWidthCode(value) : String(value ?? '');
};

export default toHalfWidthCode;
