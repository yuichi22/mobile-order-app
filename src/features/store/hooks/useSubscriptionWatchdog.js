import { useEffect, useState } from 'react';

// 購読(onSnapshot)が onNext / onError のどちらも発火せず宙吊りになると、
// loading が true のまま張り付き、顧客画面がスピナーから復帰できない
// （同一タブでのセッション切替後に発生する永久ローディングの根治）。
// 一定時間 loading が解けない場合に、
//   1) loading を強制的に false にして UI の固着を防ぎ、
//   2) retryNonce を進めて購読を張り直し能動的な復旧を試みる。
const DEFAULT_WATCHDOG_MS = 6000;

export const useSubscriptionWatchdog = ({
  loading,
  active,
  setLoading,
  watchdogMs = DEFAULT_WATCHDOG_MS
}) => {
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!active || !loading) return undefined;

    const timer = window.setTimeout(() => {
      setLoading(false);
      setRetryNonce((nonce) => nonce + 1);
    }, watchdogMs);

    return () => window.clearTimeout(timer);
  }, [active, loading, setLoading, watchdogMs]);

  return retryNonce;
};
