// SlugEntryRedirect.jsx
// 公開URL(スラッグ) https://〜/{slug} の入口。
// Core の slugs/{slug} は公開読取ルール(getのみ)なので Firestore REST で参照し、
// Coreディープリンク(/?tenantId=..&spaceId=..)へ書き換える。
// 拠点との突き合わせ・パラメータ除去は既存の CoreSpaceLinkGuard が行う。
// 未登録スラッグや通信失敗はトップ(ランチャー/ログイン)へフォールバック。
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import AppLoading from '../../shared/components/feedback/AppLoading';

// Core(suomin) dev の公開設定。WebのAPIキーはクライアント配布前提の公開値。
const CORE_PROJECT_ID = 'suomin-9ff5a';
const CORE_API_KEY = 'AIzaSyCrYp46BW49b6WzebW7Se6GXh__rkFvBcQ';

const SlugEntryRedirect = ({ slug }) => {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

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
