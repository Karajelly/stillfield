import Foundation

public enum FarmTool: String, Codable, CaseIterable, Sendable {
    case mow, till, sow, wander
}

public struct FarmPoint: Codable, Equatable, Sendable {
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
        self.x = x
        self.z = z
    }
}

public struct TractorState: Codable, Equatable, Sendable {
    public var x: Double
    public var z: Double
    public var heading: Double
    public var speed: Double

    public init(x: Double = -4, z: Double = 4.8, heading: Double = -.pi / 2, speed: Double = 0) {
        self.x = x
        self.z = z
        self.heading = heading
        self.speed = speed
    }
}

public struct Obstacle: Codable, Equatable, Sendable {
    public var x: Double
    public var z: Double
    public var radius: Double

    public init(x: Double, z: Double, radius: Double) {
        self.x = x
        self.z = z
        self.radius = radius
    }
}

public enum FarmSimulation {
    /// Advances the tractor in world coordinates. A delayed frame never moves it
    /// farther than 50 ms, so resuming the app cannot jump across the meadow.
    public static func advance(
        _ state: TractorState,
        toward target: FarmPoint?,
        deltaTime: Double,
        obstacles: [Obstacle],
        rowAssist: Bool,
        pace: Double = 1
    ) -> TractorState {
        let dt = deltaTime.isFinite ? clamp(deltaTime, 0, 0.05) : 0
        var x = state.x
        var z = state.z
        var heading = state.heading
        var speed = state.speed
        let distance = target.map { hypot($0.x - x, $0.z - z) } ?? 0
        var desiredSpeed = 0.0

        if let target, distance > 0.38 {
            var desiredHeading = atan2(target.x - x, target.z - z)
            // floor(x + 0.5) matches JavaScript Math.round at negative halves.
            let snap = floor(desiredHeading / (.pi / 2) + 0.5) * .pi / 2
            if rowAssist && distance > 3 && abs(angleDifference(snap, desiredHeading)) < 0.13 {
                desiredHeading = snap
            }
            let turn = angleDifference(desiredHeading, heading)
            heading += clamp(turn, -dt * 4.8, dt * 4.8)
            // Respond to a new direction promptly while keeping the same
            // unhurried cruising speed. Slow down for a tight turn instead of
            // pushing forward away from a nearby destination.
            let alignment = max(0, cos(angleDifference(desiredHeading, heading)))
            desiredSpeed = min(5.5 * pace, distance * 2.6) * (0.06 + 0.94 * alignment)
        }

        // Braking also applies when a new target calls for a lower speed.
        // Exponential smoothing keeps the response consistent across displays.
        let response = desiredSpeed > speed ? 10.0 : 14.0
        speed += (desiredSpeed - speed) * (1 - exp(-response * dt))
        if speed < 0.015 { speed = 0 }
        x += sin(heading) * speed * dt
        z += cos(heading) * speed * dt

        var constrained = false
        for obstacle in obstacles {
            let dx = x - obstacle.x
            let dz = z - obstacle.z
            let distanceToObstacle = hypot(dx, dz)
            let clearance = obstacle.radius + 0.9
            if distanceToObstacle < clearance {
                let direction = distanceToObstacle > 0.001 ? atan2(dx, dz) : heading + .pi
                x = obstacle.x + sin(direction) * clearance
                z = obstacle.z + cos(direction) * clearance
                constrained = true
            }
        }

        let boundedX = clamp(x, -39, 39)
        let boundedZ = clamp(z, -30, 28)
        constrained = constrained || boundedX != x || boundedZ != z
        x = boundedX
        z = boundedZ
        if constrained && dt > 0 {
            // Glancing contact can slide; a head-on collision stops the wheels.
            // Resolving a loaded overlap must never accelerate the tractor.
            speed = min(speed, hypot(x - state.x, z - state.z) / dt)
            if speed < 0.015 { speed = 0 }
        }

        return TractorState(x: x, z: z, heading: heading, speed: speed)
    }

    public static func cellsUnderBrush(x: Double, z: Double, radius: Double) -> [Int] {
        cellsUnderSweep(from: FarmPoint(x: x, z: z), to: FarmPoint(x: x, z: z), radius: radius)
    }

    /// Continuous attachment coverage, including cells tangent to the swath between frames.
    public static func cellsUnderSweep(from: FarmPoint, to: FarmPoint, radius: Double) -> [Int] {
        guard from.x.isFinite, from.z.isFinite, to.x.isFinite, to.z.isFinite, radius.isFinite, radius >= 0 else { return [] }
        let dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz
        let minCol = Int(clamp(floor((min(from.x, to.x) - radius - FieldGrid.minX) / FieldGrid.cellSize), 0, Double(FieldGrid.columns - 1)))
        let maxCol = Int(clamp(floor((max(from.x, to.x) + radius - FieldGrid.minX) / FieldGrid.cellSize), 0, Double(FieldGrid.columns - 1)))
        let minRow = Int(clamp(floor((min(from.z, to.z) - radius - FieldGrid.minZ) / FieldGrid.cellSize), 0, Double(FieldGrid.rows - 1)))
        let maxRow = Int(clamp(floor((max(from.z, to.z) + radius - FieldGrid.minZ) / FieldGrid.cellSize), 0, Double(FieldGrid.rows - 1)))
        var result: [Int] = []
        for row in minRow...maxRow {
            for col in minCol...maxCol {
                let cx = FieldGrid.minX + (Double(col) + 0.5) * FieldGrid.cellSize
                let cz = FieldGrid.minZ + (Double(row) + 0.5) * FieldGrid.cellSize
                let t = lengthSquared > 0 ? clamp(((cx - from.x) * dx + (cz - from.z) * dz) / lengthSquared, 0, 1) : 0
                let cxDistance = from.x + t * dx - cx, czDistance = from.z + t * dz - cz
                if cxDistance * cxDistance + czDistance * czDistance <= radius * radius + 1e-10 {
                    result.append(row * FieldGrid.columns + col)
                }
            }
        }
        return result
    }

    private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
        max(lower, min(upper, value))
    }

    private static func angleDifference(_ a: Double, _ b: Double) -> Double {
        atan2(sin(a - b), cos(a - b))
    }
}
