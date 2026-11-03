import Foundation
import Darwin
import AVFoundation
import UniformTypeIdentifiers

struct NativeAudioFailure: Error { let code: String; init(_ code: String = "audio_transport_unavailable") { self.code = code } }
/** Alleen native interne constructie. PR1 registreert geen pluginmethode of JS-setter. */
final class NativeAudioLifetime {
    private let lock = NSRecursiveLock()
    private let deadline: TimeInterval
    private let clock: () -> TimeInterval
    private var stopped = false
    private var callbacks: [UUID: () -> Void] = [:]
    private static let secondsPerTick: Double = {
        var info = mach_timebase_info_data_t(); mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom) / 1_000_000_000
    }()
    static func continuousTime() -> TimeInterval { Double(mach_continuous_time()) * secondsPerTick }
    init(validFor: TimeInterval, now: @escaping () -> TimeInterval = { NativeAudioLifetime.continuousTime() }) {
        clock = now; deadline = now() + max(0, min(validFor, 300))
    }
    var current: Bool { lock.lock(); defer { lock.unlock() }; return !stopped && clock() < deadline }
    func observe(_ callback: @escaping () -> Void) -> UUID {
        let id = UUID(); lock.lock()
        let valid = !stopped && clock() < deadline
        if valid { callbacks[id] = callback }; lock.unlock()
        if !valid { callback() }; return id
    }
    func deliver<T>(_ action: () -> T) -> T? {
        lock.lock(); defer { lock.unlock() }
        guard !stopped, clock() < deadline else { return nil }
        return action()
    }
    func remove(_ id: UUID) { lock.lock(); callbacks.removeValue(forKey: id); lock.unlock() }
    func invalidate() { lock.lock(); stopped = true; let pending = Array(callbacks.values); callbacks.removeAll(); lock.unlock(); pending.forEach { $0() } }
}
struct NativeAudioSourceRequest {
    let path: String, authorization: String, credentials: NativeAccessCredentials
    let byteSize: Int64
    init(path: String, authorization: String, credentials: NativeAccessCredentials, byteSize: Int64) throws {
        guard path.range(of: "\\Acourses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/audio/[a-f0-9]{64}/stream\\z", options: .regularExpression) != nil,
              authorization.range(of: "\\ABearer [A-Za-z0-9._~-]{1,2040}\\z", options: .regularExpression) != nil,
              byteSize > 0, byteSize <= 256 * 1024 * 1024 else { throw NativeAudioFailure() }
        self.path = path; self.authorization = authorization; self.credentials = credentials; self.byteSize = byteSize
    }
}
/** Ephemeral, begrensd, geen redirects/cookies/cache, nooit een MP3 naar JS. */
final class NativeAudioRangeRequest: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    static let maxBytes = 256 * 1024
    private let source: NativeAudioSourceRequest, lifetime: NativeAudioLifetime
    private let offset: Int64, length: Int
    private let queue = DispatchQueue(label: "app.versado.audio.range")
    private var session: URLSession?, observer: UUID?, received = Data(), accepted = false
    private var completion: ((Result<Data, NativeAudioFailure>) -> Void)?
    init(source: NativeAudioSourceRequest, lifetime: NativeAudioLifetime, offset: Int64, length: Int, completion: @escaping (Result<Data, NativeAudioFailure>) -> Void) throws {
        guard offset >= 0, offset < source.byteSize, length > 0, length <= Self.maxBytes, Int64(length) <= source.byteSize - offset else { throw NativeAudioFailure() }
        self.source = source; self.lifetime = lifetime; self.offset = offset; self.length = length; self.completion = completion
    }
    func start(configuration: URLSessionConfiguration = .ephemeral) {
        queue.async {
            guard self.lifetime.current, self.session == nil, self.completion != nil else { self.finish(.failure(NativeAudioFailure())); return }
            self.observer = self.lifetime.observe { [weak self] in self?.cancel() }
            configuration.urlCache = nil; configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData; configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
            let delegateQueue = OperationQueue(); delegateQueue.maxConcurrentOperationCount = 1; delegateQueue.underlyingQueue = self.queue
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue); self.session = session
            var request = URLRequest(url: URL(string: NativeAccessPolicy.origin + "/api/v1/native/" + self.source.path)!)
            request.httpShouldHandleCookies = false
            for (key, value) in ["Origin": "capacitor://localhost", "X-Versado-Client": "native-v1", "Accept": "audio/mpeg", "Accept-Encoding": "identity", "Authorization": self.source.authorization, "CF-Access-Client-Id": self.source.credentials.id, "CF-Access-Client-Secret": self.source.credentials.secret, "Range": "bytes=\(self.offset)-\(self.offset + Int64(self.length) - 1)"] { request.setValue(value, forHTTPHeaderField: key) }
            session.dataTask(with: request).resume()
        }
    }
    func cancel() { queue.async { self.finish(.failure(NativeAudioFailure("audio_cancelled"))) } }
    private func finish(_ result: Result<Data, NativeAudioFailure>) {
        guard let callback = completion else { return }; completion = nil
        if let observer = observer { lifetime.remove(observer) }; observer = nil
        received.removeAll(keepingCapacity: false); session?.invalidateAndCancel(); session = nil
        let delivered = lifetime.deliver { callback(result); return true } ?? false
        if !delivered { callback(.failure(NativeAudioFailure("audio_changed"))) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil); finish(.failure(NativeAudioFailure("audio_redirect_blocked"))) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard lifetime.current, let response = response as? HTTPURLResponse,
              response.statusCode == 206, response.mimeType?.lowercased() == "audio/mpeg",
              response.value(forHTTPHeaderField: "Access-Control-Allow-Origin") == "capacitor://localhost",
              [nil, "identity"].contains(response.value(forHTTPHeaderField: "Content-Encoding")?.lowercased()),
              response.value(forHTTPHeaderField: "Content-Range") == "bytes \(offset)-\(offset + Int64(length) - 1)/\(source.byteSize)",
              response.expectedContentLength == Int64(length) else { completionHandler(.cancel); finish(.failure(NativeAudioFailure())); return }
        accepted = true; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard lifetime.current, accepted, received.count + data.count <= length else { finish(.failure(NativeAudioFailure())); return }
        received.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard completion != nil else { return }
        guard error == nil, accepted, received.count == length else { finish(.failure(NativeAudioFailure())); return }
        finish(.success(received))
    }
}

