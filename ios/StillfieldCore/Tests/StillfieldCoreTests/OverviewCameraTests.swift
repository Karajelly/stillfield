import Foundation
import simd
import Testing
@testable import StillfieldCore

private func basis(for framing: OverviewCamera.Framing) -> (right: SIMD3<Double>, up: SIMD3<Double>, forward: SIMD3<Double>) {
    let forward = simd_normalize(framing.focus - framing.position)
    let right = simd_normalize(simd_cross(forward, SIMD3(0, 1, 0)))
    return (right, simd_cross(right, forward), forward)
}

private func screenPosition(_ point: SIMD3<Double>, framing: OverviewCamera.Framing, aspect: Double) -> SIMD2<Double> {
    let axes = basis(for: framing)
    let offset = point - framing.position
    return SIMD2(
        (simd_dot(offset, axes.right) / (framing.verticalHalfExtent * aspect) + 1) * 0.5,
        (1 - simd_dot(offset, axes.up) / framing.verticalHalfExtent) * 0.5
    )
}

@Test func overviewKeepsTheWorkingMeadowInsidePortraitScreens() {
    for viewport: SIMD2<Double> in [[375, 812], [402, 874], [744, 1133], [768, 1024], [820, 1180]] {
        let aspect = viewport.x / viewport.y
        let framing = OverviewCamera.frame(aspect: aspect)
        for x in [FieldGrid.minX, FieldGrid.maxX] {
            for z in [FieldGrid.minZ, FieldGrid.maxZ] {
                let screen = screenPosition([x, 0, z], framing: framing, aspect: aspect)
                #expect(screen.x > 0.05 && screen.x < 0.95)
                #expect(screen.y > 0.18 && screen.y < 0.80)
            }
        }
        // The long field axis leads through the tall viewport instead of across it.
        let axes = basis(for: framing)
        #expect(abs(axes.up.x) > abs(axes.right.x) * 1.5)
        let barn = screenPosition([-23, 4, -24], framing: framing, aspect: aspect)
        let pond = screenPosition([30.5, 0, 20], framing: framing, aspect: aspect)
        #expect(barn.y < 0.36)
        #expect(pond.y > 0.68 && pond.y < 0.9)
    }
}

@Test func overviewPreservesLandscapeAndBlendsAcrossSquareWindows() {
    for aspect in [1.0, 4.0 / 3, 16.0 / 9, 2.2] {
        let framing = OverviewCamera.frame(aspect: aspect)
        #expect(framing.position == SIMD3(59, 73, 87))
        #expect(framing.focus == SIMD3(-1, 0, -2))
        #expect(framing.verticalHalfExtent == 33)
    }
    let middle = OverviewCamera.frame(aspect: 0.9)
    #expect(middle.position.x > 59 && middle.position.x < 83)
    #expect(middle.position.y > 73 && middle.position.y < 94)
    for edge in [0.8, 1.0] {
        let before = OverviewCamera.frame(aspect: edge - 0.000_01)
        let after = OverviewCamera.frame(aspect: edge + 0.000_01)
        #expect(simd_distance(before.position, after.position) < 0.000_01)
        #expect(abs(before.verticalHalfExtent - after.verticalHalfExtent) < 0.001)
    }
}

@Test func overviewTouchesRoundTripAfterRotationResizeAndZoom() throws {
    for viewport: SIMD2<Double> in [[402, 874], [874, 402], [744, 1133], [1133, 744], [900, 1000], [1000, 1000]] {
        let aspect = viewport.x / viewport.y
        for zoom in [0.65, 1.0, 1.8] {
            let framing = OverviewCamera.frame(aspect: aspect, zoom: zoom)
            let axes = basis(for: framing)
            for x in [-12.0, 0, 12] {
                for z in [-6.0, 0, 6] {
                    let screen = screenPosition([x, 0, z], framing: framing, aspect: aspect) * viewport
                    #expect(screen.x >= 0 && screen.x <= viewport.x)
                    #expect(screen.y >= 0 && screen.y <= viewport.y)
                    let ground = try #require(OrthographicGroundProjection.project(
                        screenPoint: screen, viewportSize: viewport,
                        cameraPosition: framing.position, cameraRight: axes.right,
                        cameraUp: axes.up, cameraForward: axes.forward,
                        verticalHalfExtent: framing.verticalHalfExtent
                    ))
                    #expect(abs(ground.x - x) < 0.000_001)
                    #expect(abs(ground.z - z) < 0.000_001)
                }
            }
        }
    }
}

@Test func overviewAlwaysProducesFiniteUsableFraming() {
    for aspect in [-Double.infinity, -1, 0, .nan, .infinity, 1e-300, 1e300, 0.5, 2] {
        for zoom in [-Double.infinity, -1, 0, .nan, .infinity, 1e-300, 1e300, 1] {
            let framing = OverviewCamera.frame(aspect: aspect, zoom: zoom)
            #expect(framing.position.x.isFinite && framing.position.y.isFinite && framing.position.z.isFinite)
            #expect(framing.verticalHalfExtent.isFinite && framing.verticalHalfExtent > 0)
            #expect(framing.position.y > framing.focus.y)
        }
    }
}
