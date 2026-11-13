import Foundation
import Testing
@testable import StillfieldCore

private let east = Double.pi / 2, west = -Double.pi / 2
private func laneZ(_ lane: Int) -> Double { TidyRows.laneCentre(.x, lane: lane) }

/// A blank meadow driven by taps, with the field applying whatever is worked.
private final class TidyMeadow {
    let navigation = TractorNavigation()
    var state: TractorState
    var field = FieldGrid(starterRows: false)
    var tool = FarmTool.cultivate
    let obstacles: [Obstacle]
    let follow: Bool
    let fps: Double
    var slowest = Double.infinity

    init(_ initial: TractorState, tidy: Bool = true, follow: Bool = false, fps: Double = 60, obstacles: [Obstacle] = []) {
        state = initial; self.follow = follow; self.fps = fps; self.obstacles = obstacles
        navigation.tidy = tidy
    }
    func workable(_ cell: Int) -> Bool {
        switch tool {
        case .cultivate: field.cells[cell] != Ground.soil.rawValue
        case .sow: field.cells[cell] == Ground.soil.rawValue
        default: field.cells[cell] == Ground.mature.rawValue
        }
    }
    @discardableResult func step(_ input: DriveInput? = nil) -> TractorNavigation.Step {
        let result = navigation.step(state, deltaTime: 1 / fps, tool: tool, obstacles: obstacles, pace: 0.85, manual: input, follow: follow)
        state = result.state
        for (i, point) in result.paint.enumerated() { field.apply(from: result.paint[max(0, i - 1)], to: point, tool: tool) }
        if !result.cells.isEmpty { field.apply(cells: result.cells, tool: tool) }
        if navigation.run != nil { slowest = min(slowest, state.speed) }
        return result
    }
    var idle: Bool { navigation.run == nil && navigation.target == nil && state.speed == 0 }
    func tap(_ point: FarmPoint, fill: Bool = false) {
        navigation.choose(point, state: state, tool: tool, obstacles: obstacles, fill: fill, workable: { self.workable($0) })
    }
    func drag(_ point: FarmPoint) {
        navigation.choose(point, state: state, tool: tool, obstacles: obstacles, freehand: true)
    }
    func setTool(_ value: FarmTool) { tool = value; navigation.changeTool(state: state, tool: value, obstacles: obstacles) }
    func run(_ seconds: Double) { for _ in 0..<Int(seconds * fps) { step() } }
    func settle(limit: Double = 600) throws {
        slowest = .infinity
        for _ in 0..<Int(limit * fps) {
            if idle { break }
            try #require(!step().blocked)
        }
        try #require(idle)
    }
    /// Cells in a state, split into those inside the given lanes and the rest.
    func count(_ ground: Ground, lanes: [Int] = []) -> (inside: Int, outside: Int, all: Int) {
        var inside = 0, outside = 0
        for (i, cell) in field.cells.enumerated() where cell == ground.rawValue {
            if lanes.contains(i / FieldGrid.columns / TidyRows.laneCells) { inside += 1 } else { outside += 1 }
        }
        return (inside, outside, inside + outside)
    }
}

@Test func aTapWorksOneWholeLaneFromTheImplementWhereverInTheLaneItLands() throws {
    for follow in [false, true] { for fps in [30.0, 60, 120] { for offset in [-1.2, -0.4, 0, 0.7, 1.2] {
        let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(9), heading: west), follow: follow, fps: fps)
        meadow.tap(FarmPoint(x: -18.3, z: laneZ(9) + offset))
        try meadow.settle()
        // Columns 13 to 89, five cells wide, and nothing else.
        let soil = meadow.count(.soil, lanes: [9])
        #expect(soil.inside == 77 * 5 && soil.outside == 0)
        #expect(abs(meadow.state.z - laneZ(9)) < 0.05)
    } } }
}

@Test func theNextRowLiesBesideTheLastWithSharedEndsNoGapAndNoOverlap() throws {
    for follow in [false, true] {
        let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(9), heading: west), follow: follow)
        meadow.tap(FarmPoint(x: -18.3, z: 11.3))
        try meadow.settle()
        // A careless tap: a little short of the field's edge and off the lane's centre.
        meadow.tap(FarmPoint(x: 18.9, z: 9.9))
        try meadow.settle()
        let soil = meadow.count(.soil, lanes: [8, 9])
        #expect(soil.inside == 2 * 77 * 5 && soil.outside == 0)
        for column in 13..<90 { for row in 40..<50 {
            try #require(meadow.field.cells[row * FieldGrid.columns + column] == Ground.soil.rawValue)
        } }
    }
}

