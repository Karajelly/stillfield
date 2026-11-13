import Foundation

/// The direction a tidy row runs.
public enum RowAxis: String, Codable, Sendable { case x, z }

/// One lane of the field, worked from one cell to another. Matches the web's `Row`.
public struct TidyRow: Equatable, Sendable {
    public var axis: RowAxis
    /// Which lane across the field, counted from its minimum edge.
    public var lane: Int
    /// First and last cell along the row, both worked.
    public var from: Int
    public var to: Int
    /// +1 toward the field's maximum, -1 toward its minimum.
    public var dir: Int

    public init(axis: RowAxis, lane: Int, from: Int, to: Int, dir: Int) {
        self.axis = axis; self.lane = lane; self.from = from; self.to = to; self.dir = dir
    }
}

/// Tidy rows: the field is divided into lanes one implement wide, and a tap
/// asks for a whole row along one of them. The tractor drives to the lane with
/// its implement lifted, then works exactly that lane's cells from where it
/// stood to where the player tapped. Rows therefore sit side by side with no
/// slivers, no overlap onto a neighbour, and nothing worked on the way there.
/// Keep in step with `src/tidy-rows.ts`.
public enum TidyRows {
    public static let laneCells = Int((TractorHandling.brushRadius * 2 / FieldGrid.cellSize).rounded())
    public static let laneWidth = Double(laneCells) * FieldGrid.cellSize
    /// A tap just past the field's edge still means its outermost cells.
    public static let edgeReach = 2.0
    /// How far inside a lane's edge a tap can still be read as its neighbour.
    static let laneSlack = 0.7

    static func along(_ p: FarmPoint, _ axis: RowAxis) -> Double { axis == .x ? p.x : p.z }
    static func across(_ p: FarmPoint, _ axis: RowAxis) -> Double { axis == .x ? p.z : p.x }
    static func alongMin(_ axis: RowAxis) -> Double { axis == .x ? FieldGrid.minX : FieldGrid.minZ }
    static func acrossMin(_ axis: RowAxis) -> Double { axis == .x ? FieldGrid.minZ : FieldGrid.minX }
    static func point(_ axis: RowAxis, along: Double, across: Double) -> FarmPoint {
        axis == .x ? FarmPoint(x: along, z: across) : FarmPoint(x: across, z: along)
    }
    static func position(_ state: TractorState) -> FarmPoint { FarmPoint(x: state.x, z: state.z) }

    public static func alongCells(_ axis: RowAxis) -> Int { axis == .x ? FieldGrid.columns : FieldGrid.rows }
    public static func laneCount(_ axis: RowAxis) -> Int { (axis == .x ? FieldGrid.rows : FieldGrid.columns) / laneCells }
    public static func laneCentre(_ axis: RowAxis, lane: Int) -> Double { acrossMin(axis) + (Double(lane) + 0.5) * laneWidth }
    public static func cellCentre(_ axis: RowAxis, cell: Int) -> Double { alongMin(axis) + (Double(cell) + 0.5) * FieldGrid.cellSize }
    public static func lane(at p: FarmPoint, axis: RowAxis) -> Int {
        min(laneCount(axis) - 1, max(0, Int(floor((across(p, axis) - acrossMin(axis)) / laneWidth))))
    }
    public static func cell(at p: FarmPoint, axis: RowAxis) -> Int {
        min(alongCells(axis) - 1, max(0, Int(floor((along(p, axis) - alongMin(axis)) / FieldGrid.cellSize))))
    }
    public static func heading(_ axis: RowAxis, dir: Int) -> Double {
        axis == .x ? (dir > 0 ? .pi / 2 : -.pi / 2) : (dir > 0 ? 0 : .pi)
    }
    /// Where a row finishes: the centre of its last cell, on the lane's centre line.
    public static func end(of row: TidyRow) -> FarmPoint {
        point(row.axis, along: cellCentre(row.axis, cell: row.to), across: laneCentre(row.axis, lane: row.lane))
    }

