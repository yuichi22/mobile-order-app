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

const normalizeRegister = (register, fallback = {}) => {
  const id = String(register?.id || fallback.id || DEFAULT_REGISTER_ID).trim() || DEFAULT_REGISTER_ID;
  const fallbackName = fallback.name || `レジ${parseRegisterNumber(id)}`;
  const name = String(register?.name || register?.label || fallbackName || DEFAULT_REGISTER_NAME).trim() || fallbackName;

  return {
    id,
    name,
    label: name
  };
};

export const normalizeRegisters = (registers) => {
  const sourceRegisters = Array.isArray(registers) && registers.length > 0
    ? registers
    : DEFAULT_REGISTERS;

  const normalized = DEFAULT_REGISTERS.map((defaultRegister) => {
    const matched = sourceRegisters.find((register) => register?.id === defaultRegister.id);
    return normalizeRegister(matched || defaultRegister, defaultRegister);
  });

  return normalized;
};

export const getAvailableRegisters = (registers) => normalizeRegisters(registers);

export const getRegisterContextById = (registerId, registers) => {
  const normalizedRegisters = normalizeRegisters(registers);
  const found = normalizedRegisters.find((register) => register.id === registerId);
  if (found) return found;

  const id = registerId || DEFAULT_REGISTER_ID;
  return {
    id,
    name: `レジ${parseRegisterNumber(id)}`,
    label: `レジ${parseRegisterNumber(id)}`
  };
};

export const getActiveRegisterContext = (storeId, registers) => {
  if (!canUseBrowserStorage()) {
    return getRegisterContextById(DEFAULT_REGISTER_ID, registers);
  }

  try {
    const idKey = buildStorageKey(storeId, 'activeRegisterId');
    const nameKey = buildStorageKey(storeId, 'activeRegisterName');

    const storedId = window.localStorage.getItem(idKey) || DEFAULT_REGISTER_ID;
    const fallback = getRegisterContextById(storedId, registers);
    const storedName = window.localStorage.getItem(nameKey) || fallback.name || DEFAULT_REGISTER_NAME;

    return {
      ...fallback,
      id: storedId,
      name: storedName,
      label: storedName
    };
  } catch (error) {
    return getRegisterContextById(DEFAULT_REGISTER_ID, registers);
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

export const syncActiveRegisterName = (storeId, registers) => {
  const activeRegister = getActiveRegisterContext(storeId, registers);
  const latestRegister = getRegisterContextById(activeRegister.id, registers);

  if (activeRegister.name === latestRegister.name) return activeRegister;

  return setActiveRegisterContext(storeId, latestRegister);
};
