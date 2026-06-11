import React, { useMemo, useState } from 'react';
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

const formatPrice = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `¥${Number(value || 0).toLocaleString()}`;
};

const ProductMasterKeywordSearchPanel = ({ storeId }) => {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState({
    status: 'idle',
    storeId: storeId || '',
    keyword: '',
    searchTerms: [],
    searchTermsCount: 0,
    resultCount: 0
  });

  const normalizedKeyword = useMemo(() => normalizeSearchText(keyword), [keyword]);

  const runSearch = async () => {
    const searchTerms = buildSearchTerms(normalizedKeyword);
    const baseDebug = {
      storeId: storeId || '',
      keyword: normalizedKeyword,
      searchTerms: searchTerms.slice(0, 12),
      searchTermsCount: searchTerms.length
    };

    if (!storeId) {
      setResults([]);
      setSearchedKeyword('');
      setError('storeId が空のため検索できません。');
      setDebugInfo({
        ...baseDebug,
        status: 'error',
        resultCount: 0,
        message: 'storeId is empty'
      });
      return;
    }

    if (!normalizedKeyword) {
      setResults([]);
      setSearchedKeyword('');
      setError('検索語を入力してください。');
      setDebugInfo({
        ...baseDebug,
        status: 'empty_keyword',
        resultCount: 0
      });
      return;
    }

    if (!searchTerms.length) {
      setResults([]);
      setSearchedKeyword(normalizedKeyword);
      setError('検索語を分解できませんでした。');
      setDebugInfo({
        ...baseDebug,
        status: 'empty_terms',
        resultCount: 0
      });
      return;
    }

    setLoading(true);
    setError('');
    setDebugInfo({
      ...baseDebug,
      status: 'querying',
      resultCount: '-'
    });

    try {
      console.info('[product master keyword search] query', baseDebug);

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
        ...baseDebug,
        status: 'success',
        resultCount: nextResults.length
      });
    } catch (searchError) {
      console.error('[product master keyword search] failed', searchError);
      setResults([]);
      setSearchedKeyword(normalizedKeyword);
      setError('検索に失敗しました。Debugのmessageを確認してください。');
      setDebugInfo({
        ...baseDebug,
        status: 'error',
        resultCount: 0,
        message: searchError?.message || String(searchError)
      });
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setKeyword('');
    setResults([]);
    setSearchedKeyword('');
    setError('');
    setDebugInfo({
      status: 'idle',
      storeId: storeId || '',
      keyword: '',
      searchTerms: [],
      searchTermsCount: 0,
      resultCount: 0
    });
  };

  return (
    <section className="mb-5 rounded-[1.5rem] border border-sky-100 bg-sky-50/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-500">Keyword Search</p>
          <h3 className="mt-1 text-lg font-black text-slate-900">全商品検索</h3>
          <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
            初期表示200件とは別に、31,985件の商品から searchKeywords で検索します。まずは「検索」ボタンを押して確認します。
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
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                runSearch();
              }
            }}
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

        <button
          type="button"
          onClick={runSearch}
          disabled={loading}
          className="h-12 rounded-2xl bg-sky-600 px-6 text-sm font-black text-white shadow-lg shadow-sky-500/20 transition active:scale-95 disabled:opacity-50"
        >
          {loading ? '検索中...' : '検索'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
          {error}
        </div>
      )}

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
                      {formatPrice(product.priceTaxIncluded)}
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
