import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';

import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';
import BarcodeScanner from '../components/BarcodeScanner';
import { findProductByBarcode, subscribeToActiveStocktake } from '../services/stocktakeDataService';

const StocktakePage = ({ storeId }) => {
  const [activeStocktake, setActiveStocktake] = useState(undefined);
  const [scanning, setScanning] = useState(false);
  const [lookupState, setLookupState] = useState('idle');
  const [scannedProduct, setScannedProduct] = useState(null);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const hasDetectedRef = useRef(false);

  useEffect(() => {
    if (!storeId) return undefined;

    return subscribeToActiveStocktake(storeId, setActiveStocktake, () => setActiveStocktake(null));
  }, [storeId]);

  const handleDetected = (code) => {
    if (hasDetectedRef.current) return;
    hasDetectedRef.current = true;
    setScanning(false);
    setScannedBarcode(code);
    setLookupState('loading');

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
    setScanning(true);
  };

  const cancelScanning = () => {
    setScanning(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-md space-y-4 pt-6">
        <div>
          <h1 className="text-xl font-black text-slate-900">棚卸し</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">
            バーコードをスキャンして商品を呼び出します。
          </p>
          <p className="mt-1 text-xs font-bold text-slate-300">storeId: {storeId || '(なし)'}</p>
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
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-400">
                  カウント入力はこの後のステップで追加します。
                </div>
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
      </div>
    </div>
  );
};

export default StocktakePage;
