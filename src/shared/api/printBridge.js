const DEFAULT_PRINT_BRIDGE_URL = 'http://localhost:8787';

export const getPrintBridgeUrl = (settings = {}) => {
  return (
    settings?.printerSettings?.bridgeUrl ||
    import.meta.env.VITE_PRINT_BRIDGE_URL ||
    DEFAULT_PRINT_BRIDGE_URL
  );
};

export const checkPrintBridgeHealth = async (settings = {}) => {
  const baseUrl = getPrintBridgeUrl(settings);

  const response = await fetch(`${baseUrl}/health`, {
    method: 'GET'
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || '印刷ブリッジに接続できません');
  }

  return data;
};

export const printTestViaBridge = async (settings = {}) => {
  const baseUrl = getPrintBridgeUrl(settings);
  const printerSettings = settings?.printerSettings || {};

  const response = await fetch(`${baseUrl}/print/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      printerIp: printerSettings.printerIp || '',
      printerPort: Number(printerSettings.printerPort || 9100)
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'テスト印刷に失敗しました');
  }

  return data;
};

export const printReceiptViaBridge = async (payload, settings = {}) => {
  const baseUrl = getPrintBridgeUrl(settings);
  const printerSettings = settings?.printerSettings || {};

  const response = await fetch(`${baseUrl}/print/receipt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      printerIp: printerSettings.printerIp || payload?.printerIp || '',
      printerPort: Number(printerSettings.printerPort || payload?.printerPort || 9100)
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'レシート印刷に失敗しました');
  }

  return data;
};

// 東芝テック B-EV4T 等へのバーコードラベル印刷（TPCL → ブリッジ → TCP9100）。
// ラベルプリンタはレシートとは別IP想定のため labelPrinterSettings を優先する。
// ブリッジ本体は店頭Windowsの同一端末で動くため bridgeUrl は localhost を既定にレシートと共用可。
export const printLabelViaBridge = async (payload, settings = {}) => {
  const labelSettings = settings?.labelPrinterSettings || {};
  const baseUrl =
    labelSettings.bridgeUrl ||
    settings?.printerSettings?.bridgeUrl ||
    import.meta.env.VITE_PRINT_BRIDGE_URL ||
    DEFAULT_PRINT_BRIDGE_URL;

  const response = await fetch(`${baseUrl}/print/label`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      printerIp: payload?.printerIp || labelSettings.printerIp || '',
      printerPort: Number(payload?.printerPort || labelSettings.printerPort || 9100)
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'ラベル印刷に失敗しました');
  }

  return data;
};
