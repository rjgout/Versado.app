import Foundation

/// Zuiver Foundation-beleid voor de native tabbalk (geen UIKit): zo draait de
/// validatie ook in de macOS-policyproef zonder Capacitor of een toestel.
struct NativeTabBarItem: Equatable {
    let id: String
    let title: String
}

enum NativeTabBarStyle: String {
    case light, dark
}

struct NativeTabBarRequest: Equatable {
    let items: [NativeTabBarItem]
    let selectedId: String?
    let visible: Bool
    let style: NativeTabBarStyle
}

enum NativeTabBarPolicy {
    /// Alleen bestemmingen die de gedeelde React-navigatie kent. Het icoon volgt uit het id,
    /// nooit uit een door JavaScript meegestuurde symboolnaam.
    static let symbols: [String: (normal: String, selected: String)] = [
        "today": ("house", "house.fill"),
        "learn": ("book", "book.fill"),
        "play": ("gamecontroller", "gamecontroller.fill"),
        "friends": ("person.2", "person.2.fill"),
    ]
    static let maxTitleLength = 32

    /// Het liquid-glassmateriaal bestaat pas vanaf iOS 26; oudere versies houden de React-balk.
    static func available(_ version: OperatingSystemVersion) -> Bool { version.majorVersion >= 26 }

    private static func validTitle(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maxTitleLength else { return false }
        return !trimmed.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    /// Strikt: onbekende velden, dubbele ids, onbekende bestemmingen of lege/te lange titels
    /// geven nil. De aanroeper laat de React-balk dan staan.
    static func parse(_ raw: [String: Any]) -> NativeTabBarRequest? {
        let allowedKeys: Set<String> = ["version", "items", "selectedId", "visible", "style"]
        guard Set(raw.keys).isSubset(of: allowedKeys), (raw["version"] as? Int) == 1,
              let visible = raw["visible"] as? Bool,
              let styleValue = raw["style"] as? String, let style = NativeTabBarStyle(rawValue: styleValue),
              let rawItems = raw["items"] as? [[String: Any]], (1...symbols.count).contains(rawItems.count) else { return nil }
        var items: [NativeTabBarItem] = []
        for entry in rawItems {
            guard Set(entry.keys) == ["id", "title"], let id = entry["id"] as? String, symbols[id] != nil,
                  let title = entry["title"] as? String, validTitle(title),
                  !items.contains(where: { $0.id == id }) else { return nil }
            items.append(NativeTabBarItem(id: id, title: title.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        var selected: String?
        if let value = raw["selectedId"], !(value is NSNull) {
            guard let id = value as? String, items.contains(where: { $0.id == id }) else { return nil }
            selected = id
        }
        return NativeTabBarRequest(items: items, selectedId: selected, visible: visible, style: style)
    }
}
