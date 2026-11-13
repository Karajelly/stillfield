import Foundation

public struct WorkedRow: Sendable {
    public var start: FarmPoint
    public var end: FarmPoint
    public var heading: Double
}
private func forward(_ heading: Double) -> FarmPoint { FarmPoint(x: sin(heading), z: cos(heading)) }
private func sideways(_ heading: Double) -> FarmPoint { FarmPoint(x: cos(heading), z: -sin(heading)) }
private func dot(_ a: FarmPoint, _ b: FarmPoint) -> Double { a.x * b.x + a.z * b.z }
private func delta(_ a: FarmPoint, _ b: FarmPoint) -> FarmPoint { FarmPoint(x: a.x - b.x, z: a.z - b.z) }
private func position(_ state: TractorState) -> FarmPoint { FarmPoint(x: state.x, z: state.z) }

/// Records actual straight work, including diagonal rows, without steering or choosing spacing.
struct WorkedRows {
    var last: WorkedRow?
    private var streak: WorkedRow?
    mutating func sample(_ state: TractorState, working: Bool) {
        let brush = TractorHandling.attachment(state)
        guard working else { streak = nil; return }
        guard TractorHandling.inField(brush) else { return }
        if streak == nil || abs(TractorHandling.angle(state.heading, streak!.heading)) > 0.04
            || abs(dot(delta(brush, streak!.start), sideways(streak!.heading))) > 0.12 {
            streak = WorkedRow(start: brush, end: brush, heading: state.heading)
        }
        streak!.end = brush
        let length = hypot(brush.x - streak!.start.x, brush.z - streak!.start.z)
        // Observe the worked line, without accumulating the initial steering error.
        if length >= 1 { streak!.heading = atan2(brush.x - streak!.start.x, brush.z - streak!.start.z) }
        if length >= 6 { last = streak }
    }
    mutating func finish(_ point: FarmPoint, state: TractorState) {
        if var row = streak, hypot(row.end.x - row.start.x, row.end.z - row.start.z) >= 6,
           abs(dot(delta(point, row.start), sideways(row.heading))) < 0.55,
           abs(TractorHandling.angle(state.heading, row.heading)) < 0.1 {
            let f = forward(row.heading), length = dot(delta(point, row.start), forward(row.heading))
            row.end = FarmPoint(x: row.start.x + f.x * length, z: row.start.z + f.z * length)
            last = row
        }
        streak = nil
    }
}

struct EndAlignment {
    let point: FarmPoint
    let incomingHeading: Double
    let heading: Double
}

func alignmentForTap(_ last: WorkedRow?, state: TractorState, point: FarmPoint, obstacles: [Obstacle]) -> EndAlignment? {
    guard let last, TractorHandling.inField(point), state.speed <= 0.15,
          hypot(last.end.x - last.start.x, last.end.z - last.start.z) >= 6,
          abs(TractorHandling.angle(last.heading, state.heading)) <= 0.12 else { return nil }
    let f = forward(last.heading), s = sideways(last.heading)
    let parked = delta(position(state), last.end), tap = delta(point, last.end)
    guard abs(dot(parked, s)) <= 0.2, dot(parked, f) >= -0.5, dot(parked, f) <= 3,
          abs(dot(tap, f)) <= 1.25, abs(dot(tap, s)) >= 0.18, abs(dot(tap, s)) <= 3.5 else { return nil }
    let alignment = EndAlignment(point: point, incomingHeading: last.heading, heading: last.heading + .pi)
    let turn = EndTurn(state, alignment: alignment)
    let finish = FarmPoint(x: point.x - f.x * (TractorHandling.attachmentOffset + 0.6), z: point.z - f.z * (TractorHandling.attachmentOffset + 0.6))
    let start = turn.path.last!, length = hypot(finish.x - start.x, finish.z - start.z)
    var points = turn.path + [finish]
    for d in stride(from: 0.0, to: length, by: 0.2) {
        points.append(FarmPoint(x: start.x + (finish.x - start.x) * d / length, z: start.z + (finish.z - start.z) * d / length))
    }
    guard !points.contains(where: { p in
        p.x < FarmWorld.minX + 0.2 || p.x > FarmWorld.maxX - 0.2 || p.z < FarmWorld.minZ + 0.2 || p.z > FarmWorld.maxZ - 0.2
            || obstacles.contains { hypot(p.x - $0.x, p.z - $0.z) < $0.radius + 1.05 }
    }) else { return nil }
    return alignment
}

