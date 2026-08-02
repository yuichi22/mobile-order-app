# AKUTO POS iOSアプリ 配布・審査手順

他社テナントへ iPad アプリを配布するための手順書。
**方式: App Store 一般公開（本命） + TestFlight（審査通過までの繋ぎ）**

対象ブランチ: `feat/ios-appstore-distribution`
最終更新: 2026-08-02

Apple 側の申請・登録ページのURLは巻末「10. リンク集」にまとめてある（全て到達確認済み）。

---

## 0. なぜアプリ配布が必要か

ブラウザ（https://store.akuto.app）だけでも POS は動く。アプリが要るのは次の2機能だけ:

- **レシートの無音自動印刷**（Bluetooth 直結・印刷ダイアログ無し）
- **キャッシュドロワーの自動開放**

どちらも iOS の MFi External Accessory 経由でしか実現できず、Web からは原理的に不可能。
逆に言えば、**印刷が要らないテナントはブラウザのままで良い**。

---

## 1. 前提作業（ユーザー対応・ここが最長リードタイム）

技術作業と並行で走らせること。ここが終わらないと配布は一切できない。

| # | 作業 | 所要 | 申請先 |
|---|---|---|---|
| 1 | **D-U-N-S番号の取得**（デコレ株式会社名義・無料） | 数営業日 | https://developer.apple.com/enroll/duns-lookup/ |
| 2 | **Apple Developer Program に Organization で登録**（年間メンバーシップ 99ドル） | 数日〜2週間 | https://developer.apple.com/jp/programs/enroll/ |
| 3 | Account Holder の Apple ID を開発環境と共有 | — | Bundle ID 登録・証明書発行に必要 |

**手順の詳細**:

1. **D-U-N-S 番号**
   - まず上記の Apple の lookup フォームで、デコレ株式会社の D-U-N-S が既に存在するか検索する。
     日本の法人は帝国データバンク経由で既に採番済みのことが多く、その場合は申請不要で即座に判明する
   - 見つからなければ同じフォームから新規申請（無料・数営業日）
   - 登録する法人名・住所は**登記と完全一致**させること。ここがずれると2の法人確認で必ず差し戻される

2. **Apple Developer Program（Organization）**
   - 登録の入口: https://developer.apple.com/jp/programs/enroll/
   - 必要なもの: D-U-N-S 番号 / 法人の登記情報 / 法人代表として署名できる権限 / 法人の電話番号
     （Apple から確認の電話が来ることがあるため、繋がる番号にすること）
   - 費用の最新情報: https://developer.apple.com/jp/support/enrollment/
   - ⚠ **Individual 登録なら D-U-N-S 不要だが、App Store の販売者名が個人名で公開される。**
     B2B SaaS としては Organization 一択

3. **登録完了後の権限設計**
   - チームの役割（Account Holder / Admin / App Manager 等）: https://developer.apple.com/jp/support/roles/
   - Account Holder は法人につき1名で、証明書・契約に関わる操作を握る

料金・審査期間は Apple の規定変更があり得るため、申請時に上記ページで最新値を確認すること。

### ローカルのビルド環境（2026-08-02 解決済み）

Xcode 26.6 + iOS 26.5 プラットフォームで **Release ビルド成功を確認済み**。

```
** BUILD SUCCEEDED **   (-configuration Release -destination 'generic/platform=iOS')
```

成果物の検証結果: Bundle ID `com.akuto.pos` / 表示名 `AKUTO POS` / `UIDeviceFamily = [2]`（iPad のみ）/
`UISupportedExternalAccessoryProtocols = [jp.star-m.starpro]` / PrivacyInfo.xcprivacy 同梱 /
同梱 capacitor.config.json が `https://store.akuto.app` を指す / StarIO10.framework リンク済み。

> かつて `error: iOS 26.5 Platform Not Installed.` で詰まった場合は、
> Xcode > Settings > Components から **iOS のみ**をインストールする（watchOS/tvOS/visionOS は不要）。

**署名なしのビルド確認コマンド**（Apple Developer Program 未登録でも実行できる）:

