import Foundation
import Testing
@testable import StillfieldCore

private let frame = 1.0 / 60
private let stationary = TractorState(x: 0, z: 0, heading: 0, speed: 0)

private func drive(
    _ initial: TractorState = stationary,
    toward target: FarmPoint?,
    frames: Int,
    obstacles: [Obstacle] = [],
    pace: Double = 0.85
) -> TractorState {
    var state = initial
    for _ in 0..<frames {
        state = FarmSimulation.advance(state, toward: target, deltaTime: frame, obstacles: obstacles, rowAssist: false, pace: pace)
    }
    return state
}

@Test func acceleratesSmoothlyAndStopsWhenReleased() {
    let first = drive(toward: FarmPoint(x: 0, z: 20), frames: 1)
    let cruising = drive(toward: FarmPoint(x: 0, z: 20), frames: 120)
    #expect(first.speed > 0 && first.speed < 1)
    #expect(cruising.z > 5 && cruising.z < 20)
    #expect(cruising.x == 0)
    #expect(cruising.heading == 0)
    #expect(cruising.speed > first.speed && cruising.speed <= 3)
    let stopped = drive(cruising, toward: nil, frames: 120)
    #expect(stopped.speed == 0)
    #expect(stopped.z > cruising.z && stopped.z < cruising.z + 1)
    #expect(drive(stopped, toward: nil, frames: 1) == stopped)
}

@Test func steeringUsesTheShortestTurnAndLimitsItsRate() {
    let initial = TractorState(x: 0, z: 0, heading: .pi - 0.01)
    let next = drive(initial, toward: FarmPoint(x: -0.3, z: -10), frames: 1)
    let turn = atan2(sin(next.heading - initial.heading), cos(next.heading - initial.heading))
    #expect(turn > 0 && turn <= 4.8 * frame + 1e-12)
}

@Test func tapsProduceVisibleMovementWithinAQuarterSecond() {
    let forward = drive(toward: FarmPoint(x: 0, z: 15), frames: 6, pace: 0.85)
    #expect(forward.speed > 1.8)
    #expect(forward.z > 0.1)

    let sideways = drive(toward: FarmPoint(x: 15, z: 0), frames: 15, pace: 0.85)
    #expect(sideways.heading > 1.1)
    #expect(sideways.x > 0.15)
    #expect(sideways.speed > 1.8)
}

@Test func nearbyReverseTapBrakesAndTurnsWithoutALargeLoop() {
    let destination = FarmPoint(x: 0, z: -0.7)
    var state = TractorState(x: 0, z: 0, heading: 0, speed: 3)
    var farthestForward = state.z
    var arrivalFrame: Int?
    for index in 1...120 {
        state = drive(state, toward: destination, frames: 1, pace: 0.85)
        farthestForward = max(farthestForward, state.z)
        // The native controller releases a destination at this distance.
        if hypot(state.x - destination.x, state.z - destination.z) < 0.5 {
            arrivalFrame = index
            break
        }
    }
    #expect(farthestForward < 0.4)
    #expect(arrivalFrame != nil && arrivalFrame! <= 60)
    #expect(state.speed > 0 && state.speed < 2)

    // Arrival should ease to a stop without a snap or another lap around it.
    let firstBrakingFrame = drive(state, toward: nil, frames: 1)
    #expect(firstBrakingFrame.speed > 0 && firstBrakingFrame.speed < state.speed)
    let stopped = drive(firstBrakingFrame, toward: nil, frames: 60)
    #expect(stopped.speed == 0)
    #expect(hypot(stopped.x - destination.x, stopped.z - destination.z) < 0.5)
}

@Test func nearbyDestinationsSettleWithoutOrbiting() {
    let destinations = [FarmPoint(x: 0.7, z: 0), FarmPoint(x: 0, z: -0.7),
                        FarmPoint(x: -0.4, z: -0.4), FarmPoint(x: 0.4, z: 0.4)]
    for destination in destinations {
        for initialSpeed in [0.0, 3, 4.5] {
            let initial = TractorState(x: 0, z: 0, heading: 0, speed: initialSpeed)
            let settled = drive(initial, toward: destination, frames: 240, pace: 0.85)
            #expect(hypot(settled.x - destination.x, settled.z - destination.z) < 0.38)
            #expect(settled.speed == 0)
            #expect(drive(settled, toward: destination, frames: 60, pace: 0.85) == settled)
        }
    }
}

