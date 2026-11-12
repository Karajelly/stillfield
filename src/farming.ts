import {
  FIELD,
  FIELD_COLUMNS,
  FIELD_ROWS,
  cellsUnderBrush,
  cellsUnderSweep,
  fieldColumns,
  fieldRows,
} from "./simulation";
import type { FieldBounds, Point, Tool } from "./simulation";
import { tuning } from "./handling";

export const CROPS = ["wheat", "sunflowers", "pumpkins"] as const;
export type Crop = (typeof CROPS)[number];
export const CROP_NAMES: Record<Crop, string> = {
  wheat: "Wheat",
  sunflowers: "Sunflowers",
  pumpkins: "Pumpkins",
};
// Mown is grass with a permanent appearance change, not a prerequisite for soil.
export const Ground = {
  grass: 0,
  mown: 1,
  soil: 2,
  growing: 3,
  mature: 4,
  stubble: 5,
} as const;
export const CELL_COUNT = FIELD_COLUMNS * FIELD_ROWS;
// Display units retain the original 25 cm cell area, so saves and pacing survive.
export const HARVEST_UNITS_PER_CELL = FIELD.cell ** 2 / 0.0625;
const LEGACY_COLUMNS = 172,
  LEGACY_ROWS = 108;
const LEGACY_CELL_COUNT = LEGACY_COLUMNS * LEGACY_ROWS;
export interface FarmingConfig {
  growthSeconds: Record<Crop, number>;
  implementRadius: number;
  edgeCoverage: number;
  displayThresholds: [number, number, number];
}
export const FARMING_CONFIG: FarmingConfig = {
  growthSeconds: { wheat: 360, sunflowers: 180, pumpkins: 540 },
  implementRadius: tuning.brushRadius,
  edgeCoverage: FIELD.cell / 2,
  displayThresholds: [1, 64, 256],
};
export interface FarmSnapshot {
  version: 2 | 3;
  fieldId: string;
  displayLocation: Point;
  cells: number[];
  crops: number[];
  progress: number[];
  display: Record<Crop, number>;
}
export interface HarvestResult {
  fieldId: string;
  crop: Crop;
  cells: number[];
  stage: number;
}
/** Batched events keep rendering/audio outside the engine, including during rest. */
export interface FarmingEvents {
  groundChanges: number[];
  cropStages: number[];
  cropMaturities: number[];
  harvestResults: HarvestResult[];
  advancedSeconds: number;
}
const events = (): FarmingEvents => ({
  groundChanges: [],
  cropStages: [],
  cropMaturities: [],
  harvestResults: [],
  advancedSeconds: 0,
});
const emptyDisplay = (): Record<Crop, number> => ({
  wheat: 0,
  sunflowers: 0,
  pumpkins: 0,
});

export const cellCount = (bounds: FieldBounds) => fieldColumns(bounds) * fieldRows(bounds);
export function validFarm(value: unknown, bounds: FieldBounds = FIELD): value is FarmSnapshot {
  return validSnapshot(value, 3, cellCount(bounds));
}
/** Identity and harvest display placement for each field. */
export interface FieldSite {
  id: string;
  bounds: FieldBounds;
  displayLocation: Point;
  /** Only the original field has starter plots and legacy saves. */
  original: boolean;
}
export const HOME_SITE: FieldSite = {
  id: "willowbrook",
  bounds: FIELD,
  displayLocation: { x: -16, z: -15.5 },
  original: true,
};

function validSnapshot(
  value: unknown,
  version: number,
  count: number,
): value is FarmSnapshot {
  const s = value as FarmSnapshot | undefined;
  if (
    !s ||
    s.version !== version ||
    typeof s.fieldId !== "string" ||
    !s.fieldId ||
    !s.displayLocation ||
    !Number.isFinite(s.displayLocation.x) ||
    !Number.isFinite(s.displayLocation.z) ||
    ![s.cells, s.crops, s.progress].every(
      (a) => Array.isArray(a) && a.length === count,
    ) ||
    !s.display ||
    !CROPS.every((c) => Number.isSafeInteger(s.display[c]) && s.display[c] >= 0)
  )
    return false;
  return s.cells.every((state, i) => {
    const crop = s.crops[i],
      progress = s.progress[i];
    if (
      !Number.isInteger(state) ||
      state < 0 ||
      state > 5 ||
      !Number.isFinite(progress)
    )
      return false;
    if (state === Ground.growing || state === Ground.mature)
      return (
        Number.isInteger(crop) &&
        crop >= 1 &&
        crop <= 3 &&
        (state === Ground.mature
          ? progress === 1
          : progress >= 0 && progress < 1)
      );
    return crop === 0 && progress === 0;
  });
}

