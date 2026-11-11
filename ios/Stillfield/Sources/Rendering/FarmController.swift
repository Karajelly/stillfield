import Foundation
import Observation
import RealityKit
import StillfieldCore
import SwiftUI
import UIKit
import os

/// Colours the interface borrows from the sky, rounded to whole 8-bit steps so
/// SwiftUI is told about a change a few times a second at most, and only while
/// the light is actually moving.
struct SkyTint: Equatable {
    var sky = SIMD3<Double>(0xe8, 0xec, 0xda) / 255
    /// A paler shade of the sky by day and the sky itself at night, for the page edges.
    var haze = SIMD3<Double>(0xf4, 0xf5, 0xe3) / 255
    /// The page edges are dark enough that text drawn on them should turn cream.
    var afterDark = false

    init() {}

    init(_ light: Daylight) {
        func step(_ color: SIMD3<Double>) -> SIMD3<Double> { (color * 255).rounded(.toNearestOrEven) / 255 }
        sky = step(light.sky)
        haze = step(light.sky + (SIMD3(repeating: 1) - light.sky) * 0.5 * (1 - light.glow))
        afterDark = 0.2126 * haze.x + 0.7152 * haze.y + 0.0722 * haze.z < 150.0 / 255
    }
}

@MainActor @Observable
final class FarmController {
    var tool: FarmTool
    var selectedCrop: Crop { didSet { persist() } }
    private(set) var cameraMode: FarmCameraMode
    var isPaused = false
    var soundEnabled = false
    /// Drifting through the day, or a time of day the player keeps.
    var light: DayHold { didSet { lightChanged() } }
    private(set) var tint = SkyTint()
    private(set) var dayPhase = DayPhase.morning
    private(set) var postcard: Postcard?
    /// True for the moment the controls step aside so a postcard shows the meadow alone.
    private(set) var isCapturing = false
    var haptics: Bool { didSet { persist() } }
    var introDismissed: Bool
    private(set) var hasDriven = false
    private(set) var controlsHidden = false
    var pace: Double { didSet { persist() } }
    var volume: Double { didSet { audio.setVolume(volume); persist() } }
    var isLoading = true
    var hasSaveError = false
    var errorMessage: String?
    var toast: String?
    var activeSheet: FarmSheet? { didSet { if activeSheet != nil { showControls(); stop(); persist() } } }
#if DEBUG
    var testTelemetry = ""
    @ObservationIgnored private let isUITesting = ProcessInfo.processInfo.arguments.contains("--ui-testing")
    @ObservationIgnored private var testPaintedCells = 0
    @ObservationIgnored private var testSteeringCount = 0
    @ObservationIgnored private var testTouchCount = 0
    @ObservationIgnored private var lastTelemetry = -1.0
    /// UI tests can hold a gust front in place, to check the lean it gives the field.
    @ObservationIgnored private var heldGustFront: Double?
#endif

