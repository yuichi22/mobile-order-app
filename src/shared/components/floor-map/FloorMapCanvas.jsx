import React, { useMemo, useState, useRef, useLayoutEffect, useEffect } from 'react';
import { Bell, CreditCard, Flame, CheckCircle, Clock } from 'lucide-react';

const FloorMapCanvas = ({
  mode,
  items = [],
  sessions = [],
  orders = [],
  calls = [],
  checks = [],
  tableMenuOverrides = {},
  selectedTableId = null,
  mapPadding = 20,
  width,
  height,
  darkTheme = false,
  movingTableId = null,
  onTableSelect,
  onTableLongPress
}) => {

const longPressTimerRef = useRef(null);
const longPressTriggeredRef = useRef(false);

const startLongPress = (tableId) => {
  longPressTriggeredRef.current = false;
  window.clearTimeout(longPressTimerRef.current);

  longPressTimerRef.current = window.setTimeout(() => {
    longPressTriggeredRef.current = true;
    onTableLongPress?.(tableId);
  }, 550);
};

const cancelLongPress = () => {
  window.clearTimeout(longPressTimerRef.current);
};

  const containerRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const padding = Number(mapPadding) || 20;
  const zoomFactor = 0.95;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const tableStatusMap = useMemo(() => {
    const map = {};
    const activeSessionIds = new Set(sessions.map((session) => session.id));

    sessions.forEach((session) => {
      const tableId = String(session.tableId);
      map[tableId] = {
        status: 'occupied',
        startTime: session.createdAt,
        sessionId: session.id
      };
    });

    orders.forEach((order) => {
      if (!activeSessionIds.has(order.sessionId)) return;
      const tableId = String(order.tableId);
      if (!map[tableId]) return;
      if (order.status === 'serving') map[tableId].status = 'ready';
      else if (order.status === 'cooking' && map[tableId].status !== 'ready') map[tableId].status = 'cooking';
    });

    checks.forEach((check) => {
      if (!activeSessionIds.has(check.sessionId)) return;
      const tableId = String(check.tableId);
      if (map[tableId]) map[tableId].status = 'checkout';
    });

    calls.forEach((call) => {
      if (!activeSessionIds.has(call.sessionId)) return;
      const tableId = String(call.tableId);
      if (map[tableId]) map[tableId].isCalling = true;
    });

    return map;
  }, [sessions, orders, calls, checks]);

  useLayoutEffect(() => {
    const calculateLayout = () => {
      if (!items || items.length === 0) return;

      const containerWidth = width || containerRef.current?.clientWidth || 0;
      const containerHeight = height || containerRef.current?.clientHeight || 0;
      if (containerWidth === 0 || containerHeight === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      items.forEach((item) => {
        if (item.x < minX) minX = item.x;
        if (item.y < minY) minY = item.y;
        if (item.x + item.width > maxX) maxX = item.x + item.width;
        if (item.y + item.height > maxY) maxY = item.y + item.height;
      });

      const centerX = minX + (maxX - minX) / 2;
      const centerY = minY + (maxY - minY) / 2;
      const scale = Math.max(
        Math.min(
          (containerWidth - padding * 2) / (maxX - minX),
          (containerHeight - padding * 2) / (maxY - minY)
        ) * zoomFactor,
        0.1
      );

      setLayout({ scale, centerX, centerY });
    };

    calculateLayout();
    window.addEventListener('resize', calculateLayout);
    return () => window.removeEventListener('resize', calculateLayout);
  }, [items, width, height]);

  const theme = {
    bg: darkTheme ? 'bg-slate-900' : 'bg-slate-50',
    tableEmpty: darkTheme ? 'bg-slate-800/40 border-slate-700 text-slate-600' : 'bg-white border-slate-200 text-slate-300'
  };

  return (
    <div ref={containerRef} className={`relative w-full h-full ${theme.bg} overflow-hidden flex items-center justify-center`}>
      <div
        className="relative w-0 h-0 transition-all duration-500"
        style={{ transform: layout ? `scale(${layout.scale})` : 'scale(0.5)', opacity: layout ? 1 : 0 }}
      >
        {items.map((item) => {
          const isWall = item.type === 'wall';

          // 内部処理用。セッション・注文・席移動との照合はこれを使う。
          const tableId = item.label ? String(item.label).replace(/^T-/, '') : '';

          // 画面表示用。任意名があれば任意名、なければ卓番号。
          const tableDisplayName = String(item.displayName || '').trim() || tableId;
          const menuOverride = tableMenuOverrides[String(tableId)] || null;
          const isSelectedTable = !isWall && String(selectedTableId || '') === String(tableId || '');

          const info = tableStatusMap[tableId];
          const isDisabled = Boolean(item.isDisabled);
          const seatsLabel = item.seats ? `${item.seats}名` : '';
          const isMovingSource = !isWall && String(movingTableId || '') === String(tableId || '');
          let bgClass = theme.tableEmpty;
          let borderClass = isWall ? 'border-transparent' : 'border-2';
          let animationClass = '';
          let icon = null;

          if (isWall) {
            bgClass = darkTheme ? 'bg-slate-700' : 'bg-slate-300';
          } else if (isDisabled) {
            bgClass = 'bg-red-50 text-red-700';
            borderClass = 'border-red-300 border-4';
          } else if (info?.isCalling) {
            bgClass = 'bg-red-500 text-white';
            borderClass = 'border-red-600 ring-4 ring-red-200';
            animationClass = 'animate-bounce';
            icon = <Bell size={22} className="fill-white" />;
          } else if (info?.status === 'checkout') {
            bgClass = 'bg-blue-600 text-white';
            borderClass = 'border-blue-700 ring-4 ring-blue-100';
            animationClass = 'animate-pulse';
            icon = <CreditCard size={22} />;
          } else if (info?.status === 'ready') {
            bgClass = 'bg-green-500 text-white';
            borderClass = 'border-green-600 shadow-lg';
            animationClass = 'animate-pulse';
            icon = <CheckCircle size={22} />;
          } else if (info?.status === 'cooking') {
            bgClass = darkTheme ? 'bg-slate-800' : 'bg-white shadow-sm';
            borderClass = 'border-orange-400 border-4';
            animationClass = 'animate-pulse';
            icon = <Flame size={22} className="text-orange-500 fill-orange-500" />;
          } else if (info?.status === 'occupied') {
            bgClass = 'bg-blue-50 text-blue-600';
            borderClass = 'border-blue-400 border-4';
          }

          return (
              <div
                key={item.id}
                onPointerDown={() => {
                  if (isWall || isDisabled) return;
                  startLongPress(tableId);
                }}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onClick={(event) => {
                  if (isWall || isDisabled) return;

                  if (longPressTriggeredRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    longPressTriggeredRef.current = false;
                    return;
                  }

                  onTableSelect?.(tableId, item.id);
                }}
                className={`absolute flex flex-col items-center justify-center transition-all duration-300 ${
                  item.shape === 'circle' ? 'rounded-full' : 'rounded-xl'
                } ${!isWall && !isDisabled ? 'cursor-pointer hover:scale-105 active:scale-95' : ''}`}
                style={{
                  width: item.width,
                  height: item.height,
                  left: item.x - (layout?.centerX || 0),
                  top: item.y - (layout?.centerY || 0),
                  transform: `rotate(${item.rotation || 0}deg)`
                }}
              >
              {!isWall && isDisabled && (
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

              {!isWall && (
              <div
                className={`absolute inset-0 z-0 ${bgClass} ${borderClass} ${animationClass} ${
                  isMovingSource ? 'ring-4 ring-blue-400 ring-offset-4 ring-offset-slate-100' : ''
                } ${
                  isSelectedTable ? 'ring-4 ring-orange-400 ring-offset-4 ring-offset-slate-100' : ''
                } ${
                  item.shape === 'circle' ? 'rounded-full' : 'rounded-xl'
                } transition-colors duration-300`}
              />
              )}

              {isWall && (
                <div className={`absolute inset-0 ${bgClass} ${item.shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`} />
              )}

              {!isWall && (
                <div className="relative z-10 flex flex-col items-center pointer-events-none px-1 text-center">
                  <span className="max-w-full break-words text-center text-xl font-black leading-tight">
                    {tableDisplayName}
                  </span>
                  <div className="mt-1">{icon}</div>
                </div>
              )}

              {!isWall && info?.startTime && (
                <div className="absolute -top-3 -right-3 z-20 pointer-events-none">
                  {(() => {
                    const start = info.startTime?.toDate ? info.startTime.toDate() : new Date(info.startTime);
                    const startMillis = start.getTime();
                    if (Number.isNaN(startMillis)) return null;

                    const diffMinutes = Math.floor((currentTime - startMillis) / 60000);
                    return (
                      <div className="bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded-full font-mono shadow-sm flex items-center gap-1">
                        <Clock size={10} />
                        {Math.max(0, diffMinutes)}m
                      </div>
                    );
                  })()}
                </div>
              )}

              {!isWall && menuOverride && (
                <div className="absolute -bottom-2 -left-2 z-20 pointer-events-none">
                  <div className="inline-flex min-w-[2.3rem] flex-col items-center justify-center rounded-lg bg-orange-500 px-1 py-0.5 text-center text-[8px] font-black leading-[0.95] text-white shadow-sm">
                    {String(menuOverride.periodName || '').trim()}
                    <span>{menuOverride.remainingMinutes}m</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FloorMapCanvas;


