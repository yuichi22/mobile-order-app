// publicSite.js
// 拠点の公式サイト（~/haus-site 等）へ、店頭の情報を読み取り専用で公開するAPI。
//
// なぜ必要か: サイト側にメニューやブランドを持たせると二重管理になり必ず破綻する。
// かといってサイトから直接 Firestore を読ませるのは、権限・コスト・スキーマ結合の
// どれをとっても不健全。そこで「表示に必要な項目だけを返す公開API」を1枚挟む。
//
// ⚠ 返してはいけないもの（このファイルを触るときは必ず守ること）
//   原価(costPrice/costTaxIncluded 等) / 在庫数 / 仕入先 / キッチンID / 内部ID /
//   crossSellPrice(セット価格) / limitedQuantity 等の在庫由来の値。
//   「表示に要らないものは返さない」を既定にする。増やすときは1項目ずつ理由を書く。
//
// ⚠ Firestore は名前付きDB `main`。`(default)` は放置スタブなので読むと空に見える。

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";

const REGION = "asia-northeast1";
const DB_ID = "main";

if (!getApps().length) initializeApp();
const db = getFirestore(DB_ID);

// ───────────────────────────────────────────────────────────
// 公開対象の許可リスト
// ⚠ storeId を自由に受けると、他店舗のメニューまで引ける公開エンドポイントになる。
//   拠点を増やすときはここに足す（環境変数にしない＝レビューで気づけるように）。
// ───────────────────────────────────────────────────────────
const PUBLIC_STORES = {
  // HAUS（松江市乃白町）。⚠ ショップのPOSとカフェの注文が同じ1ストアに同居している。
  store_ar2y9: {
    name: "HAUS",
    // 売場ID → サイト側の安定キー。
    // ⚠ サイトに Firestore の docId を持たせないための対応表。
    //   売場を作り直しても、ここを直せばサイトは無変更で済む。
    areas: {
      fashion: "GDMblkCbKsm7OtxymYth", // HOWELL売場
      goods: "salesarea_005", // 雑貨売場
      outdoor: "salesarea_003", // OUTDOOR売場
      glasses: "salesarea_004", // 眼鏡売場
    },
  },
};

// CORSを許可するオリジン。サイト以外から叩かれても意味はないが、
// 埋め込み転載を減らすために絞っておく。
const ALLOWED_ORIGINS = [
  "https://haus.ne.jp",
  "https://www.haus.ne.jp",
  "https://haus-site--suomin-prod.asia-east1.hosted.app",
  "http://localhost:3700",
];

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
}

/** 表示用のキャッシュ指示。サイト側も revalidate するので二重に効かせる。 */
function setCache(res, seconds) {
  res.set(
    "Cache-Control",
    `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=3600`
  );
}

const str = (v) => String(v ?? "").trim();
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ───────────────────────────────────────────────────────────
// 画像のミラー
//
// ⚠⚠ 2026-08-11 実測: menuItems の画像118件は **1枚もFirebase Storageに無く**、
//    すべて外部サイトへの直リンクだった（haus.ne.jp 106 / suomi.blue 11 / i.pinimg.com 1）。
//    haus.ne.jp と suomi.blue はどちらも刷新中で、DNS切替の瞬間に全部404になる。
//    そのままサイトに出すと「他人のサーバーが落ちたら自分のサイトも壊れる」ので、
//    実体を自プロジェクトの Storage に引き取ってから配信する。
//
// ⚠ 自社ドメイン以外（Pinterest等）はミラーしない。第三者の画像を複製して
//    自社の商用サイトで再配信することになり、権利上の問題が出るため。
//    該当した項目は画像なしで返し、ログに出して人が気づけるようにする。
// ───────────────────────────────────────────────────────────

/** ミラーしてよい取得元（自社が管理しているサイト） */
const MIRRORABLE_HOSTS = ["haus.ne.jp", "www.haus.ne.jp", "suomi.blue", "www.suomi.blue"];

const MIRROR_PREFIX = "public-site/menu-images";

function imageKey(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 20);
}

function isMirroredUrl(url) {
  return url.startsWith("https://storage.googleapis.com/");
}

/**
 * 画像をミラーし、公開URLを返す。ミラー済みなら何もしない。
 * 失敗しても例外にしない（1枚の失敗でメニュー全体を落とさない）。
 */