@Test func aRowToOneSideIsReachedWithTheImplementUp() throws {
    for follow in [false, true] {
        let meadow = TidyMeadow(TractorState(x: -4, z: 4.8, heading: west), follow: follow)
        meadow.tap(FarmPoint(x: -20, z: -3.25))
        #expect(meadow.navigation.lifted)
        try meadow.settle()
        let soil = meadow.count(.soil, lanes: [3])
        #expect(soil.outside == 0)
        #expect(soil.inside >= 170)
        #expect(!meadow.navigation.lifted)
    }
}

@Test func aRowInProgressIsFinishedWhenTheNextIsTappedEarlyThenWorkCarriesStraightOn() throws {
    for follow in [false, true] { for early in [1.0, 5, 11] {
        let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(8), heading: west), follow: follow)
        meadow.tap(FarmPoint(x: -20, z: laneZ(8)))
        meadow.run(15 - early)
        try #require(meadow.navigation.isWorkingRow)
        meadow.tap(FarmPoint(x: 19.4, z: laneZ(7)))
        #expect(meadow.navigation.hasQueued)
        try meadow.settle()
        let soil = meadow.count(.soil, lanes: [7, 8])
        #expect(soil.inside == 2 * 80 * 5 && soil.outside == 0)
        // It should not stop between rows.
        #expect(meadow.slowest > 0.25, "slowest \(meadow.slowest), follow \(follow)")
    } }
}

@Test func aRowThatWasAskedForIsKeptWhenMoreAreTappedBeforeWorkOnItBegins() throws {
    for follow in [false, true] {
        // The tractor is still crossing to its first row when two more are tapped.
        let meadow = TidyMeadow(TractorState(x: -4, z: 4.8, heading: west), follow: follow)
        meadow.tap(FarmPoint(x: -20.4, z: laneZ(3)))
        meadow.run(1.5)
        #expect(!meadow.navigation.isWorkingRow)
        meadow.tap(FarmPoint(x: 2.3, z: laneZ(2)))
        meadow.tap(FarmPoint(x: -20.4, z: laneZ(1)))
        // All three are planned, each starting where the one before will end.
        #expect(meadow.navigation.plannedRows == [
            TidyRow(axis: .x, lane: 3, from: 46, to: 9, dir: -1),
            TidyRow(axis: .x, lane: 2, from: 9, to: 54, dir: 1),
            TidyRow(axis: .x, lane: 1, from: 54, to: 9, dir: -1),
        ])
        try meadow.settle()
        let soil = meadow.count(.soil, lanes: [1, 2, 3])
        #expect(soil.outside == 0)
        #expect(soil.inside == (38 + 46 + 46) * 5)
    }
    // A second tap on a waiting lane replaces what was asked of it.
    let again = TidyMeadow(TractorState(x: 22, z: laneZ(8), heading: west))
    again.tap(FarmPoint(x: -20, z: laneZ(8)))
    again.tap(FarmPoint(x: 19, z: laneZ(7)))
    again.tap(FarmPoint(x: 0.2, z: laneZ(7)))
    #expect(again.navigation.plannedRows.count == 2)
    try again.settle()
    #expect(again.count(.soil, lanes: [7]).inside == 41 * 5)
}

@Test func aTapBeyondTheFieldLeavesTheRowsAndTravelsWithTheImplementUp() throws {
    let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(8), heading: west))
    meadow.tap(FarmPoint(x: -20, z: laneZ(8)))
    meadow.tap(FarmPoint(x: 19, z: laneZ(7)))
    meadow.run(5)
    let worked = meadow.count(.soil).all
    meadow.tap(FarmPoint(x: 0, z: 20))
    #expect(meadow.navigation.plannedRows.isEmpty)
    #expect(!meadow.navigation.hasQueued)
    #expect(meadow.navigation.lifted)
    try meadow.settle()
    #expect(meadow.count(.soil).all == worked)
    #expect(hypot(meadow.state.x, meadow.state.z - 20) < 0.6)
}

