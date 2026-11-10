import { Ground } from "./farming";
import type { Crop } from "./farming";
import { FIELD, FIELD_COLUMNS, FIELD_ROWS } from "./simulation";

/**
 * Every so often a gust crosses the field from west to east and plays what is
 * growing there. The field reads as a score: each metre the gust travels is one
 * beat, each 2.5 m lane (one pass of the implement) is one pitch, and each crop
 * is a voice. It only listens. Nothing here changes the farm.
 */
export const WIND = {
  /** Columns per beat: 1 m of travel. */
  stepColumns: 2,
  /** Rows per pitch lane: 2.5 m, one implement pass. */
  bandRows: 5,
  stepSeconds: 0.42,
  firstRest: 16,
  minRest: 40,
  maxRest: 70,
  /** A lane sounds once about a third of its slice is grown. */
  threshold: 0.3,
};
export const WIND_STEPS = FIELD_COLUMNS / WIND.stepColumns;
export const WIND_BANDS = FIELD_ROWS / WIND.bandRows;
export const GUST_SECONDS = WIND_STEPS * WIND.stepSeconds;

export type WindVoice = Crop | "stubble";
export interface WindNote {
  voice: WindVoice;
  /** 0 is the far side of the field, the top of the score and the highest pitch. */
  band: number;
  /** 0 to 1: how much of the slice is grown, and how grown it is. */
  level: number;
}
export interface FieldReader {
  cells: ArrayLike<number>;
  cropAt(cell: number): Crop | undefined;
  stage(cell: number): number;
}

// Seeds are silent, shoots are faint, and a mature crop sings at full voice.
const STAGE_LEVEL = [0, 0.35, 0.65, 1];
const CROP_VOICES: Crop[] = ["wheat", "sunflowers", "pumpkins"];

/** The notes one beat of a gust sounds as it crosses `step` metres of field. */
export function sliceNotes(field: FieldReader, step: number): WindNote[] {
  if (!Number.isInteger(step) || step < 0 || step >= WIND_STEPS) return [];
  const coverage: Record<WindVoice, number[]> = {
    wheat: new Array(WIND_BANDS).fill(0),
    sunflowers: new Array(WIND_BANDS).fill(0),
    pumpkins: new Array(WIND_BANDS).fill(0),
    stubble: new Array(WIND_BANDS).fill(0),
  };
  const perBand = WIND.stepColumns * WIND.bandRows;
  for (let row = 0; row < FIELD_ROWS; row++) {
    const band = Math.floor(row / WIND.bandRows);
    for (let offset = 0; offset < WIND.stepColumns; offset++) {
      const cell = row * FIELD_COLUMNS + step * WIND.stepColumns + offset;
      const state = field.cells[cell];
      if (state === Ground.stubble) coverage.stubble[band] += 1;
      else if (state === Ground.growing || state === Ground.mature) {
        const crop = field.cropAt(cell);
        if (crop)
          coverage[crop][band] += STAGE_LEVEL[field.stage(cell)] ?? 0;
      }
    }
  }
  const notes: WindNote[] = [];
  for (const voice of CROP_VOICES) {
    // Pumpkins keep a slower pulse, like a bass under the other two.
    if (voice === "pumpkins" && step % 2) continue;
    const lanes = coverage[voice]
      .map((sum, band) => ({ band, level: sum / perBand }))
      .filter((lane) => lane.level >= WIND.threshold);
    if (!lanes.length) continue;
    // Walk through the sounding lanes so a full field rolls instead of droning.
    const beat = voice === "pumpkins" ? step / 2 : step;
    const picks = new Set([beat % lanes.length]);
    if (voice !== "pumpkins" && lanes.length > 1)
      picks.add((beat + Math.ceil(lanes.length / 2)) % lanes.length);
    for (const pick of picks) notes.push({ voice, ...lanes[pick] });
  }
  // Stubble is a soft brush on the off-beat, one stroke for the whole slice.
  if (step % 2) {
    const level =
      coverage.stubble.reduce((sum, value) => sum + value, 0) /
      (perBand * WIND_BANDS);
    if (level >= 0.08) notes.push({ voice: "stubble", band: 0, level });
  }
  return notes;
}

// Ten lanes span two octaves of a pentatonic scale, so any field is consonant.
const MAJOR = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const MINOR = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
// D3, D4, and D5: pumpkins sit low, wheat in the middle, sunflowers on top.
const ROOT: Record<Crop, number> = {
  pumpkins: 146.83,
  wheat: 293.66,
  sunflowers: 587.33,
};

/** After dark the same lanes play a minor scale. */
export function windFrequency(voice: Crop, band: number, night = false): number {
  const lane = Math.max(0, Math.min(WIND_BANDS - 1, Math.round(band)));
  const semitones = (night ? MINOR : MAJOR)[WIND_BANDS - 1 - lane];
  return ROOT[voice] * 2 ** (semitones / 12);
}

export interface WindFrame {
  /** World x of the gust front, or null between gusts. */
  front: number | null;
  /** Beats the front crossed during this frame. */
  steps: number[];
  /** 0 to 1: the gust swelling and fading. */
  strength: number;
}

/** Schedules gusts on the active-play clock. It rests while the game rests. */
export class Wind {
  private rest = WIND.firstRest;
  private elapsed = -1;
  private step = 0;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  get gusting(): boolean {
    return this.elapsed >= 0;
  }

  /** Begin a gust now, unless one is already crossing. */
  gust(): void {
    if (this.gusting) return;
    this.elapsed = 0;
    this.step = 0;
  }

  advance(seconds: number): WindFrame {
    const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    if (!this.gusting) {
      this.rest -= dt;
      if (this.rest > 0) return { front: null, steps: [], strength: 0 };
      this.gust();
    } else this.elapsed += dt;
    const steps: number[] = [];
    while (this.step < WIND_STEPS && this.step * WIND.stepSeconds <= this.elapsed)
      steps.push(this.step++);
    // Let the bending trail clear the far edge before the gust ends.
    if (this.elapsed >= GUST_SECONDS + 3) {
      this.elapsed = -1;
      this.rest =
        WIND.minRest + this.random() * (WIND.maxRest - WIND.minRest);
      return { front: null, steps, strength: 0 };
    }
    const travelled =
      (this.elapsed / WIND.stepSeconds) * WIND.stepColumns * FIELD.cell;
    return {
      front: FIELD.minX + travelled,
      steps,
      strength: Math.sin(
        Math.PI * Math.min(1, this.elapsed / (GUST_SECONDS + 3)),
      ),
    };
  }
}
