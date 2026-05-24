export const getUrlParams = () => new URLSearchParams(window.location.search);

export const getRouteState = (locationLike = window.location) => {
  const pathname = locationLike?.pathname || '/';
  const tableMatch = pathname.match(/^\/t\/([^/]+)\/([^/]+)\/([^/]+)$/);

  if (tableMatch) {
    return {
      mode: 'entry',
      storeId: decodeURIComponent(tableMatch[1]),
      tableId: decodeURIComponent(tableMatch[2]),
      tableToken: decodeURIComponent(tableMatch[3]),
      sessionId: null,
      inviteToken: null
    };
  }

  const urlParams = new URLSearchParams(locationLike?.search || '');

  return {
    mode: getInitialMode(urlParams),
    storeId: urlParams.get('store_id'),
    tableId: urlParams.get('start_table'),
    tableToken: urlParams.get('table_token'),
    sessionId: urlParams.get('session'),
    inviteToken: urlParams.get('invite')
  };
};

export const getInitialMode = (urlParams) => {
  if (urlParams.get('action') === 'join' && urlParams.get('session')) return 'joining';

  if (urlParams.get('customer_entry') === '1' && urlParams.get('start_table') && urlParams.get('store_id')) {
    return 'customer';
  }

  if (urlParams.get('start_table')) return 'entry';
  if (urlParams.get('session')) return 'customer';

  const mode = urlParams.get('mode');
  if (['launcher', 'admin', 'kitchen', 'serve'].includes(mode)) {
    return mode;
  }

  return 'launcher';
};

export const buildSessionUrl = (sessionId, storeId) => `/?session=${sessionId}&store_id=${storeId}`;
export const buildPendingCustomerEntryUrl = (tableId, storeId, tableToken) => {
  const params = new URLSearchParams({
    customer_entry: '1',
    start_table: String(tableId),
    store_id: String(storeId)
  });

  if (tableToken) {
    params.set('table_token', String(tableToken));
  }

  return `/?${params.toString()}`;
};
export const buildJoinUrl = (sessionId, storeId, inviteToken) =>
  `/?session=${sessionId}&action=join&store_id=${storeId}&invite=${inviteToken}`;
export const buildTableEntryUrl = (tableId, storeId, tableToken) =>
  `/t/${encodeURIComponent(storeId)}/${encodeURIComponent(tableId)}/${encodeURIComponent(tableToken)}`;
