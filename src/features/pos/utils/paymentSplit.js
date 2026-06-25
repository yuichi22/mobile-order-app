// 現金一部入金＋残額を別手段(カード/QR)で支払う「分割会計」の計算ロジック。
//
// 使い方(UX): 会計画面の現金タブで「お預かり」を入力したまま、カード/QRタブへ移動すると、
// 入力済み現金が「現金預かり」、会計額からそれを引いた残額が「カード/QR支払い」になり、
// 「現金・カードで会計する」ボタンで現金とカードに分けて記録する。
//
// 分割が成立する条件: カード/QRタブで、現金預かりが 1円以上 かつ 会計額未満。
// (現金預かり0=通常のカード/QR全額会計、現金預かり>=会計額=通常の現金会計として扱う)

export const computePaymentSplit = (paymentMethod, paymentAmountRaw, totalAmount) => {
  const total = Math.max(0, Math.round(Number(totalAmount) || 0));
  const cashEntered = Math.max(0, Math.floor(Number(paymentAmountRaw) || 0));
  const isCardOrQr = paymentMethod === 'card' || paymentMethod === 'qr';
  const isSplit = isCardOrQr && cashEntered > 0 && cashEntered < total;

  if (!isSplit) {
    return {
      isSplit: false,
      cashPortion: 0,
      otherPortion: 0,
      otherMethod: paymentMethod,
      payments: null
    };
  }

  const cashPortion = cashEntered;
  const otherPortion = total - cashEntered;

  return {
    isSplit: true,
    cashPortion,
    otherPortion,
    otherMethod: paymentMethod,
    payments: [
      { method: 'cash', amount: cashPortion },
      { method: paymentMethod, amount: otherPortion }
    ]
  };
};

export const getSplitMethodLabel = (otherMethod) => (otherMethod === 'qr' ? 'QR' : 'カード');

export const getSplitActionLabel = (otherMethod) =>
  `現金・${getSplitMethodLabel(otherMethod)}で会計する`;
