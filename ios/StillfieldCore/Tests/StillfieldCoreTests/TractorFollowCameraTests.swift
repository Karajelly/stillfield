import Foundation
import simd
import Testing
@testable import StillfieldCore

@Test func followCameraStaysBehindEveryHeadingAndZoom() {
    for heading in stride(from: -Double.pi, through: Double.pi, by: .pi / 4) {
        for zoom in [0.65, 1.0, 1.8] {
            var camera = TractorFollowCamera()
            let tractor = TractorState(x: 18, z: -12, heading: heading)
            let pose = camera.update(tractor: tractor, zoom: zoom, deltaTime: 0, snap: true)
            let forward = SIMD3<Double>(sin(heading), 0, cos(heading))
            let offset = pose.position - SIMD3(tractor.x, 0, tractor.z)
            #expect(simd_dot(offset, forward) < -6)
            #expect(abs(offset.x * forward.z - offset.z * forward.x) < 0.000_001)
            #expect(pose.position.y > 4)
            #expect(simd_dot(pose.focus - SIMD3(tractor.x, 0, tractor.z), forward) >= 0)
        }
    }
}

@Test func tractorAndAttachmentStayAboveTheDockAtEveryZoom() {
    for viewport: SIMD2<Double> in [[402, 874], [874, 402], [744, 1133], [1133, 744]] {
        let halfHeight = tan(TractorFollowCamera.verticalFieldOfView(aspect: viewport.x / viewport.y) * .pi / 360)
        for zoom in [0.65, 1.0, 1.8] {
            var camera = TractorFollowCamera()
            let pose = camera.update(tractor: TractorState(x: 0, z: 0, heading: 0), zoom: zoom, deltaTime: 0, snap: true)
            let forward = simd_normalize(pose.focus - pose.position)
            let right = simd_normalize(simd_cross(forward, SIMD3(0, 1, 0)))
            let up = simd_cross(right, forward)
            // Roof, wheels, and the rear implement's outer bounds.
            for point: SIMD3<Double> in [[-0.9, 2.8, -1.2], [0.9, 2.8, 0.5],
                                        [-1.1, 0, -0.8], [1.1, 0, 1.5],
                                        [-1.4, 0.1, -2.6], [1.4, 0.8, -2.6]] {
                let offset = point - pose.position
                let depth = simd_dot(offset, forward)
                let screenX = (simd_dot(offset, right) / (depth * halfHeight * viewport.x / viewport.y) + 1) / 2
                let screenY = (1 - simd_dot(offset, up) / (depth * halfHeight)) / 2
                #expect(screenX > 0.1 && screenX < 0.9)
                #expect(screenY > 0.18 && screenY < 0.74)
            }
        }
    }
}

@Test func cameraTurnsAcrossPiWithoutSpinningAroundAndTracksAtEveryFrameRate() {
    var results: [Double] = []
    for fps in [30.0, 60, 120] {
        var camera = TractorFollowCamera()
        _ = camera.update(tractor: TractorState(heading: .pi - 0.1), zoom: 1, deltaTime: 0, snap: true)
        let tractor = TractorState(heading: -.pi + 0.1)
        for _ in 0..<Int(fps / 2) {
            _ = camera.update(tractor: tractor, zoom: 1, deltaTime: 1 / fps)
            #expect(abs(camera.heading!) > 3)
        }
        results.append(camera.heading!)
    }
    #expect(abs(results[0] - results[1]) < 0.000_001)
    #expect(abs(results[1] - results[2]) < 0.000_001)
    #expect(abs(results[0] - (-.pi + 0.1)) < 0.004)
}

@Test func cameraBoomStopsBeforeSceneryAndReturnsToFullDistance() {
    var camera = TractorFollowCamera()
    let tractor = TractorState(x: 0, z: 0, heading: 0)
    let wall = Obstacle(x: 0, z: -8, radius: 2)
    let pose = camera.update(tractor: tractor, zoom: 1, deltaTime: 0, obstacles: [wall], snap: true)
    #expect(abs(pose.position.z + 5.6) < 0.000_001)
    #expect(pose.position.y > pose.focus.y)
    let restored = camera.update(tractor: tractor, zoom: 1, deltaTime: 0, obstacles: [Obstacle(x: 10, z: -8, radius: 2)])
    let unobstructed = camera.update(tractor: tractor, zoom: 1, deltaTime: 0)
    #expect(restored.position == unobstructed.position)
    #expect(restored.position.z < -10)
}

@Test func perspectiveGroundTapsRoundTripThroughTurnsZoomAndOrientation() throws {
    for viewport: SIMD2<Double> in [[402, 874], [874, 402], [744, 1133], [1133, 744]] {
        let fov = TractorFollowCamera.verticalFieldOfView(aspect: viewport.x / viewport.y)
        let halfHeight = tan(fov * .pi / 360)
        for zoom in [0.65, 1.0, 1.8] {
            for heading in [-3.1, -1.5, 0.0, 2.8] {
                var camera = TractorFollowCamera()
                _ = camera.update(tractor: TractorState(heading: heading - 0.2), zoom: zoom, deltaTime: 0, snap: true)
                let tractor = TractorState(heading: heading)
                let pose = camera.update(tractor: tractor, zoom: zoom, deltaTime: 1 / 60)
                let forward = simd_normalize(pose.focus - pose.position)
                let right = simd_normalize(simd_cross(forward, SIMD3(0, 1, 0)))
                let up = simd_cross(right, forward)
                for lateral in [-2.0, 0, 2] {
                    let ground = SIMD3<Double>(tractor.x + sin(heading) * 8 + cos(heading) * lateral,
                                               0, tractor.z + cos(heading) * 8 - sin(heading) * lateral)
                    let offset = ground - pose.position
                    let depth = simd_dot(offset, forward)
                    let screen = SIMD2((simd_dot(offset, right) / (depth * halfHeight * viewport.x / viewport.y) + 1) * viewport.x / 2,
                                       (1 - simd_dot(offset, up) / (depth * halfHeight)) * viewport.y / 2)
                    #expect(screen.x > 0 && screen.x < viewport.x)
                    #expect(screen.y > 0 && screen.y < viewport.y)
                    let hit = try #require(PerspectiveGroundProjection.project(
                        screenPoint: screen, viewportSize: viewport, cameraPosition: pose.position,
                        cameraRight: right, cameraUp: up, cameraForward: forward, verticalFieldOfView: fov))
                    #expect(abs(hit.x - ground.x) < 0.000_001)
                    #expect(abs(hit.z - ground.z) < 0.000_001)
                }
            }
        }
    }
}

@Test func perspectiveSkyHorizonAndInvalidTapsAreIgnored() {
    func project(_ point: SIMD2<Double>, fov: Double = 60, viewport: SIMD2<Double> = [400, 800]) -> FarmPoint? {
        PerspectiveGroundProjection.project(screenPoint: point, viewportSize: viewport,
            cameraPosition: [0, 6, 0], cameraRight: [1, 0, 0], cameraUp: [0, 1, 0],
            cameraForward: [0, 0, -1], verticalFieldOfView: fov)
    }
    #expect(project([200, 0]) == nil)
    #expect(project([200, 400]) == nil)
    #expect(project([200, 400.001]) == nil)
    #expect(project([200, 700]) != nil)
    #expect(project([.nan, 700]) == nil)
    #expect(project([200, 700], fov: 0) == nil)
    #expect(project([200, 700], fov: .infinity) == nil)
    #expect(project([200, 700], viewport: [0, 800]) == nil)
}
