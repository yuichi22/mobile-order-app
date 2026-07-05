import React, { useMemo, useState } from 'react';
import { X, Plus, Camera } from 'lucide-react';

// ブランド候補モーダル(モバイル)。ブランドタグ撮影・候補(製造元/品番/名称一致)・全ブランド検索・
// 新規作成でブランドを確定する。onSelect(brand) / onCreate(name)->Promise<brand> / onScanBrandTag() を呼ぶ。
export default function MobileBrandPickModal({ open, brands, candidates, defaultNewName, scanningBrand, onScanBrandTag, onSelect, onCreate, onClose }) {
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);

  const norm = (s) => String(s || '').trim().toLowerCase();
  // useMemo は早期 return より前(＝毎回同じ順序)で呼ぶ。フック規則違反で白画面になるため。
  const filtered = useMemo(() => {
    const kw = norm(keyword);
    const candidateIds = new Set((candidates || []).map((c) => c.brand.id));
    return (brands || [])
      .filter((b) => !candidateIds.has(b.id))
      .filter((b) => !kw || norm(b.name).includes(kw))
      .slice(0, 40);
  }, [brands, keyword, candidates]);

  if (!open) return null;

  const createName = String(keyword || defaultNewName || '').trim();

  const handleCreate = async () => {
    if (!createName) return;
    setCreating(true);
    try {
      const brand = await onCreate(createName);
      if (brand) onSelect(brand);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-base font-black text-slate-800">ブランドを選択</div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="max-h-[60vh] overflow-auto p-3">
          {onScanBrandTag && (
            <button
              type="button"
              onClick={onScanBrandTag}
              disabled={scanningBrand}
              className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white active:scale-95 disabled:opacity-60"
            >
              <Camera size={18} />
              {scanningBrand ? '読み取り中…' : 'ブランドタグを撮影して読み取る'}
            </button>
          )}

          {candidates?.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[11px] font-bold text-slate-400">候補</div>
              <div className="space-y-1">
                {candidates.map(({ brand, reason }) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => onSelect(brand)}
                    className="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left active:scale-[0.99]"
                  >
                    <span className="font-bold text-slate-800">{brand.name}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{reason}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="ブランド名で検索 / 新規作成名を入力"
            className="mb-2 h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-base"
          />

          <div className="space-y-1">
            {filtered.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelect(b)}
                className="flex w-full items-center rounded-xl px-3 py-3 text-left font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.99]"
              >
                {b.name}
              </button>
            ))}
            {!filtered.length && <div className="px-3 py-2 text-sm text-slate-400">一致するブランドがありません</div>}
          </div>
        </div>

        <div className="border-t p-3">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!createName || creating}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-base font-black text-white active:scale-95 disabled:opacity-50"
          >
            <Plus size={18} />
            {createName ? `「${createName}」を新規作成` : 'ブランド名を入力'}
          </button>
        </div>
      </div>
    </div>
  );
}
