/// Maps a native orthographic viewport into the meadow's horizontal ground.
/// Camera basis vectors are world-space directions; forward points into the scene.
public enum OrthographicGroundProjection {
    public static func project(
        screenPoint: SIMD2<Double>,
        viewportSize: SIMD2<Double>,
        cameraPosition: SIMD3<Double>,
        cameraRight: SIMD3<Double>,
        cameraUp: SIMD3<Double>,
        cameraForward: SIMD3<Double>,
        verticalHalfExtent: Double
    ) -> FarmPoint? {
        guard screenPoint.x.isFinite, screenPoint.y.isFinite,
              viewportSize.x.isFinite, viewportSize.y.isFinite,
              viewportSize.x > 0, viewportSize.y > 0,
              verticalHalfExtent.isFinite, verticalHalfExtent > 0,
              isFinite(cameraPosition), isFinite(cameraRight),
              isFinite(cameraUp), isFinite(cameraForward),
              cameraForward.y < -0.000_001 else { return nil }

        // A collapsed camera basis cannot describe a usable viewport.
        let basisNormal = SIMD3(
            cameraRight.y * cameraUp.z - cameraRight.z * cameraUp.y,
            cameraRight.z * cameraUp.x - cameraRight.x * cameraUp.z,
            cameraRight.x * cameraUp.y - cameraRight.y * cameraUp.x
        )
        let basisAreaSquared = basisNormal.x * basisNormal.x
            + basisNormal.y * basisNormal.y + basisNormal.z * basisNormal.z
        guard basisAreaSquared.isFinite, basisAreaSquared > 0.000_000_001 else { return nil }

        let ndcX = 2 * screenPoint.x / viewportSize.x - 1
        let ndcY = 1 - 2 * screenPoint.y / viewportSize.y
        let horizontalOffset = ndcX * verticalHalfExtent * (viewportSize.x / viewportSize.y)
        let verticalOffset = ndcY * verticalHalfExtent
        let origin = cameraPosition + cameraRight * horizontalOffset + cameraUp * verticalOffset
        guard isFinite(origin) else { return nil }
        let distance = -origin.y / cameraForward.y
        guard distance.isFinite, distance >= 0 else { return nil }
        let ground = origin + cameraForward * distance
        guard isFinite(ground) else { return nil }
        return FarmPoint(x: ground.x, z: ground.z)
    }

    private static func isFinite(_ vector: SIMD3<Double>) -> Bool {
        vector.x.isFinite && vector.y.isFinite && vector.z.isFinite
    }
}
