import Foundation

/// Reframes the same meadow to suit the viewport without moving its saved rows.
public enum OverviewCamera {
    public struct Framing: Sendable {
        public let position: SIMD3<Double>
        public let focus: SIMD3<Double>
        public let verticalHalfExtent: Double
    }

    static let homeFocus = SIMD3<Double>(-1, 0, -2)
    /// Foxglove field is framed exactly like the home field, just further west.
    static let farFocus: SIMD3<Double> = {
        let home = FieldBounds.home.centre, far = FieldBounds.foxglove.centre
        return OverviewCamera.homeFocus + SIMD3(far.x - home.x, 0, far.z - home.z)
    }()

    /// `blend` slides the same composition from the home field (0) to Foxglove
    /// field (1), as `FarmMap.viewBlend` describes. The camera's angle never
    /// changes, so rotating or riding the lane never changes how taps land.
    /// Where a screen is too narrow for the larger field (portrait phones), the
    /// view eases back along the lane just far enough to show all of it.
    /// Matches `overviewFraming` in src/overview.ts.
    public static func frame(aspect: Double, zoom: Double = 1, blend: Double = 0) -> Framing {
        // Keep transient or invalid layout sizes from producing an unusable camera.
        let safeAspect = aspect.isFinite && aspect > 0 ? max(0.1, min(10, aspect)) : 4 / 3
        let safeZoom = zoom.isFinite && zoom > 0 ? max(0.65, min(1.8, zoom)) : 1
        let shift = blend.isFinite ? max(0, min(1, blend)) : 0
        let progress = max(0, min(1, (1 - safeAspect) / 0.2))
        let portrait = progress * progress * (3 - 2 * progress)
        let focus = homeFocus + (farFocus - homeFocus) * shift
        let landscapeOffset = SIMD3<Double>(59, 73, 87) - homeFocus
        // The longer rows recede up the screen. Leave the sails visible at an
        // oblique angle, with the barn above the meadow and the pond below it.
        let portraitOffset = SIMD3<Double>(84, 94, 38)
        let offset = landscapeOffset + (portraitOffset - landscapeOffset) * portrait
        let landscapeHeight = max(66, 64 / safeAspect)
        let portraitHeight = max(90, 54 / safeAspect)
        let base = landscapeHeight + (portraitHeight - landscapeHeight) * portrait
        let height = base + (max(base, fitHeight(offset: offset, aspect: safeAspect)) - base) * shift
        return Framing(position: focus + offset, focus: focus, verticalHalfExtent: height * 0.5 / safeZoom)
    }

    /// The view height that fits Foxglove field, leaving room for the controls.
    static func fitHeight(offset: SIMD3<Double>, aspect: Double) -> Double {
        let length = (offset.x * offset.x + offset.y * offset.y + offset.z * offset.z).squareRoot()
        let forward = -offset / length
        // right = forward × up, up' = right × forward, for a level camera.
        var right = SIMD3<Double>(-forward.z, 0, forward.x)
        right /= (right.x * right.x + right.z * right.z).squareRoot()
        let up = SIMD3<Double>(right.y * forward.z - right.z * forward.y,
                               right.z * forward.x - right.x * forward.z,
                               right.x * forward.y - right.y * forward.x)
        let far = FieldBounds.foxglove
        var height = 0.0
        for x in [far.minX, far.maxX] {
            for z in [far.minZ, far.maxZ] {
                let corner = SIMD3<Double>(x, 0, z) - farFocus
                let dotUp = corner.x * up.x + corner.y * up.y + corner.z * up.z
                let dotRight = corner.x * right.x + corner.z * right.z
                height = max(height, 2 * abs(dotUp) / 0.6, 2 * abs(dotRight) / (0.85 * aspect))
            }
        }
        return height
    }
}
