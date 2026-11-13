import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { advanceGridTractor, DriveKeyboard, GridKeyboard, gridHeading } from "./keyboard-navigation";
import { overviewFraming } from "./overview";
import { angleDifference, cruiseSpeed, WORLD } from "./simulation";
import type { TractorState } from "./simulation";
import { TractorNavigation } from "./tractor-navigation";
import { attachmentPoint } from "./work-destination";

const landscape = { x: 60, z: 89 }, portrait = { x: 84, z: 38 };
const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test("WASD and arrows follow orthogonal field axes in wide, narrow, and intermediate views", () => {
  for (const aspect of [2, 1.4, 1, 0.97, 0.95, 0.93, 0.9, 0.85, 0.8, 0.5]) {
    const { position, focus } = overviewFraming(aspect);
    const down = position.clone().sub(focus).setY(0).normalize();
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(position); camera.lookAt(focus); camera.updateMatrixWorld();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const headings: number[] = [];
    for (const [key, arrow, axis, sign] of [
      ["KeyW", "ArrowUp", up, 1], ["KeyA", "ArrowLeft", right, -1],
      ["KeyS", "ArrowDown", up, -1], ["KeyD", "ArrowRight", right, 1],
    ] as const) {
      const heading = gridHeading(key, down);
      close(angleDifference(gridHeading(arrow, down), heading), 0);
      close(heading / (Math.PI / 2), Math.round(heading / (Math.PI / 2)));
      const direction = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      assert.ok(direction.dot(axis) * sign > 0, `${key} follows its visible direction at aspect ${aspect}`);
      headings.push(heading);
    }
    assert.equal(new Set(headings).size, 4);
  }
  close(gridHeading("KeyW", landscape), Math.PI);
  close(gridHeading("KeyD", landscape), Math.PI / 2);
  close(gridHeading("KeyW", portrait), -Math.PI / 2);
  close(gridHeading("KeyD", portrait), Math.PI);
});

test("latest press wins without diagonals, repeats cannot take over, and aliases release independently", () => {
  const keys = new GridKeyboard();
  keys.press("KeyW", landscape);
  keys.press("KeyD", landscape);
  keys.press("KeyW", landscape);
  close(keys.input!.heading, Math.PI / 2);
  keys.release("KeyD");
  close(keys.input!.heading, Math.PI);
  keys.press("ArrowUp", landscape);
  keys.release("KeyW");
  assert.equal(keys.input!.driving, true);
  keys.press("KeyS", landscape);
  close(keys.input!.heading, 0);
  keys.release("KeyS"); keys.release("ArrowUp");
  assert.equal(keys.input!.driving, false);
  close(keys.input!.heading, Math.PI);
  keys.reset(); keys.press("Space", landscape);
  assert.equal(keys.input, null);
});

test("resizing preserves a held direction and applies the new view on the next press", () => {
  const keys = new GridKeyboard();
  keys.press("KeyW", landscape);
  keys.press("KeyW", portrait);
  close(keys.input!.heading, Math.PI);
  keys.release("KeyW"); keys.press("KeyW", portrait);
  close(keys.input!.heading, -Math.PI / 2);
  keys.reset();
  assert.equal(keys.input, null);
});

test("quarter turns and reversals stay in the same cell, even when starting at full speed", () => {
  for (const fps of [30, 60, 120]) for (const from of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7])
    for (const to of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      let state: TractorState = { x: 1.13, z: 2.28, heading: from, speed: 4.5 };
      for (let i = 0; i < fps && Math.abs(angleDifference(to, state.heading)) > 1e-8; i++) {
        const previous = state;
        state = advanceGridTractor(state, { heading: to, driving: true }, 1 / fps, []);
        assert.equal(state.x, 1.13); assert.equal(state.z, 2.28); assert.equal(state.speed, 0);
        assert.ok(Math.abs(angleDifference(state.heading, previous.heading)) <= Math.PI * 2 / fps + 1e-8);
      }
      close(angleDifference(state.heading, to), 0);
    }
  let state: TractorState = { x: 0, z: 0, heading: 0, speed: 0 };
  const headings: number[] = [];
  for (let i = 0; i < 60; i++) {
    state = advanceGridTractor(state, { heading: Math.PI, driving: false }, 1 / 60, []);
    headings.push(state.heading);
  }
  assert.ok(headings.some(heading => Math.abs(heading - Math.PI / 2) < 1e-8));
  close(state.heading, Math.PI);
});

test("a short tap completes its turn without travel; release after driving stops immediately", () => {
  const keys = new GridKeyboard();
  let state = { x: -4, z: 4.8, heading: -Math.PI / 2, speed: 3 };
  keys.press("KeyW", landscape);
  state = advanceGridTractor(state, keys.input!, 1 / 60, []);
  keys.release("KeyW");
  for (let i = 0; i < 60; i++) state = advanceGridTractor(state, keys.input!, 1 / 60, []);
  close(state.heading, Math.PI);
  assert.equal(state.x, -4); assert.equal(state.z, 4.8); assert.equal(state.speed, 0);
  keys.press("KeyW", landscape);
  for (let i = 0; i < 60; i++) state = advanceGridTractor(state, keys.input!, 1 / 60, []);
  assert.ok(state.z < 3);
  keys.release("KeyW");
  const stopped = { ...state, speed: 0 };
  for (let i = 0; i < 60; i++) state = advanceGridTractor(state, keys.input!, 1 / 60, []);
  assert.deepEqual(state, stopped);
});