    @ObservationIgnored private var farmingConfiguration = FarmingConfiguration()
    @ObservationIgnored private var field: FieldGrid
    @ObservationIgnored private var tractorState: TractorState
    @ObservationIgnored private let saveURL: URL
    @ObservationIgnored private var saveReady = false
    @ObservationIgnored private var savePreservationPending = false
    @ObservationIgnored private var fieldRenderer: FieldRenderer?
    @ObservationIgnored private var content: RealityViewCameraContent?
    @ObservationIgnored private var frameSubscription: EventSubscription?
    @ObservationIgnored private let root = Entity()
    @ObservationIgnored private let camera = Entity()
    @ObservationIgnored private let sun = Entity()
    @ObservationIgnored private let fillLight = Entity()
    @ObservationIgnored private var daylight: EnvironmentResource?
    @ObservationIgnored private var goldenDaylight: EnvironmentResource?
    @ObservationIgnored private var nightDaylight: EnvironmentResource?
    @ObservationIgnored private var dusk: DuskRenderer?
    @ObservationIgnored private var wind = Wind()
    /// Seconds into the day, advanced by the same active-play clock as the crops.
    @ObservationIgnored private var dayTime = 0.0
    @ObservationIgnored private var litDay = -1.0
    @ObservationIgnored private var glow = 0.0
    @ObservationIgnored private var sailTurn: Float = 0
    @ObservationIgnored private var tractor = Entity()
    @ObservationIgnored private var destinationMarker = Entity()
    @ObservationIgnored private var obstacles: [Obstacle] = []
    @ObservationIgnored private var sails: [(Entity, simd_quatf, Float)] = []
    @ObservationIgnored private var wheels: [(Entity, simd_quatf)] = []
    @ObservationIgnored private var birds: [(Entity, SIMD3<Float>)] = []
    @ObservationIgnored private let audio = FarmAudio()
    @ObservationIgnored private let feedback = UISelectionFeedbackGenerator()
    @ObservationIgnored private var navigation = TractorNavigation()
    @ObservationIgnored private var steeringGesture: SteeringGesture?
    @ObservationIgnored private var steeringSuppressed = false
    @ObservationIgnored private var target: FarmPoint?
    @ObservationIgnored private var elapsed = 0.0
    @ObservationIgnored private var lastFlush = 0.0
    @ObservationIgnored private var lastSave = 0.0
    @ObservationIgnored private var wheelAngle: Float = 0
    @ObservationIgnored private var overviewZoom: Float = 1
    @ObservationIgnored private var tractorZoom = Float(TractorFollowCamera.defaultZoom)
    private var zoom: Float {
        get { cameraMode == .overview ? overviewZoom : tractorZoom }
        set { if cameraMode == .overview { overviewZoom = newValue } else { tractorZoom = newValue } }
    }
    @ObservationIgnored private var followCamera = TractorFollowCamera()
    @ObservationIgnored private var pinchStartZoom: Float?
    @ObservationIgnored private var viewport = CGSize(width: 1024, height: 768)
    @ObservationIgnored private var isActive = true
    @ObservationIgnored private var skipGrowthFrame = true
    @ObservationIgnored private var lastHarvestSound = -10.0
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var controlsHideTask: Task<Void, Never>?
    @ObservationIgnored private let logger = Logger(subsystem: "com.stillfield.app", category: "Meadow")

    init() {
        let testing = ProcessInfo.processInfo.arguments.contains("--ui-testing")
        saveURL = URL.applicationSupportDirectory
            .appending(path: "Stillfield", directoryHint: .isDirectory)
            .appending(path: testing ? "ui-test-meadow.json" : "meadow.json")
        let freshTest = ProcessInfo.processInfo.arguments.contains("--fresh-meadow")
        let loaded = !freshTest ? MeadowStore.load(from: saveURL) : nil
        var preservationError: Error?
        if loaded == nil && !freshTest {
            do { try MeadowStore.preserveExistingSave(at: saveURL) }
            catch { preservationError = error }
        }
        let saved = loaded ?? MeadowSave()
        field = saved.field
#if DEBUG
        if testing && ProcessInfo.processInfo.arguments.contains("--fast-crops") {
            // UI tests exercise automatic active-play growth without several-minute waits.
            for crop in Crop.allCases { farmingConfiguration.growthSeconds[crop] = 45 }
        }
        if testing && ProcessInfo.processInfo.arguments.contains("--still-gust") {
            // Just past the west edge of the third column of patches, where its lean peaks.
            heldGustFront = -12.2
        }
#endif
        tractorState = saved.tractor
        tractorState.speed = 0
        tool = saved.tool == .mow || saved.tool == .restore ? .wander : saved.tool
        selectedCrop = saved.selectedCrop ?? .wheat
        cameraMode = saved.cameraMode ?? .overview
        light = saved.resolvedLight
        dayTime = saved.resolvedDay
        haptics = saved.haptics
        introDismissed = saved.introDismissed
        pace = saved.pace
        volume = saved.volume
        audio.setVolume(volume)
        if let preservationError {
            savePreservationPending = true
            hasSaveError = true
            logger.error("Previous meadow could not be preserved: \(String(describing: preservationError), privacy: .public)")
        }
        // The loading card and the first frame already wear the saved hour's colours.
        let now = Daylight.at(dayTime)
        tint = SkyTint(now)
        dayPhase = now.phase
    }

