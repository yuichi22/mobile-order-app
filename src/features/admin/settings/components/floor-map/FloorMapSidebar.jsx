import React from 'react';
import { Circle, Grid, Plus, Square } from 'lucide-react';

const ToolButton = ({ icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex w-full flex-col items-center gap-2 rounded-xl px-2 py-3 text-gray-500 transition-colors hover:bg-orange-50 hover:text-orange-600"
  >
    <div className="relative rounded-xl border border-gray-100 bg-gray-50 p-2.5 transition-all group-hover:border-orange-200 group-hover:bg-white">
      {icon}
      <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm ring-2 ring-white">
        <Plus size={10} strokeWidth={3} />
      </span>
    </div>
    <span className="text-[10px] font-black leading-tight">{label}</span>
  </button>
);

export const FloorMapSidebar = ({ onAddItem }) => (
  <div className="z-10 flex w-24 shrink-0 flex-col gap-4 border-r bg-white px-3 py-4 shadow-sm">
    <div className="space-y-3">
      <div className="text-center text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">追加</div>
      <ToolButton
        onClick={() => onAddItem('table', 80, 80, 'rect', 4)}
        icon={<Square size={24} />}
        label="角テーブル"
      />
      <ToolButton
        onClick={() => onAddItem('table', 80, 80, 'circle', 4)}
        icon={<Circle size={24} />}
        label="丸テーブル"
      />
    </div>

    <div className="mx-auto h-px w-10 bg-gray-200" />

    <div className="space-y-3">
      <div className="text-center text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">設備</div>
      <ToolButton
        onClick={() => onAddItem('wall', 20, 160, 'rect')}
        icon={<Grid size={24} />}
        label="間仕切り"
      />
    </div>
  </div>
);
