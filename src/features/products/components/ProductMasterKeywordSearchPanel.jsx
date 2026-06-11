import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Search, X } from 'lucide-react';

import { db } from '../../../shared/api/firebase/client';

const SEARCH_LIMIT = 80;

const classNames = (...values) => values.filter(Boolean).join(' ');

const normalizeSearchText = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
);

const addSearchTerm = (terms, value) => {
  const normalized = normalizeSearchText(value);
  if (!normalized) return;

  terms.add(normalized);

  normalized.split(/[\s　/／・,，、.。_\-ー]+/).forEach((part) => {
    const token = normalizeSearchText(part);
    if (token) terms.add(token);
  });

  const compact = normalized.replace(/[\s　/／・,，、.。_\-ー]+/g, '');
  if (compact) terms.add(compact);
};

const buildSearchTerms = (keyword) => {
  const terms = new Set();
  addSearchTerm(terms, keyword);
  return Array.from(terms).filter(Boolean).slice(0, 30);
};

const mapProductDoc = (snapshotDoc) => ({
  id: snapshotDoc.id,
  ...snapshotDoc.data()
});

const ProductMasterKeywordSearchPanel = ({ storeId }) => {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);

  const normalizedKeyword = useMemo(() => normalizeSearchText(keyword), [keyword]);

  useEffect(() => {
    if (!storeId) {
      setResults([]);
      setError('');
      setLoading(false);
      setDebugInfo(null);
      return undefined;
    }

    if (!normalizedKeyword) {
      setResults([]);
      setSearchedKeyword('');
      setError('');
      setLoading(false);
      setDebugInfo(null);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      const searchTerms = buildSearchTerms(normalizedKeyword);
      const searchTermsPreview = searchTerms.slice(0, 12);

      setDebugInfo({
        storeId,
        keyword: normalizedKeyword,
        searchTerms: searchTermsPreview,
        searchTermsCount: searchTerms.length,
        status: 'querying'
      });

      if (!searchTerms.length) {
        setResults([]);
        setSearchedKeyword('');
        return;
      }

      setLoading(true);
      setError('');

      try {
        const productsRef = collection(db, 'stores', storeId, 'products');
        const searchQuery = query(
          productsRef,
          where('searchKeywords', 'array-contains-any', searchTerms),
          limit(SEARCH_LIMIT)
        );

        const snapshot = await getDocs(searchQuery);
        const nextResults = snapshot.docs.map(mapProductDoc);
        setResults(nextResults);
        setSearchedKeyword(normalizedKeyword);
        setDebugInfo({
          storeId,
          keyword: normalizedKeyword,
          searchTerms: searchTermsPreview,
          searchTermsCount: searchTerms.length,
          resultCount: nextResults.length,
          status: 'success'
        });
      } catch (searchError) {
        console.error('[product master keyword search] failed', searchError);
        setResults([]);
        setError('検索に失敗しました。時間をおいて再度お試しください。');
        setDebugInfo({
          storeId,
          keyword: normalizedKeyword,
          searchTerms: searchTermsPreview,
          searchTermsCount: searchTerms.length,
          resultCount: 0,
          status: 'error',
          message: searchError?.message || String(searchError)
        });
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [normalizedKeyword, storeId]);

  const clearSearch = () => {
    setKeyword('');
    setResults([]);
    setSearchedKeyword('');
    setError('');
    setLoading(false);
  };

  return (
    <section className="mb-5 rounded-[1.5rem] border border-sky-100 bg-sky-50/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-500">Keyword Search</p>
          <h3 className="mt-1 text-lg font-black text-slate-900">全商品検索</h3>
          <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
            初期表示200件とは別に、31,985件の商品からキーワード検索します。商品名・品番・バーコード・ブランド名・カテゴリー名に対応しています。
          </p>
        </div>

        <div className="rounded-2xl bg-white px-3 py-2 text-xs font-black text-slate-500 shadow-sm">
          {loading ? '検索中...' : `${results.length.toLocaleString()}件`}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} strokeWidth={2.7} />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="例: north / moscot / わらび / GRAMICCI / バーコード"
            className="h-12 w-full rounded-2xl border border-sky-100 bg-white pl-10 pr-10 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          />
          {keyword && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="検索をクリア"
            >
              <X size={16} strokeWidth={2.7} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
          {error}
        </div>
      )}

      {debugInfo && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-[11px] font-bold leading-relaxed text-slate-500">
          <div className="mb-1 text-xs font-black text-slate-700">Debug:</div>
          <div>status: {debugInfo.status}</div>
          <div>storeId: {debugInfo.storeId || '(empty)'}</div>
          <div>keyword: {debugInfo.keyword || '(empty)'}</div>
          <div>searchTermsCount: {debugInfo.searchTermsCount ?? '-'}</div>
          <div>searchTerms: {(debugInfo.searchTerms || []).join(' / ') || '-'}</div>
          <div>resultCount: {debugInfo.resultCount ?? '-'}</div>
          {debugInfo.message && <div className="text-rose-600">message: {debugInfo.message}</div>}
        </div>
      )}

      {searchedKeyword && !loading && results.length === 0 && !error && (
        <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-500 shadow-sm">
          「{searchedKeyword}」に一致する商品は見つかりませんでした。
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-sky-100 bg-white">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black text-slate-400">
                <tr>
                  <th className="px-4 py-3">商品名</th>
                  <th className="px-4 py-3">ブランド</th>
                  <th className="px-4 py-3">品番</th>
                  <th className="px-4 py-3">バーコード</th>
                  <th className="px-4 py-3">分類</th>
                  <th className="px-4 py-3 text-right">売価</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((product) => (
                  <tr key={product.id} className="transition hover:bg-sky-50/50">
                    <td className="px-4 py-3">
                      <div className="font-black text-slate-900">{product.name || '名称未設定'}</div>
                      <div className="mt-1 text-xs font-bold text-slate-400">ID: {String(product.id || '').slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">{product.brandName || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs font-black text-slate-600">{product.sku || product.productCode || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs font-black text-slate-600">{product.barcode || '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-500">
                      {[product.categoryGroupName, product.categoryName, product.subCategoryName].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className={classNames('px-4 py-3 text-right font-black text-slate-900')}>
                      {product.priceTaxIncluded === null || product.priceTaxIncluded === undefined || product.priceTaxIncluded === ''
                        ? '-'
                        : `¥${Number(product.priceTaxIncluded || 0).toLocaleString()}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};

export default ProductMasterKeywordSearchPanel;
