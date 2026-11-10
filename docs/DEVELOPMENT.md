# Development guide

Technical notes for the native iPhone/iPad app, the shared farming engine, and the browser version. For a quick start, see the [README](../README.md).

## Native iPhone and iPad app

The native app lives in `ios/`. SwiftUI provides the interface and settings; RealityKit renders the 3D meadow and tractor; AVAudioEngine synthesizes the wind, birdsong, and soft tractor hum. Tractor motion, the farming engine, and validated save files live in the local `StillfieldCore` Swift package.

The app supports iOS/iPadOS 18 or later, portrait and landscape, touch steering, pinch zoom, and optional haptics. Scene artwork and the app icon are bundled, and audio is generated on the device. Play works entirely offline, including the first launch. Meadows save atomically in the app’s Application Support directory. Nothing changes while the app is inactive.

Portrait farm view looks along the meadow’s longer rows, with the barn above and the pond below, leaving room for the tools and a quiet welcome. Landscape keeps the broad countryside view. Rotating the device reframes the same meadow without moving saved paths or changing your zoom. The browser prototype uses the same portrait composition.

### Run in Xcode

Open the checked-in project on a Mac with full Xcode and an iOS Simulator runtime installed:

```sh
open ios/Stillfield.xcodeproj
```

Select the **Stillfield** scheme, choose an iPhone or iPad simulator, and press **Run**. The project was generated with Xcode 27. The native app has no external Swift package dependencies, and opening or building it does not require Node or XcodeGen.

To run on a physical iPhone or iPad, select the **Stillfield** target → **Signing & Capabilities**, choose your own development team, and use a bundle identifier available to that team. Select your connected device and run. Device signing, hardware performance checks, and App Store distribution use your Apple developer account.

### Command-line build and checks

Convenience commands run from the repository root:

```sh
npm run ios:open
npm run ios:build
npm run ios:test
```

`ios:build` produces an unsigned simulator build in `ios/.build`. `ios:test` runs the pure Swift core tests for tractor movement, collisions, field tools, brush boundaries, save round trips, and corrupt-save handling. These commands default to `/Applications/Xcode.app/Contents/Developer`; set `DEVELOPER_DIR` if your Xcode installation lives elsewhere.

To run the native UI test, supply the name or identifier of an installed simulator. For example:

```sh
npm run ios:test-ui -- -destination 'platform=iOS Simulator,name=iPhone 17'
```

The UI suite checks real touch/drag steering and field painting, release without continued turning, repeated taps replacing the destination, steering after pinch zoom, wandering without painting, background/foreground stopping, tool selection, pausing, settings restoration, rotation, and reachable touch targets. It also checks switching into tractor view while driving, camera following, perspective steering, separate zoom levels, and restoring the view after relaunch. A touch-driven farming test harvests the starter wheat, cultivates and sows sunflowers, waits for active-play growth, harvests into the display, and checks relaunch persistence. A second farming test follows pumpkins through sowing, growing, and harvesting into their cart. Farming UI tests use a debug-only 45-second growth configuration; normal play retains the 3/6/9-minute durations. Crop buttons are checked for selection, persistence, and touch targets in portrait and landscape. The suite retains screenshots and uses a separate save file from regular play. Core tests cover work-through endpoints, nearby row-end taps that align and stop, six consecutive player-selected rows 2.5 m apart, tool changes during arrivals, close destinations, consistent movement at 30/60/120 Hz, camera smoothing and obstacle clearance, perspective ground projection, and loading older saves. Simulator results do not replace physical-device testing for performance, sound, and haptics.

### Native project and artwork maintenance

`ios/project.yml` is the XcodeGen source for the checked-in Xcode project and Info.plist. After changing project structure, regenerate with XcodeGen installed:

```sh
npm run ios:project
```

Native geometry is exported from `src/tractor.ts` and `src/world.ts` into `ios/Stillfield/Resources/FarmScene.json`. The shared artwork uses rounded enamel bodywork, curved fenders, cushioned tires, and soft tree crowns; the native field renderer adds curved grass, four stages of crops, and harvest displays. RealityKit loads the bundled meshes directly, with locally generated diffuse daylight. Native play uses no browser, web view, JavaScript engine, or development server.

