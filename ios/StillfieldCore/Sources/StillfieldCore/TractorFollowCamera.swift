import Foundation

public enum FarmCameraMode: String, Codable, Sendable {
    case overview, tractor
}

/// A level, gently turning camera boom. Tractor suspension never moves the camera.
public struct TractorFollowCamera: Sendable {
    public static let defaultZoom = 0.65

    public struct Pose: Sendable {
        public let position: SIMD3<Double>
        public let focus: SIMD3<Double>
    }

    public private(set) var heading: Double?
    public private(set) var distance: Double?

    public init() {}

    public mutating func update(tractor: TractorState, zoom: Double, deltaTime: Double,
                                obstacles: [Obstacle] = [], snap: Bool = false) -> Pose {
        let previous = heading ?? tractor.heading
        var turn = atan2(sin(tractor.heading - previous), cos(tractor.heading - previous))
        if !snap { turn = (turn < 0 ? -1 : 1) * max(0, abs(turn) - 1.3 * .pi / 180) }
        let response = snap ? 1 : 1 - exp(-8 * max(0, min(0.05, deltaTime)))
        let angle = previous + turn * response
        heading = atan2(sin(angle), cos(angle))
        let forward = SIMD3<Double>(sin(angle), 0, cos(angle))
        let center = SIMD3<Double>(tractor.x, 0, tractor.z)
        let boundedZoom = max(0.65, min(1.8, zoom))
        // A gentler dolly range leaves room for the attachment at close zoom.
        let scale = 1 / sqrt(boundedZoom)
        let lookAhead = max(0, 1.5 - 2 * (boundedZoom - 1))
        let focusHeight = 1.1
        let horizontal = 14 * scale + lookAhead
        let vertical = 2.2 + 4 * scale - focusHeight
        // Raise the boom by 15 degrees around its focus without changing zoom distance.
        let tilt = 15 * Double.pi / 180
        let desiredDistance = horizontal * cos(tilt) - vertical * sin(tilt) - lookAhead
        let cameraHeight = focusHeight + horizontal * sin(tilt) + vertical * cos(tilt)
        var distance = desiredDistance

        // Stop the boom before scenery, using the same conservative footprints
        // that keep the tractor out of buildings, trees, and the pond.
        for obstacle in obstacles {
            let dx = obstacle.x - tractor.x, dz = obstacle.z - tractor.z
            let along = -dx * forward.x - dz * forward.z
            let acrossSquared = max(0, dx * dx + dz * dz - along * along)
            let radius = obstacle.radius + 0.4
            guard acrossSquared < radius * radius else { continue }
            let halfChord = sqrt(radius * radius - acrossSquared)
            guard along + halfChord > 0 else { continue }
            distance = min(distance, max(0.25, along - halfChord))
        }

        // Clear obstructions immediately; ease outward after they leave the boom.
        if !snap, let previous = self.distance, distance > previous {
            distance = previous + (distance - previous) * (1 - exp(-3 * max(0, min(0.05, deltaTime))))
        }
        self.distance = distance

        // In a tight space, look down toward the tractor instead of past it.
        let focusAhead = lookAhead * min(1, distance / 8)
        return Pose(position: center - forward * distance + SIMD3(0, cameraHeight, 0),
                    focus: center + forward * focusAhead + SIMD3(0, focusHeight, 0))
    }

    /// Preserve enough horizontal room for the attachment on narrow phones.
    public static func verticalFieldOfView(aspect: Double) -> Double {
        max(58, 2 * atan(tan(24 * .pi / 180) / max(0.1, aspect)) * 180 / .pi)
    }
}
