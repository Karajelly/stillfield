import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { angleDifference, cellsUnderBrush } from "../src/simulation";
import type { Point, Tool, TractorState } from "../src/simulation";
import { baseline, GentleDrive, tuning } from "./handling";
import { attachmentPoint, WorkDestination } from "./work-destination";
import { alignmentForTap, EndTurn, WorkedRows } from "./row-end";

type Model = "native" | "web" | "gentle";
function run(model: Model, fps: number, heading: number, lateral: number, tool: Tool = "mow", endOffset = 0) {
  let state: TractorState = { x: -15 * Math.sin(heading), z: -15 * Math.cos(heading), heading, speed: 0 };
  let goal: WorkDestination | null = WorkDestination.create({ x: 0.125, z: 0.125 }, state, tool);
  const memory = new WorkedRows(), drive = new GentleDrive(), painted = new Set<number>();
  let brush: Point | null = null, turn: EndTurn | null = null;
  function paint() {
    const point = attachmentPoint(state), from = brush ?? point;
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.z - from.z) / 0.12));
    for (let i = 1; i <= steps; i++) for (const cell of cellsUnderBrush(from.x + (point.x - from.x) * i / steps,
      from.z + (point.z - from.z) * i / steps, tuning.brushRadius)) painted.add(cell);
    brush = point;
  }
  function frame() {
    const dt = 1 / fps;
    if (turn) {
      state = turn.step(state, dt);
      assert.equal(turn.blocked, false, JSON.stringify({ model, fps, heading, lateral, state, radius: turn.radius }));
      if (turn.done) { goal!.setArrivalHeading(turn.alignment.heading); turn = null; brush = null; }
    } else {
      const plan = goal?.plan(state);
      state = model === "gentle" ? drive.step(state, dt, plan ? { target: plan.target } : null, [], plan?.paceScale ?? 1)
        : baseline(model, state, plan?.target ?? null, dt, [], false, plan?.paceScale ?? 1);
      memory.sample(state, !!goal && state.speed > 0.1);
      if (goal) paint();
      if (goal?.covered(state)) { memory.finish(goal.point, state); goal = null; brush = null; }
    }
  }
  for (let i = 0; i < fps * 15 && (goal || state.speed); i++) frame();
  assert.equal(goal, null); assert.equal(state.speed, 0); assert.ok(memory.last);
  const row = memory.last, f = { x: Math.sin(row.heading), z: Math.cos(row.heading) }, s = { x: Math.cos(row.heading), z: -Math.sin(row.heading) };
  const point = { x: row.end.x + s.x * lateral + f.x * endOffset, z: row.end.z + s.z * lateral + f.z * endOffset };
  const alignment = alignmentForTap(row, state, point);
  assert.ok(alignment, JSON.stringify({ model, fps, heading, lateral, state, row, point }));
  assert.deepEqual(alignment.point, point, "Keep the actual click; do not choose a lane for the user");
  goal = WorkDestination.create(point, state, tool); const cell = goal!.cell;
  turn = new EndTurn(state, alignment); brush = null;
  let elapsed = 0;
  for (let i = 0; i < fps * 20 && (goal || turn || state.speed); i++) { frame(); elapsed += 1 / fps; }
  assert.equal(goal, null, JSON.stringify({ model, fps, heading, lateral, state }));
  assert.equal(state.speed, 0); assert.equal(turn, null); assert.ok(painted.has(cell));
  const facingError = Math.abs(angleDifference(state.heading, alignment.heading));
  const lateralError = Math.abs((state.x - point.x) * s.x + (state.z - point.z) * s.z);
  const alongDistance = (state.x - point.x) * -f.x + (state.z - point.z) * -f.z;
  assert.ok(facingError < 0.025, `Facing error: ${facingError}`);
  assert.ok(lateralError < 0.06, `Lateral error: ${lateralError}`);
  assert.ok(alongDistance > 2 && alongDistance < 2.5, `Stop by the selected spot, not along the whole row: ${alongDistance}`);
  const stopped = { ...state };
  for (let i = 0; i < fps * 3; i++) frame();
  assert.deepEqual(state, stopped, "Wait for new input after aligning");
  return { model, fps, heading, lateral, tool, endOffset, elapsed, facingErrorDegrees: facingError * 180 / Math.PI, lateralError, alongDistance };
}

const results = [];
for (const model of ["native", "web", "gentle"] as const) for (const fps of [30, 60, 120])
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -0.7])
    for (const lateral of [-2.5, -0.25, 0.25, 2.5]) results.push(run(model, fps, heading, lateral));
for (const tool of ["till", "sow"] as const) for (const endOffset of [-1, 1])
  results.push(run("gentle", 60, Math.PI / 2, 2.15, tool, endOffset));

const last = { start: { x: -15, z: 0 }, end: { x: 0, z: 0 }, heading: Math.PI / 2 };
const end = { x: 2.2, z: 0, heading: Math.PI / 2, speed: 0 };
for (const point of [{ x: -14, z: 2.5 }, { x: 0, z: 5 }, { x: 0, z: 0 }, { x: 10, z: 1 }, { x: NaN, z: 1 }])
  assert.equal(alignmentForTap(last, end, point), null);
assert.equal(alignmentForTap(null, end, { x: 0, z: 2.5 }), null);
assert.equal(alignmentForTap(last, { ...end, speed: 2 }, { x: 0, z: 2.5 }), null);
assert.equal(alignmentForTap(last, end, { x: 0, z: 2.5 }, [{ x: 2.5, z: 2, radius: 1 }]), null);
const interrupted = new EndTurn(end, alignmentForTap(last, end, { x: 0, z: 2.5 })!);
let stopped = { ...end };
for (let i = 0; i < 45; i++) stopped = interrupted.step(stopped, 1 / 60);
const stoppedHeading = stopped.heading, direct = new GentleDrive();
for (let i = 0; i < 60; i++) stopped = direct.step(stopped, 1 / 60, null);
assert.equal(stopped.heading, stoppedHeading); assert.equal(stopped.speed, 0);

const manual = [30, 60, 120].flatMap(fps => [0, 4.675].map(initialSpeed => {
  const drive = new GentleDrive(); let state = { x: 0, z: 0, heading: 0, speed: initialSpeed };
  for (let i = 0; i < fps * 6 && Math.abs(state.heading) < Math.PI; i++) state = drive.step(state, 1 / fps, { drag: 110 });
  const width = Math.abs(state.x), heading = state.heading;
  for (let i = 0; i < fps; i++) state = drive.step(state, 1 / fps, null);
  assert.equal(state.heading, heading); assert.equal(state.speed, 0);
  return { fps, initialSpeed, width };
}));
const report = { note: "Actual row followed by a nearby click, alignment, working the clicked spot, and rest. No next-row buttons or automatic continuation. Model checks, not touch feel assessment.",
  cases: results.length, maxFacingErrorDegrees: Math.max(...results.map(r => r.facingErrorDegrees)),
  maxLateralError: Math.max(...results.map(r => r.lateralError)), stopDistancePastClick: [Math.min(...results.map(r => r.alongDistance)), Math.max(...results.map(r => r.alongDistance))],
  elapsedSeconds: [Math.min(...results.map(r => r.elapsed)), Math.max(...results.map(r => r.elapsed))], manual, examples: results.filter(r => r.fps === 60 && r.heading === Math.PI / 2) };
writeFileSync(new URL("./row-end-measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
