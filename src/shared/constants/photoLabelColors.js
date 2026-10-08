// 商品写真ラベル(例「季節限定」)の色。AKUTOブランド基準で3択に絞る(2026-10-08)。
// - ミッドナイト(既定) / シャンパン(文字はミッドナイト) / 店のテーマ色
// ⚠以前の9色(青・オレンジ等)で保存済みの商品は、データは書き換えずに表示だけミッドナイトに寄せる。
export const PHOTO_LABEL_MIDNIGHT = '#0B1220';
export const PHOTO_LABEL_CHAMPAGNE = '#D9C08A';
export const PHOTO_LABEL_THEME = 'theme';

export const PHOTO_LABEL_COLOR_OPTIONS = [
  { id: 'midnight', value: PHOTO_LABEL_MIDNIGHT, label: 'ミッドナイト' },
  { id: 'champagne', value: PHOTO_LABEL_CHAMPAGNE, label: 'シャンパン' },
  { id: 'theme', value: PHOTO_LABEL_THEME, label: '店のテーマ色' }
];

export const normalizePhotoLabelColor = (color) => {
  const value = String(color || '').trim().toLowerCase();
  if (value === PHOTO_LABEL_CHAMPAGNE.toLowerCase()) return PHOTO_LABEL_CHAMPAGNE;
  if (value === PHOTO_LABEL_THEME) return PHOTO_LABEL_THEME;
  return PHOTO_LABEL_MIDNIGHT;
};

export const resolvePhotoLabelStyle = (color, themeColor) => {
  const normalized = normalizePhotoLabelColor(color);
  if (normalized === PHOTO_LABEL_CHAMPAGNE) {
    return { backgroundColor: PHOTO_LABEL_CHAMPAGNE, color: PHOTO_LABEL_MIDNIGHT };
  }
  if (normalized === PHOTO_LABEL_THEME) {
    return { backgroundColor: themeColor || '#3B6E8F', color: '#FFFFFF' };
  }
  return { backgroundColor: PHOTO_LABEL_MIDNIGHT, color: '#FFFFFF' };
};
