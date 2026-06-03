export const DEFAULT_REGISTER_ID = 'register_1';
export const DEFAULT_REGISTER_NAME = 'レジ1';

export const DEFAULT_REGISTERS = [
  {
    id: 'register_1',
    name: 'レジ1',
    label: 'レジ1'
  },
  {
    id: 'register_2',
    name: 'レジ2',
    label: 'レジ2'
  },
  {
    id: 'register_3',
    name: 'レジ3',
    label: 'レジ3'
  }
];

const buildStorageKey = (storeId, key) => (
  `akuto-pos:${storeId || 'default'}:${key}`
);

const parseRegisterNumber = (registerId = '') => {
  const matched = String(registerId || '').match(/(\d+)$/);
  return matched ? matched[1] : '1';
};

const canUseBrowserStorage = () => (
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined'
);

export const buildRegisterOptions = (count = 3) => (
  Array.from({ length: Math.max(Number(count || 3), 1) }).map((_, index) => {
    const number = index + 1;
    return {
      id: `register_${number}`,
      name: `レジ${number}`,
      label: `レジ${number}`
    };
  })
);

export const getAvailableRegisters = () => DEFAULT_REGISTERS;

export const getRegisterContextById = (registerId) => {
  const found = DEFAULT_REGISTERS.find((register) => register.id === registerId);
  if (found) return found;

  const id = registerId || DEFAULT_REGISTER_ID;
  return {
    id,
    name: `レジ${parseRegisterNumber(id)}`,
    label: `レジ${parseRegisterNumber(id)}`
  };
};

export const getActiveRegisterContext = (storeId) => {
  if (!canUseBrowserStorage()) {
    return {
      id: DEFAULT_REGISTER_ID,
      name: DEFAULT_REGISTER_NAME,
      label: DEFAULT_REGISTER_NAME
    };
  }

  try {
    const idKey = buildStorageKey(storeId, 'activeRegisterId');
    const nameKey = buildStorageKey(storeId, 'activeRegisterName');

    const storedId = window.localStorage.getItem(idKey) || DEFAULT_REGISTER_ID;
    const fallback = getRegisterContextById(storedId);
    const storedName = window.localStorage.getItem(nameKey) || fallback.name || DEFAULT_REGISTER_NAME;

    return {
      ...fallback,
      id: storedId,
      name: storedName,
      label: storedName
    };
  } catch (error) {
    return {
      id: DEFAULT_REGISTER_ID,
      name: DEFAULT_REGISTER_NAME,
      label: DEFAULT_REGISTER_NAME
    };
  }
};

export const setActiveRegisterContext = (storeId, register) => {
  const fallback = getRegisterContextById(register?.id || DEFAULT_REGISTER_ID);
  const id = register?.id || fallback.id || DEFAULT_REGISTER_ID;
  const name = register?.name || fallback.name || `レジ${parseRegisterNumber(id)}`;

  if (!canUseBrowserStorage()) {
    return {
      id,
      name,
      label: register?.label || name
    };
  }

  try {
    window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterId'), id);
    window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterName'), name);
  } catch (error) {
    // localStorage が使えない環境では保存しない。
  }

  return {
    id,
    name,
    label: register?.label || name
  };
};
