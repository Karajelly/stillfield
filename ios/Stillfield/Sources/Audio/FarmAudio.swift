import Foundation
import StillfieldCore
@preconcurrency import AVFoundation

/// A quiet, entirely synthesized soundscape. Call `setEnabled` from the sound
/// control, and forward SwiftUI's scene phase to `setActive`.
///
/// All synthesis happens before buffers reach the audio thread. There are no
/// Swift render callbacks, network requests, background playback, or recordings.
@MainActor
final class FarmAudio {
    private let lifetime = FarmAudioLifetime()
    private var graph: AudioGraph?
    private var enabled = false
    private var active = true
    private var interrupted = false
    private var resumeNeedsUserAction = false
    private var disposed = false
    private var volume = 0.65
    private var speed = 0.0
    private var sessionIsActive = false
    private var birdsong = 1.0
    private var crickets = 0.0
    private var gust = 0.0
    private var lastOwl = -60.0
    private var nextVoice = 0

    func setEnabled(_ enabled: Bool) {
        guard !disposed else { return }
        self.enabled = enabled
        if enabled && !interrupted { resumeNeedsUserAction = false }
        reconcilePlayback()
    }

    /// Speed is normalized from zero (idle) to one (full cruising speed).
    func setDriving(_ normalizedSpeed: Double) {
        guard !disposed else { return }
        speed = normalizedSpeed.isFinite ? min(1, abs(normalizedSpeed)) : 0
        updateTractor()
    }

    func setVolume(_ volume: Double) {
        guard !disposed else { return }
        self.volume = volume.isFinite ? max(0, min(1, volume)) : 0
        graph?.engine.mainMixerNode.outputVolume = Float(self.volume * 0.5)
    }

    /// Pauses immediately when the app becomes inactive, including Control
    /// Center and system dialogs, and only resumes an enabled soundscape.
    func setActive(_ active: Bool) {
        guard !disposed else { return }
        self.active = active
        reconcilePlayback()
    }

    /// Birdsong thins towards dusk; crickets take over after dark.
    func setAmbience(birdsong: Double, crickets: Double) {
        guard !disposed else { return }
        self.birdsong = birdsong.isFinite ? max(0, birdsong) : 1
        self.crickets = crickets.isFinite ? max(0, min(1, crickets)) : 0
    }

    /// A passing gust lifts the wind bed, from 0 (still) to 1 (full).
    func setGust(_ strength: Double) {
        guard !disposed else { return }
        let gust = strength.isFinite ? max(0, min(1, strength)) : 0
        guard gust != self.gust else { return }
        self.gust = gust
        graph?.wind.volume = Float(0.12 + gust * 0.06)
    }

