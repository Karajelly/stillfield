import RealityKit
import StillfieldCore
import UIKit
import simd

/// One quiet display per field. Produce is decoration, never an inventory.
@MainActor
final class HarvestDisplayRenderer {
    let entity = Entity()
    private var sections: [Crop: Entity] = [:]
    private var items: [Crop: [Entity]] = [:]
    private var stages: [Crop: Int] = [:]
    private struct Flight {
        let entity: Entity
        let crop: Crop
        let start: SIMD3<Float>
        let end: SIMD3<Float>
        var age: Double
    }
    private var flights: [Flight] = []
    private let sphere = MeshResource.generateSphere(radius: 1)
    private let box = MeshResource.generateBox(size: 1, cornerRadius: 0.06)
    private let cylinder = MeshResource.generateCylinder(height: 1, radius: 1)
    private var materials: [String: SimpleMaterial] = [:]

    init(grid: FieldGrid) {
        entity.name = "Harvests by the field"
        entity.position = [Float(grid.displayLocation.x), 0.1, Float(grid.displayLocation.z)]
        for (index, crop) in Crop.allCases.enumerated() {
            let section = Entity()
            section.name = crop.title
            section.position.x = Float(index - 1) * 3.2
            entity.addChild(section); sections[crop] = section
            if crop != .sunflowers {
                part(section, box, color: "#AD8861", at: [0, 0.48, 0], scale: [1.8, 0.13, 1.2])
                for z: Float in [-0.6, 0.6] {
                    for y: Float in [0.62, 0.84] {
                        part(section, box, color: "#AD8861", at: [0, y, z], scale: [1.9, 0.13, 0.08])
                    }
                }
                for x: Float in [-0.93, 0.93] { part(section, box, color: "#AD8861", at: [x, 0.7, 0], scale: [0.08, 0.4, 1.2]) }
                for z: Float in [-0.48, 0.48] { part(section, box, color: "#AD8861", at: [1.35, 0.65, z], scale: [1.25, 0.08, 0.08]) }
                if crop == .wheat {
                    let wheel = part(section, cylinder, color: "#75634A", at: [-0.95, 0.28, 0], scale: [0.3, 0.12, 0.3])
                    wheel.orientation = simd_quatf(angle: .pi / 2, axis: [1, 0, 0])
                    for z: Float in [-0.45, 0.45] { part(section, box, color: "#AD8861", at: [0.55, 0.25, z], scale: [0.08, 0.4, 0.08]) }
                } else {
                    for x: Float in [-0.65, 0.65] {
                        for z: Float in [-0.72, 0.72] {
                            let wheel = part(section, cylinder, color: "#75634A", at: [x, 0.28, z], scale: [0.3, 0.12, 0.3])
                            wheel.orientation = simd_quatf(angle: .pi / 2, axis: [1, 0, 0])
                        }
                    }
                }
            }
            items[crop] = (0..<9).map { i in
                let item = produce(crop)
                let row = crop == .sunflowers ? Float(i / 3 - 1) : Float((i / 3) % 2) - 0.5
                item.position = [Float(i % 3 - 1) * 0.5, crop == .sunflowers ? 0.25 : 0.54 + Float(i / 6) * 0.3, row * 0.5]
                if crop == .sunflowers { part(item, cylinder, color: "#BD9679", at: .zero, scale: [0.22, 0.3, 0.22]) }
                if crop == .wheat { item.orientation = simd_quatf(angle: 0.8, axis: [0, 0, 1]); item.position.y += 0.12 }
                section.addChild(item)
                return item
            }
        }
        sync(grid: grid)
    }

    private func sync(grid: FieldGrid) {
        for crop in Crop.allCases {
            let stage = grid.displayStage(crop)
            guard stages[crop] != stage else { continue }
            stages[crop] = stage
            for (i, item) in (items[crop] ?? []).enumerated() { item.isEnabled = i < [0, 1, 4, 9][stage] }
        }
    }

