import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Redo2, ScanSearch, Undo2, ZoomIn, ZoomOut } from 'lucide-react';

import { FLOOR_GRID_SIZE } from './FloorMapConstants';
import { FloorMapProperties } from './FloorMapProperties';
import { FloorMapSidebar } from './FloorMapSidebar';
import { FloorMapToolbar } from './FloorMapToolbar';

const MAX_HISTORY_STEPS = 20;
const FIT_VIEW_PADDING = 48;
const VIEWPORT_ANIMATION_DURATION = 260;

const normalizeTableLabel = (value) =>
  String(value ?? '')
    .replace(/[\uFF10-\uFF19]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9]/g, '');

const normalizeLayoutItem = (item) => ({
  ...item,
  // label は内部処理用のテーブルIDとして数字だけに保つ
  label: item.type === 'table' ? normalizeTableLabel(item.label) : item.label,

  // displayName は画面表示用の任意名
  displayName: item.type === 'table'
    ? String(item.displayName || '').trim()
    : item.displayName,

  seats: item.type === 'table' ? Math.max(1, Number(item.seats) || 4) : item.seats,
  areaName: item.type === 'table' ? String(item.areaName || '') : '',
  isDisabled: item.type === 'table' ? Boolean(item.isDisabled) : false,
});

const normalizeLayoutItems = (sourceItems) => sourceItems.map(normalizeLayoutItem);

const serializeLayoutItems = (sourceItems) => JSON.stringify(normalizeLayoutItems(sourceItems));

const getResizeHandleFrame = () => ({
  right: -8,
  bottom: -8,
  width: 18,
  height: 18,
});

const createInitialLayoutState = (layoutItems) => {
  const normalizedItems = normalizeLayoutItems(JSON.parse(JSON.stringify(layoutItems || [])));
  const snapshot = normalizedItems.length > 0 ? JSON.stringify(normalizedItems) : null;

  return {
    items: normalizedItems,
    history: snapshot ? [snapshot] : [],
    historyIndex: snapshot ? 0 : -1,
  };
};

const MotionAside = motion.aside;

const ResizeHandle = () => (
  <div className="pointer-events-none relative h-full w-full">
    <div className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white bg-orange-500 shadow-[0_4px_12px_rgba(249,115,22,0.35)]" />
  </div>
);

