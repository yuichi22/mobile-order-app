import { httpsCallable } from 'firebase/functions';

import { functionsApi } from '../../../shared/api/firebase/client';

// 既存会員の台帳をレジから引くための薄い中継。
// 共有シークレットはサーバ側だけが持つので、必ず callable 経由（Core を直接叩かない）。
//
// ⚠返ってくるのは氏名・カナ・電話下4桁・町名まで。番地・LTV・生年月日・全桁の電話番号は
//   Core 側で落としてある。ここで足して持たないこと（端末に無ければ漏れない）。

// Core の構造化エラー（callable は `Core: <code>` の形で運んでくる）をレジの日本語へ。
// ⚠スタッフが次に何をすれば良いかを書く。コードがそのまま出ると現場が止まる。
const CORE_ERROR_MESSAGES = {
  phone_taken: 'この携帯番号は別のお客様に登録されています。その番号で検索して、ご本人をお選びください。',
  invalid_mobile: '携帯番号（090/080/070）を入力してください。',
  unknown_member: 'お客様が見つかりませんでした。もう一度検索してください。',
  unknown_change: '取り消せる変更が見つかりませんでした。',
  already_undone: 'この変更は既に取り消されています。',
  not_your_change: '登録したご本人の端末・アカウントからのみ取り消せます。運営にご連絡ください。',
  undo_window_closed: '取り消せる時間（15分）を過ぎました。運営にご連絡ください。',
  changed_since: 'その後に番号が変更されています。現在の内容をご確認ください。',
  points_disabled: 'この店舗はポイントの付与が無効になっています。',
  amount_too_small: '金額が小さすぎてポイントになりません。',
  amount_over_limit: '1回あたりの上限を超えています。',
  query_too_short: '3文字以上で検索してください。',
  source_unmapped: 'この店舗は Akuto と連携されていません。運営にご連絡ください。'
};

/** 例外をレジに出す文言へ。該当が無ければ元のメッセージをそのまま使う。 */
export const coreErrorMessage = (e, fallback) => {
  const raw = String(e?.message || '');
  const code = raw.startsWith('Core: ') ? raw.slice('Core: '.length).trim() : raw.trim();
  return CORE_ERROR_MESSAGES[code] || raw || fallback;
};

/** 既存会員の検索。電話番号 / 氏名 / ふりがな / 町名・番地のスペース区切りAND。 */
export const searchCrmMembers = async ({ storeId, q }) => {
  const res = await httpsCallable(functionsApi, 'crmSearchMembers')({ storeId, q });
  const d = res.data || {};
  return {
    members: Array.isArray(d.members) ? d.members : [],
    matchCount: Number(d.matchCount || 0),
    truncated: d.truncated === true,
    pointsPerYen: Number(d.pointsPerYen || 0),
    pointsEnabled: d.pointsEnabled !== false,
    stampCardYen: Number(d.stampCardYen || 30000)
  };
};

/** 携帯番号を主番号にする。旧主番号は副番号へ降格（索引は両方に残る）。 */
export const setCrmMemberPhone = async ({ storeId, personId, phone }) => {
  const res = await httpsCallable(functionsApi, 'crmSetMemberPhone')({
    storeId, personId, phone, action: 'set'
  });
  return res.data || {};
};

/** 直近の主番号変更を取り消す（登録したスタッフ本人・15分以内のみ）。 */
export const undoCrmMemberPhone = async ({ storeId, personId, changeId }) => {
  const res = await httpsCallable(functionsApi, 'crmSetMemberPhone')({
    storeId, personId, changeId, action: 'undo'
  });
  return res.data || {};
};

/**
 * 手書きスタンプカードの途中分をポイントにする。
 * ⚠grantId は冪等キー。同じ付与を再送しても二重加算にならないよう、
 *   「1回の付与操作」につき1つ作って、成功するまで使い回すこと。
 */
export const grantCrmLegacyStamp = async ({ storeId, personId, amount, reason, grantId, confirm = false }) => {
  const res = await httpsCallable(functionsApi, 'crmGrantLegacyStamp')({
    storeId, personId, amount, reason, grantId, confirm
  });
  return res.data || {};
};

/** 累計のお買い上げ金額(LTV)の内訳と履歴。アコーディオンを開いた時に読む。 */
export const getCrmMemberLtv = async ({ storeId, personId }) => {
  const res = await httpsCallable(functionsApi, 'crmMemberLtv')({ storeId, personId, action: 'detail' });
  return res.data || {};
};

/**
 * LTV を正しい累計に直す。
 * ⚠adjustId は冪等キー。1回の修正操作につき1つ作り、成功するまで使い回すこと。
 * ⚠ポイントは動かない（会計と手動付与で積んだ結果なので、ここで触ると二重計上になる）。
 */
export const adjustCrmMemberLtv = async ({ storeId, personId, ltvTotal, reason, adjustId, confirm = false }) => {
  const res = await httpsCallable(functionsApi, 'crmMemberLtv')({
    storeId, personId, action: 'adjust', ltvTotal, reason, adjustId, confirm
  });
  return res.data || {};
};
