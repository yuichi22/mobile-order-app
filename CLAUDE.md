# mobile_order-app 開発ルール

## デプロイ（最重要）

- **prod は必ず main から出す。** 作業ブランチから `deploy:prod` を叩くとブランチHEAD全体（未承認コミット・WIP）が本番公開される。2026-09-05 に実際に事故が起きた。
- `firebase.json` の predeploy（`scripts/guard-prod-deploy.mjs`）が機械的に検査する: main以外のブランチ / src等の未コミット変更 / origin/main より古い main、のいずれかで**デプロイは自動中止**される。ガードを外したり迂回（`AKUTO_FORCE_PROD_DEPLOY=1`）したりするのは、ユーザーが明示的に指示した緊急時のみ。
- 配信は `npm run deploy:dev:verify` / `npm run deploy:prod:verify` を使う（build＋deploy＋配信一致チェックまで一括）。build と deploy を別々に叩かない。
- Firestore ルールは `firebase deploy --only firestore:rules` が**複数DB構成で no-op**。firebaserules REST API で `(default)` と `main` の両DBへリリースし、GETで実測確認すること。
- Functions は `--only functions:<名前>` で単一関数のみ置換する（他セッションのWIP流出防止）。

## 作業の進め方

- 機能・修正ごとに1コミット。他セッションのWIPファイル（例: functions/index.js が別作業で変更中のことがある）を `git add` で巻き込まない。
- Firestore の実DBは名前付き「main」。admin SDK は `getFirestore('main')` 必須（`(default)` は旧データ・放置）。
- Firestore の永続マルチタブキャッシュ（persistentLocalCache）は「設定が一斉に空表示」事故で撤去済み。**再導入禁止**。
- POSのスキャン結果キャッシュは意図的に持たない（価格改定の即時反映が優先）。速度改善は scanIndex（軽量バーコード索引）側で行う。
- `window.confirm` 禁止。`appConfirm` を使う。

## scanIndex（軽量バーコード索引）

- `stores/{storeId}/scanIndex/bucket_{0..47}`。バケット数はクライアント（`src/shared/api/firebase/scanIndex.js`）と再構築スクリプト（`functions/buildScanIndex.mjs`）で必ず一致させる。
- 商品保存経路を追加・変更したら `upsertScanIndexForProduct` の呼び出し漏れがないか確認。スクリプトやCSV一括投入で商品を書き換えたら `node functions/buildScanIndex.mjs <dev|prod> <storeId>` で再構築する。
