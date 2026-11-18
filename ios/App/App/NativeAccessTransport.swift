import Foundation

// Geen Capacitor/JavaScript-afhankelijkheid; dezelfde begrensde policy is apart native testbaar.
enum NativeAccessPolicy {
    static let testOrigin = "https://api-test.versado.app"
    static func directAllowed(_ metadata: [String: Any]) -> Bool {
        metadata["appId"] as? String == "app.versado.app" && metadata["profile"] as? String == "local-store-test" &&
        metadata["channel"] as? String == "testflight" && metadata["apiOrigin"] as? String == testOrigin &&
        metadata["distribution"] as? Bool == true && metadata["compileProbe"] as? Bool == false && metadata["releaseApproved"] as? Bool == false
    }
    static func requestRouteAllowed(_ path: String, _ method: String, direct: Bool) -> Bool {
        routeAllowed(path, method) || (direct && method == "POST" && path == "realtime/session")
    }
    static let origin = "https://dev.versado.app"
    static let maxBody = 16_384, maxResponse = 1_048_576
    static func profileAllowed(enabled: Bool, metadata: [String: Any]) -> Bool {
        enabled && metadata["profile"] as? String == "local-internal" && metadata["channel"] as? String == "internal" &&
        metadata["apiOrigin"] as? String == origin && metadata["compileProbe"] as? Bool == false && metadata["releaseApproved"] as? Bool == false
    }
    static func routeAllowed(_ path: String, _ method: String) -> Bool {
        if path.hasPrefix("games/") { return NativeGamesPolicy.allows(path, method) }
        let pattern: String
        switch method {
        case "GET": pattern = "(?:courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/learning/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|capabilities|me|today|today-overview|profile|content-context|courses|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/audio(?:/playback)?|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/annotations(?:/[A-Za-z0-9_-]{1,128})?|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/resume|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}|courses/[A-Za-z0-9_-]{1,128}/path|courses/[A-Za-z0-9_-]{1,128}/(?:weeks|archive)|courses/[A-Za-z0-9_-]{1,128}/weeks/[A-Za-z0-9_-]{1,128}/steps|(chapters|study-media)/[A-Za-z0-9_-]{1,128})"
        case "POST": pattern = "(?:courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/learning/(?:start|submit|read|check)|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/annotations|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/position|profile(?:/two-factor)?|today-actions/(hide|friend-response)|content-context|login|register|forgot-password|reset-password|verify-email|refresh|logout|security-setup/(?:complete|cancel)|apple/(?:challenge|complete)|account/password|chapters/[A-Za-z0-9_-]{1,128}/complete)"
        case "DELETE": pattern = "(?:apple|account)"
        default: return false
        }
        return path.range(of: "\\A" + pattern + "\\z", options: .regularExpression) != nil
    }
    static func containsCredential(_ object: Any, _ credentials: NativeAccessCredentials) -> Bool {
        if let value = object as? String { return value.contains(credentials.id) || value.contains(credentials.secret) }
        if let values = object as? [String: Any] { return values.contains { containsCredential($0.key, credentials) || containsCredential($0.value, credentials) } }
        if let values = object as? [Any] { return values.contains { containsCredential($0, credentials) } }
        return false
    }
}
struct NativeAccessCredentials {
    let id: String, secret: String
    init(id: String, secret: String) throws {
        guard id.range(of: "\\A[A-Za-z0-9._-]{10,256}\\z", options: .regularExpression) != nil,
              secret.range(of: "\\A[A-Za-z0-9_+/=-]{16,512}\\z", options: .regularExpression) != nil else { throw NativeAccessFailure("access_request_invalid") }
        self.id = id; self.secret = secret
    }
}
struct NativeAccessFailure: Error { let code: String; init(_ code: String) { self.code = code } }

