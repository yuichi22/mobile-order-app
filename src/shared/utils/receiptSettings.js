// レジモード(pos/order)別のレシート設定。store共通の printerSettings を後方互換のフォールバックにする。
// 印刷方式は Star プリンタ(iPadアプリ=Bluetooth直結 / Web=AirPrint代替) と 印刷ブリッジ(ESC/POS) の2択。
export const RECEIPT_PRINT_METHODS = [
  { id: 'star', label: 'Star プリンタ（Bluetooth）', device: 'タブレット用', desc: 'タブレットアプリは常にStarに接続します。' },
  { id: 'bridge', label: '印刷ブリッジ', device: 'PC・Mac用', desc: 'PC/Macでは印刷ブリッジ経由でLAN内のプリンタへ接続。' }
];

export const normalizeReceiptMode = (mode) => (mode === 'order' ? 'order' : 'pos');

// 印刷方式の正規化。'bridge'/'star' のみ有効。
// 旧 'browser'(AirPrint) は廃止し 'star' へ寄せる（Webではブラウザ印刷で代替されるため挙動は維持）。
export const normalizeReceiptPrintMethod = (method, fallback = 'star') => {
  if (method === 'bridge') return 'bridge';
  if (method === 'star') return 'star';
  if (method === 'browser') return 'star';
  return fallback === 'bridge' ? 'bridge' : 'star';
};

export const buildDefaultModeReceiptSettings = (legacyPrinterSettings = {}) => ({
  // 旧来ブリッジ運用(printerSettings.enabled)があれば既定をブリッジ、無ければStar。
  printMethod: legacyPrinterSettings.enabled ? 'bridge' : 'star',
  enabled: Boolean(legacyPrinterSettings.enabled),
  bridgeUrl: legacyPrinterSettings.bridgeUrl || 'http://localhost:8787',
  printerIp: legacyPrinterSettings.printerIp || '',
  printerPort: Number(legacyPrinterSettings.printerPort || 9100),
  autoPrint: Boolean(legacyPrinterSettings.autoPrintReceipt),
  // Capacitorネイティブアプリ(iPad)でのStar Bluetooth/LANプリンタ。
  // identifier空なら印刷時に自動探索する。
  starIdentifier: legacyPrinterSettings.starIdentifier || '',
  starInterface: legacyPrinterSettings.starInterface || 'bluetooth',
  headerTitle: '',
  footerNote: '',
  bannerImage: ''
});

// 設定doc + モード から、そのモードの実効レシート設定を返す（無ければlegacyへフォールバック）。
export const getReceiptModeSettings = (settings = {}, mode = 'pos') => {
  const normalizedMode = normalizeReceiptMode(mode);
  const base = buildDefaultModeReceiptSettings(settings?.printerSettings || {});
  const saved = settings?.receiptModeSettings?.[normalizedMode] || {};
  return {
    ...base,
    ...saved,
    printMethod: normalizeReceiptPrintMethod(saved.printMethod, base.printMethod)
  };
};

// 設定UIの初期ドラフト（pos/order 両方）を作る。
export const buildReceiptModeDraft = (settings = {}) => ({
  pos: getReceiptModeSettings(settings, 'pos'),
  order: getReceiptModeSettings(settings, 'order')
});

export default getReceiptModeSettings;
