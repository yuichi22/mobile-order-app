export const getTableDisplayName = (source) => {
  if (!source) return '-';

  if (typeof source === 'string' || typeof source === 'number') {
    return String(source || '').trim() || '-';
  }

  const displayName = String(
    source.tableDisplayName ||
    source.tableName ||
    source.displayName ||
    ''
  ).trim();

  if (displayName) return displayName;

  const tableId = String(
    source.tableNumber ||
    source.tableId ||
    source.table ||
    ''
  ).trim();

  return tableId || '-';
};

export const getTableDisplayLabel = (source, options = {}) => {
  const name = getTableDisplayName(source);
  const withPrefix = options.withPrefix !== false;

  if (!withPrefix) return name;
  if (name === '-' || name === 'テイクアウト') return name;

  return `テーブル ${name}`;
};

export const getTableDisplayNameForOrder = (order) => (
  getTableDisplayName(order)
);

export const getTableDisplayLabelForOrder = (order, options = {}) => (
  getTableDisplayLabel(order, options)
);