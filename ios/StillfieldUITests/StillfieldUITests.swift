import XCTest

@MainActor
final class StillfieldUITests: XCTestCase {
    private let meadowControlIdentifiers = [
        "tool.mow", "tool.till", "tool.sow", "tool.wander",
        "action.pause", "action.sound", "action.settings", "action.help",
        "Zoom out", "Center the farm", "Zoom in"
    ]

    func testNativeToolsSettingsAndPause() throws {
        let app = launchFreshMeadow()
        defer { app.terminate() }
        app.buttons["tool.sow"].tap()
        XCTAssertTrue(app.buttons["tool.sow"].isSelected)
        app.buttons["action.pause"].tap()
        XCTAssertTrue(app.buttons["pause.resume"].waitForExistence(timeout: 3))
        attachScreenshot("A moment to breathe", app: app)
        app.buttons["pause.resume"].tap()
        app.buttons["action.settings"].tap()
        XCTAssertTrue(app.switches["settings.golden"].waitForExistence(timeout: 3))
        attachScreenshot("Native settings", app: app)
        app.switches["settings.golden"].tap()
        dismissSheetAndWait(in: app)
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["tool.sow"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.buttons["tool.sow"].isSelected)
        app.buttons["action.settings"].tap()
        XCTAssertEqual(app.switches["settings.golden"].value as? String, "1")
        attachScreenshot("Settings restored after relaunch", app: app)
    }

