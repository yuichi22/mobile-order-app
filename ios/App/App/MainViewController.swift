import UIKit
import WebKit
import Capacitor

// アプリ本体ターゲットに置いた独自プラグイン(StarPrinterPlugin)を Capacitor ブリッジへ登録し、
// あわせて「画面の読み込みに失敗したとき」のネイティブ再試行画面を提供する。
//
// このアプリは画面を Firebase Hosting(https://store.akuto.app)から読み込む薄いシェルのため、
// 店舗の回線が落ちている・iPadがWi-Fiに繋がっていない状態で起動すると WKWebView が
// 何も描画せず真っ白のままになる。営業中のレジが白画面で固まるのは実害が大きく、
// App Review でもオフライン時の挙動は指摘されやすいので、ネイティブ側で必ず何か出す。
class MainViewController: CAPBridgeViewController {

    private var navigationDelegateProxy: WebViewNavigationDelegateProxy?
    private var offlineView: OfflineRetryView?
    // 一度でも表示に成功したか。成功後の一時的な通信エラーで全画面を覆わないための判定に使う。
    private var hasLoadedSuccessfully = false

    // Capacitor 6+ では、CAPBridgedPlugin 準拠だけでは「アプリ本体ターゲットのプラグイン」は
    // 自動登録されないため、capacitorDidLoad() で registerPluginInstance により明示登録する。
    // （これが無いと JS から呼ぶと "plugin is not implemented on iOS" になる）
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StarPrinterPlugin())
        installNavigationDelegateProxy()
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        installOfflineView()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - ナビゲーション監視

    // Capacitor 本体の WebViewDelegationHandler を置き換えると、ブリッジの動作
    // (decidePolicyFor / script message など)が壊れる。そこで元のデリゲートを保持したまま
    // 前段に差し込むプロキシを使い、成功/失敗だけを横取りして残りは元へ転送する。
    private func installNavigationDelegateProxy() {
        guard let webView = webView, let original = webView.navigationDelegate else { return }
        let proxy = WebViewNavigationDelegateProxy(
            target: original,
            onLoadFinished: { [weak self] in
                self?.hasLoadedSuccessfully = true
                self?.hideOfflineView()
            },
            onLoadFailed: { [weak self] error in
                self?.handleLoadFailure(error)
            }
        )
        navigationDelegateProxy = proxy
        webView.navigationDelegate = proxy
    }

    private func handleLoadFailure(_ error: Error) {
        // 画面遷移のキャンセルやポリシーによる中断は「失敗」ではないので無視する。
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }

        // 一度表示に成功した後の失敗（画面内の遷移など）は、レジ操作中に全画面を覆うと
        // かえって危険なので出さない。真っ白で固まるのは初回読み込みの失敗だけ。
        guard !hasLoadedSuccessfully else { return }

        showOfflineView(message: nsError.localizedDescription)
    }

    @objc private func handleWillEnterForeground() {
        // 「Wi-Fiを直してからiPadを触る」導線が自然に繋がるよう、
        // 再試行画面が出ている状態で復帰したら自動で読み直す。
        guard let offlineView = offlineView, !offlineView.isHidden else { return }
        reloadWebView()
    }

    // MARK: - 再試行画面

    private func installOfflineView() {
        let retryView = OfflineRetryView(frame: view.bounds)
        retryView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        retryView.isHidden = true
        retryView.onRetry = { [weak self] in self?.reloadWebView() }
        view.addSubview(retryView)
        offlineView = retryView
    }

    private func showOfflineView(message: String) {
        guard let offlineView = offlineView else { return }
        view.bringSubviewToFront(offlineView)
        offlineView.update(detail: message, serverURL: serverURL()?.absoluteString ?? "")
        offlineView.setRetrying(false)
        offlineView.isHidden = false
    }

    private func hideOfflineView() {
        offlineView?.setRetrying(false)
        offlineView?.isHidden = true
    }

    private func serverURL() -> URL? {
        return bridge?.config.appStartServerURL
    }

    private func reloadWebView() {
        offlineView?.setRetrying(true)
        guard let webView = webView, let url = serverURL() else { return }
        // キャッシュ済みの古いHTMLを掴んだまま再試行しないよう、明示的に再取得する。
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
    }
}

