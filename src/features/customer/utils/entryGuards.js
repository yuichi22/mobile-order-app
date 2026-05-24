import {
  TABLE_ENTRY_REUSE_GUARD_PREFIX,
  TABLE_ENTRY_REUSE_GUARD_TTL_MS
} from '../../../shared/constants/appConstants';

const safeSessionStorage = {
  getItem: (key) => {
    try {
      return window.sessionStorage ? window.sessionStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(key, value);
    } catch {
      return undefined;
    }
  },
  removeItem: (key) => {
    try {
      if (window.sessionStorage) window.sessionStorage.removeItem(key);
    } catch {
      return undefined;
    }
  },
  keys: () => {
    try {
      return window.sessionStorage ? Object.keys(window.sessionStorage) : [];
    } catch {
      return [];
    }
  }
};

const createTableEntryGuardKey = ({ storeId, tableId, tableToken }) => (
  `${TABLE_ENTRY_REUSE_GUARD_PREFIX}${encodeURIComponent(String(storeId || '').trim())}::${encodeURIComponent(String(tableId || '').trim())}::${encodeURIComponent(String(tableToken || '').trim())}`
);

const parseStoredGuard = (value) => {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const getStoredTableEntryGuard = (tableContext) => {
  const key = createTableEntryGuardKey(tableContext);
  const guard = parseStoredGuard(safeSessionStorage.getItem(key));

  if (!guard?.expiresAt || Number(guard.expiresAt) <= Date.now()) {
    safeSessionStorage.removeItem(key);
    return null;
  }

  return guard;
};

export const setStoredTableEntryGuard = (tableContext, sessionId = '') => {
  const key = createTableEntryGuardKey(tableContext);
  const expiresAt = Date.now() + TABLE_ENTRY_REUSE_GUARD_TTL_MS;

  safeSessionStorage.setItem(key, JSON.stringify({
    sessionId: String(sessionId || '').trim(),
    expiresAt
  }));
};

export const clearStoredTableEntryGuard = (tableContext) => {
  safeSessionStorage.removeItem(createTableEntryGuardKey(tableContext));
};

export const clearStoredTableEntryGuardsForSession = (sessionId) => {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return;

  safeSessionStorage.keys().forEach((key) => {
    if (!key.startsWith(TABLE_ENTRY_REUSE_GUARD_PREFIX)) return;

    const guard = parseStoredGuard(safeSessionStorage.getItem(key));
    if (guard?.sessionId === normalizedSessionId) {
      safeSessionStorage.removeItem(key);
    }
  });
};
