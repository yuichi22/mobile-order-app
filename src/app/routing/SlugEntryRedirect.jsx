// SlugEntryRedirect.jsx
// 公開URL(スラッグ) https://〜/{slug} の入口。
// Core の slugs/{slug} は公開読取ルール(getのみ)なので Firestore REST で参照し、
// Coreディープリンク(/?tenantId=..&spaceId=..)へ書き換える。
// 拠点との突き合わせ・パラメータ除去は既存の CoreSpaceLinkGuard が行う。
// 未登録スラッグや通信失敗はトップ(ランチャー/ログイン)へフォールバック。
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import AppLoading from '../../shared/components/feedback/AppLoading';

// Core(Akuto) の公開設定。WebのAPIキーはクライアント配布前提の公開値。
// 環境別に .env.development / .env.production の VITE_CORE_* で設定する。
// 未設定の環境ではスラッグ解決を行わずトップへフォールバック。
const CORE_PROJECT_ID = import.meta.env.VITE_CORE_PROJECT_ID || '';
const CORE_API_KEY = import.meta.env.VITE_CORE_API_KEY || '';
const SLUG_ENABLED = Boolean(CORE_PROJECT_ID && CORE_API_KEY);

const SlugEntryRedirect = ({ slug }) => {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    // Core 設定が無い環境ではスラッグ解決を行わずトップへ
    if (!SLUG_ENABLED) {
      navigate({ pathname: '/', search: '' }, { replace: true });
      return undefined;
    }

    (async () => {
      let target = { pathname: '/', search: '' };
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${CORE_PROJECT_ID}/databases/(default)/documents/slugs/${encodeURIComponent(slug)}?key=${CORE_API_KEY}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const f = data?.fields || {};
          const tenantId = f.tenantId?.stringValue || '';
          const spaceId = f.spaceId?.stringValue || '';
          if (tenantId && spaceId) {
            const params = new URLSearchParams({ tenantId, spaceId, s: slug });
            target = { pathname: '/', search: `?${params.toString()}` };
          }
        }
      } catch {
        // 解決できない場合はトップへ（既存フローに合流）
      }
      if (!cancelled) navigate(target, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  return <AppLoading />;
};

export default SlugEntryRedirect;
