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
    // Optional on disk so meadows saved before camera switching still decode.
    public var cameraMode: FarmCameraMode?
    public var selectedCrop: Crop?
    // Optional on disk so meadows saved before the day began to move still decode.
    /// Drifting through the day, or a held time of day. Use `resolvedLight`.
    public var light: DayHold?
    /// Seconds into the day while it drifts. Use `resolvedDay`.
    public var day: Double?
    // Optional on disk so meadows saved before tidy rows still decode. Off unless chosen.
    public var tidyRows: Bool?

    /// A meadow saved with golden light switched on keeps its golden hour.
    public var resolvedLight: DayHold { light ?? (goldenLight ? .golden : .flow) }
    /// A held light sits at its own moment; a drifting day resumes where it stopped.
    public var resolvedDay: Double {
        Daylight.holdSeconds(resolvedLight) ?? Daylight.wrap(day ?? 0)
    }

    public init(
        version: Int = 3,
        field: FieldGrid = FieldGrid(),
        tractor: TractorState = TractorState(),
        tool: FarmTool = .harvest,
        rowAssist: Bool = true,
        pace: Double = 0.85,
        goldenLight: Bool = false,
        volume: Double = 0.45,
        haptics: Bool = true,
        introDismissed: Bool = false,
        cameraMode: FarmCameraMode? = nil,
        selectedCrop: Crop? = .wheat,
        light: DayHold? = nil,
        day: Double? = nil,
        tidyRows: Bool? = nil
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
        self.cameraMode = cameraMode
        self.selectedCrop = selectedCrop
        self.light = light
        self.day = day
        self.tidyRows = tidyRows
    }

    public var isValid: Bool {
        (1...3).contains(version) && field.isValid &&
        tractor.x.isFinite && (-39...39).contains(tractor.x) &&
        tractor.z.isFinite && (-30...28).contains(tractor.z) &&
        tractor.heading.isFinite && tractor.speed.isFinite && (0...6.875).contains(tractor.speed) &&
        pace.isFinite && (0.55...1.25).contains(pace) &&
        volume.isFinite && (0...1).contains(volume) &&
        (day?.isFinite ?? true)
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
        // Keep the exact fine-grid save before its first coarse-grid replacement.
        if let previous = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: previous) as? [String: Any],
           let field = json["field"] as? [String: Any],
           (field["version"] as? Int ?? 1) < 3,
           let cells = field["cells"] as? [Any], cells.count == 172 * 108 {
            let backup = url.deletingLastPathComponent().appendingPathComponent(
                "\(url.deletingPathExtension().lastPathComponent)-before-grid-v3-\(UUID().uuidString).json"
            )
            try previous.write(to: backup, options: .atomic)
        }
        try data.write(to: url, options: .atomic)
    }
}
