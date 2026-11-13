import Foundation
import simd
import Testing
@testable import StillfieldCore

/// The real trees, barn, mills and pond, read from the app's exported scene so these
/// tests always see the same meadow as the player. Mirrors src/farm-map.test.ts.
private let sceneObstacles: [Obstacle] = {
    struct Scene: Decodable { let obstacles: [Obstacle] }
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent("Stillfield/Resources/FarmScene.json")
    guard let data = try? Data(contentsOf: url), let scene = try? JSONDecoder().decode(Scene.self, from: data) else { return [] }
    return scene.obstacles
}()
private let home = TractorState(x: -4, z: 4.8, heading: -.pi / 2)

private func screenPosition(_ point: SIMD3<Double>, framing: OverviewCamera.Framing, aspect: Double) -> SIMD2<Double> {
    let forward = simd_normalize(framing.focus - framing.position)
    let right = simd_normalize(simd_cross(forward, SIMD3(0, 1, 0)))
    let up = simd_cross(right, forward)
    let offset = point - framing.position
    return SIMD2((simd_dot(offset, right) / (framing.verticalHalfExtent * aspect) + 1) * 0.5,
                 (1 - simd_dot(offset, up) / framing.verticalHalfExtent) * 0.5)
}

@Test func theTwoFieldsSitApartInsideTheWorldJoinedByTheLane() throws {
    try #require(sceneObstacles.count >= 40, "the exported scene includes Foxglove's trees")
    #expect(FieldBounds.foxglove.maxX < FieldBounds.home.minX)
    for field in FieldBounds.all {
        #expect(field.minX > FarmWorld.minX && field.maxX < FarmWorld.maxX)
        #expect(field.minZ > FarmWorld.minZ && field.maxZ < FarmWorld.maxZ)
    }
    #expect(FieldBounds.foxglove.cellCount == 2 * FieldBounds.home.cellCount)
    #expect(FieldBounds.foxglove.columns == 120 && FieldBounds.foxglove.rows == 75)
    #expect(FieldBounds.containing(FarmPoint(x: -70, z: 0)) == .foxglove)
    #expect(FieldBounds.containing(FarmPoint(x: 0, z: 0)) == .home)
    #expect(FieldBounds.containing(FarmPoint(x: -40, z: -1)) == nil, "the lane itself is not a field")
    for point in FarmMap.lane {
        for o in sceneObstacles { #expect(hypot(point.x - o.x, point.z - o.z) > o.radius + 1.5) }
    }
}

@Test func theViewHoldsStillInsideEachFieldAndFollowsAlongTheLane() {
    for x in stride(from: FieldBounds.home.minX, through: FieldBounds.home.maxX, by: 2.5) {
        #expect(FarmMap.viewBlend(FarmPoint(x: x, z: 0)) == 0)
    }
    for x in stride(from: FieldBounds.foxglove.minX, through: FieldBounds.foxglove.maxX, by: 2.5) {
        #expect(FarmMap.viewBlend(FarmPoint(x: x, z: 0)) == 1)
    }
    var previous = 0.0
    for x in stride(from: FieldBounds.home.minX, through: FieldBounds.foxglove.maxX, by: -0.5) {
        let blend = FarmMap.viewBlend(FarmPoint(x: x, z: -1))
        #expect(blend >= previous)
        previous = blend
    }
    #expect(FarmMap.destination(from: FarmPoint(x: home.x, z: home.z)) == .foxglove)
    #expect(FarmMap.destination(from: FarmPoint(x: -70, z: 0)) == .home)
}

@Test func eachFramingFitsItsFieldWithoutTurningTheCamera() {
    for viewport: SIMD2<Double> in [[375, 812], [402, 874], [820, 1180], [1024, 1366], [874, 402], [1366, 1024], [1000, 1000]] {
        let aspect = viewport.x / viewport.y
        let framing = OverviewCamera.frame(aspect: aspect, blend: 1)
        let far = FieldBounds.foxglove
        for x in [far.minX, far.maxX] {
            for z in [far.minZ, far.maxZ] {
                let screen = screenPosition([x, 0, z], framing: framing, aspect: aspect)
                #expect(screen.x > 0.05 && screen.x < 0.95, "\(viewport)")
                #expect(screen.y > 0.18 && screen.y < 0.82, "\(viewport)")
            }
        }
        // Taps and rotation behave the same in both fields: only the position moves.
        let direction = { (blend: Double) in
            let f = OverviewCamera.frame(aspect: aspect, blend: blend)
            return simd_normalize(f.focus - f.position)
        }
        #expect(simd_distance(direction(0), direction(1)) < 1e-9)
        #expect(simd_distance(direction(0), direction(0.5)) < 1e-9)
    }
    // Wide landscape keeps the home zoom. iPad landscape is framed more tightly than the
    // web's 4:3 view, so it eases back a sliver (1.6%); narrow screens ease back further.
    for aspect in [16.0 / 9, 2.2] {
        #expect(OverviewCamera.frame(aspect: aspect, blend: 1).verticalHalfExtent
                == OverviewCamera.frame(aspect: aspect).verticalHalfExtent)
    }
    let ipadHome = OverviewCamera.frame(aspect: 4.0 / 3).verticalHalfExtent
    let ipadFar = OverviewCamera.frame(aspect: 4.0 / 3, blend: 1).verticalHalfExtent
    #expect(ipadFar >= ipadHome && ipadFar < ipadHome * 1.05)
    for aspect in [375.0 / 812, 402.0 / 874] {
        let near = OverviewCamera.frame(aspect: aspect).verticalHalfExtent
        let midway = OverviewCamera.frame(aspect: aspect, blend: 0.5).verticalHalfExtent
        let far = OverviewCamera.frame(aspect: aspect, blend: 1).verticalHalfExtent
        #expect(near < midway && midway < far && far < near * 1.5)
    }
}

