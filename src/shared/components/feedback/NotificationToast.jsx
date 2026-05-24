import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';

const NotificationToast = ({
  message,
  description = '',
  type,
  onClose,
  dismissible = false,
  autoCloseMs = 3000
}) => {
  useEffect(() => {
    if (!autoCloseMs) return undefined;

    const timer = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [autoCloseMs, onClose]);

  const isError = type === 'error';
  const icon = isError ? <AlertCircle size={18} /> : <CheckCircle size={18} />;

  if (dismissible || description) {
    return (
      <div className="fixed left-4 right-4 top-4 z-[100] flex justify-center animate-in slide-in-from-top-4 fade-in duration-300">
        <div className={`w-full max-w-md rounded-[1.6rem] px-5 py-4 shadow-2xl ${
          isError ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-5">{message}</p>
              {description && (
                <p className={`mt-1 text-xs leading-5 ${isError ? 'text-red-100' : 'text-white/75'}`}>
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className={`-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                  isError ? 'hover:bg-white/10' : 'hover:bg-white/10'
                }`}
                aria-label="閉じる"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 transform items-center gap-2 rounded-full px-6 py-3 shadow-xl animate-in slide-in-from-top-4 fade-in duration-300 ${
      isError ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
    }`}>
      {icon}
      <span className="font-bold text-sm">{message}</span>
    </div>
  );
};

export default NotificationToast;
