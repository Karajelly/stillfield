# Tractor handling exploration

Recommendation: in both views, a ground tap with Mow, Till, or Sow marks where the work should finish. Preserve isometric destination driving, improve pass coverage, and give continuous third-person dragging its own camera-independent control model. Wander continues to use the tractor's stopping point.

This is an isolated experiment on `sandbox/tractor-handling`, based on `4acab01`. Production files in `src/` and `ios/` are unchanged. It has no save writes. The browser preview is at **http://127.0.0.1:5187/lab.html** while the local server runs.

## Try it

1. In **Third person**, choose **Current**, then **Replay turn & release**. Repeat with **Proposed**. The scripted drag goes right with small finger tremor, then releases after 1.5 seconds.
2. Try a real drag in **Proposed**: hold to roll, move left/right from the point where you started to turn, return to that small center zone for straight travel, and lift to coast to a stop. Holding an offset intentionally continues the turn; a quick tap marks a fixed work endpoint. This differs from a drag that keeps navigating after release.
3. In **Isometric**, use **Compare adjacent passes** in each version. This is a controlled painting study, not an autonomous driving feature. It shows the coverage of six strokes, each aimed roughly 2.5 m beside the previous one.
4. Try a real isometric pass across the field, turn around, and aim beside it. Proposed row assistance only engages on deliberate, nearly cardinal passes. Turn it off to make freeform patterns. The faint line indicates the active row.
5. **Comparison → Web logic** uses the actual existing web movement function in isometric view. The web checkout does not contain third person; third person here is a TypeScript replay of the native movement/camera on the web artwork.
6. In either view, choose **Work through the far square**. This performs a real drive to the last field square. Compare **Current**, which stops the tractor short of working that square, with **Proposed**, which finishes the square and settles beyond it. The small outline stays on the selected square. Try Mow, Till, and Sow; Wander still stops the tractor at the selected location without working the field.

All profile/camera changes restart the sandbox meadow for comparison. Zoom, all four tools, keyboard steering, Stop, and Start fresh are available. Preview settings are deliberately for experimentation, not proposed product UI.

To restart:

```sh
cd ~/Projects/farmist-handling-sandbox
npm run dev -- --host 127.0.0.1 --port 5187 --strictPort
```

## Findings in the current code

| Finding | Why it matters | Evidence |
| --- | --- | --- |
| Dragging repeatedly raycasts through the turning follow camera | Even small pointer movements can choose new world directions as the camera moves. A low screen point can be behind the tractor. | `FarmController.swift:197`, `TractorFollowCamera.swift:20` |
| Native drag has no end handler; web pointer-up only releases capture | The last destination remains active, so the tractor can keep steering/driving after a finger lifts. This is destination following, not angular momentum in the physics model. | `FarmViewport.swift:33`, `src/main.ts:451` |
| Native maximum turn rate is 4.8 rad/s; web is 2.4 rad/s | Roughly 275°/s native and 138°/s web. Native can complete an 80° correction in about 0.3 s in the scripted test. | `FarmSimulation.swift:70`, `src/simulation.ts:46` |
| Native acceleration response is 10/s and braking 14/s | Speed responds much more sharply than web, which uses 3.8/s acceleration and 7/s stopping. Simply adding camera lag would mask rather than resolve this disagreement. | `FarmSimulation.swift:80`, `src/simulation.ts:51` |
| Row help snaps heading within 0.13 rad (7.45°), with no memory of a lane | Parallel passes can still be too far apart. The snap threshold has no separate enter/exit band. | `FarmSimulation.swift:64`, `src/simulation.ts:37` |
| Brush diameter is 2.30 m; visible mower deck is 2.57 m wide | Visually adjacent passes can leave a narrow unworked strip. | `FieldGrid.swift:49`, `src/field.ts:169`, `src/tractor.ts:175` |
| Paint stamps are gated at 24 Hz; the attachment is 2.1 m behind the tractor | At 30 Hz, stamps fall every other frame, about 0.31 m apart at default cruise. That is small compared with the brush width; large straight-row gaps are primarily spacing/width, not skipped stamps. The trailing attachment also needs room to clear row ends. | `FarmController.swift:379`, `src/main.ts:645` |
| Camera obstruction recovery immediately restores the boom length | Passing scenery can produce a sudden dolly. This is a separate contributor from steering. | `TractorFollowCamera.swift:43`, its current obstacle-clearance test |