```bash
cd ~/mobile_order-app/ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

> ⚠ 成果物の Info.plist を確認するときに `plutil -extract` を `-o` 無しで使わないこと。
> **対象ファイルを抽出結果で上書きしてしまう。** 確認は `plutil -p` か、コピーに対して行う。

---

## 2. アプリの識別情報（確定値）

| 項目 | 値 |
|---|---|
| Bundle ID | `com.akuto.pos` |
| 表示名 (CFBundleDisplayName) | `AKUTO POS` |
| 読み込み先 (server.url) | `https://store.akuto.app` |
| 対象デバイス | **iPad のみ**（`TARGETED_DEVICE_FAMILY = "2"`） |
| 最低 iOS | 15.0 |
| バージョン | `MARKETING_VERSION = 1.0` / `CURRENT_PROJECT_VERSION = 1` |

`appId` は `capacitor.config.json`（ルート）と pbxproj の
`PRODUCT_BUNDLE_IDENTIFIER` の両方に入っている。`ios/App/App/capacitor.config.json` は
**gitignore 対象の生成物**で、`npx cap sync ios` がルートから再生成する。

### iPad 限定にした理由

POS の画面は iPad 前提の密度で作られており、iPhone で開くとレイアウトが破綻する可能性が高い。
レビュアーは iPhone でも試すため、**未検証の iPhone 対応を出すこと自体が審査リスク**になる。
iPhone も配布したくなったら `TARGETED_DEVICE_FAMILY` を `"1,2"` に戻し、
iPhone 用スクリーンショットを別途用意すること（必須になる）。

---

## 3. App Review 対策

審査ガイドライン本文（日本語）: https://developer.apple.com/jp/app-store/review/guidelines/
（英語の原文: https://developer.apple.com/app-store/review/guidelines/ ）

### 3.1 最大のリスク: ガイドライン 4.2（最低限の機能）

このアプリは `server.url` で全画面をリモートから読み込む薄いシェルであり、
**バンドル内には実質何も無い**。レビュアーから見れば「Webサイトの単なるラッパー」に見える。

対策（全部やる）:

1. **審査ノートにネイティブ機能を明記する**（下記テンプレート）
2. **プリンタ実機を映したデモ動画を添付する** — レビュアーは Star プリンタを持っていないため、
   これが最も効く。「会計 → 無音でレシートが出る → ドロワーが開く」を1本撮る
3. **デモアカウントを用意する**（データ投入済みの審査用テナント）
4. オフライン時に白画面にならないこと（実装済み・後述）

### 3.2 次のリスク: ガイドライン 3.1.1（App内課金）

AKUTO は SaaS サブスク（order ¥9,800 / pos ¥12,800 など）を持つが、
**アプリ内では一切課金しない**。事業者が別途 AKUTO と契約し、その従業員が業務で使う形。
これは **3.1.3(e) Enterprise Services の除外規定**に該当するので、審査ノートで先回りして主張する。

### 3.3 リスクではないと確認済みの項目

- **4.8 Sign in with Apple**: 認証は email/password のみ（`signInWithEmailAndPassword`）で
  ソーシャルログインを使っていないため**不要**
- **カメラ/位置情報**: 使用していない（Info.plist にも宣言なし）

### 3.4 審査ノート テンプレート（App Store Connect の「App Review に関する情報」へ）

入力場所の解説: https://developer.apple.com/help/app-store-connect/manage-app-information/provide-app-review-information/

```
本アプリは、サロン・小売店舗向けの業務用POSレジ端末アプリです（iPad専用）。

【ネイティブ機能】
本アプリの中核は、Star Micronics 製レシートプリンタ（MFi External Accessory /
プロトコル jp.star-m.starpro）との Bluetooth 直結制御です。Webブラウザでは実現できない
以下をネイティブで提供します:
 1. 印刷ダイアログを介さないレシートの無音自動印刷
 2. プリンタのDKポート経由でのキャッシュドロワー自動開放
 3. Bluetooth/LAN/USB でのプリンタ探索と、端末ごとのプリンタ選択

【動作確認について】
上記はレシートプリンタ実機が必要なため、動画を添付しています。
プリンタ未接続でも、設定 > 基本設定 > レシート設定 から探索UIとエラー表示を確認できます。

【課金について】
アプリ内課金はありません。本アプリは事業者（店舗運営会社）が別途当社とSaaS契約を
結んだうえで、その従業員が業務で使用するものです。
App Store Review Guideline 3.1.3(e) Enterprise Services に該当すると考えています。

【デモアカウント】
メールアドレス: (審査用アカウント)
パスワード: (審査用パスワード)
ログイン後、下部の「POSレジ」から会計操作を確認できます。

【オフライン時】
通信不可時はネイティブの再試行画面を表示します（機内モードで確認できます）。
```