@Test func steeringFeelsConsistentAcrossDisplayRefreshRates() {
    func afterOneSecond(at framesPerSecond: Int) -> TractorState {
        var state = stationary
        for _ in 0..<framesPerSecond {
            state = FarmSimulation.advance(state, toward: FarmPoint(x: 10, z: 10),
                                           deltaTime: 1 / Double(framesPerSecond), obstacles: [],
                                           rowAssist: false, pace: 0.85)
        }
        return state
    }
    let baseline = afterOneSecond(at: 60)
    for refreshRate in [30, 120] {
        let state = afterOneSecond(at: refreshRate)
        #expect(hypot(state.x - baseline.x, state.z - baseline.z) < 0.1)
        #expect(abs(state.heading - baseline.heading) < 0.02)
        #expect(abs(state.speed - baseline.speed) < 0.01)
    }
}

@Test func pausedOrDelayedFramesDoNotJump() {
    let initial = TractorState(x: 0, z: 0, heading: 0.4, speed: 2)
    let target = FarmPoint(x: 10, z: 20)
    func advance(_ dt: Double) -> TractorState {
        FarmSimulation.advance(initial, toward: target, deltaTime: dt, obstacles: [], rowAssist: false)
    }
    #expect(advance(5) == advance(0.05))
    #expect(advance(-1) == initial)
    #expect(advance(0) == initial)
    #expect(advance(.infinity) == initial)
    #expect(advance(.nan) == initial)
}

@Test func collisionStopsWheelsAndAllowsSteeringAway() {
    let obstacle = Obstacle(x: 0, z: 0, radius: 1)
    var state = TractorState(x: 0, z: -3, heading: 0, speed: 4)
    for _ in 0..<600 {
        state = drive(state, toward: FarmPoint(x: 0, z: 10), frames: 1, obstacles: [obstacle])
        #expect(hypot(state.x, state.z) >= 1.9 - 1e-10)
    }
    #expect(state.speed == 0)
    #expect(abs(state.z + 1.9) < 1e-10)
    let escaped = drive(state, toward: FarmPoint(x: -10, z: -3), frames: 120, obstacles: [obstacle])
    #expect(escaped.x < -5)
    #expect(escaped.speed > 0)
    #expect(hypot(escaped.x, escaped.z) >= 1.9 - 1e-10)
}

@Test func obstacleCenterRecoveryDoesNotAccelerate() {
    let state = drive(toward: nil, frames: 1, obstacles: [Obstacle(x: 0, z: 0, radius: 2)])
    #expect(state.x.isFinite && state.z.isFinite && state.heading.isFinite)
    #expect(hypot(state.x, state.z) >= 2.9 - 1e-10)
    #expect(state.speed == 0)
}

@Test func worldBoundaryStopsMotion() {
    let state = TractorState(x: 39, z: 0, heading: .pi / 2, speed: 5)
    let stopped = drive(state, toward: FarmPoint(x: 100, z: 0), frames: 1)
    #expect(stopped.x == 39)
    #expect(stopped.speed == 0)
}

@Test func rowAssistStraightensOnlyNearlyCardinalRows() {
    let target = FarmPoint(x: 0.5, z: 12)
    let assisted = FarmSimulation.advance(stationary, toward: target, deltaTime: frame, obstacles: [], rowAssist: true)
    let free = FarmSimulation.advance(stationary, toward: target, deltaTime: frame, obstacles: [], rowAssist: false)
    #expect(assisted.heading == 0)
    #expect(free.heading > 0)
}

@Test func defaultCruisesAtThreeAndSliderReachesFourPointFiveInEveryDriveMode() {
    let slow = drive(toward: FarmPoint(x: 0, z: 25), frames: 120, pace: 0.55)
    let normal = drive(toward: FarmPoint(x: 0, z: 25), frames: 120)
    let quick = drive(toward: FarmPoint(x: 0, z: 25), frames: 120, pace: 1.25)
    #expect(slow.z > 0 && normal.z > slow.z && quick.z > normal.z)
    #expect(normal.speed > 2.99 && normal.speed <= 3)
    for (pace, limit) in [(0.55, 1.875), (MeadowSave().pace, 3.0), (1.25, 4.5)] {
        let iso = drive(toward: FarmPoint(x: 0, z: 25), frames: 120, pace: pace)
        #expect(iso.speed > limit - 0.01 && iso.speed <= limit)
        for input in [DriveInput.drag(0), .target(FarmPoint(x: 0, z: 25))] {
            var driver = GentleDrive(), state = stationary
            for _ in 0..<120 { state = driver.step(state, deltaTime: frame, input: input, pace: pace) }
            #expect(state.speed > limit - 0.01 && state.speed <= limit)
        }
    }
}

