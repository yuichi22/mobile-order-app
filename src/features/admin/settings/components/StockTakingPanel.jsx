import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Archive } from 'lucide-react';

import { getAuth } from 'firebase/auth';

import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import { appConfirm } from '../../../../shared/components/feedback/AppConfirmDialog';
import {
  computeStocktakeValuation,
  finalizeStocktake,
  getCompletedStocktakes,
  startStocktake,
  subscribeToActiveStocktake,
  subscribeToStocktakeItems,
  zeroNegativeInventory
} from '../../../inventory/services/stocktakeDataService';
import { pushInventoryToShopify } from '../../../store/services/storeDataService';

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

const yen = (value) => `¥${Math.round(Number(value) || 0).toLocaleString()}`;

const buildValuationCsv = (valuation, taxLabel) => {
  const header = ['売り場', '点数', `上代合計(${taxLabel})`, `原価合計(${taxLabel})`, '原価不明件数'];
  const lines = [header.map(csvEscape).join(',')];
  valuation.areas.forEach((a) => {
    lines.push([a.name, a.qty, Math.round(a.retail), Math.round(a.cost), a.noCostItems].map(csvEscape).join(','));
  });
  const t = valuation.total;
  lines.push(['合計', t.qty, Math.round(t.retail), Math.round(t.cost), t.noCostItems].map(csvEscape).join(','));
  return lines.join('\r\n');
};

