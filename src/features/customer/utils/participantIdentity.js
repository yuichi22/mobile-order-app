//participantIdentity.js
import {
  CUSTOMER_PARTICIPANT_SESSION_PREFIX,
  CUSTOMER_PARTICIPANT_TABLE_PREFIX
} from '../../../shared/constants/appConstants';
import { safeStorage } from '../../../shared/utils/storage';

const normalizeSessionId = (sessionId) => String(sessionId || '').trim();
const normalizeStoreId = (storeId) => String(storeId || '').trim();
const normalizeTableId = (tableId) => String(tableId || '').trim();

const parseStoredIdentity = (value) => {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const buildSessionIdentityKey = (sessionId) => (
  `${CUSTOMER_PARTICIPANT_SESSION_PREFIX}${encodeURIComponent(normalizeSessionId(sessionId))}`
);

const buildTableIdentityKey = ({ storeId, tableId }) => (
  `${CUSTOMER_PARTICIPANT_TABLE_PREFIX}${encodeURIComponent(normalizeStoreId(storeId))}::${encodeURIComponent(normalizeTableId(tableId))}`
);

const normalizeIdentity = (identity) => {
  if (!identity) return null;

  const participantToken = String(identity.participantToken || '').trim();
  const participantId = String(identity.participantId || '').trim();
  const sessionId = normalizeSessionId(identity.sessionId);

  if (!participantToken || !participantId) {
    return null;
  }

  return {
    participantToken,
    participantId,
    sessionId: sessionId || ''
  };
};

export const getStoredParticipantIdentityForSession = (sessionId) => (
  normalizeIdentity(parseStoredIdentity(safeStorage.getItem(buildSessionIdentityKey(sessionId))))
);

export const setStoredParticipantIdentityForSession = (sessionId, identity) => {
  const normalizedIdentity = normalizeIdentity({
    ...identity,
    sessionId: normalizeSessionId(sessionId)
  });

  if (!normalizedIdentity) return;
  safeStorage.setItem(
    buildSessionIdentityKey(sessionId),
    JSON.stringify(normalizedIdentity)
  );
};

export const removeStoredParticipantIdentityForSession = (sessionId) => {
  safeStorage.removeItem(buildSessionIdentityKey(sessionId));
};

export const getStoredParticipantIdentityForTable = (tableContext) => (
  normalizeIdentity(parseStoredIdentity(safeStorage.getItem(buildTableIdentityKey(tableContext))))
);

export const setStoredParticipantIdentityForTable = (tableContext, identity) => {
  const normalizedStoreId = normalizeStoreId(tableContext?.storeId);
  const normalizedTableId = normalizeTableId(tableContext?.tableId);
  const normalizedIdentity = normalizeIdentity(identity);

  if (!normalizedStoreId || !normalizedTableId || !normalizedIdentity) return;
  safeStorage.setItem(
    buildTableIdentityKey({ storeId: normalizedStoreId, tableId: normalizedTableId }),
    JSON.stringify(normalizedIdentity)
  );
};

export const linkStoredParticipantIdentityToTable = ({ sessionId, storeId, tableId }) => {
  const sessionIdentity = getStoredParticipantIdentityForSession(sessionId);
  if (!sessionIdentity) return;

  setStoredParticipantIdentityForTable(
    { storeId, tableId },
    sessionIdentity
  );
};

export const removeStoredParticipantIdentityForTable = (tableContext) => {
  safeStorage.removeItem(buildTableIdentityKey(tableContext));
};

export const clearStoredParticipantIdentitiesForSession = (sessionId) => {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return;

  removeStoredParticipantIdentityForSession(normalizedSessionId);

  try {
    const keys = Object.keys(window.localStorage || {});
    keys.forEach((key) => {
      if (!key.startsWith(CUSTOMER_PARTICIPANT_TABLE_PREFIX)) return;

      const identity = normalizeIdentity(parseStoredIdentity(safeStorage.getItem(key)));
      if (identity?.sessionId === normalizedSessionId) {
        safeStorage.removeItem(key);
      }
    });
  } catch {
    // localStorage inaccessible in this environment
  }
};

export const getPreferredParticipantIdentity = ({ sessionId, storeId, tableId }) => (
  getStoredParticipantIdentityForSession(sessionId)
  || getStoredParticipantIdentityForTable({ storeId, tableId })
);

export const getPreferredParticipantIdentityForKnownSession = ({ sessionId, storeId, tableId }) => {
  const sessionIdentity = getStoredParticipantIdentityForSession(sessionId);
  if (sessionIdentity) return sessionIdentity;

  const tableIdentity = getStoredParticipantIdentityForTable({ storeId, tableId });

  if (!tableIdentity || !sessionId) return null;

  return tableIdentity.sessionId === normalizeSessionId(sessionId)
    ? tableIdentity
    : null;
};
