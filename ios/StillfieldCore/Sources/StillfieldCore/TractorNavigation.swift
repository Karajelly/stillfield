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
    /// Taps ask for whole rows on the field's lanes. Off keeps the original free approach.
    public var tidy = false
    /// The row most recently finished, so the next can line up with its ends.
    public private(set) var lastRow: TidyRow?
    /// The row being driven to or worked.
    private(set) var run: TidyRun?
    private var pending: [TidyRow] = []
    /// Taps made while a row was under way, in the order they will be worked.
    private var queue: [(point: FarmPoint, fill: Bool)] = []
    /// The rows those taps are expected to become, for showing what is planned.
    private var preview: [TidyRow] = []
    private var workable: ((Int) -> Bool)?
    /// Rows still to come, the one in progress first and cut down to what is left of it.
    public var plannedRows: [TidyRow] {
        guard let run else { return [] }
        var current = run.row
        if let workedTo = run.workedTo { current.from = workedTo + current.dir }
        return ((current.to - current.from) * current.dir >= 0 ? [current] : []) + pending + preview
    }
    public var hasQueued: Bool { !queue.isEmpty }
    public var isWorkingRow: Bool { run?.started == true }
    /// The implement rides up on the way to a row, between rows, and when travelling.
    public var lifted: Bool {
        if let run { return !run.lowered }
        return tidy && target != nil && work == nil && !painting
    }

    public init() {}
    public func cancel() {
        target = nil; work = nil; turn = nil; aligning = false; painting = false
        lastBrush = nil; blockedTime = 0; drive.reset()
        run = nil; pending = []; queue = []; preview = []
    }
    /// - Parameters:
    ///   - freehand: A drag steers freely; only taps ask for tidy rows.
    ///   - fill: Work every lane up to the tap instead of the tapped lane alone.
    ///   - workable: Whether the current tool would change a cell, so a fill can skip idle lanes.
    public func choose(_ point: FarmPoint, state: TractorState, tool: FarmTool, obstacles: [Obstacle],
                       freehand: Bool = false, fill: Bool = false, workable: ((Int) -> Bool)? = nil) {
        if tidy, !freehand, tool != .wander, point.x.isFinite, point.z.isFinite {
            if let workable { self.workable = workable }
            chooseTidy(point, state: state, fill: fill, obstacles: obstacles)
            return
        }
        let previousBrush = painting ? lastBrush : nil
        cancel(); lastRow = nil
        guard point.x.isFinite, point.z.isFinite else { return }
        target = point; painting = true
        lastBrush = previousBrush
        work = WorkDestination.create(point, state: state, tool: tool)
        if work != nil, let alignment = alignmentForTap(rows.last, state: state, point: point, obstacles: obstacles) {
            turn = EndTurn(state, alignment: alignment); aligning = true; painting = false; lastBrush = nil
        }
    }
    private func chooseTidy(_ point: FarmPoint, state: TractorState, fill: Bool, obstacles: [Obstacle]) {
        let inside = TidyRows.nearField(point)
        if let run, inside {
            // A row that has been asked for is never dropped by another tap. One in
            // its own lane moves its end; one anywhere else joins the list behind it.
            let row = run.row, lane = TidyRows.lane(at: point, axis: row.axis)
            if lane == row.lane, !fill {
                run.retarget(TidyRows.cell(at: point, axis: row.axis))
                target = TidyRows.end(of: run.row)
            } else {
                // Tapping a lane that is already waiting replaces what was asked of it.
                queue.removeAll { TidyRows.lane(at: $0.point, axis: row.axis) == lane }
                queue.append((point, fill))
                target = point
            }
            foresee()
            return
        }
        let last = lastRow
        cancel(); lastRow = last
        guard inside else {
            // Beyond the field there is nothing to work: leave any rows and travel
            // there with the implement up.
            target = point; painting = false
            return
        }
        begin(TidyRows.plan(state, tap: point, fill: fill, last: lastRow, workable: workable), state: state, obstacles: obstacles,
              tap: point)
    }
    /// Work out the rows the waiting taps will become, from where each will start.
    private func foresee() {
        preview = []
        guard var last = pending.last ?? run?.row else { return }
        for waiting in queue {
            let end = TidyRows.end(of: last), heading = TidyRows.heading(last.axis, dir: last.dir)
            let state = TractorState(x: end.x + sin(heading) * TractorHandling.attachmentOffset,
                                     z: end.z + cos(heading) * TractorHandling.attachmentOffset, heading: heading, speed: 0)
            let rows = TidyRows.plan(state, tap: waiting.point, fill: waiting.fill, last: last, workable: workable)
            preview += rows
            last = rows.last ?? last
        }
    }
    /// `tap` says which way to swing round when a row turns back along its own lane.
    private func begin(_ rows: [TidyRow], state: TractorState, obstacles: [Obstacle], tap: FarmPoint? = nil) {
        guard let first = rows.first else { return }
        run = TidyRun(first, state: state, obstacles: obstacles, hint: tap)
        pending = Array(rows.dropFirst())
        // The ring marks the corner that was asked for: the tapped lane, at the tapped cell.
        var corner = rows.last ?? first
        corner.to = first.to
        target = TidyRows.end(of: corner)
    }
    public func changeTool(state: TractorState, tool: FarmTool, obstacles: [Obstacle]) {
        lastBrush = nil
        // A row in progress carries on with the new tool; wandering simply drives on.
        if run != nil, tool != .wander { return }
        // Travelling with the implement up stays that way.
        if tidy, work == nil, tool != .wander { painting = false; return }
        if let target, !aligning || tool == .wander {
            choose(target, state: state, tool: tool, obstacles: obstacles, freehand: true)
        }
    }
    public struct Step {
        public let state: TractorState
        public let paint: [FarmPoint]
        /// Field cells a tidy row has just worked. Apply them as they are.
        public let cells: [Int]
        public let completed: Bool
        public let blocked: Bool
    }
    private func stepTidy(_ run: TidyRun, _ initial: TractorState, dt: Double, tool: FarmTool, obstacles: [Obstacle],
                          pace: Double, follow: Bool) -> Step {
        let previous = initial, guide = run.guide(initial)
        let state = follow
            ? drive.step(initial, deltaTime: dt, input: .target(guide.target), obstacles: obstacles,
                         paceScale: guide.paceScale, pace: pace)
            : FarmSimulation.advance(initial, toward: guide.target, deltaTime: dt, obstacles: obstacles,
                                     rowAssist: false, pace: pace, paceScale: guide.paceScale)
        let cells = tool == .wander ? [] : run.work(state)
        var completed = false, blocked = false
        if run.done {
            lastRow = run.row
            blockedTime = 0
            if !pending.isEmpty {
                self.run = TidyRun(pending.removeFirst(), state: state, obstacles: obstacles)
            } else if !queue.isEmpty {
                let waiting = queue.removeFirst(), rest = queue, last = lastRow
                cancel(); queue = rest; lastRow = last
                begin(TidyRows.plan(state, tap: waiting.point, fill: waiting.fill, last: lastRow, workable: workable),
                      state: state, obstacles: obstacles, tap: waiting.point)
                foresee()
                if let latest = queue.last { target = latest.point }
            } else {
                let last = lastRow
                cancel(); lastRow = last; completed = true
            }
        } else if state.speed < 0.15, hypot(state.x - previous.x, state.z - previous.z) < 0.003,
                  abs(TractorHandling.angle(state.heading, previous.heading)) < dt * 0.1 {
            blockedTime += dt
            if blockedTime > 1 {
                let last = lastRow
                cancel(); lastRow = last; blocked = true
            }
        } else { blockedTime = 0 }
        return Step(state: state, paint: [], cells: cells, completed: completed, blocked: blocked)
    }
    public func step(_ initial: TractorState, deltaTime: Double, tool: FarmTool, obstacles: [Obstacle],
                     pace: Double = 0.85, manual: DriveInput? = nil, follow: Bool = false) -> Step {
        let dt = deltaTime.isFinite ? TractorHandling.clamp(deltaTime, 0, 0.05) : 0
        if manual != nil { run = nil; pending = []; queue = []; preview = []; lastRow = nil }
        if let run { return stepTidy(run, initial, dt: dt, tool: tool, obstacles: obstacles, pace: pace, follow: follow) }
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
                                           rowAssist: false, pace: pace, paceScale: plan?.paceScale ?? 1)
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
        return Step(state: state, paint: paint, cells: [], completed: completed, blocked: blocked)
    }
}
