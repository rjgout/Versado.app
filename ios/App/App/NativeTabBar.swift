import UIKit

/// Meldt zijn eigen hoogte (inclusief de ruimte onder de homeindicator) zodra die verandert,
/// zodat de React-shell exact evenveel ruimte vrijhoudt.
final class NativeGlassTabBar: UITabBar {
    var onHeight: ((CGFloat) -> Void)?
    private var lastHeight: CGFloat = -1
    override func layoutSubviews() {
        super.layoutSubviews()
        let height = bounds.height
        guard height != lastHeight else { return }
        lastHeight = height
        onHeight?(height)
    }
}

/// Standaard UIKit-tabbalk. Gelinkt tegen de iOS 26 SDK krijgt `UITabBar` het Liquid
/// Glass-materiaal van het systeem; er is geen eigen tekenwerk of blur. Alleen de
/// WebView-routes bepalen wat een tik doet: de balk meldt een id en JavaScript navigeert.
final class NativeTabBarController: NSObject, UITabBarDelegate {
    var onSelect: ((String) -> Void)?
    var onHeight: ((CGFloat) -> Void)?
    private var bar: NativeGlassTabBar?
    private var shown: [NativeTabBarItem] = []

    static var available: Bool { NativeTabBarPolicy.available(ProcessInfo.processInfo.operatingSystemVersion) }

    /// Geeft de hoogte terug; alleen aanroepen op de main thread.
    func apply(_ request: NativeTabBarRequest, in host: UIView) -> CGFloat {
        let bar = self.bar ?? makeBar(in: host)
        bar.overrideUserInterfaceStyle = request.style == .dark ? .dark : .light
        // De kleur komt uit de asset catalog (licht en donker), gelijk aan het accent van de React-UI.
        if let accent = UIColor(named: "AccentColor") { bar.tintColor = accent }
        if request.items != shown {
            bar.items = request.items.enumerated().map { index, entry in
                let symbols = NativeTabBarPolicy.symbols[entry.id]!
                let item = UITabBarItem(title: entry.title, image: UIImage(systemName: symbols.normal), selectedImage: UIImage(systemName: symbols.selected))
                item.tag = index
                item.accessibilityIdentifier = "versado-tab-\(entry.id)"
                return item
            }
            shown = request.items
        }
        if let selected = request.selectedId, let index = shown.firstIndex(where: { $0.id == selected }) {
            if bar.selectedItem?.tag != index { bar.selectedItem = bar.items?[index] }
        } else {
            bar.selectedItem = nil
        }
        // Verborgen = doorzichtig en niet bedienbaar, niet `isHidden`: de hoogte moet ook dan echt gemeten
        // worden, zodat de React-shell de ruimte al vrijhoudt vóór de balk verschijnt.
        bar.alpha = request.visible ? 1 : 0
        bar.isUserInteractionEnabled = request.visible
        bar.accessibilityElementsHidden = !request.visible
        host.layoutIfNeeded()
        return bar.bounds.height
    }

    func remove() {
        bar?.removeFromSuperview()
        bar = nil
        shown = []
    }

    private func makeBar(in host: UIView) -> NativeGlassTabBar {
        let bar = NativeGlassTabBar()
        bar.delegate = self
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.onHeight = { [weak self] height in self?.onHeight?(height) }
        host.addSubview(bar)
        // Aan de onderrand van het scherm, niet van de veilige zone: UITabBar telt de ruimte onder
        // de homeindicator zelf mee in zijn hoogte.
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
        self.bar = bar
        return bar
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard shown.indices.contains(item.tag) else { return }
        onSelect?(shown[item.tag].id)
    }
}
