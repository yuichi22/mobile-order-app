// LTVランク（カードの格）の見た目。
// ⚠配色はお客様のポイントカード(suomi-admin の PointCard.jsx)と同じにしてある。
//   店頭で「私のカードは金色なのにレジでは違う」と見えないようにするため。
// ⚠閾値はここに書かない。判定はサーバー(lib/crmLtvRank.js)が返す rank をそのまま使う
//   （2箇所に書くと食い違う）。rank が無い＝ランク未達は従来の緑のまま。
export const RANK_THEMES = {
  bronze: { bg: 'linear-gradient(135deg,#5a4632 0%,#8a6c4d 50%,#4a3826 100%)', label: '#e8c9a0' },
  gold: { bg: 'linear-gradient(135deg,#6d5518 0%,#b98f2e 50%,#5a460f 100%)', label: '#f6e3a1' },
  platinum: { bg: 'linear-gradient(135deg,#3f4753 0%,#8e99a8 50%,#333a44 100%)', label: '#eef2f7' }
};

export const rankTheme = (rank) => (rank?.key ? RANK_THEMES[rank.key] || null : null);

/** 会員バーの見た目。ランクがあればメタリック、無ければ従来の緑。 */
export const memberBarStyle = (rank) => {
  const t = rankTheme(rank);
  return t ? { background: t.bg } : undefined;
};
