import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Printer, QrCode } from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { buildTableEntryUrl } from '../../../../app/routing/appRouteState';
import { db } from '../../../../shared/api/firebase/client';
import LoadingSpinner from '../../../../shared/components/feedback/LoadingSpinner';
import FloorMapCanvas from '../../../../shared/components/floor-map/FloorMapCanvas';
import { useFloorLayout } from '../../../store/hooks';
import {
  createSecureToken,
  hashToken,
  normalizeTableId
} from '../../../../shared/utils/tableAccess';

const sanitizeTableNumberInput = (value) => {
  const digitsOnly = String(value || '').replace(/[^\d]/g, '');
  if (!digitsOnly) return '1';

  const numericValue = Number(digitsOnly);
  if (!Number.isFinite(numericValue) || numericValue < 1) return '1';

  return String(numericValue);
};

const shortenUrl = (url) => {
  if (!url) return '';
  if (url.length <= 46) return url;
  return `${url.slice(0, 24)}...${url.slice(-14)}`;
};

const sanitizeFileName = (value) => (
  String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40)
);

const loadImage = (src) => (
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  })
);

const getTableOptionLabel = (table) => {
  const displayName = String(
    table.tableDisplayName ||
    table.displayName ||
    table.name ||
    ''
  ).trim();

  const tableId = String(table.tableId || table.id || '').trim();

  return displayName || tableId || '未設定';
};

const sortTableOptions = (left, right) => {
  const leftNumber = Number(left.tableId);
  const rightNumber = Number(right.tableId);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return String(left.tableId || '').localeCompare(String(right.tableId || ''), 'ja', {
    numeric: true
  });
};

