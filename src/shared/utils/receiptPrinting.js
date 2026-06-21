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
  bannerImage: cfg.bannerImage || ''
});

// 事前構築済みpayloadを、レジモード別設定の方式(ブリッジ/ブラウザ)で印刷する。
export const printPayloadByMode = async ({ payload, settings, mode }) => {
  const resolvedMode = resolveReceiptMode(mode ?? payload, 'pos');
  const cfg = getReceiptModeSettings(settings, resolvedMode);

  // Capacitor ネイティブアプリ（iPad）では Star プリンタへ Bluetooth で直接印刷する。
  // ブラウザ(PC/通常Web)では isNativePlatform()=false のためこの分岐は通らず従来動作。
  if (Capacitor.isNativePlatform()) {
    await StarPrinter.printReceipt({
      receipt: payload,
      identifier: cfg.starIdentifier || '',
      interface: cfg.starInterface || 'bluetooth'
    });
    return { method: 'starNative', mode: resolvedMode };
  }

  if (cfg.printMethod === 'browser') {
    openPosReceiptBrowserPrint(payload);
    return { method: 'browser', mode: resolvedMode };
  }

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
  const payload = enrichPayload(data, settings, cfg);
  return printPayloadByMode({ payload, settings, mode: resolvedMode });
};

export default issueReceipt;
