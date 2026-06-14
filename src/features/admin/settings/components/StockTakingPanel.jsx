import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Archive } from 'lucide-react';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import {
  finalizeStocktake,
  startStocktake,
  subscribeToActiveStocktake,
  subscribeToStocktakeItems
} from '../../../inventory/services/stocktakeDataService';

const formatDateTimeText = (value) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const buildCsvContent = (rows) => {
  const header = ['商品ID', '商品名', '品番', 'バーコード', '倉庫数', '店頭数', '更新前在庫', '更新後在庫'];
  const lines = [header.map(csvEscape).join(',')];

  rows.forEach((row) => {
    lines.push([
      row.productId,
      row.name,
      row.sku,
      row.barcode,
      row.warehouseQuantity,
      row.storefrontQuantity,
      row.beforeQuantity,
      row.finalQuantity
    ].map(csvEscape).join(','));
  });

  return lines.join('\r\n');
};

const downloadCsv = (content, filename) => {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const StockTakingPanel = ({ storeId }) => {
  const [activeStocktake, setActiveStocktake] = useState(undefined);
  const [items, setItems] = useState([]);
  const [starting, setStarting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeResults, setFinalizeResults] = useState(null);
  const [finalizeError, setFinalizeError] = useState('');

  useEffect(() => {
    if (!storeId) return undefined;

    return subscribeToActiveStocktake(storeId, setActiveStocktake, () => setActiveStocktake(null));
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !activeStocktake?.id) {
      return undefined;
    }

    return subscribeToStocktakeItems(storeId, activeStocktake.id, setItems, () => setItems([]));
  }, [storeId, activeStocktake?.id]);

  const displayItems = activeStocktake?.id ? items : [];

  const handleStart = async () => {
    if (!storeId) return;

    setStarting(true);
    try {
      await startStocktake(storeId);
      setFinalizeResults(null);
    } catch (error) {
      console.error('failed to start stocktake', error);
      window.alert(`棚卸し開始に失敗しました: ${error?.message || error}`);
    } finally {
      setStarting(false);
    }
  };

  const handleFinalize = async () => {
    if (!storeId || !activeStocktake?.id) return;
    if (!window.confirm('棚卸しを終了します。カウントされなかった商品の在庫は0になります。よろしいですか?')) return;

    setFinalizing(true);
    setFinalizeError('');

    try {
      const results = await finalizeStocktake(storeId, activeStocktake.id);
      setFinalizeResults(results);
    } catch (error) {
      console.error('failed to finalize stocktake', error);
      setFinalizeError(`棚卸し終了処理に失敗しました: ${error?.message || error}`);
    } finally {
      setFinalizing(false);
    }
  };

  const stocktakeUrl = storeId && typeof window !== 'undefined'
    ? `${window.location.origin}/stocktake?store_id=${storeId}`
    : '';

  const recountCount = displayItems.filter((item) => item.needsRecount).length;
  const warehouseCountedCount = displayItems.filter((item) => Boolean(item.warehouseCountedAt)).length;
  const storefrontCountedCount = displayItems.filter((item) => Boolean(item.storefrontConfirmedAt)).length;

  if (activeStocktake === undefined) {
    return (
      <div className="mt-5 flex items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-black text-slate-900">棚卸しの進め方</h3>
        <ol className="mt-3 space-y-2 text-sm font-bold leading-relaxed text-slate-600">
          <li>1. まず倉庫の在庫をスキャンしてカウントします。</li>
          <li>2. 売場の在庫もスキャンしてカウントします。カウントしてから1時間、その商品が売れなければそのまま確定します。</li>
          <li>3. カウントから確定までの1時間以内にその商品が売れた場合は「数え直しリスト」に入るので、もう一度数えてください。</li>
          <li>4. 確定後は、販売分が自動でバックグラウンドで反映されていきます。</li>
          <li>5. 品出しで倉庫から売場へ商品を移動した場合は、端末から出庫数を入力してください。</li>
          <li>6. 棚卸し期間中は同じ操作を繰り返し、最後に「棚卸し終了」を押すとカウントされなかった商品の在庫が0になります。</li>
        </ol>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        {activeStocktake ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500">進行中</p>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  開始: {formatDateTimeText(activeStocktake.startedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={finalizing}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {finalizing ? <LoadingSpinner size={16} /> : null}
                棚卸し終了
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-2xl font-black text-slate-900">{warehouseCountedCount}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">倉庫カウント済み</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-2xl font-black text-slate-900">{storefrontCountedCount}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">店頭確定済み</p>
              </div>
              <div className="rounded-2xl bg-orange-50 p-4">
                <p className="text-2xl font-black text-orange-600">{recountCount}</p>
                <p className="mt-1 text-xs font-bold text-orange-500">数え直し対象</p>
              </div>
            </div>

            {finalizeError ? (
              <p className="mt-4 text-sm font-bold text-rose-500">{finalizeError}</p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-500">現在進行中の棚卸しはありません。</p>
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? <LoadingSpinner size={16} /> : <Archive size={16} />}
              棚卸し開始
            </button>
          </div>
        )}
      </div>

      {finalizeResults ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-900">棚卸し結果</p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {finalizeResults.length.toLocaleString()}件の在庫を更新しました。確認のためCSVを保存できます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadCsv(
                buildCsvContent(finalizeResults),
                `stocktake_${storeId}_${new Date().toISOString().slice(0, 10)}.csv`
              )}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-700"
            >
              CSVを保存
            </button>
          </div>
        </div>
      ) : null}

      {stocktakeUrl ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm font-black text-slate-900">スマホでスキャン画面を開く</p>
          <p className="mt-1 text-xs font-bold text-slate-500">
            スタッフのスマホでこのQRコードを読み込んでください
          </p>
          <div className="mx-auto mt-5 flex w-fit rounded-[1.25rem] bg-white p-4 shadow-inner ring-1 ring-slate-100">
            <QRCodeSVG value={stocktakeUrl} size={180} level="M" includeMargin />
          </div>
          <p className="mx-auto mt-4 max-w-md break-all rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-bold leading-relaxed text-slate-500">
            {stocktakeUrl}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default StockTakingPanel;
