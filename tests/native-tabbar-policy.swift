import Foundation

@main struct NativeTabBarPolicyTests {
    static func require(_ value: Bool, _ label: String) { if !value { fatalError(label) } }

    static let valid: [String: Any] = [
        "version": 1,
        "items": [["id": "today", "title": "Vandaag"], ["id": "learn", "title": "Leren"]],
        "selectedId": "today",
        "visible": true,
        "style": "dark",
    ]

    static func rejects(_ patch: (inout [String: Any]) -> Void, _ label: String) {
        var raw = valid; patch(&raw)
        require(NativeTabBarPolicy.parse(raw) == nil, label)
    }

    static func main() {
        let request = NativeTabBarPolicy.parse(valid)
        require(request == NativeTabBarRequest(items: [NativeTabBarItem(id: "today", title: "Vandaag"), NativeTabBarItem(id: "learn", title: "Leren")], selectedId: "today", visible: true, style: .dark), "geldig verzoek")

        // Selectie mag leeg zijn (bijvoorbeeld op een route buiten de vier bestemmingen).
        var empty = valid; empty["selectedId"] = NSNull()
        require(NativeTabBarPolicy.parse(empty)?.selectedId == nil, "lege selectie")
        var absent = valid; absent.removeValue(forKey: "selectedId")
        require(NativeTabBarPolicy.parse(absent)?.selectedId == nil, "ontbrekende selectie")

        rejects({ $0["version"] = 2 }, "andere protocolversie")
        rejects({ $0["version"] = "1" }, "versie als tekst")
        rejects({ $0["visible"] = "true" }, "visible als tekst")
        rejects({ $0["style"] = "system" }, "onbekende stijl")
        rejects({ $0["extra"] = 1 }, "onbekend veld")
        rejects({ $0["items"] = [] as [[String: Any]] }, "geen items")
        rejects({ $0["items"] = [["id": "today", "title": "A"], ["id": "learn", "title": "B"], ["id": "play", "title": "C"], ["id": "friends", "title": "D"], ["id": "today", "title": "E"]] }, "te veel items")
        rejects({ $0["items"] = [["id": "profile", "title": "Profiel"]] }, "onbekende bestemming")
        rejects({ $0["items"] = [["id": "today", "title": "A"], ["id": "today", "title": "B"]] }, "dubbele bestemming")
        rejects({ $0["items"] = [["id": "today", "title": "A", "symbol": "trash"]] }, "symboolnaam van JavaScript")
        rejects({ $0["items"] = [["id": "today"]] }, "titel ontbreekt")
        rejects({ $0["items"] = [["id": "today", "title": "   "]] }, "lege titel")
        rejects({ $0["items"] = [["id": "today", "title": String(repeating: "x", count: NativeTabBarPolicy.maxTitleLength + 1)]] }, "te lange titel")
        rejects({ $0["items"] = [["id": "today", "title": "Vandaag\u{0007}"]] }, "stuurteken in titel")
        rejects({ $0["selectedId"] = "play" }, "selectie buiten de balk")
        rejects({ $0["selectedId"] = 3 }, "selectie als getal")

        // Een titel op de maximale lengte en met meertalige tekens is toegestaan; omringende spaties vallen weg.
        var long = valid
        long["items"] = [["id": "friends", "title": "  " + String(repeating: "é", count: NativeTabBarPolicy.maxTitleLength) + " "]]
        long["selectedId"] = "friends"
        require(NativeTabBarPolicy.parse(long)?.items.first?.title.count == NativeTabBarPolicy.maxTitleLength, "maximale titel")

        for id in ["today", "learn", "play", "friends"] { require(NativeTabBarPolicy.symbols[id] != nil, "symbool voor \(id)") }
        require(NativeTabBarPolicy.symbols.count == 4, "alleen de vier primaire bestemmingen")

        func version(_ major: Int) -> OperatingSystemVersion { OperatingSystemVersion(majorVersion: major, minorVersion: 0, patchVersion: 0) }
        require(!NativeTabBarPolicy.available(version(15)), "iOS 15")
        require(!NativeTabBarPolicy.available(version(25)), "iOS 25")
        require(NativeTabBarPolicy.available(version(26)), "iOS 26")
        require(NativeTabBarPolicy.available(version(27)), "iOS 27")
        print("native tabbar policy ok")
    }
}
