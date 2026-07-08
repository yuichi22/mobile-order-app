// URL から <img> を読み込む。
const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('image load failed'));
  img.src = url;
});

// 画像の指定領域を canvas に描画(任意で拡大)。小さい/中央外れのバーコードを拡大して読ませる用。
const drawRegion = (img, { sx, sy, sw, sh, scale = 1 }) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
};

// canvas から1回デコード試行。失敗(NotFound等)は null。
const tryDecodeCanvas = (reader, canvas) => {
  try {
    const result = reader.decodeFromCanvas(canvas);
    const text = result?.getText ? result.getText() : '';
    return text ? String(text).trim() : null;
  } catch (_) {
    return null;
  } finally {
    if (typeof reader.reset === 'function') reader.reset();
  }
};

// 撮影画像からバーコードの縞模様を実際にデコードする(印字数字のOCRより正確)。
// zxing は重いので動的import(遅延ロード)。デコード不可なら null を返しフォールバックへ。
// 1発で読めない写真対策として、全体→フル解像度→中央拡大→中央横帯 と複数の見え方で多段トライする。
export const decodeBarcodeFromFile = async (file) => {
  if (!file) return null;
  try {
    const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library');
    // 静止画からの読み取り成功率を上げる: TRY_HARDER＋小売でよく使う形式を指定。
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.UPC_A, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39
    ]);
    const reader = new BrowserMultiFormatReader(hints);
    const url = URL.createObjectURL(file);
    try {
      // canvas 対応環境では多段トライ(小さい/中央外れ/高解像度で失敗しやすいのを補う)。
      if (typeof reader.decodeFromCanvas === 'function') {
        const img = await loadImage(url);
        const W = img.naturalWidth || img.width;
        const H = img.naturalHeight || img.height;
        if (W && H) {
          const attempts = [
            { sx: 0, sy: 0, sw: W, sh: H, scale: Math.min(1, 1400 / Math.max(W, H)) || 1 }, // 全体(過大画像は縮小)
            { sx: 0, sy: 0, sw: W, sh: H, scale: 1 },                                        // 全体フル解像度
            { sx: W * 0.08, sy: H * 0.15, sw: W * 0.84, sh: H * 0.7, scale: 1.5 },           // 中央を拡大
            { sx: 0, sy: H * 0.25, sw: W, sh: H * 0.5, scale: 1.3 }                          // 中央横帯を拡大
          ];
          for (const a of attempts) {
            const text = tryDecodeCanvas(reader, drawRegion(img, a));
            if (text) return text;
          }
          return null;
        }
      }
      // フォールバック: 従来どおり画像URLから1回デコード。
      const result = await reader.decodeFromImageUrl(url);
      const text = result?.getText ? result.getText() : '';
      return text ? String(text).trim() : null;
    } finally {
      URL.revokeObjectURL(url);
      if (typeof reader.reset === 'function') reader.reset();
    }
  } catch (_) {
    // NotFoundException 等 = このコマから読めなかった。フォールバックへ。
    return null;
  }
};

// EAN-13 / UPC-A / EAN-8 のチェックデジット検証。フォールバック(印字OCR)の誤りを弾く用。
// zxingデコード成功値は内部検証済みなのでこの検証は不要(常に採用)。
export const isValidEanUpc = (code) => {
  const s = String(code || '').replace(/\D/g, '');
  const digits = s.split('').map(Number);
  if (s.length === 13) {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += i % 2 === 0 ? digits[i] : digits[i] * 3;
    return (10 - (sum % 10)) % 10 === digits[12];
  }
  if (s.length === 12) {
    let odd = 0; let even = 0;
    for (let i = 0; i < 11; i += 1) { if (i % 2 === 0) odd += digits[i]; else even += digits[i]; }
    return (10 - ((odd * 3 + even) % 10)) % 10 === digits[11];
  }
  if (s.length === 8) {
    let sum = 0;
    for (let i = 0; i < 7; i += 1) sum += i % 2 === 0 ? digits[i] * 3 : digits[i];
    return (10 - (sum % 10)) % 10 === digits[7];
  }
  return false;
};