@Test func aTapInTheLaneBeingWorkedMovesThatRowsEnd() throws {
    let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(5), heading: west))
    meadow.tap(FarmPoint(x: -20, z: laneZ(5)))
    meadow.run(5)
    // Shorter: stop at column 40.
    meadow.tap(FarmPoint(x: FieldGrid.minX + 40.5 * FieldGrid.cellSize, z: laneZ(5) + 0.9))
    #expect(!meadow.navigation.hasQueued)
    try meadow.settle()
    #expect(meadow.count(.soil, lanes: [5]).all == 50 * 5)
    // A tap behind the work already done ends the row where it is.
    let again = TidyMeadow(TractorState(x: 22, z: laneZ(5), heading: west))
    again.tap(FarmPoint(x: -20, z: laneZ(5)))
    again.run(8)
    let worked = again.count(.soil).all
    again.tap(FarmPoint(x: 15, z: laneZ(5)))
    try again.settle()
    #expect(again.count(.soil).all - worked <= 2 * TidyRows.laneCells)
}

@Test func aNeighbouringSownRowStaysWholeWhenTheNextLaneIsCultivated() throws {
    let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(8), heading: west))
    meadow.tap(FarmPoint(x: -24.5, z: laneZ(8)))
    try meadow.settle()
    meadow.setTool(.sow)
    meadow.tap(FarmPoint(x: 19.5, z: laneZ(8)))
    try meadow.settle()
    #expect(meadow.count(.growing, lanes: [8]).all == 90 * 5)
    meadow.setTool(.cultivate)
    meadow.tap(FarmPoint(x: -24.5, z: laneZ(7)))
    try meadow.settle()
    let sown = meadow.count(.growing, lanes: [8])
    #expect(sown.inside == 90 * 5 && sown.outside == 0)
    #expect(meadow.count(.soil, lanes: [7]).inside == 90 * 5)
}

@Test func oneCarelessTapPerRowCoversTheWholeField() throws {
    for follow in [false, true] { for error in [0.3, 0.6] {
        // The same sequence as the web test's seeded generator.
        var seed = UInt32(error * 100)
        func wobble() -> Double {
            seed = seed &* 1_664_525 &+ 1_013_904_223
            return (Double(seed) / 4_294_967_296 - 0.5) * 2 * error
        }
        let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(9), heading: west), follow: follow)
        for lane in stride(from: 9, through: 0, by: -1) {
            let x = lane % 2 == 1 ? FieldGrid.minX + 0.6 : FieldGrid.maxX - 0.6
            let dx = wobble(), dz = wobble()
            meadow.tap(FarmPoint(x: x + dx, z: laneZ(lane) + dz))
            try meadow.settle()
        }
        #expect(meadow.count(.soil).all == FieldGrid.cellCount, "tap error \(error) m, follow \(follow)")
    } }
}

@Test func aTapOnTheEdgeOfAFinishedLaneIsReadAsTheNextRowOver() throws {
    let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(9), heading: west))
    meadow.tap(FarmPoint(x: -24, z: laneZ(9)))
    try meadow.settle()
    // Half a metre inside the lane just worked, where nothing is left to do.
    meadow.tap(FarmPoint(x: 19.5, z: laneZ(9) - TidyRows.laneWidth / 2 + 0.5))
    try meadow.settle()
    #expect(meadow.count(.soil, lanes: [8]).inside == 90 * 5)
}

@Test func aSecondTapFillsEveryLaneUpToItSkippingLanesWithNothingToDo() throws {
    for follow in [false, true] {
        let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(9), heading: west), follow: follow)
        meadow.tap(FarmPoint(x: -10, z: laneZ(9)))
        try meadow.settle()
        meadow.tap(FarmPoint(x: 19.8, z: laneZ(4)), fill: true)
        // The finished lane is passed over; five more are planned.
        #expect(meadow.navigation.plannedRows.map(\.lane) == [8, 7, 6, 5, 4])
        try meadow.settle()
        let soil = meadow.count(.soil, lanes: [4, 5, 6, 7, 8, 9])
        #expect(soil.inside == 6 * 60 * 5 && soil.outside == 0)
    }
}