final class NativeAccessRequest: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private let credentials: NativeAccessCredentials?
    private let isCurrent: () -> Bool
    private var completion: ((Result<(Int, String), NativeAccessFailure>) -> Void)?
    private var session: URLSession?
    private var bytes = Data(), status = 0
    init(credentials: NativeAccessCredentials?, isCurrent: @escaping () -> Bool = { true }, completion: @escaping (Result<(Int, String), NativeAccessFailure>) -> Void) {
        self.credentials = credentials; self.isCurrent = isCurrent; self.completion = completion
    }
    func start(path: String, method: String, authorization: String?, body: String?, configuration: URLSessionConfiguration = .ephemeral) {
        guard isCurrent() else { finish(.failure(NativeAccessFailure("access_changed"))); return }
        guard NativeAccessPolicy.requestRouteAllowed(path, method, direct: credentials == nil), (body?.utf8.count ?? 0) <= NativeAccessPolicy.maxBody,
              method != "GET" || body == nil,
              authorization == nil || authorization!.range(of: "\\ABearer [A-Za-z0-9._~-]{1,2040}\\z", options: .regularExpression) != nil,
              let url = URL(string: (credentials == nil ? NativeAccessPolicy.testOrigin : NativeAccessPolicy.origin) + "/api/v1/native/" + path) else { finish(.failure(NativeAccessFailure("access_request_invalid"))); return }
        configuration.urlCache = nil; configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData; configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue); self.session = session
        var request = URLRequest(url: url); request.httpMethod = method; request.httpShouldHandleCookies = false
        request.setValue("capacitor://localhost", forHTTPHeaderField: "Origin"); request.setValue("native-v1", forHTTPHeaderField: "X-Versado-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credentials = credentials { request.setValue(credentials.id, forHTTPHeaderField: "CF-Access-Client-Id"); request.setValue(credentials.secret, forHTTPHeaderField: "CF-Access-Client-Secret") }
        if let authorization = authorization { request.setValue(authorization, forHTTPHeaderField: "Authorization") }
        if let body = body { request.httpBody = Data(body.utf8); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        session.dataTask(with: request).resume()
    }
    private func finish(_ result: Result<(Int, String), NativeAccessFailure>) {
        guard let callback = completion else { return }; completion = nil
        callback(isCurrent() ? result : .failure(NativeAccessFailure("access_changed"))); session?.invalidateAndCancel(); session = nil
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil); finish(.failure(NativeAccessFailure("access_redirect_blocked")))
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse else { completionHandler(.cancel); finish(.failure(NativeAccessFailure("access_invalid_response"))); return }
        status = response.statusCode
        guard (200...599).contains(status) else { completionHandler(.cancel); finish(.failure(NativeAccessFailure("access_invalid_response"))); return }
        guard !(300..<400).contains(status) else { completionHandler(.cancel); finish(.failure(NativeAccessFailure("access_redirect_blocked"))); return }
        guard response.value(forHTTPHeaderField: "Access-Control-Allow-Origin") == "capacitor://localhost",
              response.mimeType?.lowercased() == "application/json" else {
            completionHandler(.cancel); finish(.failure(NativeAccessFailure([401, 403].contains(status) ? "access_denied" : status >= 500 ? "access_network_unavailable" : "access_invalid_response"))); return
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= NativeAccessPolicy.maxResponse else { finish(.failure(NativeAccessFailure("access_invalid_response"))); return }
        bytes.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard completion != nil else { return }
        guard error == nil else { finish(.failure(NativeAccessFailure("access_network_unavailable"))); return }
        guard let object = try? JSONSerialization.jsonObject(with: bytes), object is [String: Any],
              !(credentials.map { NativeAccessPolicy.containsCredential(object, $0) } ?? false), let text = String(data: bytes, encoding: .utf8) else { finish(.failure(NativeAccessFailure("access_invalid_response"))); return }
        finish(.success((status, text)))
    }
}