    public static func nearField(_ p: FarmPoint, reach: Double = edgeReach) -> Bool {
        p.x.isFinite && p.z.isFinite && p.x >= FieldGrid.minX - reach && p.x <= FieldGrid.maxX + reach
            && p.z >= FieldGrid.minZ - reach && p.z <= FieldGrid.maxZ + reach
    }

    /// The ground a row covers, for drawing it: its centre, and its extent along x and z.
    public static func rect(of row: TidyRow) -> (x: Double, z: Double, width: Double, depth: Double) {
        let a = min(row.from, row.to), b = max(row.from, row.to)
        let length = Double(b - a + 1) * FieldGrid.cellSize
        let centre = point(row.axis, along: alongMin(row.axis) + Double(a + b + 1) / 2 * FieldGrid.cellSize,
                           across: laneCentre(row.axis, lane: row.lane))
        return (centre.x, centre.z, row.axis == .x ? length : laneWidth, row.axis == .x ? laneWidth : length)
    }

    /// The lane's full width of field cells at each step from `a` to `b` along a row.
    public static func cells(of row: TidyRow, from a: Int? = nil, to b: Int? = nil) -> [Int] {
        let a = a ?? row.from, b = b ?? row.to
        var cells: [Int] = []
        let first = row.lane * laneCells
        for along in stride(from: a, through: b, by: b >= a ? 1 : -1) {
            for across in first..<(first + laneCells) {
                cells.append(row.axis == .x ? across * FieldGrid.columns + along : along * FieldGrid.columns + across)
            }
        }
        return cells
    }

    /// Rows keep running the way the tractor faces, unless the tap is well off to
    /// one side: then a row across is the shorter, more natural job.
    private static func chooseAxis(_ state: TractorState, brush: FarmPoint, tap: FarmPoint) -> RowAxis {
        let dx = abs(tap.x - brush.x), dz = abs(tap.z - brush.z)
        // floor(x + 0.5) matches JavaScript Math.round at negative halves.
        let quarter = floor(state.heading / (.pi / 2) + 0.5) * (.pi / 2)
        if abs(TractorHandling.angle(state.heading, quarter)) >= 0.35 { return dx >= dz ? .x : .z }
        let facing: RowAxis = abs(sin(state.heading)) > 0.5 ? .x : .z
        let along = facing == .x ? dx : dz, across = facing == .x ? dz : dx
        return across > 1.5 * laneWidth && along < 0.5 * across ? (facing == .x ? .z : .x) : facing
    }

