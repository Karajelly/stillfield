import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CELL_COUNT,
  CROPS,
  FARMING_CONFIG,
  FarmingEngine,
  Ground,
  validFarm,
  migrateFarm,
} from "./farming";
import type { Crop } from "./farming";
import { FIELD, FIELD_COLUMNS, FIELD_ROWS } from "./simulation";
import type { Tool } from "./simulation";

const fresh = () => new FarmingEngine(undefined, FARMING_CONFIG, false);
const plant = (f: FarmingEngine, cells: number[], crop: Crop = "wheat") => {
  f.applyCells(cells, "cultivate");
  f.applyCells(cells, "sow", crop);
};
describe("tranquil farming loop", () => {
  it("starts with a harvest-ready plot of every crop without reseeding saved farms", () => {
    const f = new FarmingEngine();
    assert.ok(validFarm(f.snapshot()));
    assert.equal(f.isGrowing, false);
    for (const crop of CROPS) {
      const cells = Array.from(f.cells.keys()).filter((i) => f.cropAt(i) === crop);
      assert.ok(cells.length > 0, `${crop} has a starter plot`);
      assert.ok(cells.every((i) => f.cells[i] === Ground.mature && f.progress[i] === 1));
      const result = f.applyCells(cells, "harvest");
      assert.equal(result.harvestResults[0].crop, crop);
      assert.deepEqual(result.harvestResults[0].cells, cells);
      assert.ok(f.display[crop] > 0);
    }
    const harvested = f.snapshot();
    assert.deepEqual(new FarmingEngine(harvested).snapshot(), harvested);
    f.reset();
    const empty = f.snapshot();
    assert.deepEqual(new FarmingEngine(empty).snapshot(), empty);
  });
  it("completes wheat first, then repeats the same loop with every crop", () => {
    const f = fresh();
    for (const crop of CROPS) {
      plant(f, [0, 1], crop);
      assert.equal(f.stage(0), 0);
      const duration = FARMING_CONFIG.growthSeconds[crop];
      f.advance(duration / 3);
      assert.equal(f.stage(0), 1);
      f.advance(duration / 3);
      assert.equal(f.stage(0), 2);
      assert.equal(f.applyCells([0], "harvest").harvestResults.length, 0);
      const maturity = f.advance(duration / 3);
      assert.deepEqual(maturity.cropMaturities, [0, 1]);
      assert.equal(f.stage(0), 3);
      const result = f.applyCells([0, 0, 1], "harvest");
      assert.equal(result.harvestResults[0].crop, crop);
      assert.equal(result.harvestResults[0].cells.length, 2);
      assert.equal(f.cells[0], Ground.stubble);
      assert.equal(f.display[crop], 8);
      assert.equal(f.applyCells([0, 1], "harvest").harvestResults.length, 0);
    }
  });
  it("allows only valid operations at every ground state", () => {
    const valid: Record<number, Tool[]> = {
      0: ["cultivate", "mow"],
      1: ["cultivate", "restore"],
      2: ["sow", "restore"],
      3: ["cultivate", "restore"],
      4: ["cultivate", "harvest", "restore"],
      5: ["cultivate", "restore"],
    };
    for (let state = 0; state <= 5; state++) {
      for (const tool of [
        "cultivate",
        "sow",
        "harvest",
        "mow",
        "restore",
        "wander",
      ] as Tool[]) {
        const f = fresh();
        f.cells[0] = state;
        if (state === 3 || state === 4) {
          f.crops[0] = 1;
          f.progress[0] = state === 4 ? 1 : 0.45;
        }
        const before = f.snapshot();
        const result = f.applyCells([0, 0], tool, "pumpkins");
        assert.equal(
          result.groundChanges.length,
          valid[state].includes(tool) ? 1 : 0,
          `${state}, ${tool}`,
        );
        if (!valid[state].includes(tool))
          assert.deepEqual(f.snapshot(), before);
        assert.ok(validFarm(f.snapshot()));
      }
    }
  });
  it("cultivates through growing and leftover mature crops without harvest rewards", () => {
    for (const crop of CROPS) {
      const f = fresh();
      const from = { x: -10, z: 0 },
        to = { x: 10, z: 0 };
      const cells = f.apply(from, to, "cultivate").groundChanges;
      const [mature, growing, harvested] = cells;
      f.applyCells([mature, harvested], "sow", crop);
      f.advance(FARMING_CONFIG.growthSeconds[crop]);
      f.applyCells([harvested], "harvest");
      f.applyCells([growing], "sow", crop);
      f.advance(FARMING_CONFIG.growthSeconds[crop] / 2);
      const display = { ...f.display };

      const result = f.apply(to, from, "cultivate");
      assert.deepEqual(
        new Set(result.groundChanges),
        new Set([mature, growing, harvested]),
      );
      assert.deepEqual(result.harvestResults, []);
      assert.deepEqual(f.display, display);
      assert.ok(
        cells.every(
          (i) =>
            f.cells[i] === Ground.soil &&
            f.crops[i] === 0 &&
            f.progress[i] === 0,
        ),
      );
      assert.equal(f.apply(from, to, "cultivate").groundChanges.length, 0);
      assert.equal(f.rest().advancedSeconds, 0);
      assert.deepEqual(f.advance(100000).cropMaturities, []);
      assert.ok(validFarm(f.snapshot()));

      f.applyCells([mature, growing], "sow", crop);
      assert.ok(
        [mature, growing].every(
          (i) =>
            f.cells[i] === Ground.growing &&
            f.cropAt(i) === crop &&
            f.progress[i] === 0,
        ),
      );
    }
  });
  it("advances mixed crops equally when resting and ignores mature crops", () => {
    const f = fresh();
    CROPS.forEach((crop, i) => plant(f, [i], crop));
    assert.equal(f.rest().advancedSeconds, 180);
    assert.equal(f.progress[0], 0.5);
    assert.equal(f.progress[1], 1);
    assert.equal(f.progress[2], 1 / 3);
    assert.equal(f.rest().advancedSeconds, 180);
    assert.equal(f.cells[0], Ground.mature);
    assert.ok(Math.abs(f.rest().advancedSeconds - 180) < 1e-8);
    const done = f.snapshot();
    assert.equal(f.rest().advancedSeconds, 0);
    f.advance(100000);
    assert.deepEqual(f.snapshot(), done);
  });
  it("does not simulate inactive, invalid or offline time", () => {
    const f = fresh();
    plant(f, [0]);
    f.advance(51.125);
    const save = f.snapshot();
    for (const seconds of [0, -10, NaN, Infinity]) f.advance(seconds);
    f.advance(9000, false);
    assert.deepEqual(f.snapshot(), save);
    const loaded = new FarmingEngine(JSON.parse(JSON.stringify(save)));
    assert.deepEqual(loaded.snapshot(), save);
    loaded.advance(308.875);
    assert.equal(loaded.cells[0], Ground.mature);
  });
  it("gives an immediate display reward, all three stages, and unlimited harvesting", () => {
    const f = fresh();
    for (const [count, stage] of [
      [1, 1],
      [15, 2],
      [48, 3],
      [20, 3],
    ]) {
      const cells = Array.from({ length: count }, (_, i) => i);
      plant(f, cells);
      f.rest();
      const result = f.applyCells(cells, "harvest");
      assert.equal(result.harvestResults[0].cells.length, count);
      assert.equal(f.displayStage("wheat"), stage);
      assert.ok(cells.every((i) => f.cells[i] === Ground.stubble));
    }
    f.clearDisplay();
    assert.equal(f.displayStage("wheat"), 0);
    plant(f, [0]);
    f.rest();
    f.applyCells([0], "harvest");
    assert.equal(f.displayStage("wheat"), 1);
  });
  it("keeps an uncapped lifetime tally beside the saturating display", () => {
    const f = fresh();
    const cap = FARMING_CONFIG.displayThresholds[2];
    const cells = Array.from({ length: 150 }, (_, i) => i);
    let total = 0;
    for (const crop of ["wheat", "wheat", "pumpkins"] as const) {
      plant(f, cells, crop);
      f.rest();
      const [result] = f.applyCells(cells, "harvest").harvestResults;
      if (crop === "wheat") total += cells.length;
      assert.equal(result.gathered, f.gathered[crop]);
    }
    // 300 wheat cells is well past the 64 the display can show.
    assert.equal(f.display.wheat, cap);
    assert.deepEqual(f.gathered, { wheat: total, sunflowers: 0, pumpkins: 150 });
    // Passes that gather nothing leave the tally alone.
    f.applyCells(cells, "harvest");
    f.applyCells(cells, "cultivate");
    assert.equal(f.gathered.wheat, 300);

    const save = f.snapshot();
    assert.ok(validFarm(save));
    const loaded = new FarmingEngine(JSON.parse(JSON.stringify(save)));
    assert.deepEqual(loaded.gathered, f.gathered);
    assert.deepEqual(loaded.snapshot(), save);

    // Clearing the display keeps the tally; a fresh meadow clears both.
    f.clearDisplay();
    assert.equal(f.gathered.wheat, 300);
    f.reset();
    assert.deepEqual(f.gathered, { wheat: 0, sunflowers: 0, pumpkins: 0 });
    assert.deepEqual(f.snapshot().gathered, f.gathered);
  });
  it("loads saves from before the tally and rejects a malformed one", () => {
    const f = fresh();
    const cells = Array.from({ length: 20 }, (_, i) => i);
    plant(f, cells, "sunflowers");
    f.rest();
    f.applyCells(cells, "harvest");
    const { gathered, ...older } = f.snapshot();
    assert.deepEqual(gathered, { wheat: 0, sunflowers: 20, pumpkins: 0 });
    assert.ok(validFarm(older));
    // The display is all an older save remembers, up to its cap.
    assert.deepEqual(new FarmingEngine(older).gathered, gathered);
    const full = { ...older, display: { wheat: 256, sunflowers: 6, pumpkins: 0 } };
    assert.deepEqual(new FarmingEngine(full).gathered, {
      wheat: 64,
      sunflowers: 1,
      pumpkins: 0,
    });
    for (const bad of [
      null,
      {},
      { wheat: 1, sunflowers: 1 },
      { wheat: -1, sunflowers: 0, pumpkins: 0 },
      { wheat: 1.5, sunflowers: 0, pumpkins: 0 },
      { wheat: "3", sunflowers: 0, pumpkins: 0 },
    ]) {
      const save: unknown = { ...older, gathered: bad };
      assert.equal(validFarm(save), false);
      assert.equal(migrateFarm(save), undefined);
    }
  });
  it("sweeps continuously with configurable, forgiving edges and clips outside the field", () => {
    const f = fresh(),
      from = { x: -10, z: 0 },
      to = { x: 10, z: 0 };
    const result = f.apply(from, to, "cultivate");
    assert.ok(
      result.groundChanges.length > 200 && result.groundChanges.length < 300,
    );
    f.apply(from, to, "sow");
    f.advance(23);
    const before = f.snapshot();
    f.apply(to, from, "sow", "pumpkins");
    assert.deepEqual(f.snapshot(), before);
    assert.equal(
      f.apply({ x: 100, z: 100 }, { x: 110, z: 110 }, "restore").groundChanges
        .length,
      0,
    );
    assert.equal(
      f.apply(from, to, "restore", "wheat", -1).groundChanges.length,
      0,
    );
    const tight = new FarmingEngine(
      undefined,
      { ...FARMING_CONFIG, edgeCoverage: 0 },
      false,
    );
    assert.ok(
      tight.apply(from, to, "cultivate").groundChanges.length <
        result.groundChanges.length,
    );
  });
  it("covers adjacent passes on the half-metre grid, including diagonal and off-grid paths", () => {
    assert.equal(FIELD_COLUMNS, 90);
    assert.equal(FIELD_ROWS, 50);
    assert.equal(FIELD.cell, 0.5);
    assert.equal(FARMING_CONFIG.implementRadius, 1.25);
    for (const angle of [0, 0.2, Math.PI / 4, Math.PI / 2]) {
      const f = fresh(),
        dx = Math.sin(angle),
        dz = Math.cos(angle);
      for (const offset of [-5, -2.5, 0, 2.5, 5]) {
        const from = {
          x: -2.13 + dz * offset - dx * 9,
          z: 0.17 - dx * offset - dz * 9,
        };
        const to = { x: from.x + dx * 18, z: from.z + dz * 18 };
        f.apply(from, to, "cultivate");
        f.apply(from, to, "sow", "sunflowers");
      }
      let checked = 0;
      for (let i = 0; i < CELL_COUNT; i++) {
        const x = FIELD.minX + ((i % FIELD_COLUMNS) + 0.5) * FIELD.cell + 2.13;
        const z =
          FIELD.minZ +
          (Math.floor(i / FIELD_COLUMNS) + 0.5) * FIELD.cell -
          0.17;
        if (Math.abs(x * dx + z * dz) > 8 || Math.abs(x * dz - z * dx) > 6)
          continue;
        assert.equal(
          f.cells[i],
          Ground.growing,
          `gap at cell ${i}, angle ${angle}`,
        );
        assert.equal(f.cropAt(i), "sunflowers");
        checked++;
      }
      assert.ok(checked > 700);
    }
  });
  it("round trips mixed states, all displays and mowing exactly; rejects malformed saves", () => {
    const f = fresh();
    f.applyCells([5], "mow");
    CROPS.forEach((crop, i) => {
      plant(f, [i, i + 10], crop);
    });
    f.rest();
    f.applyCells([1], "harvest");
    f.advance(4.123);
    const save = f.snapshot();
    assert.ok(validFarm(save));
    assert.deepEqual(
      new FarmingEngine(JSON.parse(JSON.stringify(save))).snapshot(),
      save,
    );
    for (const broken of [
      { ...save, progress: [] },
      { ...save, crops: [] },
      { ...save, display: null },
      { ...save, version: 42 },
      { ...save, cells: Array(CELL_COUNT).fill(7) },
    ])
      assert.equal(validFarm(broken), false);
  });
  it("migrates legacy paths, soil, and flowers to the larger cells", () => {
    const legacy = Array(172 * 108).fill(0);
    legacy[0] = 1;
    legacy[2] = 2;
    legacy[4] = 3;
    const f = new FarmingEngine(legacy);
    assert.equal(f.cells[0], Ground.mown);
    assert.equal(f.cells[1], Ground.soil);
    assert.equal(f.cropAt(2), "sunflowers");
    assert.equal(f.stage(2), 3);
    assert.ok(validFarm(f.snapshot()));
  });
  it("fits the whole old field, merges mixed crops deterministically, and preserves displays", () => {
    const old = {
      ...fresh().snapshot(),
      version: 2 as const,
      cells: Array(172 * 108).fill(0),
      crops: Array(172 * 108).fill(0),
      progress: Array(172 * 108).fill(0),
      display: { wheat: 63, sunflowers: 64, pumpkins: 256 },
    };
    for (const [i, crop, progress] of [
      [0, 1, 0.2],
      [1, 2, 0.8],
      [172, 2, 0.4],
      [2, 1, 1],
      [3, 2, 1],
      [18575, 3, 1],
    ]) {
      old.cells[i] = progress === 1 ? Ground.mature : Ground.growing;
      old.crops[i] = crop;
      old.progress[i] = progress;
    }
    old.cells[4] = Ground.soil;
    old.cells[5] = Ground.stubble;
    old.cells[6] = Ground.mown;
    old.cells[8] = Ground.stubble;
    const before = structuredClone(old);
    const f = new FarmingEngine(old);
    assert.equal(CELL_COUNT, 4500);
    assert.equal(f.cropAt(0), "sunflowers");
    assert.equal(f.progress[0], 0.8);
    assert.equal(f.cropAt(1), "wheat");
    assert.equal(f.stage(1), 3);
    assert.equal(f.cells[2], Ground.soil);
    assert.equal(f.cells[3], Ground.mown);
    assert.equal(f.cells[4], Ground.stubble);
    assert.equal(f.cropAt(4499), "pumpkins");
    assert.equal(f.stage(4499), 3);
    assert.deepEqual(f.display, old.display);
    assert.deepEqual(
      CROPS.map((c) => f.displayStage(c)),
      [1, 2, 3],
    );
    assert.deepEqual(old, before);
    const saved = f.snapshot();
    assert.equal(saved.version, 3);
    assert.deepEqual(
      new FarmingEngine(JSON.parse(JSON.stringify(saved))).snapshot(),
      saved,
    );
    assert.equal(migrateFarm({ ...old, progress: [] }), undefined);
    assert.equal(
      migrateFarm({ ...old, progress: old.progress.map(() => 2) }),
      undefined,
    );
    assert.equal(migrateFarm({ ...saved, version: 2 }), undefined);
    assert.equal(migrateFarm({ ...old, version: 3 }), undefined);
  });
});
