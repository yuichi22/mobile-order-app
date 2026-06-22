import UIKit
import Capacitor

// アプリ本体ターゲットに置いた独自プラグイン(StarPrinterPlugin)を Capacitor ブリッジへ登録する。
// Capacitor 6+ では、CAPBridgedPlugin 準拠だけでは「アプリ本体ターゲットのプラグイン」は
// 自動登録されないため、capacitorDidLoad() で registerPluginInstance により明示登録する。
// （これが無いと JS から呼ぶと "plugin is not implemented on iOS" になる）
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StarPrinterPlugin())
    }
}
