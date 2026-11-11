import XCTest

@MainActor
final class StillfieldUITests: XCTestCase {
    private let meadowControlIdentifiers = [
        "tool.harvest", "tool.cultivate", "tool.sow", "tool.wander",
        "action.postcard", "action.pause", "action.sound", "action.settings",
        "action.camera",
        "Zoom out", "Center the farm", "Zoom in"
    ]

    func testHarvestSowGrowthAndDisplayPersistenceThroughRealTouches() throws {
        let app = launchFreshMeadow(fastCrops: true)
        defer { app.terminate() }
        let surface = meadowSurface(in: app)
        func drive(_ x: CGFloat, _ y: CGFloat) throws {
            let before = try XCTUnwrap(telemetry(in: app))
            surface.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
            _ = try waitForSteering(after: before.steeringCount, in: app)
            XCTAssertTrue(waitUntil(timeout: 25) {
                guard let now = self.telemetry(in: app) else { return false }
                return now.speed == 0 && now.destination == nil
            })
            revealControls(in: app)
        }
        try drive(0.48, 0.45)
        XCTAssertGreaterThan(farmingValue("wheatDisplay", in: app), 0, "The starter patch must reward harvesting immediately.")
        attachScreenshot("First wheat harvest and wheelbarrow", app: app)

        app.buttons["tool.cultivate"].tap()
        try drive(0.48, 0.52)
        try drive(0.41, 0.43)
        app.buttons["tool.sow"].tap()
        assertCropChoicesReachable(in: app)
        app.buttons["crop.sunflowers"].tap()
        XCTAssertTrue(app.buttons["crop.sunflowers"].isSelected)
        try drive(0.48, 0.52)
        XCTAssertGreaterThan(farmingValue("growing", in: app), 0)
        attachScreenshot("Freshly sown sunflowers and crop buttons", app: app)
        XCTAssertTrue(waitUntil(timeout: 60) { self.farmingValue("growing", in: app) == 0 })
        revealControls(in: app)
        attachScreenshot("Sunflowers after active play", app: app)
        app.buttons["tool.harvest"].tap()
        try drive(0.41, 0.43)
        XCTAssertGreaterThan(farmingValue("sunflowerDisplay", in: app), 0)
        attachScreenshot("Sunflower pots beside the wheat harvest", app: app)
        let wheat = farmingValue("wheatDisplay", in: app), flowers = farmingValue("sunflowerDisplay", in: app)
        app.buttons["action.pause"].tap()
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["tool.harvest"].waitForExistence(timeout: 40))
        XCTAssertEqual(farmingValue("wheatDisplay", in: app), wheat)
        XCTAssertEqual(farmingValue("sunflowerDisplay", in: app), flowers)
        app.buttons["tool.sow"].tap()
        XCTAssertTrue(app.buttons["crop.sunflowers"].isSelected)
        XCTAssertFalse(app.buttons["farming.rest"].exists)
        XCTAssertFalse(app.buttons["farming.meadow"].exists)
    }

    func testPumpkinsGrowAndFillTheirCart() throws {
        let app = launchFreshMeadow(fastCrops: true)
        defer { app.terminate() }
        let surface = meadowSurface(in: app)
        func drive(_ x: CGFloat, _ y: CGFloat) throws {
            let before = try XCTUnwrap(telemetry(in: app))
            surface.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
            _ = try waitForSteering(after: before.steeringCount, in: app)
            XCTAssertTrue(waitUntil(timeout: 25) {
                guard let now = self.telemetry(in: app) else { return false }
                return now.speed == 0 && now.destination == nil
            })
            revealControls(in: app)
        }
        app.buttons["tool.cultivate"].tap()
        try drive(0.48, 0.52)
        try drive(0.41, 0.43)
        app.buttons["tool.sow"].tap()
        app.buttons["crop.pumpkins"].tap()
        XCTAssertTrue(app.buttons["crop.pumpkins"].isSelected)
        try drive(0.48, 0.52)
        XCTAssertGreaterThan(farmingValue("growing", in: app), 0)
        attachScreenshot("Freshly sown pumpkins and crop buttons", app: app)
        XCTAssertTrue(waitUntil(timeout: 60) { self.farmingValue("growing", in: app) == 0 })
        revealControls(in: app)
        app.buttons["tool.harvest"].tap()
        try drive(0.41, 0.43)
        XCTAssertGreaterThan(farmingValue("pumpkinDisplay", in: app), 0)
        XCTAssertEqual(farmingValue("wheatDisplay", in: app), 0)
        XCTAssertEqual(farmingValue("sunflowerDisplay", in: app), 0)
        attachScreenshot("Pumpkins and their wooden cart", app: app)
    }

    private func farmingValue(_ key: String, in app: XCUIApplication) -> Int {
        let text = meadowSurface(in: app).value as? String ?? ""
        let pair = text.split(separator: ",").first { $0.hasPrefix(key + "=") }
        return pair.flatMap { Int($0.split(separator: "=").last ?? "") } ?? -1
    }

    func testTractorDragReleaseStopsTurningAndPinchAllowsANewTap() throws {
        let app = launchFreshMeadow()
        defer { app.terminate() }
        app.buttons["action.camera"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.tractorView == true })
        let surface = meadowSurface(in: app)
        let before = try XCTUnwrap(telemetry(in: app))
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.42, dy: 0.51))
        let finish = start.withOffset(CGVector(dx: 95, dy: 0))
        start.press(forDuration: 0.35, thenDragTo: finish, withVelocity: .slow, thenHoldForDuration: 0.6)
        XCTAssertTrue(waitUntil(timeout: 3) { self.telemetry(in: app)?.speed == 0 })
        let released = try XCTUnwrap(telemetry(in: app))
        XCTAssertGreaterThan(released.distance(from: before), 0.2)
        XCTAssertGreaterThan(abs(released.heading - before.heading), 0.05)
        XCTAssertNil(released.destination)
        let restingUntil = Date().addingTimeInterval(1.5)
        XCTAssertTrue(waitUntil(timeout: 3) { Date() >= restingUntil })
        let resting = try XCTUnwrap(telemetry(in: app))
        XCTAssertEqual(resting.heading, released.heading, accuracy: 0.002)
        XCTAssertLessThan(resting.distance(from: released), 0.01)
        surface.pinch(withScale: 1.2, velocity: 1)
        let afterPinch = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.56, dy: 0.49)).tap()
        _ = try waitForSteering(after: afterPinch.steeringCount, in: app)
        XCTAssertTrue(waitUntil(timeout: 6) {
            guard let now = self.telemetry(in: app) else { return false }
            return now.distance(from: afterPinch) > 0.4
        })
        attachScreenshot("Calm drag release and tap after pinch", app: app)
    }

    func testControlsTuckAwayAndCanBeRecalledWhileDriving() throws {
        let app = launchFreshMeadow()
        defer {
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }
        let surface = meadowSurface(in: app)
        let initial = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.47)).tap()
        _ = try waitForSteering(after: initial.steeringCount, in: app)
        XCTAssertTrue(app.buttons["tool.harvest"].exists, "Menus should remain during the copy fade.")
        let recall = app.buttons["action.controls"]
        XCTAssertTrue(waitUntil(timeout: 6) { recall.label == "Show controls" })
        XCTAssertTrue(waitUntil(timeout: 3) {
            !app.buttons["tool.harvest"].exists && !app.buttons["action.settings"].exists
        }, "Dismissing menus must leave the accessibility tree.")
        let automaticExitEnd = Date().addingTimeInterval(0.9)
        XCTAssertTrue(waitUntil(timeout: 3) { Date() >= automaticExitEnd })

        let hidden = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.32, dy: 0.52)).tap()
        _ = try waitForSteering(after: hidden.steeringCount, in: app)
        XCTAssertTrue(waitUntil(timeout: 5) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: hidden) > 0.6
        }, "Steering must work while the controls are tucked away.")
        attachScreenshot("Quiet meadow with recall button", app: app)

        revealControls(in: app)
        assertControlsReachable(in: app)
        let recalled = try XCTUnwrap(telemetry(in: app))
        XCTAssertNotNil(recalled.destination, "Recalling menus must not stop the current drive.")
        app.buttons["tool.sow"].tap()
        let adjustmentsEnd = Date().addingTimeInterval(3.5)
        XCTAssertTrue(waitUntil(timeout: 5) { Date() >= adjustmentsEnd })
        XCTAssertTrue(app.buttons["tool.sow"].isHittable, "Recalled controls stay open until the next steering gesture.")
        attachScreenshot("Controls recalled without decorative copy", app: app)

        recall.tap()
        XCTAssertTrue(waitUntil(timeout: 3) {
            recall.label == "Show controls" && !app.buttons["tool.sow"].exists
        }, "Manual dismissal must remove hidden controls from accessibility.")
        // Accessibility disappears before the slide completes; let the full exit play.
        let manualExitEnd = Date().addingTimeInterval(0.9)
        XCTAssertTrue(waitUntil(timeout: 3) { Date() >= manualExitEnd })
        attachScreenshot("Quiet meadow after manual dismissal", app: app)
        revealControls(in: app)
        XCTAssertTrue(app.buttons["tool.sow"].isSelected)

        let beforeSteering = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.60, dy: 0.50)).tap()
        _ = try waitForSteering(after: beforeSteering.steeringCount, in: app)
        XCTAssertTrue(waitUntil(timeout: 5) { recall.label == "Show controls" })
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(waitUntil(timeout: 10) {
            app.frame.width > app.frame.height && recall.isHittable && app.frame.contains(recall.frame)
        })
        attachScreenshot("Quiet landscape with recall button", app: app)
        revealControls(in: app)
        waitForMeadowLayout(in: app, portrait: false)
        assertControlsReachable(in: app)
        app.buttons["action.pause"].tap()
        XCTAssertTrue(app.buttons["pause.resume"].waitForExistence(timeout: 3))
        app.buttons["pause.resume"].tap()
        XCTAssertTrue(app.buttons["tool.sow"].isHittable)
    }

    func testTractorViewFollowsDrivingZoomsAndRestores() throws {
        let app = launchFreshMeadow()
        defer {
            XCUIDevice.shared.orientation = .portrait
            app.terminate()
        }
        app.buttons["Zoom in"].tap()
        let overviewZoom = try XCTUnwrap(telemetry(in: app)).zoom
        let surface = meadowSurface(in: app)
        let initial = try XCTUnwrap(telemetry(in: app))
        app.buttons["tool.cultivate"].tap()
        // Leave enough open meadow ahead to switch views during the drive,
        // including the time accessibility needs to locate the camera button.
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.40)).tap()
        _ = try waitForSteering(after: initial.steeringCount, in: app)
        revealControls(in: app)
        app.buttons["action.camera"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.tractorView == true })
        XCTAssertTrue(app.buttons["action.camera"].isSelected)
        XCTAssertEqual(try XCTUnwrap(telemetry(in: app)).zoom, 0.65,
                       "Tractor view starts at its widest zoom independently of overview.")
        let following = try XCTUnwrap(telemetry(in: app))
        XCTAssertGreaterThan(following.cameraY, 10)
        XCTAssertLessThan(following.cameraY, 20)
        XCTAssertTrue(waitUntil(timeout: 8) {
            guard let now = self.telemetry(in: app) else { return false }
            return now.distance(from: following) > 0.5 && now.cameraDistance(from: following) > 0.5
        }, "Changing view during a drive must keep the tractor moving and the camera following.")
        attachScreenshot("Behind the tractor in portrait", app: app)

        let beforeTap = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.57, dy: 0.48)).tap()
        let steering = try waitForSteering(after: beforeTap.steeringCount, in: app)
        let destination = try XCTUnwrap(steering.destination)
        XCTAssertGreaterThan((destination.x - beforeTap.x) * sin(beforeTap.heading)
                             + (destination.z - beforeTap.z) * cos(beforeTap.heading), 0,
                             "Ground ahead on screen must steer ahead of the tractor.")
        XCTAssertTrue(waitUntil(timeout: 8) {
            guard let now = self.telemetry(in: app) else { return false }
            return now.distance(from: steering) > 0.5 && now.painted > steering.painted
        })

        surface.pinch(withScale: 1.3, velocity: 1)
        XCTAssertTrue(waitUntil(timeout: 5) { (self.telemetry(in: app)?.zoom ?? 0) > following.zoom + 0.1 })
        let afterPinch = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.50)).tap()
        _ = try waitForSteering(after: afterPinch.steeringCount, in: app)
        revealControls(in: app)
        app.buttons["Center behind the tractor"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.zoom == 0.65 })

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForMeadowLayout(in: app, portrait: false, tractorView: true)
        XCTAssertTrue(app.buttons["action.camera"].isHittable)
        XCTAssertTrue(app.buttons["Zoom in"].isHittable)
        let landscape = try XCTUnwrap(telemetry(in: app))
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.53, dy: 0.46)).tap()
        _ = try waitForSteering(after: landscape.steeringCount, in: app)
        attachScreenshot("Behind the tractor in landscape", app: app)
        revealControls(in: app)
        for _ in 0..<8 { app.buttons["Zoom in"].tap() }
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.zoom == 1.8 })
        attachScreenshot("Tractor and attachment at closest landscape zoom", app: app)
        app.buttons["Center behind the tractor"].tap()

        app.buttons["action.camera"].tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.tractorView == false })
        XCTAssertEqual(try XCTUnwrap(telemetry(in: app)).zoom, overviewZoom)
        XCTAssertGreaterThan(try XCTUnwrap(telemetry(in: app)).cameraY, 70)
        app.buttons["action.camera"].tap()
        app.buttons["action.pause"].tap()
        XCTAssertTrue(app.buttons["pause.resume"].waitForExistence(timeout: 3))
        XCTAssertEqual(try XCTUnwrap(telemetry(in: app)).speed, 0)
        app.buttons["pause.resume"].tap()
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["action.camera"].waitForExistence(timeout: 40))
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app)?.tractorView == true })
        XCTAssertTrue(app.buttons["action.camera"].isSelected)
        XCTAssertEqual(try XCTUnwrap(telemetry(in: app)).zoom, 0.65)
        attachScreenshot("Tractor view restored after relaunch", app: app)
    }

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
        // The segments of the time-of-day control are buttons named for each light.
        XCTAssertTrue(app.buttons["Dusk"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Drifting"].isSelected)
        attachScreenshot("Native settings", app: app)
        app.buttons["Dusk"].tap()
        XCTAssertTrue(app.buttons["Dusk"].isSelected)
        dismissSheetAndWait(in: app)
        attachScreenshot("A soft pink dusk", app: app)
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["tool.sow"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.buttons["tool.sow"].isSelected)
        app.buttons["action.settings"].tap()
        XCTAssertTrue(app.buttons["Dusk"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Dusk"].isSelected)
        attachScreenshot("Settings restored after relaunch", app: app)
    }

    func testNightLightsAndAPostcard() throws {
        let app = launchFreshMeadow()
        defer { app.terminate() }
        app.buttons["action.settings"].tap()
        XCTAssertTrue(app.buttons["Night"].waitForExistence(timeout: 3))
        app.buttons["Night"].tap()
        dismissSheetAndWait(in: app)
        attachScreenshot("A quiet, bright night", app: app)
        XCTAssertTrue(app.buttons["action.postcard"].isHittable)
        app.buttons["action.postcard"].tap()
        // The sheet only opens when the photograph shows more than one flat colour.
        XCTAssertTrue(app.images["postcard.picture"].waitForExistence(timeout: 8),
                      "The postcard must capture the meadow, not an empty view.")
        XCTAssertTrue(app.buttons["postcard.share"].exists)
        attachScreenshot("A postcard of the night meadow", app: app)
        dismissSheetAndWait(in: app)
    }

    func testTouchSteeringPaintAndBackgroundLifecycle() throws {
        let app = launchFreshMeadow()
        defer { app.terminate() }
        let surface = meadowSurface(in: app)
        app.buttons["tool.cultivate"].tap()
        let initial = try XCTUnwrap(telemetry(in: app))

        // A real touch lands in the central meadow. No test hook steers the tractor.
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.33, dy: 0.51)).tap()
        XCTAssertTrue(waitUntil(timeout: 12) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: initial) > 0.6 && current.painted > initial.painted
        }, "Touch steering must move the tractor and change field cells.")
        attachScreenshot("Prepared soil after touch steering", app: app)

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
        XCTAssertTrue(meadowSurface(in: app).waitForExistence(timeout: 10))
        revealControls(in: app)
        XCTAssertTrue(app.buttons["tool.cultivate"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["tool.cultivate"].isSelected)
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
        XCTAssertFalse(app.buttons["crop.wheat"].exists)
        app.buttons["tool.sow"].tap()
        assertCropChoicesReachable(in: app)
        app.buttons["crop.pumpkins"].tap()
        XCTAssertTrue(app.buttons["crop.pumpkins"].isSelected)
        XCTAssertFalse(app.buttons["crop.wheat"].isSelected)
        attachScreenshot("Portrait crop choices", app: app)

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
        assertCropChoicesReachable(in: app)
        XCTAssertTrue(app.buttons["crop.pumpkins"].isSelected)
        attachScreenshot("Landscape crop choices", app: app)

        app.buttons["action.settings"].tap()
        XCTAssertTrue(app.buttons["sheet.close"].waitForExistence(timeout: 3))
        attachScreenshot("Native settings in landscape", app: app)
        dismissSheetAndWait(in: app)

        XCUIDevice.shared.orientation = .portrait
        waitForMeadowLayout(in: app, portrait: true)
        assertControlsReachable(in: app)
        assertCropChoicesReachable(in: app)
        XCTAssertTrue(app.buttons["crop.pumpkins"].isSelected)
        app.buttons["tool.harvest"].tap()
        XCTAssertFalse(app.buttons["crop.pumpkins"].exists)
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
        // The pinch can leave the tractor beside the old left destination.
        // Choose a clear point farther across the meadow to observe movement.
        surface.coordinate(withNormalizedOffset: CGVector(dx: 0.60, dy: 0.50)).tap()
        let resumed = try waitForSteering(after: pinched.steeringCount, in: app)
        XCTAssertTrue(resumed.markerVisible,
                      "A completed pinch must release steering and show the next tap's destination.")
        XCTAssertTrue(waitUntil(timeout: 8) {
            guard let current = self.telemetry(in: app) else { return false }
            return current.distance(from: resumed) > 0.6
        }, "The tractor must drive toward a new tap after pinching, without another gesture to unstick it.")
        attachScreenshot("Steering resumes after pinching", app: app)
    }

    private func revealControls(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let recall = app.buttons["action.controls"]
        if recall.exists && recall.label == "Show controls" {
            recall.tap()
            // Wait for the whole tool dock to settle after its slide.
            waitForMeadowLayout(in: app, portrait: app.frame.height > app.frame.width,
                                tractorView: telemetry(in: app)?.tractorView == true,
                                file: file, line: line)
        } else {
            XCTAssertTrue(waitUntil(timeout: 3) { app.buttons["tool.harvest"].isHittable }, file: file, line: line)
        }
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

    private func launchFreshMeadow(fastCrops: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--fresh-meadow"] + (fastCrops ? ["--fast-crops"] : [])
        app.launch()
        XCTAssertTrue(app.buttons["tool.harvest"].waitForExistence(timeout: 40))
        if app.buttons["action.begin"].exists {
            attachScreenshot("Welcome to Willowbrook", app: app)
            app.buttons["action.begin"].tap()
        }
        XCTAssertTrue(waitUntil(timeout: 5) { self.telemetry(in: app) != nil },
                      "Debug UI-test telemetry must be available on the native meadow surface.")
        return app
    }

    private func assertCropChoicesReachable(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        for crop in ["wheat", "sunflowers", "pumpkins"] {
            let button = app.buttons["crop.\(crop)"]
            XCTAssertTrue(button.isHittable, file: file, line: line)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, file: file, line: line)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, file: file, line: line)
            XCTAssertTrue(app.frame.contains(button.frame), file: file, line: line)
        }
        XCTAssertFalse(app.buttons["farming.rest"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["farming.meadow"].exists, file: file, line: line)
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
            !app.buttons["sheet.close"].exists && app.buttons["tool.harvest"].isHittable
        }, "The sheet must finish dismissing before another layout transition begins.", file: file, line: line)
    }

    private func waitForMeadowLayout(in app: XCUIApplication, portrait: Bool, tractorView: Bool = false,
                                    file: StaticString = #filePath, line: UInt = #line) {
        let identifiers = meadowControlIdentifiers.map {
            tractorView && $0 == "Center the farm" ? "Center behind the tractor" : $0
        }
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
            for identifier in identifiers {
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
            return identifiers.allSatisfy { app.buttons[$0].isHittable }
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
                         steeringCount: Int(steeringCount), destination: destination, markerVisible: marker == 1,
                         tractorView: values["tractorView"] == 1, heading: values["heading"] ?? 0,
                         cameraX: values["cameraX"] ?? 0, cameraY: values["cameraY"] ?? 0, cameraZ: values["cameraZ"] ?? 0)
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
        let tractorView: Bool
        let heading: Double
        let cameraX: Double
        let cameraY: Double
        let cameraZ: Double

        func distance(from other: Telemetry) -> Double {
            hypot(x - other.x, z - other.z)
        }

        func cameraDistance(from other: Telemetry) -> Double {
            hypot(cameraX - other.cameraX, cameraZ - other.cameraZ)
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
