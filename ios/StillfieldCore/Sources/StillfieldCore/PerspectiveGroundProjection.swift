import Foundation

/// Casts a screen ray using the rendered camera pose, including its turn lag.
public enum PerspectiveGroundProjection {
    public static func project(
        screenPoint: SIMD2<Double>, viewportSize: SIMD2<Double>,
        cameraPosition: SIMD3<Double>, cameraRight: SIMD3<Double>,
        cameraUp: SIMD3<Double>, cameraForward: SIMD3<Double>,
        verticalFieldOfView: Double
    ) -> FarmPoint? {
        guard screenPoint.x.isFinite, screenPoint.y.isFinite,
              viewportSize.x.isFinite, viewportSize.y.isFinite,
              viewportSize.x > 0, viewportSize.y > 0,
              verticalFieldOfView.isFinite, (0..<179).contains(verticalFieldOfView),
              verticalFieldOfView > 0,
              isFinite(cameraPosition), isFinite(cameraRight),
              isFinite(cameraUp), isFinite(cameraForward) else { return nil }
        let halfHeight = tan(verticalFieldOfView * .pi / 360)
        let x = (2 * screenPoint.x / viewportSize.x - 1) * halfHeight * viewportSize.x / viewportSize.y
        let y = (1 - 2 * screenPoint.y / viewportSize.y) * halfHeight
        let ray = cameraForward + cameraRight * x + cameraUp * y
        // Sky and near-horizon taps must never send the tractor to a far edge.
        guard isFinite(ray), ray.y < -0.000_001, cameraPosition.y > 0 else { return nil }
        let distance = -cameraPosition.y / ray.y
        let ground = cameraPosition + ray * distance
        guard isFinite(ground), hypot(ground.x - cameraPosition.x, ground.z - cameraPosition.z) <= 180 else { return nil }
        return FarmPoint(x: ground.x, z: ground.z)
    }

    /// Behind the tractor, taps on scenery beyond the drivable meadow are ignored rather than
    /// pulled to its edge, so a near-horizon tap never sends the tractor to a far corner.
    /// Matches `drivableTarget` in src/follow-camera.ts.
    public static func drivable(_ point: FarmPoint?) -> FarmPoint? {
        guard let point, FarmWorld.contains(point) else { return nil }
        return point
    }

    private static func isFinite(_ vector: SIMD3<Double>) -> Bool {
        vector.x.isFinite && vector.y.isFinite && vector.z.isFinite
    }
}
