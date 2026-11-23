import Foundation

private final class FakeAccessProtocol: URLProtocol {
    static var response: (Int, String, String?, String) = (200, "application/json", "capacitor://localhost", "{\"ok\":true}")
    static var captured: URLRequest?
    static var beforeReply: (() -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request; Self.beforeReply?()
        var headers = ["Content-Type": Self.response.1]
        if let origin = Self.response.2 { headers["Access-Control-Allow-Origin"] = origin }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.response.0, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.response.3.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main struct NativeAccessPolicyTests {
    static func require(_ value: Bool, _ label: String) { if !value { fatalError(label) } }
    static func perform(current: @escaping () -> Bool = { true }, direct: Bool = false) throws -> Result<(Int, String), NativeAccessFailure> {
        let pair = try NativeAccessCredentials(id: "synthetic-device.access", secret: "synthetic-secret-for-native-tests")
        let done = DispatchSemaphore(value: 0); var result: Result<(Int, String), NativeAccessFailure>?
        let request = NativeAccessRequest(credentials: direct ? nil : pair, isCurrent: current) { value in result = value; done.signal() }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [FakeAccessProtocol.self]
        request.start(path: "login", method: "POST", authorization: "Bearer synthetic.native", body: "{}", configuration: config)
        require(done.wait(timeout: .now() + 5) == .success, "native request timed out")
        return result!
    }
    static func failure(_ result: Result<(Int, String), NativeAccessFailure>, _ code: String) {
        if case .failure(let error) = result { require(error.code == code, "unexpected native error code") } else { fatalError("unsafe response accepted") }
    }
    static func main() throws {
        verifyNativeGamesPolicy()
        for kind in ["bookmark", "highlight", "note"] {
            require(NativeAccessPolicy.routeAllowed("study-folder/\(kind)/own_1/annotations", "GET"), "folder read")
            require(NativeAccessPolicy.routeAllowed("study-folder/\(kind)/own_1/passage", "GET"), "folder passage")
            require(!NativeAccessPolicy.routeAllowed("study-folder/\(kind)/own_1/annotations", "DELETE"), "folder method")
        }
        require(NativeAccessPolicy.routeAllowed("study-folder/query", "POST"), "folder search")
        require(NativeAccessPolicy.routeAllowed("study-folder/annotations", "POST"), "folder mutation")
        for path in ["study-folder/query?q=private", "study-folder/note/x/passage\n", "study-folder/note/x%2Fy/passage", "study-folder/admin/x/passage"] {
            require(!NativeAccessPolicy.routeAllowed(path, "GET"), "folder unsafe read")
            require(!NativeAccessPolicy.routeAllowed(path, "POST"), "folder unsafe write")
        }
        let directMetadata: [String: Any] = ["appId":"app.versado.app", "profile":"local-store-test", "channel":"testflight", "apiOrigin":NativeAccessPolicy.testOrigin, "distribution":true, "compileProbe":false, "releaseApproved":false]
        require(NativeAccessPolicy.directAllowed(directMetadata), "direct TestFlight profile")
        for (key, value) in [("apiOrigin", "https://versado.app" as Any), ("profile", "local-internal" as Any), ("channel", "play-test" as Any), ("compileProbe", true as Any), ("releaseApproved", true as Any), ("distribution", false as Any)] {
            var invalid = directMetadata; invalid[key] = value; require(!NativeAccessPolicy.directAllowed(invalid), "invalid direct profile")
        }
        require(!NativeAccessPolicy.routeAllowed("realtime/session", "POST"), "internal realtime stays blocked")
        require(NativeAccessPolicy.requestRouteAllowed("realtime/session", "POST", direct:true), "direct realtime ticket")
        if case .success = try perform(direct:true) {} else { fatalError("direct request failed") }
        require(FakeAccessProtocol.captured?.url?.host == "api-test.versado.app", "direct host")
        require(FakeAccessProtocol.captured?.value(forHTTPHeaderField:"CF-Access-Client-Secret") == nil, "no CF secret")
        require(FakeAccessProtocol.captured?.value(forHTTPHeaderField:"Cookie") == nil, "no web cookie")
        let metadata: [String: Any] = ["profile": "local-internal", "channel": "internal", "apiOrigin": NativeAccessPolicy.origin, "compileProbe": false, "releaseApproved": false]
        require(NativeAccessPolicy.profileAllowed(enabled: true, metadata: metadata), "internal profile rejected")
        require(!NativeAccessPolicy.profileAllowed(enabled: false, metadata: metadata), "implicit access enabled")
        for profile in ["local-development", "local-store-test", "release", "remote-preview"] {
            var changed = metadata; changed["profile"] = profile
            require(!NativeAccessPolicy.profileAllowed(enabled: true, metadata: changed), "non-internal profile enabled")
        }
        for path in ["../admin", "me?url=https://evil.invalid", "https://evil.invalid", "chapters/%2e%2e", "realtime/session", "capabilities\n"] {
            require(!NativeAccessPolicy.routeAllowed(path, "GET"), "unsafe route enabled")
        }
        require(NativeAccessPolicy.routeAllowed("chapters/synthetic-1/complete", "POST"), "chapter completion rejected")
        for path in ["courses/c/weeks", "courses/c/archive", "courses/c/weeks/e/steps"] {
            require(NativeAccessPolicy.routeAllowed(path, "GET"), "CFM route rejected")
            for method in ["POST", "PUT", "DELETE", "HEAD"] { require(!NativeAccessPolicy.routeAllowed(path, method), "CFM write enabled") }
        }
        for path in ["courses/c/weeks?x=1", "courses/c/weeks/e/steps/x", "courses/c/weeks/../steps"] { require(!NativeAccessPolicy.routeAllowed(path,"GET"), "broad CFM route enabled") }
        for kind in ["steps","chapters"] {
            let path="courses/c/read/"+kind+"/t/audio/playback"
            require(NativeAccessPolicy.routeAllowed(path,"GET"),"playback metadata rejected")
            for method in ["POST","PUT","PATCH","DELETE","HEAD"] { require(!NativeAccessPolicy.routeAllowed(path,method),"playback write enabled") }
            for suffix in ["/","?url=other","/stream","/../me","\n"] { require(!NativeAccessPolicy.routeAllowed(path+suffix,"GET"),"broad playback route") }
            require(!NativeAccessPolicy.routeAllowed("courses/c/read/"+kind+"/t/audio/"+String(repeating:"a",count:64)+"/stream","GET"),"binary stream through JSON")
        }
        for path in ["courses/c/read/steps/s", "courses/c/read/chapters/ch"] {
            require(NativeAccessPolicy.routeAllowed(path,"GET"), "reader GET rejected")
            for method in ["POST","PUT","PATCH","DELETE","HEAD"] { require(!NativeAccessPolicy.routeAllowed(path,method), "reader write enabled") }
            for suffix in ["/", "?x=1", "/complete", "%2f", "/../me"] { require(!NativeAccessPolicy.routeAllowed(path+suffix,"GET"), "broad reader route") }
        }
        for path in ["courses/c/read/steps/s", "courses/c/read/chapters/ch"] {
            require(NativeAccessPolicy.routeAllowed(path + "/resume", "GET"), "resume rejected")
            require(NativeAccessPolicy.routeAllowed(path + "/position", "POST"), "position rejected")
            require(!NativeAccessPolicy.routeAllowed(path + "/resume", "POST"), "resume write enabled")
            require(!NativeAccessPolicy.routeAllowed(path + "/position", "GET"), "position read enabled")
            for suffix in ["/", "?x=1", "\n", "/complete"] {
                require(!NativeAccessPolicy.routeAllowed(path + "/resume" + suffix, "GET"), "broad resume enabled")
                require(!NativeAccessPolicy.routeAllowed(path + "/position" + suffix, "POST"), "broad position enabled")
            }
        }
        for kind in ["steps", "chapters"] {
            let prefix = "courses/c/read/"+kind+"/t/learning/"
            let status = prefix+"sessions/00112233-4455-4677-8899-aabbccddeeff"
            require(NativeAccessPolicy.routeAllowed(status,"GET"), "learning resume rejected")
            require(!NativeAccessPolicy.routeAllowed(status,"POST"), "learning resume write")
            for action in ["start", "submit", "read", "check"] {
                require(NativeAccessPolicy.routeAllowed(prefix+action,"POST"), "learning POST rejected")
                require(!NativeAccessPolicy.routeAllowed(prefix+action,"GET"), "learning GET mutates")
                for suffix in ["/x", "?a=1", "#x", "\n", "%2f"] {
                    require(!NativeAccessPolicy.routeAllowed(prefix+action+suffix,"POST"), "broad learning route")
                }
            }
        }
        for path in ["courses/c/read/steps/s/annotations", "courses/c/read/chapters/ch/annotations"] {
            require(NativeAccessPolicy.routeAllowed(path,"GET"), "annotations GET rejected")
            require(NativeAccessPolicy.routeAllowed(path+"/v","GET"), "verse annotations rejected")
            require(NativeAccessPolicy.routeAllowed(path,"POST"), "annotation action rejected")
            require(!NativeAccessPolicy.routeAllowed(path+"/v","POST"), "per-verse POST enabled")
            for method in ["PUT","PATCH","DELETE","HEAD"] { require(!NativeAccessPolicy.routeAllowed(path,method), "broad annotation method") }
            for suffix in ["/", "?user=B", "/v/extra", "/../v", "/%2f", "\n"] { require(!NativeAccessPolicy.routeAllowed(path+suffix,"GET"), "broad annotation route") }
        }
        require(NativeAccessPolicy.routeAllowed("today-overview", "GET"), "today overview rejected")
        for method in ["POST", "PUT", "DELETE", "HEAD"] { require(!NativeAccessPolicy.routeAllowed("today-overview", method), "today overview write enabled") }
        for path in ["today-overview/", "today-overview?user=A", "today-overview/complete"] { require(!NativeAccessPolicy.routeAllowed(path, "GET"), "broad today route enabled") }
        for method in ["GET", "POST"] { require(NativeAccessPolicy.routeAllowed("content-context", method), "content context rejected") }
        for method in ["PUT", "PATCH", "DELETE", "HEAD"] { require(!NativeAccessPolicy.routeAllowed("content-context", method), "extra content verb allowed") }
        for path in ["content-context/", "content-context/preview", "content-context?preview=1", "../content-context", "content-context%2f"] {
            for method in ["GET", "POST"] { require(!NativeAccessPolicy.routeAllowed(path, method), "broad content route allowed") }
        }
        let valid = try perform()
        if case .success(let response) = valid { require(response.0 == 200 && response.1 == "{\"ok\":true}", "valid response changed") } else { fatalError("native access failed") }
        let headers = FakeAccessProtocol.captured!
        require(headers.url?.absoluteString == "https://dev.versado.app/api/v1/native/login", "wrong backend")
        require(headers.value(forHTTPHeaderField: "CF-Access-Client-Id") == "synthetic-device.access", "client id missing")
        require(headers.value(forHTTPHeaderField: "CF-Access-Client-Secret") == "synthetic-secret-for-native-tests", "native secret missing")
        require(headers.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic.native", "Versado authorization changed")
        require(headers.value(forHTTPHeaderField: "Cookie") == nil, "cookies sent")
        for status in [401, 403] { FakeAccessProtocol.response = (status, "text/html", nil, "Access denied"); failure(try perform(), "access_denied") }
        for status in [500, 502, 503] {
            FakeAccessProtocol.response = (status, "text/html", nil, "synthetic-secret-for-native-tests")
            failure(try perform(), "access_network_unavailable")
        }
        FakeAccessProtocol.response = (503, "application/json", "capacitor://localhost", "{\"error\":\"synthetic_backend_unavailable\"}")
        if case .success(let response) = try perform() { require(response.0 == 503 && response.1.contains("synthetic_backend_unavailable"), "valid backend 503 hidden") } else { fatalError("backend 503 hidden") }
        FakeAccessProtocol.response = (503, "application/json", "capacitor://localhost", "{\"error\":\"synthetic-secret-for-native-tests\"}")
        failure(try perform(), "access_invalid_response")
        FakeAccessProtocol.response = (401, "application/json", "capacitor://localhost", "{\"error\":\"session_expired\"}")
        if case .success(let response) = try perform() { require(response.0 == 401, "Versado 401 changed") } else { fatalError("backend 401 hidden") }
        FakeAccessProtocol.response = (302, "text/html", nil, "redirect"); failure(try perform(), "access_redirect_blocked")
        for text in ["{\"nested\":[\"synthetic-secret-for-native-tests\"]}", "{\"nested\":\"\\u0073ynthetic-secret-for-native-tests\"}", "{\"synthetic-device.access\":true}", "not json", String(repeating: "x", count: NativeAccessPolicy.maxResponse + 1)] {
            FakeAccessProtocol.response = (200, "application/json", "capacitor://localhost", text); failure(try perform(), "access_invalid_response")
        }
        FakeAccessProtocol.response = (200, "application/json", "capacitor://localhost", "{\"ok\":true}")
        FakeAccessProtocol.captured = nil; failure(try perform(current: { false }), "access_changed"); require(FakeAccessProtocol.captured == nil, "stale request sent")
        var current = true; FakeAccessProtocol.beforeReply = { current = false }
        failure(try perform(current: { current }), "access_changed")
        print("Native Access Swift: profile-, route-, HTTPS-header-, denial-, redirect-, echo-, omvang- en generatietests geslaagd.")
    }
}

// BEGIN GAME REQUEST CASES
private func verifyNativeGamesPolicy() {
    let cases: [(String, String, Bool)] = [
        ("games/list-order", "GET", false),
        ("games/list-order?listKey=today-continue", "GET", false),
        ("games/list-order?listKey=games", "GET", true),
        ("games/list-order?listKey=courses", "GET", true),
        ("games/list-order?listKey=games", "PUT", false),
        ("games/list-order?listKey=courses", "PUT", false),
        ("games/list-order?listKey=courses&listKey=games", "GET", false),
        ("games/list-order?listKey=courses&userId=foreign", "GET", false),
        ("games/reading/chapter/annotations", "GET", true),
        ("games/reading/chapter/annotations/verse", "GET", true),
        ("games/reading/chapter/annotations", "POST", true),
        ("games/annotations?view=reader&chapterId=chapter", "GET", false),
        ("games/reading/chapter/annotations?user=B", "GET", false),
        ("games/reading/chapter/annotations/verse/extra", "GET", false),
        ("games/reading/chapter/annotations/verse", "POST", false),
        ("games/reading/chapter/annotations", "PUT", false),
        ("games/ak-solo/run/1/audio/playback", "GET", true),
        ("games/ak-live/ABCDE/12/audio/playback", "GET", true),
        ("games/reading/chapter/audio/playback", "GET", true),
        ("games/intro-solo/run/0/audio/playback", "GET", true),
        ("games/intro-live/ABCDE/14/audio/playback", "GET", true),
        ("games/ak-solo/run/1/audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/stream", "GET", false),
        ("games/reading/chapter/audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/stream", "GET", false),
        ("games/intro-solo/run/01/audio/playback", "GET", false),
        ("games/intro-live/ABCDE/500/audio/playback", "GET", false),
        ("games/reading/chapter/audio/playback?token=x", "GET", false),
        ("games/reading/chapter/audio/../../playback", "GET", false),
        ("games/reading/chapter/audio/playback", "POST", false),
        ("games/reading/chapter/audio/playback", "HEAD", false),
        ("games/kompas/state", "GET", true),
        ("games/kompas/state", "POST", true),
        ("games/open-actions", "GET", true),
        ("games/nudges", "POST", true),
        ("games/group-invites/synthetic", "POST", true),
        ("games/friends/synthetic/accept", "POST", true),
        ("games/friends/synthetic/decline", "POST", true),
        ("games/reading-sessions", "POST", true),
        ("games/chapters/synthetic/read", "POST", true),
        ("games/chapters/synthetic/submit", "POST", true),
        ("games/exercises/synthetic/check", "POST", true),
        ("games/study/synthetic/units", "GET", true),
        ("games/activity-status", "GET", true),
        ("games/alleskenner/seasons/synthetic/evenings", "POST", true),
        ("games/alleskenner/seasons/synthetic/finale", "POST", true),
        ("games/alleskenner/seasons/synthetic/members", "POST", true),
        ("games/alleskenner/seasons/synthetic/members", "DELETE", true),
        ("games/alleskenner/seasons/synthetic", "GET", true),
        ("games/alleskenner/seasons/synthetic", "PATCH", true),
        ("games/alleskenner/seasons", "GET", true),
        ("games/alleskenner/seasons", "POST", true),
        ("games/alleskenner/solo", "GET", true),
        ("games/alleskenner/solo", "POST", true),
        ("games/challenges/synthetic/accept", "POST", true),
        ("games/challenges/synthetic/cancel", "POST", true),
        ("games/challenges/synthetic/decline", "POST", true),
        ("games/challenges/synthetic/forfeit", "POST", true),
        ("games/challenges", "GET", true),
        ("games/challenges", "POST", true),
        ("games/chapter-guess/synthetic/answer", "POST", true),
        ("games/chapter-guess/synthetic/forfeit", "POST", true),
        ("games/chapter-guess/synthetic/hint", "POST", true),
        ("games/chapter-guess/synthetic", "GET", true),
        ("games/chapter-guess/start", "POST", true),
        ("games/chapters", "GET", true),
        ("games/dictionary/synthetic", "GET", true),
        ("games/exercises/synthetic/hint", "GET", true),
        ("games/exercises/synthetic/hint", "POST", true),
        ("games/feedback/exercise", "POST", true),
        ("games/friends/recent", "GET", true),
        ("games/friends/request", "POST", true),
        ("games/friends/profiles/synthetic", "GET", true),
        ("games/friends/synthetic", "DELETE", true),
        ("games/friend-streaks/synthetic", "POST", true),
        ("games/friend-streaks", "GET", true),
        ("games/friend-streaks", "POST", true),
        ("games/freezes/gift", "POST", true),
        ("games/friends", "GET", true),
        ("games/hints", "GET", true),
        ("games/jigsaw-v2", "POST", true),
        ("games/jigsaw", "POST", true),
        ("games/list-order?listKey=games", "GET", true),
        ("games/list-order", "PUT", true),
        ("games/live/synthetic", "GET", true),
        ("games/live/create-alleskenner", "POST", true),
        ("games/live/create-chapter-guess", "POST", true),
        ("games/live/create-family-game", "POST", true),
        ("games/live/create", "POST", true),
        ("games/mysteries/attempts", "GET", true),
        ("games/mysteries/attempts", "POST", true),
        ("games/puzzle/coop", "POST", true),
        ("games/puzzle/history", "GET", true),
        ("games/puzzle/leaderboard", "GET", true),
        ("games/puzzle/match", "POST", true),
        ("games/puzzle/overview", "GET", true),
        ("games/puzzle/records", "GET", true),
        ("games/scrabble/synthetic/accept", "POST", true),
        ("games/scrabble/synthetic/cancel", "POST", true),
        ("games/scrabble/synthetic/decline", "POST", true),
        ("games/scrabble/synthetic/exchange", "POST", true),
        ("games/scrabble/synthetic/forfeit", "POST", true),
        ("games/scrabble/synthetic/hint", "POST", true),
        ("games/scrabble/synthetic/move", "POST", true),
        ("games/scrabble/synthetic/pass", "POST", true),
        ("games/scrabble/synthetic", "GET", true),
        ("games/scrabble", "GET", true),
        ("games/scrabble", "POST", true),
        ("games/shop/freezes", "POST", true),
        ("games/shop/genees", "POST", true),
        ("games/shop/hints", "POST", true),
        ("games/shop", "GET", true),
        ("games/snelle-zendeling/leaderboard", "GET", true),
        ("games/snelle-zendeling/runs/synthetic/death", "POST", true),
        ("games/snelle-zendeling/runs/synthetic/finish", "POST", true),
        ("games/snelle-zendeling/runs/synthetic/genees", "POST", true),
        ("games/snelle-zendeling/runs/synthetic/resume", "POST", true),
        ("games/snelle-zendeling/runs/synthetic/revive/answer", "POST", true),
        ("games/snelle-zendeling/runs/synthetic/revive", "POST", true),
        ("games/snelle-zendeling/runs/synthetic", "GET", true),
        ("games/snelle-zendeling/runs", "POST", true),
        ("games/snelle-zendeling/together", "POST", true),
        ("games/courses/synthetic/subscribe", "POST", true),
        ("games/courses/synthetic/unsubscribe", "POST", true),
        ("games/streak", "GET", true),
        ("games/xp-history", "GET", true),
        ("games/leaderboard", "GET", true),
        ("games/streak/celebration", "POST", true),
        ("games/streak/celebration", "GET", true),
        ("games/streak/continuation", "GET", true),
        ("games/streak/continuation", "POST", true),
        ("games/users/avatars", "GET", true),
        ("games/users/search", "GET", true),
        ("games/word-game/guess", "POST", true),
        ("games/word-game/hint", "POST", true),
        ("games/word-game/ranking", "GET", true),
        ("games/word-game", "GET", true),
        ("games/word-search/synthetic/find", "POST", true),
        ("games/word-search/synthetic/give-up", "POST", true),
        ("games/word-search/synthetic", "GET", true),
        ("games/word-search", "GET", true),
        ("games/word-search", "POST", true),
        ("games/page?route=%2Fshop", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.jigsaw", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.word-search", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.word-game", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.scrabble", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.alleskenner", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.gezinsavond", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.chapter-guess", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.challenges", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.quick-missionary", "GET", true),
        ("games/page?route=%2Fkompas%2Fplay.mystery", "GET", true),
        ("games/page?route=%2Facties", "GET", true),
        ("games/page?route=%2Flesson%2Fsynthetic", "GET", true),
        ("games/page?route=%2Falleskenner%2Falleen%2Fsynthetic", "GET", true),
        ("games/page?route=%2Falleskenner%2Falleen", "GET", true),
        ("games/page?route=%2Falleskenner", "GET", true),
        ("games/page?route=%2Falleskenner%2Fseizoen%2Fsynthetic", "GET", true),
        ("games/page?route=%2Falleskenner%2Fseizoen", "GET", true),
        ("games/page?route=%2Fchallenges", "GET", true),
        ("games/page?route=%2Fchapter-guess", "GET", true),
        ("games/page?route=%2Fchapter-guess%2Fsolo%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fgezinsavond", "GET", true),
        ("games/page?route=%2Fjigsaw%2Fafgerond", "GET", true),
        ("games/page?route=%2Fjigsaw", "GET", true),
        ("games/page?route=%2Fjigsaw%2Frecords%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fjigsaw%2Frecords", "GET", true),
        ("games/page?route=%2Fjigsaw%2Fsamen%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fjigsaw%2Fwedstrijd%2Fsynthetic", "GET", true),
        ("games/page?route=%2Flive%2Fsynthetic", "GET", true),
        ("games/page?route=%2Flive", "GET", true),
        ("games/page?route=%2Fmysteries%2F001", "GET", true),
        ("games/page?route=%2Fmysteries%2F001a", "GET", true),
        ("games/page?route=%2Fmysteries%2F001a%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F001b", "GET", true),
        ("games/page?route=%2Fmysteries%2F001b%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F001c", "GET", true),
        ("games/page?route=%2Fmysteries%2F001c%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F002", "GET", true),
        ("games/page?route=%2Fmysteries%2F002a", "GET", true),
        ("games/page?route=%2Fmysteries%2F002a%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F002b", "GET", true),
        ("games/page?route=%2Fmysteries%2F002b%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F002c", "GET", true),
        ("games/page?route=%2Fmysteries%2F002c%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F003", "GET", true),
        ("games/page?route=%2Fmysteries%2F003a", "GET", true),
        ("games/page?route=%2Fmysteries%2F003a%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F003b", "GET", true),
        ("games/page?route=%2Fmysteries%2F003b%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F003c", "GET", true),
        ("games/page?route=%2Fmysteries%2F003c%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F004", "GET", true),
        ("games/page?route=%2Fmysteries%2F004a", "GET", true),
        ("games/page?route=%2Fmysteries%2F004a%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F004b", "GET", true),
        ("games/page?route=%2Fmysteries%2F004b%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F004c", "GET", true),
        ("games/page?route=%2Fmysteries%2F004c%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F005", "GET", true),
        ("games/page?route=%2Fmysteries%2F005a", "GET", true),
        ("games/page?route=%2Fmysteries%2F005a%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F005b", "GET", true),
        ("games/page?route=%2Fmysteries%2F005b%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F005c", "GET", true),
        ("games/page?route=%2Fmysteries%2F005c%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F006", "GET", true),
        ("games/page?route=%2Fmysteries%2F006a", "GET", true),
        ("games/page?route=%2Fmysteries%2F006a%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F006b", "GET", true),
        ("games/page?route=%2Fmysteries%2F006b%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries%2F006c", "GET", true),
        ("games/page?route=%2Fmysteries%2F006c%2Fplay", "GET", true),
        ("games/page?route=%2Fmysteries", "GET", true),
        ("games/page?route=%2Fscrabble%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fscrabble", "GET", true),
        ("games/page?route=%2Fsnelle-zendeling", "GET", true),
        ("games/page?route=%2Fsnelle-zendeling%2Frun%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fsnelle-zendeling%2Fsamen%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fword-game", "GET", true),
        ("games/page?route=%2Fword-search%2Fsynthetic", "GET", true),
        ("games/page?route=%2Fword-search", "GET", true),
        ("games/page?route=%2Flive%3Fkompas%3Dplay", "GET", true),
        ("games/page?route=%2Flive%3Fkompas%3Dadmin", "GET", false),
        ("games/page?route=%2Facties%3Ftab%3Dcontinue", "GET", true),
        ("games/page?route=%2Facties%3Ftab%3Dforeign", "GET", false),
        ("games/page?route=%2Fsnelle-zendeling%3Fview%3Dleaderboard", "GET", true),
        ("games/page?route=%2Flive%3Favailability%3Dunavailable", "GET", true),
        ("games/page?route=%2Fmysteries%2F001a%2Fplay%3Fresume%3Dcompleted", "GET", true),
        ("games/dictionary/%C3%89CRIT", "GET", true),
        ("games/users/search?q=Jan%2342", "GET", true),
        ("games/page", "GET", false),
        ("games/page?route=%2Fadminbackend", "GET", false),
        ("games/page?route=%2Flive&route=%2Fword-game", "GET", false),
        ("games/page?route=https%3A%2F%2Fevil.invalid", "GET", false),
        ("games/page?route=%2Flive%3Ftoken%3Dx", "GET", false),
        ("games/admin/users", "GET", false),
        ("games/auth/login", "GET", false),
        ("games/../profile", "GET", false),
        ("games/%2e%2e/profile", "GET", false),
        ("games/word-game?token=synthetic", "GET", false),
        ("games/word-game?url=https://evil.invalid", "GET", false),
        ("games/users/search?q=a&q=b", "GET", false),
        ("games/dictionary/%2Fadmin", "GET", false),
        ("games/dictionary/%252Fadmin", "GET", false),
        ("games/word-game#x", "GET", false),
        ("games/word-game\n", "GET", false),
        ("games/users/search?q=%ZZ", "GET", false),
        ("games/word-game", "DELETE", false),
        ("games/page?route=%2Flive", "POST", false)
    ]
    for (path, method, expected) in cases { if NativeAccessPolicy.routeAllowed(path, method) != expected { fatalError("Spelpolicy verschilt voor " + method + " " + path) } }
}
// END GAME REQUEST CASES
