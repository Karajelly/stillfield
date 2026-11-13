import Foundation

public enum Crop: UInt8, Codable, CaseIterable, Sendable {
    case wheat = 1, sunflowers, pumpkins
    public var title: String {
        switch self { case .wheat: "Wheat"; case .sunflowers: "Sunflowers"; case .pumpkins: "Pumpkins" }
    }
}

/// Mown is grass with a permanent appearance change, not a cultivation prerequisite.
public enum Ground: UInt8, Sendable {
    case grass, mown, soil, growing, mature, stubble
}

public struct FarmingConfiguration: Equatable, Sendable {
    public var growthSeconds: [Crop: Double] = [.wheat: 360, .sunflowers: 180, .pumpkins: 540]
    public var implementRadius = TractorHandling.brushRadius
    public var edgeCoverage = FieldGrid.cellSize / 2
    public var displayThresholds = [1, 64, 256]
    public init() {}
    public var isValid: Bool {
        Crop.allCases.allSatisfy { (growthSeconds[$0] ?? 0).isFinite && (growthSeconds[$0] ?? 0) > 0 } &&
        implementRadius.isFinite && implementRadius >= 0 && edgeCoverage.isFinite && edgeCoverage >= 0 &&
        displayThresholds.count == 3 && displayThresholds[0] == 1 &&
        displayThresholds[1] > 1 && displayThresholds[2] > displayThresholds[1]
    }
}

public struct HarvestResult: Equatable, Sendable {
    public let fieldID: String
    public let crop: Crop
    public let cells: [Int]
    public let stage: Int
}

/// Batched ground-change, maturity, and harvest events for rendering and audio.
public struct FarmingEvents: Equatable, Sendable {
    public var groundChanges: [Int] = []
    public var cropStages: [Int] = []
    public var cropMaturities: [Int] = []
    public var harvestResults: [HarvestResult] = []
    public var advancedSeconds = 0.0
    public var changedCells: [Int] { groundChanges + cropStages }
    public init() {}
}

public struct FieldGrid: Codable, Equatable, Sendable {
    /// The home field's geometry. Other fields carry their own `bounds`.
    public static let minX = -25.0, maxX = 20.0, minZ = -12.0, maxZ = 13.0
    public static let cellSize = 0.5
    public static let columns = 90, rows = 50
    public static let cellCount = columns * rows
    // Keep display units in the original 25 cm cell area to preserve saves and pacing.
    public static let harvestUnitsPerCell = Int(cellSize * cellSize / 0.0625)
    private static let legacyColumns = 172, legacyRows = 108

    public var cells: [UInt8]
    public var crops: [UInt8]
    /// Normalized active-play growth. No wall-clock timestamp or offline simulation.
    public var progress: [Double]
    public var display: [Int]
    public var fieldID = "willowbrook"
    public var displayLocation = FarmPoint(x: -16, z: -15.5)
    /// Where this grid's cells lie. Follows its field ID; not saved separately.
    public private(set) var bounds = FieldBounds.home

    /// A new field. Only the original one has starter plots.
    public init(starterRows: Bool = true, site: FieldSite = .home) {
        bounds = site.bounds
        fieldID = site.id
        displayLocation = site.displayLocation
        cells = Array(repeating: 0, count: site.bounds.cellCount)
        crops = cells
        progress = Array(repeating: 0, count: site.bounds.cellCount)
        display = [0, 0, 0]
        if starterRows && site.original {
            var x = -21.0
            while x <= 13 {
                for z in [10.8, 7.8] {
                    for i in FarmSimulation.cellsUnderBrush(x: x, z: z, radius: 1.05) { cells[i] = Ground.mown.rawValue }
                }
                x += 0.2
            }
            x = -4
            while x <= 13 {
                for i in FarmSimulation.cellsUnderBrush(x: x, z: 4.8, radius: 1.05) { cells[i] = Ground.mown.rawValue }
                x += 0.2
            }
            // Square crop plots leave a broad grass gap above the mown rows.
            let plots: [(Crop, Double)] = [(.sunflowers, -20.5), (.wheat, -11.5), (.pumpkins, -2.5)]
            for (crop, minX) in plots {
                for z in stride(from: -7.0, to: -2.0, by: Self.cellSize) {
                    for x in stride(from: minX, to: minX + 5, by: Self.cellSize) {
                        let i = Int((z - Self.minZ) / Self.cellSize) * Self.columns + Int((x - Self.minX) / Self.cellSize)
                        cells[i] = Ground.mature.rawValue; crops[i] = crop.rawValue; progress[i] = 1
                    }
                }
            }
        }
    }