// BEGIN NATIVE GAMES POLICY
// Gegenereerd uit de expliciete games-v1-grenzen; wijzigen via games-policy.mjs.
enum NativeGamesPolicy {
    private struct Rule {
        let regex: NSRegularExpression, methods: Set<String>, query: Set<String>, word: Bool
        init(_ pattern: String, _ methods: String, _ query: String, _ word: Bool) {
            self.regex = try! NSRegularExpression(pattern: "\\A" + pattern + "\\z")
            self.methods = Set(methods.split(separator: ",").map(String.init))
            self.query = Set(query.split(separator: ",").map(String.init)); self.word = word
        }
        func matches(_ input: String, _ method: String, _ keys: Set<String>) -> Bool {
            guard methods.contains(method), keys.isSubset(of: query) else { return false }
            var value = input
            if word {
                let parts = input.split(separator: "/", omittingEmptySubsequences: false)
                guard parts.count == 2, parts[0] == "dictionary", let decoded = String(parts[1]).removingPercentEncoding else { return false }
                value = "dictionary/" + decoded
            }
            return regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
        }
    }
    private static let api: [Rule] = [
        Rule("kompas/state", "GET,POST", "", false),
        Rule("open-actions", "GET", "tab,offset,limit", false),
        Rule("nudges", "POST", "", false),
        Rule("group-invites/[A-Za-z0-9_-]{1,128}", "POST", "", false),
        Rule("friends/[A-Za-z0-9_-]{1,128}/accept", "POST", "", false),
        Rule("friends/[A-Za-z0-9_-]{1,128}/decline", "POST", "", false),
        Rule("reading-sessions", "POST", "", false),
        Rule("chapters/[A-Za-z0-9_-]{1,128}/read", "POST", "", false),
        Rule("chapters/[A-Za-z0-9_-]{1,128}/submit", "POST", "", false),
        Rule("exercises/[A-Za-z0-9_-]{1,128}/check", "POST", "", false),
        Rule("study/[A-Za-z0-9_-]{1,128}/units", "GET", "", false),
        Rule("activity-status", "GET", "", false),
        Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}/evenings", "POST", "", false),
        Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}/finale", "POST", "", false),
        Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}/members", "POST,DELETE", "", false),
        Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}", "GET,PATCH", "absent", false),
        Rule("alleskenner/seasons", "GET,POST", "", false),
        Rule("alleskenner/solo", "GET,POST", "", false),
        Rule("challenges/[A-Za-z0-9_-]{1,128}/accept", "POST", "", false),
        Rule("challenges/[A-Za-z0-9_-]{1,128}/cancel", "POST", "", false),
        Rule("challenges/[A-Za-z0-9_-]{1,128}/decline", "POST", "", false),
        Rule("challenges/[A-Za-z0-9_-]{1,128}/forfeit", "POST", "", false),
        Rule("challenges", "GET,POST", "", false),
        Rule("chapter-guess/[A-Za-z0-9_-]{1,128}/answer", "POST", "", false),
        Rule("chapter-guess/[A-Za-z0-9_-]{1,128}/forfeit", "POST", "", false),
        Rule("chapter-guess/[A-Za-z0-9_-]{1,128}/hint", "POST", "", false),
        Rule("chapter-guess/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("chapter-guess/start", "POST", "", false),
        Rule("chapters", "GET", "", false),
        Rule("dictionary/[\\p{L}\\p{M}'’\\-]{1,64}", "GET", "", true),
        Rule("exercises/[A-Za-z0-9_-]{1,128}/hint", "GET,POST", "", false),
        Rule("feedback/exercise", "POST", "", false),
        Rule("friends/recent", "GET", "", false),
        Rule("friends/request", "POST", "", false),
        Rule("friends/profiles/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("friends/[A-Za-z0-9_-]{1,128}", "DELETE", "", false),
        Rule("friend-streaks/[A-Za-z0-9_-]{1,128}", "POST", "", false),
        Rule("friend-streaks", "GET,POST", "", false),
        Rule("freezes/gift", "POST", "", false),
        Rule("friends", "GET", "", false),
        Rule("hints", "GET", "", false),
        Rule("jigsaw-v2", "POST", "", false),
        Rule("jigsaw", "POST", "", false),
        Rule("list-order", "GET,PUT", "listKey", false),
        Rule("live/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("live/create-alleskenner", "POST", "", false),
        Rule("live/create-chapter-guess", "POST", "", false),
        Rule("live/create-family-game", "POST", "", false),
        Rule("live/create", "POST", "", false),
        Rule("mysteries/attempts", "GET,POST", "variant", false),
        Rule("puzzle/coop", "POST", "", false),
        Rule("puzzle/history", "GET", "limit,cursor", false),
        Rule("puzzle/leaderboard", "GET", "variantId,imageId,pieceCount,difficulty,mode,hintCategory", false),
        Rule("puzzle/match", "POST", "", false),
        Rule("puzzle/overview", "GET", "", false),
        Rule("puzzle/records", "GET", "mode,hintCategory,pieceCount,difficulty", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/accept", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/cancel", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/decline", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/exchange", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/forfeit", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/hint", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/move", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}/pass", "POST", "", false),
        Rule("scrabble/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("scrabble", "GET,POST", "", false),
        Rule("shop/freezes", "POST", "", false),
        Rule("shop/genees", "POST", "", false),
        Rule("shop/hints", "POST", "", false),
        Rule("shop", "GET", "", false),
        Rule("snelle-zendeling/leaderboard", "GET", "type,board", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/death", "POST", "", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/finish", "POST", "", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/genees", "POST", "", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/resume", "POST", "", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/revive/answer", "POST", "", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/revive", "POST", "", false),
        Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("snelle-zendeling/runs", "POST", "", false),
        Rule("snelle-zendeling/together", "POST", "", false),
        Rule("streak", "GET", "year,month", false),
        Rule("xp-history", "GET", "skip", false),
        Rule("leaderboard", "GET", "scope", false),
        Rule("streak/celebration", "POST,GET", "", false),
        Rule("streak/continuation", "GET,POST", "", false),
        Rule("users/avatars", "GET", "ids", false),
        Rule("users/search", "GET", "q", false),
        Rule("word-game/guess", "POST", "", false),
        Rule("word-game/hint", "POST", "", false),
        Rule("word-game/ranking", "GET", "", false),
        Rule("word-game", "GET", "", false),
        Rule("word-search/[A-Za-z0-9_-]{1,128}/find", "POST", "", false),
        Rule("word-search/[A-Za-z0-9_-]{1,128}/give-up", "POST", "", false),
        Rule("word-search/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("word-search", "GET,POST", "", false)
    ]
    private static let pages: [Rule] = [
        Rule("/shop", "GET", "", false),
        Rule("/kompas/play", "GET", "", false),
        Rule("/kompas/play\\.jigsaw", "GET", "", false),
        Rule("/kompas/play\\.word-search", "GET", "", false),
        Rule("/kompas/play\\.word-game", "GET", "", false),
        Rule("/kompas/play\\.scrabble", "GET", "", false),
        Rule("/kompas/play\\.alleskenner", "GET", "", false),
        Rule("/kompas/play\\.gezinsavond", "GET", "", false),
        Rule("/kompas/play\\.chapter-guess", "GET", "", false),
        Rule("/kompas/play\\.challenges", "GET", "", false),
        Rule("/kompas/play\\.quick-missionary", "GET", "", false),
        Rule("/kompas/play\\.mystery", "GET", "", false),
        Rule("/acties", "GET", "tab", false),
        Rule("/lesson/[A-Za-z0-9_-]{1,128}", "GET", "challengeId,cursus,vers,returnTo", false),
        Rule("/alleskenner/alleen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/alleskenner/alleen", "GET", "", false),
        Rule("/alleskenner", "GET", "", false),
        Rule("/alleskenner/seizoen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/alleskenner/seizoen", "GET", "", false),
        Rule("/challenges", "GET", "", false),
        Rule("/chapter-guess", "GET", "", false),
        Rule("/chapter-guess/solo/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/gezinsavond", "GET", "", false),
        Rule("/jigsaw/afgerond", "GET", "", false),
        Rule("/jigsaw", "GET", "", false),
        Rule("/jigsaw/records/[A-Za-z0-9_-]{1,128}", "GET", "mode,cat", false),
        Rule("/jigsaw/records", "GET", "", false),
        Rule("/jigsaw/samen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/jigsaw/wedstrijd/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/live/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/live", "GET", "availability,kompas", false),
        Rule("/mysteries/001", "GET", "", false),
        Rule("/mysteries/001a", "GET", "", false),
        Rule("/mysteries/001a/play", "GET", "resume", false),
        Rule("/mysteries/001b", "GET", "", false),
        Rule("/mysteries/001b/play", "GET", "resume", false),
        Rule("/mysteries/001c", "GET", "", false),
        Rule("/mysteries/001c/play", "GET", "resume", false),
        Rule("/mysteries/002", "GET", "", false),
        Rule("/mysteries/002a", "GET", "", false),
        Rule("/mysteries/002a/play", "GET", "resume", false),
        Rule("/mysteries/002b", "GET", "", false),
        Rule("/mysteries/002b/play", "GET", "resume", false),
        Rule("/mysteries/002c", "GET", "", false),
        Rule("/mysteries/002c/play", "GET", "resume", false),
        Rule("/mysteries/003", "GET", "", false),
        Rule("/mysteries/003a", "GET", "", false),
        Rule("/mysteries/003a/play", "GET", "resume", false),
        Rule("/mysteries/003b", "GET", "", false),
        Rule("/mysteries/003b/play", "GET", "resume", false),
        Rule("/mysteries/003c", "GET", "", false),
        Rule("/mysteries/003c/play", "GET", "resume", false),
        Rule("/mysteries/004", "GET", "", false),
        Rule("/mysteries/004a", "GET", "", false),
        Rule("/mysteries/004a/play", "GET", "resume", false),
        Rule("/mysteries/004b", "GET", "", false),
        Rule("/mysteries/004b/play", "GET", "resume", false),
        Rule("/mysteries/004c", "GET", "", false),
        Rule("/mysteries/004c/play", "GET", "resume", false),
        Rule("/mysteries/005", "GET", "", false),
        Rule("/mysteries/005a", "GET", "", false),
        Rule("/mysteries/005a/play", "GET", "resume", false),
        Rule("/mysteries/005b", "GET", "", false),
        Rule("/mysteries/005b/play", "GET", "resume", false),
        Rule("/mysteries/005c", "GET", "", false),
        Rule("/mysteries/005c/play", "GET", "resume", false),
        Rule("/mysteries/006", "GET", "", false),
        Rule("/mysteries/006a", "GET", "", false),
        Rule("/mysteries/006a/play", "GET", "resume", false),
        Rule("/mysteries/006b", "GET", "", false),
        Rule("/mysteries/006b/play", "GET", "resume", false),
        Rule("/mysteries/006c", "GET", "", false),
        Rule("/mysteries/006c/play", "GET", "resume", false),
        Rule("/mysteries", "GET", "", false),
        Rule("/scrabble/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/scrabble", "GET", "", false),
        Rule("/snelle-zendeling", "GET", "view", false),
        Rule("/snelle-zendeling/run/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/snelle-zendeling/samen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/word-game", "GET", "", false),
        Rule("/word-search/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        Rule("/word-search", "GET", "", false)
    ]
    private static func clean(_ input: String, _ max: Int) -> Bool {
        input.utf8.count <= max && input.utf8.allSatisfy { $0 >= 33 && $0 <= 126 && $0 != 92 && $0 != 35 } && input.range(of: "%(?![0-9A-Fa-f]{2})", options: .regularExpression) == nil
    }
    private static func query(_ input: String) -> [URLQueryItem]? {
        guard let parts = URLComponents(string: "https://policy.invalid/" + input), parts.host == "policy.invalid", parts.fragment == nil else { return nil }
        let items = parts.queryItems ?? []
        guard Set(items.map { $0.name }).count == items.count else { return nil }
        return items
    }
    static func audioAllowed(_ path: String, _ stream: Bool) -> Bool {
        clean(path, 512) && path.range(of: stream ? "\\Agames/(?:reading/[A-Za-z0-9_-]{1,128}|intro-(?:solo|live)/[A-Za-z0-9_-]{1,128}/(?:0|[1-9][0-9]?|[1-4][0-9]{2}))/audio/[a-f0-9]{64}/stream\\z" : "\\Agames/(?:reading/[A-Za-z0-9_-]{1,128}|(?:intro|ak)-(?:solo|live)/[A-Za-z0-9_-]{1,128}/(?:0|[1-9][0-9]?|[1-4][0-9]{2}))/audio/playback\\z", options: .regularExpression) != nil
    }
    static func allows(_ path: String, _ method: String) -> Bool {
        guard clean(path, 8192), path.hasPrefix("games/"), let items = query(path) else { return false }
        if method == "GET", audioAllowed(path, false) { return true }
        let raw = String(path.dropFirst(6)).split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
        let keys = Set(items.map { $0.name })
        if raw == "page" { return method == "GET" && keys == Set(["route"]) && items.count == 1 && page(items[0].value ?? "") }
        if items.isEmpty {
            if method == "GET", String(raw).range(of: "\\Areading/[A-Za-z0-9_-]{1,128}/annotations(?:/[A-Za-z0-9_-]{1,128})?\\z", options: .regularExpression) != nil { return true }
            if method == "POST", String(raw).range(of: "\\Areading/[A-Za-z0-9_-]{1,128}/annotations\\z", options: .regularExpression) != nil { return true }
        }
        if raw == "list-order" {
            guard method == "GET" && items.count == 1 && items[0].name == "listKey" && items[0].value == "games" || method == "PUT" && items.isEmpty else { return false }
        }
        return api.contains { $0.matches(String(raw), method, keys) }
    }
    private static func page(_ href: String) -> Bool {
        guard clean(href, 4096), href.hasPrefix("/"), !href.hasPrefix("//"), !href.split(separator: "?", maxSplits: 1)[0].contains("%"), let items = query(String(href.dropFirst())) else { return false }
        let path = String(href.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        if path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) { return false }
        for item in items {
            let values = ["view": ["leaderboard"], "availability": ["unavailable"], "resume": ["completed"], "mode": ["SOLO", "MATCH"], "cat": ["NO_HINTS", "WITH_HINTS"], "kompas": ["play"]]
            let value = item.value ?? ""
            if item.name == "tab", ["required", "continue", "waiting"].contains(item.value ?? "") { continue }
            if ["challengeId", "cursus"].contains(item.name) {
                guard value.range(of: "\\A[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil else { return false }; continue
            }
            if item.name == "vers" { guard let number = Int(value), number >= 1, number <= 500, String(number) == value else { return false }; continue }
            if item.name == "returnTo" { guard value.hasPrefix("/mysteries/"), page(value) else { return false }; continue }
            guard let allowed = values[item.name], allowed.contains(value) else { return false }
        }
        return pages.contains { $0.matches(path, "GET", Set(items.map { $0.name })) }
    }
}
// END NATIVE GAMES POLICY
