import Foundation
import RealityKit
import StillfieldCore
import UIKit
import simd

struct FarmArtwork: Decodable, Sendable {
    let version: Int
    let world: ArtworkNode
    let tractor: ArtworkNode
    let obstacles: [Obstacle]

    static func load() async throws -> FarmArtwork {
        guard let url = Bundle.main.url(forResource: "FarmScene", withExtension: "json") else {
            throw ArtworkError.missingResource
        }
        return try await Task.detached(priority: .userInitiated) {
            let artwork = try JSONDecoder().decode(FarmArtwork.self, from: Data(contentsOf: url))
            guard artwork.version == 1 else { throw ArtworkError.unsupportedVersion }
            return artwork
        }.value
    }
}

private enum ArtworkError: Error { case missingResource, unsupportedVersion, invalidMesh }

struct ArtworkNode: Decodable, Sendable {
    let name: String
    let transform: [Float]
    let visible: Bool
    let meshes: [ArtworkMesh]
    let children: [ArtworkNode]

    @MainActor
    func makeEntity() async throws -> Entity {
        guard transform.count == 16 else { throw ArtworkError.invalidMesh }
        let entity = Entity()
        entity.name = name
        entity.isEnabled = visible
        let columns = stride(from: 0, to: 16, by: 4).map {
            SIMD4<Float>(transform[$0], transform[$0 + 1], transform[$0 + 2], transform[$0 + 3])
        }
        entity.transform = Transform(matrix: simd_float4x4(columns: (columns[0], columns[1], columns[2], columns[3])))
        for (index, mesh) in meshes.enumerated() {
            let model = try mesh.makeModel()
            model.name = "\(name)-surface-\(index)"
            entity.addChild(model)
            if index.isMultiple(of: 6) { await Task.yield() }
        }
        for child in children { entity.addChild(try await child.makeEntity()) }
        return entity
    }
}

struct ArtworkMesh: Decodable, Sendable {
    let color: String
    let roughness: Float
    let positions: [Float]
    let normals: [Float]
    let indices: [UInt32]

    @MainActor
    func makeModel() throws -> ModelEntity {
        guard positions.count.isMultiple(of: 3), normals.count == positions.count,
              indices.allSatisfy({ $0 < positions.count / 3 }) else { throw ArtworkError.invalidMesh }
        var descriptor = MeshDescriptor()
        descriptor.positions = MeshBuffers.Positions(stride(from: 0, to: positions.count, by: 3).map {
            SIMD3(positions[$0], positions[$0 + 1], positions[$0 + 2])
        })
        descriptor.normals = MeshBuffers.Normals(stride(from: 0, to: normals.count, by: 3).map {
            SIMD3(normals[$0], normals[$0 + 1], normals[$0 + 2])
        })
        descriptor.primitives = .triangles(indices)
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: UIColor(farmHex: color))
        material.roughness = .init(floatLiteral: max(0.7, roughness))
        material.metallic = 0.0
        material.specular = 0.0
        return ModelEntity(mesh: try MeshResource.generate(from: [descriptor]), materials: [material])
    }
}

extension UIColor {
    convenience init(farmHex hex: String) {
        let raw = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt32(raw, radix: 16) ?? 0xE8ECDA
        self.init(red: CGFloat((value >> 16) & 255) / 255,
                  green: CGFloat((value >> 8) & 255) / 255,
                  blue: CGFloat(value & 255) / 255, alpha: 1)
    }
}
