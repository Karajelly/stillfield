# Tractor handling exploration

Recommendation: keep the controls direct and calm. Use slower travel in tight turns, a deck-sized working swath, and work-through endpoints. The only row-specific response is the user's requested gesture: **tap beside the end of a finished row, line up facing back down that row, and stop**.

This is an isolated experiment on `sandbox/tractor-handling`, based on `4acab01`. Production files in `src/` and `ios/` are unchanged. The sandbox does not write saves. Preview: **http://127.0.0.1:5187/lab.html**.

## Try it

1. Choose **Proposed** and either view. Work a straight row, then let the tractor settle. **Work through the far square** sets up a real short row to the meadow edge for testing.
2. Tap the neighboring ground beside that row's endpoint. The tractor turns, lines up parallel to the row facing back, works the selected spot, and stops ready for another input. The marker remains on your actual click. A tap at the far end of the field is still ordinary destination driving.
3. Continue by tapping farther down the row or using drag steering. Nothing starts another pass on your behalf. Row spacing comes from where you click.
4. In third person, hold to roll, move left/right from the touch origin to steer, return to center for straight travel, and lift to coast to a stop. Try **Replay turn & release** in Current and Proposed.
5. Try Mow, Till, and Sow. Wander still uses the tractor's stopping point. **Comparison → Web logic** uses the existing web movement function in isometric view. This checkout has no shipping web third-person view; the sandbox replays the native camera and movement with the web artwork.

The next-row menu, suggested lanes, automatic adjacent spacing, heading snap in Proposed, and six-row helper demonstration have been removed. Current retains its original behavior for comparison. All profile/view changes restart the meadow; zoom, keyboard steering, Stop, and Start fresh remain available.

To restart:

```sh
cd ~/Projects/stillfield-handling-sandbox
npm run dev -- --host 127.0.0.1 --port 5187 --strictPort
```

## Why the current handling feels difficult

| Finding | Consequence | Source |
| --- | --- | --- |
| Native third-person dragging repeatedly projects through a moving camera | Small pointer movements can choose very different world directions as the camera turns | `FarmController.swift:197`, `TractorFollowCamera.swift:20` |
| Native drag has no end handler; web pointer-up only releases capture | Lifting leaves the last destination active | `FarmViewport.swift:33`, `src/main.ts:451` |
| Maximum yaw is 4.8 rad/s native and 2.4 rad/s web | Native turns can feel much sharper; the two platforms disagree | `FarmSimulation.swift:70`, `src/simulation.ts:46` |
| The brush is 2.30 m wide while the visible mower is 2.57 m | Visually adjacent passes can leave slivers | `FieldGrid.swift:49`, `src/field.ts:169`, `src/tractor.ts:175` |
| The attachment trails 2.1 m behind the tractor | Stopping the tractor at a click leaves the work short of it | `FarmController.swift:379`, `src/main.ts:645` |
| Camera boom distance restores immediately after an obstruction | Passing scenery can produce a sudden camera movement | `TractorFollowCamera.swift:43` |

The initial six-stroke illustration did not test actual turnarounds. The later menu-driven row prototype also did not fit the intended interaction. Its zero-gap results are no longer presented as evidence for the current controls.

## Retained handling changes

- Third-person drag steering is relative to the touch origin, independent of the moving camera. It has a 10 px neutral zone, a gradual response curve, and 110 px travel to full steering.
- Continuous steering is capped near 69°/s. Full steering slows travel to 1.29 m/s, giving a nominal 1.075 m radius without increasing angular sensitivity. Measured manual U-turn widths are 2.16–2.23 m from rest or cruise at 30/60/120 Hz. Straight cruising speed remains unchanged.
- Neutral and release immediately remove steering input. For the partial-drag replay, stopping takes 0.50–0.53 s and coasting covers 0.24–0.27 m. A held steering offset intentionally keeps turning; a quick tap instead selects a fixed work endpoint.
- The working swath is 2.50 m and actual attachment motion is swept between paint samples. The tool center clears the clicked endpoint before painting stops, so the full swath can reach the row end. The tractor then coasts briefly; it settles about 2.1 m beyond the clicked point because the implement trails behind it.
- A tiny camera yaw deadzone ignores tremor, and boom extension eases outward after scenery clears. Collision clearance still takes priority.