    public func crop(at i: Int) -> Crop? { Crop(rawValue: crops[i]) }
    public func stage(at i: Int) -> Int { cells[i] == Ground.mature.rawValue ? 3 : min(2, Int(progress[i] * 3)) }
    public var isGrowing: Bool { cells.contains(Ground.growing.rawValue) }
    public func displayStage(_ crop: Crop, configuration: FarmingConfiguration = .init()) -> Int {
        configuration.displayThresholds.filter { display[Int(crop.rawValue) - 1] >= $0 }.count
    }

    @discardableResult
    public mutating func apply(from: FarmPoint, to: FarmPoint, tool: FarmTool, crop: Crop = .wheat,
                               configuration: FarmingConfiguration = .init()) -> FarmingEvents {
        precondition(configuration.isValid)
        return apply(cells: FarmSimulation.cellsUnderSweep(from: from, to: to,
                     radius: configuration.implementRadius + configuration.edgeCoverage, bounds: bounds),
                     tool: tool, crop: crop, configuration: configuration)
    }

    @discardableResult
    public mutating func apply(cells indices: [Int], tool: FarmTool, crop: Crop = .wheat,
                               configuration: FarmingConfiguration = .init()) -> FarmingEvents {
        precondition(configuration.isValid)
        var events = FarmingEvents()
        var harvested: [Crop: [Int]] = [:]
        for i in indices where cells.indices.contains(i) {
            let state = Ground(rawValue: cells[i])
            switch tool {
            case .cultivate where state == .grass || state == .mown || state == .growing || state == .mature || state == .stubble:
                cells[i] = Ground.soil.rawValue; crops[i] = 0; progress[i] = 0
            case .sow where state == .soil:
                cells[i] = Ground.growing.rawValue; crops[i] = crop.rawValue
            case .harvest where state == .mature:
                if let harvestedCrop = self.crop(at: i) { harvested[harvestedCrop, default: []].append(i) }
                cells[i] = Ground.stubble.rawValue; crops[i] = 0; progress[i] = 0
            case .mow where state == .grass:
                cells[i] = Ground.mown.rawValue
            case .restore where state != .grass:
                cells[i] = Ground.grass.rawValue; crops[i] = 0; progress[i] = 0
            default: continue
            }
            events.groundChanges.append(i)
        }
        for crop in Crop.allCases {
            guard let harvestedCells = harvested[crop] else { continue }
            let index = Int(crop.rawValue) - 1, cap = configuration.displayThresholds[2]
            display[index] = min(cap, min(cap, display[index]) + min(cap, harvestedCells.count * Self.harvestUnitsPerCell))
            events.harvestResults.append(HarvestResult(fieldID: fieldID, crop: crop, cells: harvestedCells,
                                                       stage: displayStage(crop, configuration: configuration)))
        }
        return events
    }

    // Navigation clients can still request only the changed indices.
    @discardableResult
    public mutating func paint(x: Double, z: Double, tool: FarmTool) -> [Int] {
        paint(from: .init(x: x, z: z), to: .init(x: x, z: z), tool: tool)
    }
    @discardableResult
    public mutating func paint(from: FarmPoint, to: FarmPoint, tool: FarmTool) -> [Int] {
        apply(from: from, to: to, tool: tool).changedCells
    }

    @discardableResult
    public mutating func advance(seconds: Double, active: Bool = true, configuration: FarmingConfiguration = .init()) -> FarmingEvents {
        precondition(configuration.isValid)
        var events = FarmingEvents()
        guard active, seconds.isFinite, seconds > 0 else { return events }
        for i in cells.indices where cells[i] == Ground.growing.rawValue {
            guard let crop = crop(at: i), let duration = configuration.growthSeconds[crop] else { continue }
            events.advancedSeconds = seconds
            let before = stage(at: i)
            progress[i] = min(1, progress[i] + seconds / duration)
            if progress[i] >= 1 - 1e-12 {
                progress[i] = 1; cells[i] = Ground.mature.rawValue; events.cropMaturities.append(i)
            }
            if before != stage(at: i) { events.cropStages.append(i) }
        }
        return events
    }

    @discardableResult
    public mutating func rest(configuration: FarmingConfiguration = .init()) -> FarmingEvents {
        precondition(configuration.isValid)
        var next = Double.infinity
        for i in cells.indices where cells[i] == Ground.growing.rawValue {
            if let crop = crop(at: i), let duration = configuration.growthSeconds[crop] {
                next = min(next, (1 - progress[i]) * duration)
            }
        }
        return advance(seconds: next, configuration: configuration)
    }

    public mutating func clearDisplay() { display = [0, 0, 0] }
    public mutating func reset() {
        cells = Array(repeating: 0, count: bounds.cellCount); crops = cells
        progress = Array(repeating: 0, count: bounds.cellCount); clearDisplay()
    }

    public var isValid: Bool {
        valid(cellCount: bounds.cellCount)
    }