The web palette is the visual reference: `FarmScreen.swift` mirrors the sRGB colors and vignette in `src/style.css`, `FieldRenderer.swift` mirrors the ground and vegetation swatches in `src/field.ts`, and native daylight uses the light colors in `src/main.ts`. Keep those pairs in sync when changing colors. `FarmViewport.swift` softens RealityKit's scene output to approximate the web's ACES filmic finish on iOS 18 and later; UI colors stay outside that treatment. Check both normal and golden light when adjusting the palette.

To rebuild the bundled artwork and icon after changing their sources:

```sh
npm install
npm run ios:assets
```

Commit regenerated resources and project changes alongside their source changes. Build output and personal Xcode settings are ignored.

## Farming engine

`src/farming.ts` and `ios/StillfieldCore/Sources/StillfieldCore/FieldGrid.swift` own the same deterministic loop. The 45 × 25 m field contains a 90 × 50 grid: 4,500 cells, each 50 cm square. Each cell has a visible plant location, with gentle jitter kept inside its square. Navigation supplies swept implement positions, action, and crop. Each field owns its cells and one display location; the MVP has one field, stored under the legacy `willowbrook` ID. Rendering and audio consume batched ground-change, visual-stage, crop-maturity, and harvest-result events. Display effects are brief, crop-specific, and respect reduced motion.

Tune `FARMING_CONFIG` on the web and `FarmingConfiguration` in Swift. Defaults are 180/360/540 seconds for sunflowers/wheat/pumpkins, a 1.25 m implement radius plus 0.25 m edge coverage, and display thresholds of 1, 64, and 256 area units. Each harvested 50 cm cell contributes four units, preserving the original harvest area and display pacing; a new display reaches its three stages after 1, 16, and 64 cells. Counts saturate at the final threshold; later harvest events still fire. All growth uses normalized progress saved at full precision; the game supplies active elapsed time independently of movement’s frame cap.

Version 3 saves use the 50 cm grid. Version 1 and 2 meadows migrate by fitting the entire old field into the new bounds. Crops take precedence over bare ground; mixed cells keep their most common crop (ties use wheat, sunflowers, then pumpkins) and its furthest growth. Other mixed ground favors prepared soil, then stubble, then mown grass. Display contents remain exact. The original save is backed up before its first replacement: `stillfield-before-grid-v3` in browser storage, or a `meadow-before-grid-v3-*.json` sibling on iOS. Old wildflowers become mature sunflowers. Native invalid saves remain protected by recovery copies. A fresh meadow clears crops and displays; the starter plots appear only on a new farm.

Engine tests exercise all state/action combinations, cultivating through growing and mature crops without harvest rewards, repeated passes, every crop’s four stages and duration, mixed-crop rest, inactive time, continuous coverage including adjacent diagonal passes, full/cleared displays, save round trips, and legacy grid migration with backups.

## Original web prototype

The browser proof of concept remains in `src/` and `public/`. It uses Vite, TypeScript, Three.js, and Web Audio, with generated geometry and ground textures, a compact field grid, and instanced vegetation.

Stillfield is the browser’s farm identity. Landscape labels mark Windmill hill, the barn, the pond, and the field; they stay anchored when zooming, clear the controls, and fade when driving begins. Compact and portrait layouts keep the landscape free of labels.

```sh
npm install
npm run dev
```

Vite prints a local URL and a network URL. On an iPad on the same Wi-Fi, open the network URL in Safari. Keep the development server running while playing.

```sh
npm test
npm run build
npm run preview
```

The browser version supports arrow keys/WASD along the field's rows and columns. Directions follow the view: W/↑ chooses the grid axis pointing most upward, and the mapping rotates with the farm in a narrow window. A held key keeps its direction through resizing; the next press uses the new view. The most recently pressed direction wins when keys overlap, so movement stays on one grid axis.