const QRGenerator = ({ storeId }) => {
  const [tableNum, setTableNum] = useState('1');
  const [tableOptions, setTableOptions] = useState([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableToken, setTableToken] = useState('');
  const [loadedQrUrl, setLoadedQrUrl] = useState('');
  const [loadingToken, setLoadingToken] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);

  const { layoutItems = [], loading: layoutLoading } = useFloorLayout(storeId);

  const safeStoreId = storeId || '';
  const normalizedTableId = normalizeTableId(tableNum);

  const selectedTableOption = useMemo(
    () => tableOptions.find((table) => String(table.tableId) === String(normalizedTableId)) || null,
    [normalizedTableId, tableOptions]
  );

  const selectedTableLabel = selectedTableOption
    ? getTableOptionLabel(selectedTableOption)
    : normalizedTableId;

  useEffect(() => {
    if (!storeId) {
      setTableOptions([]);
      setTablesLoading(false);
      return undefined;
    }

    setTablesLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, 'stores', storeId, 'tables'),
      (snapshot) => {
        const options = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data() || {};
            const tableId = String(data.tableId || snapshotDoc.id || '').trim();

            return {
              id: snapshotDoc.id,
              ...data,
              tableId,
              label: getTableOptionLabel({
                id: snapshotDoc.id,
                ...data,
                tableId
              })
            };
          })
          .filter((table) => table.tableId)
          .sort(sortTableOptions);

        setTableOptions(options);
        setTablesLoading(false);
      },
      (error) => {
        console.warn('[QRGenerator] failed to load tables', error);
        setTableOptions([]);
        setTablesLoading(false);
      }
    );

    return unsubscribe;
  }, [storeId]);


  useEffect(() => {
    if (!storeId || !normalizedTableId) {
      setTableToken('');
      setLoadError('');
      setLoadingToken(false);
      return undefined;
    }

    let isActive = true;

    const ensureTableToken = async () => {
      setLoadingToken(true);

      try {
        setLoadError('');
        const tableRef = doc(db, 'stores', storeId, 'tables', normalizedTableId);
        const snapshot = await getDoc(tableRef);

        if (snapshot.exists()) {
          const data = snapshot.data();

          if (data.tableToken) {
            if (!data.tableTokenHash) {
              await setDoc(
                tableRef,
                {
                  tableId: normalizedTableId,
                  tableToken: data.tableToken,
                  tableTokenHash: await hashToken(data.tableToken),
                  updatedAt: serverTimestamp()
                },
                { merge: true }
              );
            }

            if (isActive) setTableToken(data.tableToken);
            return;
          }
        }

        const nextToken = createSecureToken();
        const tableTokenHash = await hashToken(nextToken);

        await setDoc(
          tableRef,
          {
            tableId: normalizedTableId,
            tableToken: nextToken,
            tableTokenHash,
            createdAt: snapshot.exists()
              ? snapshot.data().createdAt ?? serverTimestamp()
              : serverTimestamp(),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

        if (isActive) setTableToken(nextToken);
      } catch (error) {
        console.error('QR token setup error:', error);
        if (isActive) {
          setTableToken('');
          setLoadError('URLの準備に失敗しました。時間をおいて再度お試しください。');
        }
      } finally {
        if (isActive) setLoadingToken(false);
      }
    };

    ensureTableToken();

    return () => {
      isActive = false;
    };
  }, [storeId, normalizedTableId]);

  const startUrl = useMemo(() => {
    if (!safeStoreId || !normalizedTableId || !tableToken) return '';
    return `${window.location.origin}${buildTableEntryUrl(normalizedTableId, safeStoreId, tableToken)}`;
  }, [normalizedTableId, safeStoreId, tableToken]);

  const qrApiUrl = useMemo(() => {
    if (!startUrl) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(startUrl)}`;
  }, [startUrl]);

  const displayUrl = useMemo(() => shortenUrl(startUrl), [startUrl]);
  const imgLoaded = loadedQrUrl === qrApiUrl;

  const handleCopyUrl = async () => {
    if (!startUrl) return;
    await navigator.clipboard.writeText(startUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const handleDownloadPng = async () => {
    if (!qrApiUrl || !normalizedTableId) return;

    try {
      const qrImage = await loadImage(qrApiUrl);

      const canvas = document.createElement('canvas');
      const width = 1200;
      const height = 1280;
      const qrSize = 960;

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) return;

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      // QRコード
      const qrX = (width - qrSize) / 2;
      const qrY = 70;
      context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      // テーブル名があればテーブル名、なければ番号だけ表示
      const customTableName = String(
        selectedTableOption?.tableDisplayName ||
        selectedTableOption?.displayName ||
        selectedTableOption?.name ||
        ''
      ).trim();

      const mainLabel = customTableName || String(normalizedTableId || tableNum || '').trim();

      context.fillStyle = '#111827';
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      context.font = 'bold 112px sans-serif';
      context.fillText(mainLabel, width / 2, 1130);

      const fileLabel = sanitizeFileName(mainLabel || normalizedTableId);
      const fileName = customTableName
        ? `QR_${fileLabel}_テーブル${normalizedTableId}.png`
        : `QR_テーブル${normalizedTableId}.png`;

      const link = document.createElement('a');
      link.download = fileName;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('[QRGenerator] failed to download png', error);
      alert('PNG保存に失敗しました。時間をおいて再度お試しください。');
    }
  };

  if (!storeId) {
    return <div className="p-8 text-center text-gray-400">店舗IDを読み込み中...</div>;
  }

  return (
    <div className="w-full animate-in fade-in duration-300 pb-20">
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
        <div className="flex h-24 items-center justify-between border-b bg-orange-50/50 px-8 transition-none print:hidden">
          <div className="flex items-center gap-5">
            <div className="rounded-2xl bg-orange-500 p-3 text-white shadow-xl shadow-orange-200">
              <QrCode size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">
                QRコード発行
              </h3>
              <p className="mt-0.5 text-[10px] font-black tracking-[0.2em] text-orange-300">
                テーブル選択 / 共有URL / 印刷
              </p>
            </div>
          </div>
          <div className="min-w-[120px]" />
        </div>

        <div className="p-6 print:p-0 lg:p-8">
          <div className="space-y-6 print:block">
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px] print:block">
              <section className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm print:hidden">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black tracking-[0.18em] text-orange-400">
                      発行するテーブル
                    </div>
                    <p className="mt-1 text-xs font-bold text-gray-400">
                      レイアウト上のテーブルを選択してください。
                    </p>
                  </div>

                  {tablesLoading || layoutLoading ? (
                    <span className="inline-flex items-center gap-2 text-xs font-bold text-gray-400">
                      <LoadingSpinner size={12} />
                      読み込み中
                    </span>
                  ) : null}
                </div>

                {layoutItems.length > 0 ? (
                  <div className="max-h-[520px] overflow-auto rounded-3xl border border-gray-100 bg-slate-100 shadow-inner">
                    <div className="h-[420px] min-w-[820px]">
                      <FloorMapCanvas
                        mode="view"
                        items={layoutItems}
                        sessions={[]}
                        orders={[]}
                        calls={[]}
                        checks={[]}
                        selectedTableId={normalizedTableId}
                        width={820}
                        height={420}
                        darkTheme={false}
                        onTableSelect={(tableId) => {
                          setTableNum(sanitizeTableNumberInput(tableId));
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center text-sm font-bold text-gray-400">
                    テーブルレイアウトが登録されていません。
                  </div>
                )}

                <p className="mt-4 text-xs font-medium leading-relaxed text-gray-400">
                  テーブル名が設定されている場合は名前を表示します。QRコードには内部IDとしてテーブル番号を使用します。
                </p>
              </section>

              <section className="rounded-[2rem] border-2 border-dashed border-gray-200 bg-gray-50/60 p-5 shadow-sm print:fixed print:inset-0 print:z-50 print:flex print:flex-col print:items-center print:justify-center print:border-none print:bg-white print:p-0 print:shadow-none">
                <div className="mb-4 text-xs font-black tracking-[0.18em] text-orange-400 print:hidden">
                  プレビュー
                </div>

                <div className="flex min-h-[260px] w-full flex-col items-center justify-center pt-4">
                  <div className="relative mb-4 flex items-center justify-center rounded-[1.6rem] border border-gray-100 bg-white p-4 shadow-lg print:mb-2 print:w-fit print:rounded-[6mm] print:border-[1.2pt] print:border-dashed print:border-gray-500 print:bg-white print:p-[5mm] print:shadow-none">
                    {(!imgLoaded || loadingToken) && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <LoadingSpinner size={28} />
                      </div>
                    )}

                    {qrApiUrl && (
                      <img
                        src={qrApiUrl}
                        alt={`${selectedTableLabel} のQRコード`}
                        className={`h-44 w-44 mix-blend-multiply transition-opacity duration-500 print:h-[35mm] print:w-[35mm] ${
                          imgLoaded && !loadingToken ? 'opacity-100' : 'opacity-0'
                        }`}
                        onLoad={() => setLoadedQrUrl(qrApiUrl)}
                      />
                    )}
                  </div>

                  <p className="text-center text-xl font-black text-gray-800 print:mt-1 print:text-[16pt] print:text-black">
                    {selectedTableLabel}
                  </p>

                  {selectedTableLabel !== normalizedTableId && (
                    <p className="mt-1 text-center font-mono text-[11px] font-bold text-gray-400 print:text-[9pt] print:text-black">
                      テーブル {normalizedTableId}
                    </p>
                  )}
                </div>
              </section>
            </div>

            <section className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm print:hidden">
              <div className="grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
                <div>
                  <label className="mb-2 block text-xs font-black tracking-[0.18em] text-orange-400">
                    共有用URL
                  </label>

                  <div className="flex h-12 items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4">
                    {loadingToken ? (
                      <LoadingSpinner size={16} className="shrink-0" />
                    ) : (
                      <QrCode size={16} className="shrink-0 text-gray-400" />
                    )}

                    <p className={`flex-1 truncate text-[11px] font-mono ${loadError ? 'text-red-500' : 'text-gray-500'}`}>
                      {loadError || displayUrl || 'URLを準備中...'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    disabled={!startUrl || Boolean(loadError)}
                    className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3 text-[11px] font-black text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    disabled={!qrApiUrl || !imgLoaded || loadingToken || Boolean(loadError)}
                    className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-3 text-[11px] font-black text-white shadow-lg shadow-blue-100 transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:active:scale-100"
                  >
                    <Download size={16} />
                    PNG
                  </button>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    disabled={!startUrl}
                    className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-gray-900 px-3 text-[11px] font-black text-white shadow-lg shadow-gray-200 transition-all hover:bg-black active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:active:scale-100"
                  >
                    <Printer size={16} />
                    印刷
                  </button>
                </div>
              </div>
            </section>          </div>

        </div>
      </div>
      <div className="px-2 pt-3 text-right print:hidden">
        <p className="text-[11px] leading-relaxed text-gray-400">
          QRコードは株式会社デンソーウェーブの登録商標です。
        </p>
      </div>
    </div>
  );
};

export default QRGenerator;