## The row-end tap

`WorkedRows` observes actual straight attachment travel; it never changes steering. After at least 6 m of straight work, a nearby tap beside its endpoint can request an arrival direction. This follows the actual row heading, including diagonal rows, rather than a cardinal grid.

The prototype recognizes this only when the tractor has settled near that row's end and the click is within 1.25 m along the end line and 0.18–3.5 m sideways. These are candidate tolerances, not new UI controls. The clicked lateral position is preserved exactly; no next lane or spacing is chosen for the user.

The tractor lifts its tool while turning, approaches the clicked spot facing back down the row, works that spot, and stops. The vehicle center ends about 2.2 m farther into the row so the trailing tool reaches the selected cell. It does not continue to the opposite end. A new tap, drag, keyboard input, or Stop interrupts the movement. Wander, mid-row taps, distant destinations, and points outside the field retain ordinary behavior.

Known blocked approaches are declined rather than remotely painting or planning a detour. The prototype uses existing tractor collision clearance; production review should include the attachment's swept footprint. Very small sideways moves are low-speed tight turns and still need touch-device feel review.

## Measurements and verification

- Browser interaction checks confirmed the ground-tap sequence in both isometric and third-person previews: complete a row, tap beside its end, turn back, finish the selected spot, and remain stopped. Physical touch comfort still needs device review.
- `row-end-measure.ts`: 220 continuous scenarios first work a row, then tap beside its end, finish the clicked cell, stop aligned, and remain stationary for three further seconds. Checks cover native/web isometric movement, the gentle follow controller, 30/60/120 Hz, both turn directions, cardinal and diagonal rows, one-cell and wider moves, Till/Sow, and slightly offset taps. Maximum facing error was 0.19°, and maximum lateral error was under 2 mm. These are model measurements, not human aiming accuracy.
- The same check rejects unrelated/distant taps, moving-tractor triggers, missing row history, invalid positions, and known blocked turns. Interruption removes turning and brings the tractor to rest. Direct full-lock manual turns retain the 2.16–2.23 m width.
- `endpoint-measure.ts`: 522 endpoint scenarios pass across working tools, refresh rates, field edges, close/sideways/reverse taps, retargeting, Wander, and obstruction. Results are in `endpoint-measurements.json`.
- `measure.ts`: release, neutral input, frame rates, near/reverse destinations, camera return, and collision checks pass. Its abstract coverage study now measures only brush width and sample sweeping; it does not imply that direct steering produces perfect rows.
- `parity.ts`: the unchanged native baseline agrees with the original Swift movement/camera in nine scenarios, with maximum numeric difference 3.6 × 10⁻¹⁵.
- Sandbox strict TypeScript checking passes. Earlier production checks passed 23 web tests and 37 Swift core tests; production source remains unchanged.

Run the sandbox checks:

```sh
node --import tsx sandbox/measure.ts
node --import tsx sandbox/endpoint-measure.ts
node --import tsx sandbox/row-end-measure.ts
node --import tsx sandbox/parity.ts sandbox/native-baseline.json
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable sandbox/lab.ts sandbox/measure.ts sandbox/parity.ts sandbox/endpoint-measure.ts sandbox/row-end-measure.ts
```

Before production changes, review physical touch dragging, small corrections, lift/cancel/pinch conflicts, short and long neighboring taps, interruptions, obstacle clearance, and camera comfort in both orientations on iPhone and iPad. The sandbox establishes behavior and provides a preview; it does not establish subjective comfort on hardware.
