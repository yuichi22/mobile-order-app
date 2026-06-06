//roles.js
export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  OWNER: 'owner',
  MANAGER: 'manager',
  STAFF: 'staff'
};

const ROLE_LEVELS = {
  [USER_ROLES.SUPER_ADMIN]: 4,
  [USER_ROLES.OWNER]: 3,
  [USER_ROLES.MANAGER]: 2,
  [USER_ROLES.STAFF]: 1
};

export const normalizeUserRole = (role) => {
  if (role === 'admin') return USER_ROLES.OWNER;
  if (
    role === USER_ROLES.SUPER_ADMIN ||
    role === USER_ROLES.OWNER ||
    role === USER_ROLES.MANAGER ||
    role === USER_ROLES.STAFF
  ) {
    return role;
  }
  return null;
};

export const hasMinimumRole = (role, minimumRole) =>
  (ROLE_LEVELS[normalizeUserRole(role)] || 0) >= (ROLE_LEVELS[normalizeUserRole(minimumRole)] || 0);

export const canAccessKitchen = (role) => hasMinimumRole(role, USER_ROLES.STAFF);

export const canAccessPos = (role) => hasMinimumRole(role, USER_ROLES.STAFF);

export const canAccessAnalytics = (role) => hasMinimumRole(role, USER_ROLES.MANAGER);

export const canAccessSettings = (role) => hasMinimumRole(role, USER_ROLES.MANAGER);

export const canAccessAdminPanel = (role) =>
  canAccessPos(role) || canAccessAnalytics(role) || canAccessSettings(role);

export const canAccessAdminTab = (role, tab) => {
  if (tab === 'pos') return canAccessPos(role);
  if (tab === 'analytics') return canAccessAnalytics(role);
  if (tab === 'settings') return canAccessSettings(role);
  return false;
};

export const canAccessSettingsSection = (role, sectionId) => {
  const normalizedRole = normalizeUserRole(role);

  if (normalizedRole === USER_ROLES.SUPER_ADMIN || normalizedRole === USER_ROLES.OWNER) return true;
  if (normalizedRole !== USER_ROLES.MANAGER) return false;

  return [
    'business',
    'category',
    'crossSell',
    'period',
    'menu',
    'products',
    'discount',
    'qrcode',
    'inventoryList',
    'stockReceiving',
    'stockAdjustment',
    'purchaseCandidates',
    'purchaseOrders',
    'supplierOrders',
    'productCategories',
    'productCategoryGroups',
    'brands',
    'suppliers',
    'stockTaking',
    'longTermStock',
    'shopifyIntegration',
    'legacyImport',
    'csvImportExport'
  ].includes(sectionId);
};
