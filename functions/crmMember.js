// crmMember.js
// レジから会員ポイントを扱うための Core 中継（onCall）。
// 共有シークレットはサーバだけが持つ（ブラウザには絶対に出さない）。
// - crmLookupMember: 会員コード → 氏名/残高/利用ルール（レジで読み取った直後の表示）
// - crmRedeemPoints: ポイント利用 / 取消時の戻し（refund）
// 店舗↔Core拠点の対応は settings/terminal のみを出所にする（クライアントの申告は信用しない）。
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

const str = (v) => String(v ?? "").trim();

const ROLE_MAP = {
  admin: "owner",
  owner: "owner",
  manager: "manager",
  staff: "staff",
  super_admin: "super_admin",
};

/** users/{uid} の storeId/role を見る既存規約（posTerminal.js と同じ）。 */
async function assertStoreStaff(request, storeId) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "権限がありません。");
  const d = snap.data() || {};
  if (str(d.storeId) !== str(storeId)) throw new HttpsError("permission-denied", "権限がありません。");
  const role = ROLE_MAP[str(d.role).toLowerCase()];
  if (!role) throw new HttpsError("permission-denied", "権限がありません。");
  return role;
}

/** 店舗 → Core の tenant/space（settings/terminal が唯一の出所） */
async function resolveCoreLink(storeId) {
  const snap = await db.collection("stores").doc(storeId).collection("settings").doc("terminal").get();
  const t = snap.exists ? snap.data() || {} : {};
  const coreTenantId = str(t.coreTenantId);
  const coreSpaceId = str(t.coreSpaceId);
  if (!coreTenantId) {
    throw new HttpsError("failed-precondition", "この店舗は Akuto と連携されていません。");
  }
  return { coreTenantId, coreSpaceId: coreSpaceId || null };
}

/** Core の共有シークレット付きエンドポイントを叩く。 */
async function callCore(path, body, idempotencyKey) {
  const base = str(process.env.CORE_CRM_BASE) ||
    str(process.env.CORE_CRM_POINTS_URL).replace(/\/receiveCrmPointEvent$/, "");
  const secret = str(process.env.CORE_SALES_SECRET);
  if (!base || !secret) {
    throw new HttpsError("failed-precondition", "サーバー設定が不足しています。運営にお問い合わせください。");
  }
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Core の構造化エラーを、レジで出す日本語メッセージに変換
    const err = str(data?.error);
    if (err === "unknown_member_code" || err === "unknown_member") {
      throw new HttpsError("not-found", "会員が見つかりません。");
    }
    if (err === "insufficient_balance") {
      throw new HttpsError("failed-precondition", `ポイントが不足しています（残高 ${data?.balance ?? 0}pt）。`);
    }
    if (err === "invalid_unit") {
      throw new HttpsError("invalid-argument", `${data?.unit}pt 単位でご利用いただけます。`);
    }
    throw new HttpsError("internal", `Core: ${err || res.status}`);
  }
  return data;
}

/** 会員コード → 氏名/残高/利用ルール */
export const crmLookupMember = onCall({ region: REGION }, async (request) => {
  const storeId = str(request.data?.storeId);
  const memberCode = str(request.data?.memberCode);
  // groom の会計依頼は会員コードでなく personId を運んでくるので、そちらでも引けるようにする。
  const personId = str(request.data?.personId);
  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!memberCode && !personId) {
    throw new HttpsError("invalid-argument", "memberCode or personId required.");
  }
  await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  const data = await callCore("lookupCrmMember", {
    coreTenantId: link.coreTenantId,
    coreSpaceId: link.coreSpaceId,
    ...(memberCode ? { memberCode } : { personId }),
  });
  return {
    ok: true,
    personId: data.personId,
    displayName: data.displayName || null,
    pointBalance: Number(data.pointBalance || 0),
    // テナントのポイント設定。OFFでも残高>0なら使い切りまで利用可（旧Coreは未定義=true扱い）
    pointsEnabled: data.pointsEnabled !== false,
    redeem: data.redeem || { yenPerPoint: 1, unit: 1 },
  };
});

/**
 * ポイント利用（refund=true で会計取消時の戻し）。
 * ⚠冪等キーは `redeem-{txId}`。会計IDそのままにすると、同じ会計の「付与」
 *   （onTransactionCreatedSyncCrmPoints が Idempotency-Key: txId で送る）と衝突し、
 *   Core が duplicate と判定して**ポイントを使うと付与されない**という事故になる
 *   （dev の実会計で発生: duplicate:true で付与ゼロ）。groom 側も同じ理由で redeem- を付けている。
 */
const redeemKey = (txId) => `redeem-${txId}`;