    /// Turn a tap into rows. A row starts beside the implement and ends at the
    /// tapped cell, in the tapped lane. Ends settle onto the field's edge or the
    /// last row's ends when the tap is close to them, so blocks come out square.
    /// - Parameters:
    ///   - fill: Work every lane between the implement and the tap, not only the tapped one.
    ///   - last: The row most recently finished, so new rows can line their ends up with it.
    ///   - workable: Whether the current tool would change a cell. Lets a fill skip idle lanes.
    public static func plan(_ state: TractorState, tap: FarmPoint, fill: Bool = false, last: TidyRow? = nil,
                            workable: ((Int) -> Bool)? = nil) -> [TidyRow] {
        guard nearField(tap) else { return [] }
        let brush = TractorHandling.attachment(state)
        let axis = chooseAxis(state, brush: brush, tap: tap), count = alongCells(axis)
        func nearest(_ cell: Int, reach: Int, anchors: [Int]) -> Int {
            var best = cell, distance = reach + 1
            for anchor in anchors {
                let d = abs(anchor - cell)
                if d <= reach && d < distance { best = anchor; distance = d }
            }
            return best
        }
        var ends: [Int] = []
        if let last, last.axis == axis { ends = [last.from, last.to] }
        let to = nearest(cell(at: tap, axis: axis), reach: 3, anchors: [0, count - 1] + ends)
        let from = nearest(cell(at: brush, axis: axis), reach: 2, anchors: ends)
        let facing = axis == .x ? sin(state.heading) : cos(state.heading)
        let dir = to > from ? 1 : to < from ? -1 : facing >= 0 ? 1 : -1
        func row(_ lane: Int) -> TidyRow { TidyRow(axis: axis, lane: lane, from: from, to: to, dir: dir) }
        func hasWork(_ lane: Int) -> Bool {
            guard let workable else { return true }
            return cells(of: row(lane)).contains(where: workable)
        }
        var tapLane = lane(at: tap, axis: axis)
        if !fill {
            // A tap near a lane's edge may have been meant for its neighbour. Prefer
            // the lane with something to do, then the one beside the last row.
            let within = across(tap, axis) - acrossMin(axis) - Double(tapLane) * laneWidth
            let beside = within < laneSlack ? tapLane - 1 : within > laneWidth - laneSlack ? tapLane + 1 : tapLane
            if beside != tapLane, beside >= 0, beside < laneCount(axis), hasWork(beside) {
                func follows(_ lane: Int) -> Bool {
                    guard let last, last.axis == axis else { return false }
                    return abs(lane - last.lane) == 1
                }
                if !hasWork(tapLane) || (follows(beside) && !follows(tapLane)) { tapLane = beside }
            }
            return [row(tapLane)]
        }
        let startLane = lane(at: brush, axis: axis)
        var rows = stride(from: startLane, through: tapLane, by: tapLane >= startLane ? 1 : -1).map(row)
        let busy = rows.filter { hasWork($0.lane) }
        rows = busy.isEmpty ? Array(rows.suffix(1)) : busy
        // Back and forth, each row starting at the end the last one finished on.
        return rows.enumerated().map { index, planned in
            index % 2 == 1 ? TidyRow(axis: axis, lane: planned.lane, from: to, to: from, dir: -dir) : planned
        }
    }
}

private let straightLook = 2.6, arcLook = 0.9
/// How far the deck's leading edge works ahead of the implement's centre.
private let deckReach = 0.75
/// Cells a row may pick up behind the deck once it is back on its lane.
private let catchUp = 4
/// Room kept beyond the tractor's own clearance when passing an obstacle.
private let passingRoom = 0.9 + 0.35

/// Waypoints that carry a straight leg around anything standing on it, by the
/// shorter way round. A row through the meadow's mill bends past and carries on.
private func around(_ a: FarmPoint, _ b: FarmPoint, obstacles: [Obstacle]) -> [FarmPoint] {
    let dx = b.x - a.x, dz = b.z - a.z, length = hypot(dx, dz)
    guard length >= 1e-6 else { return [] }
    var crossings: [(t: Double, points: [FarmPoint])] = []
    for obstacle in obstacles {
        let radius = obstacle.radius + passingRoom
        let along = ((obstacle.x - a.x) * dx + (obstacle.z - a.z) * dz) / length
        let off = ((obstacle.x - a.x) * dz - (obstacle.z - a.z) * dx) / length
        if abs(off) >= radius - 0.05 { continue }
        let half = (radius * radius - off * off).squareRoot()
        let enter = along - half, leave = along + half
        // A leg that starts or ends inside the circle cannot be routed clear of it.
        if enter <= 0 || leave >= length { continue }
        func at(_ d: Double) -> FarmPoint { FarmPoint(x: a.x + dx * d / length, z: a.z + dz * d / length) }
        let from = at(enter), to = at(leave)
        let start = atan2(from.x - obstacle.x, from.z - obstacle.z)
        let sweep = TractorHandling.angle(atan2(to.x - obstacle.x, to.z - obstacle.z), start)
        var points = [from]
        let steps = max(2, Int(ceil(abs(sweep) / 0.3)))
        for i in 1..<steps {
            let angle = start + sweep * Double(i) / Double(steps)
            points.append(FarmPoint(x: obstacle.x + sin(angle) * radius, z: obstacle.z + cos(angle) * radius))
        }
        points.append(to)
        crossings.append((enter, points))
    }
    return crossings.sorted { $0.t < $1.t }.flatMap(\.points)
}

