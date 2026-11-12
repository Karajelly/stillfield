import assert from "node:assert/strict";
import { it } from "node:test";
import { angleDifference, cellsUnderSweep, FIELD } from "./simulation";
import type { Obstacle, Point, Tool, TractorState } from "./simulation";
import { TractorNavigation } from "./tractor-navigation";
import { GentleDrive, tuning } from "./handling";
import { WorkDestination } from "./work-destination";

function meadow(initial: TractorState, follow = false, fps = 60, pace = 0.85) {
  const nav = new TractorNavigation(), cells = new Map<number, number>();
  let state = initial, tool: Tool = "mow", obstacles: Obstacle[] = [];
  const step = (manual: Parameters<TractorNavigation["step"]>[5] = null) => {
    const result = nav.step(state, 1 / fps, tool, obstacles, pace, manual, follow);
    state = result.state;
    result.paint.forEach((p, i, points) => {
      for (const cell of cellsUnderSweep(points[Math.max(0, i - 1)], p, tuning.brushRadius + FIELD.cell / 2))
        cells.set(cell, tool === "mow" ? 1 : tool === "cultivate" ? 2 : 3);
    });
    return result;
  };
  const settle = () => {
    for (let i = 0; i < fps * 30 && (nav.target || state.speed); i++) step();
    assert.equal(nav.target, null, JSON.stringify({ state, target: nav.target, follow, fps, pace }));
    assert.equal(state.speed, 0);
  };
  return { nav, cells, step, settle, get state() { return state; },
    choose(point: Point) { nav.choose(point, state, tool, obstacles); },
    tool(value: Tool) { tool = value; nav.changeTool(state, tool, obstacles); },
    obstacles(value: Obstacle[]) { obstacles = value; },
  };
}

it("works through endpoints and settles for every tool, view, frame rate and close approach", () => {
  const points = [{ x: FIELD.maxX, z: 0.125 }, { x: FIELD.minX, z: 0.125 },
    { x: 0.125, z: FIELD.minZ }, { x: 0.125, z: FIELD.maxZ }, { x: FIELD.maxX, z: FIELD.maxZ }];
  for (const follow of [false, true]) for (const fps of [30, 60, 120]) for (const tool of ["mow", "cultivate", "sow"] as const) {
    for (const point of points) {
      const farm = meadow({ x: 0, z: 0, heading: Math.atan2(point.x, point.z), speed: 0 }, follow, fps);
      farm.tool(tool); farm.choose(point); farm.settle();
      const cell = WorkDestination.create(point, farm.state, tool)!.cell;
      assert.equal(farm.cells.get(cell), tool === "mow" ? 1 : tool === "cultivate" ? 2 : 3);
    }
  }
  for (const follow of [false, true]) for (const speed of [0, 3, 4.5])
    for (const distance of [0.01, 0.3, 1, 2, 3, 5, 10]) for (const degrees of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
      const angle = degrees * Math.PI / 180, point = { x: Math.sin(angle) * distance, z: Math.cos(angle) * distance };
      const farm = meadow({ x: 0, z: 0, heading: 0, speed }, follow);
      farm.choose(point); farm.settle();
      assert.equal(farm.cells.get(WorkDestination.create(point, farm.state, "mow")!.cell), 1);
    }
});

it("a neighboring tap after actual work preserves its position, faces back, and waits", () => {
  for (const follow of [false, true]) for (const fps of [30, 60, 120])
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -0.7])
      for (const lateral of [-2.5, -0.25, 0.25, 2.5]) {
        const farm = meadow({ x: -15 * Math.sin(heading), z: -15 * Math.cos(heading), heading, speed: 0 }, follow, fps);
        farm.choose({ x: 0.125, z: 0.125 }); farm.settle();
        const row = farm.nav.rows.last!;
        assert.ok(row);
        const point = { x: row.end.x + Math.cos(row.heading) * lateral, z: row.end.z - Math.sin(row.heading) * lateral };
        farm.choose(point);
        assert.ok(farm.nav.turn); assert.deepEqual(farm.nav.target, point);
        farm.settle();
        assert.ok(Math.abs(angleDifference(farm.state.heading, row.heading + Math.PI)) < 0.025);
        assert.ok(Math.abs((farm.state.x - point.x) * Math.cos(row.heading) - (farm.state.z - point.z) * Math.sin(row.heading)) < 0.06);
        const stopped = farm.state;
        for (let i = 0; i < fps * 3; i++) farm.step();
        assert.deepEqual(farm.state, stopped);
      }
});

it("six player-selected rows 2.5 m apart cover the intervening meadow", () => {
  for (const follow of [false, true]) for (const pace of [0.55, 0.85, 1.25]) {
    const farm = meadow({ x: -18.125, z: -9.875, heading: Math.PI / 2, speed: 0 }, follow, 60, pace);
    for (let row = 0; row < 6; row++) {
      const z = -9.875 + row * 2.5, x = row % 2 ? -19.875 : 17.875;
      if (row) {
        farm.choose({ x: row % 2 ? 17.875 : -19.875, z });
        assert.ok(farm.nav.turn, JSON.stringify({ row, follow, pace, state: farm.state, memory: farm.nav.rows.last, point: farm.nav.target }));
        farm.settle();
      }
      farm.choose({ x, z }); farm.settle();
    }
    const columns = (FIELD.maxX - FIELD.minX) / FIELD.cell;
    const rows = (FIELD.maxZ - FIELD.minZ) / FIELD.cell;
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const x = FIELD.minX + (col + 0.5) * FIELD.cell;
      const z = FIELD.minZ + (row + 0.5) * FIELD.cell;
      if (x < -17.875 || x > 17.625 || z < -9.875 || z > 2.625) continue;
      assert.equal(farm.cells.get(row * columns + col), 1, JSON.stringify({ x, z, follow, pace }));
    }
  }
});

