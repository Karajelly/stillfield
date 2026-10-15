import SwiftUI
import StillfieldCore

enum FarmSheet: String, Identifiable {
    case settings, help
    var id: String { rawValue }
}

private enum MeadowPalette {
    static let ink = Color(red: 0.23, green: 0.30, blue: 0.21)
    static let muted = Color(red: 0.39, green: 0.44, blue: 0.34)
    static let cream = Color(red: 0.97, green: 0.96, blue: 0.90)
    static let sage = Color(red: 0.85, green: 0.88, blue: 0.77)
    static let green = Color(red: 0.40, green: 0.49, blue: 0.32)
    static let gold = Color(red: 0.70, green: 0.57, blue: 0.29)
}

struct FarmScreen: View {
    @Bindable var game: FarmController
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let compactHeight = geometry.size.height < 500
            let wide = geometry.size.width >= 700
            ZStack {
                FarmViewport(game: game)
                    .ignoresSafeArea()

                LinearGradient(
                    stops: [.init(color: MeadowPalette.cream.opacity(0.72), location: 0),
                            .init(color: .clear, location: 0.30),
                            .init(color: .clear, location: 0.72),
                            .init(color: MeadowPalette.cream.opacity(0.68), location: 1)],
                    startPoint: .top, endPoint: .bottom
                )
                .ignoresSafeArea()
                .allowsHitTesting(false)

                if game.isLoading {
                    loadingCard
                } else if game.errorMessage != nil && !game.hasSaveError {
                    errorCard
                } else {
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

                    if !game.introDismissed {
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
                            .transition(.opacity)
                    } else if wide && !compactHeight {
                        fieldNote
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .padding(.leading, 40)
                            .padding(.top, 94)
                            .allowsHitTesting(false)
                    }

                    if let toast = game.toast {
                        Text(toast)
                            .font(.subheadline)
                            .foregroundStyle(MeadowPalette.ink)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(MeadowPalette.cream, in: Capsule())
                            .shadow(color: MeadowPalette.ink.opacity(0.08), radius: 14, y: 4)
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
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.35), value: game.introDismissed)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: game.isPaused)
        }
        .background(MeadowPalette.sage)
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
                            .foregroundStyle(MeadowPalette.muted)
                            .tracking(0.8)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Stillfield. A little farm, a little peace.")

            Spacer(minLength: 4)

            if width >= 1_050 {
                Label("Willowbrook farm", systemImage: "leaf.fill")
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 17)
                    .padding(.vertical, 12)
                    .background(MeadowPalette.cream.opacity(0.65), in: Capsule())
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
                            .foregroundStyle(MeadowPalette.muted)
                    }
                }
                .padding(.trailing, 14)
                .accessibilityElement(children: .combine)
            }

            HStack(spacing: 4) {
                roundButton(game.soundEnabled ? "speaker.wave.2" : "speaker.slash", label: game.soundEnabled ? "Turn nature sounds off" : "Turn nature sounds on", identifier: "action.sound", selected: game.soundEnabled) { game.toggleSound() }
                roundButton("pause", label: "Pause the meadow", identifier: "action.pause") { game.togglePause() }
                roundButton("slider.horizontal.3", label: "Open settings", identifier: "action.settings") { game.activeSheet = .settings }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func welcome(compact: Bool, wide: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 9 : 15) {
            if !compact {
                HStack(spacing: 8) {
                    Capsule().fill(MeadowPalette.gold).frame(width: 20, height: 1)
                    Text("THERE’S NO HURRY HERE")
                        .font(.system(size: 9, weight: .medium))
                        .tracking(1.5)
                }
                .foregroundStyle(MeadowPalette.muted)
            }
            (Text("A good day\nto take it ") + Text("slow.").italic())
                .font(.system(size: compact ? 27 : wide ? 45 : 35, weight: .regular, design: .serif))
                .lineSpacing(-1)
            if !compact {
                Text("A little fresh air. A few tidy rows.\nNothing you need to finish.")
                    .font(.system(size: wide ? 14 : 12))
                    .lineSpacing(5)
                    .foregroundStyle(MeadowPalette.muted)
            }
            Button(action: game.dismissIntro) {
                HStack(spacing: 17) {
                    Text("Let’s wander")
                        .font(.system(size: 13, weight: .medium))
                    Image(systemName: "arrow.right").font(.system(size: 13))
                }
                .padding(.horizontal, 19)
                .frame(minHeight: 46)
                .background(MeadowPalette.cream.opacity(0.94), in: Capsule())
                .overlay(Capsule().strokeBorder(MeadowPalette.ink.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("action.begin")
        }
        .fixedSize(horizontal: false, vertical: true)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .contain)
    }

    private var fieldNote: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle().fill(MeadowPalette.gold.opacity(0.7)).frame(width: 1, height: 44)
            VStack(alignment: .leading, spacing: 8) {
                Text("THE MEADOW").font(.system(size: 9, weight: .medium)).tracking(2)
                Text("Room to do your own thing.")
                    .font(.system(size: 13, design: .serif)).italic()
            }
        }
        .foregroundStyle(MeadowPalette.muted)
    }

    private func portraitFooter(wide: Bool) -> some View {
        VStack(spacing: wide ? 14 : 9) {
            Text(game.tool.caption)
                .font(.system(size: 12, design: .serif)).italic()
                .foregroundStyle(MeadowPalette.muted)
                .padding(.horizontal, 16)
                .padding(.vertical, 7)
                .background(MeadowPalette.cream.opacity(0.75), in: Capsule())
                .accessibilityHidden(true)
            toolDock(compact: false)
                .frame(maxWidth: wide ? 420 : 380)
            HStack(spacing: 8) {
                roundButton("questionmark", label: "How to play", identifier: "action.help") { game.activeSheet = .help }
                if wide {
                    Text(game.hasSaveError ? "Your meadow couldn’t save." : "Your little corner, saved.")
                        .font(.system(size: 11))
                        .foregroundStyle(MeadowPalette.muted)
                } else {
                    Button { game.activeSheet = .help } label: {
                        Text("Tap or drag\nto find your way")
                            .font(.system(size: 10))
                            .multilineTextAlignment(.leading)
                            .lineSpacing(2)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Learn to drive. Tap or drag to find your way.")
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
            roundButton("questionmark", label: "How to play", identifier: "action.help") { game.activeSheet = .help }
            Spacer(minLength: 0)
            toolDock(compact: true)
                .frame(maxWidth: 320)
            Spacer(minLength: 0)
            zoomControls
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func toolDock(compact: Bool) -> some View {
        HStack(spacing: 3) {
            ForEach(FarmTool.allCases, id: \.self) { tool in
                let selected = game.tool == tool
                Button { game.selectTool(tool) } label: {
                    VStack(spacing: compact ? 5 : 8) {
                        Image(systemName: tool.symbol)
                            .font(.system(size: compact ? 20 : 24, weight: .light))
                            .frame(height: compact ? 24 : 30)
                        Text(tool.title)
                            .font(.system(size: compact ? 10 : 11, weight: selected ? .semibold : .regular))
                    }
                    .foregroundStyle(selected ? MeadowPalette.ink : MeadowPalette.muted)
                    .frame(maxWidth: .infinity)
                    .frame(height: compact ? 58 : 74)
                    .background(selected ? MeadowPalette.sage.opacity(0.76) : .clear, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(alignment: .bottom) {
                        if selected { Capsule().fill(MeadowPalette.green).frame(width: 14, height: 2).padding(.bottom, 5) }
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
        .background(MeadowPalette.cream.opacity(0.97), in: RoundedRectangle(cornerRadius: 23))
        .overlay(RoundedRectangle(cornerRadius: 23).strokeBorder(.white.opacity(0.75), lineWidth: 1))
        .shadow(color: MeadowPalette.ink.opacity(0.12), radius: 18, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tractor tools")
    }

    private var zoomControls: some View {
        HStack(spacing: 0) {
            zoomButton("minus", label: "Zoom out", action: game.zoomOut)
            zoomButton("viewfinder", label: "Center the farm", action: game.recenter)
            zoomButton("plus", label: "Zoom in", action: game.zoomIn)
        }
        .background(MeadowPalette.cream.opacity(0.88), in: Capsule())
        .overlay(Capsule().strokeBorder(MeadowPalette.ink.opacity(0.08), lineWidth: 1))
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
                .background(selected ? MeadowPalette.sage.opacity(0.85) : MeadowPalette.cream.opacity(0.78), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private var pauseOverlay: some View {
        ZStack {
            MeadowPalette.cream.opacity(0.78).ignoresSafeArea()
            VStack(spacing: 22) {
                Image(systemName: "leaf")
                    .font(.system(size: 35, weight: .ultraLight))
                Text("A moment to breathe.")
                    .font(.system(.title, design: .serif))
                Text("The meadow will wait.")
                    .font(.subheadline)
                    .foregroundStyle(MeadowPalette.muted)
                Button(action: game.togglePause) {
                    Label("Back to the meadow", systemImage: "play.fill")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 24)
                        .frame(minHeight: 50)
                        .background(MeadowPalette.ink, in: Capsule())
                        .foregroundStyle(MeadowPalette.cream)
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
                            .foregroundStyle(MeadowPalette.muted)
                        Text("Settle in.").font(.system(size: 38, design: .serif))
                        Text("A few small comforts for your time outside.")
                            .font(.subheadline).foregroundStyle(MeadowPalette.muted)
                    }
                    VStack(spacing: 20) {
                        settingToggle("A helping hand", subtitle: "Gently straighten near-perfect rows.", isOn: $game.rowAssist, identifier: "settings.guide")
                        Divider().overlay(MeadowPalette.sage)
                        settingToggle("Golden light", subtitle: "A warmer kind of afternoon.", isOn: $game.goldenLight, identifier: "settings.golden")
                        Divider().overlay(MeadowPalette.sage)
                        settingToggle("A little feeling", subtitle: "Gentle haptics when you change tools.", isOn: $game.haptics, identifier: "settings.haptics")
                    }
                    .padding(20)
                    .background(.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 22))

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Your pace").font(.headline)
                        Slider(value: $game.pace, in: 0.55...1.25, step: 0.05)
                            .accessibilityLabel("Your pace")
                            .accessibilityValue(game.pace < 0.8 ? "Unhurried" : game.pace > 1.05 ? "A little breezier" : "Easygoing")
                            .accessibilityIdentifier("settings.pace")
                        HStack { Text("Unhurried"); Spacer(); Text("A little breezier") }
                            .font(.caption).foregroundStyle(MeadowPalette.muted)
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
                            .accessibilityLabel("Nature sounds volume")
                            .accessibilityValue("\(Int((game.volume * 100).rounded())) percent")
                            .accessibilityIdentifier("settings.volume")
                        HStack { Text("A whisper"); Spacer(); Text("All around you") }
                            .font(.caption).foregroundStyle(MeadowPalette.muted)
                    }
                    .padding(.horizontal, 4)

                    Button { confirmingReset = true } label: {
                        Label("A fresh meadow", systemImage: "arrow.counterclockwise")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(MeadowPalette.sage.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings.reset")

                    Text(game.hasSaveError ? "Your meadow couldn’t save. Free a little space on this device and try again." : "Your meadow saves automatically on this device. Nothing changes while you’re away.")
                        .font(.footnote)
                        .foregroundStyle(MeadowPalette.muted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding(26)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .background(MeadowPalette.cream)
            .foregroundStyle(MeadowPalette.ink)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { closeButton } }
            .confirmationDialog("A fresh meadow?", isPresented: $confirmingReset, titleVisibility: .visible) {
                Button("Start fresh", role: .destructive) { game.resetMeadow() }
                    .accessibilityIdentifier("reset.confirm")
                Button("Keep my meadow", role: .cancel) { }
            } message: {
                Text("Your paths, tilled rows, and wildflowers will return to untouched grass. This can’t be undone.")
            }
        }
        .tint(MeadowPalette.green)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
    }

    private var closeButton: some View {
        Button(action: { dismiss() }) {
            Image(systemName: "xmark").font(.system(size: 13, weight: .medium)).frame(width: 44, height: 44)
        }
        .accessibilityLabel("Close settings")
        .accessibilityIdentifier("sheet.close")
    }

    private func settingToggle(_ title: String, subtitle: String, isOn: Binding<Bool>, identifier: String) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(subtitle).font(.caption).foregroundStyle(MeadowPalette.muted)
            }
            .padding(.vertical, 4)
        }
        .accessibilityIdentifier(identifier)
    }
}

private struct FarmHelpSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    StillfieldMark().frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("WELCOME TO WILLOWBROOK").font(.caption2.weight(.medium)).tracking(1.7)
                            .foregroundStyle(MeadowPalette.muted)
                        Text("Make yourself\nat home.").font(.system(size: 38, design: .serif))
                        Text("There’s nothing to win and nowhere to fall behind. Just a little land to make your own.")
                            .font(.subheadline).foregroundStyle(MeadowPalette.muted).lineSpacing(4)
                    }
                    helpRow("hand.draw", title: "Find your way", text: "Tap a spot in the meadow to drive there. Drag your finger to keep steering. Pinch to look a little closer.")
                    helpRow("leaf", title: "Make your mark", text: "Mow soft paths, till tidy rows, or sow wildflowers. Choose Wander to enjoy the ride without changing the meadow.")
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
                        .foregroundStyle(MeadowPalette.cream)
                        .background(MeadowPalette.ink, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(28)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .background(MeadowPalette.cream)
            .foregroundStyle(MeadowPalette.ink)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .medium)).frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Close help")
                    .accessibilityIdentifier("sheet.close")
                }
            }
        }
        .tint(MeadowPalette.green)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
    }

    private func helpRow(_ symbol: String, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 17) {
            Image(systemName: symbol).font(.system(size: 24, weight: .light)).frame(width: 32, height: 32)
                .foregroundStyle(MeadowPalette.green)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.subheadline).foregroundStyle(MeadowPalette.muted).lineSpacing(4)
            }
        }
    }
}

