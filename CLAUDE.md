# mobile_order-app 開発ルール

## デプロイ（最重要）

- **prod は必ず main から出す。** 作業ブランチから `deploy:prod` を叩くとブランチHEAD全体（未承認コミット・WIP）が本番公開される。2026-09-05 に実際に事故が起きた。
- `firebase.json` の predeploy（`scripts/guard-prod-deploy.mjs`）が機械的に検査する: main以外のブランチ / src等の未コミット変更 / origin/main より古い main、のいずれかで**デプロイは自動中止**される。ガードを外したり迂回（`AKUTO_FORCE_PROD_DEPLOY=1`）したりするのは、ユーザーが明示的に指示した緊急時のみ。
- 配信は `npm run deploy:dev:verify` / `npm run deploy:prod:verify` を使う（build＋deploy＋配信一致チェックまで一括）。build と deploy を別々に叩かない。
- Firestore ルールは `firebase deploy --only firestore:rules` が**複数DB構成で no-op**。firebaserules REST API で `(default)` と `main` の両DBへリリースし、GETで実測確認すること。
- Functions は `--only functions:<名前>` で単一関数のみ置換する（他セッションのWIP流出防止）。

## 並行開発のテスト（プレビューチャネル）

- dev本体（mobile-order-dev-5f7fd.web.app）は1本しかないため、複数ブランチが同時に `deploy:dev` すると潰し合いになる。**ブランチごとの動作確認は Hosting プレビューチャネルを使う**:
  `npm run deploy:dev:preview -- <ブランチ名など>` → `https://mobile-order-dev-5f7fd--<名前>-xxxx.web.app` が発行される（7日で自動消滅・dev本体には影響しない）。
- バックエンド（dev Firestore・functions・rules）は全チャネルで共有。データを壊すテストや functions/rules の変更を伴うテストは他セッションと干渉するので、時間をずらすかユーザーに一言確認する。
- dev本体への `deploy:dev` は「mainに入った統合済みの状態」を置く場所として使う。

## prodへの反映フロー（標準手順）

ユーザーから「prodへ出して」と指示されたら、この順で行う（predeployガードもこの順を強制する）:

1. 作業ブランチを **main へマージ**する（コンフリクトは解消。マージ後にビルド・lintが通ることを確認）
2. `git pull` で origin/main と同期し、マージ結果を **push** する
3. main 上で `npm run deploy:dev:verify` → dev本体で統合状態を最終確認
4. main 上で `npm run deploy:prod:verify`

ブランチのままprodへ出すことはできない（ガードが中止する）。scanIndex・Firestoreルール・functionsの変更を含む場合は、それぞれの節の手順（索引再構築・REST配信・--only functions:名前）もセットで行う。

## 作業の進め方

- 機能・修正ごとに1コミット。他セッションのWIPファイル（例: functions/index.js が別作業で変更中のことがある）を `git add` で巻き込まない。
- Firestore の実DBは名前付き「main」。admin SDK は `getFirestore('main')` 必須（`(default)` は旧データ・放置）。
- Firestore の永続マルチタブキャッシュ（persistentLocalCache）は「設定が一斉に空表示」事故で撤去済み。**再導入禁止**。
- POSのスキャン結果キャッシュは意図的に持たない（価格改定の即時反映が優先）。速度改善は scanIndex（軽量バーコード索引）側で行う。
- `window.confirm` 禁止。`appConfirm` を使う。

## scanIndex（軽量バーコード索引）

- `stores/{storeId}/scanIndex/bucket_{0..47}`。バケット数はクライアント（`src/shared/api/firebase/scanIndex.js`）と再構築スクリプト（`functions/buildScanIndex.mjs`）で必ず一致させる。
- 商品保存経路を追加・変更したら `upsertScanIndexForProduct` の呼び出し漏れがないか確認。スクリプトやCSV一括投入で商品を書き換えたら `node functions/buildScanIndex.mjs <dev|prod> <storeId>` で再構築する。
