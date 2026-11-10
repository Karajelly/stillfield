import SwiftUI
import StillfieldCore

enum FarmSheet: String, Identifiable {
    case settings, help
    var id: String { rawValue }
}

private enum MeadowPalette {
    // Canonical UI colors live in src/style.css. Keep exact sRGB values here
    // so SwiftUI uses the same palette as the web app.
    static let ink = color(0x344c40)
    static let muted = color(0x7d8874)
    static let cream = color(0xf7f5e9)
    static let green = color(0x52745a)
    static let background = color(0xe8ecda)
    static let goldenBackground = color(0xeee5ce) // src/main.ts golden scene background

    static let tagline = color(0x78836f)
    static let placeSurface = color(0xf9f8ec, opacity: 0.58)
    static let placeBorder = color(0x697e57, opacity: 0.17)
    static let gold = color(0x9b8952)
    static let weatherDetail = color(0x89917d)
    static let roundButton = color(0x596f55)
    static let roundButtonSelected = color(0xe0e7ce)
    static let welcomeEyebrow = color(0x7b8a6b)
    static let welcomeRule = color(0x8c9a77)
    static let welcomeEmphasis = color(0x72855b)
    static let welcomeCopy = color(0x79856c)
    static let fieldNote = color(0x78876a)
    static let fieldNoteDetail = color(0x7f8a74)
    static let fieldNoteRule = color(0x809565, opacity: 0x66 / 255.0)

    static let dockSurface = color(0xf9f9ee, opacity: 0.94)
    static let dockBorder = color(0xffffff, opacity: 0.85)
    static let dockShadow = color(0x405034, opacity: 0x17 / 255.0)
    static let toolLabel = color(0x8b947e)
    static let selectedToolLabel = color(0x3f5b40)
    static let selectedToolSurface = color(0xe2e8d5)
    static let selectedToolBorder = color(0xbecbaa, opacity: 0x40 / 255.0)
    static let selectedToolIndicator = color(0x60805b)
    static let selectedCropBorder = color(0xbecbaa, opacity: 0.5)
    static let wheat = color(0xa18245)
    static let sunflowers = color(0x8c874c)
    static let pumpkins = color(0xad7859)
    static let mow = color(0x728c59)
    static let cultivate = color(0xa68a69)
    static let sow = color(0x839a64)
    static let wander = color(0x87998a)
    static let driveHint = color(0x899479)
    static let zoom = color(0x7b8c6c)
    static let zoomSurface = color(0xf6f7e9, opacity: 0x9c / 255.0)
    static let zoomBorder = color(0x8b9973, opacity: 0x33 / 255.0)

    static let toast = color(0x657b55)
    static let toastSurface = color(0xf8f7eb, opacity: 0xed / 255.0)
    static let toastShadow = color(0x4d6342, opacity: 0x0d / 255.0)
    static let pauseVeil = color(0xe9ecdb, opacity: 0x44 / 255.0)
    static let pauseSymbol = color(0x859573)
    static let pauseTitle = color(0x516a46)
    static let pauseButtonSurface = color(0xf7f7ec, opacity: 0xcc / 255.0)
    static let dialogSurface = color(0xf7f7ed)
    static let dialogBorder = color(0xffffff, opacity: 0x99 / 255.0)
    static let dialogSymbol = color(0x789166)
    static let dialogEyebrow = color(0x869273)
    static let dialogCopy = color(0x7e8b70)
    static let helpSymbol = color(0x7a9365)
    static let helpTitle = color(0x576f4d)
    static let helpCopy = color(0x839075)
    static let primaryButton = color(0x59734c)
    static let primaryButtonLabel = color(0xf7f7e9)
    static let settingDetail = color(0x8a967c)
    static let settingRangeLabel = color(0x8a967d)
    static let settingSwitch = color(0x80996a)
    static let settingRange = color(0x7e9569)
    static let settingBorder = color(0x899676, opacity: 0x40 / 255.0)
    static let settingFootnote = color(0xa1aa95)

    // Match every stop in .vignette and .golden .vignette, including opacity.
    static func vignette(golden: Bool) -> [Gradient.Stop] {
        if golden {
            return [
                .init(color: color(0xf8efda, opacity: 0.9), location: 0),
                .init(color: .clear, location: 0.28),
                .init(color: .clear, location: 0.72),
                .init(color: color(0xf3e8ce, opacity: 0.85), location: 1),
            ]
        }
        return [
            .init(color: color(0xf4f5e3, opacity: 0.88), location: 0),
            .init(color: color(0xf4f5e3, opacity: 0.36), location: 0.12),
            .init(color: .clear, location: 0.27),
            .init(color: .clear, location: 0.68),
            .init(color: color(0xedf0d9, opacity: 0.27), location: 0.83),
            .init(color: color(0xedf0d9, opacity: 0.88), location: 1),
        ]
    }

