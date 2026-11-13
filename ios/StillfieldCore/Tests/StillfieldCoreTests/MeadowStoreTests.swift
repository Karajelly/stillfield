import Foundation
import Testing
@testable import StillfieldCore

private func withSaveURL(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("StillfieldTests-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory.appendingPathComponent("meadow.json"))
}

@Test func saveRoundTripPreservesEverySettingAndPaintedCell() throws {
    try withSaveURL { url in
        var save = MeadowSave()
        save.field.paint(x: 1, z: -2, tool: .plow)
        save.field.paint(x: 1, z: -2, tool: .sow)
        save.tractor = TractorState(x: -10, z: -3, heading: 1.2, speed: 2.4)
        save.tool = .sow
        save.rowAssist = false
        save.pace = 0.55
        save.goldenLight = true
        save.volume = 0.8
        save.haptics = false
        save.introDismissed = true
        save.cameraMode = .tractor
        save.tidyRows = true
        save.light = .dusk
        save.day = 432.5
        try MeadowStore.save(save, to: url)
        #expect(MeadowStore.load(from: url) == save)
        save.field.paint(x: 2, z: -4, tool: .plow)
        try MeadowStore.save(save, to: url)
        #expect(MeadowStore.load(from: url) == save)
    }
}

@Test func oldMeadowsWithoutACameraPreferenceStillLoad() throws {
    let original = MeadowSave()
    var json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
    json.removeValue(forKey: "cameraMode")
    let restored = try JSONDecoder().decode(MeadowSave.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(restored == original)
    #expect(restored.cameraMode == nil)
}

@Test func oldMeadowsWithoutATidyRowsChoiceStillLoadWithItOff() throws {
    var original = MeadowSave()
    original.tidyRows = true
    var json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
    #expect(json["tidyRows"] as? Bool == true)
    json.removeValue(forKey: "tidyRows")
    let restored = try JSONDecoder().decode(MeadowSave.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(restored.tidyRows == nil)
    #expect(MeadowSave().tidyRows == nil)
}

@Test func meadowsSavedWithCultivateOrTillChosenLoadWithPlow() throws {
    for old in ["cultivate", "till"] {
        var json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(MeadowSave())) as? [String: Any])
        json["tool"] = old
        let restored = try JSONDecoder().decode(MeadowSave.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(restored.tool == .plow)
    }
}

@Test func missingOrTruncatedSaveIsReadOnly() throws {
    try withSaveURL { url in
        #expect(MeadowStore.load(from: url) == nil)
        #expect(!FileManager.default.fileExists(atPath: url.path))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let corrupt = Data("{\"version\":1,\"field\":".utf8)
        try corrupt.write(to: url)
        #expect(MeadowStore.load(from: url) == nil)
        #expect(try Data(contentsOf: url) == corrupt)
    }
}

@Test func malformedSaveValuesAreRejectedWithoutRewriting() throws {
    var unsupported = MeadowSave()
    unsupported.version = 99
    var shortField = MeadowSave()
    shortField.field.cells.removeLast()
    var invalidCell = MeadowSave()
    invalidCell.field.cells[0] = 4
    var outsideWorld = MeadowSave()
    outsideWorld.tractor.x = 40
    var negativeSpeed = MeadowSave()
    negativeSpeed.tractor.speed = -1
    var invalidPace = MeadowSave()
    invalidPace.pace = 2
    var invalidVolume = MeadowSave()
    invalidVolume.volume = 1.1
    for invalid in [unsupported, shortField, invalidCell, outsideWorld, negativeSpeed, invalidPace, invalidVolume] {
        try withSaveURL { url in
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(invalid)
            try data.write(to: url)
            #expect(MeadowStore.load(from: url) == nil)
            #expect(try Data(contentsOf: url) == data)
        }
    }
}

@Test func invalidWriteCannotReplacePreviousMeadow() throws {
    try withSaveURL { url in
        let saved = MeadowSave()
        try MeadowStore.save(saved, to: url)
        let previousData = try Data(contentsOf: url)
        var invalid = saved
        invalid.tractor.heading = .nan
        #expect(throws: MeadowStoreError.invalidSave) {
            try MeadowStore.save(invalid, to: url)
        }
        #expect(try Data(contentsOf: url) == previousData)
        #expect(MeadowStore.load(from: url) == saved)
    }
}

@Test func corruptAndUnsupportedMeadowsSurviveFreshSavesInDistinctBackups() throws {
    try withSaveURL { url in
        var unsupported = MeadowSave()
        unsupported.version = 99
        let originals = [Data("{\"version\":1,\"field\":".utf8), try JSONEncoder().encode(unsupported)]
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var backups: [URL] = []
        for original in originals {
            try original.write(to: url)
            #expect(MeadowStore.load(from: url) == nil)
            let preserved = try MeadowStore.preserveExistingSave(at: url)
            let backup = try #require(preserved)
            backups.append(backup)
            #expect(!FileManager.default.fileExists(atPath: url.path))
            #expect(try MeadowStore.preserveExistingSave(at: url) == nil)
            #expect(try Data(contentsOf: backup) == original)

            var fresh = MeadowSave()
            fresh.field.paint(x: 2, z: 3, tool: .sow)
            try MeadowStore.save(fresh, to: url)
            #expect(MeadowStore.load(from: url) == fresh)
        }
        #expect(Set(backups).count == originals.count)
        for (backup, original) in zip(backups, originals) {
            #expect(try Data(contentsOf: backup) == original)
        }
    }
}

@Test func preservationSkipsMissingFilesAndRefusesToReplaceDirectories() throws {
    try withSaveURL { url in
        #expect(try MeadowStore.preserveExistingSave(at: url) == nil)
        #expect(!FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path))
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let retainedFile = url.appendingPathComponent("existing-meadow.json")
        let original = Data("Keep this previous meadow.".utf8)
        try original.write(to: retainedFile)
        #expect(throws: MeadowStoreError.invalidSave) {
            try MeadowStore.preserveExistingSave(at: url)
        }
        #expect(try Data(contentsOf: retainedFile) == original)
        #expect(FileManager.default.fileExists(atPath: url.path))
    }
}

