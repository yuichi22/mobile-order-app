import React, { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Camera, Check, Barcode } from 'lucide-react';
import { auth, db, functionsApi } from '../../../shared/api/firebase/client';
import { saveProductMasterItem, issueInstoreBarcode, saveProductBrand, enqueueLabelPrint } from '../../store/services/storeDataService';
import { toHalfWidthCode } from '../../../shared/utils/halfWidth';
import { decodeBarcodeFromFile, isValidEanUpc } from '../../../shared/utils/barcodeDecode';
import BarcodeScanner from '../../inventory/components/BarcodeScanner';
import MobileBrandPickModal from './MobileBrandPickModal';

// スマホ用 下げ札→商品登録。QRワンタイムコードで自動ログイン→「下げ札読み取り」→ブランド照合モーダル
// (必要ならモーダル内でブランドタグ撮影)→編集→保存。無操作60分で自動ログアウト。

const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // ログインから12時間で自動ログアウト(操作の有無に関わらず)
const EMPTY_FORM = { name: '', brandId: '', brandName: '', sku: '', barcode: '', size: '', colorName: '', priceTaxExcluded: '', stockIn: '1', labelEnabled: false };
const norm = (s) => String(s || '').trim().toLowerCase();
// 在庫コード(2始まり13桁のインストアコード)判定。発行時はラベル印刷を自動ONにする。
const isInstoreBarcode = (value) => /^2\d{12}$/.test(String(value || '').trim());
// ラベル印刷の既定: バーコード空(=保存時に在庫コード自動発行) または 在庫コード(2始まり)ならON、
// 通常のバーコード(2始まり以外)ならOFF。※画面上での手動切替は可能。
const shouldEnableLabel = (value) => {
  const v = String(value || '').trim();
  return v === '' || isInstoreBarcode(v);
};

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
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