    private static func color(_ hex: UInt32, opacity: Double = 1) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 0xff) / 255,
              green: Double((hex >> 8) & 0xff) / 255,
              blue: Double(hex & 0xff) / 255, opacity: opacity)
    }
}

private struct AmbientCopy: ViewModifier {
    let hidden: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(hidden ? 0 : 1)
            .allowsHitTesting(!hidden)
            .accessibilityHidden(hidden)
            .animation(reduceMotion ? nil : .easeOut(duration: 1.2), value: hidden)
    }
}

struct FarmScreen: View {
    @Bindable var game: FarmController
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let compactHeight = geometry.size.height < 500
            let wide = geometry.size.width >= 700
            let portrait = geometry.size.height > geometry.size.width
            ZStack {
                FarmViewport(game: game)
                    .ignoresSafeArea()
                    .zIndex(-2)

                LinearGradient(
                    stops: MeadowPalette.vignette(golden: game.goldenLight),
                    startPoint: .top, endPoint: .bottom
                )
                .ignoresSafeArea()
                .allowsHitTesting(false)
                // Keep departing overlays above the opaque scene for their entire transition.
                .zIndex(-1)

                if game.isLoading {
                    loadingCard
                } else if game.errorMessage != nil && !game.hasSaveError {
                    errorCard
                } else {
                    if !game.controlsHidden {
                        VStack(spacing: 0) {
                            header(width: geometry.size.width, compact: compactHeight)
                            Spacer(minLength: 0)
                            if compactHeight {
                                landscapeFooter
                            } else {
                                portraitFooter(wide: wide)
                            }
                        }
                        .padding(.horizontal, wide ? 28 : 16)
                        .padding(.top, 8)
                        .padding(.bottom, compactHeight ? 8 : 12)
                        .transition(reduceMotion ? .identity : .offset(x: geometry.size.width))
                    }

                    if game.hasDriven {
                        Button(action: game.toggleControls) {
                            Image(systemName: game.controlsHidden ? "line.3.horizontal" : "chevron.right")
                                .font(.system(size: 17, weight: .regular))
                                .frame(width: 44, height: 44)
                                .foregroundStyle(MeadowPalette.roundButton)
                                .background(MeadowPalette.zoomSurface, in: Circle())
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(game.controlsHidden ? "Show controls" : "Hide controls")
                        .accessibilityHint("Tools, sound, pause, settings, and camera controls.")
                        .accessibilityIdentifier("action.controls")
                        .padding(.trailing, wide ? 28 : 16)
                        .padding(.bottom, compactHeight ? 8 : 12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    }

                    if !game.introDismissed {
                        Group {
                            if portrait {
                                portraitWelcome(wide: wide, short: geometry.size.height < 700)
                                    .padding(.horizontal, 24)
                                    .padding(.top, wide ? 100 : geometry.size.height < 700 ? 58 : 70)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            } else {
                                welcome(compact: compactHeight, wide: wide)
                                    .padding(!wide && !compactHeight ? 16 : 0)
                                    .background {
                                        if !wide && !compactHeight {
                                            RoundedRectangle(cornerRadius: 24)
                                                .fill(MeadowPalette.cream.opacity(0.92))
                                        }
                                    }
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                                    .padding(.leading, wide ? 40 : 24)
                                    .padding(.top, compactHeight ? 70 : wide ? 120 : 90)
                            }
                        }
                        .transition(.opacity)
                    } else if !portrait && wide && !compactHeight {
                        fieldNote
                            .modifier(AmbientCopy(hidden: game.hasDriven))
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .padding(.leading, 40)
                            .padding(.top, 94)
                            .allowsHitTesting(false)
                    }

                    if let toast = game.toast {
                        Text(toast)
                            .font(.subheadline)
                            .foregroundStyle(MeadowPalette.toast)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(MeadowPalette.toastSurface, in: Capsule())
                            .overlay(Capsule().strokeBorder(MeadowPalette.dialogBorder, lineWidth: 1))
                            .shadow(color: MeadowPalette.toastShadow, radius: 14, y: 4)
                            .padding(.top, compactHeight ? 62 : 80)
                            .frame(maxHeight: .infinity, alignment: .top)
                            .accessibilityAddTraits(.updatesFrequently)
                            .allowsHitTesting(false)
                    }

                    if game.isPaused {
                        pauseOverlay
                            .transition(.opacity)
                    }
                }
            }
            .foregroundStyle(MeadowPalette.ink)
            .tint(MeadowPalette.green)
            .animation(reduceMotion ? nil : .easeOut(duration: 1.2), value: game.introDismissed)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: game.isPaused)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 0.8),
                value: game.controlsHidden
            )
        }
        .background(game.goldenLight ? MeadowPalette.goldenBackground : MeadowPalette.background)
        .preferredColorScheme(.light)
        .sheet(item: $game.activeSheet) { sheet in
            switch sheet {
            case .settings: FarmSettingsSheet(game: game)
            case .help: FarmHelpSheet()
            }
        }
        .onAppear { game.setActive(scenePhase == .active) }
        .onChange(of: scenePhase) { _, phase in game.setActive(phase == .active) }
    }

    private func header(width: CGFloat, compact: Bool) -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 9) {
                StillfieldMark()
                    .frame(width: compact ? 32 : 38, height: compact ? 32 : 38)
                VStack(alignment: .leading, spacing: 0) {
                    Text("stillfield")
                        .font(.system(size: compact ? 27 : 30, weight: .regular, design: .serif))
                        .tracking(-1)
                    if width >= 600 && !compact {
                        Text("a little farm. a little peace.")
                            .font(.system(size: 10))
                            .foregroundStyle(MeadowPalette.tagline)
                            .tracking(0.8)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Stillfield. A little farm, a little peace.")
            .modifier(AmbientCopy(hidden: game.hasDriven))

            Spacer(minLength: 4)

            if width >= 1_050 {
                Label("Willowbrook farm", systemImage: "leaf.fill")
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 17)
                    .padding(.vertical, 12)
                    .background(MeadowPalette.placeSurface, in: Capsule())
                    .overlay(Capsule().strokeBorder(MeadowPalette.placeBorder, lineWidth: 1))
                    .modifier(AmbientCopy(hidden: game.hasDriven))
                Spacer(minLength: 4)
            }

            if width >= 850 && !compact {
                HStack(spacing: 10) {
                    Image(systemName: "sun.max")
                        .font(.system(size: 23, weight: .light))
                        .foregroundStyle(MeadowPalette.gold)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(game.goldenLight ? "A little golden hour" : "A slow spring afternoon")
                            .font(.system(size: 12, weight: .medium))
                        Text("A gentle breeze. Nowhere to be.")
                            .font(.system(size: 10))
                            .foregroundStyle(MeadowPalette.weatherDetail)
                    }
                }
                .padding(.trailing, 14)
                .accessibilityElement(children: .combine)
                .modifier(AmbientCopy(hidden: game.hasDriven))
            }

            HStack(spacing: 4) {
                roundButton(game.soundEnabled ? "speaker.wave.2" : "speaker.slash", label: game.soundEnabled ? "Turn nature sounds off" : "Turn nature sounds on", identifier: "action.sound", selected: game.soundEnabled) { game.toggleSound() }
                roundButton("pause", label: "Pause the meadow", identifier: "action.pause") { game.togglePause() }
                roundButton("slider.horizontal.3", label: "Open settings", identifier: "action.settings") { game.activeSheet = .settings }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func portraitWelcome(wide: Bool, short: Bool) -> some View {
        VStack(spacing: wide ? 10 : 8) {
            if !short {
                Text("THERE’S NO HURRY HERE")
                    .font(.system(size: 9, weight: .medium))
                    .tracking(1.5)
                    .foregroundStyle(MeadowPalette.welcomeEyebrow)
            }
            (Text(short ? "Take it " : "A good day\nto take it ") + Text("slow.").italic().foregroundColor(MeadowPalette.welcomeEmphasis))
                .font(.system(size: wide ? 35 : 27, weight: .regular, design: .serif))
                .lineSpacing(-1)
                .multilineTextAlignment(.center)
            welcomeButton
        }
        .fixedSize(horizontal: false, vertical: true)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .contain)
    }

    private func welcome(compact: Bool, wide: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 9 : 15) {
            if !compact {
                HStack(spacing: 8) {
                    Capsule().fill(MeadowPalette.welcomeRule).frame(width: 20, height: 1)
                    Text("THERE’S NO HURRY HERE")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1.5)
                }
                .foregroundStyle(MeadowPalette.welcomeEyebrow)
            }
            (Text("A good day\nto take it ") + Text("slow.").italic().foregroundColor(MeadowPalette.welcomeEmphasis))
                .font(.system(size: compact ? 27 : wide ? 45 : 35, weight: .regular, design: .serif))
                .lineSpacing(-1)
            if !compact {
                Text("A little fresh air. A few tidy rows.\nNothing you need to finish.")
                    .font(.system(size: wide ? 14 : 12))
                    .lineSpacing(5)
                    .foregroundStyle(MeadowPalette.welcomeCopy)
            }
            welcomeButton
        }
        .fixedSize(horizontal: false, vertical: true)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .contain)
    }

    private var welcomeButton: some View {
        Button(action: game.dismissIntro) {
            HStack(spacing: 17) {
                Text("Let’s wander")
                    .font(.system(size: 13, weight: .medium))
                Image(systemName: "arrow.right").font(.system(size: 13))
            }
            .padding(.horizontal, 19)
            .frame(minHeight: 46)
            .foregroundStyle(MeadowPalette.ink)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("action.begin")
    }

    private var fieldNote: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle().fill(MeadowPalette.fieldNoteRule).frame(width: 1, height: 44)
            VStack(alignment: .leading, spacing: 8) {
                Text("THE MEADOW").font(.system(size: 9, weight: .medium)).tracking(2)
                Text("Room to do your own thing.")
                    .font(.system(size: 13, design: .serif)).italic()
                    .foregroundStyle(MeadowPalette.fieldNoteDetail)
            }
        }
        .foregroundStyle(MeadowPalette.fieldNote)
    }

    private func portraitFooter(wide: Bool) -> some View {
        VStack(spacing: wide ? 14 : 9) {
            toolDock(compact: false)
                .frame(maxWidth: wide ? 420 : 380)
            HStack(spacing: 8) {
                if wide && game.hasSaveError {
                    Text("Your meadow couldn’t save.")
                        .font(.system(size: 11))
                        .foregroundStyle(MeadowPalette.muted)
                } else if !wide {
                    Button { game.activeSheet = .help } label: {
                        Text("Tap or drag\nto find your way")
                            .font(.system(size: 10))
                            .multilineTextAlignment(.leading)
                            .lineSpacing(2)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(MeadowPalette.driveHint)
                    .accessibilityLabel("Learn to drive. Tap or drag to find your way.")
                    .modifier(AmbientCopy(hidden: game.hasDriven))
                }
                Spacer(minLength: 0)
                zoomControls
            }
            .frame(maxWidth: .infinity)
            if game.hasSaveError && !wide {
                Text("Your meadow couldn’t save. There may be too little space on this device.")
                    .font(.caption2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(MeadowPalette.muted)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private var landscapeFooter: some View {
        HStack(alignment: .bottom, spacing: 12) {
            Spacer(minLength: 0)
            toolDock(compact: true)
                .frame(maxWidth: 320)
            Spacer(minLength: 0)
            zoomControls
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func toolDock(compact: Bool) -> some View {
        VStack(spacing: 6) {
            if game.tool == .sow { cropChoices(compact: compact) }
            HStack(spacing: 3) {
                ForEach([FarmTool.cultivate, .sow, .harvest, .wander], id: \.self) { tool in
                    let selected = game.tool == tool
                    Button { game.selectTool(tool) } label: {
                        VStack(spacing: compact ? 5 : 8) {
                            Image(systemName: tool.symbol)
                                .font(.system(size: compact ? 20 : 24, weight: .light))
                                .frame(height: compact ? 24 : 30)
                                .foregroundStyle(tool.color)
                            Text(tool.title)
                                .font(.system(size: compact ? 10 : 11, weight: selected ? .semibold : .regular))
                        }
                        .foregroundStyle(selected ? MeadowPalette.selectedToolLabel : MeadowPalette.toolLabel)
                        .frame(maxWidth: .infinity)
                        .frame(height: compact ? 58 : 74)
                        .background(selected ? MeadowPalette.selectedToolSurface : .clear, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? MeadowPalette.selectedToolBorder : .clear, lineWidth: 1))
                        .overlay(alignment: .bottom) {
                            if selected { Capsule().fill(MeadowPalette.selectedToolIndicator).frame(width: 14, height: 2).padding(.bottom, 5) }
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tool.accessibilityDescription)
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                    .accessibilityIdentifier("tool.\(tool.rawValue)")
                }
            }
            .padding(7)
            .background(MeadowPalette.dockSurface, in: RoundedRectangle(cornerRadius: 23))
            .overlay(RoundedRectangle(cornerRadius: 23).strokeBorder(MeadowPalette.dockBorder, lineWidth: 1))
            .shadow(color: MeadowPalette.dockShadow, radius: 18, y: 6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Tractor tools")
        }
    }

    private func cropChoices(compact: Bool) -> some View {
        HStack(spacing: 4) {
            ForEach(Crop.allCases, id: \.self) { crop in
                let selected = game.selectedCrop == crop
                Button { game.selectCrop(crop) } label: {
                    HStack(spacing: compact ? 5 : 7) {
                        CropGlyph(crop: crop)
                            .stroke(crop.tint, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                            .frame(width: compact ? 22 : 24, height: compact ? 22 : 24)
                        Text(crop.title)
                            .font(.system(size: compact ? 10 : 11, weight: selected ? .semibold : .medium))
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(selected ? MeadowPalette.selectedToolLabel : MeadowPalette.roundButton)
                    .padding(.horizontal, compact ? 7 : 10)
                    .frame(maxWidth: .infinity)
                    .frame(height: compact ? 48 : 54)
                    .background(selected ? MeadowPalette.selectedToolSurface : .clear, in: RoundedRectangle(cornerRadius: 15))
                    .overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(selected ? MeadowPalette.selectedCropBorder : .clear, lineWidth: 1))
                    .contentShape(RoundedRectangle(cornerRadius: 15))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sow \(crop.title)")
                .accessibilityAddTraits(selected ? [.isSelected] : [])
                .accessibilityIdentifier("crop.\(crop.identifier)")
            }
        }
        .padding(5)
        .background(MeadowPalette.dockSurface, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(MeadowPalette.dockBorder, lineWidth: 1))
        .shadow(color: MeadowPalette.dockShadow, radius: 12, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Crop to sow")
    }

    private var zoomControls: some View {
        HStack(spacing: 0) {
            Button(action: game.toggleCamera) {
                Image(systemName: game.cameraMode == .tractor ? "car.rear.fill" : "car.rear")
                    .font(.system(size: 17))
                    .frame(width: 44, height: 44)
                    .background(game.cameraMode == .tractor ? MeadowPalette.roundButtonSelected : .clear, in: Circle())
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(game.cameraMode == .tractor ? "Return to farm view" : "Drive in tractor view")
            .accessibilityValue(game.cameraMode == .tractor ? "Tractor view" : "Farm view")
            .accessibilityHint("Switch between an overhead view and following behind the tractor.")
            .accessibilityAddTraits(game.cameraMode == .tractor ? [.isSelected] : [])
            .accessibilityIdentifier("action.camera")
            zoomButton("minus", label: "Zoom out", action: game.zoomOut)
            zoomButton("viewfinder", label: game.cameraMode == .tractor ? "Center behind the tractor" : "Center the farm", action: game.recenter)
            zoomButton("plus", label: "Zoom in", action: game.zoomIn)
        }
        .foregroundStyle(MeadowPalette.zoom)
        .background(MeadowPalette.zoomSurface, in: Capsule())
        .overlay(Capsule().strokeBorder(MeadowPalette.zoomBorder, lineWidth: 1))
        .padding(.trailing, game.hasDriven ? 52 : 0)
    }

    private func zoomButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .regular))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func roundButton(_ symbol: String, label: String, identifier: String, selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .regular))
                .frame(width: 44, height: 44)
                .foregroundStyle(MeadowPalette.roundButton)
                .background(selected ? MeadowPalette.roundButtonSelected : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private var pauseOverlay: some View {
        ZStack {
            MeadowPalette.pauseVeil.ignoresSafeArea()
            VStack(spacing: 22) {
                Image(systemName: "leaf")
                    .font(.system(size: 35, weight: .ultraLight))
                    .foregroundStyle(MeadowPalette.pauseSymbol)
                Text("A moment to breathe.")
                    .font(.system(.title, design: .serif))
                    .foregroundStyle(MeadowPalette.pauseTitle)
                Text("The meadow will wait.")
                    .font(.subheadline)
                    .foregroundStyle(MeadowPalette.muted)
                Button(action: game.togglePause) {
                    Label("Back to the meadow", systemImage: "play.fill")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 24)
                        .frame(minHeight: 50)
                        .background(MeadowPalette.pauseButtonSurface, in: Capsule())
                        .foregroundStyle(MeadowPalette.ink)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pause.resume")
            }
            .padding(24)
        }
        .accessibilityAddTraits(.isModal)
    }

    private var loadingCard: some View {
        VStack(spacing: 18) {
            StillfieldMark().frame(width: 52, height: 52)
            Text("A little time outside.").font(.system(.title2, design: .serif))
            ProgressView().tint(MeadowPalette.green).accessibilityLabel("Opening your meadow")
        }
        .padding(36)
        .background(MeadowPalette.cream.opacity(0.94), in: RoundedRectangle(cornerRadius: 28))
    }

    private var errorCard: some View {
        VStack(spacing: 18) {
            Image(systemName: "leaf").font(.largeTitle.weight(.ultraLight))
            Text("The meadow couldn’t open.").font(.system(.title2, design: .serif))
            Text("Close and reopen Stillfield to give it another try. Your saved meadow stays on this device.")
                .font(.subheadline)
                .foregroundStyle(MeadowPalette.muted)
                .multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: 360)
        .background(MeadowPalette.cream, in: RoundedRectangle(cornerRadius: 28))
        .padding(24)
    }
}

private struct FarmSettingsSheet: View {
    @Bindable var game: FarmController
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingReset = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("THE WAY YOU LIKE IT").font(.caption2.weight(.medium)).tracking(2)
                            .foregroundStyle(MeadowPalette.dialogEyebrow)
                        Text("Settle in.").font(.system(size: 38, design: .serif))
                        Text("A few small comforts for your time outside.")
                            .font(.subheadline).foregroundStyle(MeadowPalette.dialogCopy)
                    }
                    VStack(spacing: 20) {
                        settingToggle("Golden light", subtitle: "A warmer kind of afternoon.", isOn: $game.goldenLight, identifier: "settings.golden")
                        Divider().overlay(MeadowPalette.settingBorder)
                        settingToggle("A little feeling", subtitle: "Gentle haptics when you change tools.", isOn: $game.haptics, identifier: "settings.haptics")
                    }
                    .padding(20)
                    .background(MeadowPalette.dialogSurface, in: RoundedRectangle(cornerRadius: 22))

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Your pace").font(.headline)
                        Slider(value: $game.pace, in: 0.55...1.25, step: 0.05)
                            .tint(MeadowPalette.settingRange)
                            .accessibilityLabel("Your pace")
                            .accessibilityValue(game.pace < 0.8 ? "Unhurried" : game.pace > 1.05 ? "A little breezier" : "Easygoing")
                            .accessibilityIdentifier("settings.pace")
                        HStack { Text("Unhurried"); Spacer(); Text("A little breezier") }
                            .font(.caption).foregroundStyle(MeadowPalette.settingRangeLabel)
                    }
                    .padding(.horizontal, 4)

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Nature sounds").font(.headline)
                            Spacer()
                            Button(game.soundEnabled ? "On" : "Off", action: game.toggleSound)
                                .font(.subheadline.weight(.medium))
                                .frame(minWidth: 44, minHeight: 44)
                                .accessibilityLabel(game.soundEnabled ? "Turn nature sounds off" : "Turn nature sounds on")
                        }
                        Slider(value: $game.volume, in: 0...1, step: 0.05)
                            .tint(MeadowPalette.settingRange)
                            .accessibilityLabel("Nature sounds volume")
                            .accessibilityValue("\(Int((game.volume * 100).rounded())) percent")
                            .accessibilityIdentifier("settings.volume")
                        HStack { Text("A whisper"); Spacer(); Text("All around you") }
                            .font(.caption).foregroundStyle(MeadowPalette.settingRangeLabel)
                    }
                    .padding(.horizontal, 4)

                    Button { confirmingReset = true } label: {
                        Label("A fresh meadow", systemImage: "arrow.counterclockwise")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(MeadowPalette.settingBorder, lineWidth: 1))
                            .contentShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings.reset")

                    Text(game.hasSaveError ? "Your meadow couldn’t save. Free a little space on this device and try again." : "Your meadow saves automatically on this device. Nothing changes while you’re away.")
                        .font(.footnote)
                        .foregroundStyle(game.hasSaveError ? MeadowPalette.muted : MeadowPalette.settingFootnote)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding(26)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .background(MeadowPalette.dialogSurface)
            .foregroundStyle(MeadowPalette.ink)
            .toolbarBackground(MeadowPalette.dialogSurface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { closeButton } }
            .confirmationDialog("A fresh meadow?", isPresented: $confirmingReset, titleVisibility: .visible) {
                Button("Start fresh", role: .destructive) { game.resetMeadow() }
                    .accessibilityIdentifier("reset.confirm")
                Button("Keep my meadow", role: .cancel) { }
            } message: {
                Text("Your paths, crops, and harvest displays will return to an empty meadow. This can’t be undone.")
            }
        }
        .tint(MeadowPalette.green)
        .presentationBackground(MeadowPalette.dialogSurface)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
    }

    private var closeButton: some View {
        Button(action: { dismiss() }) {
            Image(systemName: "xmark").font(.system(size: 13, weight: .medium)).frame(width: 44, height: 44)
        }
        .foregroundStyle(MeadowPalette.roundButton)
        .accessibilityLabel("Close settings")
        .accessibilityIdentifier("sheet.close")
    }

    private func settingToggle(_ title: String, subtitle: String, isOn: Binding<Bool>, identifier: String) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(subtitle).font(.caption).foregroundStyle(MeadowPalette.settingDetail)
            }
            .padding(.vertical, 4)
        }
        .tint(MeadowPalette.settingSwitch)
        .accessibilityIdentifier(identifier)
    }
}

