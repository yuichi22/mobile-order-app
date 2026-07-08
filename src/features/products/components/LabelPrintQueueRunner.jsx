import React, { useEffect, useRef, useState } from 'react';
import {
  collection, query, where, onSnapshot,
  deleteDoc, updateDoc, runTransaction, serverTimestamp
} from 'firebase/firestore';
import { Printer, AlertTriangle } from 'lucide-react';
import { db } from '../../../shared/api/firebase/client';
import { buildLabelPrintPayload } from '../../../shared/utils/labelPrinterSettings';
import { printLabelViaBridge } from '../../../shared/api/printBridge';

// モバイル登録など、プリンタに繋がらない端末が積んだラベル印刷ジョブ(stores/{id}/labelPrintQueue)を
// プリンタのあるPC(この商品マスタ画面)が購読し、枚数分を自動印刷して削除する。
// 複数PCが同時に開いていても二重印刷しないよう、印刷前にトランザクションでジョブを1台だけが確保(claim)する。
export default function LabelPrintQueueRunner({ storeId, labelPrinterSettings }) {
  const processingRef = useRef(false);
  const pendingDocsRef = useRef(null);
  const settingsRef = useRef(labelPrinterSettings);
  const [errorCount, setErrorCount] = useState(0);
  const [lastPrinted, setLastPrinted] = useState(null); // { name, copies }

  useEffect(() => { settingsRef.current = labelPrinterSettings; }, [labelPrinterSettings]);

  // 待機中ジョブを購読。変化のたびに drain() を起動(実処理中は多重起動しない)。
  useEffect(() => {
    if (!storeId) return undefined;
    // 単一フィールド条件のみ(複合インデックス不要)。並び順(FIFO)はクライアント側でソート。
    const pendingQuery = query(
      collection(db, 'stores', storeId, 'labelPrintQueue'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(pendingQuery, (snap) => {
      const docs = [...snap.docs].sort((a, b) => {
        const at = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
        const bt = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
        return at - bt;
      });
      pendingDocsRef.current = docs;
      void drain();
    }, () => { /* 権限/接続エラーは無視(印刷しないだけ) */ });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // 失敗ジョブ数を購読(再印刷ボタン表示用)。
  useEffect(() => {
    if (!storeId) return undefined;
    const errorQuery = query(
      collection(db, 'stores', storeId, 'labelPrintQueue'),
      where('status', '==', 'error')
    );
    const unsub = onSnapshot(errorQuery, (snap) => setErrorCount(snap.size), () => setErrorCount(0));
    return unsub;
  }, [storeId]);

  const buildItem = (job) => {
    const p = job.product || {};
    const barcode = String(p.barcode || '').trim();
    const sku = String(p.sku || p.productCode || '').trim();
    // 符号化データ(設定 barcodeSource)が空なら印刷不可 → スキップ対象。
    const encoded = settingsRef.current?.barcodeSource === 'barcode' ? barcode : sku;
    if (!encoded) return null;
    return {
      barcode,
      sku,
      name: String(p.name || '').trim(),
      price: p.priceTaxIncluded ?? p.priceTaxExcluded ?? '',
      colorName: String(p.colorName || '').trim(),
      size: String(p.size || '').trim(),
      copies: Math.max(1, Math.min(999, Number(job.copies || 1)))
    };
  };

  const drain = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (pendingDocsRef.current && pendingDocsRef.current.length) {
        const docs = pendingDocsRef.current;
        pendingDocsRef.current = null;
        // eslint-disable-next-line no-restricted-syntax
        for (const docSnap of docs) {
          const ref = docSnap.ref;
          // 1台だけが確保: pending → printing。既に他が確保済みなら null でスキップ。
          let job = null;
          try {
            // eslint-disable-next-line no-await-in-loop
            job = await runTransaction(db, async (tx) => {
              const cur = await tx.get(ref);
              if (!cur.exists() || cur.data().status !== 'pending') return null;
              tx.update(ref, { status: 'printing', claimedAt: serverTimestamp() });
              return cur.data();
            });
          } catch (_) { job = null; }
          if (!job) continue;

          const item = buildItem(job);
          if (!item) {
            // 符号化データ無し = 印刷できない。放置せず削除(登録自体は済んでいる)。
            // eslint-disable-next-line no-await-in-loop
            await deleteDoc(ref).catch(() => {});
            continue;
          }
          try {
            const payload = buildLabelPrintPayload(settingsRef.current, [item]);
            // eslint-disable-next-line no-await-in-loop
            await printLabelViaBridge(payload, { labelPrinterSettings: settingsRef.current });
            // eslint-disable-next-line no-await-in-loop
            await deleteDoc(ref).catch(() => {});
            setLastPrinted({ name: item.name, copies: item.copies });
          } catch (error) {
            // プリンタ未接続など。error にして停止(ループ再突入で無限リトライしない)。
            // eslint-disable-next-line no-await-in-loop
            await updateDoc(ref, {
              status: 'error',
              errorAt: serverTimestamp(),
              errorMessage: String(error?.message || error)
            }).catch(() => {});
          }
        }
      }
    } finally {
      processingRef.current = false;
    }
  };

  // 失敗ジョブを pending に戻して再印刷。
  const retryErrors = async () => {
    try {
      const errorQuery = query(
        collection(db, 'stores', storeId, 'labelPrintQueue'),
        where('status', '==', 'error')
      );
      const unsub = onSnapshot(errorQuery, async (snap) => {
        unsub();
        // eslint-disable-next-line no-restricted-syntax
        for (const d of snap.docs) {
          // eslint-disable-next-line no-await-in-loop
          await updateDoc(d.ref, { status: 'pending', retriedAt: serverTimestamp() }).catch(() => {});
        }
      });
    } catch (_) { /* noop */ }
  };

  if (!storeId) return null;
  if (errorCount === 0 && !lastPrinted) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
      {lastPrinted && errorCount === 0 && (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 font-bold text-emerald-700">
          <Printer size={13} /> ラベル自動印刷: 「{lastPrinted.name}」×{lastPrinted.copies}
        </span>
      )}
      {errorCount > 0 && (
        <span className="inline-flex items-center gap-2 rounded-md bg-rose-50 px-2 py-1 font-bold text-rose-700">
          <AlertTriangle size={13} /> ラベル印刷失敗 {errorCount}件（プリンタ接続を確認）
          <button type="button" onClick={retryErrors} className="rounded bg-rose-600 px-2 py-0.5 text-white active:scale-95">
            再印刷
          </button>
        </span>
      )}
    </div>
  );
}
