export const normalizeTableId = (tableId) => String(tableId ?? '').trim();

export const createSecureToken = (byteCount = 24) => {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(byteCount);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

export const hashToken = async (token) => {
  const normalizedToken = String(token ?? '');
  const encoder = new TextEncoder();
  const payload = encoder.encode(normalizedToken);

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return normalizedToken;
};
