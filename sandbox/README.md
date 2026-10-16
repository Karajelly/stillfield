# Tractor handling exploration

Recommendation: make neat rows physically achievable with slower travel in tight turns, a full-width finish at row ends, and an optional neighboring-row choice that gently lines up the return pass. Keep each pass player-directed. In both views, a ground tap with Mow, Till, or Sow marks where the work should finish; Wander uses the tractor's stopping point.

This is an isolated experiment on `sandbox/tractor-handling`, based on `4acab01`. Production files in `src/` and `ios/` are unchanged. It has no save writes. The browser preview is at **http://127.0.0.1:5187/lab.html** while the local server runs.

## Try it

1. In **Third person**, choose **Current**, then **Replay turn & release**. Repeat with **Proposed**. The scripted drag goes right with small finger tremor, then releases after 1.5 seconds.
2. Try a real drag in **Proposed**: hold to roll, move left/right from the point where you started to turn, return to that small center zone for straight travel, and lift to coast to a stop. Holding an offset intentionally continues the turn; a quick tap marks a fixed work endpoint. This differs from a drag that keeps navigating after release.
3. In either view, use **Try six rows yourself**. It selects Proposed handling with row help, starts one real pass across an empty field, and waits for you at the end. Choose **Next row on the right**, then left, right, left, right. Each choice drives the tractor through a slow U-turn and a full return pass. Only the moving attachment paints. No rows are prepainted and the next pass never starts by itself.
4. The same next-row choices become available after ordinary straight working passes. In isometric view you can also tap near the far end of a hinted adjacent lane. The transient buttons make that choice reachable in third person, where the far endpoint can be behind the camera. Point elsewhere, steer, or press Stop to interrupt; turn row help off for freeform patterns.
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
- Show a faint lane cue and offer a return turn only when the player selects a neighboring row. Keep completion percentages and automatic field filling out of play.
- Ground taps and the endpoint of an isometric drag mark where work should finish. The attachment covers the entire selected square before completing, and the tractor settles beyond it. This behavior also applies to quick ground taps in third person.

### Work endpoints in both views

The endpoint prototype now follows the user's clarified intent: **work through the selected square**. The marker remains on that point; a separate vehicle approach accounts for the 2.1 m trailing attachment, its actual footprint, and a gentle finish. Completion checks the whole square against the tool footprint and flushes the final paint sweep even if the normal paint interval has not elapsed. It does not depend on whether the square was already painted in a previous pass.

The tool stops painting once the square is finished, while the tractor coasts briefly. A nearby square already inside the current swath uses forward travel where possible. Tight sideways or reverse taps allow the tractor to slow and line up first, avoiding an endless orbit around a target. The final approach stays fixed as the tractor passes the marked point. Retargeting replaces it, and tool changes re-evaluate the active work destination.

Wander and points outside the working field keep normal tractor-destination behavior. Continuous third-person drag steering has no selected ground endpoint and retains release-to-stop behavior. Obstructions still stop travel; an unreachable square is reported as needing a different approach rather than being painted remotely.

### Achievable rows and turnarounds

The original six-stroke preview bypassed the turn and entry into each row. It established a useful swath spacing, but did not establish that the controls could produce it. That preview has been replaced with player-driven row practice.

The previous gentle drag settings still traveled at 2.805 m/s at full steering, with a 1.2 rad/s turning limit: a steady U-turn diameter of **4.675 m**. That is more than twice the proposed 2.15 m row spacing. Increasing angular sensitivity would also increase camera motion. The revised full-steering speed is 1.29 m/s, giving a nominal 1.075 m radius with the same turning limit and unchanged straight cruising speed. Simulated 180° manual turns from rest or cruise span **2.16–2.23 m** at 30/60/120 Hz; neutral and release still remove steering immediately. Manual driving still asks the player to judge their alignment.

For reliable adjacent rows, offer a small, optional **next row left/right** choice after an actual straight working pass. Selecting it lifts the attachment, drives a roughly 4.3-second turn and alignment, lowers the attachment, and works through the chosen return endpoint. The controller integrates speed and heading against the existing collision constraints; it never teleports the tractor or fills cells ahead of the tool. A new input cancels the maneuver. These controls are available in both views, and ordinary isometric taps near a suggested far endpoint select the same maneuver.

Row finishing also needs to clear the full width. Merely putting a circular brush over the final square leaves small scallops between adjacent row ends. For an assisted straight row, the tool center now crosses the selected end line before work stops. The tractor needs roughly 3.3 m beyond that line for its center to finish and turn, plus clearance for its body and attachment. The helper declines known blocked lanes; it does not plan detours around the windmill or guarantee arbitrary curves. Production collision checks should include the full rig's swept footprint.

The proposed product behavior is the choice and gentle alignment. The six-row counter and experiment instructions belong only to the sandbox. No next pass starts without a player action.

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

For a first production iteration, keep row entry and full-width row finishing in scope alongside work endpoints, drag/tap classification, release handling, lower follow-view turn rates, and swath width. A spacing guide alone cannot deliver neat rows. Review the optional turn-and-align interaction on touch hardware before choosing its final UI. Camera clearance return can be tuned independently. Ordinary isometric cruising remains unchanged; selected return turns use the calm shared controller.

## Measurements

`measure.ts` runs deterministic model experiments. Full output is in `measurements.json`.

At 60 Hz on a 402 × 874 virtual viewport:

