# Contributing to Stillfield

Thanks for wanting to help. Pull requests are welcome, and so are issues, ideas, and bug reports. Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## The one big rule: keep it calm

Stillfield is deliberately quiet. There is no currency, no timers that punish you, no energy meters, no quests, and no penalty for stepping away. Changes that add pressure, streaks, monetization, notifications, or analytics won't be merged, however well built. If you're unsure whether an idea fits, open an issue and ask before you write code.

Good contributions include:

- Bug fixes and extra tests
- Accessibility improvements (reduced motion, contrast, VoiceOver, touch targets, keyboard play)
- Performance and battery improvements
- Polish for specific devices and screen sizes
- Small quality-of-life improvements that keep the calm

## Getting started

You can work on the web version with Node (any recent version) alone. You need a Mac with Xcode for the native app.

```sh
git clone https://github.com/Karajelly/stillfield.git
cd stillfield
npm install
npm run dev        # browser version with hot reload
```

For the native app, open `ios/Stillfield.xcodeproj`, choose the **Stillfield** scheme and a simulator, and run. See the [development guide](docs/DEVELOPMENT.md) for details.

## Before you open a pull request

Run the checks for the part you changed:

```sh
npx tsc --noEmit   # type-check the web code
npm test           # web engine and navigation tests
npm run ios:test   # native core tests (needs Xcode)
```

If your change affects the native UI, also run `npm run ios:test-ui -- -destination 'platform=iOS Simulator,name=<an installed simulator>'`. See the development guide for the details.

Some things to keep in mind:

- **The web and native apps share one design.** The farming engine exists in both TypeScript (`src/`) and Swift (`ios/StillfieldCore/`) and must behave identically. If you change engine behavior, change both and add or update tests on both sides.
- **Keep colors in sync.** The web palette is the visual reference, and the native app mirrors it. The development guide lists which files pair up.
- **Don't hand-edit generated files.** `ios/Stillfield/Resources/FarmScene.json` is exported from `src/tractor.ts` and `src/world.ts` with `npm run ios:assets`. The Xcode project is generated from `ios/project.yml` with `npm run ios:project`. Commit regenerated output alongside the source change that caused it.
- **No new dependencies without discussion.** The native app deliberately has no external Swift packages, and the web build has only a few small dependencies.
- **Keep pull requests focused.** One change per PR is easier to review. Please include a short description of what changed and why, and a screenshot or short clip for anything visual.

## Artwork and branding

The code is MIT-licensed, but the Stillfield name, icons, and artwork are not. See [BRANDING.md](BRANDING.md). Please don't open pull requests that replace or restyle the reserved artwork. If you have art ideas, open an issue to discuss them first.

By submitting a pull request, you agree that your contribution to the code is licensed under the project's [MIT License](LICENSE).

## Reporting bugs and security issues

For bugs, [open an issue](https://github.com/Karajelly/stillfield/issues) with the device or browser, the OS version, and steps to reproduce. Screenshots help. To report a security problem, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
