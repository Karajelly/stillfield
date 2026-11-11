import Foundation

/// How the player keeps the light: drifting through the day, or held at one hour.
public enum DayHold: String, Codable, CaseIterable, Sendable {
    case flow, morning, golden, dusk, night

    /// A name this build does not know lets the day drift instead of failing the save.
    public init(from decoder: Decoder) throws {
        self = DayHold(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .flow
    }
}

public enum DayPhase: String, CaseIterable, Sendable {
    case morning, afternoon, golden, dusk, night, dawn
}

/// A slow day that follows active play. It runs on the same clock as the crops,
/// so nothing moves while the game is paused or away. No part of the farming
/// loop reads it: the hour changes the light and the sounds, never the rules.
///
/// Keep the keyframes in sync with src/daylight.ts.
public struct Daylight: Equatable, Sendable {
    public static let daySeconds = 720.0

    public let phase: DayPhase
    /// Colours are sRGB, 0 to 1.
    public let sun: SIMD3<Double>
    public let sunPower: Double
    /// Unit vector from the meadow towards the sun or moon.
    public let sunFrom: SIMD3<Double>
    public let shadow: Double
    public let skyLight: SIMD3<Double>
    public let groundLight: SIMD3<Double>
    public let ambient: Double
    public let sky: SIMD3<Double>
    public let exposure: Double
    /// 0 in daylight, 1 once lamps, windows, and fireflies are fully lit.
    public let glow: Double
    /// Birdsong: 1 through the day, 0 at night, a little more at first light.
    public let birds: Double
    /// Native only: how far the sky's bounce light has turned from cream to gold.
    public let warmth: Double
    /// Native only: how far the gold has turned to moonlight. Only above zero
    /// while `warmth` is 1, so the app blends at most two environments at once.
    public let moon: Double

    /// Wrap any saved or accumulated value into one day. Bad input is morning.
    public static func wrap(_ seconds: Double) -> Double {
        guard seconds.isFinite else { return 0 }
        let remainder = seconds.truncatingRemainder(dividingBy: daySeconds)
        return (remainder + daySeconds).truncatingRemainder(dividingBy: daySeconds)
    }

    /// The moment a held light keeps, in seconds into the day. Drifting has none.
    public static func holdSeconds(_ hold: DayHold) -> Double? {
        switch hold {
        case .flow: nil
        case .morning: 0
        case .golden: 0.5 * daySeconds
        case .dusk: 0.64 * daySeconds
        case .night: 0.81 * daySeconds
        }
    }

    public static func phase(at seconds: Double) -> DayPhase {
        let p = wrap(seconds) / daySeconds
        if p < 0.14 || p >= 0.985 { return .morning }
        if p < 0.41 { return .afternoon }
        if p < 0.6 { return .golden }
        if p < 0.71 { return .dusk }
        if p < 0.915 { return .night }
        return .dawn
    }

    /// The line of weather shown beside the sun or moon, and on postcards.
    public static func copy(for phase: DayPhase) -> (title: String, detail: String) {
        switch phase {
        case .morning: ("A slow summer morning", "76° · a gentle breeze")
        case .afternoon: ("A long, easy afternoon", "81° · a gentle breeze")
        case .golden: ("A little golden hour", "76° · a gentle breeze")
        case .dusk: ("A soft pink dusk", "70° · crickets tuning up")
        case .night: ("A quiet, bright night", "64° · fireflies by the pond")
        case .dawn: ("First light", "62° · dew on the rows")
        }
    }

    public static func at(_ seconds: Double) -> Daylight {
        let p = wrap(seconds) / daySeconds
        var index = 0
        while index < keys.count - 2 && keys[index + 1].at <= p { index += 1 }
        let a = keys[index], b = keys[index + 1]
        let linear = (p - a.at) / (b.at - a.at)
        // Ease each stretch so the light never visibly changes speed.
        let t = linear * linear * (3 - 2 * linear)
        func mix(_ from: Double, _ to: Double) -> Double { from + (to - from) * t }
        func blend(_ from: UInt32, _ to: UInt32) -> SIMD3<Double> {
            let start = rgb(from), end = rgb(to)
            return start + (end - start) * t
        }
        let from = a.sunFrom + (b.sunFrom - a.sunFrom) * t
        let length = (from.x * from.x + from.y * from.y + from.z * from.z).squareRoot()
        return Daylight(
            phase: phase(at: seconds),
            sun: blend(a.sun, b.sun),
            sunPower: mix(a.sunPower, b.sunPower),
            sunFrom: from / length,
            shadow: mix(a.shadow, b.shadow),
            skyLight: blend(a.skyLight, b.skyLight),
            groundLight: blend(a.groundLight, b.groundLight),
            ambient: mix(a.ambient, b.ambient),
            sky: blend(a.sky, b.sky),
            exposure: mix(a.exposure, b.exposure),
            glow: mix(a.glow, b.glow),
            birds: mix(a.birds, b.birds),
            warmth: mix(a.warmth, b.warmth),
            moon: mix(a.moon, b.moon)
        )
    }