/// A slow turn into the selected spot. Finishing the work and stopping belong to navigation.
final class EndTurn {
    let alignment: EndAlignment
    let radius: Double
    private(set) var path: [FarmPoint] = []
    private(set) var done = false
    private(set) var blocked = false
    private var elapsed = 0.0
    private var index = 0
    private var stalled = 0.0
    private let arcEnd: FarmPoint
    init(_ state: TractorState, alignment: EndAlignment) {
        self.alignment = alignment
        let f = forward(alignment.incomingHeading), s = sideways(alignment.incomingHeading)
        let shift = dot(delta(alignment.point, position(state)), s)
        radius = abs(shift) / 2
        arcEnd = FarmPoint(x: state.x + s.x * shift, z: state.z + s.z * shift)
        for i in 0...48 {
            let angle = Double(i) / 48 * .pi, along = radius * sin(angle), across = shift / 2 * (1 - cos(angle))
            path.append(FarmPoint(x: state.x + f.x * along + s.x * across, z: state.z + f.z * along + s.z * across))
        }
        for i in 1...60 {
            let d = Double(i) * 0.05
            path.append(FarmPoint(x: arcEnd.x - f.x * d, z: arcEnd.z - f.z * d))
        }
    }
    func step(_ state: TractorState, dt: Double, obstacles: [Obstacle]) -> TractorState {
        elapsed += dt
        var closest = index, distance = Double.infinity
        for i in index..<min(path.count, index + 16) {
            let d = hypot(path[i].x - state.x, path[i].z - state.z)
            if d < distance { closest = i; distance = d }
        }
        index = closest
        let onStraight = closest >= 48
        let lookAhead = onStraight ? 0.55 : TractorHandling.clamp(radius * 0.5, 0.04, 0.55)
        var look = closest, lookDistance = 0.0
        while look < path.count - 1 && lookDistance < lookAhead {
            lookDistance += hypot(path[look + 1].x - path[look].x, path[look + 1].z - path[look].z)
            look += 1
        }
        let target = path[look], dx = target.x - state.x, dz = target.z - state.z
        let error = TractorHandling.angle(atan2(dx, dz), state.heading)
        let desiredSpeed = (onStraight ? 1.15 : min(1.15, radius * TractorHandling.turnRate * 0.9)) * max(0.15, cos(error))
        let speed = max(0.02, state.speed + (desiredSpeed - state.speed) * (1 - exp(-4 * dt)))
        let yaw = TractorHandling.clamp(2 * speed * sin(error) / max(0.03, hypot(dx, dz)), -TractorHandling.turnRate, TractorHandling.turnRate)
        let heading = state.heading + yaw * dt
        let result = TractorHandling.constrain(state, TractorState(x: state.x + sin(heading) * speed * dt,
            z: state.z + cos(heading) * speed * dt, heading: heading, speed: speed), dt: dt, obstacles: obstacles)
        done = dot(delta(position(result), arcEnd), forward(alignment.heading)) > 0.85
            && abs(dot(delta(position(result), alignment.point), sideways(alignment.heading))) < 0.025
            && abs(TractorHandling.angle(result.heading, alignment.heading)) < 0.025
        stalled = hypot(result.x - state.x, result.z - state.z) < 0.0002 ? stalled + dt : 0
        blocked = stalled > 1 || elapsed > 12
        return result
    }
}
