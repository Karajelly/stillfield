import Foundation
import Testing
@testable import StillfieldCore

private let cameraPosition = SIMD3<Double>(59, 73, 87)
// Orthonormal basis for the native camera looking at (-1, 0, -2).
private let cameraRight = SIMD3<Double>(0.8291725540450335, 0, -0.5589927330640676)
private let cameraUp = SIMD3<Double>(-0.3143612953058764, 0.8268850418308225, -0.46630258803705)
private let cameraForward = SIMD3<Double>(-0.46222272946280724, -0.5623709875130821, -0.6856303820364974)

private func project(
    _ point: SIMD2<Double>,
    viewport: SIMD2<Double> = [402, 874],
    halfExtent: Double? = nil,
    position: SIMD3<Double> = cameraPosition,
    right: SIMD3<Double> = cameraRight,
    up: SIMD3<Double> = cameraUp,
    forward: SIMD3<Double> = cameraForward
) -> FarmPoint? {
    OrthographicGroundProjection.project(
        screenPoint: point, viewportSize: viewport,
        cameraPosition: position, cameraRight: right, cameraUp: up, cameraForward: forward,
        verticalHalfExtent: halfExtent ?? max(66, 64 / (viewport.x / viewport.y)) * 0.5
    )
}

@Test func viewportCenterHitsTheCamerasGroundFocus() throws {
    let ground = try #require(project([201, 437]))
    #expect(abs(ground.x + 1) < 0.000_001)
    #expect(abs(ground.z + 2) < 0.000_001)
}

@Test func portraitTapsLandOnTheExpectedSidesOfTheMeadow() throws {
    let right = try #require(project([402 * 0.65, 874 * 0.47]))
    #expect(abs(right.x - 2.810804) < 0.000_001)
    #expect(abs(right.z + 13.521055) < 0.000_001)

    let left = try #require(project([402 * 0.32, 874 * 0.52]))
    #expect(abs(left.x + 7.785899) < 0.000_001)
    #expect(abs(left.z - 8.542746) < 0.000_001)
}

@Test func fieldPointsRoundTripAcrossOrientationAndZoom() throws {
    let viewports: [SIMD2<Double>] = [[402, 874], [874, 402], [744, 1133], [1133, 744]]
    for viewport in viewports {
        for zoom in [0.65, 1.0, 1.8] {
            let halfExtent = max(66, 64 / (viewport.x / viewport.y)) * 0.5 / zoom
            for x in [-12.0, 0, 12] {
                for z in [-6.0, 0, 6] {
                    let offset = SIMD3<Double>(x, 0, z) - cameraPosition
                    let horizontal = offset.x * cameraRight.x + offset.y * cameraRight.y + offset.z * cameraRight.z
                    let vertical = offset.x * cameraUp.x + offset.y * cameraUp.y + offset.z * cameraUp.z
                    let screen = SIMD2(
                        (horizontal / (halfExtent * viewport.x / viewport.y) + 1) * viewport.x * 0.5,
                        (1 - vertical / halfExtent) * viewport.y * 0.5
                    )
                    #expect(screen.x >= 0 && screen.x <= viewport.x)
                    #expect(screen.y >= 0 && screen.y <= viewport.y)
                    let ground = try #require(project(screen, viewport: viewport, halfExtent: halfExtent))
                    #expect(abs(ground.x - x) < 0.000_001)
                    #expect(abs(ground.z - z) < 0.000_001)
                }
            }
        }
    }
}

@Test func invalidOrUpwardProjectionGeometryIsRejected() {
    let center = SIMD2<Double>(201, 437)
    #expect(project(center, viewport: [0, 874]) == nil)
    #expect(project(center, viewport: [402, -.infinity]) == nil)
    #expect(project(center, halfExtent: 0) == nil)
    #expect(project(center, halfExtent: -.infinity) == nil)
    #expect(project([.nan, 437]) == nil)
    #expect(project(center, position: [.infinity, 73, 87]) == nil)
    #expect(project(center, position: [59, -73, 87]) == nil)
    #expect(project(center, right: .zero) == nil)
    #expect(project(center, up: cameraRight) == nil)
    #expect(project(center, forward: [0, 0, -1]) == nil)
    #expect(project(center, forward: [0, 1, 0]) == nil)
    #expect(project(center, forward: [.nan, -1, 0]) == nil)
}
