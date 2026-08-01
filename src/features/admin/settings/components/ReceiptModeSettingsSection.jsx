import React, { useEffect, useState } from 'react';
import { Check, Printer, Search, Bluetooth, Wifi, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { RECEIPT_PRINT_METHODS, buildReceiptModeDraft } from '../../../../shared/utils/receiptSettings';
import { StarPrinter } from '../../../../shared/plugins/starPrinter';
import { checkPrintBridgeHealth, printTestViaBridge } from '../../../../shared/api/printBridge';
import {
  getDeviceStarPrinter,
  setDeviceStarPrinter,
  clearDeviceStarPrinter,
  getDevicePaperWidth,
  setDevicePaperWidth,
  paperColumnsFor,
  PAPER_WIDTHS
} from '../../../../shared/utils/deviceStarPrinter';

const MODE_TABS = [
  { id: 'pos', label: 'POSレジ' },
  { id: 'order', label: 'ORDERレジ' }
];

// テスト印刷用のレシート内容。設定中のバナー画像・ヘッダー/フッター文言・店舗情報を反映する。
const buildStarTestReceipt = (modeLabel, cfg = {}, settings = {}) => ({
  title: '領収書',
  bannerImage: cfg.bannerImage || '',
  bannerWidth: Number(cfg.bannerWidth) || 192,
  bannerThreshold: Number(cfg.bannerThreshold) || 180,
  headerTitle: cfg.headerTitle || '',
  footerNote: cfg.footerNote || '',
  storeName: settings.name || 'テスト店舗',
  address: settings.address || '',
  tel: settings.tel || '',
  invoiceNumber: settings.invoiceNumber || '',
  issuedAtText: new Date().toLocaleString('ja-JP'),
  receiptNo: 'TEST-0001',
  tableName: `${modeLabel} 接続テスト`,
  registerName: settings.activeRegisterName || `${modeLabel}（テスト）`,
  items: [
    { name: 'テスト商品A', quantity: 1, unitPrice: 100, totalPrice: 100 },
    // 商品ごとの割引（会計伝票と同じく商品行の直下に印字）の確認用サンプル。
    { name: 'テスト商品B', quantity: 2, unitPrice: 150, totalPrice: 270, lineDiscount: { label: '商品割引（10%OFF）', amount: 30 } }
  ],
  subtotal: 400,
  // 割引内訳の印字確認用サンプル（%割引＋スタンプカード）。
  discounts: [
    { label: '10%割引', amount: 40 },
    { label: 'スタンプカード', amount: 50 }
  ],
  tax: 28,
  // 消費税 8%/10% 分割印字の確認用サンプル（税率別の税込対象額＋内消費税）。
  taxAmountReduced: 8,
  taxAmountStandard: 20,
  taxableIncludedReduced: 108,
  taxableIncludedStandard: 202,
  total: 310,
  paymentMethod: '現金'
});

// レジモード(POS共通 / ORDER共通)別のレシート設定。印刷方式・プリンタ・自動印刷・文言をモード別に保存する。
// レシート設定は自前保存せず、draft を親(BasicSettings)へ通知し、
// 親の「保存」(最上部/フッター)でまとめて保存する。
const ReceiptModeSettingsSection = ({ settings, onDraftChange }) => {
  const [activeMode, setActiveMode] = useState('pos');
  const [draft, setDraft] = useState(() => buildReceiptModeDraft(settings));

  // Star プリンタ（Capacitorネイティブアプリのみ）
  const isNative = Capacitor.isNativePlatform();
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [testing, setTesting] = useState(false);
  const [starStatus, setStarStatus] = useState(null); // {type:'success'|'error', message}
  // プリンタ選択はこの端末だけの設定(localStorage)。店舗設定(Firestore)には保存しない。
  // 複数iPad構成で各台が自分のプリンタへ印刷できるようにするため（保存ボタンとは無関係に即時反映）。
  const [devicePrinter, setDevicePrinter] = useState(() => getDeviceStarPrinter());
  // 用紙幅もプリンタ本体の物理特性なので端末ごとに保持する。
  const [paperWidth, setPaperWidth] = useState(() => getDevicePaperWidth());

  // 印刷ブリッジ
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeTesting, setBridgeTesting] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState(null); // {type:'success'|'error', message}

  useEffect(() => {
    // 設定が(遅延)読み込まれた/外部更新されたら下書きを同期する。編集中の頻繁な上書きは避けるため対象フィールドのみ依存。
    setDraft(buildReceiptModeDraft(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.receiptModeSettings, settings?.printerSettings]);

  useEffect(() => {
    // 最新の下書きを親へ通知し、親の保存に含めてもらう。
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const current = draft[activeMode] || {};
  const updateCurrent = (patch) => {
    setDraft((prev) => ({ ...prev, [activeMode]: { ...prev[activeMode], ...patch } }));
  };

  // 印刷方式（star/bridge）。star を既定とする。
  const isBridge = current.printMethod === 'bridge';

  // この端末が未選択のときに使われる、旧仕様の店舗共通設定（後方互換フォールバック）。
  // receiptPrinting.js の resolveStarConnection と同じ優先順位で表示する。
  const otherMode = activeMode === 'pos' ? 'order' : 'pos';
  const storeFallback = current.starIdentifier
    ? { identifier: current.starIdentifier, interface: current.starInterface || 'bluetooth' }
    : (draft[otherMode]?.starIdentifier
      ? { identifier: draft[otherMode].starIdentifier, interface: draft[otherMode].starInterface || 'bluetooth' }
      : null);
  // 実際に印刷で使われる接続先（端末選択 > 店舗設定 > 自動探索）。
  const effectivePrinter = devicePrinter || storeFallback;

  const selectDevicePrinter = (printer) => {
    setDeviceStarPrinter({ identifier: printer.identifier, interface: printer.interface || 'bluetooth' });
    setDevicePrinter(getDeviceStarPrinter());
    setStarStatus({ type: 'success', message: 'この端末のプリンタを設定しました（保存ボタンは不要です）。テスト印刷で紙が出るか確認してください。' });
  };

  const unselectDevicePrinter = () => {
    clearDeviceStarPrinter();
    setDevicePrinter(null);
    setStarStatus(null);
  };

  const selectPaperWidth = (id) => {
    setDevicePaperWidth(id);
    setPaperWidth(getDevicePaperWidth());
    setStarStatus(null);
  };

  // 現在タブのブリッジ設定で接続確認/テスト印刷する。
  const buildBridgeSettings = () => ({
    printerSettings: {
      bridgeUrl: current.bridgeUrl || 'http://localhost:8787',
      printerIp: current.printerIp || '',
      printerPort: Number(current.printerPort || 9100)
    }
  });

  const handleCheckBridge = async () => {
    if (bridgeChecking) return;
    setBridgeChecking(true);
    setBridgeStatus(null);
    try {
      const result = await checkPrintBridgeHealth(buildBridgeSettings());
      setBridgeStatus({ type: 'success', message: `印刷ブリッジに接続できました。${result?.printerIp ? `既定IP: ${result.printerIp}` : ''}` });
    } catch (error) {
      setBridgeStatus({ type: 'error', message: error?.message || '印刷ブリッジに接続できませんでした。' });
    } finally {
      setBridgeChecking(false);
    }
  };

  const handleTestBridge = async () => {
    if (bridgeTesting) return;
    setBridgeTesting(true);
    setBridgeStatus(null);
    try {
      await printTestViaBridge(buildBridgeSettings());
      setBridgeStatus({ type: 'success', message: 'テスト印刷を送信しました。プリンタから紙が出たか確認してください。' });
    } catch (error) {
      setBridgeStatus({ type: 'error', message: error?.message || 'テスト印刷に失敗しました。' });
    } finally {
      setBridgeTesting(false);
    }
  };

  const handleDiscoverStar = async () => {
    if (discovering) return;
    setDiscovering(true);
    setStarStatus(null);
    setDiscovered([]);
    try {
      const result = await StarPrinter.discoverPrinters({ timeout: 8000 });
      const printers = Array.isArray(result?.printers) ? result.printers : [];
      setDiscovered(printers);
      setStarStatus(
        printers.length === 0
          ? { type: 'error', message: 'プリンタが見つかりませんでした。iPadの設定>BluetoothでTSP650IIをペアリング済みか、電源が入っているか確認してください。' }
          : { type: 'success', message: `${printers.length}台のプリンタが見つかりました。使用するプリンタを選んでください。` }
      );
    } catch (error) {
      const errorText = error?.message || error?.errorMessage || error?.code || JSON.stringify(error) || String(error);
      setStarStatus({ type: 'error', message: `探索に失敗しました: ${errorText}` });
    } finally {
      setDiscovering(false);
    }
  };

  const handleTestPrintStar = async () => {
    if (testing) return;
    setTesting(true);
    setStarStatus(null);
    try {
      await StarPrinter.printReceipt({
        receipt: {
          ...buildStarTestReceipt(activeMode === 'pos' ? 'POSレジ' : 'ORDERレジ', current, settings),
          paperColumns: paperColumnsFor(paperWidth)
        },
        identifier: effectivePrinter?.identifier || '',
        interface: effectivePrinter?.interface || 'bluetooth'
      });
      setStarStatus({ type: 'success', message: 'テスト印刷を送信しました。プリンタから紙が出たか確認してください。' });
    } catch (error) {
      const errorText = error?.message || error?.errorMessage || error?.code || JSON.stringify(error) || String(error);
      setStarStatus({ type: 'error', message: `テスト印刷に失敗しました: ${errorText}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Printer size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tight text-gray-900">レシート設定（レジモード別）</h3>
            <p className="mt-0.5 text-xs font-bold text-gray-400">
              POSレジ・ORDERレジで、印刷方式・プリンタ・自動印刷・文言を分けて設定できます。上部またはフッターの「保存」で保存されます。
            </p>
          </div>
        </div>
      </div>

      <div className="mb-5 inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveMode(tab.id)}
            className={`h-9 rounded-full px-5 text-sm font-black transition-all ${
              activeMode === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {/* 印刷方式（Star / 印刷ブリッジ） */}
        <div>
          <label className="mb-2 block text-[11px] font-black uppercase tracking-wider text-gray-400">印刷方式</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {RECEIPT_PRINT_METHODS.map((method) => {
              const active = current.printMethod === method.id;
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => updateCurrent({ printMethod: method.id })}
                  className={`rounded-2xl border-2 p-4 text-left transition-all ${
                    active ? 'border-slate-900 bg-slate-50' : 'border-gray-100 bg-white hover:border-gray-200'
                  }`}
                >
                  {method.device && (
                    <span className="mb-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                      {method.device}
                    </span>
                  )}
                  <div className="text-sm font-black text-gray-900">{method.label}</div>
                  <div className="mt-1 text-[11px] font-bold leading-relaxed text-gray-400">{method.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Star プリンタ方式（iPadアプリ） */}
        {!isBridge && isNative && (
          <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Bluetooth size={18} className="text-blue-600" />
              <span className="text-sm font-black text-gray-900">Star プリンタ（この端末）</span>
            </div>
            <p className="mb-3 text-[11px] font-bold leading-relaxed text-gray-500">
              プリンタの選択は<strong className="text-gray-700">この iPad だけの設定</strong>です（他の端末には影響しません）。先にiPadの「設定 &gt; Bluetooth」でプリンタをペアリングしてから、下で検索・選択・テストしてください。
            </p>

            <div className="mb-3 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-gray-600">
              使用中プリンタ：{effectivePrinter
                ? <span className="font-mono text-gray-900">{effectivePrinter.identifier}（{effectivePrinter.interface}）</span>
                : <span className="text-gray-400">未選択（印刷時に自動探索）</span>}
              {!devicePrinter && storeFallback && (
                <span className="mt-1 block font-sans text-[10px] font-bold text-amber-600">
                  これは旧来の店舗共通設定の値です。この端末に別のプリンタを繋いでいる場合は、下から検索して選び直してください。
                </span>
              )}
            </div>

            {/* 用紙幅。80mm=48桁 / 58mm=32桁 で明細の折返しとバナー幅が変わる。 */}
            <div className="mb-3">
              <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">用紙幅</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {PAPER_WIDTHS.map((entry) => {
                  const active = paperWidth === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => selectPaperWidth(entry.id)}
                      className={`rounded-xl border-2 px-3 py-2 text-left transition-all ${
                        active ? 'border-slate-900 bg-white' : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <div className="text-xs font-black text-gray-900">{entry.label}</div>
                      <div className="mt-0.5 text-[10px] font-bold text-gray-400">{entry.columns}桁</div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] font-bold leading-relaxed text-gray-400">
                プリンタに入れているロール紙の幅を選んでください。間違えるとレシートの明細がずれます。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDiscoverStar}
                disabled={discovering || testing}
                className="flex h-10 items-center gap-2 rounded-xl border-2 border-blue-200 bg-white px-4 text-xs font-black text-blue-700 transition hover:bg-blue-50 disabled:opacity-60"
              >
                {discovering ? <LoadingSpinner size={14} /> : <Search size={14} />}
                プリンタを検索
              </button>
              <button
                type="button"
                onClick={handleTestPrintStar}
                disabled={testing || discovering}
                className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-black text-white transition hover:bg-black disabled:opacity-60"
              >
                {testing ? <LoadingSpinner size={14} /> : <Printer size={14} />}
                テスト印刷
              </button>
              {devicePrinter && (
                <button
                  type="button"
                  onClick={unselectDevicePrinter}
                  className="flex h-10 items-center rounded-xl border-2 border-gray-200 bg-white px-4 text-xs font-black text-gray-500 transition hover:bg-gray-50"
                >
                  選択解除（自動探索）
                </button>
              )}
            </div>

            {discovered.length > 0 && (
              <div className="mt-3 space-y-2">
                {/* Star機のBluetooth既定名は全機「Star Micronics」で同一のため、
                    見分けは下の識別子(BDアドレス相当)で行う。迷ったら選んでテスト印刷し、
                    自分の端末の隣のプリンタから紙が出た方を採用する。 */}
                <p className="text-[10px] font-bold leading-relaxed text-gray-500">
                  複数台見つかった場合、名前はどれも同じことがあります。識別子で選び、テスト印刷で紙が出た方を採用してください。
                </p>
                {discovered.map((printer) => {
                  const selected = devicePrinter?.identifier === printer.identifier;
                  return (
                    <button
                      key={`${printer.identifier}-${printer.interface}`}
                      type="button"
                      onClick={() => selectDevicePrinter(printer)}
                      className={`flex w-full items-center justify-between rounded-xl border-2 px-3 py-2 text-left transition ${
                        selected ? 'border-slate-900 bg-slate-50' : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs font-black text-gray-900">{printer.identifier}</span>
                        <span className="block text-[10px] font-bold text-gray-400">{printer.interface}</span>
                      </span>
                      {selected && <Check size={16} className="shrink-0 text-slate-900" />}
                    </button>
                  );
                })}
              </div>
            )}

            {starStatus && (
              <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-bold leading-relaxed ${
                starStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
              }`}>
                {starStatus.message}
              </div>
            )}

            <p className="mt-3 text-[11px] font-bold leading-relaxed text-amber-600">
              ※ プリンタの選択はこの端末に即時保存されます（右上の「保存」は不要）。POSレジ/ORDERレジ共通で、未選択でも自動探索で印刷を試みます。
            </p>
          </div>
        )}

        {/* Star方式・Web(非ネイティブ)端末での案内 */}
        {!isBridge && !isNative && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold leading-relaxed text-blue-700">
            この端末（PC/ブラウザ）ではStarプリンタへ直接接続できないため、会計時はブラウザ印刷（AirPrint等）のダイアログで発行します。Star本体への直接印刷はiPadアプリで動作します。
          </div>
        )}

        {/* 印刷ブリッジ方式（ESC/POS） */}
        {isBridge && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">印刷ブリッジURL</span>
                <input
                  value={current.bridgeUrl || ''}
                  onChange={(event) => updateCurrent({ bridgeUrl: event.target.value })}
                  placeholder="http://localhost:8787"
                  className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">プリンタIP</span>
                <input
                  value={current.printerIp || ''}
                  onChange={(event) => updateCurrent({ printerIp: event.target.value })}
                  placeholder="192.168.0.100"
                  className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ポート</span>
                <input
                  type="number"
                  value={current.printerPort ?? 9100}
                  onChange={(event) => updateCurrent({ printerPort: Number(event.target.value) || 9100 })}
                  placeholder="9100"
                  className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleCheckBridge}
                disabled={bridgeChecking || bridgeTesting}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white text-sm font-black text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                {bridgeChecking ? <LoadingSpinner size={16} /> : <Wifi size={16} />}
                接続確認
              </button>
              <button
                type="button"
                onClick={handleTestBridge}
                disabled={bridgeTesting || bridgeChecking}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-black text-white transition hover:bg-black disabled:opacity-60"
              >
                {bridgeTesting ? <LoadingSpinner size={16} /> : <Printer size={16} />}
                テスト印刷
              </button>
            </div>

            {bridgeStatus && (
              <div className={`rounded-xl px-3 py-2 text-xs font-bold leading-relaxed ${
                bridgeStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
              }`}>
                {bridgeStatus.message}
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-1 text-xs font-black text-gray-700">印刷ブリッジをインストール</div>
              <p className="mb-3 text-[11px] font-bold leading-relaxed text-gray-400">
                この端末でブリッジ印刷するには印刷ブリッジを起動してください（初回のみNode.jsが必要）。
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <a href="/downloads/mobile-order-print-bridge-mac.zip" download className="flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 transition hover:bg-gray-50">
                  <Download size={15} /> Mac版
                </a>
                <a href="/downloads/mobile-order-print-bridge-windows.zip" download className="flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 transition hover:bg-gray-50">
                  <Download size={15} /> Windows版
                </a>
              </div>
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-blue-700">
              プリンタIPはルーター側で固定割当してください。IPが変わると印刷できなくなります。
            </div>
          </div>
        )}

        <label className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3">
          <input
            type="checkbox"
            checked={Boolean(current.autoPrint)}
            onChange={(event) => updateCurrent({ autoPrint: event.target.checked })}
            className="h-5 w-5 rounded border-gray-300"
          />
          <span className="text-sm font-black text-gray-700">会計時に自動でレシートを印刷する</span>
        </label>

        <div className="grid gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ヘッダー文言（任意）</span>
            <input
              value={current.headerTitle || ''}
              onChange={(event) => updateCurrent({ headerTitle: event.target.value })}
              placeholder="例：領収書 / お買い上げありがとうございます"
              className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">フッター文言（任意）</span>
            <textarea
              value={current.footerNote || ''}
              onChange={(event) => updateCurrent({ footerNote: event.target.value })}
              rows={2}
              placeholder="例：またのご来店をお待ちしております"
              className="w-full rounded-2xl border-2 border-gray-100 px-4 py-3 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">バナー画像URL（任意）</span>
            <input
              value={current.bannerImage || ''}
              onChange={(event) => updateCurrent({ bannerImage: event.target.value })}
              placeholder="https://..."
              className="h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default ReceiptModeSettingsSection;
