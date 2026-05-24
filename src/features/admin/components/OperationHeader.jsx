// src/features/admin/components/OperationHeader.jsx
import React from 'react';
import { BarChart3, ChefHat, MonitorCog, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const OperationHeader = ({
  currentMode = 'register', // 'register' | 'kitchen'
  storeId,
  logoUrl = '',
  storeName = ''
}) => {
  const navigate = useNavigate();

  const goToSalesAnalysis = () => {
    navigate(`/admin/${storeId}/sales`);
  };

  const goToStoreSettings = () => {
    navigate(`/admin/${storeId}/settings`);
  };

  const toggleMode = () => {
    if (currentMode === 'kitchen') {
      navigate(`/admin/${storeId}/register`);
      return;
    }

    navigate(`/admin/${storeId}/kitchen`);
  };

  const nextModeLabel = currentMode === 'kitchen'
    ? 'レジモードへ'
    : 'キッチンモードへ';

  const NextModeIcon = currentMode === 'kitchen'
    ? MonitorCog
    : ChefHat;

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 px-5 py-3 shadow-sm backdrop-blur-md">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={goToSalesAnalysis}
            className="flex h-11 items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 text-sm font-black text-gray-700 shadow-sm transition-all hover:bg-orange-50 hover:text-orange-600 active:scale-95"
          >
            <BarChart3 size={17} strokeWidth={2.7} />
            売上・分析
          </button>

          <button
            type="button"
            onClick={goToStoreSettings}
            className="flex h-11 items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 text-sm font-black text-gray-700 shadow-sm transition-all hover:bg-orange-50 hover:text-orange-600 active:scale-95"
          >
            <Settings size={17} strokeWidth={2.7} />
            店舗設定
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-center">
          <div className="flex flex-col items-center">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={storeName || '店舗ロゴ'}
                className="max-h-8 max-w-[128px] object-contain"
              />
            ) : (
              <div className="max-w-[160px] truncate text-sm font-black tracking-tight text-gray-800">
                {storeName || 'AKUTO'}
              </div>
            )}

            <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.18em] text-gray-300">
              Connected by AKUTO
            </div>
          </div>
        </div>

        <div className="flex min-w-0 justify-end">
          <button
            type="button"
            onClick={toggleMode}
            className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-gray-900 px-5 text-sm font-black text-white shadow-lg transition-all hover:bg-gray-800 active:scale-95"
          >
            <NextModeIcon size={18} strokeWidth={2.8} />
            {nextModeLabel}
          </button>
        </div>
      </div>
    </header>
  );
};

export default OperationHeader;