import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { angleDifference, cellsUnderBrush, FIELD } from "../src/simulation";
import type { Point, TractorState } from "../src/simulation";
import { advanceNative, baseline, dragAmount, FollowCamera, followFov, GentleDrive, tuning } from "./handling";
import { projectGround } from "./handling";

const degrees = (x: number) => x * 180 / Math.PI;
const initial: TractorState = { x: -15, z: -7, heading: Math.PI / 2, speed: 0 };

function turnAndRelease(gentle: boolean, fps: number, width = 402, height = 874, screenY = 0.45) {
  let state = { ...initial }, target: Point | null = null;
  const boom = new FollowCamera(), drive = new GentleDrive();
  const camera = new THREE.PerspectiveCamera(followFov(width / height), width / height, 0.1, 300);
  let nextEvent = 0, dx = 0, postReleaseTurn = 0, releasePosition = { x: 0, z: 0 }, coast = 0;
  let maxTurnRate = 0, speedAtRelease = 0, stopAfter = 0, cameraAtRelease = 0, cameraTurnAfter = 0;
  for (let i = 0; i <= fps * 5; i++) {
    const t = i / fps, dt = 1 / fps, holding = t < 1.5;
    const pose = boom.update(state, dt, [], gentle);
    camera.position.copy(pose.position); camera.lookAt(pose.focus); camera.updateMatrixWorld();
    if (holding && t >= nextEvent - 1e-9) {
      dx = Math.min(1, t / 0.35) * 85 + Math.sin(t * 31) * 2;
      if (!gentle) target = projectGround(camera, 0.5 + dx / width, screenY + Math.sin(t * 27) * 2 / height);
      nextEvent += 1 / 30;
    }
    if (i === fps * 1.5) {
      releasePosition = { ...state }; speedAtRelease = state.speed; cameraAtRelease = boom.heading!;
    }
    const previous = state;
    state = gentle ? drive.step(state, dt, holding ? { drag: dx } : null) : advanceNative(state, target, dt);
    if (target && Math.hypot(state.x - target.x, state.z - target.z) < 0.5) target = null;
    const turn = Math.abs(degrees(angleDifference(state.heading, previous.heading)));
    maxTurnRate = Math.max(maxTurnRate, turn / dt);
    if (!holding) {
      postReleaseTurn += turn;
      coast += Math.hypot(state.x - previous.x, state.z - previous.z);
      if (state.speed === 0 && !stopAfter) stopAfter = t - 1.5;
      cameraTurnAfter = Math.abs(degrees(angleDifference(boom.heading!, cameraAtRelease)));
    }
  }
  return { fps, viewport: `${width}×${height}`, maxTurnRate, postReleaseTurn, speedAtRelease, stopAfterSeconds: stopAfter || null, travelAfterRelease: coast, cameraTurnAfter, releasePosition };
}

function tremor(gentle: boolean) {
  let state = { ...initial }, target: Point | null = null;
  const boom = new FollowCamera(), drive = new GentleDrive();
  const camera = new THREE.PerspectiveCamera(followFov(402 / 874), 402 / 874, 0.1, 300);
  let nextEvent = 0, dx = 0, totalTurn = 0;
  for (let i = 0; i < 180; i++) {
    const t = i / 60, pose = boom.update(state, 1 / 60, [], gentle);
    camera.position.copy(pose.position); camera.lookAt(pose.focus); camera.updateMatrixWorld();
    if (t >= nextEvent - 1e-9) {
      dx = Math.sin(t * 31) * 2;
      if (!gentle) target = projectGround(camera, 0.5 + dx / 402, 0.45 + Math.sin(t * 27) * 2 / 874);
      nextEvent += 1 / 30;
    }
    const before = state;
    state = gentle ? drive.step(state, 1 / 60, { drag: dx }) : advanceNative(state, target, 1 / 60);
    totalTurn += Math.abs(degrees(angleDifference(state.heading, before.heading)));
  }
  return totalTurn;
}

function coverage(radius: number, swept: boolean) {
  const lanes: number[] = [], painted = new Set<number>();
  for (let row = 0; row < 6; row++) {
    const request = row === 0 ? -8 : lanes.at(-1)! + 2.5 + [0, 0.12, -0.10, 0.18, -0.08, 0.04][row];
    const lane = request;
    lanes.push(lane);
    // 30 Hz rendering: the >= 1/24 paint gate actually samples at 15 Hz.
    const step = swept ? 0.12 : 5.5 * 0.85 / 15;
    for (let x = -20; x <= 13; x += step)
      for (const cell of cellsUnderBrush(x, lane, radius)) painted.add(cell);
  }
  let measured = 0, missed = 0;
  const columns = Math.round((FIELD.maxX - FIELD.minX) / FIELD.cell);
  const rows = Math.round((FIELD.maxZ - FIELD.minZ) / FIELD.cell);
  // Compare the interior BETWEEN outer centerlines; exclude end caps and outside borders.
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = FIELD.minX + (c + 0.5) * FIELD.cell, z = FIELD.minZ + (r + 0.5) * FIELD.cell;
    if (x < -18 || x > 11 || z < lanes[0] || z > lanes.at(-1)!) continue;
    measured++; if (!painted.has(r * columns + c)) missed++;
  }
  return { radius, swept, lanes, measuredCells: measured, missedCells: missed, missedPercent: missed / measured * 100 };
}

