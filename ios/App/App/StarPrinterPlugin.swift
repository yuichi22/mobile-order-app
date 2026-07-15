import Foundation
import UIKit
import Capacitor
import StarIO10

// Star TSP650II 等向けの Bluetooth/LAN レシート印刷プラグイン。
// JS から StarPrinter.discoverPrinters() / printReceipt() を呼ぶ。
// 画面は Firebase Hosting から読み込まれる（薄いネイティブシェル）ため、
// このネイティブ機能は Capacitor ブリッジ経由で remote ページから利用される。
@objc(StarPrinterPlugin)
public class StarPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StarPrinterPlugin"
    public let jsName = "StarPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discoverPrinters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printReceipt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openDrawer", returnType: CAPPluginReturnPromise)
    ]

    // 探索中の参照保持（破棄されないように）
    private var discoveryManager: StarDeviceDiscoveryManager?
    private var discoveryDelegate: StarDiscoveryDelegate?

    // MARK: - プリンタ探索

    @objc func discoverPrinters(_ call: CAPPluginCall) {
        let timeout = call.getInt("timeout") ?? 8000
        DispatchQueue.main.async {
            do {
                let manager = try StarDeviceDiscoveryManagerFactory.create(
                    interfaceTypes: [.bluetooth, .bluetoothLE, .lan, .usb]
                )
                manager.discoveryTime = timeout
                let delegate = StarDiscoveryDelegate { printers in
                    let arr = printers.map { printer -> [String: Any] in
                        return [
                            "identifier": printer.connectionSettings.identifier,
                            "interface": StarPrinterPlugin.interfaceName(printer.connectionSettings.interfaceType)
                        ]
                    }
                    call.resolve(["printers": arr])
                    self.discoveryManager = nil
                    self.discoveryDelegate = nil
                }
                manager.delegate = delegate
                self.discoveryManager = manager
                self.discoveryDelegate = delegate
                try manager.startDiscovery()
            } catch {
                call.reject("プリンタ探索に失敗しました: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - 印刷

    @objc func printReceipt(_ call: CAPPluginCall) {
        guard let receipt = call.getObject("receipt") else {
            call.reject("receipt が必要です")
            return
        }
        let identifier = call.getString("identifier")
        let interfaceStr = call.getString("interface") ?? "bluetooth"

        Task {
            do {
                guard let settings = try await self.resolveConnectionSettings(
                    identifier: identifier, interfaceStr: interfaceStr
                ) else {
                    call.reject("プリンタが見つかりませんでした")
                    return
                }

                let printer = StarPrinter(settings)
                // バナー画像URLがあれば先に取得（非同期）。失敗しても印刷は続行する。
                let bannerImage = await self.loadBannerImage(receipt["bannerImage"] as? String)
                let commands = self.buildCommands(receipt, bannerImage: bannerImage)
                do {
                    try await printer.open()
                    try await printer.print(command: commands)
                    await printer.close()
                    call.resolve(["ok": true])
                } catch {
                    await printer.close()
                    throw error
                }
            } catch {
                call.reject("印刷に失敗しました: \(error.localizedDescription)")
            }
        }
    }

    // 識別子未指定時：探索して最初に見つかったプリンタの接続設定を返す
    private func discoverFirstPrinter(timeout: Int) async throws -> StarConnectionSettings? {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.main.async {
                do {
                    let manager = try StarDeviceDiscoveryManagerFactory.create(
                        interfaceTypes: [.bluetooth, .bluetoothLE, .lan, .usb]
                    )
                    manager.discoveryTime = timeout
                    let delegate = StarDiscoveryDelegate { printers in
                        continuation.resume(returning: printers.first?.connectionSettings)
                        self.discoveryManager = nil
                        self.discoveryDelegate = nil
                    }
                    manager.delegate = delegate
                    self.discoveryManager = manager
                    self.discoveryDelegate = delegate
                    try manager.startDiscovery()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // 識別子があればそれで接続設定を作り、無ければ探索して最初の1台を使う。
    private func resolveConnectionSettings(identifier: String?, interfaceStr: String) async throws -> StarConnectionSettings? {
        if let id = identifier, !id.isEmpty {
            return StarConnectionSettings(
                interfaceType: StarPrinterPlugin.interfaceType(interfaceStr),
                identifier: id
            )
        }
        return try await self.discoverFirstPrinter(timeout: 8000)
    }

    // MARK: - キャッシュドロワー（釣銭機/ドロワー）開放

    // レシートプリンタのドロワーキックポート(No.1)へ開放信号のみを送る。
    // 印刷とは独立したコマンドのため、会計確定時にレシート印刷とは別タイミングで開ける。
    @objc func openDrawer(_ call: CAPPluginCall) {
        let identifier = call.getString("identifier")
        let interfaceStr = call.getString("interface") ?? "bluetooth"

        Task {
            do {
                guard let settings = try await self.resolveConnectionSettings(
                    identifier: identifier, interfaceStr: interfaceStr
                ) else {
                    call.reject("プリンタが見つかりませんでした")
                    return
                }

                let printer = StarPrinter(settings)
                let commands = self.buildDrawerCommands()
                do {
                    try await printer.open()
                    try await printer.print(command: commands)
                    await printer.close()
                    call.resolve(["ok": true])
                } catch {
                    await printer.close()
                    throw error
                }
            } catch {
                call.reject("ドロワー開放に失敗しました: \(error.localizedDescription)")
            }
        }
    }

    // ドロワー開放のみの StarXpand コマンドを生成する（チャンネル No.1）。
    private func buildDrawerCommands() -> String {
        let builder = StarXpandCommand.StarXpandCommandBuilder()
        _ = builder.addDocument(
            StarXpandCommand.DocumentBuilder().addDrawer(
                StarXpandCommand.DrawerBuilder().actionOpen(
                    StarXpandCommand.Drawer.OpenParameter().setChannel(.no1)
                )
            )
        )
        return builder.getCommands()
    }

    // MARK: - レシート組み立て（StarXpand コマンド）

    private func buildCommands(_ r: [String: Any], bannerImage: UIImage?) -> String {
        let width = 48 // 80mm / Font A 目安
        let printerBuilder = StarXpandCommand.PrinterBuilder()

        func text(_ s: String) { _ = printerBuilder.actionPrintText(s + "\n") }
        func center(_ s: String, bold: Bool = false) {
            _ = printerBuilder.styleAlignment(.center)
            if bold { _ = printerBuilder.styleBold(true) }
            text(s)
            if bold { _ = printerBuilder.styleBold(false) }
            _ = printerBuilder.styleAlignment(.left)
        }
        func divider() { text(String(repeating: "-", count: width)) }
        func lr(_ left: String, _ right: String) {
            let used = displayWidth(left) + displayWidth(right)
            if used + 1 <= width {
                let pad = max(1, width - used)
                text(left + String(repeating: " ", count: pad) + right)
            } else {
                text(left)
                _ = printerBuilder.styleAlignment(.right)
                text(right)
                _ = printerBuilder.styleAlignment(.left)
            }
        }
        func yen(_ v: Any?) -> String {
            let n = (v as? NSNumber)?.intValue ?? Int("\(v ?? "")") ?? 0
            return "¥" + numberWithComma(n)
        }
        func str(_ key: String) -> String { (r[key] as? String) ?? "" }

        // 0. 上部の余白
        _ = printerBuilder.actionFeedLine(1)

        // 1. タイトル「領収書」（最上部・大きく・字間あり）
        let rawTitle = str("title").isEmpty ? "領収書" : str("title")
        let title = rawTitle == "領収書" ? "領　収　書" : rawTitle
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 2, height: 2))
        center(title, bold: true)
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 1, height: 1))
        _ = printerBuilder.actionFeedLine(1)

        // 2. バナー画像（任意・中央）。取得できた時のみ印字。
        if let banner = bannerImage {
            // バナー幅(dot)。payloadで指定可・既定192(80mm=576dotの約1/3)。30〜576にクランプ。
            let rawBannerWidth = (r["bannerWidth"] as? NSNumber)?.intValue ?? 192
            let bannerWidth = max(30, min(rawBannerWidth, 576))
            // ロゴ/線画はディザリングするとにじむため、既定はディザOFF＋しきい値2値化でくっきり印字。
            // diffusion=trueは写真向けの誤差拡散。threshold(0-255)が大きいほど黒が増える。いずれもpayloadで調整可。
            let bannerDiffusion = (r["bannerDiffusion"] as? NSNumber)?.boolValue ?? false
            let rawThreshold = (r["bannerThreshold"] as? NSNumber)?.intValue ?? 160
            let bannerThreshold = max(0, min(rawThreshold, 255))
            let imageParam = StarXpandCommand.Printer.ImageParameter(image: banner, width: bannerWidth)
                .setEffectDiffusion(bannerDiffusion)
                .setThreshold(bannerThreshold)
            _ = printerBuilder.styleAlignment(.center)
            _ = printerBuilder.actionPrintImage(imageParam)
            _ = printerBuilder.styleAlignment(.left)
            // バナーとヘッダー文言の間に余白
            _ = printerBuilder.actionFeedLine(1)
        }

        // 3. ヘッダー文言（レシート設定・あれば）
        if !str("headerTitle").isEmpty { center(str("headerTitle")) }

        _ = printerBuilder.actionFeedLine(1)

        // 4. 店名・住所・TEL・登録番号
        if !str("storeName").isEmpty { center(str("storeName"), bold: true) }
        if !str("address").isEmpty { center(str("address")) }
        if !str("tel").isEmpty { center("TEL: " + str("tel")) }
        if !str("invoiceNumber").isEmpty { center("登録番号: " + str("invoiceNumber")) }
        divider()

        // 5. 日付 / No / テーブル / 使用レジ名
        if !str("issuedAtText").isEmpty { text(str("issuedAtText")) }
        if !str("receiptNo").isEmpty { text("No: " + str("receiptNo")) }
        if !str("tableName").isEmpty { text(str("tableName")) }
        // 複数レジ運用でどの端末の会計かを区別するため、使用レジ名を印字する。
        if !str("registerName").isEmpty { text("レジ: " + str("registerName")) }

        // 6. 宛名（手書き欄・右寄せの下線＋様）。上下に余白。
        _ = printerBuilder.actionFeedLine(1)
        _ = printerBuilder.styleAlignment(.right)
        text(String(repeating: "_", count: 24) + "  様")
        _ = printerBuilder.styleAlignment(.left)
        _ = printerBuilder.actionFeedLine(1)
        divider()

        // 明細（会計伝票と同じく、商品名＋行計／単価×数量／商品個別割引を出す）
        if let items = r["items"] as? [[String: Any]] {
            for item in items {
                let name = (item["name"] as? String) ?? "商品"
                let qty = (item["quantity"] as? NSNumber)?.intValue ?? 1
                let unit = (item["unitPrice"] as? NSNumber)?.intValue ?? 0
                let total = (item["totalPrice"] as? NSNumber)?.intValue ?? 0
                // 商品名（右に行計）
                lr(name, "¥" + numberWithComma(total))
                // 単価 × 数量
                text("  ¥\(numberWithComma(unit)) x \(qty)")
                // 商品ごとの割引（あれば商品行の直下に「割引名 -¥金額」）
                if let ld = item["lineDiscount"] as? [String: Any] {
                    let ldAmount = (ld["amount"] as? NSNumber)?.intValue ?? 0
                    if ldAmount > 0 {
                        let ldLabel = (ld["label"] as? String) ?? "値引き"
                        lr("  " + ldLabel, "-¥" + numberWithComma(ldAmount))
                    }
                }
            }
        }
        divider()

        // 金額
        lr("小計", yen(r["subtotal"]))
        // 割引内訳（%割引・スタンプカード等）を名前付きで個別行に印字する。
        // discounts 配列があればそれを優先し、無ければ旧来の単一 discount 行へフォールバックする。
        if let discountLines = r["discounts"] as? [[String: Any]], !discountLines.isEmpty {
            for line in discountLines {
                let label = (line["label"] as? String) ?? "値引き"
                let amount = (line["amount"] as? NSNumber)?.intValue ?? 0
                if amount > 0 { lr(label, "-¥" + numberWithComma(amount)) }
            }
        } else {
            let discount = (r["discount"] as? NSNumber)?.intValue ?? 0
            if discount > 0 { lr("値引き", "-¥" + numberWithComma(discount)) }
        }
        // 消費税は会計伝票と同じく軽減(8%)/標準(10%)に分けて出す。
        // どちらも0のとき(税区分不明)は従来通り合計の内消費税1行にフォールバックする。
        let taxReduced = (r["taxAmountReduced"] as? NSNumber)?.intValue ?? 0
        let taxStandard = (r["taxAmountStandard"] as? NSNumber)?.intValue ?? 0
        // 税率別の税込対象額(税率ごとの対価の合計額)。あれば「{率}%対象」+「(内消費税{率}%)」の2行で出す。
        let taxableReduced = (r["taxableIncludedReduced"] as? NSNumber)?.intValue ?? 0
        let taxableStandard = (r["taxableIncludedStandard"] as? NSNumber)?.intValue ?? 0
        let rateReduced = (r["taxRateReduced"] as? NSNumber)?.intValue ?? 8
        let rateStandard = (r["taxRateStandard"] as? NSNumber)?.intValue ?? 10
        if taxReduced > 0 || taxStandard > 0 {
            if taxableReduced > 0 {
                lr("\(rateReduced)%対象", "¥" + numberWithComma(taxableReduced))
                lr("  (内消費税 \(rateReduced)%)", "¥" + numberWithComma(taxReduced))
            } else if taxReduced > 0 {
                lr("(内消費税 \(rateReduced)%)", "¥" + numberWithComma(taxReduced))
            }
            if taxableStandard > 0 {
                lr("\(rateStandard)%対象", "¥" + numberWithComma(taxableStandard))
                lr("  (内消費税 \(rateStandard)%)", "¥" + numberWithComma(taxStandard))
            } else if taxStandard > 0 {
                lr("(内消費税 \(rateStandard)%)", "¥" + numberWithComma(taxStandard))
            }
        } else {
            lr("(内消費税)", yen(r["tax"]))
        }
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 2, height: 1))
        lr("合計", yen(r["total"]))
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 1, height: 1))
        if !str("paymentMethod").isEmpty { lr("お支払", str("paymentMethod")) }
        divider()

        // フッタ（前に余白）
        _ = printerBuilder.actionFeedLine(1)
        let footer = str("footerNote").isEmpty ? "ご利用ありがとうございました。" : str("footerNote")
        center(footer)
        // カット前のティアオフ余白
        _ = printerBuilder.actionFeedLine(2)
        _ = printerBuilder.actionCut(StarXpandCommand.Printer.CutType.partial)

        let builder = StarXpandCommand.StarXpandCommandBuilder()
        _ = builder.addDocument(
            StarXpandCommand.DocumentBuilder().addPrinter(printerBuilder)
        )
        return builder.getCommands()
    }

    // バナー画像URLを取得して UIImage を返す。URL空・取得失敗時は nil（印刷は続行）。
    private func loadBannerImage(_ urlString: String?) async -> UIImage? {
        guard let urlString = urlString, !urlString.isEmpty, let url = URL(string: urlString) else {
            return nil
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            return UIImage(data: data)
        } catch {
            return nil
        }
    }

    // MARK: - ユーティリティ

    private func numberWithComma(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }

    // 全角を2幅として数える簡易表示幅
    private func displayWidth(_ s: String) -> Int {
        var w = 0
        for ch in s.unicodeScalars {
            w += ch.value > 0x2000 ? 2 : 1
        }
        return w
    }

    private static func interfaceName(_ type: InterfaceType) -> String {
        switch type {
        case .bluetooth: return "bluetooth"
        case .bluetoothLE: return "bluetoothLE"
        case .lan: return "lan"
        case .usb: return "usb"
        default: return "unknown"
        }
    }

    private static func interfaceType(_ name: String) -> InterfaceType {
        switch name {
        case "bluetoothLE": return .bluetoothLE
        case "lan": return .lan
        case "usb": return .usb
        default: return .bluetooth
        }
    }
}

// 探索完了をクロージャで受けるデリゲート
class StarDiscoveryDelegate: NSObject, StarDeviceDiscoveryManagerDelegate {
    private var printers: [StarPrinter] = []
    private let onFinish: ([StarPrinter]) -> Void
    private var finished = false

    init(onFinish: @escaping ([StarPrinter]) -> Void) {
        self.onFinish = onFinish
    }

    func manager(_ manager: StarDeviceDiscoveryManager, didFind printer: StarPrinter) {
        printers.append(printer)
    }

    func managerDidFinishDiscovery(_ manager: StarDeviceDiscoveryManager) {
        guard !finished else { return }
        finished = true
        onFinish(printers)
    }
}
