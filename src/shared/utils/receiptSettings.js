// レジモード(pos/order)別のレシート設定。store共通の printerSettings を後方互換のフォールバックにする。
export const RECEIPT_PRINT_METHODS = [
  { id: 'bridge', label: '印刷ブリッジ（ESC/POS）', desc: 'PCの印刷ブリッジ経由でLAN内サーマルプリンタへ' },
  { id: 'browser', label: 'ブラウザ印刷（AirPrint）', desc: 'iPad等のSafariからAirPrintで発行' }
];

export const normalizeReceiptMode = (mode) => (mode === 'order' ? 'order' : 'pos');

export const buildDefaultModeReceiptSettings = (legacyPrinterSettings = {}) => ({
  printMethod: 'bridge',
  enabled: Boolean(legacyPrinterSettings.enabled),
  bridgeUrl: legacyPrinterSettings.bridgeUrl || 'http://localhost:8787',
  printerIp: legacyPrinterSettings.printerIp || '',
  printerPort: Number(legacyPrinterSettings.printerPort || 9100),
  autoPrint: Boolean(legacyPrinterSettings.autoPrintReceipt),
  headerTitle: '',
  footerNote: '',
  bannerImage: ''
});

// 設定doc + モード から、そのモードの実効レシート設定を返す（無ければlegacyへフォールバック）。
export const getReceiptModeSettings = (settings = {}, mode = 'pos') => {
  const normalizedMode = normalizeReceiptMode(mode);
  const base = buildDefaultModeReceiptSettings(settings?.printerSettings || {});
  const saved = settings?.receiptModeSettings?.[normalizedMode] || {};
  return { ...base, ...saved, printMethod: saved.printMethod === 'browser' ? 'browser' : (saved.printMethod || base.printMethod) };
};

// 設定UIの初期ドラフト（pos/order 両方）を作る。
export const buildReceiptModeDraft = (settings = {}) => ({
  pos: getReceiptModeSettings(settings, 'pos'),
  order: getReceiptModeSettings(settings, 'order')
});

export default getReceiptModeSettings;
