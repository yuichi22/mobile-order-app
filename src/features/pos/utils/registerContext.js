export const DEFAULT_REGISTER_ID = 'register_1';
export const DEFAULT_REGISTER_NAME = 'レジ1';

export const DEFAULT_DEPARTMENT_ID = 'retail';
export const DEFAULT_DEPARTMENT_NAME = '物販';
export const DEFAULT_REGISTER_MODE = 'pos';

export const REGISTER_MODE_OPTIONS = [
  {
    id: 'pos',
    name: 'POSレジ',
    label: 'POSレジ'
  },
  {
    id: 'order',
    name: 'ORDERレジ',
    label: 'ORDERレジ'
  }
];

export const DEFAULT_DEPARTMENTS = [
  {
    id: 'retail',
    name: '物販',
    label: '物販',
    registerMode: 'pos',
    isActive: true,
    sortOrder: 10
  },
  {
    id: 'restaurant',
    name: '飲食',
    label: '飲食',
    registerMode: 'order',
    isActive: true,
    sortOrder: 20
  }
];

export const DEFAULT_REGISTERS = [
  {
    id: 'register_1',
    name: 'レジ1',
    label: 'レジ1',
    departmentId: 'retail',
    departmentName: '物販',
    registerMode: 'pos'
  },
  {
    id: 'register_2',
    name: 'レジ2',
    label: 'レジ2',
    departmentId: 'restaurant',
    departmentName: '飲食',
    registerMode: 'order'
  },
  {
    id: 'register_3',
    name: 'レジ3',
    label: 'レジ3',
    departmentId: 'retail',
    departmentName: '物販',
    registerMode: 'pos'
  }
];

const normalizeRegisterMode = (registerMode) => (
  registerMode === 'order' ? 'order' : 'pos'
);

const parseRegisterNumber = (registerId = '') => {
  const matched = String(registerId || '').match(/(\d+)$/);
  if (!matched) return 1;

  const number = Number(matched[1]);
  return Number.isFinite(number) && number > 0 ? number : 1;
};

const buildStorageKey = (storeId, suffix) => (
  `akuto:${storeId || 'default'}:${suffix}`
);

export const buildRegisterOptions = (count = 3) => (
  Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const fallback = DEFAULT_REGISTERS[index] || DEFAULT_REGISTERS[0];

    return {
      id: `register_${number}`,
      name: `レジ${number}`,
      label: `レジ${number}`,
      departmentId: fallback.departmentId || DEFAULT_DEPARTMENT_ID,
      departmentName: fallback.departmentName || DEFAULT_DEPARTMENT_NAME,
      registerMode: normalizeRegisterMode(fallback.registerMode || DEFAULT_REGISTER_MODE)
    };
  })
);

const normalizeDepartment = (department, fallback = {}) => {
  const id = String(department?.id || fallback.id || DEFAULT_DEPARTMENT_ID).trim() || DEFAULT_DEPARTMENT_ID;
  const fallbackName = fallback.name || DEFAULT_DEPARTMENT_NAME;
  const name = String(department?.name || department?.label || fallbackName).trim() || fallbackName;
  const registerMode = normalizeRegisterMode(department?.registerMode || fallback.registerMode || DEFAULT_REGISTER_MODE);

  return {
    id,
    name,
    label: name,
    registerMode,
    isActive: department?.isActive !== false,
    sortOrder: Number.isFinite(Number(department?.sortOrder ?? fallback.sortOrder))
      ? Number(department?.sortOrder ?? fallback.sortOrder)
      : 0
  };
};

const normalizeDepartments = (departments) => {
  const source = Array.isArray(departments) && departments.length > 0
    ? departments
    : DEFAULT_DEPARTMENTS;

  const normalized = source
    .map((department, index) => normalizeDepartment(department, DEFAULT_DEPARTMENTS[index] || {}))
    .filter((department) => department.id)
    .sort((left, right) => {
      const sortDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
      if (sortDiff !== 0) return sortDiff;
      return left.id.localeCompare(right.id);
    });

  return normalized.length > 0 ? normalized : DEFAULT_DEPARTMENTS;
};

export const getAvailableDepartments = (departments) => normalizeDepartments(departments);

export const getDepartmentById = (departmentId, departments) => {
  const normalizedDepartments = getAvailableDepartments(departments);
  const normalizedId = String(departmentId || '').trim();

  return normalizedDepartments.find((department) => department.id === normalizedId)
    || normalizedDepartments.find((department) => department.id === DEFAULT_DEPARTMENT_ID)
    || normalizedDepartments[0]
    || {
      id: DEFAULT_DEPARTMENT_ID,
      name: DEFAULT_DEPARTMENT_NAME,
      label: DEFAULT_DEPARTMENT_NAME,
      registerMode: DEFAULT_REGISTER_MODE,
      isActive: true,
      sortOrder: 10
    };
};

const normalizeRegister = (register, fallback = {}, departments = DEFAULT_DEPARTMENTS) => {
  const id = String(register?.id || fallback.id || DEFAULT_REGISTER_ID).trim() || DEFAULT_REGISTER_ID;
  const fallbackName = fallback.name || `レジ${parseRegisterNumber(id)}`;
  const name = String(register?.name || register?.label || fallbackName || DEFAULT_REGISTER_NAME).trim() || fallbackName;

  const department = getDepartmentById(
    register?.departmentId || fallback.departmentId || DEFAULT_DEPARTMENT_ID,
    departments
  );

  // Stripe Terminal リーダー割当(レジ単位)。正規化で消えないよう第一級フィールドとして保持。
  // 未割当は null。この値の有無が「そのレジでカードを端末決済するか」の唯一のスイッチ。
  const stripeReaderId =
    (register?.stripeReaderId ?? fallback.stripeReaderId ?? null) || null;

  return {
    id,
    name,
    label: name,
    departmentId: department.id,
    departmentName: department.name,
    registerMode: normalizeRegisterMode(department.registerMode),
    stripeReaderId: stripeReaderId ? String(stripeReaderId).trim() : null
  };
};

