import Foundation
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
            graph.wind.play()
            graph.tractor.play()
            scheduleNextBird()
        } catch {
            // An unavailable route should never interrupt the farm. A later
            // sound toggle or foreground transition can try the session again.
            stopPlayback()
        }
    }

    private func stopPlayback() {
        lifetime.cancelBirdTimer()
        if let graph {
            graph.wind.stop()
            graph.tractor.stop()
            graph.bird.stop()
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

    private func playBird() {
        guard shouldPlay, let graph, graph.engine.isRunning else { return }
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
        let windBuffer: AVAudioPCMBuffer
        let tractorBuffer: AVAudioPCMBuffer
        let birdBuffers: [AVAudioPCMBuffer]

        init?() {
            guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
                  let windBuffer = FarmAudio.makeWind(format: format),
                  let tractorBuffer = FarmAudio.makeTractor(format: format) else { return nil }
            self.windBuffer = windBuffer
            self.tractorBuffer = tractorBuffer
            birdBuffers = (0..<6).compactMap { variant in
                FarmAudio.makeBird(format: format, variant: variant)
            }
            guard !birdBuffers.isEmpty else { return nil }

            engine.attach(wind)
            engine.attach(tractor)
            engine.attach(tractorRate)
            engine.attach(bird)
            engine.connect(wind, to: engine.mainMixerNode, format: format)
            engine.connect(tractor, to: tractorRate, format: format)
            engine.connect(tractorRate, to: engine.mainMixerNode, format: format)
            engine.connect(bird, to: engine.mainMixerNode, format: format)
            wind.volume = 0.12
            bird.volume = 0.018
        }
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

    func cancelBirdTimer() {
        birdTimer?.invalidate()
        birdTimer = nil
    }

    func removeObservers() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
    }

    deinit {
        birdTimer?.invalidate()
        observers.forEach(NotificationCenter.default.removeObserver)
    }
}
