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
    private static let tileColumns = 8
    private static let tileRows = 6
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
    }

    private enum RenderingError: Error {
        case bitmapUnavailable
    }

    private let bitmap: CGContext
    private let texture: TextureResource
    private let materials: [PhysicallyBasedMaterial]
    private var cells: [UInt8]
    private var plants: [[Plant]]
    private var tiles: [ModelEntity]
    private var dirtyTiles = Set<Int>()
    private var textureDirty = false

    init(grid: FieldGrid) async throws {
        let width = FieldGrid.columns * Self.pixelsPerCell
        let height = FieldGrid.rows * Self.pixelsPerCell
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
        self.plants = Self.makePlants()
        self.tiles = []
        // A seven-swatch atlas keeps every patch to one draw, even in a field
        // full of multicolored flowers. All vertices sample a swatch's center.
        let palette: [UInt32] = [0x98B77F, 0xACC88D, 0x8DAD7C, 0xFFF0D4, 0xDDBB6B, 0xB6A7CB, 0xE3B6A7]
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
            Self.drawCell(index, state: grid.cells[index], in: bitmap)
        }
        guard let image = bitmap.makeImage() else {
            throw RenderingError.bitmapUnavailable
        }
        self.texture = try await TextureResource(
            image: image,
            options: Self.textureOptions
        )

        entity.name = "The living field"
        var groundMaterial = Self.matteMaterial(0xFFFFFF)
        groundMaterial.baseColor.texture = .init(texture)
        let ground = ModelEntity(
            mesh: try Self.makeGround(),
            materials: [groundMaterial]
        )
        ground.name = "Painted field surface"
        entity.addChild(ground)

        for index in plants.indices {
            let tile = ModelEntity()
            tile.name = "Meadow patch \(index)"
            tiles.append(tile)
            entity.addChild(tile)
            try rebuildTile(index)
        }
    }

    /// The simulation can call this on every frame; GPU resource work waits for
    /// flush so a smooth tractor movement does not continually rebuild meshes.
    func update(grid: FieldGrid, changedCells: [Int]) {
        guard !changedCells.isEmpty else { return }
        for index in changedCells where cells.indices.contains(index) {
            let state = grid.cells[index]
            guard cells[index] != state else { continue }
            cells[index] = state
            Self.drawCell(index, state: state, in: bitmap)
            dirtyTiles.insert(Self.tileIndex(forCell: index))
            textureDirty = true
        }
    }

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
        cells = grid.cells
        for index in cells.indices {
            Self.drawCell(index, state: cells[index], in: bitmap)
        }
        dirtyTiles = Set(plants.indices)
        textureDirty = true
    }

    private static func drawCell(_ index: Int, state: UInt8, in bitmap: CGContext) {
        let column = index % FieldGrid.columns
        let row = index / FieldGrid.columns
        let size = CGFloat(pixelsPerCell)
        let x = CGFloat(column) * size
        let y = CGFloat(row) * size
        let palette: [UInt32]
        switch state {
        case 1: palette = [0xBDCE96, 0xC1D39C]
        case 2: palette = [0xB89373, 0xBF9D7E]
        case 3: palette = [0xA0BA88, 0xA4BD8B]
        default: palette = [0xA7BC87, 0xAABD8A]
        }
        let patch = state == 1 || state == 2 ? row % 8 < 4
            : sin(Double(column) * 0.19) + cos(Double(row) * 0.27) > 0
        bitmap.setFillColor(color(palette[patch ? 0 : 1]).cgColor)
        bitmap.fill(CGRect(x: x, y: y, width: size, height: size))

        let noise = Double((index * 17 + row * 31) % 13) / 13
        if noise > 0.65 {
            let fleck: UInt32 = state == 2 ? 0xAC8968 : state == 1 ? 0xA5B77D : 0x94AE7A
            bitmap.setFillColor(color(fleck, alpha: 0.16).cgColor)
            bitmap.fillEllipse(in: CGRect(x: x + 1.5, y: y + 1, width: 1.25, height: 0.75))
        }
        if state == 2 && row % 3 == 0 {
            bitmap.setFillColor(color(0x684D34, alpha: 0.16).cgColor)
            bitmap.fill(CGRect(x: x, y: y + 1.5, width: size, height: 0.75))
        }
    }

    private static func makeGround() throws -> MeshResource {
        let minX = Float(FieldGrid.minX)
        let maxX = Float(FieldGrid.maxX)
        let minZ = Float(FieldGrid.minZ)
        let maxZ = Float(FieldGrid.maxZ)
        var descriptor = MeshDescriptor(name: "43 by 27 metre field")
        descriptor.positions = .init([
            [minX, 0.045, minZ], [maxX, 0.045, minZ],
            [minX, 0.045, maxZ], [maxX, 0.045, maxZ]
        ])
        descriptor.normals = .init(Array(repeating: [0, 1, 0], count: 4))
        descriptor.textureCoordinates = .init([[0, 0], [1, 0], [0, 1], [1, 1]])
        descriptor.primitives = .triangles([0, 2, 1, 1, 2, 3])
        return try MeshResource.generate(from: [descriptor])
    }

    private static func makePlants() -> [[Plant]] {
        var result = Array(repeating: [Plant](), count: tileColumns * tileRows)
        var seed: UInt32 = 22
        func random() -> Double {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return Double(seed) / 4_294_967_296
        }
        var plantIndex = 0
        var z = FieldGrid.minZ + 0.30
        while z < FieldGrid.maxZ {
            var x = FieldGrid.minX + 0.30
            while x < FieldGrid.maxX {
                let px = min(FieldGrid.maxX - 0.02, x + (random() - 0.5) * 0.54)
                let pz = min(FieldGrid.maxZ - 0.02, z + (random() - 0.5) * 0.54)
                let column = Int((px - FieldGrid.minX) / FieldGrid.cellSize)
                let row = Int((pz - FieldGrid.minZ) / FieldGrid.cellSize)
                let cell = row * FieldGrid.columns + column
                let plant = Plant(
                    x: Float(px),
                    z: Float(pz),
                    height: Float(0.28 + random() * 0.36),
                    angle: Float(random() * Double.pi * 2),
                    cell: cell,
                    hasFlower: plantIndex % 3 != 0,
                    wildflower: plantIndex % 19 == 0,
                    tone: UInt32(plantIndex % 3)
                )
                result[tileIndex(forCell: cell)].append(plant)
                plantIndex += 1
                x += 0.6
            }
            z += 0.6
        }
        return result
    }

    private static func tileIndex(forCell cell: Int) -> Int {
        let column = cell % FieldGrid.columns
        let row = cell / FieldGrid.columns
        let tileX = min(tileColumns - 1, column * tileColumns / FieldGrid.columns)
        let tileZ = min(tileRows - 1, row * tileRows / FieldGrid.rows)
        return tileZ * tileColumns + tileX
    }

    private func rebuildTile(_ index: Int) throws {
        var geometry = Geometry()
        for plant in plants[index] {
            let state = cells[plant.cell]
            guard state == 0 || state == 3 else { continue }
            let height = plant.height * (state == 3 ? 0.85 : 1)
            let origin = SIMD3<Float>(plant.x, 0.05, plant.z)
            for blade in 0..<3 {
                geometry.blade(origin: origin, angle: plant.angle + Float(blade) * 2.3,
                               height: height * (1 - Float(blade) * 0.19),
                               width: 0.035 + height * 0.025,
                               bend: height * (0.28 + Float(blade) * 0.15), material: plant.tone)
            }
            if (state == 3 && plant.hasFlower) || (state == 0 && plant.wildflower) {
                geometry.blade(origin: origin, angle: plant.angle, height: height * 0.86,
                               width: 0.009, bend: 0, material: 2)
                geometry.flower(
                    center: [plant.x, 0.06 + height * 0.86, plant.z],
                    radius: state == 3 ? 0.14 : 0.105,
                    angle: plant.angle,
                    material: state == 0 ? 3 : [3, 5, 6][Int(plant.tone)]
                )
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
            [(Float(material) + 0.5) / 7, 0.5]
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

        mutating func flower(center: SIMD3<Float>, radius: Float, angle: Float, material: UInt32) {
            // Five cupped, oval petals and a honey-colored center, not a diamond.
            for petal in 0..<5 {
                let a = angle + Float(petal) * .pi * 2 / 5
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
                         center + SIMD3(sin(b) * radius * 0.36, radius * 0.08, cos(b) * radius * 0.36), material: 4)
            }
        }
    }
}
