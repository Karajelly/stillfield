# Crop and harvest study

A sandbox for a design study of Stillfield's crops, harvest and reward. It asks why growing and harvesting feel flat, and tries an answer you can run: fuller plants, growth that never stops, a harvest pass you can see and hear, and a field that keeps what you cut.

Nothing here is part of the game. The sandbox imports the game's modules (`src/world.ts`, `src/tractor.ts`, `src/field.ts`, `src/farming.ts`, `src/wind.ts`, `src/daylight.ts`, `src/follow-camera.ts`, `src/audio.ts`) and changes none of them. `npm run build` never reads this folder, and the root type check does not cover it.

## Run it

```sh
npm install
npm run dev
```

Then open `/study/` on the address Vite prints. There are two demos:

- **A season.** Three lanes sown back and forth, then left to grow. Scrub the season, or play it. Switch between Today (the shipping `src/field.ts`) and Proposed.
- **A harvest pass.** Four ripe lanes harvested the way tidy rows work them, in either look, from either camera.

Both looks are given exactly the same work through the game's own `FarmingEngine`, so switching compares the drawing and nothing else.

To check the sandbox:

```sh
npx tsc -p study --noEmit
```

## What is in here

| File | What it is |
|---|---|
| `src/crops.ts` | The proposed plants, stubble and bundles, built in code like the rest of the game's artwork. |
| `src/plant-material.ts` | One material for every plant. Growing, ripening, leaning in the wind and falling to the cutter all happen in the vertex shader. |
| `src/study-field.ts` | The proposed field renderer. It reads a `FarmingEngine` and draws only what is planted. The bundle rule lives here. |
| `src/reaper.ts` | A harvest implement that hangs from the tractor's existing hitch. |
| `src/harvest-sound.ts` | Harvest voices built on the wind's tuning in `src/wind.ts`. |
| `src/yard.ts` | A sketch of a barn-side display that keeps growing. |
| `src/stage.ts` | The game's renderer settings, lights and cameras, copied from `src/main.ts`. |
| `src/twin-field.ts`, `src/demos.ts` | The two demos. |
| `src/shots.ts`, `shots.html` | A capture surface for stills. |
| `src/sound-check.ts`, `sound-check.html` | Renders the harvest voices offline and reports their levels. |
| `vite.config.ts` | Builds the demos into one script: `npx vite build --config study/vite.config.ts`. |

## What it does not do

- **It is web only.** Nothing here was built or run for the native app.
- **Stubble's crop is kept beside the engine.** The engine clears a square's crop when it is harvested, so the sandbox remembers it in `study-field.ts`. Bundles in the real game would need stubble to remember its crop in both engines.
- **The harvest voices are measured, never heard.** `sound-check.html` shows they render and where they peak. Their character needs an ear.
- **The yard is a sketch.** The steps are worked out; the layout is not.
- **Cost is counted in triangles.** The sandbox was built on a machine that renders in software, so it has no frame rates to offer.
