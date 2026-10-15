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

    /// Broad sky light and a warm ground bounce soften the little farm's shading.
    /// Generated locally so the native app needs no remote textures or assets.
    @MainActor
    static func makeDaylight() async throws -> EnvironmentResource {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: CGSize(width: 512, height: 256), format: format).image { context in
            let canvas = context.cgContext
            let colors = ["#BED8DB", "#D6E5DA", "#F1EED5", "#C2CCA2", "#9EAE86"]
                .map { UIColor(farmHex: $0).cgColor }
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray,
                                         locations: [0, 0.30, 0.50, 0.70, 1]) {
                canvas.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: 256), options: [])
            }
            canvas.setFillColor(UIColor(farmHex: "#FFF8E4").withAlphaComponent(0.27).cgColor)
            // Low, pillowy cloud banks wrap around the horizon.
            for (x, y, width) in [(70.0, 94.0, 64.0), (190, 80, 48), (330, 99, 76), (446, 86, 50)] {
                canvas.saveGState()
                canvas.setShadow(offset: .zero, blur: 7, color: UIColor.white.withAlphaComponent(0.12).cgColor)
                for index in 0..<4 {
                    let offset = Double(index) * width * 0.20
                    canvas.fillEllipse(in: CGRect(x: x - width / 2 + offset, y: y - Double(index % 2) * 3,
                                                  width: width * 0.47, height: 9 + Double(index % 3) * 3))
                }
                canvas.restoreGState()
            }
        }
        guard let cgImage = image.cgImage else { throw ArtworkError.invalidMesh }
        return try await EnvironmentResource(equirectangular: cgImage, withName: "A soft spring sky")
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
        material.roughness = .init(floatLiteral: max(0.55, roughness))
        material.metallic = 0.0
        material.specular = .init(floatLiteral: roughness < 0.7 ? 0.22 : 0.05)
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
