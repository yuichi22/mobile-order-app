/**
 * OUTDOOR売場の allowedCategoryGroupNames から「眼鏡」を除去する。
 *
 * 背景:
 *  - 売場ID未設定の商品は categoryGroupName から売場をフォールバック解決する。その際
 *    sortOrder の小さい売場が優先されるため、OUTDOOR売場(sortOrder=30, allowed に「眼鏡」を含む)が
 *    眼鏡売場(40)より先に一致し、売場ID未設定の眼鏡商品が OUTDOOR売場に誤集計される恐れがある。
 *  - OUTDOOR売場は眼鏡を扱わないため、allowed から「眼鏡」を外して予防する。
 *
 * 変更するのは productSalesAreas/OUTDOOR売場 の allowedCategoryGroupNames のみ。
 *
 * 使い方:
 *   node scripts/repairOutdoorAllowedGroups.cjs --env prod            # ドライラン
 *   node scripts/repairOutdoorAllowedGroups.cjs --env prod --apply    # 適用(要承認)
 */

const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');

const ENVS = {
  dev: { projectId: 'mobile-order-dev-5f7fd', storeId: 'store_0dtao' },
  prod: { projectId: 'mobile-order-prod', storeId: 'store_ar2y9' }
};
const argValue = (flag, fb) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : fb; };
const envName = argValue('--env', 'dev');
const APPLY = process.argv.includes('--apply');
const target = ENVS[envName];
if (!target) { console.error('使い方: --env dev|prod [--apply]'); process.exit(1); }

if (!admin.apps.length) admin.initializeApp({ projectId: target.projectId });
const db = getFirestore('main');

const REMOVE = '眼鏡';
const AREA_NAME = 'OUTDOOR売場';

(async () => {
  const col = db.collection('stores').doc(target.storeId).collection('productSalesAreas');
  const snap = await col.get();
  let done = 0;
  for (const doc of snap.docs) {
    const a = doc.data();
    if (String(a.name || '').trim() !== AREA_NAME) continue;
    const cur = Array.isArray(a.allowedCategoryGroupNames) ? a.allowedCategoryGroupNames : [];
    const next = cur.filter((g) => String(g).trim() !== REMOVE);
    console.log(`env=${envName} ${AREA_NAME}(id=${doc.id}) sortOrder=${a.sortOrder}`);
    console.log('  before:', JSON.stringify(cur));
    console.log('  after :', JSON.stringify(next));
    if (cur.length === next.length) { console.log('  変更なし(「眼鏡」を含まない)'); continue; }
    if (APPLY) {
      await doc.ref.update({ allowedCategoryGroupNames: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log('  => 適用しました');
      done += 1;
    }
  }
  console.log(`\n${APPLY ? '適用' : 'ドライラン'} 完了 (${done}件更新)`);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