// MARK: - デリゲート転送プロキシ

// WKNavigationDelegate は任意メソッドが多く、全てを手で転送すると取りこぼしが起きる。
// 自分で実装した3つ以外は ObjC ランタイムの転送機構で元のデリゲートへそのまま流す。
final class WebViewNavigationDelegateProxy: NSObject, WKNavigationDelegate {
    private let target: WKNavigationDelegate
    private let onLoadFinished: () -> Void
    private let onLoadFailed: (Error) -> Void

    init(target: WKNavigationDelegate,
         onLoadFinished: @escaping () -> Void,
         onLoadFailed: @escaping (Error) -> Void) {
        self.target = target
        self.onLoadFinished = onLoadFinished
        self.onLoadFailed = onLoadFailed
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || target.responds(to: aSelector)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return target.responds(to: aSelector) ? target : super.forwardingTarget(for: aSelector)
    }

    // 引数の暗黙アンラップは WKNavigationDelegate の宣言どおり。
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        target.webView?(webView, didFinish: navigation)
        onLoadFinished()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        target.webView?(webView, didFail: navigation, withError: error)
        onLoadFailed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        target.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        onLoadFailed(error)
    }
}

// MARK: - 再試行画面のビュー

final class OfflineRetryView: UIView {
    var onRetry: (() -> Void)?

    private let titleLabel = UILabel()
    private let bodyLabel = UILabel()
    private let detailLabel = UILabel()
    private let retryButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    override init(frame: CGRect) {
        super.init(frame: frame)
        setUp()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    private func setUp() {
        backgroundColor = .systemBackground

        titleLabel.text = "画面を読み込めませんでした"
        titleLabel.font = .systemFont(ofSize: 24, weight: .heavy)
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        bodyLabel.text = "インターネット接続を確認してから、下の「再試行」を押してください。\niPadの「設定 > Wi-Fi」で接続状況を確認できます。"
        bodyLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        bodyLabel.textColor = .secondaryLabel
        bodyLabel.textAlignment = .center
        bodyLabel.numberOfLines = 0

        detailLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        detailLabel.textColor = .tertiaryLabel
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0

        retryButton.setTitle("再試行", for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .heavy)
        retryButton.setTitleColor(.white, for: .normal)
        retryButton.backgroundColor = .label
        retryButton.layer.cornerRadius = 14
        retryButton.addTarget(self, action: #selector(handleRetry), for: .touchUpInside)

        spinner.hidesWhenStopped = true
        spinner.color = .white

        let stack = UIStackView(arrangedSubviews: [titleLabel, bodyLabel, retryButton, detailLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(24, after: bodyLabel)
        stack.setCustomSpacing(28, after: retryButton)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        retryButton.translatesAutoresizingMaskIntoConstraints = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        retryButton.addSubview(spinner)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
            retryButton.heightAnchor.constraint(equalToConstant: 52),
            retryButton.widthAnchor.constraint(equalToConstant: 220),
            spinner.centerXAnchor.constraint(equalTo: retryButton.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: retryButton.centerYAnchor)
        ])
    }

    // エラー内容と接続先URLは、店舗から問い合わせが来たときの切り分けに使うため小さく出す。
    func update(detail: String, serverURL: String) {
        detailLabel.text = serverURL.isEmpty ? detail : "\(serverURL)\n\(detail)"
    }

    func setRetrying(_ retrying: Bool) {
        if retrying {
            spinner.startAnimating()
            retryButton.setTitle("", for: .normal)
            retryButton.isEnabled = false
        } else {
            spinner.stopAnimating()
            retryButton.setTitle("再試行", for: .normal)
            retryButton.isEnabled = true
        }
    }

    @objc private func handleRetry() {
        onRetry?()
    }
}