export const crmRedeemPoints = onCall({ region: REGION }, async (request) => {
  const d = request.data || {};
  const storeId = str(d.storeId);
  const personId = str(d.personId);
  const points = Math.floor(Number(d.points) || 0);
  const txId = str(d.txId);
  const refund = d.refund === true;

  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!personId) throw new HttpsError("invalid-argument", "personId required.");
  if (points <= 0) throw new HttpsError("invalid-argument", "points must be positive.");
  if (!txId) throw new HttpsError("invalid-argument", "txId required.");
  await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  const data = await callCore(
    "redeemCrmPoints",
    {
      coreTenantId: link.coreTenantId,
      coreSpaceId: link.coreSpaceId,
      personId,
      points,
      idempotencyKey: redeemKey(txId),
      provider: "pos",
      refund,
    },
    redeemKey(txId)
  );
  return { ok: true, ...data };
});

// ──────────────────────────────────────────────────────────────────────────────
// ポイントカードのご案内（2026-10-05）の3本。
// 既存会員の多くは固定電話で登録されている（prod 17,781人中 3,320人=18.7%）。
// 名寄せキーは電話番号の数字列の完全一致なので、その人がポイントカードに携帯で登録すると
// 既存 person に繋がらず、過去のポイントと LTV が引き継がれない。
// 先にレジで探して携帯番号を主番号に入れ、手書きスタンプの途中分もここで引き継ぐ。
//
// ⚠全桁の電話番号・番地・LTV・生年月日は Core 側で既に落ちている。
//   ここで足して返さないこと（端末に無ければ漏れない）。

/** 日本の携帯番号か（070/080/090 の11桁）。Core 側 lib/jpPhone.js と同じ規則。 */
const isJpMobile = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("81") && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0[789]0\d{8}$/.test(d);
};

/** 担当スタッフ（監査記録に残す）。Core は検証できないので POS の認証済み uid を正とする。 */
const actorOf = (request, storeId, role) => ({
  uid: String(request.auth?.uid || ""),
  role: String(role || ""),
  storeId: String(storeId || ""),
});

/**
 * 既存会員の検索（電話番号 / 氏名 / ふりがな / 町名・番地のスペース区切りAND）。
 * ⚠**複数ヒットする前提**。prod には 871番号・1,837人の重複（家族で1番号を共有）があり、
 *   1件目を自動選択すると他人のポイントを渡す事故になる。必ず人に選ばせる。
 */
export const crmSearchMembers = onCall({ region: REGION }, async (request) => {
  const storeId = str(request.data?.storeId);
  const q = str(request.data?.q);
  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (q.replace(/[\s\u3000]+/g, "").length < 3) {
    throw new HttpsError("invalid-argument", "3文字以上で検索してください。");
  }
  await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  const data = await callCore("searchCrmMembers", {
    coreTenantId: link.coreTenantId,
    coreSpaceId: link.coreSpaceId,
    q,
    limit: 20,
  });
  return {
    ok: true,
    members: Array.isArray(data.members) ? data.members : [],
    matchCount: Number(data.matchCount || 0),
    truncated: data.truncated === true,
    // ⚠付与率もそのまま返すこと。レジは「¥○○ → ○pt」を先に見せてから付与する。
    //   ここで落とすと画面側が付与率0と解釈し、付与ボタンがずっと押せなくなる。
    pointsPerYen: Number(data.pointsPerYen || 0),
    pointsEnabled: data.pointsEnabled !== false,
    stampCardYen: Number(data.stampCardYen || 30000),
  };
});

/**
 * 主番号（携帯）の登録 / 直近15分の取消。
 * action: "set" で携帯を主番号にし、旧主番号は副番号へ降格（索引は両方に残る）。
 * action: "undo" で元に戻す（登録したスタッフ本人・15分以内のみ）。
 */
export const crmSetMemberPhone = onCall({ region: REGION }, async (request) => {
  const d = request.data || {};
  const storeId = str(d.storeId);
  const personId = str(d.personId);
  const action = str(d.action) || "set";
  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!personId) throw new HttpsError("invalid-argument", "personId required.");
  if (action === "set" && !isJpMobile(d.phone)) {
    // サーバ側でも弾くが、往復させる前にここで止める（打ち間違いが一番多い）
    throw new HttpsError("invalid-argument", "携帯番号（090/080/070）を入力してください。");
  }
  if (action === "undo" && !str(d.changeId)) {
    throw new HttpsError("invalid-argument", "changeId required.");
  }
  const role = await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  return callCore("updateCrmMemberPhone", {
    coreTenantId: link.coreTenantId,
    coreSpaceId: link.coreSpaceId,
    personId,
    action,
    ...(action === "undo" ? { changeId: str(d.changeId) } : { phone: str(d.phone) }),
    actor: actorOf(request, storeId, role),
  });
});

