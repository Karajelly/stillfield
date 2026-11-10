/**
 * A slow day that follows active play. It runs on the same clock as the crops,
 * so nothing moves while the game is paused or away. No part of the farming
 * loop reads it: the hour changes the light and the sounds, never the rules.
 */
export const DAY_SECONDS = 720;

export const DAY_HOLDS = ["flow", "morning", "golden", "dusk", "night"] as const;
export type DayHold = (typeof DAY_HOLDS)[number];
export type DayPhase =
  | "morning"
  | "afternoon"
  | "golden"
  | "dusk"
  | "night"
  | "dawn";
export type Rgb = [number, number, number];

export interface Daylight {
  phase: DayPhase;
  /** Colours are sRGB, 0 to 1. */
  sun: Rgb;
  sunPower: number;
  /** Unit vector from the meadow towards the sun or moon. */
  sunFrom: [number, number, number];
  shadow: number;
  skyLight: Rgb;
  groundLight: Rgb;
  ambient: number;
  sky: Rgb;
  exposure: number;
  /** 0 in daylight, 1 once lamps, windows, and fireflies are fully lit. */
  glow: number;
  /** Birdsong: 1 through the day, 0 at night, a little more at first light. */
  birds: number;
}

interface Key extends Omit<Daylight, "phase" | "sun" | "skyLight" | "groundLight" | "sky"> {
  at: number;
  sun: string;
  skyLight: string;
  groundLight: string;
  sky: string;
}

const morning: Omit<Key, "at"> = {
  sun: "#fff1ce",
  sunPower: 3.1,
  sunFrom: [-32, 55, 22],
  shadow: 1,
  skyLight: "#fff8df",
  groundLight: "#7c9060",
  ambient: 2.5,
  sky: "#e8ecda",
  exposure: 1.1,
  glow: 0,
  birds: 1,
};
const afternoon = {
  ...morning,
  sun: "#fff4d8",
  sunPower: 3.2,
  skyLight: "#fffbe8",
  ambient: 2.55,
  sky: "#e9eedd",
};
const golden = {
  ...morning,
  sun: "#ffd299",
  sunPower: 3.3,
  skyLight: "#ffe3bb",
  groundLight: "#86895c",
  ambient: 2.0,
  sky: "#eee5ce",
};
const night = {
  sun: "#a9bdf0",
  sunPower: 0.95,
  sunFrom: [-18, 60, -30] as [number, number, number],
  shadow: 0.6,
  skyLight: "#7f95c4",
  groundLight: "#33424d",
  ambient: 1.0,
  sky: "#36465f",
  exposure: 1.05,
  glow: 1,
  birds: 0,
};
// The first and last entries match, so the day closes into a loop.
const KEYS: Key[] = [
  { at: 0, ...morning },
  { at: 0.2, ...afternoon, sunFrom: [-20, 64, 6] },
  { at: 0.36, ...afternoon, sunFrom: [-30, 56, -2] },
  { at: 0.46, ...golden, sunFrom: [-52, 30, -6] },
  { at: 0.56, ...golden, sun: "#ffc487", sunPower: 3.1, sunFrom: [-56, 22, -10] },
  {
    at: 0.64,
    sun: "#f6a88c",
    sunPower: 2.3,
    sunFrom: [-58, 15, -16],
    shadow: 0.8,
    skyLight: "#f0cfc8",
    groundLight: "#6f7669",
    ambient: 1.9,
    sky: "#e8c9c4",
    exposure: 1.1,
    glow: 0.7,
    birds: 0.25,
  },
  {
    at: 0.705,
    sun: "#8fa6dc",
    sunPower: 0.55,
    sunFrom: [-40, 36, -26],
    shadow: 0.4,
    skyLight: "#8ea2cc",
    groundLight: "#3f4c58",
    ambient: 1.15,
    sky: "#5b6a86",
    exposure: 1.05,
    glow: 1,
    birds: 0,
  },
  { at: 0.74, ...night },
  { at: 0.89, ...night },
  {
    at: 0.915,
    sun: "#9fb0d8",
    sunPower: 0.5,
    sunFrom: [-36, 34, 6],
    shadow: 0.25,
    skyLight: "#9fb0cf",
    groundLight: "#46555a",
    ambient: 1.25,
    sky: "#6f7f96",
    exposure: 1.05,
    glow: 0.8,
    birds: 0.5,
  },
  {
    at: 0.96,
    sun: "#ffc9a8",
    sunPower: 2.0,
    sunFrom: [-50, 18, 34],
    shadow: 0.7,
    skyLight: "#f6d9cf",
    groundLight: "#74856a",
    ambient: 1.9,
    sky: "#ead6cc",
    exposure: 1.1,
    glow: 0.15,
    birds: 1.5,
  },
  { at: 1, ...morning },
];

const HOLD_AT: Record<Exclude<DayHold, "flow">, number> = {
  morning: 0,
  golden: 0.5,
  dusk: 0.64,
  night: 0.81,
};

export const DAY_COPY: Record<DayPhase, [string, string]> = {
  morning: ["A slow summer morning", "76° · a gentle breeze"],
  afternoon: ["A long, easy afternoon", "81° · a gentle breeze"],
  golden: ["A little golden hour", "76° · a gentle breeze"],
  dusk: ["A soft pink dusk", "70° · crickets tuning up"],
  night: ["A quiet, bright night", "64° · fireflies by the pond"],
  dawn: ["First light", "62° · dew on the rows"],
};

/** Wrap any saved or accumulated value into one day. Bad input is morning. */
export function wrapDay(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return ((seconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

/** The moment a held light keeps, in seconds into the day. */
export function holdSeconds(hold: Exclude<DayHold, "flow">): number {
  return HOLD_AT[hold] * DAY_SECONDS;
}

export function dayPhase(seconds: number): DayPhase {
  const p = wrapDay(seconds) / DAY_SECONDS;
  if (p < 0.14 || p >= 0.985) return "morning";
  if (p < 0.41) return "afternoon";
  if (p < 0.6) return "golden";
  if (p < 0.71) return "dusk";
  if (p < 0.915) return "night";
  return "dawn";
}

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: string, b: string, t: number): Rgb => {
  const from = rgb(a),
    to = rgb(b);
  return [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)];
};

export function daylightAt(seconds: number): Daylight {
  const p = wrapDay(seconds) / DAY_SECONDS;
  let index = 0;
  while (index < KEYS.length - 2 && KEYS[index + 1].at <= p) index++;
  const a = KEYS[index],
    b = KEYS[index + 1];
  const linear = (p - a.at) / (b.at - a.at);
  // Ease each stretch so the light never visibly changes speed.
  const t = linear * linear * (3 - 2 * linear);
  const from = a.sunFrom.map((value, axis) => mix(value, b.sunFrom[axis], t));
  const length = Math.hypot(from[0], from[1], from[2]);
  return {
    phase: dayPhase(seconds),
    sun: mixRgb(a.sun, b.sun, t),
    sunPower: mix(a.sunPower, b.sunPower, t),
    sunFrom: [from[0] / length, from[1] / length, from[2] / length],
    shadow: mix(a.shadow, b.shadow, t),
    skyLight: mixRgb(a.skyLight, b.skyLight, t),
    groundLight: mixRgb(a.groundLight, b.groundLight, t),
    ambient: mix(a.ambient, b.ambient, t),
    sky: mixRgb(a.sky, b.sky, t),
    exposure: mix(a.exposure, b.exposure, t),
    glow: mix(a.glow, b.glow, t),
    birds: mix(a.birds, b.birds, t),
  };
}
