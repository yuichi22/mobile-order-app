import React, { useState, useRef, useEffect, useMemo } from 'react';
import { getTableDisplayName, getTableDisplayLabel } from '../../shared/utils/tableDisplay';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { Barcode, List, Grid, ChevronLeft, MoveRight, X, Clock, ShoppingBag, Plus, Minus, Trash2 } from 'lucide-react';

import { db } from '../../shared/api/firebase/client';

import LoadingSpinner from '../../shared/components/feedback/LoadingSpinner';
import FloorMapCanvas from '../../shared/components/floor-map/FloorMapCanvas';
import TableMenuOverrideModal from './components/TableMenuOverrideModal';
import { saveTableMenuOverride } from './services/tableMenuOverrideService';
import { useCategoryData, useFloorLayout, useMenuData, usePeriodData, useStoreSettings } from '../store/hooks';
import { useKitchenBoard } from '../kitchen/hooks/useKitchenBoard';
import { useTableMenuOverrides } from './hooks/useTableMenuOverrides';
import PosTransactionHistoryPage from './pages/PosTransactionHistoryPage';

export const PosMain = ({ activeSessions, onScanSession, onSelectSession, storeId, onBack }) => {
  const [scanInput, setScanInput] = useState('');
  const [viewMode, setViewMode] = useState('map');
  const inputRef = useRef(null);
  const [movingSession, setMovingSession] = useState(null);
  const [moveError, setMoveError] = useState('');
  const [isMovingTable, setIsMovingTable] = useState(false);

  const [splitRatio, setSplitRatio] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  const mapWrapperRef = useRef(null);
  const [mapDimensions, setMapDimensions] = useState({ width: 0, height: 0 });

  const { layoutItems, loading: mapLoading } = useFloorLayout(storeId);
  const { periods = [] } = usePeriodData(storeId);
  const { menuItems = [] } = useMenuData(storeId);
  const { categories = [] } = useCategoryData(storeId);
  const { settings } = useStoreSettings(storeId);
  const [isTakeoutMode, setIsTakeoutMode] = useState(false);
  const [takeoutCart, setTakeoutCart] = useState([]);
  const [menuOverrideOpen, setMenuOverrideOpen] = useState(false);
  const [menuOverrideProcessing, setMenuOverrideProcessing] = useState(false);
  const { orders, calls, checks } = useKitchenBoard(storeId);
  const tableMenuOverrides = useTableMenuOverrides(storeId);

  const displaySessions = activeSessions.filter((session) => session.status === 'active');

  const categoryNameMap = useMemo(() => {
    const map = {};
    if (Array.isArray(categories)) {
      categories.forEach((category) => {
        if (!category?.id) return;
        map[category.id] = category.name || 'カテゴリー未設定';
      });
    }
    return map;
  }, [categories]);

  const takeoutMenuItems = useMemo(() => (
    Array.isArray(menuItems)
      ? menuItems
        .filter((item) => (
          item &&
          item.isSoldOut !== true &&
          item.allowsTakeout !== false &&
          Number(item.takeoutPrice || 0) > 0
        ))
        .map((item) => ({
          ...item,
          takeoutPrice: Math.max(Number(item.takeoutPrice || 0), 0),
          categoryName: categoryNameMap[item.category || item.categoryId] || item.categoryName || 'カテゴリー未設定'
        }))
        .sort((left, right) => (
          String(left.categoryName || '').localeCompare(String(right.categoryName || ''), 'ja')
          || Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
          || String(left.name || '').localeCompare(String(right.name || ''), 'ja')
        ))
      : []
  ), [categoryNameMap, menuItems]);

  const takeoutCartTotal = useMemo(() => (
    takeoutCart.reduce((sum, item) => (
      sum + (Number(item.takeoutPrice || 0) * Number(item.quantity || 0))
    ), 0)
  ), [takeoutCart]);

  const addTakeoutCartItem = (menuItem) => {
    if (!menuItem?.id) return;

    setTakeoutCart((current) => {
      const existing = current.find((item) => item.id === menuItem.id);
      if (existing) {
        return current.map((item) => (
          item.id === menuItem.id
            ? { ...item, quantity: Number(item.quantity || 0) + 1 }
            : item
        ));
      }

      return [
        ...current,
        {
          id: menuItem.id,
          name: menuItem.name || '未設定商品',
          categoryId: menuItem.category || menuItem.categoryId || '',
          categoryName: menuItem.categoryName || 'カテゴリー未設定',
          takeoutPrice: Number(menuItem.takeoutPrice || 0),
          quantity: 1
        }
      ];
    });
  };

  const updateTakeoutCartQuantity = (itemId, delta) => {
    setTakeoutCart((current) => (
      current
        .map((item) => (
          item.id === itemId
            ? { ...item, quantity: Math.max(Number(item.quantity || 0) + delta, 0) }
            : item
        ))
        .filter((item) => Number(item.quantity || 0) > 0)
    ));
  };

  const removeTakeoutCartItem = (itemId) => {
    setTakeoutCart((current) => current.filter((item) => item.id !== itemId));
  };

  const closeTakeoutMode = () => {
    setIsTakeoutMode(false);
  };

  const getSessionByTableId = (tableId) => (
    displaySessions.find((session) => String(session.tableId) === String(tableId)) || null
  );

  const resetMoveMode = () => {
    setMovingSession(null);
    setMoveError('');
  };

  const moveSessionToTable = async ({ session, nextTableId }) => {
    if (!storeId || !session?.id || !nextTableId) return;

    const oldTableId = String(session.tableId || '').trim();
    const normalizedNextTableId = String(nextTableId || '').trim();

    const nextLayoutItem = layoutItems.find((item) =>
      item.type === 'table' &&
      String(item.label || '') === String(normalizedNextTableId)
    );

    const nextTableDisplayName = String(
      nextLayoutItem?.displayName || ''
    ).trim();

    if (!oldTableId || !normalizedNextTableId) return;

    if (oldTableId === normalizedNextTableId) {
      resetMoveMode();
      return;
    }

    const occupiedSession = getSessionByTableId(normalizedNextTableId);
    if (occupiedSession) {
      setMoveError(`テーブル ${normalizedNextTableId} は利用中です。空席を選んでください。`);
      return;
    }

    setIsMovingTable(true);
    setMoveError('');

    try {
      const batch = writeBatch(db);

      batch.set(doc(db, 'stores', storeId, 'tables', oldTableId), {
        tableId: oldTableId,
        currentSessionId: null,
        currentSessionStatus: 'idle',
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableSessions', oldTableId), {
        tableId: oldTableId,
        sessionId: null,
        status: 'idle',
        updatedAt: serverTimestamp(),
        movedToTableId: normalizedNextTableId,
        lastMovedSessionId: session.id,
        lastMovedAt: serverTimestamp()
      }, { merge: true });

      batch.delete(doc(db, 'stores', storeId, 'tableEntryGuards', oldTableId));

      batch.set(doc(db, 'stores', storeId, 'tables', normalizedNextTableId), {
        tableId: normalizedNextTableId,
        currentSessionId: session.id,
        currentSessionStatus: 'active',
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableSessions', normalizedNextTableId), {
        tableId: normalizedNextTableId,
        sessionId: session.id,
        status: 'active',
        updatedAt: serverTimestamp(),
        movedFromTableId: oldTableId,
        movedAt: serverTimestamp()
      }, { merge: true });

      batch.set(doc(db, 'stores', storeId, 'tableEntryGuards', normalizedNextTableId), {
        tableId: normalizedNextTableId,
        sessionId: session.id,
        movedFromTableId: oldTableId,
        updatedAt: serverTimestamp()
      }, { merge: true });

      batch.update(doc(db, 'stores', storeId, 'sessions', session.id), {
        tableId: normalizedNextTableId,
        tableNumber: normalizedNextTableId,
        tableDisplayName: nextTableDisplayName,
        tableName: nextTableDisplayName,
        movedFromTableId: oldTableId,
        movedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      const ordersQuery = query(
        collection(db, 'stores', storeId, 'orders'),
        where('sessionId', '==', session.id)
      );
      const ordersSnapshot = await getDocs(ordersQuery);
      ordersSnapshot.forEach((orderDoc) => {
      batch.update(orderDoc.ref, {
        tableId: normalizedNextTableId,
        tableNumber: normalizedNextTableId,
        tableDisplayName: nextTableDisplayName,
        tableName: nextTableDisplayName,
        updatedAt: serverTimestamp()
      });
      });

      const requestsQuery = query(
        collection(db, 'stores', storeId, 'serviceRequests'),
        where('sessionId', '==', session.id)
      );
      const requestsSnapshot = await getDocs(requestsQuery);
      requestsSnapshot.forEach((requestDoc) => {
      batch.update(requestDoc.ref, {
        tableId: normalizedNextTableId,
        tableNumber: normalizedNextTableId,
        tableDisplayName: nextTableDisplayName,
        tableName: nextTableDisplayName,
        updatedAt: serverTimestamp()
      });
      });

      await batch.commit();

      resetMoveMode();
    } catch (error) {
      console.error('[PosMain] moveSessionToTable failed', error);
      setMoveError('席移動に失敗しました。通信状況を確認して、もう一度お試しください。');
    } finally {
      setIsMovingTable(false);
    }
  };

  const handleApplyTableMenuOverride = async ({
    tableId,
    tableName,
    periodId,
    periodName,
    durationMinutes
  }) => {
    setMenuOverrideProcessing(true);

    try {
      await saveTableMenuOverride({
        storeId,
        tableId,
        tableName,
        periodId,
        periodName,
        durationMinutes
      });

      setMenuOverrideOpen(false);
    } catch (error) {
      console.error('Failed to save table menu override:', error);
      alert('時間帯メニューの変更に失敗しました。通信状況を確認して、もう一度お試しください。');
    } finally {
      setMenuOverrideProcessing(false);
    }
  };

  const handleTableAction = (tableId) => {
    const targetTableId = String(tableId || '').trim();
    if (!targetTableId) return;

    if (movingSession) {
      moveSessionToTable({
        session: movingSession,
        nextTableId: targetTableId
      });
      return;
    }

    const session = getSessionByTableId(targetTableId);
    if (session) {
      onSelectSession(session.id);
    }
  };

  const handleTableLongPress = (tableId) => {
    const targetTableId = String(tableId || '').trim();
    if (!targetTableId) return;

    const session = getSessionByTableId(targetTableId);

    // 空席を長押ししても移動元にはしない
    if (!session) return;

    setMovingSession(session);
    setMoveError('');
  };


  const handleScanSubmit = (event) => {
    event.preventDefault();
    if (scanInput.trim()) {
      onScanSession(scanInput.trim());
      setScanInput('');
    }
  };

  const handleMouseDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!isDragging || !containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const newRatio = (event.clientX / containerWidth) * 100;

      if (newRatio > 30 && newRatio < 75) {
        setSplitRatio(newRatio);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!mapWrapperRef.current) return undefined;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMapDimensions({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height)
        });
      }
    });

    resizeObserver.observe(mapWrapperRef.current);
    return () => resizeObserver.disconnect();
  }, [viewMode]);

  return (
    <>
    <div ref={containerRef} className="relative flex h-full select-none overflow-hidden bg-slate-100">
      <div style={{ width: `${splitRatio}%` }} className="flex h-full min-w-[300px] flex-col p-4 pr-1">
        <div className="mb-4 flex shrink-0 items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 active:scale-95"
              title="モード選択へ戻る"
              aria-label="モード選択へ戻る"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div className="flex-1 rounded-xl bg-white p-3 shadow-sm">
            <form onSubmit={handleScanSubmit} className="flex items-center gap-2">
              <div className="relative flex-grow">
                <Barcode className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                  ref={inputRef}
                  type="text"
                  value={scanInput}
                  onChange={(event) => setScanInput(event.target.value)}
                  className="h-11 w-full rounded-lg border-2 border-gray-300 pl-9 pr-3 font-mono text-base"
                  placeholder="卓番号・バーコードをスキャン..."
                />
              </div>
              <button type="submit" className="h-11 whitespace-nowrap rounded-lg bg-blue-600 px-4 font-bold text-white">
                開く
              </button>
            </form>
          </div>
        </div>

        <div className="relative flex flex-grow flex-col overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="z-10 flex items-center justify-between gap-3 border-b bg-gray-50 p-3 font-bold text-gray-700">
            <span>利用中テーブル ({displaySessions.length})</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMenuOverrideOpen(true)}
                className="flex h-9 items-center gap-2 rounded-lg bg-orange-500 px-3 text-xs font-black text-white shadow-sm transition-colors hover:bg-orange-600 active:scale-95"
              >
                <Clock size={15} />
                時間帯メニュー変更
              </button>

              <button
                type="button"
                onClick={() => setIsTakeoutMode(true)}
                className={`flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-black shadow-sm transition-colors active:scale-95 ${
                  isTakeoutMode
                    ? 'bg-slate-900 text-white hover:bg-black'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <ShoppingBag size={15} />
                テイクアウト
              </button>

              <div className="flex rounded bg-gray-200 p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`rounded p-1.5 ${viewMode === 'list' ? 'bg-white text-blue-600 shadow' : 'text-gray-500'}`}
              >
                <List size={18} />
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={`rounded p-1.5 ${viewMode === 'map' ? 'bg-white text-blue-600 shadow' : 'text-gray-500'}`}
              >
                <Grid size={18} />
              </button>
              </div>
            </div>
          </div>

          <div className="relative flex-grow overflow-hidden bg-slate-100" ref={mapWrapperRef}>

            {movingSession && (
              <div className="absolute left-4 right-4 top-4 z-20 rounded-2xl border border-blue-200 bg-white/95 p-4 shadow-xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-black text-blue-600">
                      <MoveRight size={17} />
                      席移動モード
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate-700">
                      {getTableDisplayLabel(movingSession)} から移動先の空席を選択してください。
                    </p>
                    {moveError && (
                      <p className="mt-2 text-xs font-bold text-red-500">
                        {moveError}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={resetMoveMode}
                    disabled={isMovingTable}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>
            )}

            {viewMode === 'list' ? (
              <div className="grid h-full grid-cols-1 content-start gap-3 overflow-y-auto p-3 xl:grid-cols-2">
                {displaySessions.map((session) => {
                  const isMoveSource = movingSession?.id === session.id;

                  return (
                    <div
                      key={session.id}
                      className={`rounded-xl border bg-white p-3 text-left shadow-sm transition-all ${
                        isMoveSource ? 'border-blue-500 ring-2 ring-blue-200' : 'hover:bg-blue-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <div>
                          <span className="block text-lg font-bold">
                            {getTableDisplayLabel(session)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {session.createdAt?.toLocaleTimeString?.() || '--:--'} 開始
                          </span>
                        </div>
                        <ChevronLeft className="rotate-180 text-gray-300" />
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMovingSession(session);
                          setMoveError('');
                          setViewMode('map');
                        }}
                        className={`mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-black transition-all ${
                          isMoveSource
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                      >
                        <MoveRight size={15} />
                        席移動
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                {mapLoading ? (
                  <LoadingSpinner size={24} className="m-auto" />
                ) : (
                  mapDimensions.width > 0 &&
                  mapDimensions.height > 0 && (
                    <FloorMapCanvas
                      key={`map-${mapDimensions.width}-${mapDimensions.height}`}
                      mode="view"
                      items={layoutItems}
                      sessions={displaySessions}
                      orders={orders}
                      calls={calls}
                      checks={checks}
                      tableMenuOverrides={tableMenuOverrides}
                      width={mapDimensions.width}
                      height={mapDimensions.height}
                      darkTheme={false}
                      movingTableId={movingSession?.tableId || null}
                      onTableSelect={handleTableAction}
                      onTableLongPress={handleTableLongPress}
                    />
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-20 -ml-2 mr-[-8px] flex w-4 items-center justify-center">
        <div
          className={`h-12 w-1.5 cursor-col-resize rounded-full shadow-sm transition-all ${
            isDragging ? 'scale-110 bg-blue-500' : 'bg-gray-300 hover:bg-gray-400'
          }`}
          onMouseDown={handleMouseDown}
        />
      </div>

      <div style={{ width: `${100 - splitRatio}%` }} className="flex h-full min-w-[300px] flex-col p-4 pl-1">
        {isTakeoutMode ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="flex shrink-0 items-center justify-between border-b bg-gray-50 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
                  <ShoppingBag size={20} />
                  テイクアウト注文
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  テイクアウト価格が設定されている商品だけ表示しています。
                </p>
              </div>

              <button
                type="button"
                onClick={closeTakeoutMode}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                aria-label="テイクアウト注文を閉じる"
              >
                <X size={17} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-2">
              <div className="min-h-0 overflow-y-auto border-r border-slate-100 bg-slate-50/70 p-4">
                <div className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">
                  商品リスト
                </div>

                {takeoutMenuItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
                    <p className="text-sm font-black text-slate-500">
                      テイクアウト価格が設定された商品がありません。
                    </p>
                    <p className="mt-2 text-xs font-bold leading-relaxed text-slate-400">
                      メニュー設定で「テイクアウト価格」を入力すると、ここに表示されます。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {takeoutMenuItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addTakeoutCartItem(item)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-blue-200 hover:bg-blue-50 active:scale-[0.99]"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-800">
                            {item.name || '未設定商品'}
                          </div>
                          <div className="mt-1 truncate text-[11px] font-bold text-slate-400">
                            {item.categoryName}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-base font-black text-slate-900">
                            ¥{Number(item.takeoutPrice || 0).toLocaleString()}
                          </span>
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white">
                            <Plus size={17} strokeWidth={3} />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex min-h-0 flex-col bg-white">
                <div className="shrink-0 border-b border-slate-100 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                        仮伝票
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-500">
                        テーブルは使用しません
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-black text-slate-400">税込合計</div>
                      <div className="font-mono text-3xl font-black text-slate-900">
                        ¥{takeoutCartTotal.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {takeoutCart.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center text-slate-300">
                      <ShoppingBag size={56} strokeWidth={1.5} />
                      <p className="mt-3 text-sm font-black">
                        商品を選択してください
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {takeoutCart.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-800">
                                {item.name}
                              </div>
                              <div className="mt-1 text-xs font-bold text-slate-400">
                                ¥{Number(item.takeoutPrice || 0).toLocaleString()} / {item.categoryName}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeTakeoutCartItem(item.id)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-red-400 shadow-sm hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                              <button
                                type="button"
                                onClick={() => updateTakeoutCartQuantity(item.id, -1)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                              >
                                <Minus size={15} />
                              </button>
                              <span className="w-10 text-center font-mono text-lg font-black text-slate-800">
                                {Number(item.quantity || 0)}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateTakeoutCartQuantity(item.id, 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50"
                              >
                                <Plus size={15} />
                              </button>
                            </div>

                            <div className="font-mono text-lg font-black text-slate-900">
                              ¥{(Number(item.takeoutPrice || 0) * Number(item.quantity || 0)).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-slate-100 p-4">
                  <button
                    type="button"
                    disabled={takeoutCart.length === 0}
                    onClick={() => alert('次のPhaseで既存会計フローへ接続します。')}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white shadow-lg transition-all hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                  >
                    会計する
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <PosTransactionHistoryPage storeId={storeId} />
        )}
      </div>
    </div>

    <TableMenuOverrideModal
      open={menuOverrideOpen}
      periods={periods}
      layoutItems={layoutItems}
      activeSessions={displaySessions}
      processing={menuOverrideProcessing}
      onClose={() => setMenuOverrideOpen(false)}
      onApply={handleApplyTableMenuOverride}
    />
    </>
  );
};
