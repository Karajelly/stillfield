import Foundation

public enum WindVoice: String, CaseIterable, Sendable {
    case wheat, sunflowers, pumpkins, stubble

    public init(_ crop: Crop) {
        switch crop {
        case .wheat: self = .wheat
        case .sunflowers: self = .sunflowers
        case .pumpkins: self = .pumpkins
        }
    }

    public var crop: Crop? {
        switch self {
        case .wheat: .wheat
        case .sunflowers: .sunflowers
        case .pumpkins: .pumpkins
        case .stubble: nil
        }
    }
}

public struct WindNote: Equatable, Sendable {
    public let voice: WindVoice
    /// 0 is the far side of the field, the top of the score and the highest pitch.
    public let band: Int
    /// 0 to 1: how much of the slice is grown, and how grown it is.
    public let level: Double

    public init(voice: WindVoice, band: Int, level: Double) {
        self.voice = voice
        self.band = band
        self.level = level
    }
}

/// Every so often a gust crosses the field from west to east and plays what is
/// growing there. The field reads as a score: each metre the gust travels is one
/// beat, each 2.5 m lane (one pass of the implement) is one pitch, and each crop
/// is a voice. It only listens. Nothing here changes the farm.
///
/// Keep in sync with src/wind.ts.
public enum WindScore {
    /// Columns per beat: 1 m of travel.
    public static let stepColumns = 2
    /// Rows per pitch lane: 2.5 m, one implement pass.
    public static let bandRows = 5
    public static let stepSeconds = 0.42
    public static let firstRest = 16.0
    public static let minRest = 40.0
    public static let maxRest = 70.0
    /// A lane sounds once about a third of its slice is grown.
    public static let threshold = 0.3
    /// Beats across the home field.
    public static let steps = FieldGrid.columns / stepColumns
    /// Ten pitch lanes in every field: the home field's 2.5 m lanes set the scale.
    public static let bands = FieldGrid.rows / bandRows
    public static let gustSeconds = Double(steps) * stepSeconds
    /// A wider field is a longer phrase at the same tempo: one beat per metre.
    public static func beats(in field: FieldBounds) -> Int { field.columns / stepColumns }
    public static func gustDuration(in field: FieldBounds) -> Double { Double(beats(in: field)) * stepSeconds }
    /// Plants within this many metres behind a gust front bend, then settle.
    public static let gustTrail = 6.5

    // Seeds are silent, shoots are faint, and a mature crop sings at full voice.
    private static let stageLevel = [0, 0.35, 0.65, 1]

    /// The notes one beat of a gust sounds as it crosses `step` metres of field.
    public static func notes(in field: FieldGrid, step: Int) -> [WindNote] {
        let bounds = field.bounds, rows = bounds.rows, columns = bounds.columns
        guard (0..<beats(in: bounds)).contains(step) else { return [] }
        var coverage = [WindVoice: [Double]]()
        for voice in WindVoice.allCases { coverage[voice] = Array(repeating: 0, count: bands) }
        // Rows spread evenly over the ten lanes; in the home field, five rows each.
        func bandOf(_ row: Int) -> Int { row * bands / rows }
        var perBand = Array(repeating: 0.0, count: bands)
        for row in 0..<rows { perBand[bandOf(row)] += Double(stepColumns) }
        for row in 0..<rows {
            let band = bandOf(row)
            for offset in 0..<stepColumns {
                let cell = row * columns + step * stepColumns + offset
                let state = field.cells[cell]
                if state == Ground.stubble.rawValue {
                    coverage[.stubble]?[band] += 1
                } else if state == Ground.growing.rawValue || state == Ground.mature.rawValue,
                          let crop = field.crop(at: cell) {
                    coverage[WindVoice(crop)]?[band] += stageLevel[field.stage(at: cell)]
                }
            }
        }
        var notes: [WindNote] = []
        for crop in Crop.allCases {
            // Pumpkins keep a slower pulse, like a bass under the other two.
            if crop == .pumpkins && !step.isMultiple(of: 2) { continue }
            let voice = WindVoice(crop)
            let lanes = (coverage[voice] ?? []).enumerated()
                .map { (band: $0.offset, level: $0.element / perBand[$0.offset]) }
                .filter { $0.level >= threshold }
            guard !lanes.isEmpty else { continue }
            // Walk through the sounding lanes so a full field rolls instead of droning.
            let beat = crop == .pumpkins ? step / 2 : step
            var picks = [beat % lanes.count]
            if crop != .pumpkins && lanes.count > 1 {
                picks.append((beat + (lanes.count + 1) / 2) % lanes.count)
            }
            for pick in picks {
                notes.append(WindNote(voice: voice, band: lanes[pick].band, level: lanes[pick].level))
            }
        }
        // Stubble is a soft brush on the off-beat, one stroke for the whole slice.
        if !step.isMultiple(of: 2) {
            let level = (coverage[.stubble] ?? []).reduce(0, +) / Double(rows * stepColumns)
            if level >= 0.08 { notes.append(WindNote(voice: .stubble, band: 0, level: level)) }
        }
        return notes
    }

