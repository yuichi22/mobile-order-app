import React, { useEffect, useState } from 'react';
import { Printer, Wifi, Download, Barcode } from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import {
  LABEL_SYMBOLOGY_OPTIONS,
  getLabelPrinterSettings,
  buildLabelPrintPayload
} from '../../../../shared/utils/labelPrinterSettings';
import { checkPrintBridgeHealth, printLabelViaBridge } from '../../../../shared/api/printBridge';

// バーコードラベルプリンタ（東芝テック B-EV4T / LAN / TPCL）の設定。
// レシート設定と同様、自前保存はせず draft を親(BasicSettings)へ通知し、
// 親の「保存」でまとめて settings.labelPrinterSettings として保存する。
const LabelPrinterSettingsSection = ({ settings, onDraftChange }) => {
  const [draft, setDraft] = useState(() => getLabelPrinterSettings(settings));

  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null); // {type:'success'|'error', message}

  useEffect(() => {
    setDraft(getLabelPrinterSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.labelPrinterSettings]);

  useEffect(() => {
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  const handleCheck = async () => {
    if (checking) return;
    setChecking(true);
    setStatus(null);
    try {
      const result = await checkPrintBridgeHealth({
        printerSettings: { bridgeUrl: draft.bridgeUrl }
      });
      setStatus({
        type: 'success',
        message: `印刷ブリッジに接続できました。${result?.bridgePort ? `(port ${result.bridgePort})` : ''}`
      });
    } catch (error) {
      setStatus({ type: 'error', message: error?.message || '印刷ブリッジに接続できませんでした。' });
    } finally {
      setChecking(false);
    }
  };

  const handleTestPrint = async () => {
    if (testing) return;
    setTesting(true);
    setStatus(null);
    try {
      // テスト用ラベル（JAN13 の有効コードを1枚）。
      const payload = buildLabelPrintPayload(draft, [
        { barcode: '4901234567894', name: 'テスト商品', price: 500, copies: 1 }
      ]);
      await printLabelViaBridge(payload, { labelPrinterSettings: draft });
      setStatus({
        type: 'success',
        message: 'テストラベルを送信しました。プリンタからラベルが出たか確認してください。'
      });
    } catch (error) {
      setStatus({ type: 'error', message: error?.message || 'テスト印刷に失敗しました。' });
    } finally {
      setTesting(false);
    }
  };

  const numberInputClass =
    'h-12 w-full rounded-2xl border-2 border-gray-100 px-4 text-sm font-bold text-gray-700 outline-none transition focus:border-slate-900';

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <Barcode size={22} />
        </div>
        <div>
          <h3 className="text-lg font-black tracking-tight text-gray-900">ラベルプリンタ設定（バーコード）</h3>
          <p className="mt-0.5 text-xs font-bold text-gray-400">
            東芝テック B-EV4T（LAN）へ印刷ブリッジ経由でバーコードラベルを印刷します。上部またはフッターの「保存」で保存されます。
          </p>
        </div>
      </div>

      <label className="mb-5 flex items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3">
        <input
          type="checkbox"
          checked={Boolean(draft.enabled)}
          onChange={(event) => update({ enabled: event.target.checked })}
          className="h-5 w-5 rounded border-gray-300"
        />
        <span className="text-sm font-black text-gray-700">ラベル印刷を使用する</span>
      </label>

      <div className="space-y-5">
        {/* 接続 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">印刷ブリッジURL</span>
            <input
              value={draft.bridgeUrl || ''}
              onChange={(event) => update({ bridgeUrl: event.target.value })}
              placeholder="http://localhost:8787"
              className={numberInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">プリンタIP（B-EV4T）</span>
            <input
              value={draft.printerIp || ''}
              onChange={(event) => update({ printerIp: event.target.value })}
              placeholder="192.168.0.110"
              className={numberInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ポート</span>
            <input
              type="number"
              value={draft.printerPort ?? 9100}
              onChange={(event) => update({ printerPort: Number(event.target.value) || 9100 })}
              placeholder="9100"
              className={numberInputClass}
            />
          </label>
        </div>

        {/* 用紙・バーコード */}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ラベル幅 (mm)</span>
            <input
              type="number"
              value={draft.labelWidthMm}
              onChange={(event) => update({ labelWidthMm: Number(event.target.value) || 0 })}
              className={numberInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ラベル長 (mm)</span>
            <input
              type="number"
              value={draft.labelHeightMm}
              onChange={(event) => update({ labelHeightMm: Number(event.target.value) || 0 })}
              className={numberInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">ギャップ (mm)</span>
            <input
              type="number"
              value={draft.gapMm}
              onChange={(event) => update({ gapMm: Number(event.target.value) || 0 })}
              className={numberInputClass}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">バーコード種別</span>
            <select
              value={draft.symbology}
              onChange={(event) => update({ symbology: event.target.value })}
              className={numberInputClass}
            >
              {LABEL_SYMBOLOGY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">モジュール幅 (dot)</span>
            <input
              type="number"
              min={1}
              max={15}
              value={draft.moduleWidthDots}
              onChange={(event) => update({ moduleWidthDots: Number(event.target.value) || 1 })}
              className={numberInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">バーコード高さ (mm)</span>
            <input
              type="number"
              value={draft.barcodeHeightMm}
              onChange={(event) => update({ barcodeHeightMm: Number(event.target.value) || 0 })}
              className={numberInputClass}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">印字速度</span>
            <input
              type="number"
              value={draft.printSpeed}
              onChange={(event) => update({ printSpeed: Number(event.target.value) || 0 })}
              className={numberInputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-gray-400">印字濃度</span>
            <input
              type="number"
              value={draft.printDensity}
              onChange={(event) => update({ printDensity: Number(event.target.value) || 0 })}
              className={numberInputClass}
            />
          </label>
        </div>

        {/* 印字項目 */}
        <div>
          <span className="mb-2 block text-[11px] font-black uppercase tracking-wider text-gray-400">印字項目</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { key: 'showName', label: '商品名' },
              { key: 'showPrice', label: '価格' },
              { key: 'showBarcodeNumber', label: 'バーコード番号' }
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={Boolean(draft[item.key])}
                  onChange={(event) => update({ [item.key]: event.target.checked })}
                  className="h-5 w-5 rounded border-gray-300"
                />
                <span className="text-sm font-black text-gray-700">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking || testing}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white text-sm font-black text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          >
            {checking ? <LoadingSpinner size={16} /> : <Wifi size={16} />}
            接続確認
          </button>
          <button
            type="button"
            onClick={handleTestPrint}
            disabled={testing || checking}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-black text-white transition hover:bg-black disabled:opacity-60"
          >
            {testing ? <LoadingSpinner size={16} /> : <Printer size={16} />}
            テスト印刷
          </button>
        </div>

        {status && (
          <div
            className={`rounded-xl px-3 py-2 text-xs font-bold leading-relaxed ${
              status.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}
          >
            {status.message}
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <div className="mb-1 text-xs font-black text-gray-700">印刷ブリッジをインストール</div>
          <p className="mb-3 text-[11px] font-bold leading-relaxed text-gray-400">
            ラベル印刷も会計レシートと同じ印刷ブリッジを使います。店頭Windows端末でブリッジを起動してください（初回のみNode.jsが必要）。
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <a
              href="/downloads/mobile-order-print-bridge-mac.zip"
              download
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 transition hover:bg-gray-50"
            >
              <Download size={15} /> Mac版
            </a>
            <a
              href="/downloads/mobile-order-print-bridge-windows.zip"
              download
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-black text-gray-700 transition hover:bg-gray-50"
            >
              <Download size={15} /> Windows版
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-blue-700">
          プリンタIPはルーター側で固定割当してください。用紙サイズ・ギャップ・濃度・速度・モジュール幅は実機で1枚印刷しながら調整してください。
        </div>
      </div>
    </div>
  );
};

export default LabelPrinterSettingsSection;