    func load(into content: RealityViewCameraContent, size: CGSize, daylight: EnvironmentResource?,
              goldenDaylight: EnvironmentResource?, nightDaylight: EnvironmentResource?) async {
        guard self.content == nil else { return }
        self.content = content
        viewport = size
        self.daylight = daylight
        self.goldenDaylight = goldenDaylight
        self.nightDaylight = nightDaylight
        do {
            let artwork = try await FarmArtwork.load()
            let world = try await artwork.world.makeEntity()
            tractor = try await artwork.tractor.makeEntity()
            fieldRenderer = try await FieldRenderer(grid: field)
            obstacles = artwork.obstacles
            root.addChild(world)
            root.addChild(tractor)
            if let fieldRenderer { root.addChild(fieldRenderer.entity) }
            let dusk = DuskRenderer()
            root.addChild(dusk.entity)
            tractor.addChild(dusk.lamps)
            self.dusk = dusk
            camera.name = "The unhurried camera"
            setViewportSize(size)
            root.addChild(camera)
            fillLight.look(at: .zero, from: [40, 38, -45], relativeTo: nil)
            root.addChild(sun)
            root.addChild(fillLight)
            destinationMarker = try Self.makeDestinationMarker(readsDepth: cameraMode == .tractor)
            updateDestinationMarkerScale()
            destinationMarker.isEnabled = false
            root.addChild(destinationMarker)
            content.add(root)
            if let mill = world.findEntity(named: "windmill-sails") { sails.append((mill, mill.orientation, 0.075)) }
            if let mill = world.findEntity(named: "meadow-sails") { sails.append((mill, mill.orientation, 0.085)) }
            for side in [-1, 1] {
                for axle in ["front", "rear"] {
                    if let wheel = tractor.findEntity(named: "wheel-\(side)-\(axle)") { wheels.append((wheel, wheel.orientation)) }
                }
            }
            for index in 0..<4 {
                if let bird = world.findEntity(named: "bird-\(index)") { birds.append((bird, bird.position)) }
            }
            syncTractor()
            updateAttachment()
            updateLight()
            frameSubscription = content.subscribe(to: SceneEvents.Update.self) { [weak self] event in
                MainActor.assumeIsolated { self?.update(deltaTime: event.deltaTime) }
            }
            saveReady = true
            isLoading = false
#if DEBUG
            updateTestTelemetry(force: true)
#endif
        } catch {
            logger.error("Native meadow load failed: \(String(describing: error), privacy: .public)")
            errorMessage = "The meadow couldn’t open. Close Stillfield and try again. Your saved field is safe."
            isLoading = false
        }
    }