export function migrateFarm(value: unknown): FarmSnapshot | undefined {
  if (validFarm(value)) return value;
  let source: FarmSnapshot;
  if (validSnapshot(value, 2, LEGACY_CELL_COUNT)) source = value;
  else if (
    Array.isArray(value) &&
    value.length === LEGACY_CELL_COUNT &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n <= 3)
  ) {
    source = {
      version: 2,
      fieldId: "willowbrook",
      displayLocation: { x: -16, z: -15.5 },
      cells: value.map((n) => (n === 3 ? Ground.mature : n)),
      crops: value.map((n) => (n === 3 ? 2 : 0)),
      progress: value.map((n) => (n === 3 ? 1 : 0)),
      display: emptyDisplay(),
    };
  } else return undefined;

  const result: FarmSnapshot = {
    version: 3,
    fieldId: source.fieldId,
    displayLocation: { ...source.displayLocation },
    cells: Array(CELL_COUNT).fill(0),
    crops: Array(CELL_COUNT).fill(0),
    progress: Array(CELL_COUNT).fill(0),
    display: { ...source.display },
  };
  const counts = new Uint8Array(CELL_COUNT * 3),
    progress = new Float64Array(CELL_COUNT * 3);
  const priority = [0, 1, 3, 0, 0, 2];
  for (let i = 0; i < LEGACY_CELL_COUNT; i++) {
    // Fit the entire old field into the new bounds; retain both outer edges.
    const col = Math.floor(
      (((i % LEGACY_COLUMNS) + 0.5) * FIELD_COLUMNS) / LEGACY_COLUMNS,
    );
    const row = Math.floor(
      ((Math.floor(i / LEGACY_COLUMNS) + 0.5) * FIELD_ROWS) / LEGACY_ROWS,
    );
    const cell = row * FIELD_COLUMNS + col,
      state = source.cells[i];
    if (source.crops[i]) {
      const key = cell * 3 + source.crops[i] - 1;
      counts[key]++;
      progress[key] = Math.max(progress[key], source.progress[i]);
    } else if (priority[state] > priority[result.cells[cell]])
      result.cells[cell] = state;
  }
  for (let i = 0; i < CELL_COUNT; i++) {
    let chosen = -1;
    for (let crop = 0; crop < 3; crop++) {
      const key = i * 3 + crop;
      if (counts[key] > 0 && (chosen < 0 || counts[key] > counts[chosen]))
        chosen = key;
    }
    if (chosen < 0) continue;
    // Crops take priority over bare ground. Ties use crop order; growth never rewinds.
    result.crops[i] = (chosen % 3) + 1;
    result.progress[i] = progress[chosen];
    result.cells[i] = progress[chosen] === 1 ? Ground.mature : Ground.growing;
  }
  return result;
}

export class FarmingEngine {
  readonly cells: Uint8Array;
  readonly crops: Uint8Array;
  readonly progress: Float64Array;
  readonly fieldId: string;
  readonly displayLocation: Point;
  readonly config: FarmingConfig;
  readonly bounds: FieldBounds;
  display = emptyDisplay();

  constructor(
    saved?: FarmSnapshot | number[],
    config = FARMING_CONFIG,
    starter = true,
    site: FieldSite = HOME_SITE,
  ) {
    if (
      !CROPS.every(
        (c) =>
          Number.isFinite(config.growthSeconds[c]) &&
          config.growthSeconds[c] > 0,
      ) ||
      !Number.isFinite(config.implementRadius) ||
      config.implementRadius < 0 ||
      !Number.isFinite(config.edgeCoverage) ||
      config.edgeCoverage < 0 ||
      config.displayThresholds.length !== 3 ||
      config.displayThresholds[0] !== 1 ||
      !config.displayThresholds.every(
        (n, i, a) => Number.isSafeInteger(n) && n > (a[i - 1] ?? 0),
      )
    )
      throw new Error("Invalid farming configuration");
    this.config = structuredClone(config);
    this.bounds = site.bounds;
    const count = cellCount(site.bounds);
    this.cells = new Uint8Array(count);
    this.crops = new Uint8Array(count);
    this.progress = new Float64Array(count);
    // Legacy grids only ever belonged to the original field.
    const snapshot = site.original
      ? migrateFarm(saved)
      : validFarm(saved, site.bounds) && saved.fieldId === site.id
        ? saved
        : undefined;
    this.fieldId = snapshot?.fieldId ?? site.id;
    this.displayLocation = {
      ...(snapshot?.displayLocation ?? site.displayLocation),
    };
    if (snapshot) {
      this.cells.set(snapshot.cells);
      this.crops.set(snapshot.crops);
      this.progress.set(snapshot.progress);
      this.display = { ...snapshot.display };
    } else if (starter && site.original) {
      for (let x = -21; x <= 13; x += 0.2)
        for (const z of [10.8, 7.8])
          for (const i of cellsUnderBrush(x, z, 1.05))
            this.cells[i] = Ground.mown;
      for (let x = -4; x <= 13; x += 0.2)
        for (const i of cellsUnderBrush(x, 4.8, 1.05))
          this.cells[i] = Ground.mown;
      // Square crop plots leave a broad grass gap above the mown rows.
      for (const [crop, minX] of [
        ["sunflowers", -20.5],
        ["wheat", -11.5],
        ["pumpkins", -2.5],
      ] as const) {
        for (let z = -7; z < -2; z += FIELD.cell)
          for (let x = minX; x < minX + 5; x += FIELD.cell) {
            const i =
              Math.floor((z - FIELD.minZ) / FIELD.cell) * FIELD_COLUMNS +
              Math.floor((x - FIELD.minX) / FIELD.cell);
            this.cells[i] = Ground.mature;
            this.crops[i] = CROPS.indexOf(crop) + 1;
            this.progress[i] = 1;
          }
      }
    }
  }

