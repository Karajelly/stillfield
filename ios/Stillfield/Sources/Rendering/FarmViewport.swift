import RealityKit
import SwiftUI

struct FarmViewport: View {
    let game: FarmController
    @GestureState private var isPinching = false
    @GestureState private var isDragging = false

    var body: some View {
        GeometryReader { geometry in
            RealityView { content in
                content.camera = .virtual
                content.renderingEffects.motionBlur = .disabled
                content.renderingEffects.depthOfField = .disabled
                content.renderingEffects.cameraGrain = .disabled
                content.renderingEffects.dynamicRange = .standard
                let daylight = try? await FarmArtwork.makeDaylight()
                let goldenDaylight = try? await FarmArtwork.makeDaylight(golden: true)
                await game.load(into: content, size: geometry.size, daylight: daylight, goldenDaylight: goldenDaylight)
            }
            .realityViewCameraControls(.none)
            // Three.js uses ACES filmic tone mapping. RealityKit's iOS 18 SDR
            // output is more saturated/contrasty, so soften only the scene to
            // match that pastel finish; SwiftUI controls retain exact sRGB colors.
            .saturation(0.60)
            .contrast(0.90)
            .brightness(0.06)
            .background {
                // The web background/fog colors also carry into tractor view.
                Color(uiColor: UIColor(farmHex: game.goldenLight ? "#EEE5CE" : "#E8ECDA"))
                    .allowsHitTesting(false)
            }
            .onChange(of: geometry.size) { _, size in game.setViewportSize(size) }
            .gesture(DragGesture(minimumDistance: 0)
                .updating($isDragging) { _, dragging, _ in dragging = true }
                .onChanged { value in game.steer(at: value.location, from: value.startLocation) }
                .onEnded { _ in game.endSteering() })
            .onChange(of: isDragging) { _, dragging in
                if !dragging { game.cancelSteering() }
            }
            .simultaneousGesture(
                MagnifyGesture()
                    .updating($isPinching) { _, pinching, _ in pinching = true }
                    .onChanged { value in game.pinch(value.magnification) }
                    .onEnded { _ in game.endPinch(); if !isDragging { game.cancelSteering() } }
            )
            // GestureState resets on cancellation as well as normal completion;
            // onEnded alone is not called when a system gesture interrupts us.
            .onChange(of: isPinching) { _, pinching in
                if !pinching { game.endPinch(); if !isDragging { game.cancelSteering() } }
            }
            .onDisappear { game.endPinch(); game.cancelSteering() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Your meadow")
            .accessibilityHint(game.cameraMode == .tractor
                ? "Hold to roll and move your finger left or right to steer. Lift to stop. Tap where work should finish. Pinch to change camera distance."
                : "Tap where work should finish or drag to drive. Tap beside a finished row to line up and stop. Pinch to zoom.")
            .accessibilityIdentifier("farm.surface")
#if DEBUG
            .accessibilityValue(game.testTelemetry)
#endif
        }
    }
}
