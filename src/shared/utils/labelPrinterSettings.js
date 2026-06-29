// バーコードラベルプリンタ（東芝テック B-EV4T / LAN / TPCL / TCP9100）の設定。
// 印刷ブリッジ(店頭Windows同一端末)経由で TPCL を送信する。レシートプリンタとは
// 別IP想定のため、レシート用 printerSettings とは独立した labelPrinterSettings として保存する。

export const LABEL_SYMBOLOGY_OPTIONS = [
  { id: 'jan13', label: 'JAN13 / EAN13' },
  { id: 'code128', label: 'CODE128' },
  { id: 'jan8', label: 'JAN8 / EAN8' },
  { id: 'code39', label: 'CODE39' },
  { id: 'nw7', label: 'NW-7 (Codabar)' },
  { id: 'itf', label: 'Interleaved 2 of 5' }
];

export const normalizeLabelSymbology = (symbology, fallback = 'jan13') => {
  const key = String(symbology || '').toLowerCase();
  return LABEL_SYMBOLOGY_OPTIONS.some((option) => option.id === key) ? key : fallback;
};

// 用紙検出センサー。発行(XS)コマンドのセンサー指定に使う。
// blackmark=反射(裏の黒線) / gap=透過(ラベル間の隙間) / none=連続紙(検出なし)
export const MEDIA_SENSOR_OPTIONS = [
  { id: 'blackmark', label: '反射（裏の黒線）' },
  { id: 'gap', label: '透過（ラベル間の隙間）' },
  { id: 'none', label: 'なし（連続紙）' }
];

export const normalizeMediaSensor = (sensor, fallback = 'blackmark') => {
  const key = String(sensor || '').toLowerCase();
  return MEDIA_SENSOR_OPTIONS.some((option) => option.id === key) ? key : fallback;
};

// 印字項目（どれをラベルに出すか）。
export const buildDefaultLabelPrinterSettings = () => ({
  enabled: false,
  bridgeUrl: 'http://localhost:8787',
  printerIp: '',
  printerPort: 9100,
  // ラベル用紙（203dpi 想定）
  labelWidthMm: 30, // 印字ヘッド方向（X）の有効幅
  labelHeightMm: 13, // 送り方向の長さ
  gapMm: 3, // ラベル間ギャップ。連続紙は 0
  // 用紙検出センサー（発行XSコマンドのセンサー指定）。裏に黒線がある用紙は blackmark。
  mediaSensor: 'blackmark',
  symbology: 'jan13', // POSがJANで読み取るため JAN13 既定。
  // バーコードに何を符号化するか。'sku'=品番 / 'barcode'=JANコード。
  // ※POSレジが読み取る値と必ず一致させること。
  barcodeSource: 'barcode',
  moduleWidthDots: 2, // バーコード1モジュール幅(dot)。JAN13で約24mm(白/ローズ付近まで)。読み取り重視。
  barcodeHeightMm: 5, // 13mm高さ・3行レイアウトに収まるよう小さめ。実機で調整。
  printSpeed: 3, // 印字速度（実機に合わせ調整）
  printDensity: 3, // 印字濃度（実機に合わせ調整）
  // 印字項目（このデザインでは 品番/価格/名称/色/サイズ は値があれば印字。番号(HRI)は既定オフ）
  showName: true,
  showPrice: true,
  showBarcodeNumber: false
});

// 設定doc から実効ラベルプリンタ設定を返す。
export const getLabelPrinterSettings = (settings = {}) => {
  const base = buildDefaultLabelPrinterSettings();
  const saved = settings?.labelPrinterSettings || {};
  return {
    ...base,
    ...saved,
    symbology: normalizeLabelSymbology(saved.symbology, base.symbology),
    mediaSensor: normalizeMediaSensor(saved.mediaSensor, base.mediaSensor),
    printerPort: Number(saved.printerPort || base.printerPort),
    labelWidthMm: Number(saved.labelWidthMm ?? base.labelWidthMm),
    labelHeightMm: Number(saved.labelHeightMm ?? base.labelHeightMm),
    gapMm: Number(saved.gapMm ?? base.gapMm),
    moduleWidthDots: Number(saved.moduleWidthDots ?? base.moduleWidthDots),
    barcodeHeightMm: Number(saved.barcodeHeightMm ?? base.barcodeHeightMm),
    printSpeed: Number(saved.printSpeed ?? base.printSpeed),
    printDensity: Number(saved.printDensity ?? base.printDensity)
  };
};

// 設定 + 商品配列 から、ブリッジ /print/label へ送る payload を組み立てる。
// items: [{ barcode, sku, name, price, colorName, size, copies }]
// barcode(バーの符号化データ)は barcodeSource 設定で sku/barcode を切替える。
export const buildLabelPrintPayload = (labelSettings = {}, items = []) => {
  const cfg = getLabelPrinterSettings({ labelPrinterSettings: labelSettings });
  return {
    printerIp: cfg.printerIp,
    printerPort: cfg.printerPort,
    labelWidthMm: cfg.labelWidthMm,
    labelHeightMm: cfg.labelHeightMm,
    gapMm: cfg.gapMm,
    mediaSensor: cfg.mediaSensor,
    symbology: cfg.symbology,
    moduleWidthDots: cfg.moduleWidthDots,
    barcodeHeightMm: cfg.barcodeHeightMm,
    printSpeed: cfg.printSpeed,
    printDensity: cfg.printDensity,
    showName: cfg.showName,
    showPrice: cfg.showPrice,
    showBarcodeNumber: cfg.showBarcodeNumber,
    labels: (Array.isArray(items) ? items : []).map((item) => {
      const sku = String(item.sku || '');
      const jan = String(item.barcode || '');
      return {
        barcode: cfg.barcodeSource === 'barcode' ? jan : sku, // バーの符号化データ
        sku, // 品番テキスト
        name: String(item.name || ''),
        price: item.price ?? '',
        colorName: String(item.colorName || ''),
        size: String(item.size || ''),
        copies: Math.max(1, Math.min(999, Number(item.copies || 1)))
      };
    })
  };
};

export default getLabelPrinterSettings;
