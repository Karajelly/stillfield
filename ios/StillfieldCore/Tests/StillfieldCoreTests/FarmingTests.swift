import Foundation
import Testing
@testable import StillfieldCore

private func plant(_ field: inout FieldGrid, _ cells: [Int], _ crop: Crop = .wheat) {
    field.apply(cells: cells, tool: .plow)
    field.apply(cells: cells, tool: .sow, crop: crop)
}

@Test func starterPlotsAreReadyToHarvestAndNeverReseedSavedFarms() throws {
    var field = FieldGrid()
    #expect(field.isValid && !field.isGrowing)
    for crop in Crop.allCases {
        let cells = field.cells.indices.filter { field.crop(at: $0) == crop }
        #expect(!cells.isEmpty)
        #expect(cells.allSatisfy { field.cells[$0] == Ground.mature.rawValue && field.progress[$0] == 1 })
        let result = field.apply(cells: cells, tool: .harvest)
        #expect(result.harvestResults.first?.crop == crop)
        #expect(result.harvestResults.first?.cells == cells)
        #expect(field.display[Int(crop.rawValue) - 1] > 0)
    }
    let harvested = try JSONDecoder().decode(FieldGrid.self, from: JSONEncoder().encode(field))
    #expect(harvested == field)
    field.reset()
    let empty = try JSONDecoder().decode(FieldGrid.self, from: JSONEncoder().encode(field))
    #expect(empty == field)
}

@Test func wheatThenAllCropsCompleteAndRepeatTheSameFourStageLoop() {
    var field = FieldGrid(starterRows: false)
    let config = FarmingConfiguration()
    for crop in Crop.allCases {
        plant(&field, [0, 1], crop)
        #expect(field.stage(at: 0) == 0)
        let duration = config.growthSeconds[crop]!
        field.advance(seconds: duration / 3); #expect(field.stage(at: 0) == 1)
        field.advance(seconds: duration / 3); #expect(field.stage(at: 0) == 2)
        #expect(field.apply(cells: [0], tool: .harvest).harvestResults.isEmpty)
        let maturity = field.advance(seconds: duration / 3)
        #expect(maturity.cropMaturities == [0, 1]); #expect(field.stage(at: 0) == 3)
        let result = field.apply(cells: [0, 0, 1], tool: .harvest)
        #expect(result.harvestResults.first?.crop == crop)
        #expect(result.harvestResults.first?.cells.count == 2)
        #expect(field.cells[0] == Ground.stubble.rawValue)
        #expect(field.display[Int(crop.rawValue) - 1] == 8)
        #expect(field.apply(cells: [0, 1], tool: .harvest).harvestResults.isEmpty)
    }
}

