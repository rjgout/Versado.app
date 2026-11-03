import Foundation
import AVFoundation

/** Eén native uitvoer achter de gedeelde React-speler. Geen eigen contentkeuze,
 * voortgang of refresh. De eigenaar roept alle methoden op de main queue aan. */
final class NativeAudioPlayer: NSObject, AVSpeechSynthesizerDelegate {
    private let context: NativeAudioContext
    var emit: ([String: Any]) -> Void = { _ in }
    private let speech = AVSpeechSynthesizer()
    private var player: AVPlayer?, asset: NativeAudioAsset?, active: NativeAudioCapsule?
    private var observer: UUID?, childLife: NativeAudioLifetime?, timeObserver: Any?, itemObservation: NSKeyValueObservation?, ended: NSObjectProtocol?
    private var timer: DispatchSourceTimer?, notifications: [NSObjectProtocol] = []
    private var command: String?, recording: String?, voice: String?, generation = 0, index = 0
    private var speed: Float = 1, playing = false, finished = false, renewalSignalled = false, triedFallback = false
    private var speechItem: AVSpeechUtterance?
    private var seekVersion = 0, pendingSeek = false, desiredTime: Double?, actionVersion = 0
    init(context: NativeAudioContext) {
        self.context = context; super.init(); speech.delegate = self
        context.onInvalidated = { [weak self] in self?.clear(reason: "invalidated") }
        #if os(iOS)
        notifications = [NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue { self?.suspend() }
        }, NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self?.suspend() }
        }]
        #endif
    }
    deinit { timer?.cancel(); asset?.cancel(); player?.pause(); speech.stopSpeaking(at: .immediate); notifications.forEach { NotificationCenter.default.removeObserver($0) } }
    func destroy() { context.reset(nil) }
    static func voices() -> [[String: Any]] {
        AVSpeechSynthesisVoice.speechVoices().filter { NativeAudioContext.language($0.language.lowercased().split(separator: "-").first.map(String.init) ?? "") }
            .prefix(512).map { ["id": $0.identifier, "name": $0.name, "language": $0.language, "local": true] }
    }
    func status() -> [String: Any] {
        var value: [String: Any] = ["contextEpoch": context.contextEpoch, "anchored": context.anchored, "foreground": context.foreground, "validForMs": max(0, (context.capsule?.remaining ?? 0) * 1000)]
        if let owner = context.owner { value["ownerId"] = owner }
        if let hash = context.capsule?.payload.audio.readerHash { value["readerHash"] = hash }
        return value
    }
    private func event(reason: String? = nil, stopped: Bool = false, failed: Bool = false) {
        guard let command = command else { return }
        var value: [String: Any] = ["commandId": command, "actionVersion": actionVersion, "index": index, "playing": playing, "stopped": stopped, "failed": failed]
        if let reason = reason { value["reason"] = reason }; emit(value)
    }
    private func deactivate() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
    private func activate() throws {
        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif
    }
    private func releaseOutput() {
        generation += 1; seekVersion += 1; pendingSeek = false; speechItem = nil; speech.stopSpeaking(at: .immediate)
        itemObservation = nil
        if let ended = ended { NotificationCenter.default.removeObserver(ended) }; ended = nil
        if let timeObserver = timeObserver { player?.removeTimeObserver(timeObserver) }; timeObserver = nil
        player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; asset?.cancel(); asset = nil
        childLife?.invalidate(); childLife = nil
        if let observer = observer { active?.lifetime.remove(observer) }; observer = nil
        deactivate()
    }
    private func clear(reason: String, failed: Bool = false) {
        releaseOutput(); timer?.cancel(); timer = nil; playing = false; event(reason: reason, stopped: true, failed: failed)
        command = nil; active = nil; recording = nil; voice = nil; index = 0; renewalSignalled = false; finished = false
    }
    func suspend() { context.suspend(); emit(["interruption":true,"contextEpoch":context.contextEpoch]) }
    func fail() { clear(reason: "unavailable", failed: true); context.invalidate() }
    private func valid() -> Bool { active?.lifetime.current == true && context.capsule?.lifetime.current == true && command != nil }
    private func startTimer() {
        timer?.cancel(); let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.command != nil else { return }
            guard self.valid() else { self.clear(reason: "expired", failed: true); self.context.invalidate(); return }
            if !self.renewalSignalled, (self.active?.remaining ?? 0) < 60 { self.renewalSignalled = true; self.event(reason: "renew") }
        }; self.timer = timer; timer.resume()
    }
    /** Een nieuwe autorisatie mag alleen dezelfde reader/opname voortzetten.
     * Gewijzigde bron/hash wordt al door NativeAudioContext geweigerd. */
    func authorized() {
        guard let old = active, let fresh = context.capsule, command != nil else { return }
        guard old.payload.audio.readerHash == fresh.payload.audio.readerHash else { fail(); return }
        if old.sourceAuthorization == fresh.sourceAuthorization { return }
        let oldPosition = pendingSeek ? desiredTime : player?.currentTime().seconds, wasPlaying = playing
        if recording != nil { releaseOutput(); active = fresh; playing = wasPlaying; do { if wasPlaying { try activate() }; try prepareRecording(at: oldPosition, autoplay: wasPlaying) } catch { fail() } }
        else { active = fresh; old.lifetime.invalidate() }
        renewalSignalled = false
    }
    func control(_ value: [String: Any]) throws {
        guard context.foreground, let action = value["action"] as? String, let commandId = value["commandId"] as? String, UUID(uuidString: commandId) != nil,
              let epoch = value["contextEpoch"] as? Int, epoch == context.contextEpoch,
              let owner = value["ownerId"] as? String, owner == context.owner,
              let stamp = value["sessionStamp"] as? String, stamp == context.stamp,
              let sequence = value["actionVersion"] as? Int, sequence > 0, sequence <= 9007199254740991,
              let hash = value["readerHash"] as? String, let capsule = context.capsule, capsule.lifetime.current, hash == capsule.payload.audio.readerHash else { throw NativeAudioFailure("audio_changed") }
        if action == "start" {
            guard let number = value["index"] as? Int, capsule.payload.reader.verses.indices.contains(number),
                  let rate = value["speed"] as? Double, [0.75,1,1.25,1.5,2].contains(rate) else { throw NativeAudioFailure() }
            let source = value["sourceId"] as? String, selectedVoice = value["voiceId"] as? String
            if let source = source { guard capsule.payload.audio.sources.contains(where: { $0.id == source }) else { throw NativeAudioFailure() } }
            else { _ = try findVoice(selectedVoice, capsule: capsule) }
            clear(reason: "replaced"); active = capsule; command = commandId; actionVersion = sequence; recording = source; voice = selectedVoice; index = number; speed = Float(rate); playing = true; triedFallback = false
            do {
                try activate(); startTimer()
                if source != nil { try prepareRecording(at: nil, autoplay: true) } else { try speak() }
                event(); return
            } catch { fail(); throw NativeAudioFailure() }
        }
        guard commandId == command, sequence > actionVersion, valid() else { throw NativeAudioFailure("audio_changed") }
        actionVersion = sequence
        switch action {
        case "stop": context.invalidate()
        case "pause": player?.pause(); if recording == nil, !speech.pauseSpeaking(at: .immediate) { speechItem = nil; speech.stopSpeaking(at: .immediate) }; playing = false; deactivate(); event()
        case "resume":
            try activate(); playing = true
            if recording != nil {
                if finished { finished = false; try seek(index) } else { player?.rate = speed }
            } else if !speech.continueSpeaking() { try speak() }; event()
        case "seek":
            guard let number = value["index"] as? Int, capsule.payload.reader.verses.indices.contains(number) else { throw NativeAudioFailure() }
            index = number; finished = false; try seek(number); event()
        case "speed":
            guard let rate = value["speed"] as? Double, [0.75,1,1.25,1.5,2].contains(rate) else { throw NativeAudioFailure() }
            speed = Float(rate); if recording != nil { if playing { player?.rate = speed } }
            else { speechItem = nil; speech.stopSpeaking(at: .immediate); if playing { try speak() } }; event()
        default: throw NativeAudioFailure()
        }
    }
    private func source() throws -> NativeAudioRecording {
        guard let active = active, let id = recording, let source = active.payload.audio.sources.first(where: { $0.id == id }) else { throw NativeAudioFailure() }; return source
    }
    private func prepareRecording(at: Double?, autoplay: Bool) throws {
        guard let active = active else { throw NativeAudioFailure() }; let source = try source(), currentGeneration = generation
        desiredTime = at.flatMap { $0.isFinite ? $0 : nil } ?? source.verses[index].start
        let lifetime = NativeAudioLifetime(validFor: active.remaining); childLife = lifetime
        observer = active.lifetime.observe { lifetime.invalidate() }
        let wrapper = NativeAudioAsset(source: try active.request(source.id), lifetime: lifetime); asset = wrapper
        let item = AVPlayerItem(asset: wrapper.asset)
        item.preferredForwardBufferDuration = 15
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = false
        if let end = source.end { item.forwardPlaybackEndTime = CMTime(seconds: end, preferredTimescale: 1000000) }
        let output = AVPlayer(playerItem: item); player = output
        itemObservation = item.observe(\.status, options: [.initial,.new]) { [weak self, weak output] item, _ in DispatchQueue.main.async {
            guard let self = self, self.generation == currentGeneration, self.player === output, self.valid() else { return }
            if item.status == .failed { self.recordingFailed(); return }
            if item.status == .readyToPlay {
                let target = max(source.start, min(self.desiredTime ?? source.start, (source.end ?? .greatestFiniteMagnitude) - 0.001))
                self.seekRecorded(to: target, autoplay: autoplay)
            }
        } }
        timeObserver = output.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.15, preferredTimescale: 1000), queue: .main) { [weak self] time in
            guard let self = self, self.generation == currentGeneration, self.valid(), !self.pendingSeek, time.seconds.isFinite else { return }
            let number = source.verses.lastIndex(where: { $0.start <= time.seconds }) ?? 0
            if number != self.index { self.index = number; self.event() }
        }
        ended = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            guard let self = self, self.generation == currentGeneration, self.valid(), !self.pendingSeek else { return }; self.finish()
        }
    }
    private func recordingFailed() {
        guard let active = active, let recording = recording, !triedFallback,
              let fallback = active.payload.audio.sources.first(where: { $0.fallbackFor == recording }) else { fail(); return }
        triedFallback = true; releaseOutput(); self.recording = fallback.id
        do { try activate(); try prepareRecording(at: nil, autoplay: playing) } catch { fail() }
    }
    private func seek(_ number: Int) throws {
        if recording != nil { let source = try source(); desiredTime = source.verses[number].start; seekRecorded(to: desiredTime!, autoplay: playing) }
        else { speechItem = nil; speech.stopSpeaking(at: .immediate); if playing { try speak() } }
    }
    private func seekRecorded(to target: Double, autoplay: Bool) {
        desiredTime = target
        guard let player = player, player.currentItem?.status == .readyToPlay else { return }
        seekVersion += 1; pendingSeek = true
        let version = seekVersion, currentGeneration = generation
        player.currentItem?.cancelPendingSeeks()
        player.seek(to: CMTime(seconds: target, preferredTimescale: 1000000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] done in DispatchQueue.main.async {
            guard let self = self, self.generation == currentGeneration, self.seekVersion == version, self.valid() else { return }
            self.pendingSeek = false
            if done && autoplay && self.playing { self.player?.rate = self.speed }; self.event()
        } }
    }

    private func findVoice(_ id: String?, capsule: NativeAudioCapsule) throws -> AVSpeechSynthesisVoice {
        let language = capsule.payload.reader.sourceLanguage
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.lowercased() == language || $0.language.lowercased().hasPrefix(language + "-") }
        guard let voice = voices.first(where: { $0.identifier == id }) ?? (id == nil ? voices.first : nil) else { throw NativeAudioFailure("audio_voice_unavailable") }; return voice
    }
    private func speak() throws {
        guard valid(), let active = active, active.payload.reader.verses.indices.contains(index) else { throw NativeAudioFailure() }
        let utterance = AVSpeechUtterance(string: active.payload.reader.verses[index].text); utterance.voice = try findVoice(voice, capsule: active)
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * speed))
        speechItem = utterance; speech.speak(utterance)
    }
    private func finish() { player?.pause(); playing = false; index = 0; finished = true; deactivate(); event() }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in guard let self = self, self.speechItem === utterance, self.valid(), self.playing else { return }; self.event() }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.speechItem === utterance, self.valid(), self.playing, let active = self.active else { return }
            if self.index + 1 < active.payload.reader.verses.count { self.index += 1; do { try self.speak(); self.event() } catch { self.fail() } } else { self.finish() }
        }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { [weak self] in guard let self = self, self.speechItem === utterance, self.valid(), self.playing else { return }; self.fail() }
    }
}
