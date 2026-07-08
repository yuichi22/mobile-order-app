import React, { useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Camera } from 'lucide-react';
import { functionsApi } from '../../../shared/api/firebase/client';
import { decodeBarcodeFromFile, isValidEanUpc } from '../../../shared/utils/barcodeDecode';
import { toHalfWidthCode } from '../../../shared/utils/halfWidth';

// 下げ札(値札タグ)を撮影/選択 → Cloud Function(extractHangTag)でAI抽出 → 空欄へ反映。
// onExtracted(fields) は反映結果 { filled:[label...], brand:{name,matched} } を返す想定。

// 送信前にクライアントで縮小(長辺 maxEdge px, JPEG)してbase64化。リクエスト過大とコストを抑える。
const fileToResizedBase64 = (file, maxEdge = 1600, quality = 0.85) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error('画像を解釈できませんでした'));
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// 読み取り値の読みやすい一覧(nullは非表示)。
const FIELD_LABELS = [
  ['brand', 'ブランド'], ['productName', '商品名'], ['productCode', '品番'],
  ['colorName', 'カラー'], ['colorCode', 'カラー番号'], ['size', 'サイズ'],
  ['material', '素材'], ['priceTaxExcluded', '税抜'], ['priceTaxIncluded', '税込'],
  ['barcode', 'バーコード'], ['countryOfOrigin', '原産国'], ['maker', '製造/発売元']
];

export default function HangTagScanButton({ storeId, onExtracted }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { fields, usage, applied }
  const [error, setError] = useState('');

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!storeId) { setError('店舗が特定できません。'); return; }

    setLoading(true);
    setError('');
    setResult(null);
    try {
      // 画像縮小とバーコード実デコードを並行実行。
      const [imageBase64, decodedBarcode] = await Promise.all([
        fileToResizedBase64(file),
        decodeBarcodeFromFile(file)
      ]);
      const call = httpsCallable(functionsApi, 'extractHangTag');
      const response = await call({ storeId, imageBase64, mediaType: 'image/jpeg' });
      const data = response.data || {};
      // バーコードはデコード値(検証済み)を優先。失敗時はClaudeの読みをチェックデジット検証し、
      // 合う時だけ採用。合わなければ空欄(誤りを入れない)。
      const fields = { ...(data.fields || {}) };
      if (decodedBarcode) {
        fields.barcode = decodedBarcode;
      } else if (fields.barcode) {
        const cleaned = toHalfWidthCode(String(fields.barcode)).replace(/\s/g, '');
        fields.barcode = isValidEanUpc(cleaned) ? cleaned : '';
      }
      const applied = (typeof onExtracted === 'function' ? onExtracted(fields) : null) || { filled: [], brand: null };
      setResult({ ...data, fields, applied });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const fields = result?.fields || {};
  const applied = result?.applied;
  const readValues = FIELD_LABELS
    .map(([key, label]) => [label, fields[key]])
    .filter(([, val]) => val != null && String(val).trim() !== '');

  return (
    <div className="flex flex-col gap-2">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="inline-flex h-9 items-center gap-2 rounded-lg border-2 border-blue-600 bg-white px-3 text-sm font-black text-blue-600 shadow-sm transition hover:bg-blue-50 active:scale-95 disabled:opacity-60"
      >
        <Camera size={16} />
        {loading ? '読み取り中…' : '下げ札を撮影して読み取る'}
      </button>

      {error && (
        <div className="rounded-md bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">{error}</div>
      )}

      {result && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-xs">
          <div className="font-bold text-emerald-800">
            {applied?.filled?.length ? `空欄に反映: ${applied.filled.join('・')}` : '反映できる空欄がありませんでした（既に入力済み）'}
          </div>
          {applied?.brand && (
            applied.brand.matched
              ? <div className="mt-0.5 text-emerald-700">ブランド「{applied.brand.name}」を選択しました</div>
              : <div className="mt-0.5 font-bold text-amber-600">ブランド「{applied.brand.name}」は未登録 → 「ブランドを選択」から新規作成してください</div>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-slate-500">読み取り内容 / 使用量</summary>
            <div className="mt-1 space-y-0.5 text-[11px] text-slate-700">
              {readValues.length
                ? readValues.map(([label, val]) => <div key={label}><span className="text-slate-400">{label}:</span> {String(val)}</div>)
                : <div className="text-slate-400">読み取れた項目がありませんでした</div>}
              <div className="pt-1 text-[10px] text-slate-400">
                使用: 入力{result.usage?.inputTokens}tok / 出力{result.usage?.outputTokens}tok / 約${result.usage?.estimatedUsd}
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