### 3.5 デモアカウントの準備

1. 本番（`mobile-order-prod`）に審査用テナントを1つ作る
2. 商品・カテゴリ・料金を数件投入して、空っぽの画面にならないようにする
3. POSレジで会計を1件通せる状態にする
4. **審査中は消さない**。バージョン更新のたびに使われる

---

## 4. App Store Connect の申告内容

### 4.1 App Privacy（プライバシー ラベル）

申告項目の解説（日本語）: https://developer.apple.com/jp/app-store/app-privacy-details/

| データ種別 | 収集 | ユーザーに紐付け | トラッキング | 目的 |
|---|---|---|---|---|
| 連絡先情報 > メールアドレス | あり | あり | なし | Appの機能 |
| 診断 > その他の診断データ | あり | なし | なし | 分析 / Appの機能 |
| 使用状況 > その他の使用データ | あり | なし | なし | 分析 / Appの機能 |

- メールアドレスはスタッフのログインアカウント
- 診断・使用データの2行は **StarIO10 SDK 側の申告に合わせたもの**
  （StarIO10.framework の PrivacyInfo.xcprivacy が両方を宣言している）

### 4.2 PrivacyInfo.xcprivacy

`ios/App/App/PrivacyInfo.xcprivacy` に配置済み（Resources ビルドフェーズに登録済み）。

Apple の仕様:
- プライバシーマニフェスト全般: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Required Reason API と理由コード一覧: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api

`NSPrivacyAccessedAPITypes` は**空**。根拠は実際に確認済み:

- 自前の Swift（`StarPrinterPlugin.swift` / `MainViewController.swift`）は Required Reason API 不使用
- Capacitor 8.4.1 は UserDefaults ではなくファイルベースの `KeyValueStore` を使う
- Capacitor / CapacitorCordova / StarIO10 の各マニフェストも `NSPrivacyAccessedAPITypes` は空

> アップロード時に **ITMS-91053 (Missing API declaration)** が返ったら、
> 警告が名指しした API カテゴリと理由コードをこのファイルへ追記する。
> 典型は `NSPrivacyAccessedAPICategoryUserDefaults` / 理由 `CA92.1`。

### 4.3 スクリーンショット

必要サイズの最新仕様（Apple が随時変えるので提出前に必ず確認）:
https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/

iPad のみなので **iPad 13インチ相当（2048×2732 または 2064×2752）が必須**。
iPhone 用は不要（iPad 限定にしているため）。

撮る画面の推奨:
1. POSレジの会計画面
2. レシート設定（Starプリンタ検索・選択UI）← **ネイティブ機能の可視化。4.2対策として重要**
3. 売上・日計の分析画面
4. 商品マスタ

### 4.4 権限文言（Info.plist・設定済み）

| キー | 文言 |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | レシートプリンタ（Bluetooth）に接続して印刷するために使用します。 |
| `NSLocalNetworkUsageDescription` | 同一ネットワーク上のレシートプリンタを検出・印刷するために使用します。 |
| `UISupportedExternalAccessoryProtocols` | `jp.star-m.starpro` |

---

## 5. 初回起動〜ログインの導線

2026-08-01 に本番URLで確認済み:

1. アプリ起動 → `https://store.akuto.app` を読み込む
2. **ログイン画面が表示される**（メールアドレス / パスワード / 「新規登録」リンク）
3. テナントは自社の店舗アカウントでログイン
4. ログイン後、POSレジ・ORDERレジ・管理画面へ

### 通信できないとき