The screenshot alone cannot distinguish every remaining grass tuft from missed coverage. These findings identify reproducible mechanisms; they do not assert that every visible gap has the same cause.

## Proposed behavior

### Isometric: keep the familiar feel

- Keep tap/drag destination navigation and the existing view-specific movement response during the first iteration.
- Use a 2.50 m working swath, close to the visible deck. Sweep between attachment samples so curves remain continuous at different rendering rates.
- Offer an adjacent row 2.15 m from the previous straight pass, giving about 14% overlap. Capture only when the player is already aiming nearby (within 0.55 m). Deliberate movement away releases assistance.
- Use hysteresis for row direction: enter around 7.5°, leave around 16°. Remember successful long passes rather than imposing a world grid immediately.
- Show at most a faint row/implement cue. Keep completion percentages, automatic U-turns, and automatic filling of garden spaces out of play.
- Ground taps and the endpoint of an isometric drag mark where work should finish. The attachment covers the entire selected square before completing, and the tractor settles beyond it. This behavior also applies to quick ground taps in third person.

### Work endpoints in both views

The endpoint prototype now follows the user's clarified intent: **work through the selected square**. The marker remains on that point; a separate vehicle approach accounts for the 2.1 m trailing attachment, its actual footprint, and a gentle finish. Completion checks the whole square against the tool footprint and flushes the final paint sweep even if the normal paint interval has not elapsed. It does not depend on whether the square was already painted in a previous pass.

The tool stops painting once the square is finished, while the tractor coasts briefly. A nearby square already inside the current swath uses forward travel where possible. Tight sideways or reverse taps allow the tractor to slow and line up first, avoiding an endless orbit around a target. The final approach stays fixed as the tractor passes the marked point. Retargeting replaces it, and tool changes re-evaluate the active work destination.

Wander and points outside the working field keep normal tractor-destination behavior. Continuous third-person drag steering has no selected ground endpoint and retains release-to-stop behavior. Obstructions still stop travel; an unreachable square is reported as needing a different approach rather than being painted remotely.

### Third person: a calm steering gesture

- Separate quick taps from continuous dragging. A quick tap captures one work endpoint (or tractor destination for Wander). A drag controls steering relative to its starting point, independent of camera projection.
- Start with a 10 pt/px neutral zone, a gradual response curve, and about 110 pt/px travel to full steering. These are starting values to tune on touch hardware.
- Cap continuous-drag turning near 69°/s; use up to 80°/s for a deliberate tap turn. Slow forward travel in tight turns. Keep default straight cruising speed unchanged.
- Remove steering input immediately at neutral/release. Coast forward briefly and settle in roughly half a second. Tap navigation still continues to its destination.
- The gesture needs a small transient center cue. Holding an offset continues to turn; returning to the cue goes straight. Test whether this feels natural before choosing it over a world-anchored heading gesture.
- Do not add a large camera delay. Keep a level camera, ignore very small heading changes, and ease the boom outward after scenery clears. Clearance can still require immediate inward movement; that remains a device-review case.

These are candidate defaults, not final production constants. A heading-selection drag, where a stable finger eventually settles to a fixed heading, is a useful alternative if continuous wheel-like steering still feels too active. This sandbox implements the wheel-like candidate only.

### Consistency across platforms

Define the same gesture lifecycle and tuning per view on native and web. Share behavioral scenarios and expected ranges even though Swift and TypeScript implementations remain separate. Preserve saved fields and preferences; store no unfinished drag or steering velocity in saves.

For a first production iteration, prioritize work endpoints in both views, drag/tap classification, release handling, cancellation/pinch behavior, lower follow-view turn rates, and swath width. Add stateful adjacent-row capture after the basic feel is accepted. Camera clearance return can be tuned independently. Preserve ordinary isometric cruising response; the endpoint prototype slows the finishing approach and tight retargets.

## Measurements

`measure.ts` runs deterministic model experiments. Full output is in `measurements.json`.

At 60 Hz on a 402 × 874 virtual viewport:

