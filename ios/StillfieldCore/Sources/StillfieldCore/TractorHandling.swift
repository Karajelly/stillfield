import Foundation

enum TractorHandling {
    static let turnRate = 1.2
    static let tapTurnRate = 1.4
    static let brushRadius = 1.285
    static let attachmentOffset = 2.1
    static func clamp(_ x: Double, _ low: Double, _ high: Double) -> Double { max(low, min(high, x)) }
    static func angle(_ a: Double, _ b: Double) -> Double { atan2(sin(a - b), cos(a - b)) }
    static func attachment(_ state: TractorState) -> FarmPoint {
        FarmPoint(x: state.x - sin(state.heading) * attachmentOffset, z: state.z - cos(state.heading) * attachmentOffset)
    }
    static func inField(_ p: FarmPoint) -> Bool {
        p.x.isFinite && p.z.isFinite && p.x >= FieldGrid.minX && p.x <= FieldGrid.maxX
            && p.z >= FieldGrid.minZ && p.z <= FieldGrid.maxZ
    }
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
        let x = clamp(result.x, -39, 39), z = clamp(result.z, -30, 28)
        constrained = constrained || x != result.x || z != result.z
        result.x = x; result.z = z
        if constrained && dt > 0 { result.speed = min(result.speed, hypot(x - before.x, z - before.z) / dt) }
        if result.speed < 0.015 { result.speed = 0 }
        return result
    }
}

public enum DriveInput: Equatable, Sendable {
    case drag(Double)
    case target(FarmPoint)
}

/// Touch-origin steering: camera motion never changes the requested turn.
public struct GentleDrive: Sendable {
    public private(set) var steering = 0.0
    public init() {}
    public mutating func reset() { steering = 0 }
    public static func dragAmount(_ dx: Double) -> Double {
        let amount = TractorHandling.clamp((abs(dx) - 10) / 100, 0, 1)
        return amount == 0 ? 0 : (dx < 0 ? -1 : 1) * pow(amount, 1.7)
    }
    public mutating func step(_ state: TractorState, deltaTime: Double, input: DriveInput?,
                              obstacles: [Obstacle] = [], paceScale: Double = 1, pace: Double = 0.85) -> TractorState {
        let dt = deltaTime.isFinite ? TractorHandling.clamp(deltaTime, 0, 0.05) : 0
        var result = state
        var desiredSpeed = 0.0
        switch input {
        case .drag(let dx):
            let requested = Self.dragAmount(dx)
            steering = requested == 0 ? 0 : steering + (requested - steering) * (1 - exp(-12 * dt))
            result.heading -= steering * TractorHandling.turnRate * dt
            let cruise = 5.5 * pace
            desiredSpeed = cruise - (cruise - 1.29) * pow(abs(steering), 1.3)
        case .target(let target):
            steering = 0
            let distance = hypot(target.x - state.x, target.z - state.z)
            if distance > 0.38 {
                let turn = TractorHandling.angle(atan2(target.x - state.x, target.z - state.z), state.heading)
                result.heading += TractorHandling.clamp(turn * (1 - exp(-4 * dt)),
                    -TractorHandling.tapTurnRate * dt, TractorHandling.tapTurnRate * dt)
                let alignment = max(0, cos(turn))
                desiredSpeed = min(5.5 * pace * paceScale, distance * 2.4) * (0.04 + 0.96 * alignment * alignment)
            }
        case nil: steering = 0
        }
        result.speed += (desiredSpeed - result.speed) * (1 - exp(-(desiredSpeed > result.speed ? 4 : 10) * dt))
        if result.speed < 0.015 { result.speed = 0 }
        result.x += sin(result.heading) * result.speed * dt
        result.z += cos(result.heading) * result.speed * dt
        return TractorHandling.constrain(state, result, dt: dt, obstacles: obstacles)
    }
}

/// The hold delay separates destination taps from continuous third-person driving.
public struct SteeringGesture: Sendable {
    public let origin: SIMD2<Double>
    public private(set) var location: SIMD2<Double>
    public let start: Double
    public private(set) var moved = false
    public init(location: SIMD2<Double>, time: Double) { origin = location; self.location = location; start = time }
    public mutating func update(_ point: SIMD2<Double>) {
        location = point
        moved = moved || hypot(point.x - origin.x, point.y - origin.y) > 8
    }
    public func isDriving(at time: Double) -> Bool { moved || time - start > 0.22 }
    public var drag: Double { location.x - origin.x }
}
