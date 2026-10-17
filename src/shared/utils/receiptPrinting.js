import { Capacitor } from '@capacitor/core';
import { buildPosReceiptPrintPayload } from './posReceiptPrint';
import { openPosReceiptBrowserPrint } from './posReceiptBrowserPrint';
import { printReceiptViaBridge } from '../api/printBridge';
import { getReceiptModeSettings, normalizeReceiptMode } from './receiptSettings';
import { StarPrinter } from '../plugins/starPrinter';
import { getDeviceStarPrinter, getDevicePaperColumns } from './deviceStarPrinter';

// 取引データ or 明示modeから、レシート設定のモード(pos/order)を判定する。
export const resolveReceiptMode = (input, fallback = 'pos') => {
  if (input === 'pos' || input === 'order') return input;
  const data = input || {};
  if (data.registerMode === 'pos' || data.registerMode === 'order') return data.registerMode;
  if (data.isTakeout === true) return 'order';
  const orderType = String(data.orderType || data.serviceType || '').toLowerCase();
  if (orderType === 'takeout' || orderType === 'order') return 'order';
  return normalizeReceiptMode(fallback);
};

export const isAutoPrintEnabled = (settings, mode) => Boolean(getReceiptModeSettings(settings, mode).autoPrint);

const enrichPayload = (data, settings, cfg) => ({
  ...buildPosReceiptPrintPayload(data, settings),
  headerTitle: cfg.headerTitle || '',
  footerNote: cfg.footerNote || '',
  bannerImage: cfg.bannerImage || '',
  // Starバナーの印字調整（ネイティブ側で使用・再ビルド不要で調整可）。
  bannerWidth: Number(cfg.bannerWidth) || 192,
  bannerThreshold: Number(cfg.bannerThreshold) || 180
});

// ネイティブ(iPad)の Star プリンタ接続先(識別子/インターフェース)を解決する。
// 識別子が空だと毎回8秒の自動探索が走り会計後の動作が遅くなるため、必ず何か1つに解決したい。
//
// 優先順位:
//   1. この端末で選択したプリンタ(localStorage) … 複数iPad構成で各台が自分のプリンタへ印刷する
//   2. 店舗設定(Firestore)の値 … 端末未選択時のフォールバック。既存インストールを壊さないために残す
//      （モード別に保存されているが実質1台前提のため、当該モードが空なら他方へフォールバック）
//   3. 空 … ネイティブ側で自動探索
const resolveStarConnection = (settings, resolvedMode) => {
  const devicePrinter = getDeviceStarPrinter();
  if (devicePrinter) return devicePrinter;

  const cfg = getReceiptModeSettings(settings, resolvedMode);
  const otherCfg = getReceiptModeSettings(settings, resolvedMode === 'pos' ? 'order' : 'pos');
  return {
    identifier: cfg.starIdentifier || otherCfg.starIdentifier || '',
    interface: cfg.starIdentifier
      ? (cfg.starInterface || 'bluetooth')
      : (otherCfg.starInterface || cfg.starInterface || 'bluetooth')
  };
};

// キャッシュドロワー(釣銭機)を開く。会計完了時(AdminApp の会計結果)と、手動の「ドロワーを開く」から呼ぶ。
// 印刷とは独立したネイティブコマンドのため、レシート印刷の有無/タイミングと切り離せる。
// ネイティブ(iPad)以外では何もしない。失敗は呼び出し側で画面に出す(describeDrawerError)。
export const isCashDrawerSupported = () => Capacitor.isNativePlatform();

// 会計結果(onPaymentResult の payload)でドロワーを開くか。レシート設定の drawerOpenOn に従う。
// 'cash' は現金の入金・お釣り(金券お釣りの現金マイナスを含む)がある会計だけ開く。
export const shouldOpenDrawerForPayment = (payment, settings, mode) => {
  const cfg = getReceiptModeSettings(settings, resolveReceiptMode(mode ?? payment, 'pos'));
  if (cfg.drawerOpenOn !== 'cash') return true;
  const data = payment || {};
  if (data.paymentMethod === 'cash' || data.method === 'cash') return true;
  if (Number(data.changeAmount || data.change || 0) > 0 || Number(data.voucherChangeAmount || 0) > 0) return true;
  return Array.isArray(data.payments) && data.payments.some((p) => p?.method === 'cash' && Number(p.amount || 0) !== 0);
};

