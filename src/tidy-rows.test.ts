import assert from "node:assert/strict";
import { it } from "node:test";
import { FarmingEngine, FARMING_CONFIG, Ground } from "./farming";
import { FIELD, FIELD_COLUMNS, seededRandom } from "./simulation";
import type { Obstacle, Point, Tool, TractorState } from "./simulation";
import { TractorNavigation } from "./tractor-navigation";
import { attachmentPoint } from "./work-destination";
import {
  LANE_CELLS,
  LANE_WIDTH,
  laneCentre,
  planRows,
  rowCells,
} from "./tidy-rows";

const east = Math.PI / 2,
  west = -Math.PI / 2;
/** A blank meadow driven by taps, with the engine applying whatever is worked. */
function farm(
  initial: TractorState,
  tidy = true,
  fps = 60,
  obstacles: Obstacle[] = [],
  follow = false,
) {
  const engine = new FarmingEngine(undefined, FARMING_CONFIG, false);
  const nav = new TractorNavigation();
  nav.tidy = tidy;
  let state = initial,
    tool: Tool = "cultivate",
    slowest = Infinity;
  const workable = (cell: number) =>
    tool === "cultivate"
      ? engine.cells[cell] !== Ground.soil
      : tool === "sow"
        ? engine.cells[cell] === Ground.soil
        : engine.cells[cell] === Ground.mature;
  const step = (manual: Parameters<TractorNavigation["step"]>[5] = null) => {
    const result = nav.step(
      state,
      1 / fps,
      tool,
      obstacles,
      0.85,
      manual,
      follow,
    );
    state = result.state;
    result.paint.forEach((p, i, points) =>
      engine.apply(points[Math.max(0, i - 1)], p, tool, "wheat"),
    );
    if (result.cells.length) engine.applyCells(result.cells, tool, "wheat");
    if (nav.run) slowest = Math.min(slowest, state.speed);
    return result;
  };
  const idle = () => !nav.run && !nav.target && state.speed === 0;
  return {
    engine,
    nav,
    step,
    get state() {
      return state;
    },
    get slowest() {
      return slowest;
    },
    tap(point: Point, fill = false) {
      nav.choose(point, state, tool, obstacles, { fill, workable });
    },
    drag(point: Point) {
      nav.choose(point, state, tool, obstacles, { freehand: true, workable });
    },
    tool(value: Tool) {
      tool = value;
      nav.changeTool(state, tool, obstacles);
    },
    run(seconds: number) {
      for (let i = 0; i < seconds * fps; i++) step();
    },
    settle(limit = 600) {
      slowest = Infinity;
      for (let i = 0; i < limit * fps && !idle(); i++)
        assert.equal(step().blocked, false);
      assert.ok(idle(), "the tractor should come to rest");
    },
    /** Cells in a state, split into those inside the given lanes and the rest. */
    count(ground: number, lanes: number[] = []) {
      let inside = 0,
        outside = 0;
      engine.cells.forEach((cell, i) => {
        if (cell !== ground) return;
        const lane = Math.floor(Math.floor(i / FIELD_COLUMNS) / LANE_CELLS);
        if (lanes.includes(lane)) inside++;
        else outside++;
      });
      return { inside, outside, all: inside + outside };
    },
  };
}
const laneZ = (lane: number) => laneCentre("x", lane);

it("works one whole lane from the implement to the tap, wherever in the lane the tap lands", () => {
  for (const follow of [false, true])
    for (const fps of [30, 60, 120])
      for (const offset of [-1.2, -0.4, 0, 0.7, 1.2]) {
        const meadow = farm(
          { x: 22, z: laneZ(9), heading: west, speed: 0 },
          true,
          fps,
          [],
          follow,
        );
        meadow.tap({ x: -18.3, z: laneZ(9) + offset });
        meadow.settle();
        // Columns 13 to 89, five cells wide, and nothing else.
        assert.deepEqual(meadow.count(Ground.soil, [9]), {
          inside: 77 * 5,
          outside: 0,
          all: 77 * 5,
        });
        assert.ok(
          Math.abs(meadow.state.z - laneZ(9)) < 0.05,
          "the tractor ends on the lane's centre",
        );
      }
});

