import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { angleDifference, cellsUnderBrush, FIELD } from "../src/simulation";
import type { Point, Tool, TractorState } from "../src/simulation";
import { baseline, GentleDrive, tuning } from "./handling";
import { attachmentPoint, WorkDestination } from "./work-destination";
import { across, nextRow, RowReturn, rowPoint, WorkedRows } from "./row-return";

type Model = "native" | "web" | "gentle";
function sixRows(model: Model, fps: number, assisted: boolean, tool: Tool = "mow", axis: 0 | 1 = 0, direction = 1, aimError = 0) {
  const min = (axis === 0 ? FIELD.minX : FIELD.minZ) + FIELD.cell / 2;
  const max = (axis === 0 ? FIELD.maxX : FIELD.maxZ) - FIELD.cell / 2;
  const heading = axis === 0 ? direction * Math.PI / 2 : direction === 1 ? 0 : Math.PI;
  let state: TractorState = { ...rowPoint(axis, direction === 1 ? min : max, 0.125), heading, speed: 0 };
  let point = rowPoint(axis, direction === 1 ? max : min, 0.125);
  let goal: WorkDestination | null = WorkDestination.create(point, state, tool);
  if (assisted) goal!.alignToRow(axis, 0.125, heading);
  let turn: RowReturn | null = null, lastBrush: Point | null = null, lastPaint = 0;
  let completed = 0, elapsed = 0, maxTurnRate = 0, maxStraightError = 0, turnSeconds = 0;
  const memory = new WorkedRows(), drive = new GentleDrive(), painted = new Set<number>();
  const turns: number[] = [], endpoints: number[] = [];
  function paint() {
    const brush = attachmentPoint(state), from = lastBrush ?? brush;
    const steps = Math.max(1, Math.ceil(Math.hypot(brush.x - from.x, brush.z - from.z) / 0.12));
    for (let i = 1; i <= steps; i++) for (const cell of cellsUnderBrush(
      from.x + (brush.x - from.x) * i / steps, from.z + (brush.z - from.z) * i / steps, tuning.brushRadius)) painted.add(cell);
    lastBrush = brush;
  }
  for (let i = 0; i < fps * 150; i++) {
    const dt = 1 / fps; elapsed = i / fps;
    const previous = state;
    if (turn) {
      state = turn.step(state, dt); turnSeconds += dt;
      maxTurnRate = Math.max(maxTurnRate, Math.abs(angleDifference(state.heading, previous.heading)) / dt);
      assert.equal(turn.blocked, false, `Turn blocked: ${JSON.stringify({ model, fps, completed, state, turn })}`);
      if (turn.done) {
        goal!.alignToRow(axis, turn.choice.row.lane, turn.heading);
        turns.push(turn.elapsed); turn = null; lastBrush = null;
      }
    } else {
      const plan = goal?.plan(state);
      state = model === "gentle" ? drive.step(state, dt, plan ? { target: plan.target } : null, [], plan?.paceScale ?? 1)
        : baseline(model, state, plan?.target ?? null, dt, [], false, plan?.paceScale ?? 1);
      memory.sample(state, !!goal && state.speed > 0.1);
      if (goal && completed > 0 && assisted)
        maxStraightError = Math.max(maxStraightError, Math.abs(across(attachmentPoint(state), axis) - (0.125 + completed * tuning.rowPitch)));
      if (goal?.covered(state)) {
        paint(); endpoints.push(goal.cell); memory.finish(goal.point, state, goal.row?.lane); goal = null; lastBrush = null;
      } else if (goal && state.speed > 0.1 && elapsed - lastPaint >= 1 / 24) { paint(); lastPaint = elapsed; }
    }
    if (!goal && !turn && state.speed === 0) {
      completed++;
      if (completed === 6) break;
      if (assisted) {
        const sign = axis === 0 ? Math.sin(state.heading) : -Math.cos(state.heading);
        const choice = nextRow(memory.last, state, sign > 0 ? 1 : -1);
        assert.ok(choice, JSON.stringify({ model, fps, completed, state, last: memory.last }));
        point = rowPoint(axis, choice.row.to, choice.row.lane + aimError);
        goal = WorkDestination.create(point, state, tool); turn = new RowReturn(state, choice);
      } else {
        point = rowPoint(axis, completed % 2 === 0 ? (direction === 1 ? max : min) : (direction === 1 ? min : max), 0.125 + completed * tuning.rowPitch);
        goal = WorkDestination.create(point, state, tool);
      }
    }
  }
  const cols = Math.round((FIELD.maxX - FIELD.minX) / FIELD.cell), rows = Math.round((FIELD.maxZ - FIELD.minZ) / FIELD.cell);
  let measured = 0, missed = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = { x: FIELD.minX + (c + 0.5) * FIELD.cell, z: FIELD.minZ + (r + 0.5) * FIELD.cell };
    if (across(p, axis) < 0.125 || across(p, axis) > 0.125 + 5 * tuning.rowPitch) continue;
    measured++; if (!painted.has(r * cols + c)) missed++;
  }
  assert.equal(completed, 6, JSON.stringify({ model, fps, completed, state }));
  for (const cell of endpoints) assert.ok(painted.has(cell));
  if (assisted) {
    assert.equal(missed, 0, JSON.stringify({ model, fps, tool, axis, direction, missed }));
    assert.ok(maxTurnRate <= tuning.turnRate + 1e-9);
    assert.ok(maxStraightError < 0.21, `Straight error ${maxStraightError}`);
  }
  return { model, fps, tool, axis, direction, aimError, assisted, completed, elapsed, turnSeconds, turns,
    maxTurnDegreesPerSecond: maxTurnRate * 180 / Math.PI, maxStraightError, measuredCells: measured, missedCells: missed, missedPercent: missed / measured * 100 };
}