    func setViewportSize(_ size: CGSize) {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return }
        if pinchStartZoom == nil { cancelSteering() }
        viewport = size
        let aspect = Float(size.width / size.height)
        if cameraMode == .overview {
            let framing = OverviewCamera.frame(aspect: Double(aspect), zoom: Double(zoom))
            camera.components.remove(PerspectiveCameraComponent.self)
            var component = OrthographicCameraComponent()
            component.near = 0.1
            component.far = 300
            component.scaleDirection = .vertical
            // RealityKit's orthographic scale is a half-extent.
            component.scale = Float(framing.verticalHalfExtent)
            camera.components.set(component)
            camera.look(at: SIMD3<Float>(framing.focus), from: SIMD3<Float>(framing.position), relativeTo: nil)
        } else {
            camera.components.remove(OrthographicCameraComponent.self)
            camera.components.set(PerspectiveCameraComponent(
                near: 0.1, far: 300,
                fieldOfViewInDegrees: Float(TractorFollowCamera.verticalFieldOfView(aspect: Double(aspect)))
            ))
            updateFollowCamera(snap: true)
        }
        updateDestinationMarkerScale()
#if DEBUG
        updateTestTelemetry(force: true)
#endif
    }

    func steer(at point: CGPoint, from origin: CGPoint) {
#if DEBUG
        if isUITesting { testTouchCount += 1 }
        defer { updateTestTelemetry(force: true) }
#endif
        guard !isLoading, isActive, !isPaused, activeSheet == nil,
              pinchStartZoom == nil, !steeringSuppressed else { return }
        let started = steeringGesture == nil
        if started {
            navigation.cancel(); target = nil; destinationMarker.isEnabled = false
            steeringGesture = SteeringGesture(location: SIMD2(Double(origin.x), Double(origin.y)), time: elapsed)
        }
        steeringGesture?.update(SIMD2(Double(point.x), Double(point.y)))
        if cameraMode == .overview && (started || steeringGesture?.moved == true) { chooseGround(at: point) }
        if !introDismissed { dismissIntro() }
        if hasDriven { scheduleControlsHide() }
    }

    func endSteering() {
        defer { steeringGesture = nil; steeringSuppressed = false }
        guard !steeringSuppressed, let gesture = steeringGesture else { return }
        if cameraMode == .tractor && !gesture.isDriving(at: elapsed) {
            chooseGround(at: CGPoint(x: gesture.location.x, y: gesture.location.y))
        }
        // The next frame has no drag input: yaw stops immediately, travel coasts.
    }

    func cancelSteering() {
        if steeringGesture != nil || steeringSuppressed { stop() }
        steeringSuppressed = false
    }

    private func chooseGround(at point: CGPoint) {
        let transform = camera.transformMatrix(relativeTo: nil)
        func vector(_ column: SIMD4<Float>) -> SIMD3<Double> {
            SIMD3(Double(column.x), Double(column.y), Double(column.z))
        }
        let screenPoint = SIMD2(Double(point.x), Double(point.y))
        let viewportSize = SIMD2(Double(viewport.width), Double(viewport.height))
        let destination: FarmPoint?
        if let projection = camera.components[OrthographicCameraComponent.self] {
            // Construct rays from the actual rendered transform, not the
            // RealityView default camera, in both projection modes.
            destination = OrthographicGroundProjection.project(
                screenPoint: screenPoint, viewportSize: viewportSize,
                cameraPosition: vector(transform.columns.3), cameraRight: vector(transform.columns.0),
                cameraUp: vector(transform.columns.1), cameraForward: -vector(transform.columns.2),
                verticalHalfExtent: Double(projection.scale))
        } else if let projection = camera.components[PerspectiveCameraComponent.self] {
            destination = PerspectiveGroundProjection.project(
                screenPoint: screenPoint, viewportSize: viewportSize,
                cameraPosition: vector(transform.columns.3), cameraRight: vector(transform.columns.0),
                cameraUp: vector(transform.columns.1), cameraForward: -vector(transform.columns.2),
                verticalFieldOfView: Double(projection.fieldOfViewInDegrees))
        } else { destination = nil }
        guard let destination else { return }
        target = FarmPoint(x: min(39, max(-39, destination.x)), z: min(28, max(-30, destination.z)))
        navigation.choose(target!, state: tractorState, tool: tool, obstacles: obstacles)
        destinationMarker.position = [Float(target!.x), 0.10, Float(target!.z)]
        destinationMarker.isEnabled = true
        updateDestinationMarkerScale()
#if DEBUG
        if isUITesting { testSteeringCount += 1 }
#endif
        if !introDismissed { dismissIntro() }
        if hasDriven { scheduleControlsHide() }
    }

    private func updateDestinationMarkerScale() {
        // Keep tap feedback readable on a phone and at every zoom level.
        if let projection = camera.components[PerspectiveCameraComponent.self] {
            let transform = camera.transformMatrix(relativeTo: nil)
            let forward = -SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
            let depth = max(1, simd_dot(destinationMarker.position - camera.position, forward))
            let metresPerPoint = 2 * depth * tan(projection.fieldOfViewInDegrees * .pi / 360) / Float(viewport.height)
            destinationMarker.scale = SIMD3(repeating: min(1.4, max(0.35, metresPerPoint * 12)))
        } else if let projection = camera.components[OrthographicCameraComponent.self] {
            let metresPerPoint = projection.scale * 2 / Float(viewport.height)
            destinationMarker.scale = SIMD3(repeating: metresPerPoint * 12)
        }
    }

    func toggleCamera() {
        showControls()
        endPinch()
        cancelSteering()
        cameraMode = cameraMode == .overview ? .tractor : .overview
        if let marker = destinationMarker as? ModelEntity,
           var material = marker.model?.materials.first as? UnlitMaterial {
            material.readsDepth = cameraMode == .tractor
            marker.model?.materials = [material]
        }
        setViewportSize(viewport)
        updateLight()
        if !introDismissed { dismissIntro() }
        selectionFeedback()
        persist()
        showToast(cameraMode == .tractor ? "Hold to roll. Steer gently, then lift to settle." : "A little room to see it all.")
    }

    private func updateFollowCamera(deltaTime: Double = 0, snap: Bool = false) {
        guard cameraMode == .tractor else { return }
        let pose = followCamera.update(tractor: tractorState, zoom: Double(zoom), deltaTime: deltaTime,
                                       obstacles: obstacles, snap: snap || UIAccessibility.isReduceMotionEnabled)
        camera.look(at: SIMD3<Float>(pose.focus), from: SIMD3<Float>(pose.position), relativeTo: nil)
        updateDestinationMarkerScale()
    }

    func pinch(_ magnification: CGFloat) {
        if pinchStartZoom == nil { pinchStartZoom = zoom; stop(); steeringSuppressed = true }
        zoom = min(1.8, max(0.65, (pinchStartZoom ?? 1) * Float(magnification)))
        setViewportSize(viewport)
    }
    func endPinch() { pinchStartZoom = nil }
    func zoomIn() { showControls(); zoom = min(1.8, zoom + 0.15); setViewportSize(viewport); selectionFeedback() }
    func zoomOut() { showControls(); zoom = max(0.65, zoom - 0.15); setViewportSize(viewport); selectionFeedback() }
    func recenter() {
        showControls()
        zoom = cameraMode == .tractor ? Float(TractorFollowCamera.defaultZoom) : 1
        setViewportSize(viewport)
        selectionFeedback()
    }

    func selectTool(_ value: FarmTool) {
        showControls()
        guard value != tool else { return }
        tool = value
        navigation.changeTool(state: tractorState, tool: tool, obstacles: obstacles)
        target = navigation.target
        updateAttachment()
        selectionFeedback()
        persist()
    }
    func selectCrop(_ value: Crop) {
        showControls()
        guard value != selectedCrop else { return }
        selectedCrop = value
        selectionFeedback()
    }
    func dismissIntro() { introDismissed = true; persist() }
    func togglePause() { showControls(); isPaused.toggle(); stop(); persist(); selectionFeedback() }
    func toggleSound() {
        showControls()
        soundEnabled.toggle()
        audio.setEnabled(soundEnabled)
        selectionFeedback()
    }
    /// Photograph the meadow as it is on screen, then show it on its card.
    func takePostcard() {
        guard !isCapturing, !isLoading, errorMessage == nil else { return }
        stop()
        selectionFeedback()
        isCapturing = true
        Task { [weak self] in
            // One beat for the controls to clear and the scene to draw a frame without them.
            try? await Task.sleep(for: .milliseconds(150))
            guard let self else { return }
            let photo = PostcardMaker.photograph()
            self.isCapturing = false
            guard let photo,
                  let postcard = PostcardMaker.make(photo: photo, title: Daylight.copy(for: self.dayPhase).title,
                                                    line: PostcardCaption.growing(in: self.field)) else {
                self.showToast("The camera couldn’t see the meadow just now.")
                return
            }
            self.postcard = postcard
            self.activeSheet = .postcard
        }
    }

    func setActive(_ active: Bool) {
        isActive = active
        skipGrowthFrame = true
        audio.setActive(active)
        if !active { cancelControlsHide(); endPinch(); stop(); persist() }
    }

    func showControls() {
        cancelControlsHide()
        controlsHidden = false
    }

    func toggleControls() {
        if controlsHidden { showControls() }
        else { cancelControlsHide(); controlsHidden = true }
    }

    private func cancelControlsHide() {
        controlsHideTask?.cancel()
        controlsHideTask = nil
    }

    private func scheduleControlsHide(after delay: Double = 2) {
        guard !controlsHidden, controlsHideTask == nil else { return }
        // Repeated drag events must not postpone the quiet view indefinitely.
        controlsHideTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) }
            catch { return }
            guard let self else { return }
            self.controlsHideTask = nil
            guard self.isActive, !self.isPaused, self.activeSheet == nil else { return }
            self.controlsHidden = true
        }
    }
    func resetMeadow() {
        stop()
        field.reset()
        navigation = TractorNavigation()
        tractorState = TractorState()
        syncTractor()
        updateFollowCamera(snap: true)
        fieldRenderer?.reset(grid: field)
        do { try fieldRenderer?.flush() } catch { recordRenderingError(error) }
        dirty = true
        persist()
        selectionFeedback()
        showToast("A fresh beginning. Take your time.")
    }

    private func update(deltaTime: TimeInterval) {
        guard !isLoading, isActive, !isPaused, activeSheet == nil else { return }
        let activeSeconds = skipGrowthFrame || !deltaTime.isFinite ? 0 : max(0, deltaTime)
        skipGrowthFrame = false
        let dt = min(0.05, activeSeconds)
        let growth = field.advance(seconds: activeSeconds, configuration: farmingConfiguration)
        fieldRenderer?.respond(to: growth, grid: field)
        fieldRenderer?.animate(seconds: dt)
        if growth.advancedSeconds > 0 { dirty = true }
        elapsed += dt
        // The day runs on the crops' clock. It rests whenever they do.
        if light == .flow {
            dayTime = Daylight.wrap(dayTime + activeSeconds)
            if abs(dayTime - litDay) >= 0.25 { updateLight() }
        }
        let input: DriveInput? = cameraMode == .tractor && steeringGesture?.isDriving(at: elapsed) == true
            ? .drag(steeringGesture!.drag) : nil
        let movement = navigation.step(tractorState, deltaTime: dt, tool: tool, obstacles: obstacles,
                                       pace: pace, manual: input, follow: cameraMode == .tractor)
        tractorState = movement.state
        target = navigation.target
        destinationMarker.isEnabled = target != nil
        var changedCells: [Int] = []
        for (index, point) in movement.paint.enumerated() {
            let events = field.apply(from: movement.paint[max(0, index - 1)], to: point, tool: tool, crop: selectedCrop)
            changedCells += events.changedCells
            fieldRenderer?.respond(to: events, grid: field)
            if let harvest = events.harvestResults.first, elapsed - lastHarvestSound > 1.2 {
                audio.harvest(harvest.crop); lastHarvestSound = elapsed
            }
        }
        if !changedCells.isEmpty {
            dirty = true
#if DEBUG
            if isUITesting { testPaintedCells += changedCells.count }
#endif
        }
        if tractorState.speed > 0.1 {
            if !hasDriven {
                hasDriven = true
                toastTask?.cancel()
                toast = nil
                scheduleControlsHide(after: 3.2)
            }
            dirty = true
            wheelAngle += Float(tractorState.speed * dt / 0.7)
        }
        if let attachment = tractor.findEntity(named: "attachment") {
            let desired: Float = navigation.turningAtRowEnd ? 0.4 : 0
            attachment.position.y += (desired - attachment.position.y) * Float(1 - exp(-8 * dt))
        }
        if elapsed - lastFlush >= 1.0 / 12 {
            do { try fieldRenderer?.flush() } catch { recordRenderingError(error) }
            lastFlush = elapsed
        }
        syncTractor()
        updateFollowCamera(deltaTime: dt)
        // A gust reads the field as it crosses: each beat sounds what grows there.
        let gust = wind.advance(seconds: activeSeconds)
        for step in gust.steps {
            for note in WindScore.notes(in: field, step: step) {
                let pitch = note.voice.crop.map { WindScore.frequency($0, band: note.band, night: glow > 0.6) } ?? 0
                audio.windNote(note.voice, frequency: pitch, level: note.level * WindScore.accent(step: step),
                               pan: Double(step) / Double(WindScore.steps - 1) * 1.2 - 0.6)
            }
        }
        audio.setGust(gust.strength)
        let still = UIAccessibility.isReduceMotionEnabled
        var front = still ? nil : gust.front
#if DEBUG
        if let heldGustFront { front = heldGustFront }
#endif
        fieldRenderer?.lean(front: front, time: elapsed)
        dusk?.animate(time: still ? 0 : elapsed)
        for (wheel, original) in wheels { wheel.orientation = original * simd_quatf(angle: wheelAngle, axis: [1, 0, 0]) }
        if !still {
            // The windmills pick up while the gust passes.
            sailTurn += Float(dt * (1 + gust.strength * 2.2))
            for (sail, original, rate) in sails { sail.orientation = original * simd_quatf(angle: sailTurn * rate, axis: [0, 0, 1]) }
            for (index, bird) in birds.enumerated() {
                let phase = Float(elapsed) * 0.12 + Float(index) * 0.8
                bird.0.position = bird.1 + [sin(phase) * 2.0, sin(phase * 1.7) * 0.4, cos(phase) * 1.5]
            }
        }
        audio.setDriving(tractorState.speed / 6.875)
#if DEBUG
        updateTestTelemetry()
#endif
        if dirty && elapsed - lastSave > 3 { persist(); lastSave = elapsed }
    }

    private func stop() {
        navigation.cancel()
        steeringGesture = nil
        target = nil
        tractorState.speed = 0
        destinationMarker.isEnabled = false
        audio.setDriving(0)
#if DEBUG
        updateTestTelemetry(force: true)
#endif
    }