    /// One note of the wind crossing the field. Wheat is a soft reed, sunflowers
    /// a small bell, pumpkins a low wooden tone, and stubble a brush. Notes are
    /// rendered once per pitch and reused, so a gust schedules buffers only.
    func windNote(_ voice: WindVoice, frequency: Double, level: Double, pan: Double) {
        guard shouldPlay, let graph, graph.engine.isRunning, level > 0, !graph.voices.isEmpty,
              let buffer = graph.note(voice, frequency: frequency) else { return }
        let player = graph.voices[nextVoice % graph.voices.count]
        nextVoice += 1
        let peak: Double
        switch voice {
        case .wheat: peak = 0.05
        case .sunflowers: peak = 0.04
        case .pumpkins: peak = 0.085
        case .stubble: peak = 0.03
        }
        player.volume = Float(peak * min(1, level))
        player.pan = Float(max(-1, min(1, pan)))
        // The oldest voice gives way; by then its note has all but faded.
        player.scheduleBuffer(buffer, at: nil, options: .interrupts, completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    func harvest(_ crop: Crop) {
        guard shouldPlay, let graph, graph.engine.isRunning,
              let buffer = graph.harvestBuffers[crop] else { return }
        graph.harvest.stop()
        graph.harvest.scheduleBuffer(buffer, at: nil, options: [])
        graph.harvest.play()
    }

    func dispose() {
        guard !disposed else { return }
        disposed = true
        enabled = false
        stopPlayback()
        lifetime.removeObservers()
        graph = nil
    }

    private var shouldPlay: Bool {
        enabled && active && !interrupted && !resumeNeedsUserAction && !disposed
    }

    private func reconcilePlayback() {
        guard shouldPlay else {
            stopPlayback()
            return
        }

        if graph == nil {
            guard let newGraph = AudioGraph() else { return }
            graph = newGraph
            observeSystemAudio()
        }
        guard let graph, !graph.engine.isRunning else { return }

        do {
            let session = AVAudioSession.sharedInstance()
            // Ambient respects the silent switch and mixes with the listener's
            // music. No background-audio entitlement is required or requested.
            try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            sessionIsActive = true

            graph.engine.mainMixerNode.outputVolume = Float(volume * 0.5)
            updateTractor()
            graph.engine.prepare()
            try graph.engine.start()
            graph.wind.scheduleBuffer(graph.windBuffer, at: nil, options: .loops)
            graph.tractor.scheduleBuffer(graph.tractorBuffer, at: nil, options: .loops)
            graph.wind.volume = Float(0.12 + gust * 0.06)
            graph.wind.play()
            graph.tractor.play()
            scheduleNextBird()
            scheduleNightVoices()
        } catch {
            // An unavailable route should never interrupt the farm. A later
            // sound toggle or foreground transition can try the session again.
            stopPlayback()
        }
    }

    private func stopPlayback() {
        lifetime.cancelBirdTimer()
        lifetime.cancelNightTimer()
        if let graph {
            graph.wind.stop()
            graph.tractor.stop()
            graph.bird.stop()
            graph.harvest.stop()
            graph.cricket.stop()
            graph.owl.stop()
            graph.voices.forEach { $0.stop() }
            graph.engine.stop()
        }
        if sessionIsActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionIsActive = false
        }
    }

    private func updateTractor() {
        graph?.tractor.volume = Float(0.009 + speed * 0.035)
        graph?.tractorRate.rate = Float(1 + speed * (22.0 / 53.0))
    }

    private func scheduleNextBird() {
        lifetime.cancelBirdTimer()
        guard shouldPlay, graph?.engine.isRunning == true else { return }
        let timer = Timer(timeInterval: Double.random(in: 5.5...11.5), repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.playBird()
                self.scheduleNextBird()
            }
        }
        lifetime.birdTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    /// Crickets a few times a second after dark, and an owl now and then.
    private func scheduleNightVoices() {
        lifetime.cancelNightTimer()
        guard shouldPlay, graph?.engine.isRunning == true else { return }
        let timer = Timer(timeInterval: 0.52, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.playNightVoices() }
        }
        lifetime.nightTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func playNightVoices() {
        guard shouldPlay, let graph, graph.engine.isRunning, crickets > 0 else { return }
        if Double.random(in: 0..<1) < 0.7 * crickets, !graph.cricketBuffers.isEmpty {
            // Chirps are shorter than the gap between them, so one player is enough.
            let singer = Int.random(in: graph.cricketBuffers.indices)
            graph.cricket.volume = Float(0.011 * crickets)
            graph.cricket.pan = [-0.65, 0.5, 0.1][singer % 3]
            graph.cricket.scheduleBuffer(graph.cricketBuffers[singer], at: nil, options: .interrupts, completionHandler: nil)
            if !graph.cricket.isPlaying { graph.cricket.play() }
        }
        // An owl, once it is properly dark.
        let now = ProcessInfo.processInfo.systemUptime
        if crickets > 0.9, now - lastOwl > 25, Double.random(in: 0..<1) < 0.02, let hoot = graph.owlBuffer {
            lastOwl = now
            graph.owl.scheduleBuffer(hoot, at: nil, options: .interrupts, completionHandler: nil)
            if !graph.owl.isPlaying { graph.owl.play() }
        }
    }

    private func playBird() {
        guard shouldPlay, let graph, graph.engine.isRunning,
              Double.random(in: 0..<1) < birdsong else { return }
        // Calls are much farther apart than the longest bird phrase, so a
        // single player can be reused without overlapping voices.
        graph.bird.stop()
        graph.bird.pan = Float.random(in: -0.7...0.7)
        let index = Int.random(in: graph.birdBuffers.indices)
        graph.bird.scheduleBuffer(graph.birdBuffers[index], at: nil, options: [], completionHandler: nil)
        graph.bird.play()
    }

    private func observeSystemAudio() {
        lifetime.removeObservers()
        let center = NotificationCenter.default
        lifetime.observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(), queue: .main
        ) { [weak self] notification in
            let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let options = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            Task { @MainActor [weak self] in
                self?.handleInterruption(type: type, options: options)
            }
        })
        lifetime.observers.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(), queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.disposed else { return }
                self.stopPlayback()
                self.graph = nil
                self.interrupted = false
                self.reconcilePlayback()
            }
        })
        lifetime.observers.append(center.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: graph?.engine, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.disposed else { return }
                // Headphones and route changes can stop the engine and clear
                // scheduled buffers. Rebuild playback with the same preferences.
                self.stopPlayback()
                self.reconcilePlayback()
            }
        })
    }

    private func handleInterruption(type: UInt?, options: UInt) {
        guard !disposed, let type, let interruption = AVAudioSession.InterruptionType(rawValue: type) else { return }
        switch interruption {
        case .began:
            interrupted = true
            stopPlayback()
        case .ended:
            interrupted = false
            resumeNeedsUserAction = !AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)
            reconcilePlayback()
        @unknown default:
            interrupted = true
            stopPlayback()
        }
    }

    /// Retains the loops for the full lifetime of their scheduled playback.
    @MainActor private final class AudioGraph {
        let engine = AVAudioEngine()
        let wind = AVAudioPlayerNode()
        let tractor = AVAudioPlayerNode()
        let tractorRate = AVAudioUnitVarispeed()
        let bird = AVAudioPlayerNode()
        let harvest = AVAudioPlayerNode()
        let cricket = AVAudioPlayerNode()
        let owl = AVAudioPlayerNode()
        /// A small pool for the wind's notes, which overlap as they fade.
        let voices = (0..<12).map { _ in AVAudioPlayerNode() }
        let format: AVAudioFormat
        let cricketBuffers: [AVAudioPCMBuffer]
        let owlBuffer: AVAudioPCMBuffer?
        private var notes: [String: AVAudioPCMBuffer] = [:]
        var harvestBuffers: [Crop: AVAudioPCMBuffer] = [:]
        let windBuffer: AVAudioPCMBuffer
        let tractorBuffer: AVAudioPCMBuffer
        let birdBuffers: [AVAudioPCMBuffer]

        init?() {
            guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
                  let windBuffer = FarmAudio.makeWind(format: format),
                  let tractorBuffer = FarmAudio.makeTractor(format: format) else { return nil }
            self.format = format
            self.windBuffer = windBuffer
            self.tractorBuffer = tractorBuffer
            cricketBuffers = (0..<3).compactMap { FarmAudio.makeCricket(format: format, singer: $0) }
            owlBuffer = FarmAudio.makeOwl(format: format)
            birdBuffers = (0..<6).compactMap { variant in
                FarmAudio.makeBird(format: format, variant: variant)
            }
            guard !birdBuffers.isEmpty else { return nil }
            for crop in Crop.allCases {
                guard let note = FarmAudio.buffer(format: format, seconds: 0.6), let samples = note.floatChannelData?[0] else { continue }
                let pitch: Double = crop == .sunflowers ? 620 : crop == .wheat ? 420 : 220
                for i in 0..<Int(note.frameLength) {
                    let t = Double(i) / format.sampleRate
                    let envelope = min(1, t / 0.04) * pow(max(0, 1 - t / 0.6), 3)
                    samples[i] = Float(sin(2 * .pi * pitch * t) * envelope)
                }
                harvestBuffers[crop] = note
            }

            engine.attach(wind)
            engine.attach(tractor)
            engine.attach(tractorRate)
            engine.attach(bird)
            engine.attach(harvest)
            engine.connect(wind, to: engine.mainMixerNode, format: format)
            engine.connect(tractor, to: tractorRate, format: format)
            engine.connect(tractorRate, to: engine.mainMixerNode, format: format)
            engine.connect(bird, to: engine.mainMixerNode, format: format)
            engine.connect(harvest, to: engine.mainMixerNode, format: format)
            for player in [cricket, owl] + voices {
                engine.attach(player)
                engine.connect(player, to: engine.mainMixerNode, format: format)
            }
            owl.volume = 0.04
            owl.pan = -0.55
            harvest.volume = 0.025
            wind.volume = 0.12
            bird.volume = 0.018
        }

        /// Each pitch of each voice is rendered the first time the wind asks for it.
        func note(_ voice: WindVoice, frequency: Double) -> AVAudioPCMBuffer? {
            let key = voice == .stubble ? voice.rawValue : "\(voice.rawValue)-\(Int((frequency * 10).rounded()))"
            if let ready = notes[key] { return ready }
            let made = FarmAudio.makeNote(format: format, voice: voice, frequency: frequency)
            notes[key] = made
            return made
        }
    }

    private static func makeNote(format: AVAudioFormat, voice: WindVoice, frequency: Double) -> AVAudioPCMBuffer? {
        let seconds: Double
        switch voice {
        case .wheat: seconds = 1.3
        case .sunflowers: seconds = 1.5
        case .pumpkins: seconds = 1.0
        case .stubble: seconds = 0.36
        }
        guard let buffer = buffer(format: format, seconds: seconds), let samples = buffer.floatChannelData?[0] else { return nil }
        let rate = format.sampleRate
        var seed: UInt64 = 0x57696E64
        var low = 0.0, high = 0.0, soft = 0.0
        let softAlpha = 1 - exp(-2 * Double.pi * 1_500 / rate)
        let lowAlpha = 1 - exp(-2 * Double.pi * 5_000 / rate)
        let highAlpha = 1 - exp(-2 * Double.pi * 1_800 / rate)
        for index in 0..<Int(buffer.frameLength) {
            let t = Double(index) / rate
            // Every note ends on silence, so a reused player never clicks.
            let tail = min(1, (seconds - t) / 0.03)
            let sample: Double
            switch voice {
            case .wheat:
                // Slow to speak and slow to fade, so a long row becomes a held line.
                let cycle = (frequency * t).truncatingRemainder(dividingBy: 1)
                let triangle = 4 * abs(cycle - 0.5) - 1
                soft += softAlpha * (triangle - soft)
                let envelope = t < 0.14 ? t / 0.14 : t < 0.3 ? 1 : exp(-(t - 0.3) / 0.22)
                sample = soft * envelope
            case .sunflowers:
                let envelope = min(1, t / 0.008) * pow(0.0001, max(0, t - 0.008) / (seconds - 0.028))
                sample = (sin(2 * .pi * frequency * t) + 0.22 * sin(4 * .pi * frequency * t)) * envelope
            case .pumpkins:
                let envelope = min(1, t / 0.015) * pow(0.0001, max(0, t - 0.015) / (seconds - 0.035))
                sample = sin(2 * .pi * frequency * t) * envelope
            case .stubble:
                seed = seed &* 6_364_136_223_846_793_005 &+ 1
                let noise = Double(seed >> 32) / Double(UInt32.max) * 2 - 1
                low += lowAlpha * (noise - low)
                high += highAlpha * (noise - high)
                let envelope = min(1, t / 0.05) * pow(0.0001, max(0, t - 0.05) / 0.27)
                sample = (low - high) * 2 * envelope
            }
            samples[index] = Float(sample * tail)
        }
        return buffer
    }

    /// A cricket is a few very short, very high pulses. Three share the dark.
    private static func makeCricket(format: AVAudioFormat, singer: Int) -> AVAudioPCMBuffer? {
        let pulses = 3 + singer % 2
        guard let buffer = buffer(format: format, seconds: Double(pulses) * 0.058 + 0.02),
              let samples = buffer.floatChannelData?[0] else { return nil }
        let pitch = 3_900 + Double(singer) * 260
        for index in 0..<Int(buffer.frameLength) {
            let time = Double(index) / format.sampleRate
            let pulse = Int(time / 0.058)
            let pulseTime = time - Double(pulse) * 0.058
            let envelope = pulse >= pulses ? 0 : pulseTime < 0.012 ? pulseTime / 0.012 : max(0, 1 - (pulseTime - 0.012) / 0.028)
            samples[index] = Float(sin(2 * .pi * pitch * time) * envelope)
        }
        return buffer
    }

    /// Three soft, falling hoots from somewhere past the barn.
    private static func makeOwl(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let buffer = buffer(format: format, seconds: 1.4), let samples = buffer.floatChannelData?[0] else { return nil }
        let hoots: [(start: Double, length: Double)] = [(0, 0.34), (0.52, 0.2), (0.78, 0.5)]
        var phase = 0.0
        for index in 0..<Int(buffer.frameLength) {
            let time = Double(index) / format.sampleRate
            var envelope = 0.0, frequency = 352.0
            if let hoot = hoots.first(where: { time >= $0.start && time < $0.start + $0.length }) {
                let into = time - hoot.start
                frequency = 352 - 34 * into / hoot.length
                envelope = into < 0.07 ? into / 0.07 : max(0, 1 - (into - 0.07) / (hoot.length - 0.07))
            }
            phase += 2 * .pi * frequency / format.sampleRate
            samples[index] = Float(sin(phase) * envelope)
        }
        return buffer
    }

    private static func buffer(format: AVAudioFormat, seconds: Double) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        return buffer
    }

    private static func makeWind(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let buffer = buffer(format: format, seconds: 8), let samples = buffer.floatChannelData?[0] else { return nil }
        let count = Int(buffer.frameLength)
        var noise = [Double](repeating: 0, count: count)
        var seed: UInt64 = 0x5374696C6C666965
        for index in noise.indices {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1
            noise[index] = Double(seed >> 32) / Double(UInt32.max) * 2 - 1
        }
        let lowAlpha = 1 - exp(-2 * Double.pi * 720 / format.sampleRate)
        let highAlpha = 1 - exp(-2 * Double.pi * 110 / format.sampleRate)
        var low = 0.0
        var high = 0.0
        // A first pass settles the filters into the repeating noise. The second
        // pass is a continuous loop, including the final-to-first sample seam.
        for pass in 0..<2 {
            for index in 0..<count {
                low += lowAlpha * (noise[index] - low)
                high += highAlpha * (noise[index] - high)
                if pass == 1 {
                    let position = Double(index) / Double(count)
                    let swell = 0.85 + 0.22 * sin(2 * .pi * position) + 0.08 * sin(4 * .pi * position)
                    samples[index] = Float((low - high) * swell)
                }
            }
        }
        return buffer
    }

    private static func makeTractor(format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let buffer = buffer(format: format, seconds: 1), let samples = buffer.floatChannelData?[0] else { return nil }
        // Integer cycle counts make all components join perfectly at the seam.
        // A gentle low harmonic gives the tractor warmth without a harsh buzz.
        for index in 0..<Int(buffer.frameLength) {
            let time = Double(index) / format.sampleRate
            let fundamental = sin(2 * .pi * 53 * time)
            let harmonic = sin(2 * .pi * 106 * time) * 0.24
            let pulse = 1 + sin(2 * .pi * 8 * time) * 0.12
            samples[index] = Float((fundamental + harmonic) * pulse)
        }
        return buffer
    }

    private static func makeBird(format: AVAudioFormat, variant: Int) -> AVAudioPCMBuffer? {
        let notes = variant.isMultiple(of: 2) ? 2 : 3
        guard let buffer = buffer(format: format, seconds: Double(notes) * 0.22),
              let samples = buffer.floatChannelData?[0] else { return nil }
        let pitch = 1_700 + Double(variant) * 125
        var phase = 0.0
        for index in 0..<Int(buffer.frameLength) {
            let time = Double(index) / format.sampleRate
            let note = Int(time / 0.22)
            let noteTime = time - Double(note) * 0.22
            let frequency = pitch + Double(note) * 120
            let sweep: Double
            if noteTime < 0.055 {
                sweep = pow(1.19, noteTime / 0.055)
            } else {
                sweep = 1.19 * pow(0.92 / 1.19, min(1, (noteTime - 0.055) / 0.105))
            }
            phase += 2 * .pi * frequency * sweep / format.sampleRate
            let envelope: Double
            if noteTime < 0.025 {
                envelope = sin(noteTime / 0.025 * .pi / 2)
            } else if noteTime < 0.17 {
                let release = (noteTime - 0.025) / 0.145
                envelope = pow(1 - release, 3)
            } else {
                envelope = 0
            }
            samples[index] = Float(sin(phase) * envelope)
        }
        return buffer
    }
}

/// Keeps notification and timer cleanup independent of actor-isolated deinit.
/// The owning FarmAudio accesses these resources only on the main actor.
private final class FarmAudioLifetime {
    var observers: [NSObjectProtocol] = []
    var birdTimer: Timer?
    var nightTimer: Timer?

    func cancelBirdTimer() {
        birdTimer?.invalidate()
        birdTimer = nil
    }

    func cancelNightTimer() {
        nightTimer?.invalidate()
        nightTimer = nil
    }

    func removeObservers() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
    }

    deinit {
        birdTimer?.invalidate()
        nightTimer?.invalidate()
        observers.forEach(NotificationCenter.default.removeObserver)
    }
}
