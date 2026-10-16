import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceTractor,
  angleDifference,
  cellsUnderBrush,
  FIELD,
} from "./simulation";
import type { Obstacle, Point, TractorState } from "./simulation";
import { GentleDrive } from "./handling";

const stationary: TractorState = { x: 0, z: 0, heading: 0, speed: 0 };
const frame = 1 / 60;

function drive(
  initial: TractorState,
  target: Point | null,
  frames: number,
  pace = 0.85,
) {
  let state = initial;
  for (let index = 0; index < frames; index++) {
    state = advanceTractor(state, target, frame, [], false, pace);
  }
  return state;
}

describe("advanceTractor", () => {
  it("accelerates smoothly toward a forward destination without sideways drift", () => {
    const first = advanceTractor(stationary, { x: 0, z: 20 }, frame, [], false);
    const cruising = drive(stationary, { x: 0, z: 20 }, 120);
    assert.ok(first.speed > 0 && first.speed < 1);
    assert.ok(cruising.z > 5 && cruising.z < 20);
    assert.equal(cruising.x, 0);
    assert.equal(cruising.heading, 0);
    assert.ok(cruising.speed > first.speed && cruising.speed <= 3);
    assert.deepEqual(stationary, { x: 0, z: 0, heading: 0, speed: 0 });
  });

  it("limits steering rate even when the destination is behind the tractor", () => {
    const next = advanceTractor(stationary, { x: 0, z: -20 }, frame, [], false);
    assert.ok(
      Math.abs(angleDifference(next.heading, stationary.heading)) <=
        2.4 * frame + 1e-12,
    );
    assert.ok(Math.abs(next.heading) > 0);
  });

  it("takes the short turn across the negative/positive pi boundary", () => {
    const initial = { ...stationary, heading: Math.PI - 0.01 };
    const next = advanceTractor(initial, { x: -0.3, z: -10 }, frame, [], false);
    const turn = angleDifference(next.heading, initial.heading);
    assert.ok(turn > 0 && turn <= 2.4 * frame + 1e-12);
  });

  it("coasts to a complete stop after steering is released", () => {
    const initial = { ...stationary, speed: 4.5 };
    const first = advanceTractor(initial, null, frame, [], false);
    const stopped = drive(initial, null, 120);
    assert.ok(first.speed > 0 && first.speed < initial.speed);
    assert.ok(stopped.z > first.z && stopped.z < 1);
    assert.equal(stopped.speed, 0);
    assert.deepEqual(advanceTractor(stopped, null, frame, [], false), stopped);
  });

  it("does not drive when already at the destination", () => {
    assert.deepEqual(
      advanceTractor(stationary, { x: 0, z: 0 }, frame, [], false),
      stationary,
    );
  });

  it("caps a delayed frame and ignores negative elapsed time", () => {
    const initial = { ...stationary, speed: 2, heading: 0.4 };
    const target = { x: 10, z: 20 };
    assert.deepEqual(
      advanceTractor(initial, target, 5, [], false),
      advanceTractor(initial, target, 0.05, [], false),
    );
    assert.deepEqual(advanceTractor(initial, target, -1, [], false), initial);
    assert.deepEqual(advanceTractor(initial, target, 0, [], false), initial);
  });

  it("maintains tractor clearance while repeatedly driving into an obstacle", () => {
    const obstacle: Obstacle = { x: 0, z: 0, radius: 1 };
    let state: TractorState = { x: 0, z: -3, heading: 0, speed: 4 };
    for (let index = 0; index < 180; index++) {
      state = advanceTractor(state, { x: 0, z: 10 }, frame, [obstacle], false);
      assert.ok(
        Math.hypot(state.x - obstacle.x, state.z - obstacle.z) >= 1.9 - 1e-10,
      );
      assert.ok(Object.values(state).every(Number.isFinite));
    }
  });

  it("recovers finite coordinates when loaded directly at an obstacle center", () => {
    const next = advanceTractor(
      stationary,
      null,
      frame,
      [{ x: 0, z: 0, radius: 2 }],
      false,
    );
    assert.ok(Object.values(next).every(Number.isFinite));
    assert.ok(Math.hypot(next.x, next.z) >= 2.9 - 1e-10);
  });

  it("stops the wheels when a destination is blocked directly by an obstacle", () => {
    const obstacle: Obstacle = { x: 0, z: 0, radius: 1 };
    let state: TractorState = { x: 0, z: -3, heading: 0, speed: 4 };
    for (let index = 0; index < 600; index++) {
      state = advanceTractor(state, { x: 0, z: 10 }, frame, [obstacle], false);
    }
    assert.equal(state.speed, 0);
    assert.ok(Math.abs(state.z + 1.9) < 1e-10);
    const next = advanceTractor(
      state,
      { x: 0, z: 10 },
      frame,
      [obstacle],
      false,
    );
    assert.equal(next.speed, 0);
    assert.ok(Math.hypot(next.x - state.x, next.z - state.z) < 1e-10);
  });

  it("can steer away and resume moving after stopping against an obstacle", () => {
    const obstacle: Obstacle = { x: 0, z: 0, radius: 1 };
    let state: TractorState = { x: 0, z: -1.9, heading: 0, speed: 0 };
    for (let index = 0; index < 180; index++) {
      state = advanceTractor(
        state,
        { x: -10, z: -3 },
        frame,
        [obstacle],
        false,
      );
      assert.ok(Math.hypot(state.x, state.z) >= 1.9 - 1e-10);
    }
    assert.ok(state.x < -5);
    assert.ok(state.speed > 0);
  });

  it("stops reporting motion when the playable boundary prevents travel", () => {
    const initial: TractorState = {
      x: 39,
      z: 0,
      heading: Math.PI / 2,
      speed: 5,
    };
    const next = advanceTractor(initial, { x: 100, z: 0 }, frame, [], false);
    assert.equal(next.x, 39);
    assert.equal(next.speed, 0);
  });

  it("keeps the tractor inside the playable world at each outer edge", () => {
    for (const [x, z, heading, target] of [
      [38.99, 0, Math.PI / 2, { x: 100, z: 0 }],
      [-38.99, 0, -Math.PI / 2, { x: -100, z: 0 }],
      [0, 27.99, 0, { x: 0, z: 100 }],
      [0, -29.99, Math.PI, { x: 0, z: -100 }],
    ] as const) {
      const next = advanceTractor(
        { x, z, heading, speed: 5 },
        target,
        0.05,
        [],
        false,
      );
      assert.ok(next.x >= -39 && next.x <= 39);
      assert.ok(next.z >= -30 && next.z <= 28);
    }
  });

  it("straightens a near-cardinal row only when assistance is enabled", () => {
    const target = { x: 0.5, z: 12 };
    const assisted = advanceTractor(stationary, target, frame, [], true);
    const free = advanceTractor(stationary, target, frame, [], false);
    assert.equal(assisted.heading, 0);
    assert.ok(free.heading > 0);
  });

  it("cruises at 3 m/s by default and lets the pace slider reach 4.5 m/s in every drive mode", () => {
    const slow = drive(stationary, { x: 0, z: 25 }, 120, 0.55);
    const normal = drive(stationary, { x: 0, z: 25 }, 120);
    const quick = drive(stationary, { x: 0, z: 25 }, 120, 1.25);
    assert.ok(slow.z > 0 && normal.z > slow.z && quick.z > normal.z);
    assert.ok(normal.speed > 2.99 && normal.speed <= 3);
    for (const [pace, limit] of [[0.55, 1.875], [0.85, 3], [1.25, 4.5]]) {
      const iso = drive(stationary, { x: 0, z: 25 }, 120, pace);
      assert.ok(iso.speed > limit - 0.01 && iso.speed <= limit);
      for (const input of [{ drag: 0 }, { target: { x: 0, z: 25 } }]) {
        const driver = new GentleDrive();
        let state = stationary;
        for (let i = 0; i < 120; i++) state = driver.step(state, frame, input, [], 1, pace);
        assert.ok(state.speed > limit - 0.01 && state.speed <= limit);
      }
    }
  });
});