#if DEBUG
    private func updateTestTelemetry(force: Bool = false) {
        guard isUITesting, force || elapsed - lastTelemetry >= 0.5 else { return }
        testTelemetry = String(format: "x=%.3f,z=%.3f,speed=%.3f,zoom=%.3f", tractorState.x, tractorState.z, tractorState.speed, Double(zoom))
            + ",painted=\(testPaintedCells)"
            + ",growing=\(field.cells.filter { $0 == Ground.growing.rawValue }.count)"
            + ",mature=\(field.cells.filter { $0 == Ground.mature.rawValue }.count)"
            + ",wheatDisplay=\(field.display[0]),sunflowerDisplay=\(field.display[1]),pumpkinDisplay=\(field.display[2])"
            + ",steeringCount=\(testSteeringCount),marker=\(destinationMarker.isEnabled ? 1 : 0)"
            + ",touchCount=\(testTouchCount)"
            + ",rowTurn=\(navigation.turningAtRowEnd ? 1 : 0)"
            + ",tractorView=\(cameraMode == .tractor ? 1 : 0)"
            + ",gust=\(wind.isGusting ? 1 : 0)"
            + ",lean=\(Int(((fieldRenderer?.strongestLean ?? 0) * 1000).rounded()))"
            + String(format: ",heading=%.3f,cameraX=%.3f,cameraY=%.3f,cameraZ=%.3f",
                     tractorState.heading, Double(camera.position.x), Double(camera.position.y), Double(camera.position.z))
        if let target {
            testTelemetry += String(format: ",targetX=%.3f,targetZ=%.3f", target.x, target.z)
        }
        lastTelemetry = elapsed
    }