| Experiment | Current native replay | Proposed |
| --- | ---: | ---: |
| Maximum yaw during scripted forward-ground drag | 275°/s | 43°/s for this partial drag; cap 69°/s |
| Distance traveled after releasing that drag | 9.40 m, continuing toward the destination | 0.26 m |
| Time from release to rest | 2.45 s | 0.52 s |
| Tractor turn after release, drag near lower tractor area | 69.5° | 0° |
| Camera yaw still settling after forward-ground drag release | 25.0° | 4.9° |

These are behavior comparisons, not performance benchmarks. The current version deliberately retains a destination; the proposed drag deliberately releases it. Exact results depend on gesture position and viewport. With centered ±2 px tremor on forward ground, both versions stayed straight because current row assistance already suppresses that small error. Low-screen dragging is much less stable: at screen y = 57%, the initial center ground hit is 0.77 m behind the tractor in portrait, versus 1.02 m ahead in the landscape measurement.

Across 30/60/120 Hz, the proposed scripted drag added no tractor yaw after release, stopped in 0.50–0.53 s, and coasted 0.24–0.27 m. Camera settling still adds a small, separate visual turn.

For the original abstract six-pass coverage study (not a driving test), missed interior cells were:

| Configuration | Missed cells inside the study |
| --- | ---: |
| Current 2.30 m brush, approximate 2.5 m spacing | 8.47% |
| Wider 2.50 m brush only | 4.48% |
| Swept painting only | 7.84% |
| Adjacent-row spacing only | 0% |
| Wider, swept brush plus spacing | 0% |

That metric excludes row ends, turns, obstacles, and the outer borders. Assisted passes cover a **narrower total band** for the same six strokes, so it is not a claim of completing the same field in the same number of passes. It shows why overlap is useful. This abstract study remains in `measure.ts` for reference; it is no longer the browser demonstration.

`row-measure.ts` now drives **six separate selected passes in one continuous trajectory**, with five real turnarounds and no pose resets between them. In 40 sequences covering native/web cruising and the gentle follow controller, 30/60/120 Hz, both field axes and directions, Till and Sow, and taps up to 0.5 m off the suggested lane, the assisted runs missed **zero cells between the first and last lane centers, including both row ends**. Turns took 4.27–4.36 s, peaked below 60°/s, and the maximum tool deviation on the return straight was 5.9 cm. These are unobstructed test strips with selected assistance, not a claim that unassisted finger steering or arbitrary obstacle layouts produce perfect rows. Details are in `row-measurements.json`.

The direct-destination comparison in that file uses the same 2.5 m brush and exact 2.15 m endpoint spacing, without the turn-and-align helper. It still leaves 3.7–9.2% of that strip untouched. Those comparisons isolate entry and finishing geometry; they are not shipping native/web benchmarks.

## Validation and limits

- Existing web suite: 23 tests passed.
- Existing Swift core suite: 37 tests passed.
- Sandbox TypeScript type checking passed.
- Baseline replay compared directly with the unmodified Swift movement and camera in nine scenarios, at 30/60/120 Hz, including retargeting and obstruction. Maximum numeric difference: 3.6 × 10⁻¹⁵.
- Sandbox assertions cover release yaw, stopping distance/time, refresh rates, deadzone, row capture, reverse/nearby tap arrival, tractor clearance, and smooth camera boom return.
- Work endpoint checks: 525 model scenarios passed, including all three working tools at 30/60/120 Hz, all four field edges, a diagonal corner, close/sideways/reverse taps, moving retargets, adjacent-row assistance, Wander, and a blocked destination. Details are in `endpoint-measurements.json`. In the straight far-edge example, the selected square remained untouched with tractor-destination semantics and was worked with the new endpoint semantics. The tractor settled roughly 0.9–1.1 m beyond the field edge. The `gentle` model compares the new follow controller with and without work endpoint semantics; it is not a second shipping native baseline.
- Row checks: 40 continuous six-row sequences, full-lock manual turns from rest and cruise, interrupted-turn stopping, obstacle clearance, and unavailable lanes outside the field. These use the same row recorder, return controller, and work destination as the preview. The endpoint-only checks above retain ordinary point finishing; full-width assisted row finishing travels a little farther.
- Browser UI verification includes six actual isometric Mow passes selected one at a time through the row controls, their turnarounds and clean joins, and rendered third-person return alignment. Earlier checks covered A/B turn replays, a real mouse drag/release, and far-square completion in both views. This is not a physical-device assessment of touch feel, frame pacing, gesture cancellation, pinch conflicts, or motion comfort.

Run the sandbox checks:

```sh
node --import tsx sandbox/measure.ts
node --import tsx sandbox/endpoint-measure.ts
node --import tsx sandbox/row-measure.ts
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable sandbox/lab.ts sandbox/handling.ts sandbox/field.ts sandbox/measure.ts sandbox/parity.ts sandbox/endpoint-measure.ts sandbox/row-measure.ts
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swiftc ios/StillfieldCore/Sources/StillfieldCore/FarmSimulation.swift ios/StillfieldCore/Sources/StillfieldCore/FieldGrid.swift ios/StillfieldCore/Sources/StillfieldCore/TractorFollowCamera.swift sandbox/native/main.swift -o /tmp/stillfield-handling-native-probe
/tmp/stillfield-handling-native-probe > sandbox/native-baseline.json
node --import tsx sandbox/parity.ts sandbox/native-baseline.json
```

Production acceptance should additionally check real dragging and lifting in both views, a sustained off-center hold, gentle neutral corrections, quick retargets, lifting while turning, multi-touch and interrupted gestures, switching views while driving, every tool, reversing/near obstacles, and both orientations on iPhone and iPad. The existing tests mostly establish projection math and destination movement, which is why they can pass while dragging still feels wrong.
