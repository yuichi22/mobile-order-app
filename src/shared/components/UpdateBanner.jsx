import { useEffect, useRef, useState } from 'react';

// 新バージョン配信の検知バナー(スタッフ画面用)。
//
// 仕組み: index.html は no-cache 配信なので、その中の entry スクリプト名
// (/assets/index-<hash>.js) が「いま配信中のバージョン」を表す。
// 起動時に一度取得して基準とし、以後は定期＋前面復帰時に再取得して
// 変わっていたらバナーを出す。タップでリロードするだけなので、
// 会計の途中でも勝手に画面が切り替わることはない。
//
// 背景: SPAはリロードするまで古いコードのまま動き続け、デプロイで旧チャンクが
// サーバーから消えるため、古い画面が未読み込みページへ遷移すると失敗する。
// 営業の合間に自分のタイミングで更新してもらうためのバナー。

const ENTRY_PATTERN = /assets\/index-[\w-]+\.js/;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 定期チェック: 5分
const MIN_CHECK_GAP_MS = 60 * 1000; // 前面復帰の連打でも1分は空ける

const fetchLiveEntry = async () => {
  const res = await fetch('/', { cache: 'no-store' });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(ENTRY_PATTERN)?.[0] || null;
};

export const UpdateBanner = () => {
  const [updateReady, setUpdateReady] = useState(false);
  const baselineRef = useRef(null);
  const lastCheckedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const now = Date.now();
      if (now - lastCheckedRef.current < MIN_CHECK_GAP_MS) return;
      lastCheckedRef.current = now;
      try {
        const entry = await fetchLiveEntry();
        if (cancelled || !entry) return;
        if (!baselineRef.current) {
          baselineRef.current = entry;
          return;
        }
        if (entry !== baselineRef.current) setUpdateReady(true);
      } catch {
        // オフライン等は無視(次のチェックで再試行)
      }
    };

    check(); // 起動時に基準を取得
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-2xl transition hover:bg-slate-700 print:hidden"
    >
      新しいバージョンがあります — タップして更新
    </button>
  );
};

export default UpdateBanner;
