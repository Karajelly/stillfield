import Foundation
import Testing
@testable import StillfieldCore

private final class TestMeadow {
    let navigation = TractorNavigation()
    var state: TractorState
    var field = FieldGrid(starterRows: false)
    var tool = FarmTool.mow
    var obstacles: [Obstacle] = []
    let follow: Bool
    let fps: Double
    let pace: Double
    init(_ initial: TractorState, follow: Bool = false, fps: Double = 60, pace: Double = 0.85) {
        state = initial; self.follow = follow; self.fps = fps; self.pace = pace
    }
    @discardableResult func step(_ input: DriveInput? = nil) -> TractorNavigation.Step {
        let result = navigation.step(state, deltaTime: 1 / fps, tool: tool, obstacles: obstacles, pace: pace, manual: input, follow: follow)
        state = result.state
        for (i, point) in result.paint.enumerated() { field.paint(from: result.paint[max(0, i - 1)], to: point, tool: tool) }
        return result
    }
    func settle() throws {
        for _ in 0..<Int(fps * 30) {
            if navigation.target == nil && state.speed == 0 { break }
            step()
        }
        try #require(navigation.target == nil)
        try #require(state.speed == 0)
    }
    func choose(_ point: FarmPoint) { navigation.choose(point, state: state, tool: tool, obstacles: obstacles) }
    func setTool(_ value: FarmTool) { tool = value; navigation.changeTool(state: state, tool: value, obstacles: obstacles) }
    func value(at point: FarmPoint) -> UInt8 { field.cells[WorkDestination.create(point, state: state, tool: .mow)!.cell] }
}

@Test func workingEndpointsFinishForEveryToolViewFrameRateAndCloseApproach() throws {
    let points = [FarmPoint(x: FieldGrid.maxX, z: 0.125), FarmPoint(x: FieldGrid.minX, z: 0.125),
                  FarmPoint(x: 0.125, z: FieldGrid.minZ), FarmPoint(x: 0.125, z: FieldGrid.maxZ),
                  FarmPoint(x: FieldGrid.maxX, z: FieldGrid.maxZ)]
    for follow in [false, true] { for fps in [30.0, 60, 120] { for tool in [FarmTool.mow, .cultivate, .sow] {
        for point in points {
            let farm = TestMeadow(TractorState(x: 0, z: 0, heading: atan2(point.x, point.z)), follow: follow, fps: fps)
            if tool == .sow { farm.field.cells = Array(repeating: Ground.soil.rawValue, count: FieldGrid.cellCount) }
            farm.setTool(tool); farm.choose(point); try farm.settle()
            try #require(farm.value(at: point) == (tool == .mow ? 1 : tool == .cultivate ? 2 : 3))
        }
    } } }
    for follow in [false, true] { for speed in [0.0, 3, 4.5] { for distance in [0.01, 0.3, 1, 2, 3, 5, 10] {
        for degrees in [-180.0, -135, -90, -45, 0, 45, 90, 135, 180] {
            let angle = degrees * .pi / 180, point = FarmPoint(x: sin(angle) * distance, z: cos(angle) * distance)
            let farm = TestMeadow(TractorState(x: 0, z: 0, heading: 0, speed: speed), follow: follow)
            farm.choose(point); try farm.settle(); try #require(farm.value(at: point) == 1)
        }
    } } }
}

@Test func neighboringTapAfterActualWorkPreservesClickFacesBackAndWaits() throws {
    for follow in [false, true] { for fps in [30.0, 60, 120] {
        for heading in [0.0, .pi / 2, .pi, -.pi / 2, 0.7, -0.7] { for lateral in [-2.5, -0.25, 0.25, 2.5] {
            let farm = TestMeadow(TractorState(x: -15 * sin(heading), z: -15 * cos(heading), heading: heading), follow: follow, fps: fps)
            farm.choose(FarmPoint(x: 0.125, z: 0.125)); try farm.settle()
            let row = try #require(farm.navigation.workedRow)
            let point = FarmPoint(x: row.end.x + cos(row.heading) * lateral, z: row.end.z - sin(row.heading) * lateral)
            farm.choose(point)
            try #require(farm.navigation.turningAtRowEnd)
            #expect(farm.navigation.target == point)
            try farm.settle()
            try #require(abs(TractorHandling.angle(farm.state.heading, row.heading + .pi)) < 0.025)
            try #require(abs((farm.state.x - point.x) * cos(row.heading) - (farm.state.z - point.z) * sin(row.heading)) < 0.06)
            let stopped = farm.state
            for _ in 0..<Int(fps * 3) { farm.step() }
            #expect(farm.state == stopped)
        } }
    } }
}

@Test func sixChosenRowsAtTwoPointFiveMetresCoverTheInterveningMeadow() throws {
    for follow in [false, true] { for pace in [0.55, 0.85, 1.25] {
        let farm = TestMeadow(TractorState(x: -18.125, z: -9.875, heading: .pi / 2), follow: follow, pace: pace)
        for row in 0..<6 {
            let z = -9.875 + Double(row) * 2.5, x = row % 2 == 1 ? -19.875 : 17.875
            if row > 0 {
                farm.choose(FarmPoint(x: row % 2 == 1 ? 17.875 : -19.875, z: z))
                try #require(farm.navigation.turningAtRowEnd)
                try farm.settle()
            }
            farm.choose(FarmPoint(x: x, z: z)); try farm.settle()
        }
        for z in stride(from: -9.75, through: 2.25, by: FieldGrid.cellSize) {
            for x in stride(from: -17.75, through: 17.25, by: FieldGrid.cellSize) {
                try #require(farm.value(at: FarmPoint(x: x, z: z)) == 1)
            }
        }
    } }
}

