import Foundation

/// Reframes the same meadow to suit the viewport without moving its saved rows.
public enum OverviewCamera {
    public struct Framing: Sendable {
        public let position: SIMD3<Double>
        public let focus: SIMD3<Double>
        public let verticalHalfExtent: Double
    }

    public static func frame(aspect: Double, zoom: Double = 1) -> Framing {
        // Keep transient or invalid layout sizes from producing an unusable camera.
        let safeAspect = aspect.isFinite && aspect > 0 ? max(0.1, min(10, aspect)) : 4 / 3
        let safeZoom = zoom.isFinite && zoom > 0 ? max(0.65, min(1.8, zoom)) : 1
        let progress = max(0, min(1, (1 - safeAspect) / 0.2))
        let portrait = progress * progress * (3 - 2 * progress)
        let focus = SIMD3<Double>(-1, 0, -2)
        let landscapePosition = SIMD3<Double>(59, 73, 87)
        // The longer rows recede up the screen. Leave the sails visible at an
        // oblique angle, with the barn above the meadow and the pond below it.
        let portraitPosition = focus + SIMD3<Double>(84, 94, 38)
        let landscapeHeight = max(66, 64 / safeAspect)
        let portraitHeight = max(90, 54 / safeAspect)
        return Framing(
            position: landscapePosition + (portraitPosition - landscapePosition) * portrait,
            focus: focus,
            verticalHalfExtent: (landscapeHeight + (portraitHeight - landscapeHeight) * portrait) * 0.5 / safeZoom
        )
    }
}
