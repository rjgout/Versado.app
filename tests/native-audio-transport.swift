import Foundation
import AVFoundation

private final class AudioFixtureProtocol: URLProtocol {
    static var bytes = Data(), status = 206, type = "audio/mpeg", encoding: String?, origin = "capacitor://localhost"
    static var wrongRange = false, shortBody = false, oversizedBody = false
    static var beforeReply: (() -> Void)?
    static var requests: [URLRequest] = []
    private static let lock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests.append(request); Self.lock.unlock()
        Self.beforeReply?()
        let parts = request.value(forHTTPHeaderField: "Range")!.dropFirst(6).split(separator: "-").map { Int($0)! }
        let start = parts[0], end = parts[1], length = end - start + 1
        var data = Self.bytes.subdata(in: start..<(end + 1))
        if Self.shortBody { data.removeLast() }; if Self.oversizedBody { data.append(0) }
        var headers = ["Content-Type": Self.type, "Content-Length": String(length), "Content-Range": "bytes \(start)-\(end)/\(Self.bytes.count + (Self.wrongRange ? 1 : 0))", "Access-Control-Allow-Origin": Self.origin]
        if let value = Self.encoding { headers["Content-Encoding"] = value }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
    static func reset() { status = 206; type = "audio/mpeg"; encoding = nil; origin = "capacitor://localhost"; wrongRange = false; shortBody = false; oversizedBody = false; beforeReply = nil; requests = [] }
}
private func configuration() -> URLSessionConfiguration { let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [AudioFixtureProtocol.self]; return c }
private func read(_ source: NativeAudioSourceRequest, _ life: NativeAudioLifetime, offset: Int64 = 0, length: Int = 100) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
        do { let request = try NativeAudioRangeRequest(source: source, lifetime: life, offset: offset, length: length) { continuation.resume(with: $0.mapError { $0 as Error }) }; request.start(configuration: configuration()) }
        catch { continuation.resume(throwing: error) }
    }
}
@main struct NativeAudioTests {
    static func main() async throws {
        AudioFixtureProtocol.bytes = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let credentials = try NativeAccessCredentials(id: "synthetic-client-id", secret: "synthetic-native-audio-secret-123456")
        let source = try NativeAudioSourceRequest(path: "courses/course/read/chapters/chapter/audio/" + String(repeating: "a", count: 64) + "/stream", authorization: "Bearer synthetic.native.token", credentials: credentials, byteSize: Int64(AudioFixtureProtocol.bytes.count))
        let life = NativeAudioLifetime(validFor: 120)
        let data = try await read(source, life)
        precondition(data == AudioFixtureProtocol.bytes.prefix(100))
        let request = AudioFixtureProtocol.requests.last!
        precondition(request.url!.host == "dev.versado.app" && request.url!.query == nil && request.value(forHTTPHeaderField: "Accept-Encoding") == "identity")
        precondition(request.value(forHTTPHeaderField: "CF-Access-Client-Secret") == credentials.secret && !request.url!.absoluteString.contains(credentials.secret))
        precondition(request.httpShouldHandleCookies == false && request.value(forHTTPHeaderField: "Cookie") == nil)
        for scenario in 0..<10 {
            AudioFixtureProtocol.reset()
            switch scenario {
            case 0: AudioFixtureProtocol.status = 200
            case 1: AudioFixtureProtocol.status = 302
            case 2: AudioFixtureProtocol.status = 401
            case 3: AudioFixtureProtocol.status = 416
            case 4: AudioFixtureProtocol.type = "text/html"
            case 5: AudioFixtureProtocol.encoding = "gzip"
            case 6: AudioFixtureProtocol.origin = "https://evil.invalid"
            case 7: AudioFixtureProtocol.wrongRange = true
            case 8: AudioFixtureProtocol.shortBody = true
            default: AudioFixtureProtocol.oversizedBody = true
            }
            do { _ = try await read(source, life); fatalError("Afwijkende respons werd toegelaten: \(scenario)") } catch is NativeAudioFailure { }
        }
        AudioFixtureProtocol.reset()
        let changed = NativeAudioLifetime(validFor: 120); AudioFixtureProtocol.beforeReply = { changed.invalidate() }
        do { _ = try await read(source, changed); fatalError("Laat antwoord na intrekking") } catch is NativeAudioFailure { }
        AudioFixtureProtocol.reset()
        let retired = NativeAudioLifetime(validFor: 0)
        do { _ = try await read(source, retired); fatalError("Verlopen lifetime") } catch is NativeAudioFailure { }
        precondition(AudioFixtureProtocol.requests.isEmpty)
        do { _ = try NativeAudioRangeRequest(source: source, lifetime: life, offset: 0, length: NativeAudioRangeRequest.maxBytes + 1) { _ in }; fatalError("Te grote range") } catch is NativeAudioFailure { }
        var instant: TimeInterval = 0
        let suspended = NativeAudioLifetime(validFor: 600, now: { instant })
        precondition(suspended.current); instant = 301; precondition(!suspended.current)
        precondition(suspended.deliver { true } == nil)
        let gate = NativeAudioLifetime(validFor: 120), entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0), started = DispatchSemaphore(value: 0), invalidated = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { _ = gate.deliver { entered.signal(); _ = release.wait(timeout: .now() + 5) }; finished.signal() }
        precondition(entered.wait(timeout: .now() + 5) == .success)
        DispatchQueue.global().async { started.signal(); gate.invalidate(); invalidated.signal() }
        precondition(started.wait(timeout: .now() + 5) == .success)
        precondition(invalidated.wait(timeout: .now() + 0.05) == .timedOut)
        release.signal(); precondition(finished.wait(timeout: .now() + 5) == .success); precondition(invalidated.wait(timeout: .now() + 5) == .success)
        precondition(gate.deliver { true } == nil)
        // Echte AVFoundation custom-scheme callbacks/MP3-demux, geen AVPlayer-
        // audio-uitvoer, Android-decoder, lockscreen of fysieke acceptatie.
        AudioFixtureProtocol.reset()
        let assetLife = NativeAudioLifetime(validFor: 120)
        let wrapper = NativeAudioAsset(source: source, lifetime: assetLife, configuration: configuration)
        let duration = try await withThrowingTaskGroup(of: CMTime.self) { group in
            group.addTask { try await wrapper.asset.load(.duration) }
            group.addTask { try await Task.sleep(nanoseconds: 20_000_000_000); wrapper.cancel(); throw NativeAudioFailure("fixture_timeout") }
            defer { group.cancelAll() }; return try await group.next()!
        }
        precondition(duration.seconds > 29 && duration.seconds < 31)
        precondition(!AudioFixtureProtocol.requests.isEmpty)
        precondition(AudioFixtureProtocol.requests.allSatisfy { request in
            guard let range = request.value(forHTTPHeaderField: "Range") else { return false }
            let bounds = range.dropFirst(6).split(separator: "-").compactMap { Int($0) }
            return bounds.count == 2 && bounds[1] - bounds[0] < NativeAudioRangeRequest.maxBytes
        })
        wrapper.cancel(); precondition(!assetLife.current)
        print("Native audio: begrensde URLSession-ranges, header-/statusfouten, late intrekking en echte AVFoundation resource-loader/MP3-duur geslaagd; geen fysieke acceptatie.")
    }
}