@Test func changingToolsRetargetingAndInterruptingDoNotResumeOldRows() throws {
    let farm = TestMeadow(TractorState(x: -15, z: 0.125, heading: .pi / 2), follow: true)
    farm.choose(FarmPoint(x: 0.125, z: 0.125)); try farm.settle()
    let point = FarmPoint(x: 0.125, z: 2.625)
    farm.choose(point); farm.setTool(.cultivate)
    try #require(farm.navigation.turningAtRowEnd)
    for _ in 0..<1200 { if !farm.navigation.turningAtRowEnd { break }; farm.step() }
    farm.setTool(.sow); try farm.settle()
    // Switching before the lowered cultivator reaches this square leaves grass.
    // Sowing must not silently prepare it. The work endpoint still completes.
    #expect(farm.value(at: point) == 0)
    #expect(abs(TractorHandling.angle(farm.state.heading, -.pi / 2)) < 0.025)
    let beforeWandering = farm.field
    farm.setTool(.wander); farm.choose(FarmPoint(x: -8, z: 5)); try farm.settle()
    #expect(farm.field == beforeWandering)
    #expect(hypot(farm.state.x + 8, farm.state.z - 5) < 0.6)
    farm.setTool(.mow); farm.choose(FarmPoint(x: 12, z: 2))
    for _ in 0..<40 { farm.step() }
    farm.choose(FarmPoint(x: -10, z: 0)); try farm.settle()
    farm.choose(FarmPoint(x: 12, z: 0))
    for _ in 0..<60 { farm.step() }
    farm.navigation.cancel(); let heading = farm.state.heading
    try farm.settle(); #expect(farm.state.heading == heading)
}

@Test func blockedWorkNeverPaintsRemotelyAndTightTurnsStopYawOnRelease() throws {
    for follow in [false, true] {
        let farm = TestMeadow(TractorState(x: 0, z: 0, heading: .pi / 2), follow: follow)
        farm.obstacles = [Obstacle(x: 8, z: 0, radius: 2)]
        let point = FarmPoint(x: 12, z: 0.125)
        farm.choose(point); try farm.settle(); #expect(farm.value(at: point) == 0)
    }
    for fps in [30.0, 60, 120] {
        var drive = GentleDrive(), state = TractorState(x: 0, z: 0, heading: 0, speed: 3)
        for _ in 0..<Int(fps * 6) {
            if abs(state.heading) >= .pi { break }
            state = drive.step(state, deltaTime: 1 / fps, input: .drag(110))
        }
        #expect(abs(state.x) > 2 && abs(state.x) < 2.5)
        let heading = state.heading
        state = drive.step(state, deltaTime: 1 / fps, input: .drag(5))
        #expect(state.heading == heading)
        for _ in 0..<Int(fps) { state = drive.step(state, deltaTime: 1 / fps, input: nil) }
        #expect(state.heading == heading); #expect(state.speed == 0)
    }
}

@Test func touchTremorStaysATapAndAHoldStartsWithoutAdditionalEvents() {
    var gesture = SteeringGesture(location: [100, 200], time: 3)
    gesture.update([103, 204])
    #expect(!gesture.isDriving(at: 3.1))
    #expect(gesture.isDriving(at: 3.3))
    #expect(GentleDrive.dragAmount(gesture.drag) == 0)
    gesture.update([150, 201])
    #expect(gesture.isDriving(at: 3.1))
    #expect(GentleDrive.dragAmount(gesture.drag) > 0)
    gesture.update([100, 200])
    #expect(gesture.isDriving(at: 3.1)) // Returning to center remains a drive, never a tap.
    #expect(GentleDrive.dragAmount(gesture.drag) == 0)
}

@Test func rowEndRecognitionIgnoresUnrelatedAndBlockedTaps() {
    let row = WorkedRow(start: FarmPoint(x: -15, z: 0), end: FarmPoint(x: 0, z: 0), heading: .pi / 2)
    let end = TractorState(x: 2.2, z: 0, heading: .pi / 2)
    for point in [FarmPoint(x: -14, z: 2.5), FarmPoint(x: 0, z: 5), FarmPoint(x: 0, z: 0), FarmPoint(x: .nan, z: 1)] {
        #expect(alignmentForTap(row, state: end, point: point, obstacles: []) == nil)
    }
    #expect(alignmentForTap(nil, state: end, point: FarmPoint(x: 0, z: 2.5), obstacles: []) == nil)
    #expect(alignmentForTap(row, state: end, point: FarmPoint(x: 0, z: 2.5), obstacles: [Obstacle(x: 2.5, z: 2, radius: 1)]) == nil)
}

@Test func repeatedDragDestinationsPreserveTheAttachmentSweep() throws {
    let nav = TractorNavigation()
    let state = TractorState(x: 0, z: 0, heading: .pi / 2, speed: 4.5)
    nav.choose(FarmPoint(x: 15, z: 0), state: state, tool: .mow, obstacles: [])
    let first = nav.step(state, deltaTime: 1 / 30, tool: .mow, obstacles: [])
    nav.choose(FarmPoint(x: 15.1, z: 0), state: first.state, tool: .mow, obstacles: [])
    let second = nav.step(first.state, deltaTime: 1 / 30, tool: .mow, obstacles: [])
    #expect(second.paint.first == first.paint.last)
    #expect(second.paint.first != second.paint.last)
}