private struct FarmHelpSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    StillfieldMark(color: MeadowPalette.dialogSymbol).frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("WELCOME TO WILLOWBROOK").font(.caption2.weight(.medium)).tracking(1.7)
                            .foregroundStyle(MeadowPalette.dialogEyebrow)
                        Text("Make yourself\nat home.").font(.system(size: 38, design: .serif))
                        Text("There’s nothing to win and nowhere to fall behind. Just a little land to make your own.")
                            .font(.subheadline).foregroundStyle(MeadowPalette.dialogCopy).lineSpacing(4)
                    }
                    helpRow("hand.draw", title: "Find your way", text: "Tap where mowing or planting should finish. Drag to keep steering. Tap beside a finished row to face back down it and stop. Pinch to look a little closer.")
                    helpRow("car.rear", title: "Come along for the ride", text: "Tap the vehicle button beside the zoom controls to follow behind your tractor. Drag to roll, slide your finger left or right to choose its direction, and lift to settle. A quick tap chooses where work should finish. Pinch to move closer or farther away. Tap the vehicle button again to see the whole farm.")
                    helpRow("leaf", title: "Make your mark", text: "Cultivate prepares soil and clears any crops. Sow a crop, then harvest when it’s ready. Three little plots of wheat, sunflowers, and pumpkins are ready to gather. Harvests fill the pots and carts by the field.")
                    helpRow("sun.max", title: "Let it grow", text: "Sunflowers take 3 minutes, wheat 6, and pumpkins 9, only while you play. Seeds are unlimited. Nothing withers, and full displays never stop a harvest.")
                    helpRow("wind", title: "Stay for a while", text: "Set your own pace, turn on the birdsong, and take a breath. Your meadow saves on this device. Nothing changes while you’re away.")
                    Button(action: { dismiss() }) {
                        HStack {
                            Text("A little time outside")
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 22)
                        .frame(minHeight: 52)
                        .foregroundStyle(MeadowPalette.primaryButtonLabel)
                        .background(MeadowPalette.primaryButton, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(28)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .background(MeadowPalette.dialogSurface)
            .foregroundStyle(MeadowPalette.ink)
            .toolbarBackground(MeadowPalette.dialogSurface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .medium)).frame(width: 44, height: 44)
                    }
                    .foregroundStyle(MeadowPalette.roundButton)
                    .accessibilityLabel("Close help")
                    .accessibilityIdentifier("sheet.close")
                }
            }
        }
        .tint(MeadowPalette.green)
        .presentationBackground(MeadowPalette.dialogSurface)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
    }

    private func helpRow(_ symbol: String, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 17) {
            Image(systemName: symbol).font(.system(size: 24, weight: .light)).frame(width: 32, height: 32)
                .foregroundStyle(MeadowPalette.helpSymbol)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(MeadowPalette.helpTitle)
                Text(text).font(.subheadline).foregroundStyle(MeadowPalette.helpCopy).lineSpacing(4)
            }
        }
    }
}