@Test func circularBrushClipsAtCornersWithoutWrapping() {
    let size = FieldGrid.columns * FieldGrid.rows
    #expect(FarmSimulation.cellsUnderBrush(x: -23.875, z: -12.875, radius: 0) == [0])
    #expect(FarmSimulation.cellsUnderBrush(x: 18.875, z: 13.875, radius: 0) == [size - 1])
    #expect(FarmSimulation.cellsUnderBrush(x: -24, z: -13, radius: 0.4) == [0, 1, FieldGrid.columns])
    #expect(FarmSimulation.cellsUnderBrush(x: 19, z: 14, radius: 0.4) == [size - FieldGrid.columns - 1, size - 2, size - 1])
    #expect(FarmSimulation.cellsUnderBrush(x: -26, z: 0, radius: 0.5).isEmpty)
    #expect(FarmSimulation.cellsUnderBrush(x: -24.05, z: -12.875, radius: 0.2) == [0])
}

@Test func brushContainsOnlyUniqueCellsWithinItsCircle() {
    let cells = FarmSimulation.cellsUnderBrush(x: -1.3, z: 2.7, radius: 1.15)
    #expect(cells.count > 40)
    #expect(Set(cells).count == cells.count)
    for cell in cells {
        #expect(cell >= 0 && cell < FieldGrid.columns * FieldGrid.rows)
        let x = FieldGrid.minX + (Double(cell % FieldGrid.columns) + 0.5) * FieldGrid.cellSize
        let z = FieldGrid.minZ + (Double(cell / FieldGrid.columns) + 0.5) * FieldGrid.cellSize
        #expect(hypot(x + 1.3, z - 2.7) <= 1.15 + 1e-10)
    }
    #expect(FarmSimulation.cellsUnderBrush(x: .nan, z: 0, radius: 1).isEmpty)
    #expect(FarmSimulation.cellsUnderBrush(x: 0, z: 0, radius: -1).isEmpty)
}

@Test func toolsPaintChangedCellsAndWanderingLeavesMeadowAlone() {
    var field = FieldGrid(starterRows: false)
    let expected = FarmSimulation.cellsUnderBrush(x: 0, z: 0, radius: 1.285)
    #expect(field.paint(x: 0, z: 0, tool: .wander).isEmpty)
    #expect(field.paint(x: 0, z: 0, tool: .mow) == expected)
    #expect(field.paint(x: 0, z: 0, tool: .mow).isEmpty)
    #expect(expected.allSatisfy { field.cells[$0] == 1 })
    #expect(field.paint(x: 0, z: 0, tool: .till) == expected)
    #expect(expected.allSatisfy { field.cells[$0] == 2 })
    #expect(field.paint(x: 0, z: 0, tool: .sow) == expected)
    #expect(expected.allSatisfy { field.cells[$0] == 3 })
    let painted = field
    #expect(field.paint(x: 0, z: 0, tool: .wander).isEmpty)
    #expect(field == painted)
    field.reset()
    #expect(field.isValid && field.cells.allSatisfy { $0 == 0 })
}

@Test func starterRowsLeaveSpaceToMakeTheMeadowYourOwn() {
    let field = FieldGrid()
    #expect(field.isValid)
    let mown = field.cells.filter { $0 == 1 }.count
    #expect(mown > 2_000 && mown < field.cells.count / 2)
    #expect(FarmSimulation.cellsUnderBrush(x: 0, z: 10.8, radius: 0.3).allSatisfy { field.cells[$0] == 1 })
    #expect(FarmSimulation.cellsUnderBrush(x: 0, z: -8, radius: 0.3).allSatisfy { field.cells[$0] == 0 })
}
