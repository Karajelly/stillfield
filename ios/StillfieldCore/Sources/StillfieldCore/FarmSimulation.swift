import Foundation

public enum FarmTool: String, Codable, CaseIterable, Sendable {
    case plow, sow, harvest, mow, restore, wander

    public init(from decoder: Decoder) throws {
        let data = try decoder.singleValueContainer()
        let value = try data.decode(String.self)
        guard let tool = FarmTool(rawValue: value == "till" || value == "cultivate" ? "plow" : value) else {
            throw DecodingError.dataCorruptedError(in: data, debugDescription: "Unknown farm tool")
        }
        self = tool
    }
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
    /// Keep saved slider positions: the default cruises at 3 m/s, the maximum at 4.5 m/s.
    public static func cruiseSpeed(pace: Double = 0.85) -> Double {
        3 + (clamp(pace, 0.55, 1.25) - 0.85) / (1.25 - 0.85) * (4.5 - 3)
    }

    /// Advances the tractor in world coordinates. A delayed frame never moves it
    /// farther than 50 ms, so resuming the app cannot jump across the meadow.
    public static func advance(
        _ state: TractorState,
        toward target: FarmPoint?,
        deltaTime: Double,
        obstacles: [Obstacle],
        rowAssist: Bool,
        pace: Double = 0.85,
        paceScale: Double = 1
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
            desiredSpeed = min(cruiseSpeed(pace: pace) * clamp(paceScale, 0, 1), distance * 2.6) * (0.06 + 0.94 * alignment)
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

        let boundedX = clamp(x, FarmWorld.minX, FarmWorld.maxX)
        let boundedZ = clamp(z, FarmWorld.minZ, FarmWorld.maxZ)
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

    public static func cellsUnderBrush(x: Double, z: Double, radius: Double, bounds: FieldBounds = .home) -> [Int] {
        cellsUnderSweep(from: FarmPoint(x: x, z: z), to: FarmPoint(x: x, z: z), radius: radius, bounds: bounds)
    }

    /// Continuous attachment coverage, including cells tangent to the swath between frames.
    public static func cellsUnderSweep(from: FarmPoint, to: FarmPoint, radius: Double, bounds: FieldBounds = .home) -> [Int] {
        guard from.x.isFinite, from.z.isFinite, to.x.isFinite, to.z.isFinite, radius.isFinite, radius >= 0 else { return [] }
        let dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz
        let size = bounds.cellSize, columns = bounds.columns, rows = bounds.rows
        let minCol = Int(clamp(floor((min(from.x, to.x) - radius - bounds.minX) / size), 0, Double(columns - 1)))
        let maxCol = Int(clamp(floor((max(from.x, to.x) + radius - bounds.minX) / size), 0, Double(columns - 1)))
        let minRow = Int(clamp(floor((min(from.z, to.z) - radius - bounds.minZ) / size), 0, Double(rows - 1)))
        let maxRow = Int(clamp(floor((max(from.z, to.z) + radius - bounds.minZ) / size), 0, Double(rows - 1)))
        var result: [Int] = []
        for row in minRow...maxRow {
            for col in minCol...maxCol {
                let cx = bounds.minX + (Double(col) + 0.5) * size
                let cz = bounds.minZ + (Double(row) + 0.5) * size
                let t = lengthSquared > 0 ? clamp(((cx - from.x) * dx + (cz - from.z) * dz) / lengthSquared, 0, 1) : 0
                let cxDistance = from.x + t * dx - cx, czDistance = from.z + t * dz - cz
                if cxDistance * cxDistance + czDistance * czDistance <= radius * radius + 1e-10 {
                    result.append(row * columns + col)
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