it("retargeting, working-tool changes, Wander, and interruptions never continue an old row", () => {
  const farm = meadow({ x: -15, z: 0.125, heading: Math.PI / 2, speed: 0 }, true);
  farm.choose({ x: 0.125, z: 0.125 }); farm.settle();
  const point = { x: 0.125, z: 2.625 };
  farm.choose(point); farm.tool("cultivate");
  assert.ok(farm.nav.turn);
  while (farm.nav.turn) farm.step();
  farm.tool("sow"); farm.settle();
  assert.equal(farm.cells.get(WorkDestination.create(point, farm.state, "mow")!.cell), 3);
  assert.ok(Math.abs(angleDifference(farm.state.heading, -Math.PI / 2)) < 0.025);
  const count = farm.cells.size;
  farm.tool("wander"); farm.choose({ x: -8, z: 5 }); farm.settle();
  assert.equal(farm.cells.size, count);
  assert.ok(Math.hypot(farm.state.x + 8, farm.state.z - 5) < 0.6);
  farm.tool("mow"); farm.choose({ x: 12, z: 2 });
  for (let i = 0; i < 40; i++) farm.step();
  farm.choose({ x: -10, z: 0 }); farm.settle();
  farm.choose({ x: 12, z: 0 });
  for (let i = 0; i < 60; i++) farm.step();
  farm.nav.cancel(); const heading = farm.state.heading;
  farm.settle(); assert.equal(farm.state.heading, heading);
});

it("blocked work cannot remotely paint its target and neutral steering has no angular coast", () => {
  for (const follow of [false, true]) {
    const farm = meadow({ x: 0, z: 0, heading: Math.PI / 2, speed: 0 }, follow);
    farm.obstacles([{ x: 8, z: 0, radius: 2 }]); farm.choose({ x: 12, z: 0.125 }); farm.settle();
    assert.equal(farm.cells.has(WorkDestination.create({ x: 12, z: 0.125 }, farm.state, "mow")!.cell), false);
  }
  const swings = [30, 60, 120].map((fps) => {
    // Position control: a held drag swings to its direction and keeps it, never circling.
    const drive = new GentleDrive(); let state = { x: 0, z: 0, heading: 0, speed: 3 };
    for (let i = 0; i < fps * 4; i++) state = drive.step(state, 1 / fps, { heading: -Math.PI / 2 });
    assert.ok(Math.abs(state.heading + Math.PI / 2) < 0.01, `${fps} Hz settles on the chosen heading`);
    assert.ok(state.speed > 2.9, "straight again, back to cruise");
    const heading = state.heading;
    for (let i = 0; i < fps; i++) state = drive.step(state, 1 / fps, null);
    assert.equal(state.heading, heading); assert.equal(state.speed, 0);
    return state;
  });
  for (const swing of swings.slice(1)) assert.ok(Math.hypot(swing.x - swings[0].x, swing.z - swings[0].z) < 0.15);
});

it("repeated drag destinations preserve the attachment sweep between frames", () => {
  const nav = new TractorNavigation();
  let state = { x: 0, z: 0, heading: Math.PI / 2, speed: 4.5 };
  nav.choose({ x: 15, z: 0 }, state, "mow", []);
  const first = nav.step(state, 1 / 30, "mow", []);
  state = first.state;
  nav.choose({ x: 15.1, z: 0 }, state, "mow", []);
  const second = nav.step(state, 1 / 30, "mow", []);
  assert.deepEqual(second.paint[0], first.paint.at(-1));
  assert.notDeepEqual(second.paint[0], second.paint.at(-1));
});

it("tractor-view keys roll, steer gently, straighten on release, and settle on S", () => {
  for (const fps of [30, 60, 120]) {
    const drive = new GentleDrive(); let state = { x: 0, z: 0, heading: 0, speed: 0 };
    for (let i = 0; i < fps * 2; i++) state = drive.step(state, 1 / fps, { keys: { throttle: 1, steer: 0 } });
    assert.ok(state.speed > 2.9 && state.heading === 0 && state.z > 3);
    // A quick press of D only nudges the heading to the right.
    for (let i = 0; i < fps / 10; i++) state = drive.step(state, 1 / fps, { keys: { throttle: 1, steer: 1 } });
    assert.ok(state.heading < 0 && state.heading > -0.05, `nudge ${state.heading}`);
    const nudged = state.heading;
    state = drive.step(state, 1 / fps, { keys: { throttle: 1, steer: 0 } });
    assert.equal(state.heading, nudged, "letting go straightens at once");
    // A alone rolls slowly around a gentle left turn.
    for (let i = 0; i < fps * 2; i++) state = drive.step(state, 1 / fps, { keys: { throttle: 0, steer: -1 } });
    assert.ok(state.heading > nudged + 1 && Math.abs(state.speed - tuning.tightTurnSpeed) < 0.05);
    // S settles to a stop without pivoting, even with a steering key held.
    const before = state.heading;
    for (let i = 0; i < fps; i++) state = drive.step(state, 1 / fps, { keys: { throttle: -1, steer: 1 } });
    assert.equal(state.speed, 0); assert.equal(state.heading, before);
  }
});

it("a held tractor-view drag works and paints like any other pass", () => {
  const farm = meadow({ x: -10, z: 0, heading: Math.PI / 2, speed: 0 }, true);
  for (let i = 0; i < 60 * 3; i++) farm.step({ heading: Math.PI / 2 });
  assert.ok(farm.state.x > -3 && farm.cells.size > 40);
  assert.equal(farm.nav.target, null);
});