@Test func theLaneIsOnScreenFromTheHomeFieldSoItCanBeTapped() {
    for viewport: SIMD2<Double> in [[402, 874], [874, 402], [1366, 1024]] {
        let aspect = viewport.x / viewport.y
        let middle = FarmMap.lane[2]
        let screen = screenPosition([middle.x, 0, middle.z], framing: OverviewCamera.frame(aspect: aspect), aspect: aspect)
        #expect(screen.x > 0.02 && screen.x < 0.98 && screen.y > 0.02 && screen.y < 0.98, "\(viewport)")
    }
}

@Test func aRideDownTheLaneReachesTheOtherFieldWithTheImplementLifted() throws {
    try #require(!sceneObstacles.isEmpty)
    let starts = [home, TractorState(x: 18, z: -6, heading: 0), TractorState(x: 15, z: 10, heading: .pi),
                  TractorState(x: -24, z: -11, heading: 0)]
    for follow in [false, true] {
        for start in starts {
            var state = start
            let navigation = TractorNavigation()
            navigation.tidy = follow
            for destination in [FieldSite.foxglove, .home] {
                let ride = LaneRide(to: destination, from: state, navigation: navigation, obstacles: sceneObstacles)
                var progress = LaneRide.Progress.riding, seconds = 0.0
                while progress == .riding && seconds < 90 {
                    let step = navigation.step(state, deltaTime: 1.0 / 30, tool: .wander, obstacles: sceneObstacles,
                                               manual: nil, follow: follow)
                    #expect(step.paint.isEmpty && step.cells.isEmpty)
                    state = step.state
                    progress = ride.update(state, blocked: step.blocked)
                    seconds += 1.0 / 30
                }
                let label = "from \(start.x),\(start.z) to \(destination.id), follow \(follow)"
                #expect(progress == .arrived, "\(label)")
                #expect(FieldBounds.containing(FarmPoint(x: state.x, z: state.z)) == destination.bounds, "\(label)")
                #expect(seconds < 45, "\(label): the ride is unhurried, not endless")
            }
        }
    }
}

@Test func routesStepAroundAnythingOnTheWayToTheLane() throws {
    try #require(!sceneObstacles.isEmpty)
    let start = FarmPoint(x: 18, z: -5)
    let route = FarmMap.route(from: start, to: .foxglove, obstacles: sceneObstacles)
    for (index, b) in route.enumerated() {
        let a = index == 0 ? start : route[index - 1]
        let dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz
        for o in sceneObstacles {
            let t = lengthSquared > 0 ? max(0, min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / lengthSquared)) : 0
            #expect(hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) > o.radius + 0.9)
        }
    }
}

@Test func foxgloveFieldKeepsItsOwnSoilCropsDisplayAndSave() throws {
    var far = FieldGrid(site: .foxglove)
    #expect(far.cells.count == FieldBounds.foxglove.cellCount && far.bounds == .foxglove && far.isValid)
    #expect(far.cells.allSatisfy { $0 == Ground.grass.rawValue }, "a new field starts as quiet meadow")
    #expect(far.fieldID == "foxglove")
    let from = FarmPoint(x: -80, z: 0), to = FarmPoint(x: -64, z: 0)
    #expect(far.apply(from: from, to: to, tool: .plow).groundChanges.count > 100)
    far.apply(from: from, to: to, tool: .sow, crop: .pumpkins)
    far.rest()
    let harvest = far.apply(from: from, to: to, tool: .harvest)
    #expect(harvest.harvestResults.first?.fieldID == "foxglove")
    #expect(far.display[2] > 0)

    // The home field never sees work done in Foxglove field.
    var homeField = FieldGrid()
    #expect(homeField.apply(from: from, to: to, tool: .plow).groundChanges.isEmpty)

    let restored = try JSONDecoder().decode(FieldGrid.self, from: JSONEncoder().encode(far))
    #expect(restored == far && restored.bounds == .foxglove)

    var save = MeadowSave(field: homeField, fields: [far], tractor: TractorState(x: -100, z: 3, heading: 1))
    #expect(save.isValid)
    let decoded = try JSONDecoder().decode(MeadowSave.self, from: JSONEncoder().encode(save))
    #expect(decoded == save && decoded.savedField(.foxglove) == far)
    // A home-field grid is never accepted as Foxglove field, or the other way round.
    save.fields = [homeField]
    #expect(!save.isValid)
    save.fields = nil
    save.field = far
    #expect(!save.isValid)
    // Older meadows without other fields still load, with no Foxglove save.
    let older = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(MeadowSave())) as? [String: Any])
    let olderSave = try JSONDecoder().decode(MeadowSave.self, from: JSONSerialization.data(withJSONObject: older))
    #expect(olderSave.isValid && olderSave.savedField(.foxglove) == nil)
}