@Test func rowsRunTheWayTheTractorFacesUnlessTheTapIsWellOffToOneSide() throws {
    let facingWest = TractorState(x: 0, z: 0, heading: west)
    #expect(TidyRows.plan(facingWest, tap: FarmPoint(x: -15, z: 0.4))[0].axis == .x)
    #expect(TidyRows.plan(facingWest, tap: FarmPoint(x: -1, z: 2.6))[0].axis == .x) // the lane beside it
    #expect(TidyRows.plan(facingWest, tap: FarmPoint(x: -12, z: 8))[0].axis == .x)
    #expect(TidyRows.plan(facingWest, tap: FarmPoint(x: 1, z: 10))[0].axis == .z) // straight off to the side
    let diagonal = TractorState(x: 0, z: 0, heading: 0.8)
    #expect(TidyRows.plan(diagonal, tap: FarmPoint(x: 9, z: 4))[0].axis == .x)
    #expect(TidyRows.plan(diagonal, tap: FarmPoint(x: 4, z: 9))[0].axis == .z)
    // Ends settle onto the field's edge and onto the last row's ends.
    let last = TidyRow(axis: .x, lane: 5, from: 80, to: 20, dir: -1)
    let row = try #require(TidyRows.plan(TractorState(x: -14.9 - 2.1, z: 1.25, heading: west),
                                         tap: FarmPoint(x: 14.2, z: -1), last: last).first)
    #expect(row == TidyRow(axis: .x, lane: row.lane, from: 20, to: 80, dir: 1))
    #expect(TidyRows.plan(facingWest, tap: FarmPoint(x: FieldGrid.minX + 1.2, z: 0))[0].to == 0)
    #expect(TidyRows.cells(of: row).count == 61 * TidyRows.laneCells)
    #expect(TidyRows.plan(facingWest, tap: FarmPoint(x: 0, z: 30)).isEmpty)
    // The lanes tile the field exactly on both axes.
    #expect(TidyRows.laneCount(.x) * TidyRows.laneCells == FieldGrid.rows)
    #expect(TidyRows.laneCount(.z) * TidyRows.laneCells == FieldGrid.columns)
    let rect = TidyRows.rect(of: TidyRow(axis: .z, lane: 2, from: 10, to: 3, dir: -1))
    #expect(rect.width == 2.5)
    #expect(rect.depth == 4.0)
    #expect(rect.x == TidyRows.laneCentre(.z, lane: 2))
    #expect(rect.z == FieldGrid.minZ + 3.5)
}

@Test func aDragStillSteersFreehandAndWorksWhereverTheImplementPasses() throws {
    let drawn = TidyMeadow(TractorState(x: 0, z: 0, heading: west))
    drawn.drag(FarmPoint(x: -9, z: 6))
    #expect(drawn.navigation.plannedRows.isEmpty)
    try drawn.settle()
    let soil = drawn.count(.soil, lanes: [4])
    #expect(soil.all > 40 && soil.outside > 0)
    // Steering by hand in tractor view takes over from any rows at once.
    let steered = TidyMeadow(TractorState(x: 22, z: laneZ(8), heading: west), follow: true)
    steered.tap(FarmPoint(x: -20, z: laneZ(8)))
    steered.tap(FarmPoint(x: 19, z: laneZ(7)))
    steered.run(4)
    steered.step(.heading(0.4))
    #expect(steered.navigation.plannedRows.isEmpty && !steered.navigation.hasQueued)
}