`MainViewController.swift` にネイティブの再試行画面を実装済み。

- 初回読み込みに失敗すると、白画面ではなく「画面を読み込めませんでした」+「再試行」ボタンを表示
- 接続先URLとエラー内容を小さく表示（店舗からの問い合わせ切り分け用）
- バックグラウンドから復帰したときに、再試行画面が出ていれば自動で読み直す
- 一度表示に成功した後の通信エラーでは**出さない**（レジ操作中に全画面を覆うと危険なため）

### 表記の統一（2026-08-02 対応済み・要 deploy）

ログイン画面の見出しは「Akuto Order System」から **「AKUTO」** に変更済み
（サブタイトル「店舗管理コンソール」はそのまま）。ランチャーとブラウザのタブタイトルも同様。

`Akuto Order System` は order 専用だった頃の名残で、POS/ORDER をプランで分ける現構成に合わず、
アプリ名「AKUTO POS」とも食い違っていた。ブランド名のみの「AKUTO」なら
どちらのプランでも成立し、アプリ名とも衝突しない。

あわせて**レシートの店舗名フォールバック4箇所を空文字に変更**した。従来は店舗名が未設定だと
領収書に「Akuto Order System」と印字され、**他社テナントのお客様に渡るレシートに
自社サービス名が出る**事故になっていた。Star 印刷の Swift 側は元から空判定済みのため、
この修正は再ビルド不要（Hosting deploy のみで反映）。

---

## 6. 対応プリンタの範囲

### 現状サポート

`StarPrinterPlugin.swift` は StarXpand SDK (StarIO10 2.12.1) の汎用APIを使っており、
**機種決め打ちではない**。探索は `[.bluetooth, .bluetoothLE, .lan, .usb]` の4方式。

したがって **StarXpand 対応機は基本的に動くはず**:
TSP100IV / TSP650II（実機確認済み）/ TSP700II / TSP800II / mC-Print3（80mm）、
mPOP / SM-L200（58mm）など。用紙幅は下記のとおり設定で切り替えられる。

### 用紙幅は端末ごとに選べる（2026-08-01 対応）

以前は `StarPrinterPlugin.swift` で `let width = 48`（80mm 決め打ち）だったため、
58mm 機ではレイアウトが崩れた。現在は **設定 > 基本設定 > レシート設定 で
80mm / 58mm を選択**でき、JS の payload（`paperColumns`）でネイティブへ渡している。

- 80mm = 48桁 / 576dot、58mm = 32桁 / 384dot（どちらも 1桁 = 12dot）
- バナー画像の幅の上限も用紙幅から導出するので、58mm 紙にはみ出さない
- 保存先はプリンタ選択と同じく **端末ごと（localStorage）**。
  用紙幅はプリンタ本体の物理特性であり、店舗共通に持つと複数台構成で破綻するため
- キーはプリンタ選択とは別（`akuto.pos.starPaperWidth.v1`）。
  プリンタを明示選択せず自動探索に任せている端末でも用紙幅を効かせたいため

**初回提出前にこの改修を入れた理由**: Swift の変更は App Store の再審査が要る。
58mm のテナントが現れてから足すと、対応までに審査サイクルが丸ごと1回増える。
今なら実質コストゼロで、以降の調整は JS だけ（deploy のみ・再ビルド不要）で済む。

### 実機確認の状況

| 機種 | 接続 | 印刷 | ドロワー |
|---|---|---|---|
| TSP650II | Bluetooth | ✅ 確認済み | ✅ 確認済み |
| 上記以外 | — | 未確認 | 未確認 |

TSP650II 以外は**未検証**。テナントに売る前に、少なくとも現行主力の TSP100IV は
1台確保して確認しておきたい。

### Epson 対応について

現時点では不要と判断。理由:

- StarXpand と Epson ePOS SDK は API が全く別で、プラグインをもう1本書くのに相当な工数がかかる
- 導入時にプリンタごと売る（Star を指定する）運用なら発生しない
- **既に Epson を持っているテナントが出てきた時点で判断する**。それまでは着手しない

