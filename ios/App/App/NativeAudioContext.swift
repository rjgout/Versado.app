import Foundation
import CryptoKit

/** Alleen selectie-identiteit; deze waarden verlenen zelf geen toegang. */
struct NativeAudioScope: Decodable, Equatable {
    let version: Int, userId: String, activeCollectionId: String, selectionVersion: Int, language: String
    let courseId: String, kind: String, targetId: String, chapterId: String, startVerse: Int, endVerse: Int
    var path: String { "courses/\(courseId)/read/\(kind)/\(targetId)/audio/playback" }
    func validate() throws {
        guard version == 1, selectionVersion >= 0, ["nl","en","de","fr","es"].contains(language),
              [userId,activeCollectionId,courseId,targetId,chapterId].allSatisfy({ NativeAudioContext.id($0) }),
              ["steps","chapters"].contains(kind), startVerse >= 1, endVerse >= startVerse, endVerse <= 500 else { throw NativeAudioFailure() }
    }
}
struct NativeAudioText: Decodable { let id: String, number: Int, text: String }
struct NativeAudioSegment: Decodable { let number: Int, start: Double; let end: Double? }
struct NativeAudioRecording: Decodable {
    let id: String, kind: String, language: String, audioChapterId: String, collectionId: String, sha256: String
    let byteSize: Int64, start: Double, end: Double?, verses: [NativeAudioSegment], fallbackFor: String?
    func validate(scope: NativeAudioScope) throws {
        guard NativeAudioContext.hash(id), NativeAudioContext.hash(sha256), ["recording","legacy"].contains(kind),
              NativeAudioContext.language(language), NativeAudioContext.id(audioChapterId), NativeAudioContext.id(collectionId),
              byteSize > 0, byteSize <= 256 * 1024 * 1024, verses.count == scope.endVerse - scope.startVerse + 1,
              start == verses.first?.start, end == verses.last?.end, fallbackFor == nil || NativeAudioContext.hash(fallbackFor!) else { throw NativeAudioFailure() }
        for (index, verse) in verses.enumerated() {
            guard verse.number == scope.startVerse + index, verse.start.isFinite, verse.start >= 0,
                  verse.end == nil || (verse.end!.isFinite && verse.end! > verse.start),
                  index == 0 || (verses[index-1].end != nil && verses[index-1].end! <= verse.start) else { throw NativeAudioFailure() }
        }
    }
}
struct NativeAudioCataloguePayload: Decodable {
    let scope: NativeAudioScope, sessionId: String, readerHash: String, sourceLanguage: String
    let serverTime: Double, maxAgeMs: Int, sources: [NativeAudioRecording]
    enum Keys: String, CodingKey { case sessionId, readerHash, sourceLanguage, serverTime, maxAgeMs, sources }
    init(from decoder: Decoder) throws {
        scope = try NativeAudioScope(from: decoder); let c = try decoder.container(keyedBy: Keys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId); readerHash = try c.decode(String.self, forKey: .readerHash)
        sourceLanguage = try c.decode(String.self, forKey: .sourceLanguage); serverTime = try c.decode(Double.self, forKey: .serverTime)
        maxAgeMs = try c.decode(Int.self, forKey: .maxAgeMs); sources = try c.decode([NativeAudioRecording].self, forKey: .sources)
    }
}
struct NativeAudioReaderPayload: Decodable {
    let scope: NativeAudioScope, sourceLanguage: String, bookName: String, chapterNumber: Int, verses: [NativeAudioText]
    enum Keys: String, CodingKey { case sourceLanguage, bookName, chapterNumber, verses }
    init(from decoder: Decoder) throws {
        scope = try NativeAudioScope(from: decoder); let c = try decoder.container(keyedBy: Keys.self)
        sourceLanguage = try c.decode(String.self, forKey: .sourceLanguage); bookName = try c.decode(String.self, forKey: .bookName)
        chapterNumber = try c.decode(Int.self, forKey: .chapterNumber); verses = try c.decode([NativeAudioText].self, forKey: .verses)
    }
}
struct NativeAudioPlaybackPayload: Decodable {
    let version: Int, audio: NativeAudioCataloguePayload, reader: NativeAudioReaderPayload
    func validate() throws {
        try audio.scope.validate()
        guard version == 1, audio.scope == reader.scope, NativeAudioContext.id(audio.sessionId), NativeAudioContext.hash(audio.readerHash),
              audio.maxAgeMs == 300000, audio.serverTime.isFinite, audio.serverTime > 0,
              NativeAudioContext.language(audio.sourceLanguage), audio.sourceLanguage == reader.sourceLanguage,
              reader.chapterNumber > 0, !reader.bookName.isEmpty, reader.bookName.utf8.count <= 1024,
              reader.verses.count == reader.scope.endVerse - reader.scope.startVerse + 1, Set(reader.verses.map { $0.id }).count == reader.verses.count, audio.sources.count <= 10,
              Set(audio.sources.map { $0.id }).count == audio.sources.count else { throw NativeAudioFailure() }
        for (index, verse) in reader.verses.enumerated() {
            guard NativeAudioContext.id(verse.id), verse.number == reader.scope.startVerse + index, !verse.text.isEmpty, verse.text.count <= 20000 else { throw NativeAudioFailure() }
        }
        for recording in audio.sources { try recording.validate(scope: audio.scope) }
    }
}
struct NativeAudioClaims: Decodable, Equatable {
    let userId: String, sid: String, version: Int, purpose: String, iss: String, aud: String, exp: Double
    static func parse(_ token: String) throws -> NativeAudioClaims {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard token.utf8.count <= 2048, parts.count == 3 else { throw NativeAudioFailure() }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let bytes = Data(base64Encoded: encoded) else { throw NativeAudioFailure() }
        let value = try JSONDecoder().decode(NativeAudioClaims.self, from: bytes)
        guard value.purpose == "native-access", value.iss == "versado-native-v1", value.aud == "versado-native-v1",
              value.version >= 0, value.exp.isFinite, value.exp > 0, NativeAudioContext.id(value.userId), UUID(uuidString: value.sid) != nil else { throw NativeAudioFailure() }
        return value
    }
    func sameSession(_ other: NativeAudioClaims) -> Bool { userId == other.userId && sid == other.sid && version == other.version }
}
final class NativeAudioCapsule {
    let payload: NativeAudioPlaybackPayload, sourceAuthorization: String, credentials: NativeAccessCredentials?, lifetime: NativeAudioLifetime
    let startedAt: TimeInterval, validFor: TimeInterval
    private let clock: () -> TimeInterval
    var remaining: TimeInterval { max(0, validFor - (clock() - startedAt)) }
    init(payload: NativeAudioPlaybackPayload, token: String, credentials: NativeAccessCredentials?, startedAt: TimeInterval, now: TimeInterval, clock: @escaping () -> TimeInterval = { NativeAudioLifetime.continuousTime() }) throws {
        let claims = try NativeAudioClaims.parse(token)
        guard claims.userId == payload.audio.scope.userId, claims.sid == payload.audio.sessionId else { throw NativeAudioFailure() }
        let remaining = min(300, claims.exp - payload.audio.serverTime / 1000) - max(0, now - startedAt) - 3
        guard remaining > 1 else { throw NativeAudioFailure("audio_expired") }
        self.payload = payload; self.credentials = credentials; self.startedAt = now; self.validFor = remaining
        self.clock = clock; self.sourceAuthorization = "Bearer " + token; lifetime = NativeAudioLifetime(validFor: remaining, now: clock)
    }
    func request(_ id: String) throws -> NativeAudioSourceRequest {
        guard lifetime.current, let source = payload.audio.sources.first(where: { $0.id == id }) else { throw NativeAudioFailure() }
        let path = payload.audio.scope.path.replacingOccurrences(of: "/audio/playback", with: "/audio/" + source.id + "/stream")
        return try NativeAudioSourceRequest(path: path, authorization: sourceAuthorization, credentials: credentials, byteSize: source.byteSize)
    }
}
/** Alleen native HTTPS-responses kunnen een anchor/capsule vullen. Alle methoden
 * draaien op de eigenaarqueue (de plugin gebruikt de main queue), nooit vanuit JS setters. */