@Test func everyInvalidActionPreservesCropAndProgress() {
    let valid: [[FarmTool]] = [[.plow, .mow], [.plow, .restore], [.sow, .mow, .restore], [.plow, .mow, .restore], [.plow, .harvest, .mow, .restore], [.plow, .mow, .restore]]
    for state in UInt8(0)...5 {
        for tool in FarmTool.allCases {
            var field = FieldGrid(starterRows: false)
            field.cells[0] = state
            if state == 3 || state == 4 { field.crops[0] = 1; field.progress[0] = state == 4 ? 1 : 0.45 }
            let before = field
            let result = field.apply(cells: [0, 0, -1, FieldGrid.cellCount], tool: tool, crop: .pumpkins)
            let allowed = valid[Int(state)].contains(tool)
            #expect(result.groundChanges.count == (allowed ? 1 : 0))
            if !allowed { #expect(Bool(field == before)) }
            #expect(field.isValid)
        }
    }
}

@Test func mowingReturnsEveryStateToFlatGreenGrassWithoutHarvestRewards() {
    for state in UInt8(0)...5 {
        var field = FieldGrid(starterRows: false)
        field.cells[0] = state
        if state == 3 || state == 4 { field.crops[0] = 2; field.progress[0] = state == 4 ? 1 : 0.5 }
        let result = field.apply(cells: [0], tool: .mow)
        #expect(field.cells[0] == Ground.mown.rawValue && field.crops[0] == 0 && field.progress[0] == 0)
        #expect(result.harvestResults.isEmpty && field.display == [0, 0, 0])
    }
}

@Test func tuftedGrassGrowsBackOnlyOnMownGroundDuringActivePlay() throws {
    let seconds = FarmingConfiguration().grassSeconds
    var field = FieldGrid(starterRows: false)
    field.cells[0] = Ground.mown.rawValue
    field.cells[1] = Ground.soil.rawValue
    field.cells[2] = Ground.stubble.rawValue
    #expect(field.advance(seconds: seconds, active: false).grassRegrowth.isEmpty)
    let third = field.advance(seconds: seconds / 3 + 1)
    #expect(third.grassRegrowth == [0] && third.groundChanges.isEmpty)
    #expect(field.cells[0] == Ground.mown.rawValue && field.stage(at: 0) == 1 && field.isValid)
    // A partly grown patch can be mown flat again.
    #expect(field.apply(cells: [0], tool: .mow).groundChanges == [0])
    #expect(field.progress[0] == 0)
    #expect(field.apply(cells: [0], tool: .mow).groundChanges.isEmpty)
    let done = field.advance(seconds: seconds)
    #expect(done.grassRegrowth.contains(0) && done.advancedSeconds > 0)
    #expect(field.cells[0] == Ground.grass.rawValue && field.progress[0] == 0)
    #expect(field.cells[1] == Ground.soil.rawValue && field.cells[2] == Ground.stubble.rawValue)
    // Tufted grass stays as it is until mown again.
    field.advance(seconds: seconds * 3)
    #expect(field.cells[0] == Ground.grass.rawValue)
    let loaded = try JSONDecoder().decode(FieldGrid.self, from: JSONEncoder().encode(field))
    #expect(loaded == field)
}

@Test func plowingClearsGrowingAndLeftoverMatureCropsWithoutHarvestRewards() {
    let config = FarmingConfiguration()
    for crop in Crop.allCases {
        var field = FieldGrid(starterRows: false)
        let from = FarmPoint(x: -10, z: 0), to = FarmPoint(x: 10, z: 0)
        let cells = field.apply(from: from, to: to, tool: .plow).groundChanges
        let mature = cells[0], growing = cells[1], harvested = cells[2]
        field.apply(cells: [mature, harvested], tool: .sow, crop: crop)
        field.advance(seconds: config.growthSeconds[crop]!)
        field.apply(cells: [harvested], tool: .harvest)
        field.apply(cells: [growing], tool: .sow, crop: crop)
        field.advance(seconds: config.growthSeconds[crop]! / 2)
        let display = field.display

        let result = field.apply(from: to, to: from, tool: .plow)
        #expect(Set(result.groundChanges) == Set([mature, growing, harvested]))
        #expect(result.harvestResults.isEmpty)
        #expect(field.display == display)
        #expect(cells.allSatisfy { field.cells[$0] == Ground.soil.rawValue && field.crops[$0] == 0 && field.progress[$0] == 0 })
        #expect(field.apply(from: from, to: to, tool: .plow).groundChanges.isEmpty)
        #expect(field.rest().advancedSeconds == 0)
        #expect(field.advance(seconds: 100_000).cropMaturities.isEmpty)
        #expect(field.isValid)

        field.apply(cells: [mature, growing], tool: .sow, crop: crop)
        #expect([mature, growing].allSatisfy { field.cells[$0] == Ground.growing.rawValue && field.crop(at: $0) == crop && field.progress[$0] == 0 })
    }
}

@Test func restAdvancesMixedCropsEquallyIgnoringMatureCrops() {
    var field = FieldGrid(starterRows: false)
    for (i, crop) in Crop.allCases.enumerated() { plant(&field, [i], crop) }
    #expect(field.rest().advancedSeconds == 180)
    #expect(field.progress[0] == 0.5 && field.progress[1] == 1 && field.progress[2] == 1.0 / 3)
    #expect(field.rest().advancedSeconds == 180)
    #expect(field.cells[0] == Ground.mature.rawValue)
    #expect(abs(field.rest().advancedSeconds - 180) < 1e-8)
    let done = field
    #expect(field.rest().advancedSeconds == 0)
    field.advance(seconds: 100_000)
    #expect(Bool(field == done))
}

@Test func activePlayTimeHasNoInactiveOrOfflineCatchUp() throws {
    var field = FieldGrid(starterRows: false)
    plant(&field, [0]); field.advance(seconds: 51.125)
    let saved = field
    for seconds in [0, -1, Double.nan, Double.infinity] { field.advance(seconds: seconds) }
    field.advance(seconds: 9_000, active: false)
    #expect(Bool(field == saved))
    var loaded = try JSONDecoder().decode(FieldGrid.self, from: JSONEncoder().encode(saved))
    #expect(Bool(loaded == saved))
    loaded.advance(seconds: 308.875)
    #expect(loaded.cells[0] == Ground.mature.rawValue)
}

@Test func displaysRewardFirstCellFillAndNeverBlockHarvests() {
    var field = FieldGrid(starterRows: false)
    for (count, stage) in [(1, 1), (15, 2), (48, 3), (20, 3)] {
        let cells = Array(0..<count)
        plant(&field, cells); field.rest()
        let harvest = field.apply(cells: cells, tool: .harvest)
        #expect(harvest.harvestResults.first?.cells.count == count)
        #expect(field.displayStage(.wheat) == stage)
        #expect(cells.allSatisfy { field.cells[$0] == Ground.stubble.rawValue })
    }
    field.clearDisplay(); #expect(field.displayStage(.wheat) == 0)
    plant(&field, [0]); field.rest(); field.apply(cells: [0], tool: .harvest)
    #expect(field.displayStage(.wheat) == 1)
}

@Test func growthCoverageAndDisplayThresholdsAreConfigurable() {
    var config = FarmingConfiguration()
    config.growthSeconds[.wheat] = 3; config.displayThresholds = [1, 8, 12]
    var field = FieldGrid(starterRows: false)
    plant(&field, [0, 1]); field.advance(seconds: 3, configuration: config)
    field.apply(cells: [0, 1], tool: .harvest, configuration: config)
    #expect(field.displayStage(.wheat, configuration: config) == 2)
    let from = FarmPoint(x: -10, z: 0), to = FarmPoint(x: 10, z: 0)
    let wide = field.apply(from: from, to: to, tool: .plow).changedCells.count
    config.edgeCoverage = 0
    var tight = FieldGrid(starterRows: false)
    #expect(tight.apply(from: from, to: to, tool: .plow, configuration: config).changedCells.count < wide)
}

@Test func mixedFarmSavePreservesAllCropDisplaysAndPartialGrowthExactly() throws {
    var save = MeadowSave(field: FieldGrid(starterRows: false), selectedCrop: .pumpkins)
    for (i, crop) in Crop.allCases.enumerated() {
        plant(&save.field, [i], crop); save.field.rest(); save.field.apply(cells: [i], tool: .harvest)
        plant(&save.field, [i + 10], crop)
    }
    save.field.apply(cells: [5], tool: .mow)
    save.field.advance(seconds: 4.123)
    let restored = try JSONDecoder().decode(MeadowSave.self, from: JSONEncoder().encode(save))
    #expect(Bool(restored == save)); #expect(restored.isValid)
}

@Test func legacyWildflowersMigrateToMatureSunflowersWithoutChangingPaths() throws {
    var legacy = Array(repeating: 0, count: 172 * 108)
    legacy[0] = 1; legacy[2] = 2; legacy[4] = 3
    let data = try JSONSerialization.data(withJSONObject: ["cells": legacy])
    let field = try JSONDecoder().decode(FieldGrid.self, from: data)
    #expect(field.cells[0] == 1 && field.cells[1] == 2)
    #expect(field.crop(at: 2) == .sunflowers && field.stage(at: 2) == 3)
    #expect(field.isValid)
    let tool = try JSONDecoder().decode(FarmTool.self, from: Data("\"till\"".utf8))
    #expect(tool == .plow)
    #expect(FieldGrid().cells.contains(Ground.mature.rawValue))
}

@Test func fineGridMigrationKeepsEdgesDominantCropsGrowthAndDisplayStages() throws {
    var cells = Array(repeating: 0, count: 172 * 108), crops = cells
    var progress = Array(repeating: 0.0, count: cells.count)
    for (i, crop, growth) in [(0, 1, 0.2), (1, 2, 0.8), (172, 2, 0.4), (2, 1, 1.0), (3, 2, 1.0), (18575, 3, 1.0)] {
        cells[i] = growth == 1 ? 4 : 3; crops[i] = crop; progress[i] = growth
    }
    cells[4] = 2; cells[5] = 5; cells[6] = 1; cells[8] = 5
    var old: [String: Any] = ["version": 2, "cells": cells, "crops": crops, "progress": progress,
        "display": [63, 64, 256], "fieldID": "willowbrook", "displayLocation": ["x": -16.0, "z": -15.5]]
    let field = try JSONDecoder().decode(FieldGrid.self, from: JSONSerialization.data(withJSONObject: old))
    #expect(FieldGrid.columns == 90 && FieldGrid.rows == 50 && FieldGrid.cellCount == 4500)
    #expect(FieldGrid.maxX - FieldGrid.minX == 45 && FieldGrid.maxZ - FieldGrid.minZ == 25)
    #expect(field.crop(at: 0) == .sunflowers && field.progress[0] == 0.8)
    #expect(field.crop(at: 1) == .wheat && field.stage(at: 1) == 3)
    #expect(field.cells[2] == 2 && field.cells[3] == 1 && field.cells[4] == 5)
    #expect(field.crop(at: 4499) == .pumpkins && field.stage(at: 4499) == 3)
    #expect(field.display == [63, 64, 256])
    #expect(Crop.allCases.map { field.displayStage($0) } == [1, 2, 3])
    let encoded = try JSONEncoder().encode(field)
    #expect((try JSONSerialization.jsonObject(with: encoded) as? [String: Any])?["version"] as? Int == 3)
    #expect(try JSONDecoder().decode(FieldGrid.self, from: encoded) == field)
    old["progress"] = []
    #expect(throws: DecodingError.self) { try JSONDecoder().decode(FieldGrid.self, from: JSONSerialization.data(withJSONObject: old)) }
    old["progress"] = progress.map { _ in 2.0 }
    #expect(throws: DecodingError.self) { try JSONDecoder().decode(FieldGrid.self, from: JSONSerialization.data(withJSONObject: old)) }
    old["progress"] = progress; old["version"] = 3
    #expect(throws: DecodingError.self) { try JSONDecoder().decode(FieldGrid.self, from: JSONSerialization.data(withJSONObject: old)) }
}

@Test func halfMetreCellsHaveNoGapsBetweenStraightDiagonalAndOffGridPasses() throws {
    #expect(FieldGrid.cellSize == 0.5 && FarmingConfiguration().implementRadius == 1.25)
    for angle in [0.0, 0.2, .pi / 4, .pi / 2] {
        var field = FieldGrid(starterRows: false)
        let dx = sin(angle), dz = cos(angle)
        for offset in [-5.0, -2.5, 0, 2.5, 5] {
            let from = FarmPoint(x: -2.13 + dz * offset - dx * 9, z: 0.17 - dx * offset - dz * 9)
            let to = FarmPoint(x: from.x + dx * 18, z: from.z + dz * 18)
            field.apply(from: from, to: to, tool: .plow)
            field.apply(from: from, to: to, tool: .sow, crop: .sunflowers)
        }
        var checked = 0
        for i in field.cells.indices {
            let x = FieldGrid.minX + (Double(i % FieldGrid.columns) + 0.5) * FieldGrid.cellSize + 2.13
            let z = FieldGrid.minZ + (Double(i / FieldGrid.columns) + 0.5) * FieldGrid.cellSize - 0.17
            if abs(x * dx + z * dz) > 8 || abs(x * dz - z * dx) > 6 { continue }
            try #require(field.cells[i] == Ground.growing.rawValue && field.crop(at: i) == .sunflowers)
            checked += 1
        }
        #expect(checked > 700)
    }
}