/** AVFoundation krijgt een eigen scheme, geen URL met headers/tokens. De eigenaar
 * moet deze wrapper vasthouden zolang AVPlayer de asset gebruikt. Nog inactief in PR1. */
final class NativeAudioAsset: NSObject, AVAssetResourceLoaderDelegate {
    let asset: AVURLAsset
    private let source: NativeAudioSourceRequest, lifetime: NativeAudioLifetime
    private let configuration: () -> URLSessionConfiguration
    private let queue = DispatchQueue(label: "app.versado.audio.asset")
    private var pending: [ObjectIdentifier: NativeAudioRangeRequest] = [:]
    private var observer: UUID?
    init(source: NativeAudioSourceRequest, lifetime: NativeAudioLifetime, configuration: @escaping () -> URLSessionConfiguration = { .ephemeral }) {
        self.source = source; self.lifetime = lifetime; self.configuration = configuration
        self.asset = AVURLAsset(url: URL(string: "versado-audio://source/" + String(source.path.split(separator: "/").dropLast().last!) + ".mp3")!)
        super.init(); asset.resourceLoader.setDelegate(self, queue: queue)
        observer = lifetime.observe { [weak self] in self?.cancel() }
    }
    func cancel() { lifetime.invalidate(); queue.async { let requests = Array(self.pending.values); self.pending.removeAll(); requests.forEach { $0.cancel() }; self.asset.cancelLoading() } }
    deinit { if let observer = observer { lifetime.remove(observer) } }
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
        guard lifetime.current, request.request.url == asset.url, pending.count < 4 else { request.finishLoading(with: NativeAudioFailure()); return false }
        if let info = request.contentInformationRequest { info.contentType = UTType.mp3.identifier; info.contentLength = source.byteSize; info.isByteRangeAccessSupported = true }
        guard let data = request.dataRequest else { request.finishLoading(); return true }
        let start = max(data.requestedOffset, data.currentOffset)
        guard data.requestedOffset >= 0, start >= 0, start <= source.byteSize, data.requestedLength >= 0,
              Int64(data.requestedLength) <= Int64.max - data.requestedOffset else { request.finishLoading(with: NativeAudioFailure()); return false }
        let end = data.requestsAllDataToEndOfResource ? source.byteSize : min(source.byteSize, data.requestedOffset + Int64(data.requestedLength))
        load(request, offset: start, end: end); return true
    }
    private func load(_ loading: AVAssetResourceLoadingRequest, offset: Int64, end: Int64) {
        let id = ObjectIdentifier(loading)
        guard lifetime.current, !loading.isCancelled else { pending.removeValue(forKey: id); loading.finishLoading(with: NativeAudioFailure("audio_changed")); return }
        if offset >= end { pending.removeValue(forKey: id); loading.finishLoading(); return }
        do {
            let request = try NativeAudioRangeRequest(source: source, lifetime: lifetime, offset: offset, length: Int(min(Int64(64 * 1024), end - offset))) { [weak self, weak loading] result in
                guard let self = self, let loading = loading else { return }
                self.queue.async {
                    guard self.pending[id] != nil, !loading.isCancelled else { return }
                    guard self.lifetime.current else { self.pending.removeValue(forKey: id); loading.finishLoading(with: NativeAudioFailure("audio_changed")); return }
                    switch result {
                    case .success(let bytes):
                        let delivered = self.lifetime.deliver { () -> Bool in
                            guard let data = loading.dataRequest, !loading.isCancelled else { return false }
                            data.respond(with: bytes); return true
                        } ?? false
                        guard delivered else { self.pending.removeValue(forKey: id); loading.finishLoading(with: NativeAudioFailure("audio_changed")); return }
                        self.load(loading, offset: offset + Int64(bytes.count), end: end)
                    case .failure(let error): self.pending.removeValue(forKey: id); loading.finishLoading(with: error)
                    }
                }
            }
            pending[id] = request; request.start(configuration: configuration())
        } catch { pending.removeValue(forKey: id); loading.finishLoading(with: NativeAudioFailure()) }
    }
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) { pending.removeValue(forKey: ObjectIdentifier(loadingRequest))?.cancel() }
}
