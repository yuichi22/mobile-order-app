export const DEFAULT_REGISTER_ID = 'register_1';
export const DEFAULT_REGISTER_NAME = 'レジ1';

const buildStorageKey = (storeId, key) => (
  `akuto-pos:${storeId || 'default'}:${key}`
);

const parseRegisterNumber = (registerId = '') => {
  const matched = String(registerId || '').match(/(\d+)$/);
  return matched ? matched[1] : '1';
};

export const getActiveRegisterContext = (storeId) => {
  if (typeof window === 'undefined') {
    return {
      id: DEFAULT_REGISTER_ID,
      name: DEFAULT_REGISTER_NAME
    };
  }

  const idKey = buildStorageKey(storeId, 'activeRegisterId');
  const nameKey = buildStorageKey(storeId, 'activeRegisterName');

  const storedId = window.localStorage.getItem(idKey) || DEFAULT_REGISTER_ID;
  const fallbackName = `レジ${parseRegisterNumber(storedId)}`;
  const storedName = window.localStorage.getItem(nameKey) || fallbackName || DEFAULT_REGISTER_NAME;

  return {
    id: storedId,
    name: storedName
  };
};

export const setActiveRegisterContext = (storeId, register) => {
  if (typeof window === 'undefined') return;

  const id = register?.id || DEFAULT_REGISTER_ID;
  const name = register?.name || `レジ${parseRegisterNumber(id)}`;

  window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterId'), id);
  window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterName'), name);
};

export const buildRegisterOptions = (count = 3) => (
  Array.from({ length: Math.max(Number(count || 3), 1) }).map((_, index) => {
    const number = index + 1;
    return {
      id: `register_${number}`,
      name: `レジ${number}`
    };
  })
);