test("straight driving has no sideways drift and keeps the chosen pace across frame rates", () => {
  for (const fps of [30, 60, 120]) for (const pace of [0.55, 0.85, 1.25])
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      let state = { x: 1.13, z: 2.28, heading, speed: 0 };
      for (let i = 0; i < fps * 2; i++)
        state = advanceGridTractor(state, { heading, driving: true }, 1 / fps, [], pace);
      const expected = cruiseSpeed(pace) * (2 - (1 - Math.exp(-8)) / 4);
      close(state.x, 1.13 + Math.round(Math.sin(heading)) * expected);
      close(state.z, 2.28 + Math.round(Math.cos(heading)) * expected);
    }
});

test("obstacles and map edges stop grid driving without sideways slides, and allow backing away", () => {
  for (const across of [0, 0.5, 1.8]) {
    const obstacles = [{ x: across, z: 4, radius: 1 }];
    let state = { x: 0, z: 0, heading: 0, speed: 4.5 };
    for (let i = 0; i < 120; i++) state = advanceGridTractor(state, { heading: 0, driving: true }, 1 / 30, obstacles);
    assert.equal(state.x, 0); assert.equal(state.speed, 0);
    close(state.z, 4 - Math.sqrt(1.9 ** 2 - across ** 2));
    const contact = state.z;
    for (let i = 0; i < 60; i++) state = advanceGridTractor(state, { heading: Math.PI, driving: true }, 1 / 30, obstacles);
    assert.ok(state.z < contact - 1); assert.equal(state.x, 0);
  }
  for (const [x, z, heading] of [[WORLD.maxX, 0, Math.PI / 2], [WORLD.minX, 0, -Math.PI / 2], [0, WORLD.maxZ, 0], [0, WORLD.minZ, Math.PI]]) {
    const state = advanceGridTractor({ x, z, heading, speed: 4.5 }, { heading, driving: true }, 1 / 30, []);
    assert.deepEqual(state, { x, z, heading, speed: 0 });
  }
});

test("keyboard takes over destinations, lifts the implement through pivots, and resumes only the new row", () => {
  const nav = new TractorNavigation();
  let state = { x: 0, z: 0, heading: 0, speed: 3 };
  nav.choose({ x: 0, z: 10 }, state, "plow", []);
  state = nav.step(state, 1 / 60, "plow", []).state;
  const corner = { ...state };
  const grid = { heading: Math.PI / 2, driving: true };
  while (Math.abs(angleDifference(state.heading, grid.heading)) > 1e-8) {
    const result = nav.step(state, 1 / 60, "plow", [], 0.85, { grid });
    state = result.state;
    assert.equal(nav.target, null); assert.equal(nav.work, null); assert.equal(nav.turn, null);
    assert.equal(nav.gridTurning, true); assert.deepEqual(result.paint, []);
    assert.equal(state.x, corner.x); assert.equal(state.z, corner.z);
  }
  const brush = attachmentPoint(state);
  const moving = nav.step(state, 1 / 60, "plow", [], 0.85, { grid });
  assert.equal(nav.gridTurning, false);
  assert.ok(moving.state.x > state.x); assert.equal(moving.state.z, state.z);
  assert.deepEqual(moving.paint[0], brush);
  assert.equal(moving.paint[1].z, brush.z);
  const wandering = nav.step(moving.state, 1 / 60, "wander", [], 0.85, { grid });
  assert.deepEqual(wandering.paint, []);
  nav.cancel();
  const stopped = { ...wandering.state, speed: 0 };
  assert.deepEqual(nav.step(stopped, 1 / 60, "wander", []).state, stopped);
  nav.choose({ x: 12, z: 6 }, stopped, "wander", []);
  assert.ok(nav.step(stopped, 1 / 60, "wander", []).state.speed > 0);
});

test("tractor-view keys combine throttle and steering, and the latest key wins each axis", () => {
  const keys = new DriveKeyboard();
  const input = () => keys.input;
  assert.equal(input(), null);
  keys.press("KeyW"); keys.press("KeyD");
  assert.deepEqual(keys.input, { throttle: 1, steer: 1 });
  keys.press("ArrowLeft");
  assert.deepEqual(keys.input, { throttle: 1, steer: -1 });
  keys.release("ArrowLeft");
  assert.deepEqual(keys.input, { throttle: 1, steer: 1 });
  keys.press("KeyS");
  assert.equal(input()?.throttle, -1);
  keys.press("KeyQ");
  keys.reset();
  assert.equal(input(), null);
});
