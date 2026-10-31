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
    static func perform(current: @escaping () -> Bool = { true }) throws -> Result<(Int, String), NativeAccessFailure> {
        let pair = try NativeAccessCredentials(id: "synthetic-device.access", secret: "synthetic-secret-for-native-tests")
        let done = DispatchSemaphore(value: 0); var result: Result<(Int, String), NativeAccessFailure>?
        let request = NativeAccessRequest(credentials: pair, isCurrent: current) { value in result = value; done.signal() }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [FakeAccessProtocol.self]
        request.start(path: "login", method: "POST", authorization: "Bearer synthetic.native", body: "{}", configuration: config)
        require(done.wait(timeout: .now() + 5) == .success, "native request timed out")
        return result!
    }
    static func failure(_ result: Result<(Int, String), NativeAccessFailure>, _ code: String) {
        if case .failure(let error) = result { require(error.code == code, "unexpected native error code") } else { fatalError("unsafe response accepted") }
    }
    static func main() throws {
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