final class NativeAudioContext {
    struct Tag { let stamp: String; let session: Int; let context: Int }
    private struct Pending { let token: String; let refreshHash: String; let claims: NativeAudioClaims; let tag: Tag }
    private(set) var stamp: String?, sessionEpoch = 0, contextEpoch = 0
    private(set) var capsule: NativeAudioCapsule?
    private(set) var owner: String?
    private(set) var foreground = true
    private var pending: Pending?, anchor: (token: String, claims: NativeAudioClaims)?
    private var expected: NativeAudioScope?
    private let clock: () -> TimeInterval
    init(clock: @escaping () -> TimeInterval = { NativeAudioLifetime.continuousTime() }) { self.clock = clock }
    var anchored: Bool { anchor != nil }
    var onInvalidated: (() -> Void)?
    private static func refreshHash(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
    static func id(_ value: String) -> Bool { value.range(of: "\\A[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil }
    static func hash(_ value: String) -> Bool { value.range(of: "\\A[a-f0-9]{64}\\z", options: .regularExpression) != nil }
    static func language(_ value: String) -> Bool { ["nl","en","de","fr","es"].contains(value) }
    func reset(_ nextStamp: String?, clearAnchor: Bool = true) { sessionEpoch += 1; pending = nil; if clearAnchor { anchor = nil }; stamp = nextStamp; select(nil) }
    func select(_ scope: NativeAudioScope?, owner: String? = nil) {
        if let scope = scope, scope == expected, owner == self.owner { return }
        self.owner = owner
        contextEpoch += 1; capsule?.lifetime.invalidate(); capsule = nil; expected = scope; onInvalidated?()
    }
    func forget(_ owner: String) { if self.owner == owner { select(nil) } }
    func invalidate() { contextEpoch += 1; capsule?.lifetime.invalidate(); capsule = nil; onInvalidated?() }
    func setForeground(_ active: Bool) { guard foreground != active else { return }; foreground = active; suspend() }
    func accessFailed(_ tag: Tag?) { if let tag = tag, current(tag) { suspend() } }
    func suspend() { sessionEpoch += 1; pending = nil; invalidate() }
    func tag(_ requestStamp: String?) -> Tag? { guard let stamp = stamp, requestStamp == stamp else { return nil }; return Tag(stamp: stamp, session: sessionEpoch, context: contextEpoch) }
    private func current(_ tag: Tag) -> Bool { tag.stamp == stamp && tag.session == sessionEpoch }
    func stage(path: String, status: Int, body: String, tag: Tag?) {
        guard foreground, let tag = tag, current(tag), status == 200, ["login","refresh","apple/complete","security-setup/complete"].contains(path),
              let bytes = body.data(using: .utf8), bytes.count <= 1048576,
              let value = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any], value["expiresIn"] as? Int == 300,
              let token = value["accessToken"] as? String, let refresh = value["refreshToken"] as? String,
              !refresh.isEmpty, refresh.utf8.count <= 128, let claims = try? NativeAudioClaims.parse(token) else { return }
        pending = Pending(token: token, refreshHash: Self.refreshHash(refresh), claims: claims, tag: tag)
    }
    /** Oude intrekkingsadministratie kan tijdens een nieuwe login veilig worden
     * opgeslagen. Zij mag een nieuw, nog niet gecommit antwoord niet wissen. */
    func storedClear() { anchor = nil; select(nil) }
    func saved(_ raw: String, success: Bool) {
        if !success {
            if let staged = pending, let bytes = raw.data(using: .utf8), let value = (try? JSONSerialization.jsonObject(with: bytes)) as? [String:Any], let refresh = value["refreshToken"] as? String, Self.refreshHash(refresh) == staged.refreshHash { pending = nil; invalidate() }
            return
        }
        guard let bytes = raw.data(using: .utf8), let value = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else { pending = nil; invalidate(); return }
        if value["logoutPending"] as? Bool == true { storedClear(); return }
        guard let staged = pending, current(staged.tag), let refresh = value["refreshToken"] as? String, Self.refreshHash(refresh) == staged.refreshHash else { return }
        if let anchor = anchor, !anchor.claims.sameSession(staged.claims) { select(nil) }
        anchor = (staged.token, staged.claims); pending = nil
    }
    /** Bekende serverweigering of bevestigde bronwissel stopt vóór JS-render.
     * Een netwerk-/streamfout wist nooit zelfstandig de Versado-sessie. */
    func observed(path: String, status: Int, body: String, authorization: String?, tag: Tag?) {
        guard let tag = tag, current(tag), tag.context == contextEpoch else { return }
        if path == "refresh", [400,401,403].contains(status) { suspend(); return }
        guard let expected = expected, let anchor = anchor, authorization == "Bearer " + anchor.token,
              let bytes = body.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else { return }
        if [401,403].contains(status), ["session_expired","session_changed","web_security_setup_required"].contains(root["error"] as? String ?? "") { invalidate(); return }
        if path == "content-context", status == 200 {
            let state = root["state"] as? [String: Any] ?? root
            if let picker = state["picker"] as? [String: Any], picker["activeCollectionId"] as? String != expected.activeCollectionId || picker["selectionVersion"] as? Int != expected.selectionVersion { invalidate() }
        }
        let readerPath = expected.path.replacingOccurrences(of: "/audio/playback", with: "")
        if path == readerPath || path == readerPath + "/resume" {
            guard status == 200 else { invalidate(); return }
            let data = root["reader"] as? [String: Any] ?? root
            guard let data = try? JSONSerialization.data(withJSONObject: data), let reader = try? JSONDecoder().decode(NativeAudioReaderPayload.self, from: data), reader.scope == expected else { invalidate(); return }
            if let capsule = capsule, reader.sourceLanguage != capsule.payload.reader.sourceLanguage || reader.verses.map({$0.id + "\u{0}" + $0.text}) != capsule.payload.reader.verses.map({$0.id + "\u{0}" + $0.text}) { invalidate() }
        }
    }
    @discardableResult func capture(path: String, status: Int, body: String, authorization: String?, credentials: NativeAccessCredentials?, tag: Tag?, startedAt: TimeInterval) throws -> Bool {
        guard foreground, let tag = tag, current(tag), tag.context == contextEpoch, let expected = expected,
              path == expected.path, let anchor = anchor, authorization == "Bearer " + anchor.token else { return false }
        guard status == 200 else { invalidate(); return false }
        guard let bytes = body.data(using: .utf8), bytes.count <= 1048576 else { invalidate(); throw NativeAudioFailure() }
        do {
        let value = try JSONDecoder().decode(NativeAudioPlaybackPayload.self, from: bytes); try value.validate()
        guard value.audio.scope == expected, value.audio.sessionId == anchor.claims.sid, value.audio.scope.userId == anchor.claims.userId else { throw NativeAudioFailure() }
        let fresh = try NativeAudioCapsule(payload: value, token: anchor.token, credentials: credentials, startedAt: startedAt, now: clock(), clock: clock)
        if let old = capsule, old.payload.audio.readerHash != value.audio.readerHash || old.payload.audio.sources.map({$0.id}) != value.audio.sources.map({$0.id}) { fresh.lifetime.invalidate(); throw NativeAudioFailure("audio_changed") }
        capsule = fresh
        // De eigenaar kiest bij vernieuwde autorisatie zelf een gecontroleerde
        // AVPlayer-rebind; invalidate pas ná het overnemen van de afspeelpositie.
        return true
        } catch { invalidate(); throw NativeAudioFailure("audio_changed") }
    }
}
