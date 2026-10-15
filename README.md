# Stillfield

A little farm. A little peace.

A pastoral tractor playground for iPhone and iPad. Make soft mowing paths, till tidy rows, and sow ribbons of wildflowers around slow-turning windmills. No currency, deadlines, energy meters, quests, or offline penalties.

## Native iPhone and iPad app

The native app lives in `ios/`. SwiftUI provides the interface and settings; RealityKit renders the 3D meadow and tractor; AVAudioEngine synthesizes the wind, birdsong, and soft tractor hum. Tractor motion, field painting, and validated save files live in the local `StillfieldCore` Swift package.

The app supports iOS/iPadOS 18 or later, portrait and landscape, touch steering, pinch zoom, and optional haptics. Scene artwork and the app icon are bundled, and audio is generated on the device. Play works entirely offline, including the first launch. Meadows save atomically in the app’s Application Support directory. Nothing changes while the app is inactive.

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

The UI suite checks real touch/drag steering and field painting, repeated taps replacing the destination, steering after pinch zoom, wandering without painting, background/foreground stopping, tool selection, pausing, settings restoration, rotation, and reachable touch targets. It retains screenshots and uses a separate save file from regular play. Core tests also cover quick steering response, close destinations, braking on retargeting, and consistent movement at 30/60/120 Hz. Simulator results do not replace physical-device testing for performance, sound, and haptics.

### Native project and artwork maintenance

`ios/project.yml` is the XcodeGen source for the checked-in Xcode project and Info.plist. After changing project structure, regenerate with XcodeGen installed:

```sh
npm run ios:project
```

Native geometry was exported from the prototype’s original scene into `ios/Stillfield/Resources/FarmScene.json`, preserving the meadow’s low-poly artwork. The app loads those meshes directly into RealityKit. Native play uses no browser, web view, JavaScript engine, or development server.

To rebuild the bundled artwork and icon after changing their sources:

```sh
npm install
npm run ios:assets
```

Commit regenerated resources and project changes alongside their source changes. Build output and personal Xcode settings are ignored.

## Play

- Tap a destination or drag across the meadow to steer. Pinch or use the zoom buttons to change your view.
- A cream ring marks your destination. Tap again to redirect the tractor immediately; its cruising pace stays gentle.
- Choose **Mow**, **Till**, **Sow**, or **Wander**. Wandering leaves the field as it is.
- The pause button gives you a moment to breathe.
- Settings control pace, gentle row alignment, golden light, haptics, and nature-sound volume.
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
