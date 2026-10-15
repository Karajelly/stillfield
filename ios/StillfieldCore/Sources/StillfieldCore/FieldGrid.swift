import Foundation

/// Cell values: 0 = meadow, 1 = mown, 2 = tilled, 3 = wildflowers.
public struct FieldGrid: Codable, Equatable, Sendable {
    public static let minX = -24.0
    public static let maxX = 19.0
    public static let minZ = -13.0
    public static let maxZ = 14.0
    public static let cellSize = 0.25
    public static let columns = 172
    public static let rows = 108

    public var cells: [UInt8]

    public init(starterRows: Bool = true) {
        cells = Array(repeating: 0, count: Self.columns * Self.rows)
        if starterRows {
            var x = -21.0
            while x <= 13 {
                for z in [10.8, 7.8] {
                    for index in FarmSimulation.cellsUnderBrush(x: x, z: z, radius: 1.05) {
                        cells[index] = 1
                    }
                }
                x += 0.2
            }
            x = -4
            while x <= 13 {
                for index in FarmSimulation.cellsUnderBrush(x: x, z: 4.8, radius: 1.05) {
                    cells[index] = 1
                }
                x += 0.2
            }
        }
    }

    /// Only changed indices are returned, allowing a renderer to update a small
    /// part of the field while driving instead of rebuilding the entire meadow.
    @discardableResult
    public mutating func paint(x: Double, z: Double, tool: FarmTool) -> [Int] {
        guard tool != .wander, cells.count == Self.columns * Self.rows else { return [] }
        let value: UInt8 = switch tool {
        case .mow: 1
        case .till: 2
        case .sow: 3
        case .wander: 0
        }
        var changed: [Int] = []
        for index in FarmSimulation.cellsUnderBrush(x: x, z: z, radius: 1.15) {
            if cells[index] != value {
                cells[index] = value
                changed.append(index)
            }
        }
        return changed
    }

    public mutating func reset() {
        cells = Array(repeating: 0, count: Self.columns * Self.rows)
    }

    public var isValid: Bool {
        cells.count == Self.columns * Self.rows && cells.allSatisfy { $0 <= 3 }
    }
}