const OverlayIconButton = ({ children, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/80 bg-white/95 text-slate-500 shadow-lg shadow-slate-200/70 backdrop-blur transition-colors hover:border-orange-100 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-35"
  >
    {children}
  </button>
);

const getNextTableLabel = (sourceItems) => {
  const usedNumbers = new Set(
    sourceItems
      .filter((item) => item.type === 'table')
      .map((item) => Number(String(item.label || '').replace(/\D/g, '')))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  return String(nextNumber);
};

const FloorMapEditor = ({ layoutItems, onSave }) => {
  const initialLayoutState = createInitialLayoutState(layoutItems);

  const [items, setItems] = useState(initialLayoutState.items);
  const [history, setHistory] = useState(initialLayoutState.history);
  const [historyIndex, setHistoryIndex] = useState(initialLayoutState.historyIndex);
  const [selectedIds, setSelectedIds] = useState([]);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [, setDragState] = useState(null);
  const canvasRef = useRef(null);
  const itemsRef = useRef(initialLayoutState.items);
  const historyRef = useRef(initialLayoutState.history);
  const historyIndexRef = useRef(initialLayoutState.historyIndex);
  const dragStateRef = useRef(null);
  const frameRef = useRef(null);
  const viewportAnimationRef = useRef(null);
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const fitViewEnabledRef = useRef(false);
  const hasInitialViewportRef = useRef(false);
  const allowAutoFitAnimationRef = useRef(false);
  const autoFitUnlockTimerRef = useRef(null);

  const stopViewportAnimation = useCallback(() => {
    if (viewportAnimationRef.current !== null) {
      cancelAnimationFrame(viewportAnimationRef.current);
      viewportAnimationRef.current = null;
    }
  }, []);

  const commitViewport = useCallback((nextScale, nextPan) => {
    scaleRef.current = nextScale;
    panRef.current = nextPan;
    setScale(nextScale);
    setPan(nextPan);
  }, []);

  const syncItems = useCallback((nextItems, options = {}) => {
    const normalizedItems = normalizeLayoutItems(nextItems);
    itemsRef.current = normalizedItems;

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (options.defer) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setItems(itemsRef.current);
      });
      return;
    }

    setItems(normalizedItems);
  }, []);

  const syncHistory = useCallback((nextHistory, nextIndex) => {
    historyRef.current = nextHistory;
    historyIndexRef.current = nextIndex;
    setHistory(nextHistory);
    setHistoryIndex(nextIndex);
  }, []);

  const syncDragState = useCallback((nextDragState) => {
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }, []);

  const flushDeferredItems = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      setItems(itemsRef.current);
    }
  }, []);

  const pushHistory = useCallback((nextItems) => {
    const snapshot = serializeLayoutItems(nextItems);
    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);

    if (nextHistory[nextHistory.length - 1] === snapshot) {
      syncItems(nextItems);
      return;
    }

    nextHistory.push(snapshot);

    if (nextHistory.length > MAX_HISTORY_STEPS) {
      nextHistory.shift();
    }

    syncHistory(nextHistory, nextHistory.length - 1);
    syncItems(nextItems);
  }, [syncHistory, syncItems]);

  const handleUndo = () => {
    if (historyIndexRef.current <= 0) return;

    const nextIndex = historyIndexRef.current - 1;
    syncHistory(historyRef.current, nextIndex);
    syncItems(JSON.parse(historyRef.current[nextIndex]));
    setSelectedIds([]);
  };

  const handleRedo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;

    const nextIndex = historyIndexRef.current + 1;
    syncHistory(historyRef.current, nextIndex);
    syncItems(JSON.parse(historyRef.current[nextIndex]));
    setSelectedIds([]);
  };

  useEffect(() => {
    if (layoutItems && itemsRef.current.length === 0 && historyRef.current.length === 0) {
      const initialData = normalizeLayoutItems(JSON.parse(JSON.stringify(layoutItems)));
      const snapshot = JSON.stringify(initialData);
      hasInitialViewportRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      syncItems(initialData);
      syncHistory([snapshot], 0);
    }
  }, [layoutItems, syncHistory, syncItems]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    if (viewportAnimationRef.current !== null) {
      cancelAnimationFrame(viewportAnimationRef.current);
    }
    if (autoFitUnlockTimerRef.current !== null) {
      window.clearTimeout(autoFitUnlockTimerRef.current);
    }
  }, []);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const getFittedViewport = useCallback(() => {
    flushDeferredItems();

    const canvas = canvasRef.current;
    const sourceItems = itemsRef.current;

    if (!canvas || sourceItems.length === 0) {
      return { scale: 1, pan: { x: 0, y: 0 } };
    }

    const canvasWidth = canvas.clientWidth || 0;
    const canvasHeight = canvas.clientHeight || 0;

    if (canvasWidth === 0 || canvasHeight === 0) {
      return { scale: 1, pan: { x: 0, y: 0 } };
    }

    const minX = Math.min(...sourceItems.map((item) => item.x));
    const minY = Math.min(...sourceItems.map((item) => item.y));
    const maxX = Math.max(...sourceItems.map((item) => item.x + item.width));
    const maxY = Math.max(...sourceItems.map((item) => item.y + item.height));
    const layoutWidth = Math.max(maxX - minX, FLOOR_GRID_SIZE);
    const layoutHeight = Math.max(maxY - minY, FLOOR_GRID_SIZE);
    const availableWidth = Math.max(canvasWidth - (FIT_VIEW_PADDING * 2), FLOOR_GRID_SIZE);
    const availableHeight = Math.max(canvasHeight - (FIT_VIEW_PADDING * 2), FLOOR_GRID_SIZE);
    const nextScale = Math.max(
      0.2,
      Math.min(3, Math.min(availableWidth / layoutWidth, availableHeight / layoutHeight)),
    );

    return {
      scale: nextScale,
      pan: {
        x: ((canvasWidth - (layoutWidth * nextScale)) / 2) - (minX * nextScale),
        y: ((canvasHeight - (layoutHeight * nextScale)) / 2) - (minY * nextScale),
      },
    };
  }, [flushDeferredItems]);

  const animateViewportTo = useCallback((nextViewport, immediate = false) => {
    if (!nextViewport) return;

    stopViewportAnimation();

    if (immediate) {
      commitViewport(nextViewport.scale, nextViewport.pan);
      return;
    }

    const startScale = scaleRef.current;
    const startPan = panRef.current;
    const targetScale = nextViewport.scale;
    const targetPan = nextViewport.pan;
    const startAt = performance.now();

    const tick = (timestamp) => {
      const progress = Math.min((timestamp - startAt) / VIEWPORT_ANIMATION_DURATION, 1);
      const eased = 1 - ((1 - progress) ** 3);

      commitViewport(
        startScale + ((targetScale - startScale) * eased),
        {
          x: startPan.x + ((targetPan.x - startPan.x) * eased),
          y: startPan.y + ((targetPan.y - startPan.y) * eased),
        },
      );

      if (progress < 1) {
        viewportAnimationRef.current = requestAnimationFrame(tick);
        return;
      }

      viewportAnimationRef.current = null;
      commitViewport(targetScale, targetPan);
    };

    viewportAnimationRef.current = requestAnimationFrame(tick);
  }, [commitViewport, stopViewportAnimation]);

  useLayoutEffect(() => {
    if (hasInitialViewportRef.current) return;
    if (items.length === 0) return;
    if (!canvasRef.current) return;

    fitViewEnabledRef.current = true;
    allowAutoFitAnimationRef.current = false;
    if (autoFitUnlockTimerRef.current !== null) {
      window.clearTimeout(autoFitUnlockTimerRef.current);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    animateViewportTo(getFittedViewport(), true);
    hasInitialViewportRef.current = true;
    autoFitUnlockTimerRef.current = window.setTimeout(() => {
      allowAutoFitAnimationRef.current = true;
      autoFitUnlockTimerRef.current = null;
    }, 320);
  }, [items.length, animateViewportTo, getFittedViewport]);

  const addItem = (type, width, height, shape = 'rect', seats = 4) => {
    const canvas = canvasRef.current;
    const viewportCenterX = (((canvas?.clientWidth || 0) / 2) - pan.x) / scale;
    const viewportCenterY = (((canvas?.clientHeight || 0) / 2) - pan.y) / scale;

    const snapX = Math.round((viewportCenterX - width / 2) / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE;
    const snapY = Math.round((viewportCenterY - height / 2) / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE;

    const nextTableLabel = type === 'table'
      ? getNextTableLabel(itemsRef.current)
      : '';

    const newItem = {
      id: Date.now().toString(),
      type,
      label: nextTableLabel,
      displayName: '',
      x: snapX,
      y: snapY,
      width,
      height,
      shape,
      rotation: 0,
      seats,
      areaName: '',
      isDisabled: false,
      groupId: null,
    };

    pushHistory([...itemsRef.current, newItem]);
    setSelectedIds([newItem.id]);
  };

  const updateSelectedItems = (updates) => {
    const nextItems = itemsRef.current.map((item) =>
      selectedIds.includes(item.id) ? normalizeLayoutItem({ ...item, ...updates }) : item,
    );
    pushHistory(nextItems);
  };

  const handleDelete = () => {
    if (selectedIds.length === 0) return;

    pushHistory(itemsRef.current.filter((item) => !selectedIds.includes(item.id)));
    setSelectedIds([]);
  };

  const handleDuplicate = () => {
    if (selectedIds.length === 0) return;

    const duplicatedItems = [];
    let nextItems = [...itemsRef.current];

    selectedIds.forEach((selectedId) => {
      const sourceItem = nextItems.find((item) => item.id === selectedId);
      if (!sourceItem) return;

      const duplicatedItem = normalizeLayoutItem({
        ...sourceItem,
        id: `${Date.now()}-${selectedId}-${duplicatedItems.length}`,
        x: sourceItem.x + FLOOR_GRID_SIZE * 2,
        y: sourceItem.y + FLOOR_GRID_SIZE * 2,
        groupId: null,
      });

      if (duplicatedItem.type === 'table') {
        duplicatedItem.label = getNextTableLabel([...nextItems, ...duplicatedItems]);
      }

      duplicatedItems.push(duplicatedItem);
    });

    if (duplicatedItems.length === 0) return;

    nextItems = [...itemsRef.current, ...duplicatedItems];
    pushHistory(nextItems);
    setSelectedIds(duplicatedItems.map((item) => item.id));
  };

  const handleRotate = () => {
    const nextItems = itemsRef.current.map((item) =>
      selectedIds.includes(item.id)
        ? normalizeLayoutItem({ ...item, rotation: (item.rotation || 0) + 45 })
        : item,
    );

    pushHistory(nextItems);
  };

  const handleGroup = () => {
    if (selectedIds.length < 2) return;

    const groupId = `group-${Date.now()}`;
    const nextItems = itemsRef.current.map((item) =>
      selectedIds.includes(item.id) ? normalizeLayoutItem({ ...item, groupId }) : item,
    );

    pushHistory(nextItems);
  };

  const handleUngroup = () => {
    const nextItems = itemsRef.current.map((item) =>
      selectedIds.includes(item.id) ? normalizeLayoutItem({ ...item, groupId: null }) : item,
    );

    pushHistory(nextItems);
  };

  const alignSelected = (direction) => {
    if (selectedIds.length < 2) return;

    const selectedItems = itemsRef.current.filter((item) => selectedIds.includes(item.id));
    let targetValue;

    switch (direction) {
      case 'left':
        targetValue = Math.min(...selectedItems.map((item) => item.x));
        break;
      case 'center-x': {
        const minX = Math.min(...selectedItems.map((item) => item.x));
        const maxX = Math.max(...selectedItems.map((item) => item.x + item.width));
        targetValue = minX + ((maxX - minX) / 2);
        break;
      }
      case 'right':
        targetValue = Math.max(...selectedItems.map((item) => item.x + item.width));
        break;
      case 'top':
        targetValue = Math.min(...selectedItems.map((item) => item.y));
        break;
      case 'center-y': {
        const minY = Math.min(...selectedItems.map((item) => item.y));
        const maxY = Math.max(...selectedItems.map((item) => item.y + item.height));
        targetValue = minY + ((maxY - minY) / 2);
        break;
      }
      case 'bottom':
        targetValue = Math.max(...selectedItems.map((item) => item.y + item.height));
        break;
      default:
        return;
    }

    const nextItems = itemsRef.current.map((item) => {
      if (!selectedIds.includes(item.id)) return item;

      const nextItem = { ...item };

      if (direction === 'left') nextItem.x = targetValue;
      if (direction === 'center-x') nextItem.x = targetValue - (item.width / 2);
      if (direction === 'right') nextItem.x = targetValue - item.width;
      if (direction === 'top') nextItem.y = targetValue;
      if (direction === 'center-y') nextItem.y = targetValue - (item.height / 2);
      if (direction === 'bottom') nextItem.y = targetValue - item.height;

      nextItem.x = Math.round(nextItem.x / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE;
      nextItem.y = Math.round(nextItem.y / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE;

      return nextItem;
    });

    pushHistory(nextItems);
  };

  const handleMouseDown = (event, id) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.button === 1 || (!id && event.shiftKey)) {
      fitViewEnabledRef.current = false;
      stopViewportAnimation();
      syncDragState({
        type: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        initialPan: { ...pan },
      });
      return;
    }

    if (!id) {
      setSelectedIds([]);
      return;
    }

    const nextSelection = event.shiftKey
      ? (selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id])
      : (selectedIds.includes(id) ? selectedIds : [id]);

    setSelectedIds(nextSelection);
    const nextDragState = {
      type: 'move',
      startX: event.clientX,
      startY: event.clientY,
      initialItems: itemsRef.current
        .filter((item) => nextSelection.includes(item.id))
        .map((item) => ({ id: item.id, x: item.x, y: item.y })),
    };
    syncDragState(nextDragState);
  };

  const handleMouseMove = (event) => {
    const activeDragState = dragStateRef.current;
    if (!activeDragState) return;

    const deltaX = (event.clientX - activeDragState.startX) / scale;
    const deltaY = (event.clientY - activeDragState.startY) / scale;

    if (activeDragState.type === 'pan') {
      const nextPan = {
        x: activeDragState.initialPan.x + (event.clientX - activeDragState.startX),
        y: activeDragState.initialPan.y + (event.clientY - activeDragState.startY),
      };
      panRef.current = nextPan;
      setPan(nextPan);
      return;
    }

    if (activeDragState.type === 'move') {
      const movedItems = itemsRef.current.map((item) => {
        const initialItem = activeDragState.initialItems.find((initial) => initial.id === item.id);
        if (!initialItem) return item;

        return normalizeLayoutItem({
          ...item,
          x: Math.round((initialItem.x + deltaX) / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE,
          y: Math.round((initialItem.y + deltaY) / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE,
        });
      });

      syncItems(movedItems, { defer: true });
      return;
    }

    if (activeDragState.type === 'resize') {
      const newWidth = Math.max(
        FLOOR_GRID_SIZE,
        Math.round((activeDragState.initial.w + deltaX) / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE,
      );
      const newHeight = Math.max(
        FLOOR_GRID_SIZE,
        Math.round((activeDragState.initial.h + deltaY) / FLOOR_GRID_SIZE) * FLOOR_GRID_SIZE,
      );

      syncItems(
        itemsRef.current.map((item) =>
          item.id === activeDragState.id
            ? normalizeLayoutItem({ ...item, width: newWidth, height: newHeight })
            : item,
        ),
        { defer: true },
      );
    }
  };

  const handleMouseUp = () => {
    const activeDragState = dragStateRef.current;
    flushDeferredItems();

    if (activeDragState?.type === 'move' || activeDragState?.type === 'resize') {
      pushHistory(itemsRef.current);
    }

    syncDragState(null);
  };

  useEffect(() => {
    const handleWindowMouseMove = (event) => {
      if (!dragStateRef.current) return;
      handleMouseMove(event);
    };

    const handleWindowMouseUp = () => {
      if (!dragStateRef.current) return;
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('pointermove', handleWindowMouseMove);
    window.addEventListener('pointerup', handleWindowMouseUp);
    window.addEventListener('pointercancel', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('pointermove', handleWindowMouseMove);
      window.removeEventListener('pointerup', handleWindowMouseUp);
      window.removeEventListener('pointercancel', handleWindowMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleResetView = () => {
    fitViewEnabledRef.current = true;
    allowAutoFitAnimationRef.current = true;
    animateViewportTo(getFittedViewport());
  };

  const handleSave = async () => {
    flushDeferredItems();

    const tableIds = itemsRef.current
      .filter((item) => item.type === 'table')
      .map((item) => String(item.label || '').trim())
      .filter(Boolean);

    const duplicatedTableId = tableIds.find((id, index) => tableIds.indexOf(id) !== index);

    if (duplicatedTableId) {
      alert(`テーブルID「${duplicatedTableId}」が重複しています。別のIDに変更してください。`);
      return;
    }

    setSaveStatus('saving');

    try {
      await onSave(itemsRef.current);
      setSaveStatus('saved');

      window.setTimeout(() => {
        setSaveStatus('idle');
      }, 1200);
    } catch (error) {
      setSaveStatus('idle');
      throw error;
    }
  };

  const handleZoomIn = () => {
    fitViewEnabledRef.current = false;
    stopViewportAnimation();
    setScale((current) => Math.min(current + 0.1, 3));
  };

  const handleZoomOut = () => {
    fitViewEnabledRef.current = false;
    stopViewportAnimation();
    setScale((current) => Math.max(current - 0.1, 0.2));
  };

  useEffect(() => {
    if (!fitViewEnabledRef.current) return undefined;

    const timeoutId = window.setTimeout(() => {
      animateViewportTo(getFittedViewport(), !allowAutoFitAnimationRef.current);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [selectedIds.length, animateViewportTo, getFittedViewport]);

  useEffect(() => {
    let timeoutId = null;

    const handleWindowResize = () => {
      if (!fitViewEnabledRef.current) return;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        animateViewportTo(getFittedViewport(), !allowAutoFitAnimationRef.current);
      }, 120);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      window.clearTimeout(timeoutId);
    };
  }, [animateViewportTo, getFittedViewport]);

  const isPropertiesOpen = selectedIds.length > 0;

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <FloorMapToolbar onSave={handleSave} saveStatus={saveStatus} />

      <div className="relative flex flex-grow overflow-hidden">
        <FloorMapSidebar onAddItem={addItem} />

        <div
          ref={canvasRef}
          className="relative flex-grow overflow-hidden bg-slate-100 cursor-crosshair"
          onMouseDown={(event) => handleMouseDown(event, null)}
          style={{
            backgroundImage: 'radial-gradient(#cbd5e1 2px, transparent 2px)',
            backgroundSize: `${20 * scale}px ${20 * scale}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex justify-end gap-4">
            <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/80 bg-white/95 px-3 py-2 shadow-xl shadow-slate-200/70 backdrop-blur">
              <OverlayIconButton onClick={handleUndo} disabled={historyIndex <= 0}>
                <Undo2 size={18} />
              </OverlayIconButton>
              <OverlayIconButton onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
                <Redo2 size={18} />
              </OverlayIconButton>
              <div className="mx-1 h-7 w-px bg-gray-200" />
              <OverlayIconButton onClick={handleZoomIn}>
                <ZoomIn size={18} />
              </OverlayIconButton>
              <span className="w-12 text-center font-mono text-xs font-black text-slate-500">
                {Math.round(scale * 100)}%
              </span>
              <OverlayIconButton onClick={handleZoomOut}>
                <ZoomOut size={18} />
              </OverlayIconButton>
              <button
                type="button"
                onClick={handleResetView}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/80 bg-white px-4 text-xs font-black text-slate-500 shadow-lg shadow-slate-200/70 transition-colors hover:border-orange-100 hover:bg-orange-50 hover:text-orange-600"
              >
                <ScanSearch size={16} />
                全体表示
              </button>
            </div>
          </div>

          <div
            className="absolute origin-top-left"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          >
        {items.map((item) => (
              <div
                key={item.id}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  handleMouseDown(event, item.id);
                }}
                onPointerMove={handleMouseMove}
                onPointerUp={handleMouseUp}
                onPointerCancel={handleMouseUp}
                className={`group absolute flex select-none flex-col items-center justify-center border-2 transition-shadow ${
                  item.type === 'wall'
                    ? (
                      selectedIds.includes(item.id)
                        ? 'z-50 border-orange-500 bg-slate-300 ring-4 ring-orange-200 shadow-xl'
                        : 'border-transparent bg-slate-300'
                    )
                    : (
                      selectedIds.includes(item.id)
                        ? 'z-50 border-orange-500 bg-orange-50 ring-4 ring-orange-200 shadow-xl'
                        : 'border-gray-300 bg-white'
                    )
                } ${item.shape === 'circle' ? 'rounded-full' : 'rounded-lg'}`}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  transform: `rotate(${item.rotation || 0}deg)`,
                  cursor: 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                {item.type === 'table' && item.isDisabled && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                    <div className="absolute inset-0 bg-red-100/85" />
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, rgba(239, 68, 68, 0.45) 0 6px, rgba(239, 68, 68, 0.45) 6px 10px, rgba(255, 255, 255, 0) 10px 18px)',
                      }}
                    />
                  </div>
                )}
                {item.type === 'table' && (
                  <div className={`relative flex flex-col items-center justify-center px-2 text-center ${item.isDisabled ? 'opacity-75' : ''}`}>
<span className={`line-clamp-2 max-w-full break-words px-1 text-center font-bold leading-tight text-gray-700 ${item.displayName ? 'text-[11px]' : 'text-base'}`}>
  {item.displayName || item.label}
</span>

                    {item.displayName && (
                      <span className="mt-0.5 max-w-full truncate px-1 text-[8px] font-bold leading-tight text-gray-400">
                        ID: {item.label}
                      </span>
                    )}

                    <span className="mt-0.5 text-[9px] font-bold leading-tight text-gray-500">
                      {item.seats || 4}席
                    </span>
                  </div>
                )}

                {selectedIds.includes(item.id) && (
                  <div
                    className="absolute cursor-se-resize"
                    style={getResizeHandleFrame()}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      event.stopPropagation();
                      syncDragState({
                        type: 'resize',
                        id: item.id,
                        startX: event.clientX,
                        startY: event.clientY,
                        initial: { w: item.width, h: item.height },
                      });
                    }}
                  >
                    <ResizeHandle />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isPropertiesOpen && (
            <MotionAside
              key="floor-map-properties"
              initial={{ width: 0, opacity: 0, x: 24 }}
              animate={{ width: '15rem', opacity: 1, x: 0 }}
              exit={{ width: 0, opacity: 0, x: 24 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="z-20 shrink-0 overflow-hidden"
            >
              <div className="h-full w-60">
                <FloorMapProperties
                  selectedIds={selectedIds}
                  items={items}
                  updateSelectedItems={updateSelectedItems}
                  handleRotate={handleRotate}
                  handleDelete={handleDelete}
                  handleDuplicate={handleDuplicate}
                  alignSelected={alignSelected}
                  handleGroup={handleGroup}
                  handleUngroup={handleUngroup}
                />
              </div>
            </MotionAside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const FloorMapSettings = ({ layoutItems, onSave }) => (
  <div className="h-full w-full animate-in fade-in duration-500">
    <div className="relative h-full min-h-0 overflow-hidden rounded-2xl">
      <FloorMapEditor layoutItems={layoutItems} onSave={onSave} />
    </div>
  </div>
);

export default FloorMapSettings;