function quickRetarget(profile: "native" | "web" | "gentle") {
  let state = { x: 0, z: 0, heading: 0, speed: 4.675 };
  const drive = new GentleDrive(), target = { x: 20, z: 0 };
  let maxYaw = 0, timeTo80Degrees: number | null = null;
  for (let i = 0; i < 180; i++) {
    const before = state;
    state = profile === "gentle" ? drive.step(state, 1 / 60, { target }) : baseline(profile, state, target, 1 / 60, [], false);
    maxYaw = Math.max(maxYaw, Math.abs(degrees(angleDifference(state.heading, before.heading))) * 60);
    if (timeTo80Degrees === null && degrees(state.heading) >= 80) timeTo80Degrees = (i + 1) / 60;
  }
  return { profile, maxYaw, timeTo80Degrees };
}

const release = [30, 60, 120].map(fps => ({ current: turnAndRelease(false, fps), proposed: turnAndRelease(true, fps) }));
const report = {
  sourceCommit: "4acab01", note: "Deterministic model experiments; no device frame-time or subjective comfort claims.",
  release, lowDragNearTractor: { current: turnAndRelease(false, 60, 402, 874, 0.57), proposed: turnAndRelease(true, 60, 402, 874, 0.57) }, landscapeRelease: { current: turnAndRelease(false, 60, 1440, 900), proposed: turnAndRelease(true, 60, 1440, 900) },
  tremorDegreesOver3Seconds: { current: tremor(false), proposed: tremor(true) },
  retarget: [quickRetarget("native"), quickRetarget("web"), quickRetarget("gentle")],
  coverage: {
    current: coverage(1.15, false),
    widthOnly: coverage(1.25, false),
    sweepOnly: coverage(1.15, true),
    proposed: coverage(1.25, true),
  },
};

// Assertions exercise behavior important to this exploration, not production acceptance.
for (const r of release) {
  assert.equal(r.proposed.postReleaseTurn, 0, "A lifted drag must not keep steering");
  assert.ok(r.proposed.stopAfterSeconds !== null && r.proposed.stopAfterSeconds < 0.65);
  assert.ok(r.proposed.travelAfterRelease < 0.5);
  assert.ok(r.proposed.maxTurnRate <= degrees(tuning.turnRate) + 1e-9);
}
assert.ok(Math.abs(release[0].proposed.travelAfterRelease - release[2].proposed.travelAfterRelease) < 0.05);
assert.equal(dragAmount(9), 0); assert.equal(dragAmount(-9), 0);
assert.equal(report.tremorDegreesOver3Seconds.proposed, 0);
assert.ok(report.coverage.proposed.missedPercent < report.coverage.current.missedPercent);
// Reverse targets settle; the slower turn must not introduce endless orbiting.
for (const target of [{ x: 0, z: -1 }, { x: 0.3, z: 0.3 }, { x: -1, z: -1 }]) {
  const drive = new GentleDrive(); let state = { x: 0, z: 0, heading: 0, speed: 4.675 };
  let active: Point | null = target;
  for (let i = 0; i < 60 * 12; i++) {
    state = drive.step(state, 1 / 60, active ? { target: active } : null);
    if (active && Math.hypot(state.x - target.x, state.z - target.z) < 0.5) active = null;
  }
  assert.equal(state.speed, 0, `Tap should settle at ${JSON.stringify(target)}`);
}
// Obstacle clearance and gentle boom restoration.
const camera = new FollowCamera(), tractor = { x: 0, z: 0, heading: 0, speed: 0 };
const blocked = camera.update(tractor, 1 / 60, [{ x: 0, z: -8, radius: 2 }], true);
assert.ok(Math.abs(blocked.position.z + 5.6) < 1e-9);
const restored = camera.update(tractor, 1 / 60, [], true);
assert.ok(Math.abs(restored.position.z - blocked.position.z) < 0.6);
const collisionDrive = new GentleDrive(); let collisionState = { x: 0, z: -4, heading: 0, speed: 4 };
for (let i = 0; i < 180; i++) {
  collisionState = collisionDrive.step(collisionState, 1 / 60, { drag: 0 }, [{ x: 0, z: 0, radius: 1 }]);
  assert.ok(Math.hypot(collisionState.x, collisionState.z) >= 1.9 - 1e-9);
}
assert.equal(collisionState.speed, 0);
writeFileSync(new URL("./measurements.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("Sandbox assertions passed: release, frame rates, tremor, arrival, clearance, and camera return.");
