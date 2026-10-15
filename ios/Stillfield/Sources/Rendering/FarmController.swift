import Foundation
import Observation
import RealityKit
import StillfieldCore
import SwiftUI
import UIKit
import os

@MainActor @Observable
final class FarmController {
    var tool: FarmTool
    private(set) var cameraMode: FarmCameraMode
    var isPaused = false
    var soundEnabled = false
    var rowAssist: Bool { didSet { persist() } }
    var goldenLight: Bool { didSet { updateLight(); persist() } }
    var haptics: Bool { didSet { persist() } }
    var introDismissed: Bool
    var pace: Double { didSet { persist() } }
    var volume: Double { didSet { audio.setVolume(volume); persist() } }
    var isLoading = true
    var hasSaveError = false
    var errorMessage: String?
    var toast: String?
    var activeSheet: FarmSheet? { didSet { if activeSheet != nil { stop(); persist() } } }
#if DEBUG
    var testTelemetry = ""
    @ObservationIgnored private let isUITesting = ProcessInfo.processInfo.arguments.contains("--ui-testing")
    @ObservationIgnored private var testPaintedCells = 0
    @ObservationIgnored private var testSteeringCount = 0
    @ObservationIgnored private var testTouchCount = 0
    @ObservationIgnored private var lastTelemetry = -1.0
#endif

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
    @ObservationIgnored private var tractor = Entity()
    @ObservationIgnored private var destinationMarker = Entity()
    @ObservationIgnored private var obstacles: [Obstacle] = []
    @ObservationIgnored private var sails: [(Entity, simd_quatf, Float)] = []
    @ObservationIgnored private var wheels: [(Entity, simd_quatf)] = []
    @ObservationIgnored private var birds: [(Entity, SIMD3<Float>)] = []
    @ObservationIgnored private let audio = FarmAudio()
    @ObservationIgnored private let feedback = UISelectionFeedbackGenerator()
    @ObservationIgnored private var target: FarmPoint?
    @ObservationIgnored private var elapsed = 0.0
    @ObservationIgnored private var lastFlush = 0.0
    @ObservationIgnored private var lastPaint = 0.0
    @ObservationIgnored private var lastSave = 0.0
    @ObservationIgnored private var blockedTime = 0.0
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
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var toastTask: Task<Void, Never>?
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
        tractorState = saved.tractor
        tractorState.speed = 0
        tool = saved.tool
        cameraMode = saved.cameraMode ?? .overview
        rowAssist = saved.rowAssist
        goldenLight = saved.goldenLight
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
    }

    func load(into content: RealityViewCameraContent, size: CGSize, daylight: EnvironmentResource?) async {
        guard self.content == nil else { return }
        self.content = content
        viewport = size
        if let daylight {
            root.components.set(ImageBasedLightComponent(source: .single(daylight), intensityExponent: 0))
            root.components.set(ImageBasedLightReceiverComponent(imageBasedLight: root))
        }
        do {
            let artwork = try await FarmArtwork.load()
            let world = try await artwork.world.makeEntity()
            tractor = try await artwork.tractor.makeEntity()
            fieldRenderer = try await FieldRenderer(grid: field)
            obstacles = artwork.obstacles
            root.addChild(world)
            root.addChild(tractor)
            if let fieldRenderer { root.addChild(fieldRenderer.entity) }
            camera.name = "The unhurried camera"
            setViewportSize(size)
            root.addChild(camera)
            sun.components.set(DirectionalLightComponent(color: UIColor(farmHex: "#FFF0CE"), intensity: 1800))
            var shadows = DirectionalLightComponent.Shadow()
            shadows.shadowProjection = .automatic(maximumDistance: 160)
            shadows.depthBias = 1.0
            sun.components.set(shadows)
            sun.look(at: .zero, from: [-32, 55, 22], relativeTo: nil)
            fillLight.components.set(DirectionalLightComponent(color: UIColor(farmHex: "#DBE8D4"), intensity: 650))
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
        guard size.width > 0, size.height > 0 else { return }
        viewport = size
        let aspect = Float(size.width / size.height)
        if cameraMode == .overview {
            camera.components.remove(PerspectiveCameraComponent.self)
            var component = OrthographicCameraComponent()
            component.near = 0.1
            component.far = 300
            component.scaleDirection = .vertical
            // RealityKit's orthographic scale is a half-extent.
            component.scale = max(66, 64 / aspect) * 0.5 / zoom
            camera.components.set(component)
            camera.look(at: [-1, 0, -2], from: [59, 73, 87], relativeTo: nil)
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

    func steer(at point: CGPoint) {
#if DEBUG
        if isUITesting { testTouchCount += 1 }
        defer { updateTestTelemetry(force: true) }
#endif
        guard !isLoading, isActive, !isPaused, activeSheet == nil, pinchStartZoom == nil else { return }
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
        destinationMarker.position = [Float(target!.x), 0.10, Float(target!.z)]
        destinationMarker.isEnabled = true
        updateDestinationMarkerScale()
        blockedTime = 0
#if DEBUG
        if isUITesting { testSteeringCount += 1 }
#endif
        if !introDismissed { dismissIntro() }
    }

    private func updateDestinationMarkerScale() {
        // Keep tap feedback readable on a phone and at every zoom level.
        if let projection = camera.components[PerspectiveCameraComponent.self] {
            let transform = camera.transformMatrix(relativeTo: nil)
            let forward = -SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
            let depth = max(1, simd_dot(destinationMarker.position - camera.position, forward))
            let metresPerPoint = 2 * depth * tan(projection.fieldOfViewInDegrees * .pi / 360) / Float(viewport.height)
            destinationMarker.scale = SIMD3(repeating: min(1.4, max(0.35, metresPerPoint * 12)))
        } else {
            let aspect = Float(viewport.width / viewport.height)
            let metresPerPoint = max(66, 64 / aspect) / (zoom * Float(viewport.height))
            destinationMarker.scale = SIMD3(repeating: metresPerPoint * 12)
        }
    }

    func toggleCamera() {
        endPinch()
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
        showToast(cameraMode == .tractor ? "Along for the ride. Tap the ground to steer." : "A little room to see it all.")
    }

    private func updateFollowCamera(deltaTime: Double = 0, snap: Bool = false) {
        guard cameraMode == .tractor else { return }
        let pose = followCamera.update(tractor: tractorState, zoom: Double(zoom), deltaTime: deltaTime,
                                       obstacles: obstacles, snap: snap || UIAccessibility.isReduceMotionEnabled)
        camera.look(at: SIMD3<Float>(pose.focus), from: SIMD3<Float>(pose.position), relativeTo: nil)
        updateDestinationMarkerScale()
    }

    func pinch(_ magnification: CGFloat) {
        if pinchStartZoom == nil { pinchStartZoom = zoom; stop() }
        zoom = min(1.8, max(0.65, (pinchStartZoom ?? 1) * Float(magnification)))
        setViewportSize(viewport)
    }
    func endPinch() { pinchStartZoom = nil }
    func zoomIn() { zoom = min(1.8, zoom + 0.15); setViewportSize(viewport); selectionFeedback() }
    func zoomOut() { zoom = max(0.65, zoom - 0.15); setViewportSize(viewport); selectionFeedback() }
    func recenter() {
        zoom = cameraMode == .tractor ? Float(TractorFollowCamera.defaultZoom) : 1
        setViewportSize(viewport)
        selectionFeedback()
    }

    func selectTool(_ value: FarmTool) {
        guard value != tool else { return }
        tool = value
        updateAttachment()
        selectionFeedback()
        persist()
    }
    func dismissIntro() { introDismissed = true; persist() }
    func togglePause() { isPaused.toggle(); stop(); persist(); selectionFeedback() }
    func toggleSound() {
        soundEnabled.toggle()
        audio.setEnabled(soundEnabled)
        selectionFeedback()
    }
    func setActive(_ active: Bool) {
        isActive = active
        audio.setActive(active)
        if !active { endPinch(); stop(); persist() }
    }
    func resetMeadow() {
        stop()
        field.reset()
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
        let dt = min(0.05, max(0, deltaTime))
        elapsed += dt
        let previous = tractorState
        tractorState = FarmSimulation.advance(tractorState, toward: target, deltaTime: dt,
                                              obstacles: obstacles, rowAssist: rowAssist, pace: pace)
        if target != nil && hypot(tractorState.x - previous.x, tractorState.z - previous.z) < 0.003 && tractorState.speed < 0.15 {
            blockedTime += dt
            if blockedTime > 1 { target = nil; destinationMarker.isEnabled = false }
        } else { blockedTime = 0 }
        if let target, hypot(target.x - tractorState.x, target.z - tractorState.z) < 0.5 {
            self.target = nil
            destinationMarker.isEnabled = false
        }
        if tractorState.speed > 0.1 {
            dirty = true
            wheelAngle += Float(tractorState.speed * dt / 0.7)
            if elapsed - lastPaint >= 1.0 / 24 {
                let cells = field.paint(x: tractorState.x - sin(tractorState.heading) * 2.1,
                                       z: tractorState.z - cos(tractorState.heading) * 2.1, tool: tool)
                if !cells.isEmpty { fieldRenderer?.update(grid: field, changedCells: cells) }
#if DEBUG
                if isUITesting { testPaintedCells += cells.count }
#endif
                lastPaint = elapsed
            }
        }
        if elapsed - lastFlush >= 1.0 / 12 {
            do { try fieldRenderer?.flush() } catch { recordRenderingError(error) }
            lastFlush = elapsed
        }
        syncTractor()
        updateFollowCamera(deltaTime: dt)
        for (wheel, original) in wheels { wheel.orientation = original * simd_quatf(angle: wheelAngle, axis: [1, 0, 0]) }
        if !UIAccessibility.isReduceMotionEnabled {
            for (sail, original, rate) in sails { sail.orientation = original * simd_quatf(angle: Float(elapsed) * rate, axis: [0, 0, 1]) }
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
            + ",steeringCount=\(testSteeringCount),marker=\(destinationMarker.isEnabled ? 1 : 0)"
            + ",touchCount=\(testTouchCount)"
            + ",tractorView=\(cameraMode == .tractor ? 1 : 0)"
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
        for index in 0..<7 { tractor.findEntity(named: "till-tooth-\(index)")?.isEnabled = tool == .till }
        if let mower = tractor.findEntity(named: "mower") {
            for case let part as ModelEntity in mower.children {
                var material = PhysicallyBasedMaterial()
                material.baseColor = .init(tint: UIColor(farmHex: tool == .till ? "#AE7859" : "#91B399"))
                material.roughness = 0.65
                material.specular = 0.22
                part.model?.materials = [material]
            }
        }
    }
    private func updateLight() {
        sun.components.set(DirectionalLightComponent(color: UIColor(farmHex: goldenLight ? "#FFD8A5" : "#FFF2D9"), intensity: goldenLight ? 1700 : 1400))
        fillLight.components.set(DirectionalLightComponent(color: UIColor(farmHex: goldenLight ? "#F2DFBE" : "#E3EEDF"), intensity: 850))
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
                               heading: tractorState.heading, speed: 0), tool: tool, rowAssist: rowAssist,
                               pace: pace, goldenLight: goldenLight, volume: volume,
                               haptics: haptics, introDismissed: introDismissed, cameraMode: cameraMode)
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
