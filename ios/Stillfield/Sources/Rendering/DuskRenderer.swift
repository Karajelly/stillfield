import Foundation
import RealityKit
import UIKit
import simd

/// The small lights that come on as the day ends: warm windows in the barn and
/// the windmill, the tractor's lamps, and fireflies over the pond. They are
/// separate entities placed against the bundled artwork, so `FarmScene.json`
/// stays as exported. Keep positions in sync with src/dusk.ts.
@MainActor
final class DuskRenderer {
    /// Window panes, lamp pools, and fireflies, in world metres.
    let entity = Entity()
    /// Lenses and the headlight beam, in the tractor's own space.
    let lamps = Entity()

    // Light strengths were worked out on paper from the daylight calibration in
    // FarmController, not yet tuned by eye on a device.
    private static let barnLumens: Float = 450_000
    private static let millLumens: Float = 180_000
    private static let beamLumens: Float = 700_000

    private struct Pane {
        let model: ModelEntity
        let color: UIColor
        let strength: Float
    }

    private struct Firefly {
        let model: ModelEntity
        let home: SIMD3<Float>
        let phase: Float
        let pace: Float
    }

    private var panes: [Pane] = []
    private let barnLamp = Entity()
    private let millLamp = Entity()
    private let beam = Entity()
    private let fireflies = Entity()
    private var flies: [Firefly] = []
    private var shownGlow: Float = -1

    init() {
        entity.name = "dusk"
        lamps.name = "lamps"
        let windowLight = UIColor(farmHex: "#FFD38A")
        // Each pane sits a few millimetres proud of the dark glass in the artwork.
        let barnX: Float = -23, barnZ: Float = -24, millX: Float = 26, millZ: Float = -10.8
        addPane(to: entity, at: [barnX, 1.85, barnZ + 3.615], width: 3.2, height: 3.7,
                color: UIColor(farmHex: "#E9A45C"), strength: 0.85)
        addPane(to: entity, at: [barnX, 5.65, barnZ + 3.615], width: 1.2, height: 1.1, color: windowLight)
        addPane(to: entity, at: [barnX + 4.685, 2.8, barnZ], width: 1.7, height: 1.3, color: windowLight,
                turn: .pi / 2)
        for y: Float in [4.1, 6.3] {
            addPane(to: entity, at: [millX, y, millZ + 1.705 - (y - 4) * 0.08], width: 0.55, height: 0.9,
                    color: windowLight)
        }

        // Two soft pools of lamplight on the ground, by the barn and the windmill.
        barnLamp.position = [barnX + 5.2, 3.4, barnZ + 6]
        millLamp.position = [millX, 3.2, millZ + 3.4]
        entity.addChild(barnLamp)
        entity.addChild(millLamp)

        // The tractor's lamps: lit lenses, tail lights, and a beam down the row.
        for side: Float in [-1, 1] {
            addPane(to: lamps, at: [side * 0.52, 1.39, 1.572], width: 0.25, height: 0.25,
                    color: UIColor(farmHex: "#FFF3CF"), round: true)
            addPane(to: lamps, at: [side * 1.01, 1.13, -1.75], width: 0.2, height: 0.13,
                    color: UIColor(farmHex: "#FF8A6E"), strength: 0.9, turn: .pi, round: true)
        }
        lamps.addChild(beam)
        beam.look(at: [0, 0, 11], from: [0, 1.9, 1.3], relativeTo: lamps)

        // Fireflies drift over the pond and the reeds around it.
        let count = 54
        let body = MeshResource.generateSphere(radius: 0.15)
        let glow = UnlitMaterial(color: UIColor(farmHex: "#FFE27A"))
        for index in 0..<count {
            let turn = Float(index) * 2.399963
            let reach = (Float(index) + 0.5) / Float(count)
            let model = ModelEntity(mesh: body, materials: [glow])
            let home: SIMD3<Float> = [
                30.5 + cos(turn) * reach.squareRoot() * 11.5,
                0.5 + Float((index * 7) % 11) * 0.17,
                20 + sin(turn) * reach.squareRoot() * 8.5,
            ]
            model.position = home
            fireflies.addChild(model)
            flies.append(Firefly(model: model, home: home, phase: Float(index) * 1.7,
                                 pace: 0.5 + Float((index * 13) % 7) * 0.09))
        }
        fireflies.isEnabled = false
        entity.addChild(fireflies)
        update(glow: 0)
    }

    /// `glow` is 0 by day and 1 after dark. Lights are rebuilt only when it moves.
    func update(glow: Double) {
        let on = Float(max(0, min(1, glow)))
        guard abs(on - shownGlow) >= 0.02 || (on == 0) != (shownGlow == 0) || (on == 1) != (shownGlow == 1) else { return }
        shownGlow = on
        let lit = on > 0
        for pane in panes {
            pane.model.isEnabled = lit
            guard lit else { continue }
            var material = UnlitMaterial(color: pane.color)
            material.blending = .transparent(opacity: .init(floatLiteral: on * pane.strength))
            material.writesDepth = false
            pane.model.model?.materials = [material]
        }
        for lamp in [barnLamp, millLamp, beam] { lamp.isEnabled = lit }
        guard lit else {
            fireflies.isEnabled = false
            return
        }
        barnLamp.components.set(PointLightComponent(color: UIColor(farmHex: "#FFB066"),
                                                    intensity: on * Self.barnLumens, attenuationRadius: 26))
        millLamp.components.set(PointLightComponent(color: UIColor(farmHex: "#FFBE7A"),
                                                    intensity: on * Self.millLumens, attenuationRadius: 15))
        beam.components.set(SpotLightComponent(color: UIColor(farmHex: "#FFE7B4"), intensity: on * Self.beamLumens,
                                               innerAngleInDegrees: 18, outerAngleInDegrees: 30,
                                               attenuationRadius: 24))
        fireflies.isEnabled = on > 0.35
    }

    /// Call each frame after dark. A still `time` holds the fireflies in place.
    func animate(time: Double) {
        guard fireflies.isEnabled else { return }
        // They come out a little after the windows do.
        let out = max(0, (shownGlow - 0.35) / 0.65)
        for fly in flies {
            let t = Float(time) * fly.pace + fly.phase
            fly.model.position = fly.home + [sin(t * 0.31) * 1.6, sin(t * 0.47 + 1) * 0.35, cos(t * 0.23) * 1.3]
            // Each one glows and fades on its own slow rhythm.
            let blink = pow(max(0, sin(t * 0.9)), 3) * out
            fly.model.scale = SIMD3(repeating: max(0.001, blink))
        }
    }

    private func addPane(to parent: Entity, at position: SIMD3<Float>, width: Float, height: Float,
                         color: UIColor, strength: Float = 1, turn: Float = 0, round: Bool = false) {
        let mesh = MeshResource.generatePlane(width: width, height: height,
                                              cornerRadius: round ? min(width, height) / 2 : 0)
        let model = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
        model.position = position
        // A plane faces +z; a quarter turn about y faces it along +x.
        model.orientation = simd_quatf(angle: turn, axis: [0, 1, 0])
        model.isEnabled = false
        parent.addChild(model)
        panes.append(Pane(model: model, color: color, strength: strength))
    }
}