const StockTakingPanel = ({ storeId }) => {
  const [activeStocktake, setActiveStocktake] = useState(undefined);
  const [items, setItems] = useState([]);
  const [starting, setStarting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState(null);
  const [finalizeResults, setFinalizeResults] = useState(null);
  const [finalizeError, setFinalizeError] = useState('');
  const [fixingNegatives, setFixingNegatives] = useState(false);
  const [negativeMessage, setNegativeMessage] = useState('');
  const [completedStocktakes, setCompletedStocktakes] = useState([]);
  const [valuationStocktakeId, setValuationStocktakeId] = useState('');
  const [valuation, setValuation] = useState(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState('');

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

  // 完了棚卸しの一覧を読み込む(在高レポート用)。棚卸し終了直後にも更新する。
  useEffect(() => {
    if (!storeId) return undefined;
    let cancelled = false;
    getCompletedStocktakes(storeId)
      .then((list) => {
        if (cancelled) return;
        setCompletedStocktakes(list);
        setValuationStocktakeId((prev) => prev || list[0]?.id || '');
      })
      .catch((error) => { if (!cancelled) console.error('failed to load completed stocktakes', error); });
    return () => { cancelled = true; };
  }, [storeId, activeStocktake?.id, finalizeResults]);

  const displayItems = activeStocktake?.id ? items : [];

  const handleShowValuation = async () => {
    if (!storeId || !valuationStocktakeId) return;
    setValuationLoading(true);
    setValuationError('');
    setValuation(null);
    try {
      const result = await computeStocktakeValuation(storeId, valuationStocktakeId, { taxMode: 'excluded' });
      setValuation(result);
    } catch (error) {
      console.error('failed to compute stocktake valuation', error);
      setValuationError(`集計に失敗しました: ${error?.message || error}`);
    } finally {
      setValuationLoading(false);
    }
  };

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

    const baseConfirm = '棚卸しを終了します。カウントされなかった商品の在庫は0になります。よろしいですか?';
    // 数え直しリストに未処理の商品が残っている時は、軽く注意を前置きする。
    const remainingRecount = displayItems.filter((item) => item.needsRecount).length;
    const confirmMessage = remainingRecount > 0
      ? `数え直しリストに未処理の商品が${remainingRecount}点あります。\nこのまま終了すると、現在の数のまま在庫に確定されます。\n\n${baseConfirm}`
      : baseConfirm;
    if (!(await appConfirm(confirmMessage, { title: '棚卸し終了', okLabel: '終了して確定する', tone: 'danger' }))) return;

    setFinalizing(true);
    setFinalizeError('');
    setFinalizeProgress({ done: 0, total: 0 });

    try {
      const results = await finalizeStocktake(storeId, activeStocktake.id, (done, total) => {
        setFinalizeProgress({ done, total });
      });
      setFinalizeResults(results);

      // 棚卸し確定で在庫が変わった商品を Shopify へ push（在庫連携ON=prodのみ で実反映。サーバ側でゲート）。
      // 確定差分が最大のドリフト源なのでここで塞ぐ。fire-and-forget・200件ずつ。
      (async () => {
        try {
          const changedIds = (Array.isArray(results) ? results : [])
            .filter((r) => Number(r?.beforeQuantity) !== Number(r?.finalQuantity))
            .map((r) => r.productId)
            .filter(Boolean);
          if (changedIds.length === 0) return;
          const idToken = await getAuth().currentUser?.getIdToken?.();
          for (let i = 0; i < changedIds.length; i += 200) {
            const chunk = changedIds.slice(i, i + 200);
            await pushInventoryToShopify({ storeId, productIds: chunk, idToken });
          }
        } catch (pushError) {
          console.warn('failed to push finalized inventory to Shopify', pushError);
        }
      })();
    } catch (error) {
      console.error('failed to finalize stocktake', error);
      setFinalizeError(`棚卸し終了処理に失敗しました: ${error?.message || error}`);
    } finally {
      setFinalizing(false);
      setFinalizeProgress(null);
    }
  };

  // マイナス在庫を0に修正する(棚卸しと無関係にいつでも実行可)。
  const handleFixNegatives = async () => {
    if (!storeId) return;
    if (!(await appConfirm('マイナス在庫の商品をすべて0に修正します。よろしいですか?', { okLabel: '0に修正する', tone: 'danger' }))) return;

    setFixingNegatives(true);
    setNegativeMessage('');
    try {
      const ids = await zeroNegativeInventory(storeId);
      if (ids.length === 0) {
        setNegativeMessage('マイナス在庫の商品はありませんでした。');
        return;
      }
      setNegativeMessage(`${ids.length}件のマイナス在庫を0に修正しました。`);

      // 在庫連携ON(prod想定)なら Shopify on_hand も0へ。fire-and-forget・200件ずつ。
      (async () => {
        try {
          const idToken = await getAuth().currentUser?.getIdToken?.();
          for (let i = 0; i < ids.length; i += 200) {
            await pushInventoryToShopify({ storeId, productIds: ids.slice(i, i + 200), idToken });
          }
        } catch (pushError) {
          console.warn('failed to push negative-fix inventory to Shopify', pushError);
        }
      })();
    } catch (error) {
      console.error('failed to fix negative inventory', error);
      setNegativeMessage(`修正に失敗しました: ${error?.message || error}`);
    } finally {
      setFixingNegatives(false);
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

            {finalizing && finalizeProgress ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                {finalizeProgress.total > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-xs font-black text-rose-600">
                      <span>在庫を反映中…</span>
                      <span>
                        {finalizeProgress.done.toLocaleString()} / {finalizeProgress.total.toLocaleString()}
                        （{Math.round((finalizeProgress.done / finalizeProgress.total) * 100)}%）
                      </span>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-rose-100">
                      <div
                        className="h-full rounded-full bg-rose-500 transition-all duration-300"
                        style={{ width: `${Math.round((finalizeProgress.done / finalizeProgress.total) * 100)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs font-black text-rose-600">準備中…（商品データを取得しています）</p>
                )}
                <p className="mt-2 text-[11px] font-bold text-rose-400">この画面を閉じずにお待ちください。</p>
              </div>
            ) : null}

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

      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <p className="text-sm font-black text-slate-900">棚卸し 在高レポート（売り場別・税抜）</p>
        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
          過去の棚卸しを選ぶと、完了日時点の在庫で売り場別の上代合計・原価合計を集計します。
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={valuationStocktakeId}
            onChange={(event) => { setValuationStocktakeId(event.target.value); setValuation(null); }}
            className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400"
          >
            {completedStocktakes.length === 0 ? (
              <option value="">完了した棚卸しがありません</option>
            ) : (
              completedStocktakes.map((st) => (
                <option key={st.id} value={st.id}>
                  {formatDateTimeText(st.completedAt)} 完了
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={handleShowValuation}
            disabled={valuationLoading || !valuationStocktakeId}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {valuationLoading ? <LoadingSpinner size={16} /> : null}
            集計する
          </button>
        </div>

        {valuationError ? <p className="mt-3 text-xs font-bold text-rose-500">{valuationError}</p> : null}

        {valuation ? (
          <div className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-100 text-xs font-black text-slate-400">
                    <th className="py-2 text-left">売り場</th>
                    <th className="py-2 text-right">点数</th>
                    <th className="py-2 text-right">上代合計</th>
                    <th className="py-2 text-right">原価合計</th>
                    <th className="py-2 text-right">原価不明</th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.areas.map((a) => (
                    <tr key={a.areaId} className="border-b border-slate-50 font-bold text-slate-700">
                      <td className="py-2 text-left">{a.name}</td>
                      <td className="py-2 text-right tabular-nums">{a.qty.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums">{yen(a.retail)}</td>
                      <td className="py-2 text-right tabular-nums">{yen(a.cost)}</td>
                      <td className="py-2 text-right tabular-nums text-orange-500">{a.noCostItems ? `${a.noCostItems}件` : '-'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 font-black text-slate-900">
                    <td className="py-2 text-left">合計</td>
                    <td className="py-2 text-right tabular-nums">{valuation.total.qty.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{yen(valuation.total.retail)}</td>
                    <td className="py-2 text-right tabular-nums">{yen(valuation.total.cost)}</td>
                    <td className="py-2 text-right tabular-nums text-orange-500">{valuation.total.noCostItems ? `${valuation.total.noCostItems}件` : '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {valuation.total.noCostItems > 0 ? (
              <p className="mt-2 text-[11px] font-bold leading-relaxed text-orange-500">
                ※ 原価（掛け率）が未設定の商品が {valuation.total.noCostItems.toLocaleString()} 件あり、その分の原価は0で集計しています。掛け率を入力すると原価合計が正確になります。
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => downloadCsv(
                  buildValuationCsv(valuation, '税抜'),
                  `stocktake_valuation_${storeId}_${valuationStocktakeId}.csv`
                )}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-xs font-black text-white shadow-sm transition hover:bg-slate-700"
              >
                CSVを保存
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-900">マイナス在庫の修正</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
              売り越しなどで在庫がマイナスになった商品を、まとめて0に修正します。
            </p>
          </div>
          <button
            type="button"
            onClick={handleFixNegatives}
            disabled={fixingNegatives}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fixingNegatives ? <LoadingSpinner size={16} /> : null}
            マイナス在庫を0に修正
          </button>
        </div>
        {negativeMessage ? (
          <p className="mt-3 text-xs font-bold text-slate-600">{negativeMessage}</p>
        ) : null}
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
