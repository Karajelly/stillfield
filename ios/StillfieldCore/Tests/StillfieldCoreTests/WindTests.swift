import Foundation
import Testing
@testable import StillfieldCore

/// Every cell of one pitch lane, across the given beats.
private func lane(_ band: Int, from firstStep: Int = 0, through lastStep: Int = WindScore.steps - 1) -> [Int] {
    var cells: [Int] = []
    for row in band * WindScore.bandRows..<(band + 1) * WindScore.bandRows {
        for column in firstStep * WindScore.stepColumns..<(lastStep + 1) * WindScore.stepColumns {
            cells.append(row * FieldGrid.columns + column)
        }
    }
    return cells
}

private func grow(_ field: inout FieldGrid, _ cells: [Int], _ crop: Crop, seconds: Double = 9_999) {
    field.apply(cells: cells, tool: .cultivate)
    field.apply(cells: cells, tool: .sow, crop: crop)
    field.advance(seconds: seconds)
}

@Test func theWindIsSilentOverGrassMownPathsAndBareSoil() {
    var field = FieldGrid(starterRows: false)
    field.apply(cells: lane(2), tool: .cultivate)
    field.apply(cells: lane(4), tool: .mow)
    for step in 0..<WindScore.steps { #expect(WindScore.notes(in: field, step: step).isEmpty) }
}

@Test func oneLaneSoundsOnePitchForAsLongAsTheRowRuns() {
    var field = FieldGrid(starterRows: false)
    grow(&field, lane(3, from: 10, through: 19), .wheat)
    for step in 0..<WindScore.steps {
        let notes = WindScore.notes(in: field, step: step)
        if (10...19).contains(step) {
            #expect(notes == [WindNote(voice: .wheat, band: 3, level: 1)])
        } else {
            #expect(notes.isEmpty)
        }
    }
}

@Test func seedsAreSilentAndTheSongGrowsWithTheCrop() {
    var field = FieldGrid(starterRows: false)
    let cells = lane(0)
    field.apply(cells: cells, tool: .cultivate)
    field.apply(cells: cells, tool: .sow, crop: .sunflowers)
    #expect(WindScore.notes(in: field, step: 4).isEmpty)
    var levels: [Double] = []
    for _ in 0..<4 {
        field.advance(seconds: 180 / 3.9)
        levels.append(WindScore.notes(in: field, step: 4).first?.level ?? 0)
    }
    #expect(levels.last == 1 && levels[0] < 1)
    for index in 1..<levels.count { #expect(levels[index] >= levels[index - 1]) }
}

@Test func eachCropHasItsOwnVoiceAndPumpkinsASlowerPulse() {
    var field = FieldGrid(starterRows: false)
    grow(&field, lane(1), .wheat)
    grow(&field, lane(5), .sunflowers)
    grow(&field, lane(8), .pumpkins)
    #expect(WindScore.notes(in: field, step: 6).map { "\($0.voice.rawValue):\($0.band)" }
            == ["wheat:1", "sunflowers:5", "pumpkins:8"])
    #expect(WindScore.notes(in: field, step: 7).map { "\($0.voice.rawValue):\($0.band)" }
            == ["wheat:1", "sunflowers:5"])
}

@Test func aFullFieldRollsThroughItsLanesInsteadOfSoundingThemAll() {
    var field = FieldGrid(starterRows: false)
    for band in 0..<WindScore.bands { grow(&field, lane(band), .wheat) }
    var heard = Set<Int>()
    for step in 0..<WindScore.steps {
        let notes = WindScore.notes(in: field, step: step)
        #expect(notes.count == 2 && notes[0].band != notes[1].band)
        notes.forEach { heard.insert($0.band) }
    }
    #expect(heard.count == WindScore.bands)
}

@Test func stubbleIsBrushedOnTheOffBeatAfterAHarvest() throws {
    var field = FieldGrid(starterRows: false)
    for band in 0..<3 { grow(&field, lane(band), .wheat) }
    for band in 0..<3 { field.apply(cells: lane(band), tool: .harvest) }
    #expect(WindScore.notes(in: field, step: 4).isEmpty)
    let brush = try #require(WindScore.notes(in: field, step: 5).first)
    #expect(brush.voice == .stubble && abs(brush.level - 0.3) < 1e-9)
}

