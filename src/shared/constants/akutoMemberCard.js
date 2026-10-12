// AKUTO の LINE 会員証(ポイントカード)へのリンク(2026-10-12)。
// 顧客アプリの「お会計」画面から、未登録の人を会員登録(LINE の中で完結)へ送るためのもの。
// 環境ごとに LIFF が違う: prod=ミニアプリ本番 / dev=開発用 LIFF。tenantId/spaceId は店舗の Core 連携(settings/terminal)から付ける。
// ⚠spaceId が無いと登録が既定拠点になり、友だち追加の案内も既定の公式アカウントになる。
const PROJECT_ID = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '');
const BASE = PROJECT_ID === 'mobile-order-prod'
  ? 'https://miniapp.line.me/2011299491-tVTAmxfH?liffId=2011299491-tVTAmxfH'
  : 'https://liff.line.me/2010427516-dJa8I1jp?liffId=2010427516-dJa8I1jp';

export const buildMemberCardUrl = ({ coreTenantId, coreSpaceId } = {}) => {
  const tid = String(coreTenantId || '').trim();
  if (!tid) return null;
  const sid = String(coreSpaceId || '').trim();
  return `${BASE}&tenantId=${encodeURIComponent(tid)}${sid ? `&spaceId=${encodeURIComponent(sid)}` : ''}`;
};