なお PC/Mac 経由の「印刷ブリッジ」（ESC/POS）は既存機能として残っており、
iPad アプリを使わない店舗はそちらで Epson を含む LAN プリンタを使える。

---

## 7. 端末ごとのプリンタ選択（多テナント配布での必須改修）

### 何が問題だったか

`starIdentifier` は Firestore の `stores/{storeId}/settings/basic` →
`receiptModeSettings[pos|order].starIdentifier` に **店舗共通で1つだけ**保存されていた。

1店舗に iPad が2台あり、それぞれに TSP650II が繋がっている構成では、
後から選んだ端末の設定が全台を上書きし、iPad-B が iPad-A のプリンタへ印刷しようとして失敗する。

### どう直したか

`src/shared/utils/deviceStarPrinter.js` を新設し、**localStorage に端末ごと保存**する。

解決の優先順位（`receiptPrinting.js` の `resolveStarConnection`）:

1. **この端末で選択したプリンタ**（localStorage / キー `akuto.pos.starPrinter.v1`）
2. 店舗設定（Firestore）の既存値 — **後方互換のフォールバック。読むだけで書かない**
3. 空 → ネイティブ側で自動探索

保存単位は「端末に1台」で、pos/order のモード別にはしていない。
同じ iPad に POS用/ORDER用で別プリンタを繋ぐ運用は存在せず、
モードで分けると設定漏れを生むだけのため（従来コードもモード間でフォールバックしており実質1台前提だった）。

### 移行について

**既存の自社 iPad は何もしなくて良い。** localStorage が空なら従来どおり Firestore の値を読む。
新しく端末で選び直した時点で、その端末だけが localStorage の値を使うようになる。

localStorage への自動シードは**あえてやっていない**。シードすると
2台目の iPad が1台目のプリンタを恒久的に掴んでしまうため。

### UI の変更点

`ReceiptModeSettingsSection.jsx`:

- 見出しを「Star プリンタ（**この端末**）」に変更
- 選択は**即時保存**（右上の「保存」ボタンは不要）。Firestore には書き込まない
- 端末未選択で店舗設定の値が使われている場合は、その旨を警告色で表示
- 探索結果に「名前はどれも同じことがあります。識別子で選び、テスト印刷で紙が出た方を採用してください」
  という注意書きを追加
  （**Star機のBluetooth既定名は全機「Star Micronics」で同一**のため、名前では見分けられない）

---

## 8. リリース手順

### 8.1 事前準備（初回のみ）

1. Apple Developer Program 登録完了を確認
2. Xcode > Settings > Accounts に Apple ID を追加
3. **Bundle ID `com.akuto.pos`** を登録
   - https://developer.apple.com/account/resources/identifiers/list
   - Capability: **External Accessory** を有効にする（MFi プリンタ用）
4. App Store Connect でアプリレコードを作成（名前 / SKU / Bundle ID）
   - https://appstoreconnect.apple.com/
   - 操作マニュアル（日本語）: https://developer.apple.com/jp/help/app-store-connect/

### 8.2 ビルド前チェック

```bash
cd ~/mobile_order-app
npx cap sync ios
```

`ios/App/App/capacitor.config.json` に
`"appId": "com.akuto.pos"` と `"url": "https://store.akuto.app"` が入っていることを確認。

### 8.3 Archive とアップロード

1. Xcode で `ios/App/App.xcodeproj` を開く
2. Scheme を **App**、実行先を **Any iOS Device** に
3. Product > Archive
4. Organizer から Distribute App > App Store Connect > Upload

> **ネイティブ変更（Swift / Info.plist / pbxproj）は必ず Xcode 再ビルドが要る。**
> JS だけの変更は `npm run deploy:prod` で反映され、アプリの再ビルドは不要。

### 8.4 TestFlight（審査通過までの繋ぎ）

概要（日本語）: https://developer.apple.com/jp/testflight/

- アップロードしたビルドは TestFlight にすぐ出る
- **内部テスター**（自社）は Beta App Review 不要で即配布可能
- **外部テスター**（他社テナント）は Beta App Review が要る（本審査より軽い）。
  公開リンクを配れば最大10,000人まで招待でき、テナント側の負担は「リンクを開く」だけ
