import React, { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Camera, Check } from 'lucide-react';
import { auth, db, functionsApi } from '../../../shared/api/firebase/client';
import { saveProductMasterItem, issueInstoreBarcode, saveProductBrand } from '../../store/services/storeDataService';
import { toHalfWidthCode } from '../../../shared/utils/halfWidth';
import MobileBrandPickModal from './MobileBrandPickModal';

// スマホ用 下げ札→商品登録。QRワンタイムコードで自動ログイン→「下げ札読み取り」→ブランド照合モーダル
// (必要ならモーダル内でブランドタグ撮影)→編集→保存。無操作60分で自動ログアウト。

const IDLE_LOGOUT_MS = 60 * 60 * 1000;
const EMPTY_FORM = { name: '', brandId: '', brandName: '', sku: '', barcode: '', size: '', colorName: '', priceTaxExcluded: '' };
const norm = (s) => String(s || '').trim().toLowerCase();

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
  const [justSaved, setJustSaved] = useState(null);
  const tagInputRef = useRef(null);
  const brandInputRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

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

  // ③ 無操作60分で自動ログアウト
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const bump = () => { lastActivityRef.current = Date.now(); };
    const events = ['touchstart', 'click', 'keydown'];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const timer = window.setInterval(async () => {
      if (Date.now() - lastActivityRef.current > IDLE_LOGOUT_MS) {
        window.clearInterval(timer);
        try { await signOut(auth); } catch (_) { /* noop */ }
        setPhase('timeout');
      }
    }, 30000);
    return () => { events.forEach((ev) => window.removeEventListener(ev, bump)); window.clearInterval(timer); };
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

  // 下げ札を撮影 → 抽出 → プリフィル → ブランド照合
  const onTagCapture = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !storeId) return;
    setScanning(true);
    setJustSaved(null);
    try {
      const data = await fileToResizedBase64(file);
      const f = await extractFields([{ data, mediaType: 'image/jpeg' }]);
      setExtracted({ maker: f.maker || '', productCode: f.productCode || '' });
      setForm((cur) => ({
        ...cur,
        name: cur.name || f.productName || '',
        sku: cur.sku || f.productCode || '',
        barcode: cur.barcode || (f.barcode ? toHalfWidthCode(String(f.barcode)) : ''),
        size: cur.size || f.size || '',
        colorName: cur.colorName || f.colorName || '',
        priceTaxExcluded: cur.priceTaxExcluded !== '' ? cur.priceTaxExcluded : (f.priceTaxExcluded ?? '')
      }));
      await resolveBrand({ brandName: f.brand, maker: f.maker, productCode: f.productCode });
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

  const save = async () => {
    if (!String(form.name || '').trim()) { alert('商品名を入力してください。'); return; }
    setSaving(true);
    try {
      let barcode = String(form.barcode || '').trim();
      barcode = barcode ? toHalfWidthCode(barcode) : await issueInstoreBarcode(storeId);
      const priceTaxExcluded = String(form.priceTaxExcluded) !== '' ? Number(form.priceTaxExcluded) : null;
      const priceTaxIncluded = Number.isFinite(priceTaxExcluded) ? Math.floor(priceTaxExcluded * 1.1) : null;
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
        taxRate: 10, taxRateType: 'standard', productType: 'retail', departmentId: 'retail', isActive: true
      });
      setJustSaved({ name: form.name.trim(), barcode });
      setForm(EMPTY_FORM);
      setExtracted({ maker: '', productCode: '' });
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
        <div className="text-sm text-slate-500">{phase === 'timeout' ? '無操作が続いたためログアウトしました。' : message}</div>
        <div className="text-sm text-slate-500">PCで「モバイル用QRを表示」から新しいQRを表示して、もう一度読み込んでください。</div>
      </div>
    );
  }

  const field = (label, key, opts = {}) => (
    <label className="block">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <input value={form[key]} onChange={updateField(key)} inputMode={opts.inputMode} placeholder={opts.placeholder || ''}
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

        <button
          type="button"
          onClick={() => tagInputRef.current?.click()}
          disabled={scanning}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-black text-white shadow-sm active:scale-95 disabled:opacity-50"
        >
          <Camera size={22} />
          {scanning ? '読み取り中…' : '下げ札を撮影して読み取る'}
        </button>

        {justSaved && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
            <Check size={16} /> 「{justSaved.name}」を登録しました（{justSaved.barcode}）
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
          {field('バーコード（空なら自動発行）', 'barcode', { inputMode: 'numeric' })}
          <div className="grid grid-cols-2 gap-3">
            {field('サイズ', 'size')}
            {field('カラー', 'colorName')}
          </div>
          {field('税抜売価', 'priceTaxExcluded', { inputMode: 'numeric' })}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <button type="button" onClick={save} disabled={saving}
          className="mx-auto flex h-14 w-full max-w-md items-center justify-center rounded-2xl bg-blue-600 text-base font-black text-white shadow-sm active:scale-95 disabled:opacity-60">
          {saving ? '登録中…' : 'この内容で登録'}
        </button>
      </div>

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
