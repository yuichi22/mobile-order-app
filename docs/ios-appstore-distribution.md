# AKUTO POS iOSアプリ 配布・審査手順

他社テナントへ iPad アプリを配布するための手順書。
**方式: App Store 一般公開（本命） + TestFlight（審査通過までの繋ぎ）**

対象ブランチ: `feat/ios-appstore-distribution`
最終更新: 2026-08-01

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

| # | 作業 | 所要 | 備考 |
|---|---|---|---|
| 1 | **D-U-N-S番号の取得**（デコレ株式会社名義・無料） | 数営業日 | Apple の D-U-N-S lookup フォームから申請 |
| 2 | **Apple Developer Program に Organization で登録**（年額・$99相当） | 数日〜2週間 | 法人名・所在地・電話番号が登記と一致必須 |
| 3 | Account Holder の Apple ID を開発環境と共有 | — | Bundle ID 登録・証明書発行に必要 |

> Individual 登録なら D-U-N-S 不要だが、**App Store の販売者名が個人名で公開される**。
> B2B SaaS としては Organization 一択。

料金・審査期間は Apple の規定変更があり得るため、申請時に公式ページで最新値を確認すること。

### ⚠ ローカル環境のブロッカー（2026-08-01 時点で未解消）

Xcode 26.6 は入っているが、**iOS プラットフォーム（26.5）が未インストール**でビルドできない。

```
error: iOS 26.5 Platform Not Installed.
```

Xcode を起動し **Settings > Components** から iOS プラットフォームをダウンロードすること
（数GB・要ユーザー操作）。CLI なら以下でも入る場合がある:

```bash
xcodebuild -downloadPlatform iOS
```

これが解決するまで Release ビルド／Archive は実行できない。

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

`NSPrivacyAccessedAPITypes` は**空**。根拠は実際に確認済み:

- 自前の Swift（`StarPrinterPlugin.swift` / `MainViewController.swift`）は Required Reason API 不使用
- Capacitor 8.4.1 は UserDefaults ではなくファイルベースの `KeyValueStore` を使う
- Capacitor / CapacitorCordova / StarIO10 の各マニフェストも `NSPrivacyAccessedAPITypes` は空

> アップロード時に **ITMS-91053 (Missing API declaration)** が返ったら、
> 警告が名指しした API カテゴリと理由コードをこのファイルへ追記する。
> 典型は `NSPrivacyAccessedAPICategoryUserDefaults` / 理由 `CA92.1`。

### 4.3 スクリーンショット

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

### 既知の軽微な指摘事項

ログイン画面の見出しが「**Akuto Order System / 店舗管理コンソール**」のままで、
アプリ名「AKUTO POS」と一致していない。審査の落選理由にはならないが、
テナントに配る以上そろえておきたい（Web側の文言修正なので Hosting deploy のみで直る）。

---

## 6. 対応プリンタの範囲

### 現状サポート

`StarPrinterPlugin.swift` は StarXpand SDK (StarIO10 2.12.1) の汎用APIを使っており、
**機種決め打ちではない**。探索は `[.bluetooth, .bluetoothLE, .lan, .usb]` の4方式。

したがって **StarXpand 対応かつ 80mm 幅の機種は基本的に動くはず**:
TSP100IV / TSP650II（実機確認済み）/ TSP700II / TSP800II / mC-Print3 など。

### ⚠ 80mm 決め打ちの制約

`StarPrinterPlugin.swift:179` で桁数を固定している:

```swift
let width = 48 // 80mm / Font A 目安
```

このため **58mm 機（mPOP、SM-L200 等）はレイアウトが崩れる**。
58mm を売る必要が出たら、`width` を設定値（32桁）で切り替えられるようにする改修が要る。

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
3. developer.apple.com で **Bundle ID `com.akuto.pos`** を登録
   - Capability: **External Accessory** を有効にする（MFi プリンタ用）
4. App Store Connect でアプリレコードを作成（名前 / SKU / Bundle ID）

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
