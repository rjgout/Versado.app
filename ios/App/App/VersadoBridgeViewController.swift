import Capacitor

class VersadoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VersadoNativePlugin())
    }
}