function manualUTurn(fps: number, initialSpeed: number) {
  const drive = new GentleDrive();
  let state = { x: 0, z: 0, heading: 0, speed: initialSpeed }, maxRate = 0;
  for (let i = 0; i < fps * 6 && Math.abs(state.heading) < Math.PI; i++) {
    const previous = state; state = drive.step(state, 1 / fps, { drag: 110 });
    maxRate = Math.max(maxRate, Math.abs(angleDifference(state.heading, previous.heading)) * fps);
  }
  const width = Math.abs(state.x), heading = state.heading;
  for (let i = 0; i < fps; i++) state = drive.step(state, 1 / fps, null);
  assert.equal(state.heading, heading); assert.equal(state.speed, 0);
  return { fps, initialSpeed, width, maxTurnDegreesPerSecond: maxRate * 180 / Math.PI };
}

const assisted = [];
for (const model of ["native", "web", "gentle"] as const)
  for (const fps of [30, 60, 120]) for (const axis of [0, 1] as const) for (const direction of [-1, 1])
    assisted.push(sixRows(model, fps, true, "mow", axis, direction));
for (const tool of ["till", "sow"] as const) assisted.push(sixRows("gentle", 60, true, tool));
for (const error of [-0.5, 0.5]) assisted.push(sixRows("gentle", 60, true, "mow", 0, 1, error));
const direct = (["native", "web", "gentle"] as const).map(model => sixRows(model, 60, false));
const manual = [30, 60, 120].flatMap(fps => [0, 4.675].map(speed => manualUTurn(fps, speed)));
const record = { axis: 0 as const, lane: 0.125, heading: Math.PI / 2, from: -23.875, to: 18.875 };
const end = { x: 20, z: 0.125, heading: Math.PI / 2, speed: 0 };
assert.equal(nextRow(record, end, 1, [{ x: 0, z: 2.275, radius: 1 }]), null);
assert.equal(nextRow(record, { ...end, speed: 2 }, 1), null);
assert.equal(nextRow({ ...record, lane: 13 }, { ...end, z: 13 }, 1), null);
const choice = nextRow(record, end, 1)!;
const interrupted = new RowReturn(end, choice);
let after = { ...end };
for (let i = 0; i < 45; i++) after = interrupted.step(after, 1 / 60);
const stoppedHeading = after.heading, neutralDrive = new GentleDrive();
for (let i = 0; i < 60; i++) after = neutralDrive.step(after, 1 / 60, null);
assert.equal(after.heading, stoppedHeading); assert.equal(after.speed, 0);
const obstructed = new RowReturn(end, choice), obstacle = { x: 21, z: 1.2, radius: 0.4 };
after = { ...end };
for (let i = 0; i < 660 && !obstructed.blocked && !obstructed.done; i++) {
  after = obstructed.step(after, 1 / 60, [obstacle]);
  assert.ok(Math.hypot(after.x - obstacle.x, after.z - obstacle.z) >= obstacle.radius + 0.9 - 1e-9);
}
assert.ok(obstructed.blocked || obstructed.done);
const report = { note: "Six separate player-selected destinations; one continuous simulated tractor trajectory, actual attachment stamps only, no pose resets between rows. Obstacle-free band; does not measure subjective touch feel.",
  steadyManualWidth: { previousSandbox: 2 * 5.5 * 0.85 * 0.6 / tuning.turnRate, proposed: 2 * tuning.tightTurnSpeed / tuning.turnRate },
  manual, direct, assisted };
writeFileSync(new URL("./row-measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ cases: assisted.length, manual, direct, assisted: assisted[0] }, null, 2));
