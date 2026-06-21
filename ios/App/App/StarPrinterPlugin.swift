import Foundation
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
        CAPPluginMethod(name: "printReceipt", returnType: CAPPluginReturnPromise)
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
                let settings: StarConnectionSettings
                if let id = identifier, !id.isEmpty {
                    settings = StarConnectionSettings(
                        interfaceType: StarPrinterPlugin.interfaceType(interfaceStr),
                        identifier: id
                    )
                } else if let found = try await self.discoverFirstPrinter(timeout: 8000) {
                    settings = found
                } else {
                    call.reject("プリンタが見つかりませんでした")
                    return
                }

                let printer = StarPrinter(settings)
                let commands = self.buildCommands(receipt)
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

    // MARK: - レシート組み立て（StarXpand コマンド）

    private func buildCommands(_ r: [String: Any]) -> String {
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

        // ヘッダ
        let header = str("headerTitle").isEmpty ? str("storeName") : str("headerTitle")
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 2, height: 2))
        center(header, bold: true)
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 1, height: 1))
        if !str("address").isEmpty { center(str("address")) }
        if !str("tel").isEmpty { center("TEL: " + str("tel")) }
        if !str("invoiceNumber").isEmpty { center("登録番号: " + str("invoiceNumber")) }
        divider()

        // メタ
        if !str("issuedAtText").isEmpty { text(str("issuedAtText")) }
        if !str("receiptNo").isEmpty { text("No: " + str("receiptNo")) }
        if !str("tableName").isEmpty { text(str("tableName")) }
        divider()

        // 明細
        if let items = r["items"] as? [[String: Any]] {
            for item in items {
                let name = (item["name"] as? String) ?? "商品"
                let qty = (item["quantity"] as? NSNumber)?.intValue ?? 1
                let total = (item["totalPrice"] as? NSNumber)?.intValue ?? 0
                text(name)
                lr("  x\(qty)", "¥" + numberWithComma(total))
            }
        }
        divider()

        // 金額
        lr("小計", yen(r["subtotal"]))
        let discount = (r["discount"] as? NSNumber)?.intValue ?? 0
        if discount > 0 { lr("値引き", "-¥" + numberWithComma(discount)) }
        lr("(内消費税)", yen(r["tax"]))
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 2, height: 1))
        lr("合計", yen(r["total"]))
        _ = printerBuilder.styleMagnification(StarXpandCommand.MagnificationParameter(width: 1, height: 1))
        if !str("paymentMethod").isEmpty { lr("お支払", str("paymentMethod")) }
        divider()

        // フッタ
        let footer = str("footerNote").isEmpty ? "ご利用ありがとうございました。" : str("footerNote")
        center(footer)
        _ = printerBuilder.actionFeedLine(1)
        _ = printerBuilder.actionCut(StarXpandCommand.Printer.CutType.partial)

        let builder = StarXpandCommand.StarXpandCommandBuilder()
        _ = builder.addDocument(
            StarXpandCommand.DocumentBuilder().addPrinter(printerBuilder)
        )
        return builder.getCommands()
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
