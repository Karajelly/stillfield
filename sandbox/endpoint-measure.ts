import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { angleDifference, cellsUnderBrush, FIELD } from "../src/simulation";
import type { Point, Obstacle, Tool, TractorState } from "../src/simulation";
import { baseline, GentleDrive, RowGuide, tuning } from "./handling";
import { attachmentPoint, WorkDestination } from "./work-destination";

type Model = "native" | "web" | "gentle";
function run(model: Model, point: Point, initial: TractorState, fps: number, tool: Tool = "mow",
  proposed = true, obstacles: Obstacle[] = [], guide?: RowGuide, retarget?: Point) {
  let state = { ...initial }, goal = proposed ? WorkDestination.create(point, state, tool) : null;
  let target: Point | null = point, previousBrush: Point | null = null, lastPaint = 0, blockedTime = 0;
  const field = new Map<number, number>(), drive = new GentleDrive();
  let status = "travelling", completedAt = 0, distance = 0, changedTarget = false;
  function paint() {
    if (tool === "wander") return;
    const brush = attachmentPoint(state), radius = proposed ? tuning.brushRadius : 1.15;
    const from = proposed && previousBrush ? previousBrush : brush;
    const steps = Math.max(1, Math.ceil(Math.hypot(brush.x - from.x, brush.z - from.z) / 0.12));
    for (let j = 1; j <= steps; j++)
      for (const cell of cellsUnderBrush(from.x + (brush.x - from.x) * j / steps, from.z + (brush.z - from.z) * j / steps, radius))
        field.set(cell, tool === "mow" ? 1 : tool === "till" ? 2 : 3);
    previousBrush = brush;
  }
  for (let i = 0; i < fps * 24; i++) {
    const time = i / fps, dt = 1 / fps, previous = state;
    if (retarget && time >= 0.7 && !changedTarget) {
      point = retarget; target = point; goal = WorkDestination.create(point, state, tool);
      changedTarget = true; status = "travelling";
    }
    const plan = goal?.plan(state);
    let movementTarget = plan?.target ?? target;
    if (guide && movementTarget) movementTarget = guide.target(state, movementTarget);
    state = model === "gentle" ? drive.step(state, dt, movementTarget ? { target: movementTarget } : null, obstacles, plan?.paceScale ?? 1)
      : baseline(model, state, movementTarget, dt, obstacles, false, plan?.paceScale ?? 1);
    distance += Math.hypot(state.x - previous.x, state.z - previous.z);
    if (goal?.covered(state)) {
      paint(); goal = null; target = null; status = "worked"; completedAt = time;
    } else if (!goal && target && movementTarget && Math.hypot(movementTarget.x - state.x, movementTarget.z - state.z) < 0.5) {
      target = null; status = "arrived"; completedAt = time;
    }
    if (target && plan?.paceScale !== 0 && Math.hypot(state.x - previous.x, state.z - previous.z) < 0.003
      && state.speed < 0.15 && Math.abs(angleDifference(state.heading, previous.heading)) < dt * 0.1) {
      blockedTime += dt;
      if (blockedTime > 1) { target = null; goal = null; status = "blocked"; }
    } else blockedTime = 0;
    if (status !== "worked" && state.speed > 0.1 && time - lastPaint >= 1 / 24) { paint(); lastPaint = time; }
    if (!target && state.speed === 0 && (!retarget || changedTarget)) break;
  }
  const selected = WorkDestination.create(point, initial, "mow")!;
  return { model, fps, tool, proposed, status, endpointValue: field.get(selected.cell) ?? 0,
    completedAt, distance, final: state, point };
}

let checked = 0;
const cases = [
  { name: "east edge", from: { x: 5, z: 0.125, heading: Math.PI / 2, speed: 0 }, to: { x: FIELD.maxX, z: 0.125 } },
  { name: "west edge", from: { x: -10, z: 0.125, heading: -Math.PI / 2, speed: 0 }, to: { x: FIELD.minX, z: 0.125 } },
  { name: "north edge", from: { x: 0.125, z: 0, heading: Math.PI, speed: 0 }, to: { x: 0.125, z: FIELD.minZ } },
  { name: "south edge", from: { x: 0.125, z: 0, heading: 0, speed: 0 }, to: { x: 0.125, z: FIELD.maxZ } },
  { name: "diagonal corner", from: { x: 0, z: 0, heading: 0.9, speed: 0 }, to: { x: FIELD.maxX, z: FIELD.maxZ } },
];
for (const model of ["native", "web", "gentle"] as const)
  for (const fps of [30, 60, 120]) for (const tool of ["mow", "till", "sow"] as const)
    for (const test of cases) {
      const result = run(model, test.to, test.from, fps, tool);
      assert.equal(result.status, "worked", JSON.stringify({ name: test.name, result }));
      assert.equal(result.endpointValue, tool === "mow" ? 1 : tool === "till" ? 2 : 3);
      assert.equal(result.final.speed, 0);
      checked++;
    }

// Short taps, reverse targets and retargeting from cruise must settle, not orbit.
for (const model of ["native", "web", "gentle"] as const) for (const speed of [0, 4.675])
  for (const distance of [0.01, 0.3, 1, 2, 3, 5, 10]) for (const degrees of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
    const angle = degrees * Math.PI / 180, point = { x: Math.sin(angle) * distance, z: Math.cos(angle) * distance };
    const result = run(model, point, { x: 0, z: 0, heading: 0, speed }, 60);
    assert.equal(result.status, "worked", JSON.stringify({ distance, degrees, result }));
    assert.equal(result.endpointValue, 1); assert.equal(result.final.speed, 0); checked++;
  }
for (const model of ["native", "web", "gentle"] as const) {
  const from = { x: 0, z: 0, heading: Math.PI / 2, speed: 0 }, to = { x: 12, z: 0.125 };
  const wander = run(model, to, from, 60, "wander");
  assert.equal(wander.status, "arrived"); assert.equal(wander.endpointValue, 0);
  assert.ok(Math.hypot(wander.final.x - to.x, wander.final.z - to.z) < 0.6); checked++;
  const blocked = run(model, to, from, 60, "mow", true, [{ x: 8, z: 0, radius: 2 }]);
  assert.equal(blocked.status, "blocked"); assert.equal(blocked.endpointValue, 0); checked++;
  const redirected = run(model, to, from, 60, "sow", true, [], undefined, { x: 1, z: -6 });
  assert.equal(redirected.status, "worked"); assert.equal(redirected.endpointValue, 3); checked++;
  const guide = new RowGuide(); guide.lanes[0] = [-2.15 + 0.45];
  const assisted = run(model, to, from, 60, "till", true, [], guide);
  assert.equal(assisted.status, "worked"); assert.equal(assisted.endpointValue, 2); checked++;
}
assert.equal(WorkDestination.create({ x: 40, z: 0 }, cases[0].from, "mow"), null);
assert.equal(WorkDestination.create({ x: 0, z: 0 }, cases[0].from, "wander"), null);

const comparison = (["native", "web", "gentle"] as const).map(model => ({
  current: run(model, cases[0].to, cases[0].from, 60, "mow", false),
  proposed: run(model, cases[0].to, cases[0].from, 60, "mow", true),
}));
for (const item of comparison) { assert.equal(item.current.endpointValue, 0); assert.equal(item.proposed.endpointValue, 1); }
const result = { checked, note: "Unobstructed work endpoints plus deliberate blockage; pure model checks, not touch hardware assessment.", comparison };
writeFileSync(new URL("./endpoint-measurements.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