describe("cellsUnderBrush", () => {
  const columns = (FIELD.maxX - FIELD.minX) / FIELD.cell;
  const rows = (FIELD.maxZ - FIELD.minZ) / FIELD.cell;
  const size = columns * rows;

  it("finds the exact first and last cell centers with a zero-radius brush", () => {
    assert.deepEqual(
      cellsUnderBrush(FIELD.minX + FIELD.cell / 2, FIELD.minZ + FIELD.cell / 2, 0),
      [0],
    );
    assert.deepEqual(
      cellsUnderBrush(FIELD.maxX - FIELD.cell / 2, FIELD.maxZ - FIELD.cell / 2, 0),
      [size - 1],
    );
  });

  it("includes cell centers on the circular brush boundary", () => {
    assert.deepEqual(
      cellsUnderBrush(FIELD.minX + FIELD.cell / 2, FIELD.minZ + FIELD.cell / 2, FIELD.cell),
      [0, 1, columns],
    );
  });

  it("clips correctly at both field corners without wrapping into other rows", () => {
    assert.deepEqual(cellsUnderBrush(FIELD.minX, FIELD.minZ, FIELD.cell * 1.6), [
      0,
      1,
      columns,
    ]);
    assert.deepEqual(cellsUnderBrush(FIELD.maxX, FIELD.maxZ, FIELD.cell * 1.6), [
      size - columns - 1,
      size - 2,
      size - 1,
    ]);
  });

  it("returns no cells for a brush entirely outside any edge", () => {
    for (const [x, z] of [
      [FIELD.minX - 2, 0],
      [FIELD.maxX + 2, 0],
      [0, FIELD.minZ - 2],
      [0, FIELD.maxZ + 2],
    ])
      assert.deepEqual(cellsUnderBrush(x, z, 0.5), []);
  });

  it("still paints overlapping cells when the brush center is outside the field", () => {
    assert.deepEqual(
      cellsUnderBrush(FIELD.minX - 0.05, FIELD.minZ + FIELD.cell / 2, FIELD.cell / 2 + 0.05),
      [0],
    );
    assert.deepEqual(
      cellsUnderBrush(FIELD.maxX + 0.05, FIELD.maxZ - FIELD.cell / 2, FIELD.cell / 2 + 0.05),
      [size - 1],
    );
  });

  it("never repeats cells or includes cells outside the circular footprint", () => {
    const x = -1.3,
      z = 2.7,
      radius = 1.15;
    const cells = cellsUnderBrush(x, z, radius);
    assert.ok(cells.length > 12);
    assert.equal(new Set(cells).size, cells.length);
    for (const index of cells) {
      assert.ok(index >= 0 && index < size);
      const centerX = FIELD.minX + ((index % columns) + 0.5) * FIELD.cell;
      const centerZ =
        FIELD.minZ + (Math.floor(index / columns) + 0.5) * FIELD.cell;
      assert.ok(Math.hypot(centerX - x, centerZ - z) <= radius + 1e-10);
    }
  });
});
