import Foundation

/// Matches the web navigation controller; renderers paint only the returned attachment sweep.
public final class TractorNavigation {
    public private(set) var target: FarmPoint?
    private var work: WorkDestination?
    private var rows = WorkedRows()
    private var turn: EndTurn?
    private var aligning = false
    private var painting = true
    private var lastBrush: FarmPoint?
    private var blockedTime = 0.0
    private var drive = GentleDrive()
    public var workedRow: WorkedRow? { rows.last }
    public var turningAtRowEnd: Bool { turn != nil }

    public init() {}
    public func cancel() {
        target = nil; work = nil; turn = nil; aligning = false; painting = false
        lastBrush = nil; blockedTime = 0; drive.reset()
    }
    public func choose(_ point: FarmPoint, state: TractorState, tool: FarmTool, obstacles: [Obstacle]) {
        let previousBrush = painting ? lastBrush : nil
        cancel()
        guard point.x.isFinite, point.z.isFinite else { return }
        target = point; painting = true
        lastBrush = previousBrush
        work = WorkDestination.create(point, state: state, tool: tool)
        if work != nil, let alignment = alignmentForTap(rows.last, state: state, point: point, obstacles: obstacles) {
            turn = EndTurn(state, alignment: alignment); aligning = true; painting = false; lastBrush = nil
        }
    }
    public func changeTool(state: TractorState, tool: FarmTool, obstacles: [Obstacle]) {
        lastBrush = nil
        if let target, !aligning || tool == .wander { choose(target, state: state, tool: tool, obstacles: obstacles) }
    }
    public struct Step {
        public let state: TractorState
        public let paint: [FarmPoint]
        public let completed: Bool
        public let blocked: Bool
    }
    public func step(_ initial: TractorState, deltaTime: Double, tool: FarmTool, obstacles: [Obstacle],
                     pace: Double = 0.85, manual: DriveInput? = nil, follow: Bool = false) -> Step {
        let dt = deltaTime.isFinite ? TractorHandling.clamp(deltaTime, 0, 0.05) : 0
        var state = initial, paint: [FarmPoint] = []
        var completed = false, blocked = false
        func sweep() {
            guard tool != .wander else { lastBrush = nil; return }
            let point = TractorHandling.attachment(state), from = lastBrush ?? point
            paint += [from, point]
            lastBrush = point
        }
        func finish() {
            sweep(); rows.finish(work!.point, state: state); cancel(); completed = true
        }
        if manual != nil { target = nil; work = nil; turn = nil; aligning = false; painting = true }
        if turn == nil, work?.covered(state) == true { finish() }
        let previous = state, plan = turn == nil ? work?.plan(state) : nil
        let movementTarget = plan?.target ?? target
        if let turn {
            state = turn.step(state, dt: dt, obstacles: obstacles)
            if turn.blocked { cancel(); blocked = true }
            else if turn.done {
                work?.setArrivalHeading(turn.alignment.heading)
                self.turn = nil; painting = true; lastBrush = nil
            }
        } else if follow {
            state = drive.step(state, deltaTime: dt, input: manual ?? movementTarget.map { .target($0) },
                               obstacles: obstacles, paceScale: plan?.paceScale ?? 1, pace: pace)
        } else {
            let destination: FarmPoint?
            if case .target(let point) = manual { destination = point } else { destination = movementTarget }
            state = FarmSimulation.advance(state, toward: destination, deltaTime: dt, obstacles: obstacles,
                                           rowAssist: false, pace: pace * (plan?.paceScale ?? 1))
        }
        rows.sample(state, working: painting && tool != .wander && state.speed > 0.1)
        if turn == nil, work?.covered(state) == true { finish() }
        else if work == nil, let target, hypot(target.x - state.x, target.z - state.z) < 0.5 { self.target = nil }
        if turn == nil, target != nil, plan?.paceScale != 0, state.speed < 0.15,
           hypot(state.x - previous.x, state.z - previous.z) < 0.003,
           abs(TractorHandling.angle(state.heading, previous.heading)) < dt * 0.1 {
            blockedTime += dt
            if blockedTime > 1 { cancel(); blocked = true }
        } else { blockedTime = 0 }
        if painting && state.speed > 0.1 { sweep() }
        if state.speed == 0 { lastBrush = nil }
        return Step(state: state, paint: paint, completed: completed, blocked: blocked)
    }
}
