import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp
} from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

export const buildTableMenuOverrideRef = (storeId, tableId) => (
  doc(db, 'stores', storeId, 'tableMenuOverrides', String(tableId))
);

export const saveTableMenuOverride = async ({
  storeId,
  tableId,
  tableName = '',
  periodId,
  periodName = '',
  durationMinutes = 30,
  createdBy = ''
}) => {
  if (!storeId) throw new Error('storeId is required');
  if (!tableId) throw new Error('tableId is required');
  if (!periodId) throw new Error('periodId is required');

  const normalizedDuration = Math.max(Number(durationMinutes) || 30, 1);
  const expiresAtDate = new Date(Date.now() + normalizedDuration * 60 * 1000);

  await setDoc(
    buildTableMenuOverrideRef(storeId, tableId),
    {
      tableId: String(tableId),
      tableName: String(tableName || ''),
      periodId: String(periodId),
      periodName: String(periodName || ''),
      durationMinutes: normalizedDuration,
      expiresAt: Timestamp.fromDate(expiresAtDate),
      createdAt: serverTimestamp(),
      createdBy: String(createdBy || ''),
      source: 'pos'
    },
    { merge: true }
  );
};

export const readTableMenuOverride = async ({ storeId, tableId }) => {
  if (!storeId || !tableId) return null;

  const snapshot = await getDoc(buildTableMenuOverrideRef(storeId, tableId));

  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const expiresAtMs = data.expiresAt?.toMillis?.() || 0;

  if (!expiresAtMs || expiresAtMs <= Date.now()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...data,
    expiresAtMs
  };
};

export const clearTableMenuOverride = async ({ storeId, tableId }) => {
  if (!storeId || !tableId) return;
  await deleteDoc(buildTableMenuOverrideRef(storeId, tableId));
};