it("lays the next row beside the last with shared ends, no gap and no overlap", () => {
  const meadow = farm({ x: 22, z: laneZ(9), heading: west, speed: 0 });
  meadow.tap({ x: -18.3, z: 11.3 });
  meadow.settle();
  // A careless tap: a little short of the field's edge and off the lane's centre.
  meadow.tap({ x: 18.9, z: 9.9 });
  meadow.settle();
  assert.deepEqual(meadow.count(Ground.soil, [8, 9]), {
    inside: 2 * 77 * 5,
    outside: 0,
    all: 2 * 77 * 5,
  });
  for (let column = 13; column < 90; column++)
    for (let row = 40; row < 50; row++)
      assert.equal(
        meadow.engine.cells[row * FIELD_COLUMNS + column],
        Ground.soil,
      );
});

it("reaches a row to one side with the implement up, leaving the ground between untouched", () => {
  const meadow = farm({ x: -4, z: 4.8, heading: west, speed: 0 });
  meadow.tap({ x: -20, z: -3.25 });
  meadow.settle();
  const soil = meadow.count(Ground.soil, [3]);
  assert.equal(soil.outside, 0);
  assert.ok(soil.inside >= 170, `${soil.inside} cells`);
});

it("finishes the row in progress when the next is tapped early, then carries straight on", () => {
  for (const early of [1, 5, 11]) {
    const meadow = farm({ x: 22, z: laneZ(8), heading: west, speed: 0 });
    meadow.tap({ x: -20, z: laneZ(8) });
    meadow.run(15 - early);
    assert.ok(meadow.nav.run?.started);
    meadow.tap({ x: 19.4, z: laneZ(7) });
    assert.equal(meadow.nav.hasQueued, true);
    meadow.settle();
    assert.deepEqual(meadow.count(Ground.soil, [7, 8]), {
      inside: 2 * 80 * 5,
      outside: 0,
      all: 2 * 80 * 5,
    });
    assert.ok(
      meadow.slowest > 0.5,
      `it should not stop between rows (slowest ${meadow.slowest})`,
    );
  }
});

it("keeps a row that was asked for when the next is tapped before work on it has begun", () => {
  // The tractor is still crossing to its first row when two more are tapped.
  const meadow = farm({ x: -4, z: 4.8, heading: west, speed: 0 });
  meadow.tap({ x: -20.4, z: laneZ(3) });
  meadow.run(1.5);
  assert.equal(meadow.nav.run?.started, false);
  meadow.tap({ x: 2.3, z: laneZ(2) });
  meadow.tap({ x: -20.4, z: laneZ(1) });
  // All three are planned, each starting where the one before will end.
  assert.deepEqual(
    meadow.nav.plannedRows.map((row) => [row.axis, row.lane, row.from, row.to]),
    [
      ["x", 3, 46, 9],
      ["x", 2, 9, 54],
      ["x", 1, 54, 9],
    ],
  );
  meadow.settle();
  const soil = meadow.count(Ground.soil, [1, 2, 3]);
  assert.equal(soil.outside, 0);
  assert.equal(soil.inside, (38 + 46 + 46) * 5);
  // A second tap on a waiting lane replaces what was asked of it.
  const again = farm({ x: 22, z: laneZ(8), heading: west, speed: 0 });
  again.tap({ x: -20, z: laneZ(8) });
  again.tap({ x: 19, z: laneZ(7) });
  again.tap({ x: 0.2, z: laneZ(7) });
  assert.equal(again.nav.plannedRows.length, 2);
  again.settle();
  assert.equal(again.count(Ground.soil, [7]).inside, 41 * 5);
});

it("leaves its rows and travels with the implement up when a tap lands beyond the field", () => {
  const meadow = farm({ x: 22, z: laneZ(8), heading: west, speed: 0 });
  meadow.tap({ x: -20, z: laneZ(8) });
  meadow.tap({ x: 19, z: laneZ(7) });
  meadow.run(5);
  const worked = meadow.count(Ground.soil).all;
  meadow.tap({ x: 0, z: 20 });
  assert.equal(meadow.nav.run, null);
  assert.equal(meadow.nav.hasQueued, false);
  meadow.settle();
  assert.equal(meadow.count(Ground.soil).all, worked);
});

