// お会計バーコード(イートイン)の中身。
//   新: "<sessionId>.<本人IDの末尾8桁>"  … レジで卓を開き、その人の分を選択済みにする
//   旧: "<sessionId>"                    … 卓だけ(互換のため引き続き読める)
// 本人ID = 注文の customerId(= participantId "participant_<16桁hex>")。
// 全桁を入れるとバーが細かくなりスマホ画面で読みにくいため末尾8桁に絞る(同じ卓内での衝突は実質無い)。
const CUSTOMER_SUFFIX_LENGTH = 8;

export const buildCheckoutBarcodeValue = (sessionId, participantId) => {
  const session = String(sessionId || '').trim();
  if (!session) return '';
  const suffix = String(participantId || '').trim().replace(/^participant_/, '').slice(-CUSTOMER_SUFFIX_LENGTH);
  return /^[A-Za-z0-9]+$/.test(suffix) && suffix.length === CUSTOMER_SUFFIX_LENGTH
    ? `${session}.${suffix}`
    : session;
};

export const parseCheckoutBarcodeValue = (raw) => {
  const value = String(raw || '').trim();
  const match = value.match(/^([A-Za-z0-9]{20})\.([A-Za-z0-9]{4,16})$/);
  if (match) return { sessionId: match[1], customerSuffix: match[2] };
  return { sessionId: value, customerSuffix: '' };
};

// 注文のお客様キー(customerId)が読み取った末尾と一致するか(大小無視)。
export const matchesCustomerSuffix = (customerKey, suffix) => {
  const target = String(suffix || '').trim().toLowerCase();
  return Boolean(target) && String(customerKey || '').toLowerCase().endsWith(target);
};
