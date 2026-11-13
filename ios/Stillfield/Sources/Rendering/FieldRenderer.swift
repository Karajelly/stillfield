import CoreGraphics
import Foundation
import RealityKit
import StillfieldCore
import UIKit
import simd

/// A paintable field with a single soil texture and small, independently rebuilt
/// vegetation patches. Painting never creates an entity for each blade or cell.
@MainActor
final class FieldRenderer {
    let entity = Entity()

    private static let pixelsPerCell = 5
    /// Patches per field, at the home field's density: 8 by 6 there, more in a larger field.
    private static func tiles(_ bounds: FieldBounds) -> (columns: Int, rows: Int) {
        (max(1, Int((Double(bounds.columns) * 8 / 90).rounded())), max(1, Int((Double(bounds.rows) * 6 / 50).rounded())))
    }
    /// The field this renderer draws.
    let bounds: FieldBounds
    // sRGB swatches shared with src/field.ts: meadow flowers, foliage, and harvest colors.
    nonisolated private static let vegetationPalette: [UInt32] = [
        0x9AAB68, 0x7E9557, 0xA8B775,
        0xEEE7C3, 0xD8BB75, 0xD3AB9B, 0xB9A9CF, 0xF3EBCE,
        0x718B51, 0xD6B75F, 0xE4C45E, 0x796447, 0xCE884A, 0xAD8861,
        0xEDCF88, 0xF4E1B0, 0xEAA15B, 0x6D6145
    ]
    private static let textureOptions = TextureResource.CreateOptions(
        semantic: .color,
        mipmapsMode: .none
    )

    private struct Plant {
        let x: Float
        let z: Float
        let height: Float
        let angle: Float
        let cell: Int
        let hasFlower: Bool
        let wildflower: Bool
        let tone: UInt32
        let flowerTone: UInt32
    }

    private enum RenderingError: Error {
        case bitmapUnavailable
    }

    private let bitmap: CGContext
    private let texture: TextureResource
    private let materials: [PhysicallyBasedMaterial]
    private var cells: [UInt8]
    private var crops: [UInt8]
    private var stages: [Int]
    private let harvestDisplay: HarvestDisplayRenderer
    private var plants: [[Plant]]
    private var tiles: [ModelEntity]
    // Each patch sits inside a parent, so the pair can shear it as a gust passes.
    private var leaners: [Entity] = []
    private var leaning: [Float] = []
    private var dirtyTiles = Set<Int>()
    private var textureDirty = false

    init(grid: FieldGrid) async throws {
        // A local copy: a class can't read its own properties until all are set.
        let bounds = grid.bounds
        self.bounds = bounds
        let width = bounds.columns * Self.pixelsPerCell
        let height = bounds.rows * Self.pixelsPerCell
        guard let bitmap = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw RenderingError.bitmapUnavailable
        }
        self.bitmap = bitmap
        self.cells = grid.cells
        self.crops = grid.crops
        self.stages = grid.cells.indices.map { grid.stage(at: $0) }
        self.harvestDisplay = HarvestDisplayRenderer(grid: grid)
        // The original field keeps its established planting; others get their own.
        self.plants = Self.makePlants(bounds, seed: grid.bounds == .home ? 22 : 61)
        self.tiles = []
        // A shared swatch atlas keeps every patch to one draw, even in a field
        // full of multicolored flowers. All vertices sample a swatch's center.
        let palette = Self.vegetationPalette
        guard let swatches = CGContext(data: nil, width: palette.count, height: 1,
                                       bitsPerComponent: 8, bytesPerRow: palette.count * 4,
                                       space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                       bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw RenderingError.bitmapUnavailable
        }
        for (index, hex) in palette.enumerated() {
            swatches.setFillColor(Self.color(hex).cgColor)
            swatches.fill(CGRect(x: index, y: 0, width: 1, height: 1))
        }
        guard let paletteImage = swatches.makeImage() else { throw RenderingError.bitmapUnavailable }
        let paletteTexture = try await TextureResource(image: paletteImage, options: Self.textureOptions)
        var vegetationMaterial = Self.matteMaterial(0xFFFFFF, doubleSided: true)
        vegetationMaterial.baseColor.texture = .init(paletteTexture)
        self.materials = [vegetationMaterial]