it("moves the end of the row being worked when its own lane is tapped again", () => {
  const meadow = farm({ x: 22, z: laneZ(5), heading: west, speed: 0 });
  meadow.tap({ x: -20, z: laneZ(5) });
  meadow.run(5);
  // Shorter: stop at column 40.
  meadow.tap({ x: FIELD.minX + 40.5 * FIELD.cell, z: laneZ(5) + 0.9 });
  assert.equal(meadow.nav.hasQueued, false);
  meadow.settle();
  assert.equal(meadow.count(Ground.soil, [5]).all, 50 * 5);
  // A tap behind the work already done ends the row where it is.
  const again = farm({ x: 22, z: laneZ(5), heading: west, speed: 0 });
  again.tap({ x: -20, z: laneZ(5) });
  again.run(8);
  const worked = again.count(Ground.soil).all;
  again.tap({ x: 15, z: laneZ(5) });
  again.settle();
  assert.ok(again.count(Ground.soil).all - worked <= 2 * LANE_CELLS);
});

it("keeps a neighbouring sown row whole when the next lane is cultivated", () => {
  const meadow = farm({ x: 22, z: laneZ(8), heading: west, speed: 0 });
  meadow.tap({ x: -24.5, z: laneZ(8) });
  meadow.settle();
  meadow.tool("sow");
  meadow.tap({ x: 19.5, z: laneZ(8) });
  meadow.settle();
  assert.equal(meadow.count(Ground.growing, [8]).all, 90 * 5);
  meadow.tool("cultivate");
  meadow.tap({ x: -24.5, z: laneZ(7) });
  meadow.settle();
  assert.deepEqual(meadow.count(Ground.growing, [8]), {
    inside: 90 * 5,
    outside: 0,
    all: 90 * 5,
  });
  assert.equal(meadow.count(Ground.soil, [7]).inside, 90 * 5);
});

it("covers the whole field from one careless tap per row", () => {
  // Both movement models: the overhead view's, and the gentler one that
  // follows behind the tractor in the native app.
  for (const follow of [false, true])
    for (const error of [0.3, 0.6]) {
      const random = seededRandom(error * 100);
      const wobble = () => (random() - 0.5) * 2 * error;
      const meadow = farm(
        { x: 22, z: laneZ(9), heading: west, speed: 0 },
        true,
        60,
        [],
        follow,
      );
      for (let lane = 9; lane >= 0; lane--) {
        const x = lane % 2 ? FIELD.minX + 0.6 : FIELD.maxX - 0.6;
        meadow.tap({ x: x + wobble(), z: laneZ(lane) + wobble() });
        meadow.settle();
      }
      assert.equal(
        meadow.count(Ground.soil).all,
        meadow.engine.cells.length,
        `tap error ${error} m, follow ${follow}`,
      );
    }
});

it("reads a tap on the edge of a finished lane as the next row over", () => {
  const meadow = farm({ x: 22, z: laneZ(9), heading: west, speed: 0 });
  meadow.tap({ x: -24, z: laneZ(9) });
  meadow.settle();
  // Half a metre inside the lane just worked, where nothing is left to do.
  meadow.tap({ x: 19.5, z: laneZ(9) - LANE_WIDTH / 2 + 0.5 });
  meadow.settle();
  assert.equal(meadow.count(Ground.soil, [8]).inside, 90 * 5);
});

it("fills every lane up to a second tap, back and forth, skipping lanes with nothing to do", () => {
  const meadow = farm({ x: 22, z: laneZ(9), heading: west, speed: 0 });
  meadow.tap({ x: -10, z: laneZ(9) });
  meadow.settle();
  meadow.tap({ x: 19.8, z: laneZ(4) }, true);
  // The finished lane is passed over; five more are planned.
  assert.deepEqual(
    meadow.nav.plannedRows.map((row) => row.lane),
    [8, 7, 6, 5, 4],
  );
  meadow.settle();
  assert.deepEqual(meadow.count(Ground.soil, [4, 5, 6, 7, 8, 9]), {
    inside: 6 * 60 * 5,
    outside: 0,
    all: 6 * 60 * 5,
  });
});

