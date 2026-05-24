import React from 'react';
import { Check } from 'lucide-react';

const SaveCompleteOverlay = ({ show, message = '変更を保存しました' }) => {
  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center px-6">
      <div className="animate-in fade-in zoom-in-95 duration-200 rounded-[2rem] border border-white/10 bg-slate-900/95 px-8 py-6 text-center shadow-2xl shadow-slate-900/30 backdrop-blur">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-lg shadow-black/20">
          <Check size={26} strokeWidth={3} />
        </div>
        <div className="text-base font-black tracking-tight text-white">
          {message}
        </div>
      </div>
    </div>
  );
};

export default SaveCompleteOverlay;
