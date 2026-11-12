// ポータル(メガネカルテ)から届いた予約会計の明細に付ける売り場を決める。
// 1) 依頼が売り場(salesAreaId / salesAreaName)を持っていればそれ、
// 2) 無ければ店の売り場のうち名前に「メガネ / 眼鏡 / めがね」を含むもの(最初の1つ)。
// 見つからなければ null(従来どおり売り場なし=原価なし)。
const GLASSES_NAME_RE = /メガネ|眼鏡|めがね|eyewear|glasses/i;

export const findGlassesSalesArea = (salesAreas = [], request = {}) => {
  const areas = Array.isArray(salesAreas) ? salesAreas.filter(Boolean) : [];
  const wantedId = String(request?.salesAreaId || '').trim();
  if (wantedId) {
    const byId = areas.find((area) => String(area.id || '') === wantedId);
    if (byId) return byId;
  }
  const wantedName = String(request?.salesAreaName || '').trim();
  if (wantedName) {
    const byName = areas.find((area) => String(area.name || '') === wantedName);
    if (byName) return byName;
  }
  return areas.find((area) => GLASSES_NAME_RE.test(String(area.name || area.displayName || ''))) || null;
};
