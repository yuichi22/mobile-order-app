import React, { useEffect, useState } from 'react';
import { Check, Printer, Search, Bluetooth, Wifi, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { RECEIPT_PRINT_METHODS, buildReceiptModeDraft } from '../../../../shared/utils/receiptSettings';
import { StarPrinter } from '../../../../shared/plugins/starPrinter';
import { checkPrintBridgeHealth, printTestViaBridge } from '../../../../shared/api/printBridge';

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
  items: [
    { name: 'テスト商品A', quantity: 1, totalPrice: 100 },
    { name: 'テスト商品B', quantity: 2, totalPrice: 300 }
  ],
  subtotal: 400,
  discount: 0,
  tax: 36,
  total: 400,
  paymentMethod: '現金'
});

// レジモード(POS共通 / ORDER共通)別のレシート設定。印刷方式・プリンタ・自動印刷・文言をモード別に保存する。
const ReceiptModeSettingsSection = ({ settings, onSave, onSaved }) => {
  const [activeMode, setActiveMode] = useState('pos');
  const [draft, setDraft] = useState(() => buildReceiptModeDraft(settings));
  const [saving, setSaving] = useState(false);

  // Star プリンタ（Capacitorネイティブアプリのみ）
  const isNative = Capacitor.isNativePlatform();
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [testing, setTesting] = useState(false);
  const [starStatus, setStarStatus] = useState(null); // {type:'success'|'error', message}

  // 印刷ブリッジ
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeTesting, setBridgeTesting] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState(null); // {type:'success'|'error', message}

  useEffect(() => {
    // 設定が(遅延)読み込まれた/外部更新されたら下書きを同期する。編集中の頻繁な上書きは避けるため対象フィールドのみ依存。
    setDraft(buildReceiptModeDraft(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.receiptModeSettings, settings?.printerSettings]);

  const current = draft[activeMode] || {};
  const updateCurrent = (patch) => {
    setDraft((prev) => ({ ...prev, [activeMode]: { ...prev[activeMode], ...patch } }));
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ ...settings, receiptModeSettings: draft });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  // 印刷方式（star/bridge）。star を既定とする。
  const isBridge = current.printMethod === 'bridge';

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
        receipt: buildStarTestReceipt(activeMode === 'pos' ? 'POSレジ' : 'ORDERレジ', current, settings),
        identifier: current.starIdentifier || '',
        interface: current.starInterface || 'bluetooth'
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
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Printer size={22} />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tight text-gray-900">レシート設定（レジモード別）</h3>
            <p className="mt-0.5 text-xs font-bold text-gray-400">
              POSレジ・ORDERレジで、印刷方式・プリンタ・自動印刷・文言を分けて設定できます。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-black active:scale-95 disabled:opacity-60"
        >
          {saving ? <LoadingSpinner size={16} /> : <Check size={16} />}
          保存
        </button>
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
              <span className="text-sm font-black text-gray-900">Star プリンタ（Bluetooth / LAN）</span>
            </div>
            <p className="mb-3 text-[11px] font-bold leading-relaxed text-gray-500">
              iPadアプリではこのプリンタへ直接印刷します。先にiPadの「設定 &gt; Bluetooth」でTSP650IIをペアリングしてから、下で検索・選択・テストしてください。
            </p>

            <div className="mb-3 rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-gray-600">
              使用中プリンタ：{current.starIdentifier
                ? <span className="font-mono text-gray-900">{current.starIdentifier}（{current.starInterface || 'bluetooth'}）</span>
                : <span className="text-gray-400">未選択（印刷時に自動探索）</span>}
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
              {current.starIdentifier && (
                <button
                  type="button"
                  onClick={() => updateCurrent({ starIdentifier: '', starInterface: 'bluetooth' })}
                  className="flex h-10 items-center rounded-xl border-2 border-gray-200 bg-white px-4 text-xs font-black text-gray-500 transition hover:bg-gray-50"
                >
                  選択解除（自動探索）
                </button>
              )}
            </div>

            {discovered.length > 0 && (
              <div className="mt-3 space-y-2">
                {discovered.map((printer) => {
                  const selected = current.starIdentifier === printer.identifier;
                  return (
                    <button
                      key={`${printer.identifier}-${printer.interface}`}
                      type="button"
                      onClick={() => updateCurrent({ starIdentifier: printer.identifier, starInterface: printer.interface || 'bluetooth' })}
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
              ※ プリンタを選択したら、画面右上の「保存」を押してください。未選択でも自動探索で印刷を試みます。
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