@Test func aRowBendsAroundSomethingStandingInItsLaneAndLeavesTheGroundUnderItAlone() throws {
    // The meadow's little mill, standing across two lanes.
    let mill = Obstacle(x: 10, z: -5, radius: 1.6)
    for follow in [false, true] { for lane in [2, 3] {
        let meadow = TidyMeadow(TractorState(x: 22, z: laneZ(lane), heading: west), follow: follow, obstacles: [mill])
        meadow.tap(FarmPoint(x: -24, z: laneZ(lane)))
        try meadow.settle()
        let soil = meadow.count(.soil, lanes: [lane])
        #expect(soil.outside == 0) // the detour works nothing outside the row
        #expect(soil.inside >= 90 * 5 - 30, "lane \(lane), follow \(follow): \(soil.inside) of 450 cells")
        for (i, cell) in meadow.field.cells.enumerated() {
            let x = FieldGrid.minX + (Double(i % FieldGrid.columns) + 0.5) * FieldGrid.cellSize
            let z = FieldGrid.minZ + (Double(i / FieldGrid.columns) + 0.5) * FieldGrid.cellSize
            if hypot(x - mill.x, z - mill.z) < 1.3 { try #require(cell == Ground.grass.rawValue) }
        }
    } }
}

@Test func theOriginalFreeApproachIsUnchangedWhenTidyRowsAreOff() throws {
    let meadow = TidyMeadow(TractorState(x: -4, z: 4.8, heading: west), tidy: false)
    meadow.tap(FarmPoint(x: -20, z: -3.25), fill: true)
    #expect(meadow.navigation.plannedRows.isEmpty && !meadow.navigation.lifted)
    try meadow.settle()
    // The straight-line approach works the ground it crosses.
    #expect(meadow.count(.soil, lanes: [3]).outside > 100)
}

@Test func aWobblyTapStaysATapAndAHeldOrCarriedTouchSteersFreehand() {
    var tap = SteeringGesture(location: [100, 200], heading: 0)
    tap.update([109, 206])
    #expect(tap.moved)
    #expect(!tap.isFreehand(heldFor: 0.1)) // a quick, slightly smeared tap
    #expect(tap.isFreehand(heldFor: 0.2)) // the same touch, still down and moved
    var flick = SteeringGesture(location: [100, 200], heading: 0)
    flick.update([140, 200])
    #expect(flick.isFreehand(heldFor: 0.05)) // carried well away at once
    flick.update([101, 200])
    #expect(flick.isFreehand(heldFor: 0.05)) // coming back does not turn it into a tap
    var still = SteeringGesture(location: [100, 200], heading: 0)
    still.update([103, 202])
    #expect(!still.isFreehand(heldFor: 6)) // a long press that never moves is not steering
}

@Test func turnsBackAlongItsOwnLaneTowardTheTappedSideFromTheFirstMoment() throws {
    // At the end of a row, a tap back down the same lane puts the way in dead
    // astern. Which way the tractor swings must follow the tap, never rounding.
    // Facing east, the tractor's left is -z. The field's middle (z 0.5) is on its left.
    for follow in [false, true] {
        for (aside, expected) in [(-0.4, 1.0), (0.4, -1.0), (-0.05, 1.0), (0, 1.0)] {
            let meadow = TidyMeadow(TractorState(x: 15, z: laneZ(6), heading: east), follow: follow)
            meadow.tap(FarmPoint(x: 0, z: laneZ(6) + aside))
            let start = meadow.state.heading
            var first = 0.0, against = 0.0, peak = 0.0
            for _ in 0..<(60 * 8) {
                let before = meadow.state.heading
                meadow.step()
                let d = atan2(sin(meadow.state.heading - before), cos(meadow.state.heading - before))
                if first == 0 && abs(d) > 1e-4 { first = d < 0 ? -1 : 1 }
                let net = atan2(sin(meadow.state.heading - start), cos(meadow.state.heading - start))
                if expected * net > -0.5 { peak = max(peak, abs(net)) }
                if peak < .pi * 0.9 { against = max(against, -expected * net) }
            }
            #expect(first == expected, "follow \(follow), tap \(aside) m aside")
            #expect(against < 0.05, "follow \(follow), tap \(aside) m aside: swung \(against) rad the wrong way")
            try meadow.settle()
            // Then it works exactly the lane it turned back along, up to the tap:
            // from the implement's cell (x 12.9, cell 75) back to the tapped cell (x 0, cell 50).
            let soil = meadow.count(.soil, lanes: [6])
            #expect(soil.inside == 26 * TidyRows.laneCells && soil.outside == 0)
        }
    }
}

@Test func turnsBackTheOtherWayRoundWhenSomethingStandsOnTheTappedSide() throws {
    let tree = Obstacle(x: 16, z: laneZ(6) - 2.2, radius: 0.5)
    let meadow = TidyMeadow(TractorState(x: 15, z: laneZ(6), heading: east), obstacles: [tree])
    meadow.tap(FarmPoint(x: 0, z: laneZ(6) - 0.4))
    let start = meadow.state.heading
    for _ in 0..<30 { meadow.step() }
    #expect(meadow.state.heading < start, "turns right, away from the tree")
    try meadow.settle()
}
