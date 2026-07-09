import React from 'react';

const RETRY_KEY_PREFIX = 'lazy-retry:';

const isRecoverableChunkError = (error) => {
  const message = String(error?.message || error || '');
  return (
    message.includes('Failed to fetch dynamically imported module')
    || message.includes('Importing a module script failed')
    || message.includes('Expected a JavaScript-or-Wasm module script')
  );
};

export const lazyWithRetry = (importer, key) => React.lazy(async () => {
  const retryKey = `${RETRY_KEY_PREFIX}${key}`;

  try {
    const module = await importer();
    sessionStorage.removeItem(retryKey);
    return module;
  } catch (error) {
    if (isRecoverableChunkError(error) && !sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, '1');
      window.location.reload();
      return new Promise(() => {});
    }

    sessionStorage.removeItem(retryKey);
    throw error;
  }
});

// チャンクを1つずつ順次先読みする。一斉に走らせると数百KB×複数のJS解析が
// 起動直後のメインスレッドへ束で乗り、低速タブレットで「しばらくするとフリーズ」になるため、
// 各チャンクの完了を待ち、さらにアイドルを待ってから次を読む。
export const preloadOnIdle = (loaders) => {
  if (!Array.isArray(loaders) || loaders.length === 0) return () => {};

  let cancelled = false;
  let idleId = null;
  let timeoutId = null;

  const waitIdle = () => new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => resolve(), { timeout: 2000 });
      return;
    }
    timeoutId = window.setTimeout(resolve, 400);
  });

  (async () => {
    for (const loader of loaders) {
      await waitIdle();
      if (cancelled) return;
      try {
        await loader();
      } catch (_) { /* 失敗しても次へ(実表示時にlazyWithRetryが再試行) */ }
    }
  })();

  return () => {
    cancelled = true;
    if (idleId !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
};
