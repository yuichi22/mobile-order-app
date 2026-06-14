import React from 'react';

const StocktakePage = () => (
  <div className="min-h-screen bg-slate-50 p-4">
    <div className="mx-auto max-w-md pt-10 text-center">
      <h1 className="text-xl font-black text-slate-900">棚卸し</h1>
      <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
        バーコードをスキャンして商品の在庫をカウントします。
      </p>
      <div className="mt-8 rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-sm font-bold text-slate-400">
        スキャン画面は準備中です。
      </div>
    </div>
  </div>
);

export default StocktakePage;
