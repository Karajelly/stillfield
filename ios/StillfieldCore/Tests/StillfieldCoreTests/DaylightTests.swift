import Foundation
import Testing
@testable import StillfieldCore

private func near(_ a: Double, _ b: Double, _ tolerance: Double = 1e-9) -> Bool { abs(a - b) <= tolerance }

@Test func theDayOpensOnTheOriginalMorningLight() {
    let morning = Daylight.at(0)
    #expect(morning.phase == .morning)
    #expect(morning.sunPower == 3.1 && morning.ambient == 2.5 && morning.glow == 0)
    #expect(morning.warmth == 0 && morning.moon == 0)
    #expect((morning.sky * 255).rounded(.toNearestOrEven) == SIMD3(0xe8, 0xec, 0xda))
    #expect((morning.sun * 255).rounded(.toNearestOrEven) == SIMD3(0xff, 0xf1, 0xce))
}

@Test func goldenHourKeepsTheOriginalGoldenLight() throws {
    let golden = Daylight.at(try #require(Daylight.holdSeconds(.golden)))
    #expect(golden.phase == .golden)
    #expect(near(golden.ambient, 2.0) && golden.glow == 0 && golden.warmth == 1 && golden.moon == 0)
    #expect((golden.skyLight * 255).rounded(.toNearestOrEven) == SIMD3(0xff, 0xe3, 0xbb))
    #expect((golden.sky * 255).rounded(.toNearestOrEven) == SIMD3(0xee, 0xe5, 0xce))
}

@Test func theDayClosesIntoALoopWithNoJump() {
    let first = Daylight.at(0), last = Daylight.at(Daylight.daySeconds - 0.001)
    #expect(near(first.sunPower, last.sunPower, 0.001) && near(first.ambient, last.ambient, 0.001))
    #expect(near(first.glow, last.glow, 0.001) && near(first.birds, last.birds, 0.001))
    #expect(Daylight.at(Daylight.daySeconds) == first)
    #expect(Daylight.at(-Daylight.daySeconds) == first)
}

@Test func theLightNeverChangesAbruptlyFromOneSecondToTheNext() {
    var before = Daylight.at(0)
    for second in 1...Int(Daylight.daySeconds) {
        let now = Daylight.at(Double(second))
        #expect(abs(now.sunPower - before.sunPower) < 0.12, "sun at \(second)")
        #expect(abs(now.ambient - before.ambient) < 0.06, "ambient at \(second)")
        #expect(abs(now.glow - before.glow) < 0.06, "glow at \(second)")
        #expect(abs(now.moon - before.moon) < 0.06, "moon at \(second)")
        let sky = now.sky - before.sky
        #expect(max(abs(sky.x), abs(sky.y), abs(sky.z)) < 0.03, "sky at \(second)")
        before = now
    }
}

@Test func theSunOrMoonStaysAboveTheMeadowAndEveryValueStaysInRange() {
    for second in stride(from: 0.0, to: Daylight.daySeconds, by: 3) {
        let now = Daylight.at(second)
        #expect(now.sunFrom.y > 0.2, "height at \(second)")
        let length = (now.sunFrom * now.sunFrom).sum().squareRoot()
        #expect(near(length, 1))
        #expect((0...1).contains(now.glow) && now.birds >= 0)
        #expect(now.shadow > 0 && now.shadow <= 1)
        for color in [now.sun, now.sky, now.skyLight, now.groundLight] {
            #expect(color.min() >= 0 && color.max() <= 1)
        }
        // A bright night: it is never too dark to see the rows.
        #expect(now.ambient >= 1)
        // The app blends two environments at a time: cream to gold, or gold to moonlight.
        #expect((0...1).contains(now.warmth) && (0...1).contains(now.moon))
        if now.moon > 0 { #expect(now.warmth == 1, "moonlight before gold at \(second)") }
    }
}

@Test func theDayPassesThroughEveryPartInOrder() {
    var seen: [DayPhase] = []
    for second in 0..<Int(Daylight.daySeconds) {
        let phase = Daylight.phase(at: Double(second))
        if seen.last != phase { seen.append(phase) }
    }
    #expect(seen == [.morning, .afternoon, .golden, .dusk, .night, .dawn, .morning])
    for phase in DayPhase.allCases {
        let copy = Daylight.copy(for: phase)
        #expect(!copy.title.isEmpty && !copy.detail.isEmpty)
    }
}

@Test func lampsLightOnlyAfterDarkAndTheBirdsGoQuiet() throws {
    let night = Daylight.at(try #require(Daylight.holdSeconds(.night)))
    #expect(night.glow == 1 && night.birds == 0 && night.moon == 1)
    let dusk = Daylight.at(try #require(Daylight.holdSeconds(.dusk)))
    #expect(dusk.glow > 0.5 && dusk.glow < 1)
    // Birdsong is a little fuller at first light than through the day.
    #expect(Daylight.at(0.96 * Daylight.daySeconds).birds > 1)
}

@Test func eachHeldLightSitsInsideItsOwnPartOfTheDay() throws {
    #expect(Daylight.holdSeconds(.flow) == nil)
    for hold in DayHold.allCases where hold != .flow {
        let seconds = try #require(Daylight.holdSeconds(hold))
        #expect(Daylight.phase(at: seconds).rawValue == hold.rawValue)
    }
}

@Test func aDamagedSavedHourIsMorning() {
    #expect(Daylight.wrap(.nan) == 0)
    #expect(Daylight.wrap(.infinity) == 0)
    #expect(Daylight.wrap(Daylight.daySeconds + 5) == 5)
    #expect(Daylight.wrap(-5) == Daylight.daySeconds - 5)
    #expect(Daylight.wrap(Daylight.daySeconds) == 0)
}
