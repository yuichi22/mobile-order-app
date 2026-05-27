import React from 'react';
import {
  Ban,
  ChevronRight,
  History,
  MonitorCog,
  Volume2,
  VolumeX
} from 'lucide-react';

const KitchenHeader = ({
  currentTime,
  viewMode,
  setViewMode,
  availableStations = [],
  activeKitchenId = 'all',
  setActiveKitchenId,
  onBack,
  onSwitchToRegister,
  onSwitchToSettings,
  activeOrderCount = 0,
  soldOutCount = 0,
  isSoundEnabled = false,
  setIsSoundEnabled,
  logoUrl = '',
  storeName = ''
}) => {
  const handleSetViewMode = (nextViewMode) => {
    if (typeof setViewMode === 'function') {
      setViewMode(nextViewMode);
    }
  };

  const handleSetActiveKitchen = (nextKitchenId) => {
    if (typeof setActiveKitchenId === 'function') {
      setActiveKitchenId(nextKitchenId);
    }
  };

  const handleToggleSound = () => {
    if (typeof setIsSoundEnabled === 'function') {
      setIsSoundEnabled(!isSoundEnabled);
    }
  };

  const handleSwitchToRegister = () => {
    if (typeof onSwitchToRegister === 'function') {
      onSwitchToRegister();
      return;
    }

    if (typeof onBack === 'function') {
      onBack();
    }
  };

  const handleSwitchToSettings = () => {
    if (typeof onSwitchToSettings === 'function') {
      onSwitchToSettings();
    }
  };

  return (
    <header className="z-40 h-[72px] w-full shrink-0 border-b border-gray-100 bg-white/95 px-5 shadow-sm backdrop-blur-md print:hidden">
      <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {typeof onSwitchToSettings === 'function' && (
            <button
              type="button"
              onClick={handleSwitchToSettings}
              className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white text-gray-700 shadow-sm transition-all hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 active:scale-95"
              aria-label="設定画面を開く"
              title="設定画面を開く"
            >
              <ChevronRight size={22} strokeWidth={3} />
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col items-center justify-center rounded-2xl px-5 py-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={storeName || '店舗ロゴ'}
              className="max-h-6 max-w-[120px] object-contain"
            />
          ) : (
            <div className="max-w-[160px] truncate text-sm font-black tracking-tight text-gray-900">
              {storeName || 'AKUTO'}
            </div>
          )}

          <div className="mt-1 text-[7px] font-bold uppercase tracking-[0.18em] text-gray-300">
            Connected by AKUTO
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          <div className="hidden max-w-[520px] items-center gap-1 overflow-x-auto rounded-2xl border border-gray-100 bg-gray-50 p-1 shadow-inner lg:flex">
            {availableStations.map((station) => {
              const isActive = String(activeKitchenId) === String(station.id);

              return (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => handleSetActiveKitchen(station.id)}
                  className={`h-9 shrink-0 rounded-xl px-3 text-xs font-black transition-all ${
                    isActive
                      ? 'bg-orange-500 text-white shadow-md'
                      : 'text-gray-500 hover:bg-white hover:text-gray-800'
                  }`}
                >
                  {station.name}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => handleSetViewMode(viewMode === 'history' ? 'active' : 'history')}
            className={`hidden h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 text-sm font-black shadow-sm transition-all active:scale-95 md:flex ${
              viewMode === 'history'
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-100 bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600'
            }`}
          >
            <History size={17} strokeWidth={2.7} />
            {viewMode === 'history' ? '調理中へ戻る' : '履歴を見る'}
          </button>

          {soldOutCount > 0 && (
            <div className="hidden h-11 items-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 text-xs font-black text-red-500 xl:flex">
              <Ban size={14} />
              {soldOutCount} 件売り切れ
            </div>
          )}

          <button
            type="button"
            onClick={handleToggleSound}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition-all active:scale-95 ${
              isSoundEnabled
                ? 'border-green-100 bg-green-50 text-green-500'
                : 'border-gray-100 bg-white text-gray-400 hover:bg-gray-50'
            }`}
            aria-label={isSoundEnabled ? '通知音をオフにする' : '通知音をオンにする'}
          >
            {isSoundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>

          <button
            type="button"
            onClick={handleSwitchToRegister}
            className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-gray-900 px-5 text-sm font-black text-white shadow-lg transition-all hover:bg-gray-800 active:scale-95"
          >
            <MonitorCog size={18} strokeWidth={2.8} />
            レジモードへ
          </button>
        </div>
      </div>
    </header>
  );
};

export default KitchenHeader;