export default function MobileTagRegisterPage() {
  const [phase, setPhase] = useState('auth'); // auth | ready | error | timeout
  const [message, setMessage] = useState('接続しています…');
  const [storeId, setStoreId] = useState('');
  const [brands, setBrands] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [scanning, setScanning] = useState(false);        // 下げ札読み取り中
  const [scanningBrand, setScanningBrand] = useState(false); // ブランドタグ読み取り中
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [extracted, setExtracted] = useState({ maker: '', productCode: '' });
  const [brandModal, setBrandModal] = useState({ open: false, candidates: [], defaultNewName: '' });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false); // 一度読み取ったか(ボタン表示切替＋リセット用)
  const [justSaved, setJustSaved] = useState(null);
  const tagInputRef = useRef(null);
  const brandInputRef = useRef(null);

  // ① 自動ログイン
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = auth.currentUser;
        if (current && !current.isAnonymous) {
          const result = await current.getIdTokenResult();
          const claimStoreId = String(result.claims?.storeId || '');
          if (claimStoreId) { if (!cancelled) { setStoreId(claimStoreId); setPhase('ready'); } return; }
        }
        const code = new URLSearchParams(window.location.search).get('h');
        if (!code) { if (!cancelled) { setPhase('error'); setMessage('QRコードが読み取れませんでした。PCで再度QRを表示してください。'); } return; }
        const res = await httpsCallable(functionsApi, 'redeemRegisterHandoff')({ code });
        await signInWithCustomToken(auth, res.data.token);
        window.history.replaceState(null, '', '/m/tag-register');
        if (!cancelled) { setStoreId(String(res.data.storeId || '')); setPhase('ready'); }
      } catch (error) {
        if (!cancelled) { setPhase('error'); setMessage(error?.message || 'ログインに失敗しました。'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ② ブランド/仕入先を読み込み(候補算出用)
  useEffect(() => {
    if (phase !== 'ready' || !storeId) return;
    let cancelled = false;
    (async () => {
      try {
        const [bs, ss] = await Promise.all([
          getDocs(collection(db, 'stores', storeId, 'brands')),
          getDocs(collection(db, 'stores', storeId, 'suppliers'))
        ]);
        if (cancelled) return;
        setBrands(bs.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSuppliers(ss.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (_) { /* 候補が出ないだけ。手動選択は可能 */ }
    })();
    return () => { cancelled = true; };
  }, [phase, storeId]);

  // ③ ログインから12時間で自動ログアウト(操作の有無に関わらず一律)
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const sessionStart = Date.now();
    const timer = window.setInterval(async () => {
      if (Date.now() - sessionStart > SESSION_MAX_MS) {
        window.clearInterval(timer);
        try { await signOut(auth); } catch (_) { /* noop */ }
        setPhase('timeout');
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const extractFields = async (images) => {
    const res = await httpsCallable(functionsApi, 'extractHangTag')({ storeId, images });
    return res.data?.fields || {};
  };

  // 抽出ブランド名/品番/製造元から既存データで候補を算出
  const computeCandidates = async ({ brandName, maker, productCode }) => {
    const scored = new Map();
    const add = (brand, score, reason) => {
      if (!brand?.id) return;
      const cur = scored.get(brand.id);
      if (!cur || score > cur.score) scored.set(brand.id, { brand, score, reason });
    };
    if (brandName) {
      const bn = norm(brandName);
      brands.forEach((b) => {
        const n = norm(b.name);
        if (n && n === bn) add(b, 100, '名称一致');
        else if (n && (n.includes(bn) || bn.includes(n))) add(b, 70, '名称類似');
      });
    }
    if (maker) {
      const mk = norm(maker);
      const supIds = suppliers.filter((s) => { const n = norm(s.name); return n && (n === mk || n.includes(mk) || mk.includes(n)); }).map((s) => s.id);
      brands.forEach((b) => { if (b.supplierId && supIds.includes(b.supplierId)) add(b, 60, '製造元一致'); });
    }
    if (productCode) {
      const prefix = norm(productCode).replace(/[^a-z0-9]/g, '').slice(0, 4);
      if (prefix.length >= 2) {
        try {
          const snap = await getDocs(query(collection(db, 'stores', storeId, 'products'), where('searchKeywords', 'array-contains', prefix), limit(20)));
          const byBrand = {};
          snap.docs.forEach((d) => { const bid = d.data().brandId; if (bid) byBrand[bid] = (byBrand[bid] || 0) + 1; });
          Object.entries(byBrand).forEach(([bid, cnt]) => { const b = brands.find((x) => x.id === bid); if (b) add(b, 50 + Math.min(cnt, 9), '同品番系'); });
        } catch (_) { /* skip */ }
      }
    }
    return Array.from(scored.values()).sort((a, b) => b.score - a.score).slice(0, 8);
  };

  // ブランドを解決: 完全一致で自動選択、無ければ候補モーダルを開く。
  const resolveBrand = async ({ brandName, maker, productCode }) => {
    const bn = String(brandName || '').trim();
    const exact = bn ? brands.find((b) => norm(b.name) === norm(bn)) : null;
    if (exact) { setForm((cur) => ({ ...cur, brandId: exact.id, brandName: exact.name })); return; }
    const candidates = await computeCandidates({ brandName: bn, maker, productCode });
    setBrandModal({ open: true, candidates, defaultNewName: bn });
  };

  // 内容をクリアして次のタグへ。
  const resetEntry = () => {
    setForm(EMPTY_FORM);
    setExtracted({ maker: '', productCode: '' });
    setJustSaved(null);
    setHasScanned(false);
  };

  // 「読み取る」/「もう一度読み取る」: 読み取り済みなら内容をリセットしてからカメラ起動。
  const startScan = () => {
    if (hasScanned) resetEntry();
    tagInputRef.current?.click();
  };

  // 下げ札を撮影 → 抽出 → プリフィル → ブランド照合
  const onTagCapture = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !storeId) return;
    setScanning(true);
    setJustSaved(null);
    try {
      // 画像縮小・AI抽出・バーコードのデコードを並行実行。
      const [data, decodedBarcode] = await Promise.all([
        fileToResizedBase64(file),
        decodeBarcodeFromFile(file) // 縞模様を実デコード。読めれば印字OCRより正確(両端の桁も含む)。
      ]);
      const f = await extractFields([{ data, mediaType: 'image/jpeg' }]);
      // バーコードはデコード値(検証済み)を優先。失敗時はClaudeの読みをチェックデジット検証し、
      // 合う時だけ採用。合わなければ空欄(誤ったバーコードを入れない=要確認)。
      let barcodeValue = decodedBarcode || '';
      if (!barcodeValue && f.barcode) {
        const cleaned = toHalfWidthCode(String(f.barcode)).replace(/\s/g, '');
        if (isValidEanUpc(cleaned)) barcodeValue = cleaned;
      }
      // 税抜は印字があればそれ、無く税込があれば 税込÷1.1(四捨五入) で自動算出。
      const derivedExcluded = f.priceTaxExcluded != null
        ? f.priceTaxExcluded
        : (f.priceTaxIncluded != null ? Math.round(Number(f.priceTaxIncluded) / 1.1) : '');
      setExtracted({ maker: f.maker || '', productCode: f.productCode || '' });
      setForm((cur) => {
        const nextBarcode = cur.barcode || barcodeValue;
        return {
          ...cur,
          name: cur.name || f.productName || '',
          sku: cur.sku || f.productCode || '',
          barcode: nextBarcode,
          size: cur.size || f.size || '',
          colorName: cur.colorName || f.colorName || '',
          priceTaxExcluded: cur.priceTaxExcluded !== '' ? cur.priceTaxExcluded : derivedExcluded,
          // 読み取り後: バーコード空(→保存時に在庫コード自動発行)ならラベルON、通常のバーコードならOFF。
          labelEnabled: shouldEnableLabel(nextBarcode)
        };
      });
      await resolveBrand({ brandName: f.brand, maker: f.maker, productCode: f.productCode });
      setHasScanned(true);
    } catch (error) {
      alert(`読み取りに失敗しました: ${error?.message || error}`);
    } finally {
      setScanning(false);
    }
  };

  // ブランド照合モーダル内: ブランドタグを撮影 → 抽出 → 一致で選択 / 候補更新
  const onBrandTagCapture = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !storeId) return;
    setScanningBrand(true);
    try {
      const data = await fileToResizedBase64(file);
      const f = await extractFields([{ data, mediaType: 'image/jpeg' }]);
      const bn = String(f.brand || '').trim();
      const exact = bn ? brands.find((b) => norm(b.name) === norm(bn)) : null;
      if (exact) { selectBrand(exact); return; }
      const candidates = await computeCandidates({
        brandName: bn,
        maker: f.maker || extracted.maker,
        productCode: f.productCode || extracted.productCode
      });
      setBrandModal((cur) => ({ open: true, candidates, defaultNewName: bn || cur.defaultNewName }));
    } catch (error) {
      alert(`ブランドタグの読み取りに失敗しました: ${error?.message || error}`);
    } finally {
      setScanningBrand(false);
    }
  };

  const selectBrand = (brand) => {
    setForm((cur) => ({ ...cur, brandId: brand.id, brandName: brand.name }));
    setBrandModal({ open: false, candidates: [], defaultNewName: '' });
  };

  const createBrand = async (name) => {
    const id = await saveProductBrand(storeId, { name });
    const brand = { id, name };
    setBrands((cur) => [...cur, brand]);
    return brand;
  };

  const updateField = (key) => (event) => setForm((cur) => ({ ...cur, [key]: event.target.value }));

  // バーコード入力: 空/在庫コード(2始まり)ならラベルON、通常のバーコードならOFFに自動追従。
  const applyBarcode = (raw) => {
    const clean = toHalfWidthCode(String(raw || '')).replace(/\s/g, '');
    setForm((cur) => ({ ...cur, barcode: clean, labelEnabled: shouldEnableLabel(clean) }));
  };

  // ライブカメラでバーコードを検出(zxing連続読み取り=静止画より確実・検証済み値)。
  const onBarcodeDetected = (text) => {
    const clean = toHalfWidthCode(String(text || '')).replace(/\s/g, '');
    if (!clean) return;
    applyBarcode(clean);
    setScannerOpen(false);
  };

  const save = async () => {
    if (!String(form.name || '').trim()) { alert('商品名を入力してください。'); return; }
    setSaving(true);
    try {
      let barcode = String(form.barcode || '').trim();
      barcode = barcode ? toHalfWidthCode(barcode) : await issueInstoreBarcode(storeId);
      const priceTaxExcluded = String(form.priceTaxExcluded) !== '' ? Number(form.priceTaxExcluded) : null;
      const priceTaxIncluded = Number.isFinite(priceTaxExcluded) ? Math.floor(priceTaxExcluded * 1.1) : null;
      // 在庫コード(2始まり)は自動でラベル印刷ON。入庫数を登録と同時に入庫。
      const labelEnabled = Boolean(form.labelEnabled) || isInstoreBarcode(barcode);
      const stockInQuantity = Math.max(0, Math.floor(Number(form.stockIn) || 0));
      await saveProductMasterItem(storeId, {
        name: form.name.trim(),
        productGroupName: form.name.trim(),
        brandId: String(form.brandId || '').trim(),
        brandName: String(form.brandName || '').trim(),
        sku: String(form.sku || '').trim(),
        productCode: String(form.sku || '').trim(),
        barcode,
        size: String(form.size || '').trim(),
        colorName: String(form.colorName || '').trim(),
        priceTaxExcluded,
        priceTaxIncluded,
        labelEnabled,
        stockInQuantityDraft: stockInQuantity,
        taxRate: 10, taxRateType: 'standard', productType: 'retail', departmentId: 'retail', isActive: true
      });
      // ラベル印刷ON かつ 入庫あり → プリンタのあるPCへ印刷ジョブを積む(枚数=入庫数)。
      let queued = false;
      if (labelEnabled && stockInQuantity > 0) {
        try {
          await enqueueLabelPrint(storeId, {
            source: 'mobile-tag-register',
            copies: stockInQuantity,
            product: {
              name: form.name.trim(),
              barcode,
              sku: String(form.sku || '').trim(),
              productCode: String(form.sku || '').trim(),
              priceTaxIncluded,
              priceTaxExcluded,
              colorName: String(form.colorName || '').trim(),
              size: String(form.size || '').trim()
            }
          });
          queued = true;
        } catch (_) { /* 印刷キュー失敗は登録自体を妨げない */ }
      }
      setJustSaved({ name: form.name.trim(), barcode, stockIn: stockInQuantity, labelEnabled, queued });
      setForm(EMPTY_FORM);
      setExtracted({ maker: '', productCode: '' });
      setHasScanned(false);
    } catch (error) {
      alert(`登録に失敗しました: ${error?.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  if (phase === 'auth') {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-500">{message}</div>;
  }
  if (phase === 'error' || phase === 'timeout') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
        <div className="text-lg font-black text-slate-800">{phase === 'timeout' ? 'タイムアウトしました' : '接続できませんでした'}</div>
        <div className="text-sm text-slate-500">{phase === 'timeout' ? 'ログインから12時間が経過したためログアウトしました。' : message}</div>
        <div className="text-sm text-slate-500">PCで「モバイル用QRを表示」から新しいQRを表示して、もう一度読み込んでください。</div>
      </div>
    );
  }

  const field = (label, key, opts = {}) => (
    <label className="block">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <input value={form[key]} onChange={updateField(key)} inputMode={opts.inputMode} placeholder={opts.placeholder || ''}
        onFocus={opts.selectOnFocus ? (e) => e.target.select() : undefined}
        className="mt-1 h-12 w-full rounded-xl border-2 border-slate-200 px-3 text-base" />
    </label>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="sticky top-0 z-10 border-b bg-white px-4 py-3">
        <div className="text-base font-black text-slate-800">下げ札から商品登録</div>
        <div className="text-[11px] text-slate-400">下げ札を読み取る → ブランド照合 → 登録</div>
      </header>

      <div className="mx-auto max-w-md space-y-3 p-4">
        <input ref={tagInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onTagCapture} />
        <input ref={brandInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onBrandTagCapture} />

        {justSaved && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
            <Check size={16} />
            <span>
              「{justSaved.name}」を登録しました（{justSaved.barcode}）
              {justSaved.stockIn > 0 ? ` / 入庫 ${justSaved.stockIn}点` : ''}
              {justSaved.queued ? ` / ラベル${justSaved.stockIn}枚をPCへ印刷依頼` : (justSaved.labelEnabled ? ' / ラベル印刷ON' : '')}
            </span>
          </div>
        )}

        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          {field('商品名 *', 'name')}
          <div>
            <span className="text-xs font-bold text-slate-500">ブランド</span>
            <button
              type="button"
              onClick={() => setBrandModal({ open: true, candidates: [], defaultNewName: form.brandName })}
              className="mt-1 flex h-12 w-full items-center justify-between rounded-xl border-2 border-slate-200 px-3 text-base"
            >
              <span className={form.brandName ? 'text-slate-800' : 'text-slate-400'}>{form.brandName || 'ブランドを選択 / タグ読み取り'}</span>
              <span className="text-xs text-slate-400">選択</span>
            </button>
          </div>
          {field('品番 / SKU', 'sku')}
          <div>
            <span className="text-xs font-bold text-slate-500">バーコード</span>
            <div className="mt-1 flex gap-2">
              <input value={form.barcode} onChange={(e) => applyBarcode(e.target.value)} inputMode="numeric"
                className="h-12 flex-1 rounded-xl border-2 border-slate-200 px-3 text-base" />
              <button type="button" onClick={() => setScannerOpen(true)}
                className="flex h-12 items-center gap-1 rounded-xl bg-slate-700 px-3 text-sm font-black text-white active:scale-95">
                <Barcode size={16} /> スキャン
              </button>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">空のまま登録すると在庫コード（2始まり）を自動発行します。</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('サイズ', 'size')}
            {field('カラー', 'colorName')}
          </div>
          <div>
            {field('税抜売価', 'priceTaxExcluded', { inputMode: 'numeric' })}
            {String(form.priceTaxExcluded).trim() !== '' && Number.isFinite(Number(form.priceTaxExcluded)) && (
              <div className="mt-1 text-[11px] text-slate-400">税込 ¥{Math.floor(Number(form.priceTaxExcluded) * 1.1).toLocaleString()}（税率10%）</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('入庫数（登録と同時に入庫）', 'stockIn', { inputMode: 'numeric', placeholder: '空=入庫なし', selectOnFocus: true })}
            <label className="flex cursor-pointer flex-col justify-end">
              <span className="text-xs font-bold text-slate-500">ラベル印刷</span>
              <button
                type="button"
                onClick={() => setForm((cur) => ({ ...cur, labelEnabled: !cur.labelEnabled }))}
                className={`mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 text-base font-black transition ${form.labelEnabled ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-400'}`}
              >
                {form.labelEnabled ? <><Check size={18} /> ON</> : 'OFF'}
              </button>
            </label>
          </div>
          <div className="text-[11px] text-slate-400">ラベル印刷はバーコードに追従して自動切替（空・2始まり＝ON／通常バーコード＝OFF）。必要なら手動でも変更できます。</div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <div className="mx-auto flex w-full max-w-md gap-2">
          <button type="button" onClick={save} disabled={saving}
            className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-blue-600 text-base font-black text-white shadow-sm active:scale-95 disabled:opacity-60">
            {saving ? '登録中…' : '登録'}
          </button>
          <button type="button" onClick={startScan} disabled={scanning}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-black bg-white text-base font-black text-black active:scale-95 disabled:opacity-50">
            <Camera size={20} />
            {scanning ? '読み取り中…' : (hasScanned ? '再読み取り' : '読み取り')}
          </button>
        </div>
      </div>

      {scannerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-center bg-black/85 p-4">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-2 text-center text-sm font-bold text-white">バーコードを枠に合わせてください</div>
            <BarcodeScanner active={scannerOpen} onDetected={onBarcodeDetected} onError={() => {}} />
            <button type="button" onClick={() => setScannerOpen(false)}
              className="mt-3 h-12 w-full rounded-xl bg-white text-base font-black text-slate-800 active:scale-95">
              閉じる
            </button>
          </div>
        </div>
      )}

      <MobileBrandPickModal
        open={brandModal.open}
        brands={brands}
        candidates={brandModal.candidates}
        defaultNewName={brandModal.defaultNewName}
        scanningBrand={scanningBrand}
        onScanBrandTag={() => brandInputRef.current?.click()}
        onSelect={selectBrand}
        onCreate={createBrand}
        onClose={() => setBrandModal({ open: false, candidates: [], defaultNewName: '' })}
      />
    </div>
  );
}