    private struct Key: Sendable {
        var at = 0.0
        var sun: UInt32 = 0xfff1ce
        var sunPower = 3.1
        var sunFrom = SIMD3<Double>(-32, 55, 22)
        var shadow = 1.0
        var skyLight: UInt32 = 0xfff8df
        var groundLight: UInt32 = 0x7c9060
        var ambient = 2.5
        var sky: UInt32 = 0xe8ecda
        var exposure = 1.1
        var glow = 0.0
        var birds = 1.0
        var warmth = 0.0
        var moon = 0.0

        func with(_ change: (inout Key) -> Void) -> Key {
            var copy = self
            change(&copy)
            return copy
        }
    }

    private static func rgb(_ hex: UInt32) -> SIMD3<Double> {
        SIMD3(Double((hex >> 16) & 0xff), Double((hex >> 8) & 0xff), Double(hex & 0xff)) / 255
    }

    // The first and last entries match, so the day closes into a loop.
    private static let keys: [Key] = {
        let morning = Key()
        let afternoon = morning.with {
            $0.sun = 0xfff4d8; $0.sunPower = 3.2; $0.skyLight = 0xfffbe8; $0.ambient = 2.55; $0.sky = 0xe9eedd
        }
        let golden = morning.with {
            $0.sun = 0xffd299; $0.sunPower = 3.3; $0.skyLight = 0xffe3bb; $0.groundLight = 0x86895c
            $0.ambient = 2.0; $0.sky = 0xeee5ce; $0.warmth = 1
        }
        let night = Key(
            sun: 0xa9bdf0, sunPower: 0.95, sunFrom: SIMD3(-18, 60, -30), shadow: 0.6,
            skyLight: 0x7f95c4, groundLight: 0x33424d, ambient: 1.0, sky: 0x36465f,
            exposure: 1.05, glow: 1, birds: 0, warmth: 1, moon: 1
        )
        return [
            morning,
            afternoon.with { $0.at = 0.2; $0.sunFrom = SIMD3(-20, 64, 6) },
            afternoon.with { $0.at = 0.36; $0.sunFrom = SIMD3(-30, 56, -2) },
            golden.with { $0.at = 0.46; $0.sunFrom = SIMD3(-52, 30, -6) },
            golden.with { $0.at = 0.56; $0.sun = 0xffc487; $0.sunPower = 3.1; $0.sunFrom = SIMD3(-56, 22, -10) },
            Key(at: 0.64, sun: 0xf6a88c, sunPower: 2.3, sunFrom: SIMD3(-58, 15, -16), shadow: 0.8,
                skyLight: 0xf0cfc8, groundLight: 0x6f7669, ambient: 1.9, sky: 0xe8c9c4,
                exposure: 1.1, glow: 0.7, birds: 0.25, warmth: 1, moon: 0.2),
            Key(at: 0.705, sun: 0x8fa6dc, sunPower: 0.55, sunFrom: SIMD3(-40, 36, -26), shadow: 0.4,
                skyLight: 0x8ea2cc, groundLight: 0x3f4c58, ambient: 1.15, sky: 0x5b6a86,
                exposure: 1.05, glow: 1, birds: 0, warmth: 1, moon: 0.85),
            night.with { $0.at = 0.74 },
            night.with { $0.at = 0.89 },
            Key(at: 0.915, sun: 0x9fb0d8, sunPower: 0.5, sunFrom: SIMD3(-36, 34, 6), shadow: 0.25,
                skyLight: 0x9fb0cf, groundLight: 0x46555a, ambient: 1.25, sky: 0x6f7f96,
                exposure: 1.05, glow: 0.8, birds: 0.5, warmth: 1, moon: 0.55),
            Key(at: 0.96, sun: 0xffc9a8, sunPower: 2.0, sunFrom: SIMD3(-50, 18, 34), shadow: 0.7,
                skyLight: 0xf6d9cf, groundLight: 0x74856a, ambient: 1.9, sky: 0xead6cc,
                exposure: 1.1, glow: 0.15, birds: 1.5, warmth: 1, moon: 0),
            morning.with { $0.at = 1 },
        ]
    }()
}
