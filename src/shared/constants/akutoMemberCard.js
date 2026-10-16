// AKUTO の LINE 会員証(ポイントカード)へのリンク(2026-10-12)。
// 顧客アプリの「お会計」画面から、未登録の人を会員登録(LINE の中で完結)へ送るためのもの。
// 環境ごとに LIFF が違う: prod=ミニアプリ本番 / dev=開発用 LIFF。tenantId/spaceId は店舗の Core 連携(settings/terminal)から付ける。
// ⚠spaceId が無いと登録が既定拠点になり、友だち追加の案内も既定の公式アカウントになる。
const PROJECT_ID = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '');
const BASE = PROJECT_ID === 'mobile-order-prod'
  ? 'https://miniapp.line.me/2011299491-tVTAmxfH?liffId=2011299491-tVTAmxfH'
  : 'https://liff.line.me/2010427516-dJa8I1jp?liffId=2010427516-dJa8I1jp';

export const buildMemberCardUrl = (link) => {
  // ⚠null が来る(未連携・読み込み前)。分割代入の既定値は undefined にしか効かないので null を先に潰す
  const { coreTenantId, coreSpaceId } = link || {};
  const tid = String(coreTenantId || '').trim();
  if (!tid) return null;
  const sid = String(coreSpaceId || '').trim();
  return `${BASE}&tenantId=${encodeURIComponent(tid)}${sid ? `&spaceId=${encodeURIComponent(sid)}` : ''}`;
};

// 会員証(Core)と POS の関数の置き場。お会計画面を開いた時に空打ちして、
// ボタンを押す頃には関数が起きている状態にする(コールドスタート=実測 1.7〜4.6秒 の回避。2026-10-16)。
const CORE_PROJECT = PROJECT_ID === 'mobile-order-prod' ? 'suomin-prod' : 'suomin-9ff5a';
export const CORE_FUNCTIONS_BASE = `https://asia-northeast1-${CORE_PROJECT}.cloudfunctions.net`;
export const POS_FUNCTIONS_BASE = PROJECT_ID ? `https://asia-northeast1-${PROJECT_ID}.cloudfunctions.net` : '';

/** 関数を起こすだけの空打ち。応答は見ない(no-cors・text/plain=プリフライト無し)。 */
export const warmMemberCardFunctions = () => {
  const ping = (url, body) => {
    try {
      fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body }).catch(() => {});
    } catch { /* noop */ }
  };
  // onCall は {data:{warmup:true}} を見て即返す(Content-Type が text/plain でも本文は JSON として読まれる)
  ping(`${CORE_FUNCTIONS_BASE}/getMyPointCard`, JSON.stringify({ data: { warmup: true } }));
  ping(`${CORE_FUNCTIONS_BASE}/captureLineCustomer`, JSON.stringify({ data: { warmup: true } }));
  // onRequest 側はクエリで空打ちを受ける(no-cors では独自ヘッダーが送れない)
  if (POS_FUNCTIONS_BASE) ping(`${POS_FUNCTIONS_BASE}/completeCrmBind?warmup=1`, '{}');
};