async function mirrorImage(sourceUrl) {
  let host;
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    return null;
  }
  if (!MIRRORABLE_HOSTS.includes(host)) {
    console.log(`[publicSite] ミラー対象外のホストなので画像を出しません: ${host}`);
    return null;
  }
  const key = imageKey(sourceUrl);
  const bucket = getStorage().bucket();
  const objectPath = `${MIRROR_PREFIX}/${key}.img`;
  const file = bucket.file(objectPath);
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

  const [exists] = await file.exists();
  if (exists) return publicUrl;

  const res = await fetch(sourceUrl, { redirect: "follow" });
  if (!res.ok) {
    console.log(`[publicSite] 画像取得に失敗 ${res.status}: ${sourceUrl}`);
    return null;
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    console.log(`[publicSite] 画像ではないので取り込みません (${contentType}): ${sourceUrl}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 12 * 1024 * 1024) {
    console.log(`[publicSite] 画像が大きすぎます (${buf.length}B): ${sourceUrl}`);
    return null;
  }
  await file.save(buf, {
    contentType,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { sourceUrl },
    },
  });
  await file.makePublic();
  console.log(`[publicSite] 画像をミラーしました: ${sourceUrl} -> ${objectPath}`);
  return publicUrl;
}

/** ミラー済み対応表（sourceUrlのハッシュ → 公開URL）。無いものは画像なしで返す。 */
async function loadImageMap(storeId) {
  const doc = await db.doc(`stores/${storeId}/publicSiteCache/images`).get();
  return doc.exists ? doc.data().map || {} : {};
}

// ───────────────────────────────────────────────────────────
// GET /publicMenu?storeId=store_ar2y9
// ───────────────────────────────────────────────────────────
export const publicMenu = onRequest(
  { region: REGION, cors: false, invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const storeId = str(req.query.storeId);
    if (!PUBLIC_STORES[storeId]) {
      return res.status(404).json({ error: "store_not_public" });
    }

    try {
      const [catsDoc, periodsDoc, itemsSnap, imageMap] = await Promise.all([
        db.doc(`stores/${storeId}/settings/categories`).get(),
        db.doc(`stores/${storeId}/settings/periods`).get(),
        db.collection(`stores/${storeId}/menuItems`).get(),
        loadImageMap(storeId),
      ]);

      const allCats = (catsDoc.data()?.list || []);
      // ⚠ 公開してよいのは customerTabVisibility === "always" のカテゴリだけ。
      //   crossSellOnly は「セット限定ドリンク」等のアップセル専用で、単品価格として
      //   誤解される。hidden は社内イベント用。実測では 137品中84品だけが公開対象。
      const publicCats = allCats.filter((c) => c.customerTabVisibility === "always");
      const publicCatIds = new Set(publicCats.map((c) => c.id));

      const periods = (periodsDoc.data()?.list || []).map((p) => ({
        id: str(p.id),
        name: str(p.name),
        // ⚠ start/end は注文システムの受付時間であって、来店案内の営業時間ではない。
        //   サイトに営業時間として出されると誤案内になるので返さない。
      }));

      const items = [];
      for (const doc of itemsSnap.docs) {
        const v = doc.data();
        if (!publicCatIds.has(v.category)) continue;
        // ⚠ 品目ごとの「お客様に見せない」設定。カテゴリ単位の
        //   customerTabVisibility とは別にあるので、両方見ないと漏れる。
        //   実測(2026-08-12)で28品が hidden だった（「1000プレート」「弁当1000円」
        //   「ワークショップ800」等の店内運用用の品や、季節外れの品）。
        //   ⚠ これを返していたためサイトに出てしまっていた。
        if (str(v.customerVisibility) === "hidden") continue;
        const name = str(v.name);
        if (!name) continue;

        const source = str(v.image);
        const mirrored = source ? imageMap[imageKey(source)] || null : null;

        items.push({
          id: doc.id,
          name,
          description: str(v.description),
          price: num(v.price) ?? 0,
          takeoutPrice: num(v.takeoutPrice),
          categoryId: str(v.category),
          periodIds: Array.isArray(v.periods) ? v.periods.map(str) : [],
          soldOut: v.isSoldOut === true,
          allergens: Array.isArray(v.allergens) ? v.allergens.map(str) : [],
          // ⚠ 外部サイトの直リンクは返さない。ミラー済みのものだけ。
          image: mirrored,
        });
      }
      items.sort((a, b) => a.name.localeCompare(b.name, "ja"));

      setCache(res, 300);
      return res.json({
        storeId,
        updatedAt: new Date().toISOString(),
        periods,
        categories: publicCats.map((c) => ({
          id: str(c.id),
          name: str(c.name),
          sortOrder: num(c.sortOrder) ?? 0,
        })),
        items,
      });
    } catch (err) {
      console.error("[publicMenu] failed", err);
      return res.status(500).json({ error: "internal" });
    }
  }
);

// ───────────────────────────────────────────────────────────
// GET /publicBrands?storeId=store_ar2y9&area=glasses
//
// ⚠ 商品30,582件を毎リクエスト走査するのは論外なので、
//   下の rebuildPublicSiteCache が1時間ごとに集計して1ドキュメントに書き出し、
//   ここはそれを1回読むだけにしている。ブランド構成は日単位でしか変わらない。
// ───────────────────────────────────────────────────────────
export const publicBrands = onRequest(
  { region: REGION, cors: false, invoker: "public" },
  async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const storeId = str(req.query.storeId);
    const area = str(req.query.area);
    const conf = PUBLIC_STORES[storeId];
    if (!conf) return res.status(404).json({ error: "store_not_public" });
    if (!conf.areas[area]) return res.status(404).json({ error: "area_not_found" });

    try {
      const doc = await db.doc(`stores/${storeId}/publicSiteCache/brands`).get();
      const byArea = doc.exists ? doc.data().byArea || {} : {};
      const brands = byArea[area] || null;
      // ⚠ まだ集計されていないときは 404。空配列を返すと
      //   サイト側が「取扱いが無い」と表示してしまう。
      if (!brands) return res.status(404).json({ error: "not_built_yet" });

      setCache(res, 3600);
      return res.json({
        storeId,
        area,
        updatedAt: doc.data().updatedAtIso || null,
        brands,
      });
    } catch (err) {
      console.error("[publicBrands] failed", err);
      return res.status(500).json({ error: "internal" });
    }
  }
);

// ───────────────────────────────────────────────────────────
// 集計ジョブ（1時間ごと）
//   1. 在庫のあるブランドを売場ごとに集計 → publicSiteCache/brands
//   2. メニュー画像を自プロジェクトのStorageへミラー → publicSiteCache/images
// ───────────────────────────────────────────────────────────

/** 除外・名寄せの設定。POS側の settings/publicSite で編集する（サイトからは触らせない）。 */
async function loadPublicSiteSettings(storeId) {
  const doc = await db.doc(`stores/${storeId}/settings/publicSite`).get();
  const d = doc.exists ? doc.data() : {};
  return {
    // 卸・仕入先など「ブランドではないもの」。既定値は実測で見つかったもの。
    excludeBrands: Array.isArray(d.excludeBrands)
      ? d.excludeBrands.map(str)
      : ["LUXOTTICA", "マルイ", "その他 アーガス", "notebooks"],
    // 表記ゆれの名寄せ { "THEPSIRI CRAFT": "THEPSIRI CRAFTS" }
    brandAliases: d.brandAliases && typeof d.brandAliases === "object" ? d.brandAliases : {
      "THEPSIRI CRAFT": "THEPSIRI CRAFTS",
      "KUKKULA(雑貨)": "KUKKULA",
    },
    // 各カテゴリの上位何件まで返すか
    limit: num(d.limit) ?? 12,
    // 先頭に固定するブランド（POSに商品が無くても看板として出したいもの）
    // ⚠ HAUS の /fashion は MARGARET HOWELL がPOS未登録のためここで補う。
    //   POSに登録されたら自動で本来の順位に混ざるよう、重複は除いている。
    pinned: d.pinned && typeof d.pinned === "object" ? d.pinned : {
      fashion: ["MARGARET HOWELL", "MHL."],
    },
  };
}

async function buildBrands(storeId, conf, settings) {
  // 在庫を先に読む（真値は inventory 側。products.inventoryQuantity は古い）
  const inStock = new Set();
  let last = null;
  for (;;) {
    let q = db.collection(`stores/${storeId}/inventory`).orderBy("__name__").limit(3000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((d) => {
      if ((d.data().quantity || 0) > 0) inStock.add(d.id);
    });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 3000) break;
  }

  const areaIdToKey = new Map(Object.entries(conf.areas).map(([k, v]) => [v, k]));
  const excluded = new Set(settings.excludeBrands);
  // area → brand → 在庫のある品番(productGroup)の集合
  const acc = {};

  last = null;
  for (;;) {
    let q = db.collection(`stores/${storeId}/products`).orderBy("__name__").limit(3000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((d) => {
      const v = d.data();
      if (v.isArchived || v.isActive === false) return;
      if (!inStock.has(d.id)) return;
      const areaKey = areaIdToKey.get(str(v.salesAreaId));
      if (!areaKey) return;
      const raw = str(v.brandName);
      if (!raw) return;
      const name = settings.brandAliases[raw] || raw;
      if (excluded.has(name)) return;
      acc[areaKey] = acc[areaKey] || {};
      // ⚠ SKU（色・サイズ違い）ではなく品番で数える。
      //   SKUで数えるとサイズ展開の多いブランドが不当に上位に来る。
      (acc[areaKey][name] = acc[areaKey][name] || new Set()).add(str(v.productGroupId) || d.id);
    });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 3000) break;
  }

  const byArea = {};
  for (const areaKey of Object.keys(conf.areas)) {
    const rows = Object.entries(acc[areaKey] || {})
      .map(([name, set]) => ({ name, count: set.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));

    const pinned = (settings.pinned[areaKey] || []).filter((n) => !excluded.has(n));
    const pinnedSet = new Set(pinned);
    const rest = rows.filter((r) => !pinnedSet.has(r.name));
    // 固定分は count を持たせない（POSに実体が無いことがあるため 0 と出すと誤解される）
    byArea[areaKey] = [
      ...pinned.map((name) => ({ name, count: null })),
      ...rest,
    ].slice(0, settings.limit);
  }
  return byArea;
}

async function buildImageMirror(storeId) {
  const snap = await db.collection(`stores/${storeId}/menuItems`).get();
  const sources = new Set();
  snap.forEach((d) => {
    const u = str(d.data().image);
    if (u && !isMirroredUrl(u)) sources.add(u);
  });

  const existing = await loadImageMap(storeId);
  const map = { ...existing };
  let added = 0;
  let skipped = 0;
  for (const url of sources) {
    const key = imageKey(url);
    if (map[key]) continue;
    try {
      const mirrored = await mirrorImage(url);
      if (mirrored) {
        map[key] = mirrored;
        added++;
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
      console.log(`[publicSite] ミラー失敗: ${url} (${String(err).slice(0, 120)})`);
    }
  }
  console.log(
    `[publicSite] 画像ミラー: 対象${sources.size}件 / 新規${added}件 / 見送り${skipped}件`
  );
  return map;
}

async function rebuildForStore(storeId) {
  const conf = PUBLIC_STORES[storeId];
  const settings = await loadPublicSiteSettings(storeId);

  const byArea = await buildBrands(storeId, conf, settings);
  await db.doc(`stores/${storeId}/publicSiteCache/brands`).set({
    byArea,
    updatedAtIso: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const map = await buildImageMirror(storeId);
  await db.doc(`stores/${storeId}/publicSiteCache/images`).set({
    map,
    updatedAtIso: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const summary = Object.fromEntries(
    Object.entries(byArea).map(([k, v]) => [k, v.length])
  );
  console.log(
    `[publicSite] ${storeId} 再構築: ブランド ${JSON.stringify(summary)} / 画像 ${Object.keys(map).length}件`
  );
  return { byArea: summary, images: Object.keys(map).length };
}

export const rebuildPublicSiteCache = onSchedule(
  {
    schedule: "17 * * * *", // 毎時17分（他のジョブが0分に集中しているのでずらす）
    timeZone: "Asia/Tokyo",
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async () => {
    for (const storeId of Object.keys(PUBLIC_STORES)) {
      try {
        await rebuildForStore(storeId);
      } catch (err) {
        console.error(`[publicSite] ${storeId} の再構築に失敗`, err);
      }
    }
  }
);

/**
 * 手動実行用（初回構築・設定変更後にすぐ反映したいとき）。⚠共有シークレット必須。
 * ⚠ CORE_SALES_SECRET は Secret Manager ではなく `.env.mobile-order-prod` の環境変数。
 *   `secrets: [...]` を宣言すると存在しないシークレットを参照してデプロイが落ちる
 *   （salesSync.js / provisioning.js と同じ作法に合わせている）。
 */
export const runPublicSiteCacheNow = onRequest(
  { region: REGION, cors: false, timeoutSeconds: 540, memory: "1GiB" },
  async (req, res) => {
    // ⚠ この関数は invoker:"public" を付けていないので、まず Cloud Run の IAM が守る。
    //   Authorization ヘッダはそのIAM用のIDトークンに使われるため、
    //   アプリ側の共有シークレットは別ヘッダーで受ける（両方を通過して初めて実行）。
    const expected = process.env.CORE_SALES_SECRET || "";
    const got = String(req.headers["x-public-site-token"] || "");
    if (!expected || got !== expected) return res.status(401).json({ error: "unauthorized" });
    const out = {};
    for (const storeId of Object.keys(PUBLIC_STORES)) {
      out[storeId] = await rebuildForStore(storeId);
    }
    return res.json({ ok: true, result: out });
  }
);
