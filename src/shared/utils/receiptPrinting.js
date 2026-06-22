import { Capacitor } from '@capacitor/core';
import { buildPosReceiptPrintPayload } from './posReceiptPrint';
import { openPosReceiptBrowserPrint } from './posReceiptBrowserPrint';
import { printReceiptViaBridge } from '../api/printBridge';
import { getReceiptModeSettings, normalizeReceiptMode } from './receiptSettings';
import { StarPrinter } from '../plugins/starPrinter';

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

// 事前構築済みpayloadを、レジモード別設定の方式(Star/ブリッジ)で印刷する。
export const printPayloadByMode = async ({ payload, settings, mode }) => {
  const resolvedMode = resolveReceiptMode(mode ?? payload, 'pos');
  const cfg = getReceiptModeSettings(settings, resolvedMode);

  // Capacitor ネイティブアプリ（iPad）は常に Star プリンタへ直結する。
  // 印刷方式(star/bridge)の選択は PC/ブラウザ側にのみ適用する。
  // （iPadからは印刷ブリッジ localhost:8787 に到達できないため、モードによらずStarを使う）
  if (Capacitor.isNativePlatform()) {
    // 識別子が空だと毎回8秒の自動探索が走り会計後の印刷が遅くなる。
    // 同一プリンタを共用する想定で、当該モードが未設定ならもう一方のモードの識別子へフォールバックする。
    const otherCfg = getReceiptModeSettings(settings, resolvedMode === 'pos' ? 'order' : 'pos');
    const starIdentifier = cfg.starIdentifier || otherCfg.starIdentifier || '';
    const starInterface = cfg.starIdentifier
      ? (cfg.starInterface || 'bluetooth')
      : (otherCfg.starInterface || cfg.starInterface || 'bluetooth');
    await StarPrinter.printReceipt({
      receipt: payload,
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