    func testTouchSteeringPaintAndBackgroundLifecycle() throws {
        let app = launchFreshMeadow()
        defer { app.terminate() }
        let surface = meadowSurface(in: app)
        app.buttons["tool.sow"].tap()
        let initial = try XCTUnwrap(telemetry(in: app))

        // A real touch lands in the central meadow. No test hook steers the tractor.
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.33, dy: 0.51)).tap()
        XCTAssertTrue(waitUntil(timeout: 12) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: initial) > 0.6 && current.painted > initial.painted
        }, "Touch steering must move the tractor and change field cells.")
        attachScreenshot("Wildflowers after touch steering", app: app)

        let beforeDrag = try XCTUnwrap(telemetry(in: app))
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.43, dy: 0.49))
        let finish = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.60, dy: 0.49))
        start.press(forDuration: 0.1, thenDragTo: finish)
        XCTAssertTrue(waitUntil(timeout: 12) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: beforeDrag) > 0.6 && current.painted > beforeDrag.painted
        }, "Dragging must continue steering and painting.")

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(waitUntil(timeout: 5) {
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        })
        app.activate()
        XCTAssertTrue(app.buttons["tool.sow"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["tool.sow"].isSelected)
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.speed == 0 },
                      "Leaving the app must stop the tractor.")
        let resumed = try XCTUnwrap(telemetry(in: app))
        let observationEnds = Date().addingTimeInterval(1.2)
        XCTAssertTrue(waitUntil(timeout: 3) { Date() >= observationEnds })
        let settled = try XCTUnwrap(telemetry(in: app))
        XCTAssertLessThanOrEqual(settled.distance(from: resumed), 0.02,
                                 "Returning must not resume an old steering destination.")
        XCTAssertEqual(settled.painted, resumed.painted,
                       "The field must stay still until the player steers again.")
        attachScreenshot("Meadow after background and foreground", app: app)

        app.buttons["tool.wander"].tap()
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.54)).tap()
        XCTAssertTrue(waitUntil(timeout: 12) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: settled) > 0.6
        })
        XCTAssertEqual(try XCTUnwrap(telemetry(in: app)).painted, settled.painted,
                       "Wandering must move the tractor without altering the meadow.")
        attachScreenshot("Just wandering", app: app)
    }

    func testPortraitLandscapeAndZoomControls() throws {
        let app = launchFreshMeadow()
        defer {
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }
        waitForMeadowLayout(in: app, portrait: true)
        assertControlsReachable(in: app)
        attachScreenshot("Portrait meadow", app: app)

        app.buttons["Zoom in"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { (self.telemetry(in: app)?.zoom ?? 0) > 1.1 })
        attachScreenshot("Closer look", app: app)
        app.buttons["Center the farm"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.zoom == 1 })

        meadowSurface(in: app).pinch(withScale: 1.3, velocity: 1)
        XCTAssertTrue(waitUntil(timeout: 5) { (self.telemetry(in: app)?.zoom ?? 0) > 1.1 },
                      "Pinching the meadow must change the native camera zoom.")
        let pinchedZoom = try XCTUnwrap(telemetry(in: app)).zoom
        app.buttons["Zoom out"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { (self.telemetry(in: app)?.zoom ?? 2) < pinchedZoom })
        app.buttons["Center the farm"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.zoom == 1 })

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForMeadowLayout(in: app, portrait: false)
        assertControlsReachable(in: app)
        attachScreenshot("Landscape meadow", app: app)

        app.buttons["action.help"].tap()
        XCTAssertTrue(app.buttons["sheet.close"].waitForExistence(timeout: 3))
        attachScreenshot("Native help in landscape", app: app)
        dismissSheetAndWait(in: app)

        XCUIDevice.shared.orientation = .portrait
        waitForMeadowLayout(in: app, portrait: true)
        assertControlsReachable(in: app)
        XCTAssertTrue(app.buttons["tool.mow"].isSelected)
        attachScreenshot("Portrait restored after rotation", app: app)
    }

    func testTapRetargetingAndSteeringAfterPinch() throws {
        let app = launchFreshMeadow()
        defer { app.terminate() }
        app.buttons["tool.wander"].tap()
        let surface = meadowSurface(in: app)
        let right = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.47))
        let left = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.32, dy: 0.52))
        let initial = try XCTUnwrap(telemetry(in: app))

        right.tap()
        let first = try waitForSteering(after: initial.steeringCount, in: app)
        let firstDestination = try XCTUnwrap(first.destination)

        // Retap while the tractor is still travelling. The newest touch must
        // replace its destination, rather than wait for the old trip to finish.
        left.tap()
        let second = try waitForSteering(after: first.steeringCount, in: app)
        let secondDestination = try XCTUnwrap(second.destination)
        XCTAssertGreaterThan(secondDestination.distance(from: firstDestination), 8,
                             "A tap across the meadow must immediately replace the previous destination.")

        right.tap()
        let third = try waitForSteering(after: second.steeringCount, in: app)
        let thirdDestination = try XCTUnwrap(third.destination)
        XCTAssertLessThan(thirdDestination.distance(from: firstDestination), 0.15,
                          "Returning to the same screen point must restore that destination, even while moving.")
        attachScreenshot("Visible destination marker after retapping", app: app)

        surface.pinch(withScale: 1.3, velocity: 1)
        XCTAssertTrue(waitUntil(timeout: 5) { (self.telemetry(in: app)?.zoom ?? 0) > 1.1 })
        let pinched = try XCTUnwrap(telemetry(in: app))
        left.tap()
        let resumed = try waitForSteering(after: pinched.steeringCount, in: app)
        XCTAssertTrue(resumed.markerVisible,
                      "A completed pinch must release steering and show the next tap's destination.")
        XCTAssertTrue(waitUntil(timeout: 8) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: resumed) > 0.6
        }, "The tractor must drive toward a new tap after pinching, without another gesture to unstick it.")
        attachScreenshot("Steering resumes after pinching", app: app)
    }

    private func waitForSteering(after count: Int, in app: XCUIApplication,
                                 file: StaticString = #filePath, line: UInt = #line) throws -> Telemetry {
        var accepted: Telemetry?
        let received = waitUntil(timeout: 3) {
            guard let current = self.telemetry(in: app), current.steeringCount > count,
                  current.destination != nil, current.markerVisible else { return false }
            accepted = current
            return true
        }
        let surface = meadowSurface(in: app)
        let diagnostics = "Expected steeringCount > \(count); surface frame=\(surface.frame); "
            + "surface value=\(String(describing: surface.value)); app frame=\(app.frame)."
        if !received {
            attachScreenshot("Unaccepted meadow tap", app: app)
            let snapshot = XCTAttachment(string: diagnostics + "\n\n" + app.debugDescription)
            snapshot.name = "Unaccepted tap telemetry and accessibility tree"
            snapshot.lifetime = .keepAlways
            add(snapshot)
        }
        XCTAssertTrue(received, "A meadow tap must be accepted with a destination and visible marker. \(diagnostics)",
                      file: file, line: line)
        return try XCTUnwrap(accepted, file: file, line: line)
    }

    private func launchFreshMeadow() -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--fresh-meadow"]
        app.launch()
        XCTAssertTrue(app.buttons["tool.mow"].waitForExistence(timeout: 40))
        if app.buttons["action.begin"].exists {
            attachScreenshot("Welcome to Willowbrook", app: app)
            app.buttons["action.begin"].tap()
        }
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app) != nil },
                      "Debug UI-test telemetry must be available on the native meadow surface.")
        return app
    }

    private func assertControlsReachable(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        for identifier in meadowControlIdentifiers {
            let control = app.buttons[identifier]
            XCTAssertTrue(control.isHittable, "\(identifier) must remain tappable after layout changes.", file: file, line: line)
            XCTAssertGreaterThanOrEqual(control.frame.width, 43.5, file: file, line: line)
            XCTAssertGreaterThanOrEqual(control.frame.height, 43.5, file: file, line: line)
            XCTAssertTrue(app.frame.contains(control.frame), "\(identifier) must stay inside the visible screen.", file: file, line: line)
        }
    }

    private func dismissSheetAndWait(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        app.buttons["sheet.close"].tap()
        XCTAssertTrue(waitUntil(timeout: 8) {
            !app.buttons["sheet.close"].exists && app.buttons["tool.mow"].isHittable
        }, "The sheet must finish dismissing before another layout transition begins.", file: file, line: line)
    }

    private func waitForMeadowLayout(in app: XCUIApplication, portrait: Bool, file: StaticString = #filePath, line: UInt = #line) {
        var previousFrames: [CGRect] = []
        var stableSince: Date?
        let settled = waitUntil(timeout: 12) {
            let screen = app.frame
            guard (portrait ? screen.height > screen.width : screen.width > screen.height),
                  !app.buttons["sheet.close"].exists else {
                stableSince = nil
                return false
            }

            var frames = [screen]
            for identifier in self.meadowControlIdentifiers {
                let control = app.buttons[identifier]
                guard control.exists else {
                    stableSince = nil
                    return false
                }
                let frame = control.frame
                guard frame.width >= 43.5, frame.height >= 43.5, screen.contains(frame) else {
                    stableSince = nil
                    return false
                }
                frames.append(frame)
            }

            // The application frame reports its new orientation before the
            // sheet and SwiftUI control animations have necessarily finished.
            // Require two stable, fully usable layouts before asserting it.
            if frames != previousFrames {
                previousFrames = frames
                stableSince = Date()
                return false
            }
            guard let since = stableSince else {
                stableSince = Date()
                return false
            }
            guard Date().timeIntervalSince(since) >= 0.4 else { return false }
            // Asking UIKit for an activation point during a rotation can throw
            // before it has valid bounds. Check hittability after frames settle.
            return self.meadowControlIdentifiers.allSatisfy { app.buttons[$0].isHittable }
        }
        if !settled { attachScreenshot("Unsettled \(portrait ? "portrait" : "landscape") layout", app: app) }
        XCTAssertTrue(settled, "The \(portrait ? "portrait" : "landscape") meadow must settle with every control visible, tappable, and at least 44 points.", file: file, line: line)
    }

    private func meadowSurface(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ AND value CONTAINS %@", "farm.surface", "x="))
            .firstMatch
    }

    private func telemetry(in app: XCUIApplication) -> Telemetry? {
        let surface = meadowSurface(in: app)
        guard surface.exists, let value = surface.value as? String else { return nil }
        let entries = value.split(separator: ",").compactMap { item -> (String, Double)? in
            let pair = item.split(separator: "=", maxSplits: 1)
            guard pair.count == 2, let number = Double(pair[1]) else { return nil }
            return (String(pair[0]), number)
        }
        let values = Dictionary(entries, uniquingKeysWith: { _, new in new })
        guard let x = values["x"], let z = values["z"], let speed = values["speed"],
              let painted = values["painted"], let zoom = values["zoom"],
              let steeringCount = values["steeringCount"], steeringCount.isFinite,
              let marker = values["marker"] else { return nil }
        let destination: Destination?
        if let targetX = values["targetX"], targetX.isFinite,
           let targetZ = values["targetZ"], targetZ.isFinite {
            destination = Destination(x: targetX, z: targetZ)
        } else {
            destination = nil
        }
        return Telemetry(x: x, z: z, speed: speed, painted: Int(painted), zoom: zoom,
                         steeringCount: Int(steeringCount), destination: destination, markerVisible: marker == 1)
    }

    private func waitUntil(timeout: TimeInterval, condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        return condition()
    }

    private func attachScreenshot(_ name: String, app _: XCUIApplication) {
        // Capture the display after rotation; application-window screenshots
        // can retain a portrait crop on the iOS simulator during transitions.
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private struct Telemetry {
        let x: Double
        let z: Double
        let speed: Double
        let painted: Int
        let zoom: Double
        let steeringCount: Int
        let destination: Destination?
        let markerVisible: Bool

        func distance(from other: Telemetry) -> Double {
            hypot(x - other.x, z - other.z)
        }
    }

    private struct Destination {
        let x: Double
        let z: Double

        func distance(from other: Destination) -> Double {
            hypot(x - other.x, z - other.z)
        }
    }
}