it("plans rows the way the tractor faces unless the tap is well off to one side", () => {
  const facingWest: TractorState = { x: 0, z: 0, heading: west, speed: 0 };
  assert.equal(planRows(facingWest, { x: -15, z: 0.4 })[0].axis, "x");
  assert.equal(
    planRows(facingWest, { x: -1, z: 2.6 })[0].axis,
    "x",
    "the lane beside it",
  );
  assert.equal(planRows(facingWest, { x: -12, z: 8 })[0].axis, "x");
  assert.equal(
    planRows(facingWest, { x: 1, z: 10 })[0].axis,
    "z",
    "straight off to the side",
  );
  const diagonal: TractorState = { x: 0, z: 0, heading: 0.8, speed: 0 };
  assert.equal(planRows(diagonal, { x: 9, z: 4 })[0].axis, "x");
  assert.equal(planRows(diagonal, { x: 4, z: 9 })[0].axis, "z");
  // Ends settle onto the field's edge and onto the last row's ends.
  const last = {
    axis: "x" as const,
    lane: 5,
    from: 80,
    to: 20,
    dir: -1 as const,
  };
  const row = planRows(
    { x: -14.9 - 2.1, z: 1.25, heading: west, speed: 0 },
    { x: 14.2, z: -1 },
    { last },
  )[0];
  assert.deepEqual([row.from, row.to, row.dir], [20, 80, 1]);
  assert.equal(planRows(facingWest, { x: FIELD.minX + 1.2, z: 0 })[0].to, 0);
  assert.equal(rowCells(row).length, 61 * LANE_CELLS);
});

it("travels with the implement up to a tap beyond the field, and steers freehand on a drag", () => {
  const meadow = farm({ x: 0, z: 0, heading: west, speed: 0 });
  meadow.tap({ x: -32, z: 20 });
  meadow.settle();
  assert.equal(meadow.count(Ground.soil).all, 0);
  assert.ok(Math.hypot(meadow.state.x + 32, meadow.state.z - 20) < 0.6);
  // A drag keeps the original brush: it works wherever the implement passes.
  const drawn = farm({ x: 0, z: 0, heading: west, speed: 0 });
  drawn.drag({ x: -9, z: 6 });
  drawn.settle();
  const soil = drawn.count(Ground.soil, [4]);
  assert.ok(soil.all > 40 && soil.outside > 0, JSON.stringify(soil));
  assert.equal(drawn.nav.run, null);
});

it("bends a row around something standing in its lane and leaves the ground under it alone", () => {
  // The meadow's little mill, standing across two lanes.
  const mill: Obstacle = { x: 10, z: -5, radius: 1.6 };
  for (const follow of [false, true])
    for (const lane of [2, 3]) {
      const meadow = farm(
        { x: 22, z: laneZ(lane), heading: west, speed: 0 },
        true,
        60,
        [mill],
        follow,
      );
      meadow.tap({ x: -24, z: laneZ(lane) });
      meadow.settle();
      const soil = meadow.count(Ground.soil, [lane]);
      assert.equal(soil.outside, 0, "the detour works nothing outside the row");
      assert.ok(
        soil.inside >= 90 * 5 - 30,
        `lane ${lane}: ${soil.inside} of 450 cells`,
      );
      meadow.engine.cells.forEach((cell, i) => {
        const x = FIELD.minX + ((i % FIELD_COLUMNS) + 0.5) * FIELD.cell,
          z = FIELD.minZ + (Math.floor(i / FIELD_COLUMNS) + 0.5) * FIELD.cell;
        if (Math.hypot(x - mill.x, z - mill.z) < 1.3)
          assert.equal(cell, Ground.grass);
      });
    }
});

it("settles keyboard rows onto the same lanes", () => {
  const meadow = farm({ x: 22, z: laneZ(6) + 0.9, heading: west, speed: 0 });
  for (let i = 0; i < 60 * 17; i++)
    meadow.step({ grid: { heading: west, driving: true } });
  assert.ok(
    Math.abs(meadow.state.z - laneZ(6)) < 0.02,
    "the tractor eases onto the lane's centre",
  );
  assert.deepEqual(meadow.count(Ground.soil, [6]), {
    inside: 90 * 5,
    outside: 0,
    all: 90 * 5,
  });
  // A rough step sideways still lands in the next lane.
  for (let i = 0; i < 60 * 1.1; i++)
    meadow.step({ grid: { heading: Math.PI, driving: true } });
  for (let i = 0; i < 60 * 17; i++)
    meadow.step({ grid: { heading: east, driving: true } });
  assert.equal(meadow.count(Ground.soil, [5]).inside, 90 * 5);
  assert.ok(Math.abs(attachmentPoint(meadow.state).z - laneZ(5)) < 0.02);
});

it("leaves the original free approach unchanged when tidy rows are off", () => {
  const meadow = farm({ x: -4, z: 4.8, heading: west, speed: 0 }, false);
  meadow.tap({ x: -20, z: -3.25 });
  assert.equal(meadow.nav.run, null);
  assert.ok(meadow.nav.work);
  meadow.settle();
  assert.ok(
    meadow.count(Ground.soil, [3]).outside > 100,
    "the straight-line approach works the ground it crosses",
  );
});
