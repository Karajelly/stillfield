import assert from "node:assert/strict";
import { it } from "node:test";
import { FARMING_CONFIG, FarmingEngine, Ground } from "./farming";
import { FIELD_COLUMNS } from "./simulation";
import type { Obstacle, Tool } from "./simulation";
import { cellCentre, DECK_REACH, LANE_CELLS, laneCentre, rowHeading } from "./tidy-rows";
import type { Axis } from "./tidy-rows";
import { TractorNavigation } from "./tractor-navigation";
import { attachmentPoint } from "./work-destination";

type Controls = Parameters<TractorNavigation["step"]>[5];
const forward = { keys: { throttle: 1, steer: 0 } };

function drive(axis: Axis = "x", dir: 1 | -1 = -1, fps = 60, initialTool: Tool = "plow", pace = 0.85) {
  const nav = new TractorNavigation();
  nav.tidy = true;
  const farm = new FarmingEngine(undefined, FARMING_CONFIG, false);
  const obstacles: Obstacle[] = [];
  if (initialTool === "sow") farm.applyCells(farm.cells.keys(), "plow");
  let state = { x: laneCentre("z", 8), z: laneCentre("x", 4), heading: rowHeading(axis, dir), speed: 0 };
  let tool = initialTool;

  function step(input: Controls) {
    const move = nav.step(state, 1 / fps, tool, obstacles, pace, input, true);
    state = move.state;
    farm.applyCells(move.cells, tool);
    for (let i = 1; i < move.paint.length; i++) farm.apply(move.paint[i - 1], move.paint[i], tool);
  }
  function hold(input: Controls, seconds: number) {
    for (let i = 0; i < Math.round(seconds * fps); i++) step(input);
  }
  function cells(ground: number = Ground.soil) {
    return Array.from(farm.cells.keys()).filter(i => farm.cells[i] === ground);
  }
  return {
    nav, obstacles, hold, cells,
    get state() { return state; },
    setTool(next: Tool) {
      tool = next;
      nav.changeTool(state, tool, obstacles);
    },
    turn(side: number) {
      hold(null, 0.7);
      hold({ keys: { throttle: 0, steer: side } }, 2.9);
      hold(null, 0.7);
    },
  };
}

it("matches both worked ends through two consecutive hand-steered U-turns", () => {
  for (const axis of ["x", "z"] as const) for (const dir of [-1, 1] as const)
    for (const side of [-1, 1]) for (const fps of [30, 120]) {
      const meadow = drive(axis, dir, fps);
      meadow.hold(forward, 2.4);
      const first = meadow.cells();
      assert.ok(first.length >= 10 * LANE_CELLS);
      const laneStep = side * dir * (axis === "x" ? FIELD_COLUMNS : -1) * LANE_CELLS;
      const expected = new Set(first);
      for (const pass of [1, 2]) {
        meadow.turn(pass === 1 ? side : -side);
        assert.deepEqual(new Set(meadow.cells()), expected, "the implement stays up through the turn");
        meadow.hold(forward, 9);
        for (const cell of first) expected.add(cell + pass * laneStep);
        assert.deepEqual(new Set(meadow.cells()), expected,
          `pass ${pass} along ${axis}, direction ${dir}, steer ${side}, ${fps} Hz`);
        assert.equal(meadow.state.speed, 0, "continued throttle settles at the end");
        const parked = { ...meadow.state };
        meadow.hold(forward, 1);
        assert.deepEqual(meadow.state, parked);
      }
    }
});

it("shows the adjacent pass during a rough U-turn and catches it when steering is released", () => {
  for (const seconds of [2.6, 3.2]) {
    const meadow = drive();
    meadow.hold(forward, 2.4);
    const first = meadow.cells();
    meadow.hold({ keys: { throttle: 1, steer: 1 } }, seconds);
    assert.deepEqual(meadow.cells(), first);
    const lane = meadow.nav.manualLane(meadow.state);
    assert.ok(lane && meadow.nav.previewReturn(lane, meadow.state)?.phase === "approach");
    meadow.hold(forward, 9);
    const adjacent = first.map(cell => cell - LANE_CELLS * FIELD_COLUMNS);
    assert.deepEqual(new Set(meadow.cells()), new Set([...first, ...adjacent]));
    assert.equal(meadow.state.speed, 0);
  }
});

it("closes a two-pass square with a continuous drag-steered reversal while planting or mowing", () => {
  for (const [tool, result] of [["sow", Ground.growing], ["mow", Ground.mown]] as const) {
    const meadow = drive("x", -1, 60, tool);
    const outbound = meadow.state.heading;
    const halfSquare = 2 * LANE_CELLS ** 2;
    for (let frames = 0; frames < 300 && meadow.cells(result).length < halfSquare; frames++)
      meadow.hold({ heading: outbound }, 1 / 60);
    meadow.hold(null, 0.7);
    const first = meadow.cells(result);
    assert.equal(first.length, halfSquare);
    const laneStep = (tool === "sow" ? 1 : -1) * LANE_CELLS * FIELD_COLUMNS;
    // A drag across the screen requests a heading and keeps driving as it turns.
    meadow.hold({ heading: outbound + Math.sign(laneStep) * (Math.PI - 0.01) }, 9);
    assert.deepEqual(new Set(meadow.cells(result)), new Set([...first, ...first.map(i => i + laneStep)]));
    assert.equal(meadow.state.speed, 0);
  }
});

