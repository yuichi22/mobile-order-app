export const STORE_ACCESS_STATUSES = {
  ACTIVE: 'active',
  STOPPED: 'stopped'
};

export const normalizeStoreAccessStatus = (value) => (
  value === STORE_ACCESS_STATUSES.STOPPED ? STORE_ACCESS_STATUSES.STOPPED : STORE_ACCESS_STATUSES.ACTIVE
);

export const isStoreStopped = (value) => normalizeStoreAccessStatus(value) === STORE_ACCESS_STATUSES.STOPPED;