        // Bitmap row zero represents the northern edge, z == minZ. Explicit
        // ground UVs below keep painted cells and their plants in agreement.
        bitmap.setShouldAntialias(false)
        for index in grid.cells.indices {
            Self.drawCell(index, columns: bounds.columns, state: grid.cells[index], crop: grid.crop(at: index),
                          stage: grid.stage(at: index), in: bitmap)
        }
        guard let image = bitmap.makeImage() else {
            throw RenderingError.bitmapUnavailable
        }
        self.texture = try await TextureResource(
            image: image,
            options: Self.textureOptions
        )

        entity.name = "The living field"
        entity.addChild(harvestDisplay.entity)
        var groundMaterial = Self.matteMaterial(0xFFFFFF)
        groundMaterial.baseColor.texture = .init(texture)
        let ground = ModelEntity(
            mesh: try Self.makeGround(bounds),
            materials: [groundMaterial]
        )
        ground.name = "Painted field surface"
        entity.addChild(ground)

        for index in plants.indices {
            let tile = ModelEntity()
            tile.name = "Meadow patch \(index)"
            tiles.append(tile)
            let leaner = Entity()
            leaner.name = "Leaning patch \(index)"
            leaner.addChild(tile)
            leaners.append(leaner)
            leaning.append(0)
            entity.addChild(leaner)
            try rebuildTile(index)
        }
    }

    /// The simulation can call this on every frame; GPU resource work waits for
    /// flush so a smooth tractor movement does not continually rebuild meshes.
    func update(grid: FieldGrid, changedCells: [Int]) {
        guard !changedCells.isEmpty else { return }
        for index in changedCells where cells.indices.contains(index) {
            let state = grid.cells[index]
            let stage = grid.stage(at: index)
            guard cells[index] != state || crops[index] != grid.crops[index] || stages[index] != stage else { continue }
            cells[index] = state; crops[index] = grid.crops[index]; stages[index] = stage
            Self.drawCell(index, columns: bounds.columns, state: state, crop: grid.crop(at: index), stage: stage, in: bitmap)
            dirtyTiles.insert(Self.tileIndex(forCell: index, in: bounds))
            textureDirty = true
        }
    }

    func respond(to events: FarmingEvents, grid: FieldGrid) {
        update(grid: grid, changedCells: events.changedCells)
        harvestDisplay.harvest(events.harvestResults, grid: grid)
    }
    func animate(seconds: Double) { harvestDisplay.update(seconds: seconds) }

    /// The lean of the most bent patch, 0 when the field is at rest.
    var strongestLean: Float { leaning.max() ?? 0 }

    /// Lean the patches a gust front has just crossed, then let them settle.
    /// The web bends each plant; here a whole patch leans together, because a
    /// patch is one mesh and rebuilding meshes every frame would stutter.
    /// Pass nil between gusts, or to keep the field still for reduced motion.
    func lean(front: Double?, time: Double) {
        let tileColumns = Self.tiles(bounds).columns
        let patchWidth = (bounds.maxX - bounds.minX) / Double(tileColumns)
        for index in tiles.indices {
            var lean = 0.0
            if let front {
                let westEdge = bounds.minX + Double(index % tileColumns) * patchWidth
                let bend = WindScore.bend(behind: front - westEdge)
                if bend > 0 { lean = bend * (0.42 + sin(time * 7 + Double(index)) * 0.05) }
            }
            guard Float(lean) != leaning[index] else { continue }
            leaning[index] = Float(lean)
            guard lean != 0 else {
                leaners[index].transform = .identity
                tiles[index].transform = .identity
                continue
            }
            // Plants stand in world coordinates on the ground, so shearing x by
            // height about the origin leans each one about its own foot.
            let shape = LeanTransform(lean: lean)
            leaners[index].orientation = simd_quatf(angle: Float(shape.outerAngle), axis: [0, 0, 1])
            leaners[index].scale = [Float(shape.stretch), Float(1 / shape.stretch), 1]
            tiles[index].orientation = simd_quatf(angle: Float(shape.innerAngle), axis: [0, 0, 1])
        }
    }
    func clearDisplay(grid: FieldGrid) { harvestDisplay.clear(grid: grid) }

    /// Called at a modest rate by the scene loop, and once after a reset.
    func flush() throws {
        if textureDirty {
            guard let image = bitmap.makeImage() else {
                throw RenderingError.bitmapUnavailable
            }
            try texture.replace(withImage: image, options: Self.textureOptions)
            textureDirty = false
        }
        for index in dirtyTiles.sorted() {
            try rebuildTile(index)
            dirtyTiles.remove(index)
        }
    }

    func reset(grid: FieldGrid) {
        cells = grid.cells; crops = grid.crops
        stages = grid.cells.indices.map { grid.stage(at: $0) }
        harvestDisplay.clear(grid: grid)
        for index in cells.indices {
            Self.drawCell(index, columns: bounds.columns, state: cells[index], crop: grid.crop(at: index),
                          stage: stages[index], in: bitmap)
        }
        dirtyTiles = Set(plants.indices)
        textureDirty = true
    }

    private static func drawCell(_ index: Int, columns: Int, state: UInt8, crop: Crop?, stage: Int, in bitmap: CGContext) {
        let column = index % columns
        let row = index / columns
        let size = CGFloat(pixelsPerCell)
        let x = CGFloat(column) * size
        let y = CGFloat(row) * size
        let palette: [UInt32]
        switch state {
        // Match the web field's grass, mowing stripes, soil, and sown ground.
        case 1: palette = [0xB9C48B, 0xBDC991]
        case 2: palette = [0xB89570, 0xC29F79]
        case 3, 4:
            switch crop {
            case .wheat: palette = [0xA08050, 0xAC8C5B]
            case .sunflowers: palette = [0x82754E, 0x8E8056]
            default: palette = stage == 0 ? [0xA08050, 0xAC8C5B] : [0xAA7052, 0xB57D5B]
            }
        case 5: palette = [0xBDAB7E, 0xB8A579]
        default: palette = [0xA4B376, 0xA8B67A]
        }
        let patch = row % 8 < 4
        bitmap.setFillColor(color(palette[patch ? 0 : 1]).cgColor)
        bitmap.fill(CGRect(x: x, y: y, width: size, height: size))

        let noise = Double((index * 17 + row * 31) % 13) / 13
        if noise > 0.65 {
            let fleck: UInt32 = state == 2 ? 0xAC8968 : state == 1 ? 0xA5B77D : 0x8FA368
            bitmap.setFillColor(color(fleck, alpha: 0.28).cgColor)
            bitmap.fill(CGRect(x: x + 1.5, y: y + 1, width: 0.75, height: 2))
        }
        if state >= 2 {
            bitmap.setFillColor(color(0x684D34, alpha: 0.16).cgColor)
            bitmap.fill(CGRect(x: x, y: y + 1.5, width: size, height: 0.75))
        }
        if (state == 3 || state == 4) && stage == 0 {
            // Same simple seed rows and striped sunflower pairs as the web.
            switch crop {
            case .wheat, .pumpkins:
                bitmap.setFillColor(color(crop == .wheat ? 0xEDCF88 : 0xEAA15B).cgColor)
                bitmap.fill(CGRect(x: x + 0.5, y: y + 0.9, width: 2.1, height: 0.85))
                bitmap.fill(CGRect(x: x + 2.4, y: y + 3.25, width: 2.1, height: 0.85))
            case .sunflowers:
                for offset in [1.35, 3.65] {
                    bitmap.setFillColor(color(0xF4E1B0).cgColor)
                    bitmap.fillEllipse(in: CGRect(x: x + offset - 0.8, y: y + 1.3, width: 1.6, height: 2.4))
                    bitmap.setFillColor(color(0x6D6145).cgColor)
                    bitmap.fill(CGRect(x: x + offset - 0.25, y: y + 1.8, width: 0.5, height: 1.4))
                }
            case nil: break
            }
        } else if state == 3 || state == 4 {
            let tone: UInt32 = stage == 3 ? (crop == .wheat ? 0xD6BB6B : crop == .pumpkins ? 0xCA8B4A : 0xDCCA65) : 0x829755
            bitmap.setFillColor(color(tone).cgColor)
            bitmap.fill(CGRect(x: x + 1, y: y + 1, width: 3, height: stage < 2 ? 1 : 3))
        } else if state == 5 {
            bitmap.setFillColor(color(0xD6C28A).cgColor)
            bitmap.fill(CGRect(x: x + 2, y: y + 1, width: 1, height: 2))
        }
    }

    private static func makeGround(_ bounds: FieldBounds) throws -> MeshResource {
        let minX = Float(bounds.minX)
        let maxX = Float(bounds.maxX)
        let minZ = Float(bounds.minZ)
        let maxZ = Float(bounds.maxZ)
        var descriptor = MeshDescriptor(name: "\(Int(bounds.maxX - bounds.minX)) by \(bounds.maxZ - bounds.minZ) metre field")
        descriptor.positions = .init([
            [minX, 0.045, minZ], [maxX, 0.045, minZ],
            [minX, 0.045, maxZ], [maxX, 0.045, maxZ]
        ])
        descriptor.normals = .init(Array(repeating: [0, 1, 0], count: 4))
        descriptor.textureCoordinates = .init([[0, 0], [1, 0], [0, 1], [1, 1]])
        descriptor.primitives = .triangles([0, 2, 1, 1, 2, 3])
        return try MeshResource.generate(from: [descriptor])
    }

    private static func makePlants(_ bounds: FieldBounds, seed initial: UInt32) -> [[Plant]] {
        let tiles = Self.tiles(bounds)
        var result = Array(repeating: [Plant](), count: tiles.columns * tiles.rows)
        var seed = initial
        func random() -> Double {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return Double(seed) / 4_294_967_296
        }
        var plantIndex = 0
        var z = bounds.minZ + bounds.cellSize / 2
        while z < bounds.maxZ {
            var x = bounds.minX + bounds.cellSize / 2
            while x < bounds.maxX {
                let px = min(bounds.maxX - 0.02, x + (random() - 0.5) * 0.18)
                let pz = min(bounds.maxZ - 0.02, z + (random() - 0.5) * 0.18)
                let column = Int((px - bounds.minX) / bounds.cellSize)
                let row = Int((pz - bounds.minZ) / bounds.cellSize)
                let cell = row * bounds.columns + column
                let plant = Plant(
                    x: Float(px),
                    z: Float(pz),
                    height: Float(0.28 + random() * 0.36),
                    angle: Float(random() * Double.pi * 2),
                    cell: cell,
                    hasFlower: plantIndex % 3 != 0,
                    wildflower: plantIndex % 19 == 0,
                    tone: UInt32(plantIndex % 3),
                    flowerTone: UInt32(3 + plantIndex % 5)
                )
                result[tileIndex(forCell: cell, in: bounds)].append(plant)
                plantIndex += 1
                x += bounds.cellSize
            }
            z += bounds.cellSize
        }
        return result
    }

    private static func tileIndex(forCell cell: Int, in bounds: FieldBounds) -> Int {
        let tiles = Self.tiles(bounds)
        let column = cell % bounds.columns
        let row = cell / bounds.columns
        let tileX = min(tiles.columns - 1, column * tiles.columns / bounds.columns)
        let tileZ = min(tiles.rows - 1, row * tiles.rows / bounds.rows)
        return tileZ * tiles.columns + tileX
    }

    private func rebuildTile(_ index: Int) throws {
        var geometry = Geometry()
        for plant in plants[index] {
            let state = cells[plant.cell]
            let origin = SIMD3<Float>(plant.x, 0.05, plant.z)
            if state == 0 {
                for blade in 0..<3 {
                    geometry.blade(origin: origin, angle: plant.angle + Float(blade) * 2.3,
                                   height: plant.height * (1 - Float(blade) * 0.19), width: 0.045,
                                   bend: plant.height * 0.35, material: plant.tone)
                }
                if plant.wildflower {
                    geometry.flower(center: origin + [0, plant.height * 0.86, 0], radius: 0.105, angle: plant.angle, material: 3)
                }
            } else if state == 5 {
                for blade in 0..<3 {
                    geometry.blade(origin: origin, angle: plant.angle + Float(blade) * 2.3,
                                   height: 0.12, width: 0.018, bend: 0.015, material: 9)
                }
            } else if state == 3 || state == 4 {
                let stage = stages[plant.cell]
                guard let crop = Crop(rawValue: crops[plant.cell]) else { continue }
                if stage == 0 {
                    for side in [Float(-1), 1] {
                        let center = origin + SIMD3<Float>(side * 0.09, 0.03, side > 0 ? 0.06 : 0)
                        let radius: SIMD3<Float> = crop == .sunflowers ? [0.075, 0.025, 0.11] : [0.04, 0.025, 0.13]
                        geometry.ellipsoid(center: center, radius: radius, material: crop == .wheat ? 14 : crop == .sunflowers ? 15 : 16)
                        if crop == .sunflowers {
                            geometry.ellipsoid(center: center + [0, 0.015, 0], radius: [0.035, 0.02, 0.085], material: 17)
                        }
                    }
                    continue
                }
                let height: Float = stage == 1 ? 0.22 : crop == .sunflowers ? 1.15 : crop == .pumpkins ? 0.22 : 0.85
                let tone: UInt32 = crop == .wheat && stage == 3 ? 9 : 8
                for blade in 0..<3 {
                    let a = plant.angle + Float(blade) * 2.3
                    geometry.blade(origin: origin, angle: a, height: height * (crop == .sunflowers ? 0.65 : 1),
                                   width: crop == .pumpkins ? (stage == 1 ? 0.035 : 0.12) : 0.045,
                                   bend: crop == .pumpkins ? (stage == 1 ? 0.06 : 0.5) : 0.14, material: tone)
                    if crop == .wheat && stage >= 2 {
                        geometry.ellipsoid(center: origin + [sin(a) * 0.14, height, cos(a) * 0.14],
                                           radius: [0.05, 0.18, 0.05], material: tone)
                    }
                }
                if crop == .sunflowers && stage >= 2 {
                    geometry.blade(origin: origin, angle: plant.angle, height: height, width: 0.02, bend: 0, material: 8)
                    if stage == 3 {
                        geometry.flower(center: origin + [0, height, 0], radius: 0.25, angle: plant.angle,
                                        material: 10, petals: 8, centerMaterial: 11)
                    }
                } else if crop == .pumpkins && stage == 3 {
                    for lobe in 0..<7 {
                        let a = Float(lobe) * .pi * 2 / 7
                        geometry.ellipsoid(center: origin + [sin(a) * 0.11, 0.23, cos(a) * 0.11],
                                           radius: [0.22, 0.23, 0.22], material: 12)
                    }
                    geometry.blade(origin: origin + [0, 0.42, 0], angle: plant.angle, height: 0.13, width: 0.03, bend: 0.03, material: 11)
                }
            }
        }
        guard !geometry.positions.isEmpty else {
            tiles[index].model = nil
            return
        }
        var descriptor = MeshDescriptor(name: "Meadow patch \(index)")
        descriptor.positions = .init(geometry.positions)
        descriptor.normals = .init(geometry.normals)
        descriptor.textureCoordinates = .init(geometry.textureCoordinates)
        descriptor.primitives = .triangles(geometry.indices)
        let mesh = try MeshResource.generate(from: [descriptor])
        tiles[index].model = ModelComponent(mesh: mesh, materials: materials)
    }

    private static func color(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255,
            alpha: alpha
        )
    }

    private static func matteMaterial(_ hex: UInt32, doubleSided: Bool = false) -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: color(hex))
        material.roughness = 1.0
        material.metallic = 0.0
        material.specular = 0.0
        if doubleSided { material.faceCulling = .none }
        return material
    }

    private struct Geometry {
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        var textureCoordinates: [SIMD2<Float>] = []

        private func swatch(_ material: UInt32) -> SIMD2<Float> {
            [(Float(material) + 0.5) / Float(FieldRenderer.vegetationPalette.count), 0.5]
        }

        mutating func triangle(
            _ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, material: UInt32
        ) {
            let start = UInt32(positions.count)
            let normal = simd_normalize(simd_cross(b - a, c - a))
            positions.append(contentsOf: [a, b, c])
            normals.append(contentsOf: [normal, normal, normal])
            indices.append(contentsOf: [start, start + 1, start + 2])
            textureCoordinates.append(contentsOf: Array(repeating: swatch(material), count: 3))
        }

        mutating func blade(origin: SIMD3<Float>, angle: Float, height: Float,
                            width: Float, bend: Float, material: UInt32) {
            let direction = SIMD3<Float>(sin(angle), 0, cos(angle))
            let side = SIMD3<Float>(cos(angle), 0, -sin(angle))
            let start = UInt32(positions.count)
            let widths: [Float] = [0.45, 1, 0.55, 0]
            for step in 0...3 {
                let t = Float(step) / 3
                let center = origin + direction * (bend * t * t) + SIMD3(0, height * t, 0)
                // Tilt the leaf normals toward the sky for soft foliage shading.
                let normal = simd_normalize(direction + SIMD3<Float>(0, 1.3 + t, 0))
                positions += [center - side * width * widths[step], center + side * width * widths[step]]
                normals += [normal, normal]
                textureCoordinates += [swatch(material), swatch(material)]
                if step < 3 {
                    let i = start + UInt32(step * 2)
                    indices += [i, i + 1, i + 2]
                    if step < 2 {
                        indices += [i + 1, i + 3, i + 2]
                    }
                }
            }
        }

        mutating func ellipsoid(center: SIMD3<Float>, radius: SIMD3<Float>, material: UInt32) {
            for row in 0..<4 {
                for col in 0..<7 {
                    func point(_ r: Int, _ c: Int) -> SIMD3<Float> {
                        let latitude = Float(r) * .pi / 4, longitude = Float(c) * .pi * 2 / 7
                        return center + SIMD3(sin(latitude) * cos(longitude), cos(latitude), sin(latitude) * sin(longitude)) * radius
                    }
                    if row > 0 { triangle(point(row, col), point(row + 1, col), point(row, col + 1), material: material) }
                    if row < 3 { triangle(point(row, col + 1), point(row + 1, col), point(row + 1, col + 1), material: material) }
                }
            }
        }

        mutating func flower(center: SIMD3<Float>, radius: Float, angle: Float, material: UInt32, petals: Int = 5, centerMaterial: UInt32 = 4) {
            // Five cupped, oval petals and a honey-colored center, not a diamond.
            for petal in 0..<petals {
                let a = angle + Float(petal) * .pi * 2 / Float(petals)
                let outward = SIMD3<Float>(sin(a), 0, cos(a))
                let side = SIMD3<Float>(cos(a), 0, -sin(a))
                let petalCenter = center + outward * radius * 0.65
                for segment in 0..<6 {
                    func edge(_ index: Int) -> SIMD3<Float> {
                        let t = Float(index) * .pi / 3
                        return petalCenter + outward * (cos(t) * radius * 0.65)
                            + side * (sin(t) * radius * 0.36) + SIMD3(0, -radius * 0.08, 0)
                    }
                    triangle(petalCenter + SIMD3(0, radius * 0.12, 0), edge(segment), edge(segment + 1), material: material)
                }
            }
            for segment in 0..<8 {
                let a = Float(segment) * .pi / 4, b = Float(segment + 1) * .pi / 4
                triangle(center + SIMD3(0, radius * 0.28, 0),
                         center + SIMD3(sin(a) * radius * 0.36, radius * 0.08, cos(a) * radius * 0.36),
                         center + SIMD3(sin(b) * radius * 0.36, radius * 0.08, cos(b) * radius * 0.36), material: centerMaterial)
            }
        }
    }
}