private struct StillfieldMark: View {
    var color: Color = MeadowPalette.ink

    var body: some View {
        Canvas { context, size in
            let scale = size.width / 40
            context.scaleBy(x: scale, y: scale)
            var sun = Path()
            sun.addArc(center: CGPoint(x: 20, y: 18), radius: 9, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            context.stroke(sun, with: .color(color), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            var field = Path()
            field.move(to: CGPoint(x: 3, y: 21))
            field.addQuadCurve(to: CGPoint(x: 37, y: 21), control: CGPoint(x: 20, y: 16))
            field.move(to: CGPoint(x: 5, y: 27))
            field.addQuadCurve(to: CGPoint(x: 35, y: 27), control: CGPoint(x: 20, y: 21))
            field.move(to: CGPoint(x: 9, y: 33))
            field.addQuadCurve(to: CGPoint(x: 31, y: 33), control: CGPoint(x: 20, y: 27))
            context.stroke(field, with: .color(color), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

// The same 24-point botanical drawings as src/icons.ts.
private struct CropGlyph: Shape {
    let crop: Crop

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch crop {
        case .wheat:
            path.move(to: CGPoint(x: 12, y: 22)); path.addLine(to: CGPoint(x: 12, y: 3))
            for y in [4.0, 9.0, 14.0] {
                for side in [-1.0, 1.0] {
                    path.move(to: CGPoint(x: 12, y: y + 4))
                    path.addQuadCurve(to: CGPoint(x: 12 + side * 5, y: y), control: CGPoint(x: 12 + side * 5, y: y + 3))
                    path.addQuadCurve(to: CGPoint(x: 12, y: y + 4), control: CGPoint(x: 12, y: y))
                    path.closeSubpath()
                }
            }
        case .sunflowers:
            path.move(to: CGPoint(x: 12, y: 16)); path.addLine(to: CGPoint(x: 12, y: 22))
            path.move(to: CGPoint(x: 12, y: 20))
            path.addQuadCurve(to: CGPoint(x: 7, y: 17), control: CGPoint(x: 8, y: 17))
            path.addQuadCurve(to: CGPoint(x: 12, y: 20), control: CGPoint(x: 7, y: 21))
            path.addEllipse(in: CGRect(x: 9.6, y: 6.6, width: 4.8, height: 4.8))
            for i in 0..<8 {
                let angle = Double(i) * .pi / 4
                path.addEllipse(in: CGRect(x: 10.4 + sin(angle) * 4.4, y: 7.4 + cos(angle) * 4.4, width: 3.2, height: 3.2))
            }
        case .pumpkins:
            path.addEllipse(in: CGRect(x: 4, y: 8, width: 16, height: 13))
            path.addEllipse(in: CGRect(x: 8, y: 8, width: 8, height: 13))
            path.move(to: CGPoint(x: 12, y: 8))
            path.addQuadCurve(to: CGPoint(x: 14, y: 3), control: CGPoint(x: 10, y: 4))
            path.move(to: CGPoint(x: 13, y: 6))
            path.addQuadCurve(to: CGPoint(x: 20, y: 5), control: CGPoint(x: 18, y: 2))
            path.addQuadCurve(to: CGPoint(x: 13, y: 6), control: CGPoint(x: 17, y: 8))
        }
        return path.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24)
            .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
    }
}

private extension Crop {
    var identifier: String {
        switch self { case .wheat: "wheat"; case .sunflowers: "sunflowers"; case .pumpkins: "pumpkins" }
    }
    var tint: Color {
        switch self { case .wheat: MeadowPalette.wheat; case .sunflowers: MeadowPalette.sunflowers; case .pumpkins: MeadowPalette.pumpkins }
    }
}

private extension FarmTool {
    var title: String {
        switch self { case .mow: "Mow"; case .cultivate: "Cultivate"; case .sow: "Sow"; case .harvest: "Harvest"; case .restore: "Restore grass"; case .wander: "Wander" }
    }
    var symbol: String {
        switch self { case .mow: "leaf"; case .cultivate: "line.3.horizontal"; case .sow: "camera.macro"; case .harvest: "basket"; case .restore: "arrow.uturn.backward"; case .wander: "wind" }
    }
    var color: Color {
        switch self {
        case .mow: MeadowPalette.mow
        case .cultivate: MeadowPalette.cultivate
        case .sow: MeadowPalette.sow
        case .harvest: MeadowPalette.gold
        case .restore: MeadowPalette.mow
        case .wander: MeadowPalette.wander
        }
    }
    var accessibilityDescription: String {
        switch self {
        case .mow: "Mow. Trim the meadow."
        case .cultivate: "Cultivate. Prepare soil for planting, clearing any crops."
        case .sow: "Sow. Plant your chosen crop in prepared soil."
        case .harvest: "Harvest. Gather mature crops into the field display."
        case .restore: "Restore grass. Remove crops and return the ground to grass."
        case .wander: "Wander. Just enjoy the ride."
        }
    }
}
