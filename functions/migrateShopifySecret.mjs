/**
 * Shopify の clientSecret を settings/shopify から private/shopify へ移す(2026-10-29)。
 *
 * settings/shopify はクライアントから読めるため、シークレットはサーバーだけが読める
 * stores/{storeId}/private/shopify に置き、settings 側には clientSecretSet: true だけを残す。
 * private 側に値が既にある店舗は上書きしない(画面から新しい値を保存済みとみなす)。
 * 値そのものは表示しない。
 *
 * 使い方(既定は確認だけ。--apply で書き込む):
 *   GOOGLE_APPLICATION_CREDENTIALS=<鍵> node functions/migrateShopifySecret.mjs <dev|prod> [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECTS = { dev: 'mobile-order-dev-5f7fd', prod: 'mobile-order-prod' };
// 実データは 'main'。旧 (default) にも同じルールが掛かっているので両方を移す。
const DATABASES = ['main', '(default)'];

const [env, ...flags] = process.argv.slice(2);
if (!PROJECTS[env]) {
  console.error('使い方: node functions/migrateShopifySecret.mjs <dev|prod> [--apply]');
  process.exit(1);
}
const apply = flags.includes('--apply');
const app = initializeApp({ credential: applicationDefault(), projectId: PROJECTS[env] });

for (const databaseId of DATABASES) {
  const db = getFirestore(app, databaseId);
  let stores;
  try {
    stores = await db.collection('stores').get();
  } catch (error) {
    // prod には (default) DB が無い
    if (error.code === 5) { console.log(`[${databaseId}] DB なし(スキップ)`); continue; }
    throw error;
  }
  let moved = 0;
  for (const storeDoc of stores.docs) {
    const settingsRef = storeDoc.ref.collection('settings').doc('shopify');
    const privateRef = storeDoc.ref.collection('private').doc('shopify');
    const [settingsSnap, privateSnap] = await Promise.all([settingsRef.get(), privateRef.get()]);
    if (!settingsSnap.exists) continue;

    const settings = settingsSnap.data() || {};
    const legacySecret = String(settings.clientSecret || '').trim();
    const privateSecret = String((privateSnap.exists ? privateSnap.data() || {} : {}).clientSecret || '').trim();
    const hasLegacyField = 'clientSecret' in settings;

    const action = !hasLegacyField
      ? 'skip(移行済み)'
      : privateSecret ? 'settings 側を消すだけ(private に値あり)' : legacySecret ? '移す' : '空の旧フィールドを消す';
    console.log(`[${databaseId}] ${storeDoc.id} shop=${settings.shopDomain || '-'} → ${action}`);
    if (!hasLegacyField || !apply) continue;

    const batch = db.batch();
    if (!privateSecret && legacySecret) {
      batch.set(privateRef, {
        clientSecret: legacySecret,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'migrateShopifySecret'
      }, { merge: true });
    }
    batch.set(settingsRef, {
      clientSecret: FieldValue.delete(),
      clientSecretSet: Boolean(privateSecret || legacySecret)
    }, { merge: true });
    await batch.commit();
    moved += 1;
  }
  console.log(`[${databaseId}] ${apply ? `更新 ${moved} 店舗` : '確認のみ(--apply で書き込み)'}`);
}