#endif
    private func syncTractor() {
        let bounce = !UIAccessibility.isReduceMotionEnabled && tractorState.speed > 0.2 ? sin(elapsed * 9) * 0.025 : 0
        tractor.position = [Float(tractorState.x), Float(bounce), Float(tractorState.z)]
        tractor.orientation = simd_quatf(angle: Float(tractorState.heading), axis: [0, 1, 0])
    }
    private func updateAttachment() {
        tractor.findEntity(named: "attachment")?.isEnabled = tool != .wander
        tractor.findEntity(named: "seed-box")?.isEnabled = tool == .sow
        for index in 0..<7 { tractor.findEntity(named: "till-tooth-\(index)")?.isEnabled = tool == .cultivate }
        if let mower = tractor.findEntity(named: "mower") {
            for case let part as ModelEntity in mower.children {
                var material = PhysicallyBasedMaterial()
                material.baseColor = .init(tint: UIColor(farmHex: tool == .cultivate ? "#AE7859" : "#91B399"))
                material.roughness = 0.65
                material.specular = 0.22
                part.model?.materials = [material]
            }
        }
    }
    private func lightChanged() {
        // A held light jumps to its moment; drifting carries on from wherever it is.
        if let held = Daylight.holdSeconds(light) { dayTime = held }
        updateLight()
        persist()
    }

    /// Set the lights, the lamps, the soundscape, and the interface's tint for
    /// this moment of the day. Called a few times a second while the day drifts.
    private func updateLight() {
        let now = Daylight.at(dayTime)
        litDay = dayTime
        glow = now.glow
        func color(_ rgb: SIMD3<Double>) -> UIColor {
            UIColor(red: rgb.x, green: rgb.y, blue: rgb.z, alpha: 1)
        }
        // Use the web light colors; RealityKit lux are calibrated separately from
        // Three.js intensity to retain the web's bright, softly muted appearance.
        // The morning light is 2,500 lux of sun and 1,200 of fill, as before.
        sun.components.set(DirectionalLightComponent(color: color(now.sun), intensity: Float(now.sunPower * 2500 / 3.1)))
        sun.look(at: .zero, from: SIMD3<Float>(now.sunFrom * 67.4), relativeTo: nil)
        fillLight.components.set(DirectionalLightComponent(color: color(now.skyLight), intensity: Float(now.ambient * 480)))
        // Cream sky by day, gold towards evening, moonlight after dark. Only two
        // of the three are ever blended, because moonlight follows gold.
        let source: ImageBasedLightComponent.Source?
        if now.moon > 0.001, let goldenDaylight, let nightDaylight {
            source = now.moon > 0.999 ? .single(nightDaylight) : .blend(goldenDaylight, nightDaylight, Float(now.moon))
        } else if now.warmth > 0.001, let daylight, let goldenDaylight {
            source = now.warmth > 0.999 ? .single(goldenDaylight) : .blend(daylight, goldenDaylight, Float(now.warmth))
        } else if let environment = daylight ?? goldenDaylight ?? nightDaylight {
            source = .single(environment)
        } else {
            source = nil
        }
        if let source {
            // Exponent 1 in the morning and 0.68 at golden hour, as before.
            root.components.set(ImageBasedLightComponent(source: source, intensityExponent: Float(1 + log2(now.ambient / 2.5))))
            root.components.set(ImageBasedLightReceiverComponent(imageBasedLight: root))
        }
        dusk?.update(glow: now.glow)
        audio.setAmbience(birdsong: now.birds, crickets: now.glow)
        let tint = SkyTint(now)
        if tint != self.tint { self.tint = tint }
        if now.phase != dayPhase { dayPhase = now.phase }
        var shadows = DirectionalLightComponent.Shadow()
        shadows.shadowProjection = .automatic(maximumDistance: cameraMode == .tractor ? 65 : 160)
        shadows.depthBias = 1.0
        sun.components.set(shadows)
    }
    private func persist() {
        guard saveReady else { return }
        if savePreservationPending {
            do {
                // The original might become readable after launch. It still
                // belongs to the previous session, so preserve it before writing
                // the fresh meadow that the player has already started here.
                try MeadowStore.preserveExistingSave(at: saveURL)
                savePreservationPending = false
            } catch {
                hasSaveError = true
                logger.error("Save deferred to protect the previous meadow: \(String(describing: error), privacy: .public)")
                return
            }
        }
        let saved = MeadowSave(field: field, tractor: TractorState(x: tractorState.x, z: tractorState.z,
                               heading: tractorState.heading, speed: 0), tool: tool, rowAssist: false,
                               pace: pace, goldenLight: light == .golden, volume: volume,
                               haptics: haptics, introDismissed: introDismissed, cameraMode: cameraMode, selectedCrop: selectedCrop,
                               light: light, day: dayTime)
        do { try MeadowStore.save(saved, to: saveURL); hasSaveError = false; dirty = false }
        catch { hasSaveError = true; logger.error("Save failed: \(String(describing: error), privacy: .public)") }
    }
    private func selectionFeedback() { if haptics { feedback.selectionChanged() } }
    private func recordRenderingError(_ error: Error) {
        logger.error("Field update failed: \(String(describing: error), privacy: .public)")
        isPaused = true
        stop()
        errorMessage = "The meadow needs a moment. Reopen Stillfield to continue from your last save."
    }
    private func showToast(_ text: String) {
        toastTask?.cancel()
        toast = text
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { self?.toast = nil }
        }
    }
    private static func makeDestinationMarker(readsDepth: Bool) throws -> Entity {
        var descriptor = MeshDescriptor()
        var positions: [SIMD3<Float>] = [], normals: [SIMD3<Float>] = [], indices: [UInt32] = []
        for index in 0...48 {
            let angle = Float(index) / 48 * 2 * .pi
            for radius: Float in [0.78, 1] { positions.append([sin(angle) * radius, 0, cos(angle) * radius]); normals.append([0, 1, 0]) }
            // Counter-clockwise from above; the original ring faced into the soil.
            if index < 48 { let i = UInt32(index * 2); indices += [i, i + 1, i + 2, i + 1, i + 3, i + 2] }
        }
        descriptor.positions = .init(positions)
        descriptor.normals = .init(normals)
        descriptor.primitives = .triangles(indices)
        var material = UnlitMaterial(color: UIColor(farmHex: "#F8F1D9"))
        material.blending = .transparent(opacity: .init(floatLiteral: 0.92))
        // The overhead marker stays readable through grass; in tractor view it
        // must sit behind the tractor and scenery rather than showing on the roof.
        material.readsDepth = readsDepth
        material.writesDepth = false
        return ModelEntity(mesh: try MeshResource.generate(from: [descriptor]), materials: [material])
    }
}