/// One row in progress: the way to it, and the cells worked so far.
final class TidyRun {
    private(set) var row: TidyRow
    /// The last cell along the row already worked, once work has begun.
    private(set) var workedTo: Int?
    /// Whether the implement is down: on its row, not on the way to it.
    private(set) var lowered = false
    private(set) var done = false
    private var points: [FarmPoint]
    private var look: [Double]
    private var segment = 0
    private var lastBrush: FarmPoint?
    private let obstacles: [Obstacle]
    /// Cells under something standing in the field. Nothing grows through a mill.
    private let covered: Set<Int>
    var started: Bool { workedTo != nil }

    /// `hint` is where the player tapped. When the row means turning back along
    /// the tractor's own lane, it says which way to swing round.
    init(_ row: TidyRow, state: TractorState, obstacles: [Obstacle] = [], hint: FarmPoint? = nil) {
        self.row = row
        self.obstacles = obstacles
        var covered: Set<Int> = []
        for obstacle in obstacles {
            let centre = FarmPoint(x: obstacle.x, z: obstacle.z)
            covered.formUnion(FarmSimulation.cellsUnderSweep(from: centre, to: centre, radius: obstacle.radius - 0.2))
        }
        self.covered = covered
        let axis = row.axis, dir = Double(row.dir)
        let heading = TidyRows.heading(axis, dir: row.dir), centre = TidyRows.laneCentre(axis, lane: row.lane)
        let here = TidyRows.position(state), brush = TractorHandling.attachment(state)
        let across = TidyRows.across(here, axis) - centre, turn = TractorHandling.angle(state.heading, heading)
        let first = TidyRows.cellCentre(axis, cell: row.from)
        var points = [here], look = [straightLook]
        let aligned = abs(across) <= 0.35 && abs(turn) <= 0.2 && (first - TidyRows.along(brush, axis)) * dir >= -0.75
        // After turning round on the spot, the implement trails ahead of the
        // tractor's old position, so the row must begin further on than that.
        let canTurnRound = abs(abs(turn) - .pi) <= 0.3 && abs(across) >= 1.5 && abs(across) <= 2.2 * TidyRows.laneWidth
            && (first - TidyRows.along(here, axis)) * dir >= 0.5 - TractorHandling.attachmentOffset
        if canTurnRound {
            // A half circle onto the neighbouring lane, facing back the way it came.
            let forwardX = sin(state.heading), forwardZ = cos(state.heading)
            let abeam = TidyRows.point(axis, along: TidyRows.along(here, axis), across: centre)
            let sx = abeam.x - state.x, sz = abeam.z - state.z, radius = hypot(sx, sz) / 2
            for i in 1...16 {
                let a = Double(i) / 16 * .pi
                points.append(FarmPoint(x: state.x + forwardX * radius * sin(a) + sx / 2 * (1 - cos(a)),
                                        z: state.z + forwardZ * radius * sin(a) + sz / 2 * (1 - cos(a))))
                look.append(arcLook)
            }
        } else if !aligned {
            // Join the lane with the implement a little short of the first cell.
            let join = TidyRows.point(axis, along: first + (TractorHandling.attachmentOffset - 1.25) * dir, across: centre)
            // Heading back along its own lane, the join point sits dead astern, where
            // "the shorter way round" is a coin toss. Turn round deliberately instead.
            let behind = abs(abs(turn) - .pi) <= 0.6 && abs(across) < 1.5
                && (TidyRows.along(join, axis) - TidyRows.along(here, axis)) * dir > 1
            for point in behind ? Self.turnBack(state, row: row, hint: hint, obstacles: obstacles) : [] {
                points.append(point); look.append(arcLook)
            }
            points.append(join)
            look.append(straightLook)
        }
        points.append(Self.finish(row))
        look.append(straightLook)
        let route = Self.cleared(points, look, from: 1, obstacles: obstacles)
        self.points = route.0
        self.look = route.1
    }

    /// Radius of the turn back along a lane: the same half lane as a turn onto the next one.
    static let turnBackRadius = TidyRows.laneWidth / 2