@Test func tapsInFoxgloveFieldSnapToItsOwnGrid() throws {
    let destination = try #require(WorkDestination.create(FarmPoint(x: -70.1, z: 2.3), state: home, tool: .plow))
    #expect(destination.field == .foxglove)
    #expect(destination.center == FarmPoint(x: -70.25, z: 2.25))
    #expect(WorkDestination.create(FarmPoint(x: -40, z: -1), state: home, tool: .plow) == nil)
}

@Test func tidyRowsInFoxgloveFieldUseItsOwnLanesAndCells() throws {
    let start = TractorState(x: -60, z: 2, heading: -.pi / 2)
    let rows = TidyRows.plan(start, tap: FarmPoint(x: -100, z: 2))
    try #require(rows.count == 1)
    #expect(rows[0].field == .foxglove)
    #expect(TidyRows.plan(home, tap: FarmPoint(x: -15, z: 4.8)).first?.field == .home)
    let end = TidyRows.end(of: rows[0])
    #expect(abs(end.x - -100) < 0.5 && FieldBounds.containing(end) == .foxglove)
    for cell in TidyRows.cells(of: rows[0]) { #expect((0..<FieldBounds.foxglove.cellCount).contains(cell)) }

    // Drive it for real: navigation reports Foxglove cells, and they land there.
    var far = FieldGrid(site: .foxglove)
    let navigation = TractorNavigation()
    navigation.tidy = true
    var state = start, worked = 0
    navigation.choose(FarmPoint(x: -100, z: 2), state: state, tool: .plow, obstacles: sceneObstacles)
    for _ in 0..<(60 * 30) where navigation.run != nil {
        let step = navigation.step(state, deltaTime: 1.0 / 60, tool: .plow, obstacles: sceneObstacles)
        state = step.state
        if !step.cells.isEmpty {
            #expect(step.field == .foxglove)
            worked += far.apply(cells: step.cells, tool: .plow).groundChanges.count
        }
    }
    #expect(navigation.run == nil, "the row finishes")
    #expect(worked > 300)
    let laneZ = end.z
    for (index, ground) in far.cells.enumerated() where ground == Ground.soil.rawValue {
        let z = FieldBounds.foxglove.minZ + (Double(index / FieldBounds.foxglove.columns) + 0.5) * 0.5
        #expect(abs(z - laneZ) < 1.3)
    }
}

@Test func aTapInTheOtherFieldNeverRetargetsARowUnderWay() throws {
    let navigation = TractorNavigation()
    navigation.tidy = true
    navigation.choose(FarmPoint(x: 10, z: 4.8), state: home, tool: .plow, obstacles: sceneObstacles)
    let row = try #require(navigation.run?.row)
    navigation.choose(FarmPoint(x: -100, z: 2), state: home, tool: .plow, obstacles: sceneObstacles)
    #expect(navigation.run?.row == row)
    #expect(navigation.hasQueued)
}

@Test func windPlaysFoxglovesTenLanesOverItsLongerWidth() {
    var far = FieldGrid(site: .foxglove)
    let west = FarmPoint(x: -117, z: 0), east = FarmPoint(x: -57, z: 0)
    var configuration = FarmingConfiguration()
    configuration.implementRadius = 40
    far.apply(from: west, to: east, tool: .plow, configuration: configuration)
    far.apply(from: west, to: east, tool: .sow, crop: .wheat, configuration: configuration)
    far.rest()
    #expect(WindScore.beats(in: .foxglove) == 60)
    var bands = Set<Int>()
    for step in 0..<WindScore.beats(in: .foxglove) {
        for note in WindScore.notes(in: far, step: step) { bands.insert(note.band) }
    }
    #expect(bands.count == WindScore.bands)
    #expect(WindScore.notes(in: far, step: 60).isEmpty)

    var wind = Wind(random: { 0 })
    wind.gust()
    #expect(wind.advance(seconds: 0).front == FieldBounds.home.minX)
    // A gust under way finishes crossing its own field.
    wind.follow(.foxglove)
    #expect(wind.field == .home)
    var frame = wind.advance(seconds: 0.1)
    while frame.front != nil { frame = wind.advance(seconds: 0.5) }
    #expect(wind.field == .foxglove)
    wind.gust()
    #expect(wind.advance(seconds: 0).front == FieldBounds.foxglove.minX)
    #expect(wind.steps == 60)
}