Changing direction pivots in place through 90° turns before driving, with the implement lifted. A quick tap toward another direction finishes the turn without advancing; hold to drive, and release to stop. Reversals use two quarter turns in the same cell. Number keys 1–4 switch tools; Space or Escape pauses.

### Day, wind, and postcards

Three features live only in the browser version for now. None of them touches the farming engine, so `src/farming.ts` and `FieldGrid.swift` still match, and none of them edits `src/world.ts` or `src/tractor.ts`, so `FarmScene.json` does not need regenerating.

- **`src/daylight.ts`** is a pure table of light keyframes over a 720-second day (`DAY_SECONDS`), with eased interpolation between them. `daylightAt(seconds)` returns the sun or moon colour, strength and direction, the hemisphere light, the sky colour, exposure, a `glow` value (0 by day, 1 after dark) that drives every lamp, and a `birds` value for the soundscape. The first keyframe is the original morning light and the golden-hour keyframe is the original golden light. `main.ts` advances the hour with the same active-play seconds it gives the crops and saves it as `day`; `light` holds `flow` or a kept time of day. An older save with `golden: true` loads as a held golden hour. The page-edge haze follows the sky through the `--haze` CSS variable, and `body.after-dark` switches text drawn straight on the scene to cream.
- **`src/dusk.ts`** adds the lit window panes, two lamp pools, the tractor's lamps and beam, and the pond fireflies as separate objects placed against the geometry in `world.ts` and `tractor.ts`. If the barn, windmill, or headlamp positions move there, move them here too. The three extra lights stay in the scene at zero intensity by day so that shaders are not recompiled at dusk.
- **`src/wind.ts`** schedules gusts (`Wind`) and reads the field as a score (`sliceNotes`). A gust crosses 1 m per beat (`WIND.stepSeconds`); each beat looks at a 2-column slice in ten 5-row lanes and returns at most two wheat notes, two sunflower notes, one pumpkin note on even beats, and one stubble brush on odd beats. A lane sounds once its slice is about a third grown, and a full field walks through its lanes rather than sounding them all. `windFrequency` maps lanes to two octaves of D major pentatonic, or minor after dark. `FarmAudio.windNote` synthesizes the four voices; `field.wind` leans the instanced plants near the gust front and is skipped under reduced motion, which keeps the sound.
- **`src/postcard.ts`** renders one frame at 1800 × 1200 through the game's own renderer, so the picture has the same tone mapping as the screen, then draws it onto a 2D canvas card with the caption. Nothing leaves the device unless the player saves or shares the PNG.

In a development build, `__STILLFIELD__.setDay(seconds)` jumps to an hour and `__STILLFIELD__.gust()` starts a gust, so neither needs waiting for. `src/daylight.test.ts` and `src/wind.test.ts` cover the keyframe loop and its smoothness, the held lights, note selection for every ground state, tuning, and gust timing at different frame rates.

Deploy `dist/` at the root of an HTTPS static host for browser installation and offline caching. Safari → Share → Add to Home Screen opens the prototype as a standalone web app. The HTTP LAN preview cannot register a service worker; browser offline play requires an HTTPS production deployment and one successful initial visit. Fonts, icons, and production assets are bundled locally and precached.

The web favicon and home-screen icons use Meadow Loop, with the original artwork in `assets/branding/meadow-loop.png`. `npm run icons` generates 16/32/48 px PNG favicons and a multi-size `favicon.ico` with rounded, transparent corners, plus the opaque 180 px Apple touch icon, 192/512 px PWA icons, and a separate 512 px maskable icon with extra space around the tree and tractor. `npm run build` regenerates these before bundling and precaching them. The native artwork exporter still uses `public/icon.svg` for the iOS app icon.

Link previews use **A Little Farm**, the 1200 × 630 JPEG in `public/og-image.jpg`, with a lossless master in `assets/branding/a-little-farm.png`. Static Open Graph and large-image Twitter card metadata live in `index.html`, with `https://stillfield.io/` as the canonical URL. Vite copies the image into `dist/` and the service worker precaches it.

Browser saves belong to their browser and origin. Native app saves belong to the installed app. They are separate meadows; there is no automatic migration between them.