| Experiment | Current native replay | Proposed |
| --- | ---: | ---: |
| Maximum yaw during scripted forward-ground drag | 275°/s | 43°/s for this partial drag; cap 69°/s |
| Distance traveled after releasing that drag | 9.40 m, continuing toward the destination | 0.32 m |
| Time from release to rest | 2.45 s | 0.53 s |
| Tractor turn after release, drag near lower tractor area | 69.5° | 0° |
| Camera yaw still settling after forward-ground drag release | 25.0° | 4.9° |

These are behavior comparisons, not performance benchmarks. The current version deliberately retains a destination; the proposed drag deliberately releases it. Exact results depend on gesture position and viewport. With centered ±2 px tremor on forward ground, both versions stayed straight because current row assistance already suppresses that small error. Low-screen dragging is much less stable: at screen y = 57%, the initial center ground hit is 0.77 m behind the tractor in portrait, versus 1.02 m ahead in the landscape measurement.

Across 30/60/120 Hz, the proposed scripted drag added no tractor yaw after release, stopped in 0.53–0.54 s, and coasted 0.30–0.34 m. Camera settling still adds a small, separate visual turn.

For the six-pass coverage study, missed interior cells were:

| Configuration | Missed cells inside the study |
| --- | ---: |
| Current 2.30 m brush, approximate 2.5 m spacing | 8.47% |
| Wider 2.50 m brush only | 4.48% |
| Swept painting only | 7.84% |
| Adjacent-row spacing only | 0% |
| Wider, swept brush plus spacing | 0% |

The metric excludes row ends, turns, obstacles, and the outer borders. Assisted passes cover a **narrower total band** for the same six strokes, so this is not a claim of completing the same field in the same number of passes. It shows how overlap removes interior slivers in this controlled case. The browser coverage preview uses dense strokes to emphasize lateral spacing; the numerical study separately tests the actual 30 Hz sampling cadence.

## Validation and limits

- Existing web suite: 23 tests passed.
- Existing Swift core suite: 37 tests passed.
- Sandbox TypeScript type checking passed.
- Baseline replay compared directly with the unmodified Swift movement and camera in nine scenarios, at 30/60/120 Hz, including retargeting and obstruction. Maximum numeric difference: 3.6 × 10⁻¹⁵.
- Sandbox assertions cover release yaw, stopping distance/time, refresh rates, deadzone, row capture, reverse/nearby tap arrival, tractor clearance, and smooth camera boom return.
- Work endpoint checks: 525 model scenarios passed, including all three working tools at 30/60/120 Hz, all four field edges, a diagonal corner, close/sideways/reverse taps, moving retargets, adjacent-row assistance, Wander, and a blocked destination. Details are in `endpoint-measurements.json`. In the straight far-edge example, the selected square remained untouched with tractor-destination semantics and was worked with the new endpoint semantics. The tractor settled roughly 0.9–1.1 m beyond the field edge. The `gentle` model compares the new follow controller with and without work endpoint semantics; it is not a second shipping native baseline.
- Browser UI verification covers the actual rendered sandbox, A/B turn replays, current/proposed coverage studies, a real mouse drag/release, and far-square completion with Mow in third person and Sow in isometric view. This is not a physical-device assessment of touch feel, frame pacing, gesture cancellation, pinch conflicts, or motion comfort.

Run the sandbox checks:

```sh
node --import tsx sandbox/measure.ts
node --import tsx sandbox/endpoint-measure.ts
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable sandbox/lab.ts sandbox/handling.ts sandbox/field.ts sandbox/measure.ts sandbox/parity.ts sandbox/endpoint-measure.ts
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swiftc ios/StillfieldCore/Sources/StillfieldCore/FarmSimulation.swift ios/StillfieldCore/Sources/StillfieldCore/FieldGrid.swift ios/StillfieldCore/Sources/StillfieldCore/TractorFollowCamera.swift sandbox/native/main.swift -o /tmp/stillfield-handling-native-probe
/tmp/stillfield-handling-native-probe > sandbox/native-baseline.json
node --import tsx sandbox/parity.ts sandbox/native-baseline.json
```

Production acceptance should additionally check real dragging and lifting in both views, a sustained off-center hold, gentle neutral corrections, quick retargets, lifting while turning, multi-touch and interrupted gestures, switching views while driving, every tool, reversing/near obstacles, and both orientations on iPhone and iPad. The existing tests mostly establish projection math and destination movement, which is why they can pass while dragging still feels wrong.
