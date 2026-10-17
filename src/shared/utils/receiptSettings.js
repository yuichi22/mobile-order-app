// レジモード(pos/order)別のレシート設定。store共通の printerSettings を後方互換のフォールバックにする。
// 印刷方式は Star プリンタ(iPadアプリ=Bluetooth直結 / Web=AirPrint代替) と 印刷ブリッジ(ESC/POS) の2択。
export const RECEIPT_PRINT_METHODS = [
  { id: 'star', label: 'Star プリンタ（Bluetooth）', device: 'タブレット用', desc: 'タブレットアプリは常にStarに接続します。' },
  { id: 'bridge', label: '印刷ブリッジ', device: 'PC・Mac用', desc: 'PC/Macでは印刷ブリッジ経由でLAN内のプリンタへ接続。' }
];

export const normalizeReceiptMode = (mode) => (mode === 'order' ? 'order' : 'pos');

// 会計完了でキャッシュドロワーを開く条件【10-17】。既定は従来どおり「すべての支払い」。
export const DRAWER_OPEN_OPTIONS = [
  { id: 'all', label: 'すべての支払い', desc: '現金・カード・QRなど、会計が完了するたびに開きます。' },
  { id: 'cash', label: '現金を含む会計だけ', desc: '現金の支払い・お釣りがある会計のときだけ開きます。' }
];
export const normalizeDrawerOpenOn = (value) => (value === 'cash' ? 'cash' : 'all');

// 会計なしで「ドロワーを開く」を押せる人【10-17】。既定は全員(スタッフ以上)。
export const DRAWER_MANUAL_OPEN_OPTIONS = [
  { id: 'all', label: '全員', desc: 'スタッフを含め、レジを使う全員が開けます。' },
  { id: 'manager', label: '責任者のみ', desc: '店長・オーナーだけが開けます。' }
];
export const normalizeDrawerManualOpenBy = (value) => (value === 'manager' ? 'manager' : 'all');

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
  bannerImage: '',
  drawerOpenOn: 'all',
  drawerManualOpenBy: 'all'
});

// 設定doc + モード から、そのモードの実効レシート設定を返す（無ければlegacyへフォールバック）。
export const getReceiptModeSettings = (settings = {}, mode = 'pos') => {
  const normalizedMode = normalizeReceiptMode(mode);
  const base = buildDefaultModeReceiptSettings(settings?.printerSettings || {});
  const saved = settings?.receiptModeSettings?.[normalizedMode] || {};
  return {
    ...base,
    ...saved,
    printMethod: normalizeReceiptPrintMethod(saved.printMethod, base.printMethod),
    drawerOpenOn: normalizeDrawerOpenOn(saved.drawerOpenOn),
    drawerManualOpenBy: normalizeDrawerManualOpenBy(saved.drawerManualOpenBy)
  };
};

// 設定UIの初期ドラフト（pos/order 両方）を作る。
export const buildReceiptModeDraft = (settings = {}) => ({
  pos: getReceiptModeSettings(settings, 'pos'),
  order: getReceiptModeSettings(settings, 'order')
});

export default getReceiptModeSettings;
