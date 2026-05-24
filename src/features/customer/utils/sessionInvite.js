import { SESSION_INVITE_TOKEN_PREFIX } from '../../../shared/constants/appConstants';
import { safeStorage } from '../../../shared/utils/storage';

export const normalizeTableKey = (tableId) => String(tableId ?? '').trim();

export const createInviteToken = () => {
  const byteCount = 24;

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(byteCount);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

export const getInviteTokenStorageKey = (sessionId) => `${SESSION_INVITE_TOKEN_PREFIX}${sessionId}`;

export const getStoredInviteToken = (sessionId) => {
  if (!sessionId) return '';
  return safeStorage.getItem(getInviteTokenStorageKey(sessionId)) || '';
};

export const setStoredInviteToken = (sessionId, token) => {
  if (!sessionId || !token) return;
  safeStorage.setItem(getInviteTokenStorageKey(sessionId), token);
};

export const removeStoredInviteToken = (sessionId) => {
  if (!sessionId) return;
  safeStorage.removeItem(getInviteTokenStorageKey(sessionId));
};
