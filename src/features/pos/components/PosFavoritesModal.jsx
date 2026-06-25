import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { Plus, Search, Star, X } from 'lucide-react';
import { db } from '../../../shared/api/firebase/client';
import { normalizeScannedCode } from '../../../shared/utils/halfWidth';

// POSレジの「お気に入り(よく売る商品)」モーダル。
// - 店舗共通(Firestore: stores/{id}/posShared/favorites.productIds) と
//   この端末のみ(localStorage) をトグルで切り替え。
// - お気に入りボタン(商品名＋税込価格)をタップで1個カート追加。
// - ＋ボタンで商品検索(searchKeywords)→タップでお気に入りに登録。
// - 各ボタンの×でお気に入りから削除。

const deviceKey = (storeId) => `akuto:pos-favorites:${storeId || 'unknown'}`;

const readDeviceFavorites = (storeId) => {
  if (typeof window === 'undefined' || !storeId) return [];
  try {
    const raw = window.localStorage.getItem(deviceKey(storeId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (error) {
    console.warn('[PosFavorites] read device favorites failed', error);
    return [];
  }
};

const writeDeviceFavorites = (storeId, ids) => {
  if (typeof window === 'undefined' || !storeId) return;
  try {
    window.localStorage.setItem(deviceKey(storeId), JSON.stringify(Array.isArray(ids) ? ids : []));
  } catch (error) {
    console.warn('[PosFavorites] write device favorites failed', error);
  }
};

const resolveDisplayPrice = (product) => Number(product?.priceTaxIncluded ?? product?.price ?? 0) || 0;

export const PosFavoritesModal = ({ storeId, open, onClose, onPickProduct }) => {
  const [scope, setScope] = useState('store'); // 'store' | 'device'
  const [storeIds, setStoreIds] = useState([]);
  const [deviceIds, setDeviceIds] = useState([]);
  const [productMap, setProductMap] = useState({}); // id -> product (raw)
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');

  const favoriteIds = scope === 'store' ? storeIds : deviceIds;

  // 店舗共通お気に入りを購読。
  useEffect(() => {
    if (!open || !storeId) return undefined;
    const ref = doc(db, 'stores', storeId, 'posShared', 'favorites');
    return onSnapshot(
      ref,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        setStoreIds(Array.isArray(data?.productIds) ? data.productIds.filter(Boolean) : []);
      },
      (error) => {
        console.error('[PosFavorites] store favorites subscribe failed', error);
        setStoreIds([]);
      }
    );
  }, [open, storeId]);

  // この端末お気に入りを読み込み。
  useEffect(() => {
    if (!open) return;
    setDeviceIds(readDeviceFavorites(storeId));
  }, [open, storeId]);

  // 表示中スコープの商品実体をFirestoreから取得(名前・価格の表示＋カート追加用)。
  useEffect(() => {
    if (!open || !storeId || favoriteIds.length === 0) {
      setProductMap((current) => (favoriteIds.length === 0 ? {} : current));
      return undefined;
    }
    let cancelled = false;
    setLoadingProducts(true);
    (async () => {
      try {
        const entries = await Promise.all(
          favoriteIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(db, 'stores', storeId, 'products', id));
              return snap.exists() ? [id, { id: snap.id, ...snap.data() }] : [id, null];
            } catch {
              return [id, null];
            }
          })
        );
        if (cancelled) return;
        setProductMap(Object.fromEntries(entries));
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, storeId, favoriteIds]);

  const persistIds = useCallback(async (nextIds) => {
    const unique = Array.from(new Set(nextIds.filter(Boolean)));
    if (scope === 'store') {
      if (!storeId) return;
      try {
        await setDoc(doc(db, 'stores', storeId, 'posShared', 'favorites'), { productIds: unique }, { merge: true });
      } catch (error) {
        console.error('[PosFavorites] save store favorites failed', error);
      }
    } else {
      setDeviceIds(unique);
      writeDeviceFavorites(storeId, unique);
    }
  }, [scope, storeId]);

  const addFavorite = useCallback((product) => {
    if (!product?.id) return;
    const base = scope === 'store' ? storeIds : deviceIds;
    if (base.includes(product.id)) return;
    setProductMap((current) => ({ ...current, [product.id]: product }));
    persistIds([...base, product.id]);
  }, [scope, storeIds, deviceIds, persistIds]);

  const removeFavorite = useCallback((id) => {
    const base = scope === 'store' ? storeIds : deviceIds;
    persistIds(base.filter((favoriteId) => favoriteId !== id));
  }, [scope, storeIds, deviceIds, persistIds]);

  const runSearch = useCallback(async (rawTerm) => {
    const term = String(rawTerm || '').trim();
    if (!storeId || term.length === 0) {
      setSearchResults([]);
      setSearchMessage('');
      return;
    }
    setSearching(true);
    setSearchMessage('');
    try {
      const productsRef = collection(db, 'stores', storeId, 'products');
      const candidates = Array.from(new Set([term, term.toLowerCase()])).filter(Boolean);
      const found = new Map();
      for (const candidate of candidates) {
        const snapshot = await getDocs(query(productsRef, where('searchKeywords', 'array-contains', candidate), limit(30)));
        snapshot.docs.forEach((docSnap) => {
          if (!found.has(docSnap.id)) found.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
        if (found.size >= 30) break;
      }
      const list = Array.from(found.values())
        .filter((product) => product?.isArchived !== true && product?.isActive !== false);
      setSearchResults(list);
      setSearchMessage(list.length === 0 ? '一致する商品がありません。商品名やバーコードで検索してください。' : '');
    } catch (error) {
      console.error('[PosFavorites] search failed', error);
      setSearchResults([]);
      setSearchMessage('検索に失敗しました。');
    } finally {
      setSearching(false);
    }
  }, [storeId]);

  const favoriteProducts = useMemo(
    () => favoriteIds.map((id) => ({ id, product: productMap[id] || null })),
    [favoriteIds, productMap]
  );

  if (!open) return null;

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchTerm('');
    setSearchResults([]);
    setSearchMessage('');
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/55 p-5 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-black text-slate-800">
            <Star size={20} className="text-slate-700" />
            お気に入り
          </h3>

          <div className="flex items-center gap-3">
            {/* 店舗共通 / この端末 の保存先トグル */}
            <div className="flex items-center rounded-full border border-slate-200 bg-white p-0.5 text-xs font-black shadow-sm">
              <button
                type="button"
                onClick={() => setScope('store')}
                className={`rounded-full px-3 py-1.5 transition-colors ${scope === 'store' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                店舗共通
              </button>
              <button
                type="button"
                onClick={() => setScope('device')}
                className={`rounded-full px-3 py-1.5 transition-colors ${scope === 'device' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                この端末
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="閉じる"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {favoriteProducts.map(({ id, product }) => {
              const price = resolveDisplayPrice(product);
              return (
                <div key={id} className="relative">
                  <button
                    type="button"
                    disabled={!product}
                    onClick={() => {
                      if (!product) return;
                      onPickProduct?.(product);
                      onClose?.(); // 選んだら即レジ画面へ戻る
                    }}
                    className="flex min-h-[76px] w-full flex-col justify-center rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="line-clamp-2 break-words text-sm font-black leading-tight text-slate-800">
                      {product ? (product.name || '商品') : '(削除された商品)'}
                    </span>
                    {product && (
                      <span className="mt-1 font-mono text-base font-black text-slate-900">
                        ¥{price.toLocaleString()}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFavorite(id)}
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-white shadow-md transition-colors hover:bg-red-500"
                    aria-label="お気に入りから削除"
                  >
                    <X size={13} strokeWidth={3} />
                  </button>
                </div>
              );
            })}

            {/* 追加(＋)ボタン */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-slate-500 transition-all hover:border-slate-400 hover:bg-slate-100 active:scale-[0.98]"
            >
              <Plus size={22} strokeWidth={2.8} />
              <span className="text-xs font-black">追加</span>
            </button>
          </div>

          {favoriteIds.length === 0 && (
            <p className="mt-4 text-center text-xs font-bold text-slate-400">
              {loadingProducts ? '読み込み中...' : '「追加」から、よく売る商品をお気に入りに登録できます。'}
            </p>
          )}
        </div>
      </div>

      {/* 商品検索サブモーダル(＋から登録) */}
      {searchOpen && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center bg-slate-900/40 p-5 pt-16 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 p-4">
              <div className="relative flex-grow">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                <input
                  autoFocus
                  value={searchTerm}
                  onChange={(event) => {
                    const value = normalizeScannedCode(event.target.value);
                    setSearchTerm(value);
                    runSearch(value);
                  }}
                  placeholder="商品名 / バーコード / 品番 で検索"
                  className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white pl-10 pr-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={closeSearch}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="検索を閉じる"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {searching && (
                <p className="py-6 text-center text-xs font-bold text-slate-400">検索中...</p>
              )}
              {!searching && searchMessage && (
                <p className="py-6 text-center text-xs font-bold text-slate-400">{searchMessage}</p>
              )}
              <div className="space-y-2">
                {searchResults.map((product) => {
                  const alreadyAdded = favoriteIds.includes(product.id);
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => addFavorite(product)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-800">{product.name || '商品'}</div>
                        <div className="truncate text-[11px] font-bold text-slate-400">
                          {[product.salesAreaName, product.categoryName].filter(Boolean).join(' / ') || '分類未設定'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-sm font-black text-slate-900">
                          ¥{resolveDisplayPrice(product).toLocaleString()}
                        </span>
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${alreadyAdded ? 'bg-slate-200 text-slate-400' : 'bg-slate-800 text-white'}`}>
                          {alreadyAdded ? <Star size={14} className="fill-current" /> : <Plus size={16} strokeWidth={3} />}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosFavoritesModal;
