import UIKit
import WebKit

// Meetapp voor de iOS 26-simulator: dezelfde NativeTabBar-bronnen als de echte app, in twee
// architecturen, boven gekleurde inhoud. Alleen voor bewijs (screenshots); nooit onderdeel van de app.
//   -variant standalone   losse UITabBar (NativeTabBarController) boven een WKWebView
//   -variant controller   UITabBarController met dezelfde vier bestemmingen
//   -style light|dark

let arguments = ProcessInfo.processInfo.arguments
func argument(_ name: String, default value: String) -> String {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return value }
    return arguments[index + 1]
}
let variant = argument("-variant", default: "standalone")
let style = argument("-style", default: "light")

let items = [
    NativeTabBarItem(id: "today", title: "Vandaag"), NativeTabBarItem(id: "learn", title: "Leren"),
    NativeTabBarItem(id: "play", title: "Spelen"), NativeTabBarItem(id: "friends", title: "Vrienden"),
]

let stripes = (0..<40).map { index in
    "<div style=\"height:96px;background:hsl(\(index * 23 % 360),80%,\(index % 2 == 0 ? 55 : 35)%);color:white;font:700 20px -apple-system;padding:28px\">Regel \(index + 1)</div>"
}.joined()
let html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'></head><body style='margin:0'>\(stripes)</body></html>"

/// Deterministisch "klaar"-bewijs voor het script: pas als de inhoud echt getekend is schrijft de app
/// `ready.json` (in Documents). Het script wacht daarop in plaats van op een vaste tijd en faalt hard zonder
/// bewijs of met een balk zonder hoogte; een leeg of te vroeg screenshot is dus nooit stilzwijgend "goed".
func signalReady(_ info: [String: Any]) {
    var payload = info
    payload["variant"] = variant; payload["style"] = style
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
          let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
    try? data.write(to: documents.appendingPathComponent("ready.json"), options: .atomic)
    print("HARNESS ready \(String(data: data, encoding: .utf8) ?? "")")
    fflush(stdout)
}

final class WebViewController: UIViewController, WKNavigationDelegate {
    let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    let tabBar = NativeTabBarController()
    private var webLoaded = false
    private var barHeight: CGFloat = 0
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { webLoaded = true; maybeReady() }
    private func maybeReady() {
        guard webLoaded, barHeight > 0 else { return }
        // Even de inhoud laten scrollen en het glas laten renderen voordat het script een screenshot maakt.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.web.scrollView.setContentOffset(CGPoint(x: 0, y: 330), animated: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                // Terugkeer uit de achtergrond nabootsen met dezelfde melding en dezelfde aanroep als de plugin:
                // de balk meldt zijn hoogte opnieuw, er komt geen tweede balk en de hoogte blijft gelijk.
                var heights: [Double] = []
                self.tabBar.onHeight = { heights.append(Double($0)) }
                NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
                let bars = self.view.subviews.filter { $0 is UITabBar }.count
                signalReady(["barHeight": Double(self.barHeight), "windowHeight": Double(self.view.window?.bounds.height ?? 0), "webLoaded": true,
                             "remeasuredHeights": heights, "tabBarCount": bars])
            }
        }
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        web.navigationDelegate = self
        // Spiegelt VersadoNativePlugin.load(): didBecomeActive -> tabBar.remeasure().
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.tabBar.remeasure() }
        web.frame = view.bounds; web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.loadHTMLString(html, baseURL: nil)
        view.addSubview(web)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let request = NativeTabBarRequest(items: items, selectedId: "learn", visible: true, style: style == "dark" ? .dark : .light)
        let height = tabBar.apply(request, in: view)
        print("HARNESS standalone height=\(height)")
        barHeight = height
        maybeReady()
    }
}

final class ContentViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let scroll = UIScrollView(frame: view.bounds); scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.contentInsetAdjustmentBehavior = .automatic
        var y: CGFloat = 0
        for index in 0..<40 {
            let row = UILabel(frame: CGRect(x: 0, y: y, width: view.bounds.width, height: 96))
            row.autoresizingMask = [.flexibleWidth]
            row.text = "  Regel \(index + 1)"; row.textColor = .white; row.font = .boldSystemFont(ofSize: 20)
            row.backgroundColor = UIColor(hue: CGFloat(index * 23 % 360) / 360, saturation: 0.8, brightness: index % 2 == 0 ? 0.85 : 0.55, alpha: 1)
            scroll.addSubview(row); y += 96
        }
        scroll.contentSize = CGSize(width: view.bounds.width, height: y)
        view.addSubview(scroll)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { scroll.setContentOffset(CGPoint(x: 0, y: 330), animated: false) }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            signalReady(["barHeight": Double(self.tabBarController?.tabBar.bounds.height ?? 0), "windowHeight": Double(self.view.window?.bounds.height ?? 0), "webLoaded": true])
        }
    }
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.overrideUserInterfaceStyle = style == "dark" ? .dark : .light
        if variant == "controller" {
            let controller = UITabBarController()
            controller.viewControllers = items.map { entry in
                let child = ContentViewController()
                let symbols = NativeTabBarPolicy.symbols[entry.id]!
                child.tabBarItem = UITabBarItem(title: entry.title, image: UIImage(systemName: symbols.normal), selectedImage: UIImage(systemName: symbols.selected))
                return child
            }
            controller.selectedIndex = 1
            if let accent = UIColor(named: "AccentColor") { controller.tabBar.tintColor = accent }
            window.rootViewController = controller
        } else {
            window.rootViewController = WebViewController()
        }
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
