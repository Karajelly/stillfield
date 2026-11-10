import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FARMING_CONFIG, FarmingEngine } from "./farming";
import type { Crop } from "./farming";
import { FIELD, FIELD_COLUMNS } from "./simulation";
import {
  GUST_SECONDS,
  WIND,
  WIND_BANDS,
  WIND_STEPS,
  Wind,
  sliceNotes,
  windFrequency,
} from "./wind";

const fresh = () => new FarmingEngine(undefined, FARMING_CONFIG, false);
/** Every cell of one pitch lane, across the given beats. */
const lane = (band: number, firstStep = 0, lastStep = WIND_STEPS - 1) => {
  const cells: number[] = [];
  for (let row = band * WIND.bandRows; row < (band + 1) * WIND.bandRows; row++)
    for (
      let col = firstStep * WIND.stepColumns;
      col < (lastStep + 1) * WIND.stepColumns;
      col++
    )
      cells.push(row * FIELD_COLUMNS + col);
  return cells;
};
const grow = (f: FarmingEngine, cells: number[], crop: Crop, seconds = 9999) => {
  f.applyCells(cells, "cultivate");
  f.applyCells(cells, "sow", crop);
  f.advance(seconds);
};

describe("the wind playing the field", () => {
  it("is silent over grass, mown paths, and bare soil", () => {
    const f = fresh();
    f.applyCells(lane(2), "cultivate");
    f.applyCells(lane(4), "mow");
    for (let step = 0; step < WIND_STEPS; step++)
      assert.deepEqual(sliceNotes(f, step), []);
  });

  it("sounds one lane as one pitch for as long as the row runs", () => {
    const f = fresh();
    grow(f, lane(3, 10, 19), "wheat");
    for (let step = 0; step < WIND_STEPS; step++) {
      const notes = sliceNotes(f, step);
      if (step < 10 || step > 19) assert.deepEqual(notes, []);
      else assert.deepEqual(notes, [{ voice: "wheat", band: 3, level: 1 }]);
    }
  });

  it("keeps seeds silent and lets the song grow with the crop", () => {
    const f = fresh();
    const cells = lane(0);
    f.applyCells(cells, "cultivate");
    f.applyCells(cells, "sow", "sunflowers");
    assert.deepEqual(sliceNotes(f, 4), []);
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      f.advance(FARMING_CONFIG.growthSeconds.sunflowers / 3.9);
      levels.push(sliceNotes(f, 4)[0]?.level ?? 0);
    }
    assert.ok(levels[levels.length - 1] === 1);
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1]);
    assert.ok(levels[0] < 1);
  });

  it("gives each crop its own voice and pumpkins a slower pulse", () => {
    const f = fresh();
    grow(f, lane(1), "wheat");
    grow(f, lane(5), "sunflowers");
    grow(f, lane(8), "pumpkins");
    assert.deepEqual(
      sliceNotes(f, 6).map((note) => `${note.voice}:${note.band}`),
      ["wheat:1", "sunflowers:5", "pumpkins:8"],
    );
    assert.deepEqual(
      sliceNotes(f, 7).map((note) => `${note.voice}:${note.band}`),
      ["wheat:1", "sunflowers:5"],
    );
  });

  it("rolls through a full field instead of sounding every lane at once", () => {
    const f = fresh();
    for (let band = 0; band < WIND_BANDS; band++) grow(f, lane(band), "wheat");
    const heard = new Set<number>();
    for (let step = 0; step < WIND_STEPS; step++) {
      const notes = sliceNotes(f, step);
      assert.equal(notes.length, 2);
      assert.notEqual(notes[0].band, notes[1].band);
      notes.forEach((note) => heard.add(note.band));
    }
    assert.equal(heard.size, WIND_BANDS);
  });

  it("brushes stubble on the off-beat after a harvest", () => {
    const f = fresh();
    for (let band = 0; band < 3; band++) grow(f, lane(band), "wheat");
    for (let band = 0; band < 3; band++) f.applyCells(lane(band), "harvest");
    assert.deepEqual(sliceNotes(f, 4), []);
    const [brush] = sliceNotes(f, 5);
    assert.equal(brush.voice, "stubble");
    assert.ok(Math.abs(brush.level - 0.3) < 1e-9);
  });

  it("ignores beats outside the field and never changes the farm", () => {
    const f = fresh();
    grow(f, lane(2), "pumpkins", 60);
    const before = f.snapshot();
    for (const step of [-1, 0.5, WIND_STEPS, Number.NaN])
      assert.deepEqual(sliceNotes(f, step), []);
    for (let step = 0; step < WIND_STEPS; step++) sliceNotes(f, step);
    assert.deepEqual(f.snapshot(), before);
  });

  it("tunes the far side of the field highest, on a pentatonic scale", () => {
    for (const crop of ["wheat", "sunflowers", "pumpkins"] as const) {
      for (let band = 1; band < WIND_BANDS; band++)
        assert.ok(windFrequency(crop, band) < windFrequency(crop, band - 1));
      assert.ok(windFrequency(crop, -4) === windFrequency(crop, 0));
    }
    assert.ok(Math.abs(windFrequency("wheat", WIND_BANDS - 1) - 293.66) < 1e-9);
    assert.ok(windFrequency("pumpkins", 0) < windFrequency("wheat", 0));
    assert.ok(windFrequency("wheat", 0) < windFrequency("sunflowers", 0));
    // A minor third above the root after dark, a major second by day.
    const root = windFrequency("wheat", WIND_BANDS - 1, true);
    assert.ok(
      Math.abs(windFrequency("wheat", WIND_BANDS - 2, true) / root - 2 ** (3 / 12)) < 1e-9,
    );
    assert.ok(
      Math.abs(windFrequency("wheat", WIND_BANDS - 2) / root - 2 ** (2 / 12)) < 1e-9,
    );
  });

  it("crosses the field once, sounding every beat in order, then rests", () => {
    const wind = new Wind(() => 0);
    assert.deepEqual(wind.advance(WIND.firstRest - 1), {
      front: null,
      steps: [],
      strength: 0,
    });
    const steps: number[] = [];
    let last = FIELD.minX - 1,
      frames = 0;
    for (let frame = wind.advance(1); ; frame = wind.advance(1 / 30)) {
      steps.push(...frame.steps);
      if (frame.front === null) break;
      assert.ok(frame.front >= last);
      assert.ok(frame.strength >= 0 && frame.strength <= 1);
      last = frame.front;
      assert.ok(++frames < 2000);
    }
    assert.deepEqual(steps, Array.from({ length: WIND_STEPS }, (_, i) => i));
    assert.ok(last >= FIELD.maxX);
    assert.equal(wind.gusting, false);
    assert.equal(wind.advance(WIND.minRest - 1).front, null);
    assert.equal(wind.advance(1).front, FIELD.minX);
  });

  it("keeps time at any frame rate and waits while the game is paused", () => {
    for (const rate of [15, 60, 120]) {
      const wind = new Wind(() => 0.5);
      wind.gust();
      const steps: number[] = [];
      for (let i = 0; i < GUST_SECONDS * rate - 1; i++)
        steps.push(...wind.advance(1 / rate).steps);
      assert.deepEqual(steps, Array.from({ length: WIND_STEPS }, (_, i) => i));
    }
    const resting = new Wind();
    for (let i = 0; i < 1000; i++)
      assert.equal(resting.advance(0).front, null);
    assert.equal(resting.advance(Number.NaN).front, null);
  });
});