    // Ten lanes span two octaves of a pentatonic scale, so any field is consonant.
    private static let major = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
    private static let minor = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22]

    /// D3, D4, and D5: pumpkins sit low, wheat in the middle, sunflowers on top.
    /// After dark the same lanes play a minor scale.
    public static func frequency(_ crop: Crop, band: Int, night: Bool = false) -> Double {
        let root: Double
        switch crop {
        case .pumpkins: root = 146.83
        case .wheat: root = 293.66
        case .sunflowers: root = 587.33
        }
        let lane = max(0, min(bands - 1, band))
        let semitones = (night ? minor : major)[bands - 1 - lane]
        return root * pow(2, Double(semitones) / 12)
    }

    /// A gentle four-beat pulse, so a long row breathes instead of hammering.
    public static func accent(step: Int) -> Double {
        step.isMultiple(of: 4) ? 1 : step.isMultiple(of: 2) ? 0.75 : 0.55
    }

    /// How far a plant leans, 0 to 1, when it is `behind` metres behind the
    /// gust front: a quick push at the front, then a slow release.
    public static func bend(behind: Double) -> Double {
        let u = behind / gustTrail
        guard u.isFinite, u > 0, u < 1 else { return 0 }
        let rise = min(1, u / 0.22), fall = min(1, (1 - u) / 0.78)
        return rise * rise * (3 - 2 * rise) * fall * fall
    }
}

public struct WindFrame: Equatable, Sendable {
    /// World x of the gust front, or nil between gusts.
    public let front: Double?
    /// Beats the front crossed during this frame.
    public let steps: [Int]
    /// 0 to 1: the gust swelling and fading.
    public let strength: Double
}

/// Schedules gusts on the active-play clock. It rests while the game rests.
public struct Wind {
    private var rest = WindScore.firstRest
    private var elapsed = -1.0
    private var step = 0
    private let random: () -> Double
    /// The field this gust crosses.
    public private(set) var field = FieldBounds.home
    private var next = FieldBounds.home

    public init(random: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.random = random
    }

    public var isGusting: Bool { elapsed >= 0 }
    /// Beats in the current gust.
    public var steps: Int { WindScore.beats(in: field) }

    /// Cross this field from the next gust on. A gust under way finishes where it is.
    public mutating func follow(_ field: FieldBounds) {
        next = field
        if !isGusting { self.field = field }
    }

    /// Begin a gust now, unless one is already crossing.
    public mutating func gust() {
        guard !isGusting else { return }
        field = next
        elapsed = 0
        step = 0
    }

    public mutating func advance(seconds: Double) -> WindFrame {
        let dt = seconds.isFinite ? max(0, seconds) : 0
        if !isGusting {
            rest -= dt
            guard rest <= 0 else { return WindFrame(front: nil, steps: [], strength: 0) }
            gust()
        } else {
            elapsed += dt
        }
        var steps: [Int] = []
        while step < self.steps && Double(step) * WindScore.stepSeconds <= elapsed {
            steps.append(step)
            step += 1
        }
        // Let the bending trail clear the far edge before the gust ends.
        let total = WindScore.gustDuration(in: field) + 3
        if elapsed >= total {
            elapsed = -1
            field = next
            rest = WindScore.minRest + random() * (WindScore.maxRest - WindScore.minRest)
            return WindFrame(front: nil, steps: steps, strength: 0)
        }
        let travelled = elapsed / WindScore.stepSeconds * Double(WindScore.stepColumns) * field.cellSize
        return WindFrame(front: field.minX + travelled, steps: steps,
                         strength: sin(.pi * min(1, elapsed / total)))
    }
}

/// A patch of plants leans by shearing: x' = x + lean * y. An entity transform
/// cannot hold a shear, so the lean is written as rotate, stretch, rotate. Give
/// a parent `outerAngle` and a scale of (`stretch`, 1 / `stretch`, 1), and its
/// child `innerAngle`; both angles turn about +z.
public struct LeanTransform: Equatable, Sendable {
    public let outerAngle: Double
    public let stretch: Double
    public let innerAngle: Double

    public init(lean: Double) {
        let k = lean.isFinite ? lean : 0
        // The larger singular value of [[1, k], [0, 1]]; the other is its inverse.
        stretch = (k + (k * k + 4).squareRoot()) / 2
        outerAngle = atan2(1, stretch)
        innerAngle = -atan2(stretch, 1)
    }
}

public enum PostcardCaption {
    /// "Wheat and pumpkins in the field", from whatever is sown or grown.
    public static func growing(in field: FieldGrid) -> String {
        var present = Set<Crop>()
        for index in field.cells.indices
        where field.cells[index] == Ground.growing.rawValue || field.cells[index] == Ground.mature.rawValue {
            if let crop = field.crop(at: index) { present.insert(crop) }
            if present.count == Crop.allCases.count { break }
        }
        let names = Crop.allCases.filter { present.contains($0) }.enumerated().map { index, crop in
            index == 0 ? crop.title : crop.title.lowercased()
        }
        guard let last = names.last else { return "A quiet meadow, resting" }
        let list = names.count == 1 ? last : "\(names.dropLast().joined(separator: ", ")) and \(last)"
        return "\(list) in the field"
    }
}
