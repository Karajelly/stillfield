import RealityKit
import SwiftUI

struct FarmViewport: View {
    let game: FarmController
    @GestureState private var isPinching = false

    var body: some View {
        GeometryReader { geometry in
            RealityView { content in
                content.camera = .virtual
                content.renderingEffects.motionBlur = .disabled
                content.renderingEffects.depthOfField = .disabled
                content.renderingEffects.cameraGrain = .disabled
                content.renderingEffects.dynamicRange = .standard
                let daylight = try? await FarmArtwork.makeDaylight()
                await game.load(into: content, size: geometry.size, daylight: daylight)
            }
            .realityViewCameraControls(.none)
            .background {
                if game.cameraMode == .tractor {
                    // Keep the illustrated sky's color independent of scene exposure.
                    LinearGradient(colors: [Color(red: 0.72, green: 0.85, blue: 0.89),
                                            Color(red: 0.95, green: 0.94, blue: 0.83)],
                                   startPoint: .top, endPoint: .bottom)
                        .allowsHitTesting(false)
                }
            }
            .onChange(of: geometry.size) { _, size in game.setViewportSize(size) }
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in game.steer(at: value.location) })
            .simultaneousGesture(
                MagnifyGesture()
                    .updating($isPinching) { _, pinching, _ in pinching = true }
                    .onChanged { value in game.pinch(value.magnification) }
                    .onEnded { _ in game.endPinch() }
            )
            // GestureState resets on cancellation as well as normal completion;
            // onEnded alone is not called when a system gesture interrupts us.
            .onChange(of: isPinching) { _, pinching in
                if !pinching { game.endPinch() }
            }
            .onDisappear { game.endPinch() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Your meadow")
            .accessibilityHint(game.cameraMode == .tractor
                ? "Following behind your tractor. Tap the ground ahead or drag to drive. Pinch to change camera distance."
                : "Tap a destination or drag to drive. Pinch to zoom.")
            .accessibilityIdentifier("farm.surface")
#if DEBUG
            .accessibilityValue(game.testTelemetry)
#endif
        }
    }
}
