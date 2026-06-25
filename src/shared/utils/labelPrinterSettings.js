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

// 印字項目（どれをラベルに出すか）。
export const buildDefaultLabelPrinterSettings = () => ({
  enabled: false,
  bridgeUrl: 'http://localhost:8787',
  printerIp: '',
  printerPort: 9100,
  // ラベル用紙（203dpi 想定）
  labelWidthMm: 40, // 印字ヘッド方向（X）の有効幅
  labelHeightMm: 30, // 送り方向の長さ
  gapMm: 3, // ラベル間ギャップ。連続紙は 0
  symbology: 'jan13',
  moduleWidthDots: 3, // バーコード1モジュール幅(dot)
  barcodeHeightMm: 12,
  printSpeed: 3, // 印字速度（実機に合わせ調整）
  printDensity: 3, // 印字濃度（実機に合わせ調整）
  // 印字項目
  showName: true,
  showPrice: true,
  showBarcodeNumber: true
});

// 設定doc から実効ラベルプリンタ設定を返す。
export const getLabelPrinterSettings = (settings = {}) => {
  const base = buildDefaultLabelPrinterSettings();
  const saved = settings?.labelPrinterSettings || {};
  return {
    ...base,
    ...saved,
    symbology: normalizeLabelSymbology(saved.symbology, base.symbology),
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
// items: [{ barcode, name, price, copies }]
export const buildLabelPrintPayload = (labelSettings = {}, items = []) => {
  const cfg = getLabelPrinterSettings({ labelPrinterSettings: labelSettings });
  return {
    printerIp: cfg.printerIp,
    printerPort: cfg.printerPort,
    labelWidthMm: cfg.labelWidthMm,
    labelHeightMm: cfg.labelHeightMm,
    gapMm: cfg.gapMm,
    symbology: cfg.symbology,
    moduleWidthDots: cfg.moduleWidthDots,
    barcodeHeightMm: cfg.barcodeHeightMm,
    printSpeed: cfg.printSpeed,
    printDensity: cfg.printDensity,
    showName: cfg.showName,
    showPrice: cfg.showPrice,
    showBarcodeNumber: cfg.showBarcodeNumber,
    labels: (Array.isArray(items) ? items : []).map((item) => ({
      barcode: String(item.barcode || ''),
      name: String(item.name || ''),
      price: item.price ?? '',
      copies: Math.max(1, Math.min(999, Number(item.copies || 1)))
    }))
  };
};

export default getLabelPrinterSettings;
