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
        self.materials = [
            Self.matteMaterial(0x96A96D, doubleSided: true),
            Self.matteMaterial(0xEEE4BF)
        ]

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
        case 1: palette = [0xB9C48B, 0xBDC991]
        case 2: palette = [0xB89570, 0xC29F79]
        case 3: palette = [0x97AB78, 0x9CAE7B]
        default: palette = [0xA4B376, 0xA8B67A]
        }
        bitmap.setFillColor(color(palette[row % 8 < 4 ? 0 : 1]).cgColor)
        bitmap.fill(CGRect(x: x, y: y, width: size, height: size))

        let noise = Double((index * 17 + row * 31) % 13) / 13
        if noise > 0.65 {
            let fleck: UInt32 = state == 2 ? 0xAC8968 : state == 1 ? 0xA5B77D : 0x8FA368
            bitmap.setFillColor(color(fleck, alpha: 0.28).cgColor)
            bitmap.fill(CGRect(x: x + 1.5, y: y + 1, width: 0.75, height: 2))
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
        var z = FieldGrid.minZ + 0.24
        while z < FieldGrid.maxZ {
            var x = FieldGrid.minX + 0.22
            while x < FieldGrid.maxX {
                let px = x + (random() - 0.5) * 0.3
                let pz = z + (random() - 0.5) * 0.3
                let column = Int((px - FieldGrid.minX) / FieldGrid.cellSize)
                let row = Int((pz - FieldGrid.minZ) / FieldGrid.cellSize)
                let cell = row * FieldGrid.columns + column
                let plant = Plant(
                    x: Float(px),
                    z: Float(pz),
                    height: Float(0.45 + random() * 0.5),
                    angle: Float(random() * Double.pi * 2),
                    cell: cell,
                    hasFlower: plantIndex % 3 != 0
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
            let rotation = simd_quatf(angle: plant.angle, axis: [0, 1, 0])
            let origin = SIMD3<Float>(plant.x, 0.05, plant.z)
            func point(_ local: SIMD3<Float>) -> SIMD3<Float> {
                origin + rotation.act(local * height)
            }
            geometry.triangle(
                point([-0.12, 0, 0]), point([0.12, 0, 0]), point([0.045, 0.7, 0]),
                material: 0
            )
            geometry.triangle(
                point([0, 0, -0.12]), point([0, 0, 0.12]), point([0.02, 0.52, 0.04]),
                material: 0
            )
            if state == 3 && plant.hasFlower {
                geometry.flower(
                    center: [plant.x, 0.06 + plant.height * 0.54, plant.z],
                    radius: 0.14,
                    material: 1
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
        descriptor.primitives = .triangles(geometry.indices)
        descriptor.materials = .perFace(geometry.faceMaterials)
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
        var faceMaterials: [UInt32] = []

        mutating func triangle(
            _ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, material: UInt32
        ) {
            let start = UInt32(positions.count)
            let normal = simd_normalize(simd_cross(b - a, c - a))
            positions.append(contentsOf: [a, b, c])
            normals.append(contentsOf: [normal, normal, normal])
            indices.append(contentsOf: [start, start + 1, start + 2])
            faceMaterials.append(material)
        }

        mutating func flower(center: SIMD3<Float>, radius: Float, material: UInt32) {
            let top = center + SIMD3<Float>(0, radius * 0.7, 0)
            let bottom = center - SIMD3<Float>(0, radius * 0.5, 0)
            let ring = [
                center + SIMD3<Float>(radius, 0, 0),
                center + SIMD3<Float>(0, 0, -radius),
                center + SIMD3<Float>(-radius, 0, 0),
                center + SIMD3<Float>(0, 0, radius)
            ]
            for index in 0..<4 {
                let next = (index + 1) % 4
                triangle(top, ring[index], ring[next], material: material)
                triangle(bottom, ring[next], ring[index], material: material)
            }
        }
    }
}
