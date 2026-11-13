import Foundation

enum TractorHandling {
    static let turnRate = 1.2
    static let tapTurnRate = 1.4
    static let brushRadius = 1.25
    static let attachmentOffset = 2.1
    static func clamp(_ x: Double, _ low: Double, _ high: Double) -> Double { max(low, min(high, x)) }
    static func angle(_ a: Double, _ b: Double) -> Double { atan2(sin(a - b), cos(a - b)) }
    static func attachment(_ state: TractorState) -> FarmPoint {
        FarmPoint(x: state.x - sin(state.heading) * attachmentOffset, z: state.z - cos(state.heading) * attachmentOffset)
    }
    /// Whether a point is in any field.
    static func inField(_ p: FarmPoint) -> Bool { FieldBounds.containing(p) != nil }
    static func constrain(_ before: TractorState, _ after: TractorState, dt: Double, obstacles: [Obstacle]) -> TractorState {
        var result = after
        var constrained = false
        for obstacle in obstacles {
            let dx = result.x - obstacle.x, dz = result.z - obstacle.z
            let distance = hypot(dx, dz), clearance = obstacle.radius + 0.9
            if distance < clearance {
                let direction = distance > 0.001 ? atan2(dx, dz) : result.heading + .pi
                result.x = obstacle.x + sin(direction) * clearance
                result.z = obstacle.z + cos(direction) * clearance
                constrained = true
            }
        }
        let x = clamp(result.x, FarmWorld.minX, FarmWorld.maxX), z = clamp(result.z, FarmWorld.minZ, FarmWorld.maxZ)
        constrained = constrained || x != result.x || z != result.z
        result.x = x; result.z = z
        if constrained && dt > 0 { result.speed = min(result.speed, hypot(x - before.x, z - before.z) / dt) }
        if result.speed < 0.015 { result.speed = 0 }
        return result
    }
}

public enum DriveInput: Equatable, Sendable {
    /// Tractor view drag: swing toward this heading and hold it (position control).
    case heading(Double)
    /// Keyboard driving: throttle and steer are each -1, 0, or 1; steer-positive turns right.
    case keys(throttle: Double, steer: Double)
    case target(FarmPoint)
}

/// Matches `GentleDrive` in src/handling.ts.
public struct GentleDrive: Sendable {
    public static let deadzone = 10.0
    public static let dragPerQuarterTurn = 100.0
    static let keySteerResponse = 3.0
    static let tightTurnSpeed = 1.29
    public private(set) var steering = 0.0
    public init() {}
    public mutating func reset() { steering = 0 }
    /// Sideways drag distance becomes a heading offset, capped at an about-face.
    public static func steeringOffset(_ dx: Double) -> Double {
        guard dx.isFinite else { return 0 }
        let amount = max(0, abs(dx) - deadzone) / dragPerQuarterTurn
        return (dx < 0 ? -1 : 1) * min(.pi, amount * .pi / 4)
    }
    public mutating func step(_ state: TractorState, deltaTime: Double, input: DriveInput?,
                              obstacles: [Obstacle] = [], paceScale: Double = 1, pace: Double = 0.85) -> TractorState {
        let dt = deltaTime.isFinite ? TractorHandling.clamp(deltaTime, 0, 0.05) : 0
        var result = state
        var desiredSpeed = 0.0
        let cruise = FarmSimulation.cruiseSpeed(pace: pace)
        switch input {
        case .heading(let heading):
            // Swing toward the chosen direction and hold it there. The tractor never circles.
            steering = 0
            let turn = TractorHandling.angle(heading, state.heading)
            result.heading += TractorHandling.clamp(turn * (1 - exp(-4 * dt)),
                -TractorHandling.tapTurnRate * dt, TractorHandling.tapTurnRate * dt)
            let sharpness = min(1, abs(turn) / (.pi / 2))
            desiredSpeed = cruise - (cruise - Self.tightTurnSpeed) * pow(sharpness, 1.3)
        case .keys(let throttleInput, let steerInput):
            let throttle = Self.sign(throttleInput), steer = throttle < 0 ? 0 : Self.sign(steerInput)
            // Turning eases in so a quick press nudges; letting go straightens at once.
            steering = steer == 0 ? 0 : steering + (steer - steering) * (1 - exp(-Self.keySteerResponse * dt))
            result.heading -= steering * TractorHandling.turnRate * dt
            if throttle > 0 { desiredSpeed = cruise - (cruise - Self.tightTurnSpeed) * pow(abs(steering), 1.3) }
            else if throttle == 0 && steer != 0 { desiredSpeed = Self.tightTurnSpeed }
        case .target(let target):
            steering = 0
            let distance = hypot(target.x - state.x, target.z - state.z)
            if distance > 0.38 {
                let turn = TractorHandling.angle(atan2(target.x - state.x, target.z - state.z), state.heading)
                result.heading += TractorHandling.clamp(turn * (1 - exp(-4 * dt)),
                    -TractorHandling.tapTurnRate * dt, TractorHandling.tapTurnRate * dt)
                let alignment = max(0, cos(turn))
                desiredSpeed = min(cruise * TractorHandling.clamp(paceScale, 0, 1), distance * 2.4) * (0.04 + 0.96 * alignment * alignment)
            }
        case nil: steering = 0
        }
        result.speed += (desiredSpeed - result.speed) * (1 - exp(-(desiredSpeed > result.speed ? 4 : 10) * dt))
        if result.speed < 0.015 { result.speed = 0 }
        result.x += sin(result.heading) * result.speed * dt
        result.z += cos(result.heading) * result.speed * dt
        return TractorHandling.constrain(state, result, dt: dt, obstacles: obstacles)
    }
    private static func sign(_ value: Double) -> Double { value > 0 ? 1 : value < 0 ? -1 : 0 }
}

/// Tractor view's touch gesture, matching src/follow-camera.ts. A tap that stays put
/// chooses a destination; moving more than 8 points starts rolling, and the sideways
/// offset from the touch sets the heading to hold. There is no hold timer.
public struct SteeringGesture: Sendable {
    public let origin: SIMD2<Double>
    public let startHeading: Double
    public private(set) var location: SIMD2<Double>
    public private(set) var moved = false
    /// The furthest the touch has been from where it began.
    public private(set) var travel = 0.0
    public init(location: SIMD2<Double>, heading: Double) {
        origin = location; self.location = location; startHeading = heading
    }
    public mutating func update(_ point: SIMD2<Double>) {
        location = point
        travel = max(travel, hypot(point.x - origin.x, point.y - origin.y))
        moved = moved || travel > 8
    }
    /// With tidy rows in the overhead view, a tap may wobble under a finger: only a
    /// touch that has been held or carried well away becomes freehand steering.
    public func isFreehand(heldFor seconds: Double) -> Bool { moved && (seconds > 0.16 || travel > 28) }
    public var drag: Double { location.x - origin.x }
    /// Drag right to turn right. Heading-positive is screen-left for the +Z forward tractor.
    public var heading: Double { startHeading - GentleDrive.steeringOffset(drag) }
}