private struct StillfieldMark: View {
    var body: some View {
        Canvas { context, size in
            let scale = size.width / 40
            context.scaleBy(x: scale, y: scale)
            var sun = Path()
            sun.addArc(center: CGPoint(x: 20, y: 18), radius: 9, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            context.stroke(sun, with: .color(MeadowPalette.gold), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            var field = Path()
            field.move(to: CGPoint(x: 3, y: 21))
            field.addQuadCurve(to: CGPoint(x: 37, y: 21), control: CGPoint(x: 20, y: 16))
            field.move(to: CGPoint(x: 5, y: 27))
            field.addQuadCurve(to: CGPoint(x: 35, y: 27), control: CGPoint(x: 20, y: 21))
            field.move(to: CGPoint(x: 9, y: 33))
            field.addQuadCurve(to: CGPoint(x: 31, y: 33), control: CGPoint(x: 20, y: 27))
            context.stroke(field, with: .color(MeadowPalette.green), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

private extension FarmTool {
    var title: String {
        switch self { case .mow: "Mow"; case .till: "Till"; case .sow: "Sow"; case .wander: "Wander" }
    }
    var symbol: String {
        switch self { case .mow: "leaf"; case .till: "line.3.horizontal"; case .sow: "camera.macro"; case .wander: "wind" }
    }
    var caption: String {
        switch self {
        case .mow: "A softer path, one row at a time."
        case .till: "Good things begin with a little earth."
        case .sow: "Leave a little color wherever you go."
        case .wander: "No particular place to be."
        }
    }
    var accessibilityDescription: String {
        switch self {
        case .mow: "Mow. Trim the meadow."
        case .till: "Till. Turn the earth."
        case .sow: "Sow. Plant wildflowers."
        case .wander: "Wander. Just enjoy the ride."
        }
    }
}