- ⚠ **ビルドは90日で失効する**。恒久運用には使わず、本審査通過までの繋ぎと割り切ること

### 8.5 JS の本番配信について

`npm run deploy:prod` は**作業ツリー全体（ブランチHEAD）を配信する**。
WIP を巻き込まないよう、必要なコミットだけの clean な状態で行うこと。
**prod デプロイは必ずユーザーの許可を取ってから実行する。**

---

## 9. トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| JS の変更がアプリに反映されない | WKWebView が古いHTMLをキャッシュしている。**アプリ削除 → 再Run** |
| `plugin is not implemented on iOS` | `MainViewController.capacitorDidLoad()` の `registerPluginInstance` が消えている。Capacitor は本体ターゲットの自作プラグインを自動登録しない |
| 会計後の印刷が毎回8秒待たされる | プリンタ未選択で自動探索が走っている。設定 > 基本設定 > レシート設定 でこの端末のプリンタを選ぶ |
| 複数iPadで別のプリンタから紙が出る | 7章の端末別保存が入る前の挙動。該当端末で選び直す |
| Archive できない / `iOS Platform Not Installed` | Xcode > Settings > Components から iOS プラットフォームを入れる |
| アップロード時に `ITMS-91053` | PrivacyInfo.xcprivacy の申告漏れ。警告が名指しした API と理由コードを追記する（4.2章） |
| Bluetooth でプリンタが見つからない | 先に iPad 本体の「設定 > Bluetooth」でペアリングが要る。アプリ内の検索だけでは繋がらない |

---

## 10. リンク集（Apple）

2026-08-02 に全て到達確認済み。Apple はURL構成を変えることがあるので、切れていたら
developer.apple.com のトップから辿り直すこと。

### 登録・申請

| 用途 | URL |
|---|---|
| D-U-N-S 番号の検索・申請 | https://developer.apple.com/enroll/duns-lookup/ |
| Apple Developer Program 登録（日本語） | https://developer.apple.com/jp/programs/enroll/ |
| 同（プログラム概要・費用） | https://developer.apple.com/jp/programs/ |
| 登録に関するサポート・最新の費用 | https://developer.apple.com/jp/support/enrollment/ |
| チームの役割と権限 | https://developer.apple.com/jp/support/roles/ |

### 開発・提出

| 用途 | URL |
|---|---|
| Certificates, Identifiers & Profiles（Bundle ID 登録） | https://developer.apple.com/account/resources/identifiers/list |
| App Store Connect（アプリレコード・提出・TestFlight） | https://appstoreconnect.apple.com/ |
| App Store Connect 操作マニュアル（日本語） | https://developer.apple.com/jp/help/app-store-connect/ |
| App Store Connect のサポート | https://developer.apple.com/support/app-store-connect/ |

### 審査・プライバシー

| 用途 | URL |
|---|---|
| App Store 審査ガイドライン（日本語） | https://developer.apple.com/jp/app-store/review/guidelines/ |
| 同（英語原文・条番号の確認用） | https://developer.apple.com/app-store/review/guidelines/ |
| 審査情報（デモアカウント・審査ノート）の入力方法 | https://developer.apple.com/help/app-store-connect/manage-app-information/provide-app-review-information/ |
| App Privacy（プライバシーラベル）の申告 | https://developer.apple.com/jp/app-store/app-privacy-details/ |
| プライバシーマニフェストの仕様 | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files |
| Required Reason API と理由コード一覧 | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api |
| スクリーンショットの必要サイズ | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/ |

### 参考（今回は使わない）

| 用途 | URL |
|---|---|
| TestFlight 概要（日本語） | https://developer.apple.com/jp/testflight/ |
| Apple Business Manager（B案・カスタムApp配布） | https://business.apple.com/ |
| MFi Program（プリンタ等の外部アクセサリ） | https://mfi.apple.com/ |

> **B案（ABM カスタムApp）は採用していない**が、大手チェーンが自社 ABM での一元管理を
> 求めてきた場合に備えてリンクだけ残す。同じ Developer Program・同じバイナリで後から追加できる。
