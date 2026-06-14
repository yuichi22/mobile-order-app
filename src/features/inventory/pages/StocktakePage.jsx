import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, ListChecks, RefreshCw, Truck, X } from 'lucide-react';

import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';
import BarcodeScanner from '../components/BarcodeScanner';
import {
  addToRecountList,
  findProductByBarcode,
  getStocktakeItem,
  recordStocktakeCount,
  recordWarehouseToStorefrontTransfer,
  subscribeToActiveStocktake,
  subscribeToStocktakeItems
} from '../services/stocktakeDataService';

const LOCATION_OPTIONS = [
  { id: 'warehouse', label: '倉庫' },
  { id: 'storefront', label: '店頭' }
];

const StocktakePage = ({ storeId }) => {
  const [activeStocktake, setActiveStocktake] = useState(undefined);
  const [stocktakeItems, setStocktakeItems] = useState([]);
  const [viewTab, setViewTab] = useState('scan');
  const [scanning, setScanning] = useState(false);
  const [lookupState, setLookupState] = useState('idle');
  const [scannedProduct, setScannedProduct] = useState(null);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [existingItem, setExistingItem] = useState(undefined);
  const [selectedLocation, setSelectedLocation] = useState('warehouse');
  const [quantityInput, setQuantityInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [transferQuantityInput, setTransferQuantityInput] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferMessage, setTransferMessage] = useState('');
  const [recountSaving, setRecountSaving] = useState(false);
  const [recountMessage, setRecountMessage] = useState('');
  const hasDetectedRef = useRef(false);

  useEffect(() => {
    if (!storeId) return undefined;

    return subscribeToActiveStocktake(storeId, setActiveStocktake, () => setActiveStocktake(null));
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !activeStocktake?.id) {
      return undefined;
    }

    return subscribeToStocktakeItems(storeId, activeStocktake.id, setStocktakeItems, () => setStocktakeItems([]));
  }, [storeId, activeStocktake?.id]);

  // スキャンされた商品が確定したら、現在の棚卸しカウントを取得する。
  useEffect(() => {
    if (lookupState !== 'found' || !storeId || !activeStocktake?.id || !scannedProduct?.id) {
      return undefined;
    }

    let cancelled = false;

    getStocktakeItem(storeId, activeStocktake.id, scannedProduct.id)
      .then((item) => {
        if (!cancelled) setExistingItem(item || null);
      })
      .catch((error) => {
        console.error('failed to load stocktake item', error);
        if (!cancelled) setExistingItem(null);
      });

    return () => {
      cancelled = true;
    };
  }, [lookupState, storeId, activeStocktake?.id, scannedProduct?.id]);

  const displayItems = activeStocktake?.id ? stocktakeItems : [];
  const recountItems = displayItems.filter((item) => item.needsRecount);

  const resetScanResultState = () => {
    setExistingItem(undefined);
    setQuantityInput('');
    setSaveMessage('');
    setSaveError('');
    setTransferQuantityInput('');
    setTransferMessage('');
    setTransferError('');
    setRecountMessage('');
  };

  const handleDetected = (code) => {
    if (hasDetectedRef.current) return;
    hasDetectedRef.current = true;
    setScanning(false);
    setScannedBarcode(code);
    setLookupState('loading');
    resetScanResultState();

    findProductByBarcode(storeId, code)
      .then((product) => {
        if (product) {
          setScannedProduct(product);
          setLookupState('found');
        } else {
          setScannedProduct(null);
          setLookupState('not_found');
        }
      })
      .catch((error) => {
        console.error('failed to look up product', error);
        setScannedProduct(null);
        setLookupState('error');
      });
  };

  const startScanning = () => {
    hasDetectedRef.current = false;
    setScannedProduct(null);
    setScannedBarcode('');
    setLookupState('idle');
    resetScanResultState();
    setScanning(true);
  };

  const cancelScanning = () => {
    setScanning(false);
  };

  const handleSaveCount = async () => {
    const quantity = Number(quantityInput);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    if (!storeId || !activeStocktake?.id || !scannedProduct?.id) return;

    setSaving(true);
    setSaveError('');
    setSaveMessage('');

    try {
      await recordStocktakeCount(storeId, activeStocktake.id, scannedProduct, {
        location: selectedLocation,
        quantity
      });

      setExistingItem((prev) => {
        const base = prev || {};
        if (selectedLocation === 'warehouse') {
          return {
            ...base,
            warehouseQuantity: Number(base.warehouseQuantity || 0) + quantity
          };
        }
        return {
          ...base,
          storefrontShelfQuantity: Number(base.storefrontShelfQuantity || 0) + quantity,
          needsRecount: false
        };
      });

      setSaveMessage(`保存しました(追加: ${quantity}個)`);
      setQuantityInput('');
    } catch (error) {
      console.error('failed to save stocktake count', error);
      setSaveError(`保存に失敗しました: ${error?.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTransfer = async () => {
    const quantity = Number(transferQuantityInput);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    if (!storeId || !activeStocktake?.id || !scannedProduct?.id) return;

    setTransferSaving(true);
    setTransferError('');
    setTransferMessage('');

    try {
      await recordWarehouseToStorefrontTransfer(storeId, activeStocktake.id, scannedProduct, quantity);

      setExistingItem((prev) => {
        const base = prev || {};
        const wasStorefrontConfirmed = Boolean(base.storefrontConfirmedAt);

        return {
          ...base,
          warehouseQuantity: Number(base.warehouseQuantity || 0) - quantity,
          transferToStorefront: Number(base.transferToStorefront || 0) + quantity,
          ...(wasStorefrontConfirmed
            ? { storefrontShelfQuantity: Number(base.storefrontShelfQuantity || 0) + quantity }
            : {})
        };
      });

      setTransferMessage(`出庫しました(${quantity}個)`);
      setTransferQuantityInput('');
    } catch (error) {
      console.error('failed to record transfer', error);
      setTransferError(`出庫の記録に失敗しました: ${error?.message || error}`);
    } finally {
      setTransferSaving(false);
    }
  };

  const handleAddToRecount = async () => {
    if (!storeId || !activeStocktake?.id || !scannedProduct?.id) return;

    setRecountSaving(true);
    setRecountMessage('');

    try {
      await addToRecountList(storeId, activeStocktake.id, scannedProduct);
      setExistingItem((prev) => (prev ? { ...prev, needsRecount: true } : prev));
      setRecountMessage('数え直しリストに追加しました。');
    } catch (error) {
      console.error('failed to add to recount list', error);
      setRecountMessage('追加に失敗しました。');
    } finally {
      setRecountSaving(false);
    }
  };

  const existingCountForLocation = selectedLocation === 'warehouse'
    ? Number(existingItem?.warehouseQuantity || 0)
    : Number(existingItem?.storefrontShelfQuantity || 0);
  const existingTransferToStorefront = Number(existingItem?.transferToStorefront || 0);

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-md space-y-4 pt-6">
        <div>
          <h1 className="text-xl font-black text-slate-900">棚卸し</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            バーコードをスキャンして商品を呼び出します。
          </p>
        </div>

        {activeStocktake === undefined ? (
          <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white p-10">
            <LoadingSpinner />
          </div>
        ) : activeStocktake === null ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-500">
            現在進行中の棚卸しはありません。管理画面の「在庫管理 &gt; 棚卸」から開始してください。
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
              <button
                type="button"
                onClick={() => setViewTab('scan')}
                className={`h-10 rounded-xl text-sm font-black transition ${
                  viewTab === 'scan' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                スキャン
              </button>
              <button
                type="button"
                onClick={() => setViewTab('recount')}
                className={`h-10 rounded-xl text-sm font-black transition ${
                  viewTab === 'recount' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'
                }`}
              >
                数え直し({recountItems.length})
              </button>
            </div>

            {viewTab === 'recount' ? (
              <div className="space-y-3">
                {recountItems.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-bold text-slate-500">
                    数え直し対象の商品はありません。
                  </div>
                ) : (
                  recountItems.map((item) => (
                    <div key={item.id} className="rounded-3xl border border-orange-100 bg-orange-50 p-4">
                      <p className="text-sm font-black text-slate-900">{item.name || '名称未設定'}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        品番: {item.sku || '-'} / バーコード: {item.barcode || '-'}
                      </p>
                      <p className="mt-1 text-xs font-bold text-orange-500">
                        倉庫: {Number(item.warehouseQuantity || 0).toLocaleString()} / 店頭: {Number(item.storefrontShelfQuantity || 0).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                {scanning ? (
                  <div className="space-y-3">
                    <BarcodeScanner active={scanning} onDetected={handleDetected} />
                    <button
                      type="button"
                      onClick={cancelScanning}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-200 text-sm font-black text-slate-600 transition hover:bg-slate-300"
                    >
                      <X size={16} />
                      スキャンをやめる
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startScanning}
                    className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-base font-black text-white shadow-sm transition hover:bg-blue-700"
                  >
                    <Camera size={20} />
                    バーコードをスキャン
                  </button>
                )}

                {lookupState === 'loading' && (
                  <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white p-8">
                    <LoadingSpinner />
                  </div>
                )}

                {lookupState === 'found' && scannedProduct && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-400">Scanned</p>
                    <h2 className="mt-1 text-lg font-black text-slate-900">{scannedProduct.name || '名称未設定'}</h2>
                    <div className="mt-3 space-y-1 text-sm font-bold text-slate-500">
                      <p>品番: {scannedProduct.sku || scannedProduct.productCode || '-'}</p>
                      <p>バーコード: {scannedProduct.barcode || scannedBarcode}</p>
                      {scannedProduct.size ? <p>サイズ: {scannedProduct.size}</p> : null}
                      {scannedProduct.colorName ? <p>色: {scannedProduct.colorName}</p> : null}
                      <p>現在の在庫数: {Number(scannedProduct.inventoryQuantity ?? scannedProduct.quantity ?? 0).toLocaleString()}</p>
                    </div>

                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">カウント場所</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {LOCATION_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setSelectedLocation(option.id)}
                            className={`h-11 rounded-2xl text-sm font-black transition ${
                              selectedLocation === option.id
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                        <p className="text-sm font-black text-blue-700">追加で数えた個数</p>
                        <p className="mt-1 text-xs font-bold text-blue-400">
                          {selectedLocation === 'warehouse' ? '倉庫での在庫カウントを加算します。' : '店頭での在庫カウントを加算し、確定します。'}
                        </p>

                        {existingItem === undefined ? (
                          <div className="mt-2 flex items-center justify-center rounded-2xl bg-white/60 p-3">
                            <LoadingSpinner size={16} />
                          </div>
                        ) : existingCountForLocation > 0 ? (
                          <p className="mt-2 rounded-2xl bg-orange-50 px-4 py-3 text-xs font-bold leading-relaxed text-orange-600">
                            すでに{existingCountForLocation.toLocaleString()}個カウント済みです。追加で数える分だけ入力してください。
                          </p>
                        ) : null}

                        <div className="mt-3 flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            value={quantityInput}
                            onChange={(event) => setQuantityInput(event.target.value)}
                            placeholder="追加で数えた個数"
                            className="h-12 flex-1 rounded-2xl border-2 border-white bg-white px-4 text-base font-black text-slate-900 outline-none transition focus:border-blue-400"
                          />
                          <button
                            type="button"
                            onClick={handleSaveCount}
                            disabled={saving || existingItem === undefined || !quantityInput || Number(quantityInput) <= 0}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? <LoadingSpinner size={16} /> : <Check size={16} />}
                            保存
                          </button>
                        </div>

                        {saveMessage ? (
                          <p className="mt-2 text-xs font-bold text-blue-600">{saveMessage}</p>
                        ) : null}
                        {saveError ? (
                          <p className="mt-2 text-xs font-bold text-rose-500">{saveError}</p>
                        ) : null}
                      </div>

                      {selectedLocation === 'warehouse' && (
                        <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                          <div className="flex items-center gap-2">
                            <Truck size={16} className="text-amber-600" />
                            <p className="text-sm font-black text-amber-700">出庫する個数(店頭への品出し)</p>
                          </div>
                          <p className="mt-1 text-xs font-bold text-amber-500">
                            倉庫から店頭へ移動した分を入力してください。倉庫数が減り、店頭が確定済みなら店頭数に加算されます。
                          </p>

                          {existingItem === undefined ? (
                            <div className="mt-2 flex items-center justify-center rounded-2xl bg-white/60 p-3">
                              <LoadingSpinner size={16} />
                            </div>
                          ) : existingTransferToStorefront > 0 ? (
                            <p className="mt-2 rounded-2xl bg-white px-4 py-3 text-xs font-bold leading-relaxed text-amber-600">
                              すでに{existingTransferToStorefront.toLocaleString()}個出庫済みです。追加で出庫する分だけ入力してください。
                            </p>
                          ) : null}

                          <div className="mt-3 flex items-center gap-2">
                            <input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={transferQuantityInput}
                              onChange={(event) => setTransferQuantityInput(event.target.value)}
                              placeholder="出庫する個数"
                              className="h-12 flex-1 rounded-2xl border-2 border-white bg-white px-4 text-base font-black text-slate-900 outline-none transition focus:border-amber-400"
                            />
                            <button
                              type="button"
                              onClick={handleSaveTransfer}
                              disabled={transferSaving || existingItem === undefined || !transferQuantityInput || Number(transferQuantityInput) <= 0}
                              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 text-sm font-black text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {transferSaving ? <LoadingSpinner size={16} /> : <Truck size={16} />}
                              保存
                            </button>
                          </div>

                          {transferMessage ? (
                            <p className="mt-2 text-xs font-bold text-amber-600">{transferMessage}</p>
                          ) : null}
                          {transferError ? (
                            <p className="mt-2 text-xs font-bold text-rose-500">{transferError}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {existingItem ? (
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <button
                          type="button"
                          onClick={handleAddToRecount}
                          disabled={recountSaving || existingItem?.needsRecount}
                          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-orange-50 text-sm font-black text-orange-600 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {recountSaving ? <LoadingSpinner size={16} /> : <ListChecks size={16} />}
                          {existingItem?.needsRecount ? '数え直し対象に登録済み' : '数え直し対象に追加'}
                        </button>
                        {recountMessage ? (
                          <p className="mt-2 text-center text-xs font-bold text-orange-500">{recountMessage}</p>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={startScanning}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white transition hover:bg-slate-700"
                    >
                      <RefreshCw size={16} />
                      次をスキャン
                    </button>
                  </div>
                )}

                {lookupState === 'not_found' && (
                  <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 text-center">
                    <p className="text-sm font-black text-rose-600">商品が見つかりませんでした</p>
                    <p className="mt-1 text-xs font-bold text-rose-400">バーコード: {scannedBarcode}</p>
                    <button
                      type="button"
                      onClick={startScanning}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white transition hover:bg-slate-700"
                    >
                      <RefreshCw size={16} />
                      再スキャン
                    </button>
                  </div>
                )}

                {lookupState === 'error' && (
                  <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 text-center">
                    <p className="text-sm font-black text-rose-600">商品の検索に失敗しました</p>
                    <button
                      type="button"
                      onClick={startScanning}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white transition hover:bg-slate-700"
                    >
                      <RefreshCw size={16} />
                      再スキャン
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default StocktakePage;