@Test func theWindIgnoresBeatsOutsideTheFieldAndNeverChangesTheFarm() {
    var field = FieldGrid(starterRows: false)
    grow(&field, lane(2), .pumpkins, seconds: 60)
    let before = field
    for step in [-1, WindScore.steps, Int.max] { #expect(WindScore.notes(in: field, step: step).isEmpty) }
    for step in 0..<WindScore.steps { _ = WindScore.notes(in: field, step: step) }
    #expect(field == before)
}

@Test func theFarSideOfTheFieldIsTunedHighestOnAPentatonicScale() {
    for crop in Crop.allCases {
        for band in 1..<WindScore.bands {
            #expect(WindScore.frequency(crop, band: band) < WindScore.frequency(crop, band: band - 1))
        }
        #expect(WindScore.frequency(crop, band: -4) == WindScore.frequency(crop, band: 0))
        #expect(WindScore.frequency(crop, band: 99) == WindScore.frequency(crop, band: WindScore.bands - 1))
    }
    let root = WindScore.frequency(.wheat, band: WindScore.bands - 1)
    #expect(abs(root - 293.66) < 1e-9)
    #expect(WindScore.frequency(.pumpkins, band: 0) < WindScore.frequency(.wheat, band: 0))
    #expect(WindScore.frequency(.wheat, band: 0) < WindScore.frequency(.sunflowers, band: 0))
    // A minor third above the root after dark, a major second by day.
    #expect(abs(WindScore.frequency(.wheat, band: WindScore.bands - 2, night: true) / root - pow(2, 3.0 / 12)) < 1e-9)
    #expect(abs(WindScore.frequency(.wheat, band: WindScore.bands - 2) / root - pow(2, 2.0 / 12)) < 1e-9)
}

@Test func theFirstOfEveryFourBeatsIsAccentedAndNoneIsSilenced() {
    #expect((0...4).map { WindScore.accent(step: $0) } == [1, 0.55, 0.75, 0.55, 1])
}

@Test func aGustCrossesTheFieldOnceSoundingEveryBeatInOrderThenRests() {
    var wind = Wind(random: { 0 })
    #expect(wind.advance(seconds: WindScore.firstRest - 1) == WindFrame(front: nil, steps: [], strength: 0))
    var steps: [Int] = []
    var last = FieldGrid.minX - 1
    var frame = wind.advance(seconds: 1)
    var frames = 0
    while let front = frame.front {
        steps += frame.steps
        #expect(front >= last && (0...1).contains(frame.strength))
        last = front
        frames += 1
        guard frames < 2_000 else { break }
        frame = wind.advance(seconds: 1.0 / 30)
    }
    steps += frame.steps
    #expect(steps == Array(0..<WindScore.steps))
    #expect(last >= FieldGrid.maxX)
    #expect(!wind.isGusting)
    #expect(wind.advance(seconds: WindScore.minRest - 1).front == nil)
    #expect(wind.advance(seconds: 1).front == FieldGrid.minX)
}

@Test func theWindKeepsTimeAtAnyFrameRateAndWaitsWhileTheGameIsPaused() {
    for rate in [15.0, 60.0, 120.0] {
        var wind = Wind(random: { 0.5 })
        wind.gust()
        var steps: [Int] = []
        for _ in 0..<Int(WindScore.gustSeconds * rate) - 1 { steps += wind.advance(seconds: 1 / rate).steps }
        #expect(steps == Array(0..<WindScore.steps))
    }
    var resting = Wind()
    for _ in 0..<1_000 { #expect(resting.advance(seconds: 0).front == nil) }
    #expect(resting.advance(seconds: .nan).front == nil)
}

@Test func plantsBendOnlyBehindTheFrontAndSettleByTheEndOfTheTrail() {
    #expect(WindScore.bend(behind: -1) == 0 && WindScore.bend(behind: 0) == 0)
    #expect(WindScore.bend(behind: WindScore.gustTrail) == 0 && WindScore.bend(behind: .nan) == 0)
    var peak = 0.0
    for tenth in 1..<Int(WindScore.gustTrail * 10) {
        let bend = WindScore.bend(behind: Double(tenth) / 10)
        #expect(bend > 0 && bend <= 1)
        peak = max(peak, bend)
    }
    #expect(peak > 0.9)
}

@Test func aLeanIsAShearBuiltFromTwoTurnsAndAStretch() {
    for lean in [0, 0.05, 0.3, 0.42, -0.42, 1.5] {
        let transform = LeanTransform(lean: lean)
        // Compose R(outer) * diag(stretch, 1 / stretch) * R(inner) by hand.
        func turn(_ angle: Double) -> [[Double]] { [[cos(angle), -sin(angle)], [sin(angle), cos(angle)]] }
        func times(_ a: [[Double]], _ b: [[Double]]) -> [[Double]] {
            (0..<2).map { row in (0..<2).map { column in a[row][0] * b[0][column] + a[row][1] * b[1][column] } }
        }
        let scale = [[transform.stretch, 0], [0, 1 / transform.stretch]]
        let matrix = times(times(turn(transform.outerAngle), scale), turn(transform.innerAngle))
        let shear = [[1, lean], [0, 1]]
        for row in 0..<2 {
            for column in 0..<2 { #expect(abs(matrix[row][column] - shear[row][column]) < 1e-12) }
        }
    }
    #expect(LeanTransform(lean: .nan) == LeanTransform(lean: 0))
}

@Test func postcardsNameWhateverIsGrowing() {
    var field = FieldGrid(starterRows: false)
    #expect(PostcardCaption.growing(in: field) == "A quiet meadow, resting")
    grow(&field, lane(1), .pumpkins)
    #expect(PostcardCaption.growing(in: field) == "Pumpkins in the field")
    grow(&field, lane(3), .wheat, seconds: 1)
    #expect(PostcardCaption.growing(in: field) == "Wheat and pumpkins in the field")
    #expect(PostcardCaption.growing(in: FieldGrid()) == "Wheat, sunflowers and pumpkins in the field")
}