// ドロワーを開けなかった理由を、スタッフ向けの一言にする。
export const describeDrawerError = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  if (code === 'UNIMPLEMENTED' || /not implemented/i.test(message)) {
    return 'このアプリにはドロワーを開く機能がありません。アプリを最新版に更新してください。';
  }
  return message || 'プリンタに接続できませんでした。プリンタの電源・接続を確認してください。';
};

export const openCashDrawer = async ({ settings, mode } = {}) => {
  if (!Capacitor.isNativePlatform()) return { method: 'noop' };
  const resolvedMode = resolveReceiptMode(mode, 'pos');
  const { identifier, interface: starInterface } = resolveStarConnection(settings, resolvedMode);
  await StarPrinter.openDrawer({ identifier, interface: starInterface });
  return { method: 'starNative', mode: resolvedMode };
};

// 事前構築済みpayloadを、レジモード別設定の方式(Star/ブリッジ)で印刷する。
export const printPayloadByMode = async ({ payload, settings, mode }) => {
  const resolvedMode = resolveReceiptMode(mode ?? payload, 'pos');
  const cfg = getReceiptModeSettings(settings, resolvedMode);

  // Capacitor ネイティブアプリ（iPad）は常に Star プリンタへ直結する。
  // 印刷方式(star/bridge)の選択は PC/ブラウザ側にのみ適用する。
  // （iPadからは印刷ブリッジ localhost:8787 に到達できないため、モードによらずStarを使う）
  if (Capacitor.isNativePlatform()) {
    const { identifier: starIdentifier, interface: starInterface } = resolveStarConnection(settings, resolvedMode);
    await StarPrinter.printReceipt({
      // 用紙幅は端末に繋がっているプリンタの物理特性なので、店舗設定ではなく端末設定から渡す。
      receipt: { ...payload, paperColumns: getDevicePaperColumns() },
      identifier: starIdentifier,
      interface: starInterface
    });
    return { method: 'starNative', mode: resolvedMode };
  }

  // 非ネイティブ(PC/ブラウザ)は印刷方式の選択に従う。
  const method = cfg.printMethod === 'bridge' ? 'bridge' : 'star';

  // Star 方式は Web では直結できないため、ブラウザ印刷(AirPrint)で代替する。
  if (method === 'star') {
    openPosReceiptBrowserPrint(payload);
    return { method: 'browserFallback', mode: resolvedMode };
  }

  // 印刷ブリッジ方式(ESC/POS)
  await printReceiptViaBridge(payload, {
    ...settings,
    printerSettings: {
      enabled: cfg.enabled,
      bridgeUrl: cfg.bridgeUrl,
      printerIp: cfg.printerIp,
      printerPort: cfg.printerPort
    }
  });
  return { method: 'bridge', mode: resolvedMode };
};

// レジモード別設定に従い、ブリッジ(ESC/POS) or ブラウザ(AirPrint) でレシートを発行する。
export const issueReceipt = async ({ data, settings, mode }) => {
  const resolvedMode = resolveReceiptMode(mode ?? data, 'pos');
  const cfg = getReceiptModeSettings(settings, resolvedMode);
  const otherCfg = getReceiptModeSettings(settings, resolvedMode === 'pos' ? 'order' : 'pos');
  // バナー/文言は店舗共通のロゴ・挨拶として、どのモードの取引でも出したい。
  // 当該モードが未設定なら、もう一方のモードの値へフォールバックする。
  const designCfg = {
    ...cfg,
    bannerImage: cfg.bannerImage || otherCfg.bannerImage || '',
    headerTitle: cfg.headerTitle || otherCfg.headerTitle || '',
    footerNote: cfg.footerNote || otherCfg.footerNote || '',
    bannerWidth: cfg.bannerWidth || otherCfg.bannerWidth,
    bannerThreshold: cfg.bannerThreshold || otherCfg.bannerThreshold
  };
  const payload = enrichPayload(data, settings, designCfg);
  return printPayloadByMode({ payload, settings, mode: resolvedMode });
};

export default issueReceipt;
