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

export const preloadOnIdle = (loaders) => {
  if (!Array.isArray(loaders) || loaders.length === 0) return () => {};

  const run = () => {
    loaders.forEach((loader) => {
      loader().catch(() => {});
    });
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 1200 });
    return () => window.cancelIdleCallback(id);
  }

  const timeoutId = window.setTimeout(run, 300);
  return () => window.clearTimeout(timeoutId);
};