/** スタンプカード1枚＝30,000円（AppSheet取込の LTV 換算と同じ尺度）。 */
const LEGACY_STAMP_CARD_YEN = 30000;

/**
 * 手書きスタンプカードの途中分をポイントにする。
 * ⚠入力は**金額（円）**。ポイントは Core が付与率から計算する（元帳に amount と points の
 *   両方が残り、後から「何に対する付与か」を追える）。
 * ⚠1回 30,000円＝カード1枚まで。2枚以上溜めている人は複数回に分ける。
 * ⚠grantId は呼び出し側が作る冪等キー。通信が切れて再送しても二重付与にならない。
 */
export const crmGrantLegacyStamp = onCall({ region: REGION }, async (request) => {
  const d = request.data || {};
  const storeId = str(d.storeId);
  const personId = str(d.personId);
  const amount = Math.floor(Number(d.amount) || 0);
  const reason = str(d.reason);
  const grantId = str(d.grantId);

  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!personId) throw new HttpsError("invalid-argument", "personId required.");
  if (!grantId) throw new HttpsError("invalid-argument", "grantId required.");
  if (!reason) throw new HttpsError("invalid-argument", "付与の理由を入力してください。");
  if (amount <= 0) throw new HttpsError("invalid-argument", "金額を入力してください。");
  if (amount > LEGACY_STAMP_CARD_YEN) {
    throw new HttpsError(
      "invalid-argument",
      `1回あたり ¥${LEGACY_STAMP_CARD_YEN.toLocaleString()}（カード1枚分）までです。2枚以上は分けて付与してください。`,
    );
  }
  const role = await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  const data = await callCore(
    "grantCrmLegacyStamp",
    {
      coreTenantId: link.coreTenantId,
      coreSpaceId: link.coreSpaceId,
      personId,
      amount,
      reason,
      idempotencyKey: `stamp-${grantId}`,
      confirm: d.confirm === true,
      actor: actorOf(request, storeId, role),
    },
    `stamp-${grantId}`,
  );
  // 枚数から見て多すぎる付与は Core が確認を求めてくる（200 で返るのでエラーにならない）。
  if (data?.requiresConfirm === true) return { ok: false, ...data };
  return { ok: true, ...data };
});

/**
 * 累計のお買い上げ金額(LTV)の内訳照会と修正。
 * action: "detail" = 内訳と履歴 / "adjust" = 正しい累計に直す
 *
 * ⚠**ポイントには触らない**。ポイントは会計と手動付与で積んだ結果で、
 *   LTV の補正で動かすと二重計上になる。
 * ⚠取込元(AppSheet)のカード枚数が空白・不正確なお客様の LTV を概算に直すための口。
 *   ランク（カードの格）に直結するので、誰が・いつ・いくら→いくら・なぜ を必ず残す。
 */
export const crmMemberLtv = onCall({ region: REGION }, async (request) => {
  const d = request.data || {};
  const storeId = str(d.storeId);
  const personId = str(d.personId);
  const action = str(d.action) || "detail";
  if (!storeId) throw new HttpsError("invalid-argument", "storeId required.");
  if (!personId) throw new HttpsError("invalid-argument", "personId required.");

  const role = await assertStoreStaff(request, storeId);
  const link = await resolveCoreLink(storeId);

  if (action === "detail") {
    const data = await callCore("crmMemberLtv", {
      coreTenantId: link.coreTenantId,
      coreSpaceId: link.coreSpaceId,
      personId,
      action: "detail",
    });
    return { ok: true, ...data };
  }

  const ltvTotal = Math.floor(Number(d.ltvTotal));
  const reason = str(d.reason);
  const adjustId = str(d.adjustId);
  if (!adjustId) throw new HttpsError("invalid-argument", "adjustId required.");
  if (!reason) throw new HttpsError("invalid-argument", "修正の理由を入力してください。");
  if (!Number.isFinite(ltvTotal) || ltvTotal < 0) {
    throw new HttpsError("invalid-argument", "金額を入力してください。");
  }

  const data = await callCore(
    "crmMemberLtv",
    {
      coreTenantId: link.coreTenantId,
      coreSpaceId: link.coreSpaceId,
      personId,
      action: "adjust",
      ltvTotal,
      reason,
      adjustId,
      confirm: d.confirm === true,
      actor: actorOf(request, storeId, role),
    },
    `ltv-${adjustId}`
  );
  // 大きな修正は Core が確認を求めてくる（200 で返るのでエラーにならない）。
  if (data?.requiresConfirm === true) return { ok: false, ...data };
  return { ok: true, ...data };
});