    func harvest(_ results: [HarvestResult], grid: FieldGrid) {
        guard !results.isEmpty else { return }
        sync(grid: grid)
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        for result in results {
            guard flights.count < 3, !flights.contains(where: { $0.crop == result.crop }),
                  let section = sections[result.crop], !result.cells.isEmpty else { continue }
            let cell = result.cells[result.cells.count / 2]
            let world = SIMD3<Float>(Float(FieldGrid.minX + (Double(cell % FieldGrid.columns) + 0.5) * FieldGrid.cellSize), 0.4,
                                    Float(FieldGrid.minZ + (Double(cell / FieldGrid.columns) + 0.5) * FieldGrid.cellSize))
            let start = world - entity.position
            let item = produce(result.crop); item.position = start; item.scale = .init(repeating: 0.8)
            entity.addChild(item)
            flights.append(Flight(entity: item, crop: result.crop, start: start, end: section.position + [0, 0.9, 0], age: 0))
        }
    }

    func update(seconds: Double) {
        for i in flights.indices.reversed() {
            flights[i].age += seconds
            let flight = flights[i], t = Float(min(1, flight.age / 1.8)), eased = t * t * (3 - 2 * t)
            flight.entity.position = flight.start + (flight.end - flight.start) * eased + [0, sin(t * .pi) * 2, 0]
            let angle: Float = flight.crop == .wheat ? eased * 0.8 : flight.crop == .pumpkins ? sin(t * .pi) * 0.3 : 0
            flight.entity.orientation = simd_quatf(angle: angle, axis: [0, 0, 1])
            flight.entity.scale = .init(repeating: 0.8 * (1 - 0.2 * t))
            if t == 1 { flight.entity.removeFromParent(); flights.remove(at: i) }
        }
    }
    func clear(grid: FieldGrid) {
        for flight in flights { flight.entity.removeFromParent() }
        flights.removeAll(); sync(grid: grid)
    }

    private func produce(_ crop: Crop) -> Entity {
        let group = Entity()
        if crop == .pumpkins {
            for i in 0..<7 {
                let a = Float(i) / 7 * .pi * 2
                part(group, sphere, color: "#CE884A", at: [sin(a) * 0.12, 0.25, cos(a) * 0.12], scale: [0.23, 0.235, 0.23])
            }
            part(group, cylinder, color: "#75634A", at: [0, 0.51, 0], scale: [0.04, 0.17, 0.04])
        } else {
            for i in 0..<(crop == .wheat ? 7 : 3) {
                let a = Float(i) * 2.4, x = sin(a) * 0.16, z = cos(a) * 0.16, h = 0.65 + Float(i % 3) * 0.08
                part(group, cylinder, color: crop == .wheat ? "#D6B75F" : "#718B51", at: [x, h / 2, z], scale: [0.018, h, 0.018])
                if crop == .wheat {
                    part(group, sphere, color: "#D6B75F", at: [x, h, z], scale: [0.063, 0.225, 0.063])
                } else {
                    for j in 0..<8 {
                        let b = Float(j) / 8 * .pi * 2
                        part(group, sphere, color: "#E4C45E", at: [x + sin(b) * 0.14, h + cos(b) * 0.14, z], scale: [0.076, 0.095, 0.033])
                    }
                    part(group, sphere, color: "#796447", at: [x, h, z + 0.025], scale: [0.09, 0.09, 0.036])
                }
            }
            if crop == .wheat { part(group, cylinder, color: "#AD8861", at: [0, 0.3, 0], scale: [0.18, 0.05, 0.18]) }
        }
        return group
    }

    @discardableResult
    private func part(_ parent: Entity, _ mesh: MeshResource, color: String, at position: SIMD3<Float>, scale: SIMD3<Float>) -> ModelEntity {
        let material = materials[color] ?? SimpleMaterial(color: UIColor(farmHex: color), roughness: 1, isMetallic: false)
        materials[color] = material
        let model = ModelEntity(mesh: mesh, materials: [material])
        model.position = position; model.scale = scale; parent.addChild(model)
        return model
    }
}
