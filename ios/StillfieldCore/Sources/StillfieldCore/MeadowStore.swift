import Foundation

public struct MeadowSave: Codable, Equatable, Sendable {
    public var version: Int
    public var field: FieldGrid
    public var tractor: TractorState
    public var tool: FarmTool
    public var rowAssist: Bool
    public var pace: Double
    public var goldenLight: Bool
    public var volume: Double
    public var haptics: Bool
    public var introDismissed: Bool

    public init(
        version: Int = 1,
        field: FieldGrid = FieldGrid(),
        tractor: TractorState = TractorState(),
        tool: FarmTool = .mow,
        rowAssist: Bool = true,
        pace: Double = 0.85,
        goldenLight: Bool = false,
        volume: Double = 0.45,
        haptics: Bool = true,
        introDismissed: Bool = false
    ) {
        self.version = version
        self.field = field
        self.tractor = tractor
        self.tool = tool
        self.rowAssist = rowAssist
        self.pace = pace
        self.goldenLight = goldenLight
        self.volume = volume
        self.haptics = haptics
        self.introDismissed = introDismissed
    }

    public var isValid: Bool {
        version == 1 && field.isValid &&
        tractor.x.isFinite && (-39...39).contains(tractor.x) &&
        tractor.z.isFinite && (-30...28).contains(tractor.z) &&
        tractor.heading.isFinite && tractor.speed.isFinite && (0...6.875).contains(tractor.speed) &&
        pace.isFinite && (0.55...1.25).contains(pace) &&
        volume.isFinite && (0...1).contains(volume)
    }
}

public enum MeadowStoreError: Error, Sendable {
    case invalidSave
}

public enum MeadowStore {
    /// A missing, unsupported, or corrupt save returns nil. Loading never writes
    /// to disk, so the caller can preserve a damaged file for recovery.
    public static func load(from url: URL) -> MeadowSave? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= 2_000_000,
              let data = try? Data(contentsOf: url),
              let save = try? JSONDecoder().decode(MeadowSave.self, from: data),
              save.isValid else { return nil }
        return save
    }

    /// Preserves an existing, unloaded meadow before starting fresh. Call this
    /// after `load` returns nil, and retry it before saving if preservation fails.
    /// A unique sibling file keeps previous recovery copies intact. Moving on
    /// the same filesystem avoids reading a potentially oversized file into RAM.
    /// Missing files need no recovery; all other failures must block replacement.
    @discardableResult
    public static func preserveExistingSave(at url: URL) throws -> URL? {
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
            return nil
        }
        guard attributes[.type] as? FileAttributeType == .typeRegular else { throw MeadowStoreError.invalidSave }
        let backup = url.deletingLastPathComponent().appendingPathComponent(
            "\(url.deletingPathExtension().lastPathComponent)-recovery-\(UUID().uuidString).json"
        )
        try FileManager.default.moveItem(at: url, to: backup)
        return backup
    }

    /// A failed validation cannot replace the previous meadow. The final file
    /// replacement is atomic, including when the app is interrupted during a save.
    public static func save(_ save: MeadowSave, to url: URL) throws {
        guard save.isValid else { throw MeadowStoreError.invalidSave }
        let data = try JSONEncoder().encode(save)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}