    /// Turning back along the tractor's own lane: a half circle out to one side,
    /// so the tractor turns that way from the very first moment, then the lane is
    /// rejoined from beside it. It turns toward the side the player tapped; a tap
    /// on the centre line turns toward the middle of the field, where there is
    /// more room. Returns no points when neither side is clear, leaving the plain
    /// approach. Matches `turnBack` in `src/tidy-rows.ts`.
    static func turnBack(_ state: TractorState, row: TidyRow, hint: FarmPoint?, obstacles: [Obstacle]) -> [FarmPoint] {
        // Forward along the lane the way the tractor faces, and the tractor's left.
        let back = TidyRows.heading(row.axis, dir: row.dir)
        let fx = -sin(back), fz = -cos(back)
        let lx = fz, lz = -fx
        func leftOf(_ p: FarmPoint) -> Double { (p.x - state.x) * lx + (p.z - state.z) * lz }
        let middle = FarmPoint(x: (FieldGrid.minX + FieldGrid.maxX) / 2, z: (FieldGrid.minZ + FieldGrid.maxZ) / 2)
        let tapped = hint.map(leftOf) ?? 0
        let towardMiddle: Double = leftOf(middle) < 0 ? -1 : 1
        let preferred: Double = abs(tapped) > 0.15 ? (tapped < 0 ? -1 : 1) : towardMiddle
        let r = turnBackRadius
        func build(_ side: Double) -> [FarmPoint] {
            (1...16).map { i in
                let a = Double(i) / 16 * .pi, along = r * sin(a), aside = side * r * (1 - cos(a))
                return FarmPoint(x: state.x + fx * along + lx * aside, z: state.z + fz * along + lz * aside)
            }
        }
        func clear(_ points: [FarmPoint]) -> Bool {
            points.allSatisfy { p in
                p.x > -38.8 && p.x < 38.8 && p.z > -29.8 && p.z < 27.8
                    && obstacles.allSatisfy { hypot(p.x - $0.x, p.z - $0.z) >= $0.radius + 1.05 }
            }
        }
        for side in [preferred, -preferred] {
            let points = build(side)
            if clear(points) { return points }
        }
        return []
    }

    /// Bend every straight leg from `first` on around the obstacles in its way.
    private static func cleared(_ points: [FarmPoint], _ look: [Double], from first: Int,
                                obstacles: [Obstacle]) -> ([FarmPoint], [Double]) {
        var clearPoints = Array(points.prefix(first)), clearLook = Array(look.prefix(first))
        for i in first..<points.count {
            if look[i] == straightLook {
                for point in around(points[i - 1], points[i], obstacles: obstacles) {
                    clearPoints.append(point); clearLook.append(arcLook)
                }
            }
            clearPoints.append(points[i]); clearLook.append(look[i])
        }
        return (clearPoints, clearLook)
    }

    /// Where the tractor is headed once the row is done: past its end, on the lane.
    private static func finish(_ row: TidyRow) -> FarmPoint {
        TidyRows.point(row.axis, along: TidyRows.cellCentre(row.axis, cell: row.to)
            + (TractorHandling.attachmentOffset + 1.6) * Double(row.dir), across: TidyRows.laneCentre(row.axis, lane: row.lane))
    }

    /// Move the row's end along its lane. Cells already worked stay worked.
    func retarget(_ cell: Int) {
        let limit = workedTo ?? row.from
        row.to = (cell - limit) * row.dir >= 0 ? cell : limit
        // Rebuild the last leg from wherever the route has reached.
        let kept = min(segment + 1, points.count - 1)
        let route = Self.cleared(Array(points.prefix(kept)) + [Self.finish(row)],
                                 Array(look.prefix(kept)) + [straightLook], from: kept, obstacles: obstacles)
        points = route.0
        look = route.1
    }

