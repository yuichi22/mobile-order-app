import React from 'react';
import { Layout, Save } from 'lucide-react';

export const FloorMapToolbar = ({ onSave, saveStatus = 'idle' }) => (
  <div className="z-20 shrink-0 bg-white">
    <div className="flex h-24 items-center justify-between border-b border-gray-100 bg-orange-50/50 px-8 transition-none">
      <div className="flex min-w-0 items-center gap-5">
        <div className="shrink-0 rounded-2xl bg-orange-500 p-3 text-white shadow-xl shadow-orange-200">
          <Layout size={24} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <h3 className="text-xl font-black leading-tight tracking-tight text-orange-600">フロアテーブル設定</h3>
          <p className="mt-0.5 text-[10px] font-black tracking-[0.2em] text-orange-300">
            客席や設備の位置関係を確認しながら配置を編集できます
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onSave}
        className="inline-flex items-center gap-3 rounded-xl bg-orange-500 px-6 py-3.5 text-base font-black text-white shadow-xl shadow-orange-200 transition-all hover:bg-orange-600 active:scale-95"
      >
        <Save size={16} />
        {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '保存しました' : 'レイアウトを保存'}
      </button>
    </div>
  </div>
);
