import Foundation

// Geen Capacitor/JavaScript-afhankelijkheid; dezelfde begrensde policy is apart native testbaar.
enum NativeAccessPolicy {
    static let origin = "https://dev.versado.app"
    static let maxBody = 16_384, maxResponse = 1_048_576
    static func profileAllowed(enabled: Bool, metadata: [String: Any]) -> Bool {
        enabled && metadata["profile"] as? String == "local-internal" && metadata["channel"] as? String == "internal" &&
        metadata["apiOrigin"] as? String == origin && metadata["compileProbe"] as? Bool == false && metadata["releaseApproved"] as? Bool == false
    }
    static func routeAllowed(_ path: String, _ method: String) -> Bool {
        let pattern: String
        switch method {
        case "GET": pattern = "(?:capabilities|me|today|chapters/[A-Za-z0-9_-]{1,128})"
        case "POST": pattern = "(?:login|register|forgot-password|reset-password|verify-email|refresh|logout|security-setup/(?:complete|cancel)|apple/(?:challenge|complete)|account/password|chapters/[A-Za-z0-9_-]{1,128}/complete)"
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
    private let credentials: NativeAccessCredentials
    private let isCurrent: () -> Bool
    private var completion: ((Result<(Int, String), NativeAccessFailure>) -> Void)?
    private var session: URLSession?
    private var bytes = Data(), status = 0
    init(credentials: NativeAccessCredentials, isCurrent: @escaping () -> Bool = { true }, completion: @escaping (Result<(Int, String), NativeAccessFailure>) -> Void) {
        self.credentials = credentials; self.isCurrent = isCurrent; self.completion = completion
    }
    func start(path: String, method: String, authorization: String?, body: String?, configuration: URLSessionConfiguration = .ephemeral) {
        guard isCurrent() else { finish(.failure(NativeAccessFailure("access_changed"))); return }
        guard NativeAccessPolicy.routeAllowed(path, method), (body?.utf8.count ?? 0) <= NativeAccessPolicy.maxBody,
              method != "GET" || body == nil,
              authorization == nil || authorization!.range(of: "\\ABearer [A-Za-z0-9._~-]{1,2040}\\z", options: .regularExpression) != nil,
              let url = URL(string: NativeAccessPolicy.origin + "/api/v1/native/" + path) else { finish(.failure(NativeAccessFailure("access_request_invalid"))); return }
        configuration.urlCache = nil; configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData; configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue); self.session = session
        var request = URLRequest(url: url); request.httpMethod = method; request.httpShouldHandleCookies = false
        request.setValue("capacitor://localhost", forHTTPHeaderField: "Origin"); request.setValue("native-v1", forHTTPHeaderField: "X-Versado-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(credentials.id, forHTTPHeaderField: "CF-Access-Client-Id"); request.setValue(credentials.secret, forHTTPHeaderField: "CF-Access-Client-Secret")
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
            completionHandler(.cancel); finish(.failure(NativeAccessFailure([401, 403].contains(status) ? "access_denied" : "access_invalid_response"))); return
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
              !NativeAccessPolicy.containsCredential(object, credentials), let text = String(data: bytes, encoding: .utf8) else { finish(.failure(NativeAccessFailure("access_invalid_response"))); return }
        finish(.success((status, text)))
    }
}