    private func valid(cellCount: Int) -> Bool {
        guard cells.count == cellCount, crops.count == cellCount, progress.count == cellCount,
              display.count == 3, display.allSatisfy({ $0 >= 0 && $0 <= 1_000_000_000 }),
              !fieldID.isEmpty, displayLocation.x.isFinite, displayLocation.z.isFinite else { return false }
        return cells.indices.allSatisfy { i in
            guard let state = Ground(rawValue: cells[i]), progress[i].isFinite else { return false }
            if state == .growing || state == .mature {
                return crop(at: i) != nil && (state == .mature ? progress[i] == 1 : (0..<1).contains(progress[i]))
            }
            return crops[i] == 0 && progress[i] == 0
        }
    }

    private mutating func migrateLegacyGrid() {
        let oldCells = cells, oldCrops = crops, oldProgress = progress
        cells = Array(repeating: 0, count: Self.cellCount); crops = cells
        progress = Array(repeating: 0, count: Self.cellCount)
        var counts = Array(repeating: 0, count: Self.cellCount * 3)
        var furthest = Array(repeating: 0.0, count: Self.cellCount * 3)
        let priority = [0, 1, 3, 0, 0, 2]
        for i in oldCells.indices {
            // Fit the entire old field into the new bounds, including both outer edges.
            let col = (2 * (i % Self.legacyColumns) + 1) * Self.columns / (2 * Self.legacyColumns)
            let row = (2 * (i / Self.legacyColumns) + 1) * Self.rows / (2 * Self.legacyRows)
            let cell = row * Self.columns + col, state = oldCells[i]
            if oldCrops[i] > 0 {
                let key = cell * 3 + Int(oldCrops[i]) - 1
                counts[key] += 1
                furthest[key] = max(furthest[key], oldProgress[i])
            } else if priority[Int(state)] > priority[Int(cells[cell])] { cells[cell] = state }
        }
        for i in cells.indices {
            var chosen: Int?
            for crop in 0..<3 {
                let key = i * 3 + crop
                if counts[key] > 0 && (chosen == nil || counts[key] > counts[chosen!]) { chosen = key }
            }
            guard let chosen else { continue }
            // Crops win over bare ground; ties use crop order and growth never rewinds.
            crops[i] = UInt8(chosen % 3 + 1); progress[i] = furthest[chosen]
            cells[i] = progress[i] == 1 ? Ground.mature.rawValue : Ground.growing.rawValue
        }
    }

    private enum CodingKeys: String, CodingKey { case version, cells, crops, progress, display, fieldID, displayLocation }
    public init(from decoder: Decoder) throws {
        let data = try decoder.container(keyedBy: CodingKeys.self)
        let version = try data.decodeIfPresent(Int.self, forKey: .version) ?? 1
        var count = version < 3 ? Self.legacyColumns * Self.legacyRows : Self.cellCount
        cells = try data.decode([UInt8].self, forKey: .cells)
        if version == 1 {
            guard cells.count == count, cells.allSatisfy({ $0 <= 3 }) else {
                throw DecodingError.dataCorruptedError(forKey: .cells, in: data, debugDescription: "Invalid legacy meadow")
            }
            crops = Array(repeating: 0, count: count)
            progress = Array(repeating: 0, count: count)
            display = [0, 0, 0]
            // Preserve old wildflower patches as mature sunflowers.
            for i in cells.indices where cells[i] == 3 { cells[i] = 4; crops[i] = 2; progress[i] = 1 }
        } else if version == 2 || version == 3 {
            crops = try data.decode([UInt8].self, forKey: .crops)
            progress = try data.decode([Double].self, forKey: .progress)
            display = try data.decode([Int].self, forKey: .display)
            fieldID = try data.decode(String.self, forKey: .fieldID)
            displayLocation = try data.decode(FarmPoint.self, forKey: .displayLocation)
            // Legacy grids only ever belonged to the original field.
            if version == 3 { bounds = FieldSite.site(id: fieldID).bounds; count = bounds.cellCount }
        } else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: data, debugDescription: "Unsupported farming version")
        }
        guard valid(cellCount: count) else { throw DecodingError.dataCorruptedError(forKey: .cells, in: data, debugDescription: "Invalid farming state") }
        if version < 3 { migrateLegacyGrid() }
    }
    public func encode(to encoder: Encoder) throws {
        var data = encoder.container(keyedBy: CodingKeys.self)
        try data.encode(3, forKey: .version)
        try data.encode(cells, forKey: .cells); try data.encode(crops, forKey: .crops)
        try data.encode(progress, forKey: .progress); try data.encode(display, forKey: .display)
        try data.encode(fieldID, forKey: .fieldID); try data.encode(displayLocation, forKey: .displayLocation)
    }
}
