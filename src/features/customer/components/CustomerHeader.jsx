import React, { useEffect, useRef } from 'react';
import { UserPlus, QrCode } from 'lucide-react';

const CustomerHeader = ({
  view,
  currentPeriod,
  activeCategory,
  setActiveCategory,
  categories = [],
  isHost,
  onInvite,
  statusNotice = null,
  customerThemeColor = '#ea580c',
  isCrossSellActive = false,
  allowedCrossSellCategoryIds = []
}) => {
  const activeTabRef = useRef(null);

  useEffect(() => {
    if (!activeTabRef.current) return;

    activeTabRef.current.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest'
    });
  }, [activeCategory]);

  return (
    <div className="sticky top-0 z-30 bg-white/95 shadow-sm backdrop-blur-md">
      {view === 'menu' && (
        <>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h1 className="text-lg font-black tracking-tight text-gray-900">
                Menu
              </h1>

              <p className="mt-0.5 text-[11px] font-bold tracking-wide text-gray-400">
                {currentPeriod?.name
                  ? `${currentPeriod.name} ${currentPeriod.start} - ${currentPeriod.end}`
                  : '提供時間外'}
              </p>
            </div>

            {isHost && (
              <button
                type="button"
                onClick={onInvite}
                className="flex items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3.5 py-2 text-xs font-black text-gray-700 shadow-sm transition-all active:scale-95"
              >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: customerThemeColor }}
            >
              <QrCode size={14} strokeWidth={3} />
            </span>
            同席者QR
              </button>
            )}
          </div>

          {statusNotice && (
            <div className="border-b border-gray-100 bg-white px-4 py-3">
              {statusNotice}
            </div>
          )}

          <div className="hide-scrollbar flex gap-2 overflow-x-auto whitespace-nowrap border-b border-gray-100 bg-white px-3 py-2.5">
            {categories.map((category) => {
              const isActive = activeCategory === category.id;

              const shouldNudgeTab = Boolean(
                isCrossSellActive
                  && !isActive
                  && Array.isArray(allowedCrossSellCategoryIds)
                  && allowedCrossSellCategoryIds.includes(category.id)
              );

              return (
                <button
                  key={category.id}
                  ref={isActive ? activeTabRef : null}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition-all ${
                    isActive
                      ? 'text-white shadow-md'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                  style={
                    isActive
                      ? { backgroundColor: customerThemeColor }
                      : undefined
                  }
                >
                  <span
                    className={`inline-flex items-center ${
                      shouldNudgeTab ? 'animate-cross-sell-tab-nudge' : ''
                    }`}
                  >
                    {category.name}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default CustomerHeader;