it("immediately lifts when a drag steers diagonally out of a matched lane", () => {
  const meadow = drive();
  meadow.hold(forward, 3);
  meadow.turn(1);
  meadow.hold(forward, 2.4);
  assert.equal(meadow.nav.matchedPass?.phase, "working");
  const before = meadow.cells();
  const heading = meadow.state.heading;
  meadow.hold({ heading: heading + 0.5 }, 1);
  assert.ok(Math.abs(meadow.state.heading - heading) > 0.4);
  assert.deepEqual(meadow.cells(), before);
});

it("stops working at an obstruction in a matched lane", () => {
  const meadow = drive();
  meadow.hold(forward, 2.9);
  const first = meadow.cells();
  meadow.turn(1);
  const endColumn = Math.max(...first.map(cell => cell % FIELD_COLUMNS));
  const obstacle = { x: cellCentre("x", endColumn), z: laneCentre("x", 3), radius: 0.5 };
  meadow.obstacles.push(obstacle);
  meadow.hold(forward, 9);
  const newCells = meadow.cells().filter(cell => !first.includes(cell));
  const adjacent = new Set(first.map(cell => cell - LANE_CELLS * FIELD_COLUMNS));
  assert.ok(newCells.length > 0 && newCells.length < adjacent.size);
  assert.ok(newCells.every(cell => adjacent.has(cell) && cell % FIELD_COLUMNS < endColumn));
  const stopped = { ...meadow.state };
  meadow.hold(forward, 1);
  assert.deepEqual(meadow.state, stopped);
  assert.equal(meadow.cells().length, first.length + newCells.length);
});

it("leaves a gap under the obstacle when the driver steers around it and rejoins the row", () => {
  const meadow = drive();
  meadow.hold(forward, 6);
  meadow.turn(1);
  const column = 30;
  const obstacle = { x: cellCentre("x", column), z: laneCentre("x", 3), radius: 0.55 };
  meadow.obstacles.push(obstacle);
  meadow.hold(forward, 8);
  assert.equal(meadow.state.speed, 0);

  const east = Math.PI / 2;
  meadow.hold({ heading: east - 0.70 }, 2.5);
  meadow.hold({ heading: east + 0.95 }, 1.55);
  meadow.hold({ heading: east }, 3);
  const soil = meadow.cells();
  const middleOfRow = 3 * LANE_CELLS + Math.floor(LANE_CELLS / 2);
  assert.ok(soil.some(cell => Math.floor(cell / FIELD_COLUMNS) === middleOfRow && cell % FIELD_COLUMNS > column + 2));
  for (const cell of soil) {
    const x = cellCentre("x", cell % FIELD_COLUMNS);
    const z = cellCentre("z", Math.floor(cell / FIELD_COLUMNS));
    assert.ok(Math.hypot(x - obstacle.x, z - obstacle.z) > obstacle.radius,
      "lowering the deck on the far side must preserve the gap left by the detour");
  }
});

it("lets go halfway through a matched lane, resumes it, and extends only on a new press at the end", () => {
  const meadow = drive();
  meadow.hold(forward, 2.9);
  const first = meadow.cells();
  const adjacent = first.map(i => i - LANE_CELLS * FIELD_COLUMNS);
  const expected = new Set([...first, ...adjacent]);
  meadow.turn(1);
  meadow.hold(forward, 2.5);
  const partial = meadow.cells();
  assert.ok(partial.length > first.length && partial.length < expected.size);
  meadow.hold(null, 3);
  assert.deepEqual(meadow.cells(), partial);
  assert.equal(meadow.state.speed, 0);
  meadow.hold(forward, 8);
  assert.deepEqual(new Set(meadow.cells()), expected);
  assert.equal(meadow.state.speed, 0);

  meadow.hold(null, 0.4);
  meadow.hold(forward, 1.5);
  const extension = meadow.cells().filter(cell => !expected.has(cell));
  assert.ok(extension.length >= 2 * LANE_CELLS);
  const rows = new Set(adjacent.map(cell => Math.floor(cell / FIELD_COLUMNS)));
  assert.ok(extension.every(cell => rows.has(Math.floor(cell / FIELD_COLUMNS))
    && cell % FIELD_COLUMNS > Math.max(...adjacent.map(i => i % FIELD_COLUMNS))));
});

it("can finish the last column after releasing almost exactly on the end flag", () => {
  for (const fps of [20, 60, 120]) {
    const meadow = drive("x", -1, fps, "plow", 0.55);
    meadow.hold(forward, 2.4);
    const first = meadow.cells();
    const end = cellCentre("x", Math.max(...first.map(cell => cell % FIELD_COLUMNS)));
    const remaining = () => end - (attachmentPoint(meadow.state).x + DECK_REACH);
    meadow.turn(1);
    for (let i = 0; i < fps * 12 && remaining() >= 0.04; i++) meadow.hold(forward, 1 / fps);
    assert.ok(remaining() > 0 && remaining() < 0.04);
    const beforeRelease = meadow.cells();
    meadow.hold(null, 1);
    assert.deepEqual(meadow.cells(), beforeRelease, "the raised deck leaves the final column untouched");
    meadow.hold(forward, 2);
    const adjacent = first.map(cell => cell - LANE_CELLS * FIELD_COLUMNS);
    assert.deepEqual(new Set(meadow.cells()), new Set([...first, ...adjacent]));
    assert.equal(meadow.state.speed, 0);
  }
});

it("changing tools or choosing Freehand leaves the next pass under the driver's control", () => {
  for (const change of ["tool", "freehand"] as const) {
    const meadow = drive();
    meadow.hold(forward, 2.4);
    meadow.turn(1);
    if (change === "tool") meadow.setTool("mow");
    else {
      meadow.nav.cancel();
      meadow.nav.tidy = false;
    }
    meadow.hold(forward, 6);
    assert.ok(meadow.state.speed > 1, "the preceding tool's end should not stop travel");
  }
});