    /// The point to steer toward, and how gently to arrive at the row's end.
    func guide(_ state: TractorState) -> (target: FarmPoint, paceScale: Double) {
        let last = points.count - 1
        // Progress only moves forward, so a tight turn cannot double back.
        var best = segment, bestT = 0.0, bestDistance = Double.infinity
        for i in segment..<max(segment, min(last, segment + 4)) {
            let a = points[i], b = points[i + 1]
            let dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz
            let t = lengthSquared > 0
                ? TractorHandling.clamp(((state.x - a.x) * dx + (state.z - a.z) * dz) / lengthSquared, 0, 1) : 1
            let d = hypot(a.x + dx * t - state.x, a.z + dz * t - state.z)
            if d < bestDistance - 1e-9 { best = i; bestT = t; bestDistance = d }
        }
        segment = best
        // Walk the look-ahead distance along the route from the closest point.
        var remaining = look[min(last, best + 1)], index = best, t = bestT, target = points[last]
        while index < last {
            let a = points[index], b = points[index + 1]
            let length = hypot(b.x - a.x, b.z - a.z), left = length * (1 - t)
            if remaining <= left && length > 0 {
                let u = t + remaining / length
                target = FarmPoint(x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u)
                break
            }
            remaining -= left; index += 1; t = 0
        }
        let toGo = (TidyRows.cellCentre(row.axis, cell: row.to)
            - TidyRows.along(TractorHandling.attachment(state), row.axis)) * Double(row.dir)
        return (target, TractorHandling.clamp((toGo + 0.5) / 3, 0.25, 1))
    }

    /// The cells the deck has just passed over, a full lane width at a time.
    func work(_ state: TractorState) -> [Int] {
        let cells = passed(state)
        return covered.isEmpty ? cells : cells.filter { !covered.contains($0) }
    }

    private func passed(_ state: TractorState) -> [Int] {
        let axis = row.axis, dir = Double(row.dir)
        let brush = TractorHandling.attachment(state), previous = lastBrush ?? brush
        lastBrush = brush
        lowered = false
        if done { return [] }
        let centre = TidyRows.laneCentre(axis, lane: row.lane)
        let onLane = abs(TidyRows.across(brush, axis) - centre) <= 1
            && abs(TractorHandling.angle(state.heading, TidyRows.heading(axis, dir: row.dir))) <= 0.6
        let along = TidyRows.along(brush, axis)
        lowered = (onLane || workedTo != nil)
            && (along - TidyRows.cellCentre(axis, cell: row.from)) * dir >= -0.9
            && (TidyRows.cellCentre(axis, cell: row.to) - along) * dir >= -0.6
        if !onLane {
            // Bending past an obstacle, the deck still works whatever part of the
            // row it actually crosses. Getting to a row, it works nothing.
            guard let workedTo else { return [] }
            let first = row.lane * TidyRows.laneCells
            return FarmSimulation.cellsUnderSweep(from: previous, to: brush, radius: TractorHandling.brushRadius).filter { cell in
                let column = cell % FieldGrid.columns, line = cell / FieldGrid.columns
                let alongCell = axis == .x ? column : line, acrossCell = axis == .x ? line : column
                return acrossCell >= first && acrossCell < first + TidyRows.laneCells
                    && (alongCell - workedTo) * row.dir > 0 && (row.to - alongCell) * row.dir >= 0
            }
        }
        // The furthest cell whose centre the deck's leading edge has reached.
        let reach = (along + deckReach * dir - TidyRows.alongMin(axis)) / FieldGrid.cellSize - 0.5
        let reached = Int(row.dir > 0 ? floor(reach) : ceil(reach))
        let upTo = (reached - row.to) * row.dir > 0 ? row.to : reached
        var start = workedTo.map { $0 + row.dir } ?? row.from
        // Ground the deck was carried around stays as it was.
        if workedTo != nil && (upTo - start) * row.dir > catchUp { start = upTo - catchUp * row.dir }
        var cells: [Int] = []
        if (upTo - start) * row.dir >= 0 {
            cells = TidyRows.cells(of: row, from: start, to: upTo)
            workedTo = upTo
        }
        done = workedTo == row.to && (along - TidyRows.cellCentre(axis, cell: row.to)) * dir >= -0.1
        return cells
    }
}
