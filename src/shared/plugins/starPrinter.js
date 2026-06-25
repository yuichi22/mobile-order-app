import { registerPlugin } from '@capacitor/core';

// iOS ネイティブの Star 印刷プラグイン（StarPrinterPlugin.swift）への橋渡し。
// Web(ブラウザ)では呼ばれない（receiptPrinting 側で Capacitor.isNativePlatform() を確認）。
// メソッド: discoverPrinters({timeout}) / printReceipt({receipt, identifier, interface})
//           / openDrawer({identifier, interface}) … キャッシュドロワー(No.1)開放のみ
export const StarPrinter = registerPlugin('StarPrinter');

export default StarPrinter;