const normalizeRegisters = (registers, departments = DEFAULT_DEPARTMENTS) => {
  const normalizedDepartments = getAvailableDepartments(departments);
  const source = Array.isArray(registers) && registers.length > 0
    ? registers
    : DEFAULT_REGISTERS;

  const normalized = source
    .map((register, index) => normalizeRegister(register, DEFAULT_REGISTERS[index] || {}, normalizedDepartments))
    .filter((register) => register.id);

  return normalized.length > 0
    ? normalized
    : DEFAULT_REGISTERS.map((register, index) => normalizeRegister(register, DEFAULT_REGISTERS[index] || {}, normalizedDepartments));
};

export const getAvailableRegisters = (registers, departments = DEFAULT_DEPARTMENTS) => normalizeRegisters(registers, departments);

export const getRegisterContextById = (registerId, registers, departments = DEFAULT_DEPARTMENTS) => {
  const normalizedRegisters = getAvailableRegisters(registers, departments);
  const found = normalizedRegisters.find((register) => register.id === registerId);
  if (found) return found;

  const id = registerId || DEFAULT_REGISTER_ID;
  const fallback = normalizedRegisters[0] || DEFAULT_REGISTERS[0];
  return normalizeRegister({ id }, fallback, departments);
};

export const getActiveRegisterContext = (storeId, registers, departments = DEFAULT_DEPARTMENTS) => {
  if (typeof window === 'undefined') {
    return getAvailableRegisters(registers, departments)[0] || DEFAULT_REGISTERS[0];
  }

  try {
    const idKey = buildStorageKey(storeId, 'activeRegisterId');
    const storedId = window.localStorage.getItem(idKey) || DEFAULT_REGISTER_ID;
    return getRegisterContextById(storedId, registers, departments);
  } catch (error) {
    return getAvailableRegisters(registers, departments)[0] || DEFAULT_REGISTERS[0];
  }
};

export const setActiveRegisterContext = (storeId, register) => {
  const normalized = normalizeRegister(register, DEFAULT_REGISTERS[0], DEFAULT_DEPARTMENTS);
  const { id, name, departmentId, departmentName, registerMode } = normalized;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterId'), id);
      window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterName'), name);
      window.localStorage.setItem(buildStorageKey(storeId, 'activeDepartmentId'), departmentId);
      window.localStorage.setItem(buildStorageKey(storeId, 'activeDepartmentName'), departmentName);
      window.localStorage.setItem(buildStorageKey(storeId, 'activeRegisterMode'), registerMode);
    } catch (error) {
      // localStorage が使えない環境では無視
    }
  }

  return normalized;
};

export const syncActiveRegisterName = (storeId, registers, departments = DEFAULT_DEPARTMENTS) => {
  const activeRegister = getActiveRegisterContext(storeId, registers, departments);
  const latestRegister = getRegisterContextById(activeRegister.id, registers, departments);

  if (
    activeRegister.name === latestRegister.name
    && activeRegister.departmentId === latestRegister.departmentId
    && activeRegister.departmentName === latestRegister.departmentName
    && activeRegister.registerMode === latestRegister.registerMode
  ) {
    return activeRegister;
  }

  return setActiveRegisterContext(storeId, latestRegister);
};

// ---------------------------------------------------------------------------
// 契約(エンタイトルメント)に応じた初期構成
// 新しい拠点では部門・レジを1つずつだけ用意し、必要な分だけ追加してもらう。
// DEFAULT_DEPARTMENTS/DEFAULT_REGISTERS は既存店舗の後方互換用に残す。
// ---------------------------------------------------------------------------

/** 契約で選べるレジタイプ。両方契約していなければ1つに固定される。 */
export const getAllowedRegisterModes = (entitlements) => {
  const pos = entitlements?.pos !== false;
  const order = entitlements?.order !== false;
  const modes = [];
  if (pos) modes.push('pos');
  if (order) modes.push('order');
  // 契約情報が取れない場合は従来どおり両方選べる（フェイルオープン）
  return modes.length > 0 ? modes : ['pos', 'order'];
};

/** 契約に合った1部門だけの初期構成 */
export const buildInitialDepartments = (entitlements) => {
  const modes = getAllowedRegisterModes(entitlements);
  const mode = modes[0];
  const base = mode === 'order'
    ? { id: 'restaurant', name: '飲食', label: '飲食' }
    : { id: 'retail', name: '物販', label: '物販' };

  return [{ ...base, registerMode: mode, isActive: true, sortOrder: 10 }];
};

/** レジ1台だけの初期構成 */
export const buildInitialRegisters = (departments) => {
  const department = getAvailableDepartments(departments)[0];
  return [{
    id: 'register_1',
    name: 'レジ1',
    label: 'レジ1',
    departmentId: department.id,
    departmentName: department.name,
    registerMode: normalizeRegisterMode(department.registerMode)
  }];
};

/** 課金対象になるレジ（POS契約のPOSレジ）の台数。ORDERレジはKDS課金のため数えない。 */
export const countBillablePosRegisters = (registers, departments) => {
  const normalizedDepartments = getAvailableDepartments(departments);
  return getAvailableRegisters(registers, normalizedDepartments)
    .filter((register) => normalizeRegisterMode(register.registerMode) === 'pos')
    .length;
};