@Test func gridUpgradePreservesOriginalSaveBeforeFirstReplacement() throws {
    try withSaveURL { url in
        var original = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(MeadowSave())) as? [String: Any])
        original["version"] = 2
        original["field"] = ["version": 2, "cells": Array(repeating: 0, count: 172 * 108),
            "crops": Array(repeating: 0, count: 172 * 108), "progress": Array(repeating: 0.0, count: 172 * 108),
            "display": [63, 64, 256], "fieldID": "willowbrook", "displayLocation": ["x": -16.0, "z": -15.5]]
        let bytes = try JSONSerialization.data(withJSONObject: original)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: url)
        var migrated = try #require(MeadowStore.load(from: url))
        #expect(try Data(contentsOf: url) == bytes)
        #expect(migrated.field.cells.count == 4500)
        #expect(migrated.field.display == [63, 64, 256])
        migrated.version = 3
        try MeadowStore.save(migrated, to: url)
        try MeadowStore.save(migrated, to: url)
        let backups = try FileManager.default.contentsOfDirectory(at: url.deletingLastPathComponent(), includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.contains("before-grid-v3") }
        #expect(backups.count == 1)
        #expect(try Data(contentsOf: #require(backups.first)) == bytes)
        #expect(MeadowStore.load(from: url) == migrated)
    }
}

@Test func meadowsSavedBeforeTheDayMovedKeepTheirLight() throws {
    for golden in [false, true] {
        let original = MeadowSave(goldenLight: golden)
        var json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        #expect(json["light"] == nil && json["day"] == nil)
        json.removeValue(forKey: "light")
        json.removeValue(forKey: "day")
        let restored = try JSONDecoder().decode(MeadowSave.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(restored == original)
        // Golden light becomes a held golden hour; everyone else starts a drifting morning.
        #expect(restored.resolvedLight == (golden ? .golden : .flow))
        #expect(restored.resolvedDay == (golden ? Daylight.holdSeconds(.golden) : 0))
    }
}

@Test func theHourOfTheDaySurvivesASaveAndAHeldLightWinsOverIt() throws {
    try withSaveURL { url in
        var save = MeadowSave(light: .flow, day: 500.25)
        try MeadowStore.save(save, to: url)
        let drifting = try #require(MeadowStore.load(from: url))
        #expect(drifting.resolvedLight == .flow && drifting.resolvedDay == 500.25)

        save.light = .night
        try MeadowStore.save(save, to: url)
        let held = try #require(MeadowStore.load(from: url))
        #expect(held.resolvedLight == .night)
        #expect(held.resolvedDay == Daylight.holdSeconds(.night))

        // An hour from past the end of the day wraps instead of failing the save.
        save.light = .flow
        save.day = Daylight.daySeconds * 3 + 12
        try MeadowStore.save(save, to: url)
        let wrapped = try #require(MeadowStore.load(from: url))
        #expect(wrapped.resolvedDay == 12)
    }
}

@Test func anUnknownLightFromANewerBuildLetsTheDayDrift() throws {
    var json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(MeadowSave(day: 90))) as? [String: Any])
    json["light"] = "noon"
    let restored = try JSONDecoder().decode(MeadowSave.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(restored.isValid)
    #expect(restored.resolvedLight == .flow && restored.resolvedDay == 90)
}
