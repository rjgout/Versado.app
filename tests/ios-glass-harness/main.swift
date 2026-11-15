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

final class WebViewController: UIViewController {
    let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    let tabBar = NativeTabBarController()
    override func viewDidLoad() {
        super.viewDidLoad()
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
        // Laat de inhoud onder de balk doorlopen, zoals in de echte app.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.web.scrollView.setContentOffset(CGPoint(x: 0, y: 330), animated: false) }
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { scroll.setContentOffset(CGPoint(x: 0, y: 330), animated: false) }
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
