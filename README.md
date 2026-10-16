# Stillfield

A little farm. A little peace.

A pastoral tractor playground for iPhone and iPad. Make soft mowing paths, till tidy rows, and sow ribbons of wildflowers around slow-turning windmills. No currency, deadlines, energy meters, quests, or offline penalties.

## Native iPhone and iPad app

The native app lives in `ios/`. SwiftUI provides the interface and settings; RealityKit renders the 3D meadow and tractor; AVAudioEngine synthesizes the wind, birdsong, and soft tractor hum. Tractor motion, field painting, and validated save files live in the local `StillfieldCore` Swift package.

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

The UI suite checks real touch/drag steering and field painting, release without continued turning, repeated taps replacing the destination, steering after pinch zoom, wandering without painting, background/foreground stopping, tool selection, pausing, settings restoration, rotation, and reachable touch targets. It also checks switching into tractor view while driving, camera following, perspective steering, separate zoom levels, and restoring the view after relaunch. It retains screenshots and uses a separate save file from regular play. Core tests cover work-through endpoints, nearby row-end taps that align and stop, six consecutive player-selected rows 2.5 m apart, tool changes during arrivals, close destinations, consistent movement at 30/60/120 Hz, camera smoothing and obstacle clearance, perspective ground projection, and loading older saves. Simulator results do not replace physical-device testing for performance, sound, and haptics.

### Native project and artwork maintenance

`ios/project.yml` is the XcodeGen source for the checked-in Xcode project and Info.plist. After changing project structure, regenerate with XcodeGen installed:

```sh
npm run ios:project
```

Native geometry is exported from `src/tractor.ts` and `src/world.ts` into `ios/Stillfield/Resources/FarmScene.json`. The shared artwork uses rounded enamel bodywork, curved fenders, cushioned tires, and soft tree crowns; the native field renderer adds curved grass and petaled wildflowers. RealityKit loads the bundled meshes directly, with locally generated diffuse daylight. Native play uses no browser, web view, JavaScript engine, or development server.

The web palette is the visual reference: `FarmScreen.swift` mirrors the sRGB colors and vignette in `src/style.css`, `FieldRenderer.swift` mirrors the ground and vegetation swatches in `src/field.ts`, and native daylight uses the light colors in `src/main.ts`. Keep those pairs in sync when changing colors. `FarmViewport.swift` softens RealityKit's scene output to approximate the web's ACES filmic finish on iOS 18 and later; UI colors stay outside that treatment. Check both normal and golden light when adjusting the palette.

To rebuild the bundled artwork and icon after changing their sources:

```sh
npm install
npm run ios:assets
```

Commit regenerated resources and project changes alongside their source changes. Build output and personal Xcode settings are ignored.

## Play

- Tap where mowing, tilling, or sowing should finish. The tractor continues until its trailing implement works that square, then stops. In overhead view, drag across the meadow to keep choosing destinations. Pinch or use the zoom buttons to change your view.
- In the native app, tap the vehicle button beside the zoom controls to switch into **Tractor view**, a perspective view following behind you. Hold to roll, move left or right from where you touched to steer, return to center to go straight, and lift to coast to a stop. A quick tap still chooses a work endpoint. Pinch to adjust camera distance. Each view keeps its own zoom during play, and your chosen view saves with your meadow.
- After a straight row, let the tractor settle and tap the neighboring ground beside its end. It lifts the implement, turns into your chosen spot, faces back along the row, works the spot, and stops ready for your next input. There are no suggested lanes, spacing correction, or automatic next passes.
- A cream ring stays on the spot you chose. Tap again to redirect the tractor; its cruising pace stays gentle. The 2.57 m working swath matches the visible deck and covers its continuous movement between frames.
- Choose **Mow**, **Till**, **Sow**, or **Wander**. Wandering leaves the field as it is.
- The pause button gives you a moment to breathe.
- Settings control pace, golden light, haptics, and nature-sound volume. The tractor cruises at 3 m/s by default; the pace slider reaches 4.5 m/s.
- Enable sound with the speaker button for wind, birds, and a soft tractor hum.
- Your field, tractor position, tool, and settings save on this device. There is no account or cloud sync.
- **Settings → A fresh meadow** asks before clearing the field. The rest of your preferences stay in place.

## Original web prototype

The browser proof of concept remains in `src/` and `public/`. It uses Vite, TypeScript, Three.js, and Web Audio, with generated geometry and ground textures, a compact field grid, and instanced vegetation.

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

The browser version also supports arrow keys/WASD to steer, number keys 1–4 to switch tools, and Space or Escape to pause.

Deploy `dist/` at the root of an HTTPS static host for browser installation and offline caching. Safari → Share → Add to Home Screen opens the prototype as a standalone web app. The HTTP LAN preview cannot register a service worker; browser offline play requires an HTTPS production deployment and one successful initial visit. Fonts, icons, and production assets are bundled locally and precached.

Browser saves belong to their browser and origin. Native app saves belong to the installed app. They are separate meadows; there is no automatic migration between them.
