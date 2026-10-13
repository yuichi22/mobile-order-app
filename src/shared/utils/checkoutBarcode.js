// お会計バーコード(イートイン)の中身。
//   現行: "OC" + 卓番号8桁 + 本人番号4桁 (例 OC123456780042。会員カード "MB"+12桁 と同じ長さ)
//         数字はCode128セットCで2桁ずつ詰まるのでバーが太く、スマホ画面でも読みやすい。
//         卓番号/本人番号は sessionId / 本人ID(注文の customerId = "participant_…") から計算した値。
//         レジ側は利用中の卓(数十件)とその卓の注文者(数人)に同じ計算をして照合する。
//   旧:   "<sessionId>.<本人ID末尾8桁>" / "<sessionId>" … 開いたままの画面に残っている分のため引き続き読める。
const SHORT_PATTERN = /^OC(\d{8})(\d{4})$/i;
const NO_CUSTOMER = '0000';

// FNV-1a 32bit。お客様端末とレジで同じ値になればよい(暗号用途ではない)。
const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const checkoutSessionCode = (sessionId) => String(fnv1a(`s:${sessionId}`) % 100_000_000).padStart(8, '0');
// 0001〜9999(0000は「本人不明」に予約)。
export const checkoutCustomerCode = (customerId) => String((fnv1a(`p:${customerId}`) % 9999) + 1).padStart(4, '0');

export const buildCheckoutBarcodeValue = (sessionId, participantId) => {
  const session = String(sessionId || '').trim();
  if (!session) return '';
  const customer = String(participantId || '').trim();
  return `OC${checkoutSessionCode(session)}${customer ? checkoutCustomerCode(customer) : NO_CUSTOMER}`;
};

// sessionCode があれば短縮形、無ければ sessionId(旧形式)で照合する。customerToken は本人の照合キー。
export const parseCheckoutBarcodeValue = (raw) => {
  const value = String(raw || '').trim();
  const short = value.match(SHORT_PATTERN);
  if (short) {
    return { sessionId: '', sessionCode: short[1], customerToken: short[2] === NO_CUSTOMER ? '' : short[2] };
  }
  const legacy = value.match(/^([A-Za-z0-9]{20})\.([A-Za-z0-9]{4,16})$/);
  if (legacy) return { sessionId: legacy[1], sessionCode: '', customerToken: legacy[2] };
  return { sessionId: value, sessionCode: '', customerToken: '' };
};

export const isShortCheckoutBarcode = (raw) => SHORT_PATTERN.test(String(raw || '').trim());

// 卓(セッション)が読み取り値に当たるか。旧形式は大小無視(リーダー設定で英字の大小が反転して届くことがある)。
export const sessionMatchesCheckoutScan = (sessionId, parsed) => {
  if (!sessionId || !parsed) return false;
  if (parsed.sessionCode) return checkoutSessionCode(sessionId) === parsed.sessionCode;
  return Boolean(parsed.sessionId) && String(sessionId).toLowerCase() === parsed.sessionId.toLowerCase();
};

// 注文のお客様キー(customerId)が本人の照合キーに当たるか。
//   4桁の数字=現行の本人番号 / それ以外=旧形式の本人ID末尾(大小無視)。
export const matchesCustomerToken = (customerKey, token) => {
  const target = String(token || '').trim();
  if (!target || !customerKey) return false;
  if (/^\d{4}$/.test(target)) return checkoutCustomerCode(customerKey) === target;
  return String(customerKey).toLowerCase().endsWith(target.toLowerCase());
};