  cropAt(i: number): Crop | undefined {
    return CROPS[this.crops[i] - 1];
  }
  stage(i: number) {
    return this.cells[i] === Ground.mature
      ? 3
      : Math.min(2, Math.floor(this.progress[i] * 3));
  }
  displayStage(crop: Crop) {
    return this.config.displayThresholds.filter((n) => this.display[crop] >= n)
      .length;
  }
  get isGrowing() {
    return this.cells.includes(Ground.growing);
  }

  apply(
    from: Point,
    to: Point,
    action: Tool,
    crop: Crop = "wheat",
    radius = this.config.implementRadius,
  ): FarmingEvents {
    if (!Number.isFinite(radius) || radius < 0) return events();
    return this.applyCells(
      cellsUnderSweep(from, to, radius + this.config.edgeCoverage, this.bounds),
      action,
      crop,
    );
  }

  applyCells(
    indices: Iterable<number>,
    action: Tool,
    crop: Crop = "wheat",
  ): FarmingEvents {
    const result = events();
    const harvested = new Map<Crop, number[]>();
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i >= this.cells.length) continue;
      const state = this.cells[i];
      if (
        action === "cultivate" &&
        (state === Ground.grass ||
          state === Ground.mown ||
          state === Ground.growing ||
          state === Ground.mature ||
          state === Ground.stubble)
      ) {
        this.cells[i] = Ground.soil;
        this.crops[i] = 0;
        this.progress[i] = 0;
      } else if (
        action === "sow" &&
        state === Ground.soil &&
        CROPS.includes(crop)
      ) {
        this.cells[i] = Ground.growing;
        this.crops[i] = CROPS.indexOf(crop) + 1;
      } else if (action === "harvest" && state === Ground.mature) {
        const harvestedCrop = this.cropAt(i)!;
        const list = harvested.get(harvestedCrop) ?? [];
        list.push(i);
        harvested.set(harvestedCrop, list);
        this.cells[i] = Ground.stubble;
        this.crops[i] = 0;
        this.progress[i] = 0;
      } else if (action === "mow" && state === Ground.grass)
        this.cells[i] = Ground.mown;
      else if (action === "restore" && state !== Ground.grass) {
        this.cells[i] = Ground.grass;
        this.crops[i] = 0;
        this.progress[i] = 0;
      } else continue;
      result.groundChanges.push(i);
    }
    for (const [crop, cells] of harvested) {
      this.display[crop] = Math.min(
        this.config.displayThresholds[2],
        this.display[crop] + cells.length * HARVEST_UNITS_PER_CELL,
      );
      result.harvestResults.push({
        fieldId: this.fieldId,
        crop,
        cells,
        stage: this.displayStage(crop),
      });
    }
    return result;
  }

  advance(seconds: number, active = true): FarmingEvents {
    const result = events();
    if (!active || !Number.isFinite(seconds) || seconds <= 0) return result;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== Ground.growing) continue;
      result.advancedSeconds = seconds;
      const before = this.stage(i);
      this.progress[i] = Math.min(
        1,
        this.progress[i] + seconds / this.config.growthSeconds[this.cropAt(i)!],
      );
      if (this.progress[i] >= 1 - 1e-12) {
        this.progress[i] = 1;
        this.cells[i] = Ground.mature;
        result.cropMaturities.push(i);
      }
      if (before !== this.stage(i)) result.cropStages.push(i);
    }
    return result;
  }

  rest(): FarmingEvents {
    let next = Infinity;
    for (let i = 0; i < this.cells.length; i++)
      if (this.cells[i] === Ground.growing)
        next = Math.min(
          next,
          (1 - this.progress[i]) * this.config.growthSeconds[this.cropAt(i)!],
        );
    return this.advance(next);
  }
  clearDisplay() {
    this.display = emptyDisplay();
  }
  reset() {
    this.cells.fill(0);
    this.crops.fill(0);
    this.progress.fill(0);
    this.clearDisplay();
  }
  snapshot(): FarmSnapshot {
    return {
      version: 3,
      fieldId: this.fieldId,
      displayLocation: { ...this.displayLocation },
      cells: Array.from(this.cells),
      crops: Array.from(this.crops),
      progress: Array.from(this.progress),
      display: { ...this.display },
    };
  }
}
