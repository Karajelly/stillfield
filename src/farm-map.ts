import { HOME_SITE } from "./farming";
import type { FieldSite } from "./farming";
import { clamp, FAR_FIELD, FIELD } from "./simulation";
import type { Obstacle, Point, TractorState } from "./simulation";
import type { TractorNavigation } from "./tractor-navigation";

/** Foxglove field sits west of the barn field, one quiet lane away, with twice the room. */
export const FAR_SITE: FieldSite = {
  id: "foxglove",
  bounds: FAR_FIELD,
  displayLocation: { x: -87, z: -23 },
  original: false,
};
export const SITES: readonly FieldSite[] = [HOME_SITE, FAR_SITE];
export const SITE_NAMES: Record<string, string> = {
  willowbrook: "Home field",
  foxglove: "Foxglove field",
};

/** The lane's centerline, from the home loop's west side to Foxglove's east side. */
export const LANE: readonly Point[] = [
  { x: -27, z: -1 },
  { x: -33, z: -0.4 },
  { x: -41, z: -1.4 },
  { x: -49, z: -0.6 },
  { x: -55, z: -1 },
];
/** Where a ride along the lane begins and ends, a few metres inside each field. */
const ENTRANCES: Record<string, Point> = {
  willowbrook: { x: -19, z: -1 },
  foxglove: { x: -62, z: -1 },
};

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * 0 frames the home field, 1 frames Foxglove field. The view holds still while
 * the tractor works inside either field, then follows it along the lane, so
 * taps and drags never slide under a finger mid-row.
 */
export function viewBlend(p: Point): number {
  if (!Number.isFinite(p.x)) return 0;
  return smoothstep(clamp((FIELD.minX - p.x) / (FIELD.minX - FAR_FIELD.maxX), 0, 1));
}

/** The field the view currently belongs to. */
export const siteForView = (blend: number) => (blend < 0.5 ? HOME_SITE : FAR_SITE);
/** The other end of the lane from wherever the view belongs. */
export const laneDestination = (p: Point) => (viewBlend(p) < 0.5 ? FAR_SITE : HOME_SITE);

/** Step around anything sitting on a straight leg, keeping to the side it leans. */
function around(from: Point, to: Point, obstacles: readonly Obstacle[]): Point[] {
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];
  const detours: { along: number; point: Point }[] = [];
  for (const o of obstacles) {
    const along = ((o.x - from.x) * dx + (o.z - from.z) * dz) / length;
    if (along <= 0 || along >= length) continue;
    const across = ((o.x - from.x) * dz - (o.z - from.z) * dx) / length;
    const clearance = o.radius + 1.6;
    if (Math.abs(across) >= clearance) continue;
    // Pass on the side the leg already favours; a dead-centre hit passes left.
    const side = across > 0 ? -1 : 1, offset = o.radius + 2.6;
    detours.push({
      along,
      point: { x: o.x + (side * dz / length) * offset, z: o.z - (side * dx / length) * offset },
    });
  }
  return detours.sort((a, b) => a.along - b.along).map((d) => d.point);
}

/**
 * Waypoints from the tractor to the other field: across its own field to the
 * lane, along the lane, and a few metres into the destination.
 */
export function laneRoute(from: Point, destination: FieldSite,
  obstacles: readonly Obstacle[] = []): Point[] {
  const west = destination.id === FAR_SITE.id;
  const lane = west ? [...LANE] : [...LANE].reverse();
  const ahead = (p: Point) => (west ? p.x < from.x - 1 : p.x > from.x + 1);
  const end = ENTRANCES[destination.id];
  const stops = [...lane.filter(ahead), end];
  const route: Point[] = [];
  let previous = from;
  for (const stop of stops) {
    route.push(...around(previous, stop, obstacles), stop);
    previous = stop;
  }
  return route;
}

/**
 * A ride down the lane: one waypoint at a time through the shared navigation,
 * with the implement lifted. Any tap, key, pause, or obstacle simply ends it.
 */
export class LaneRide {
  readonly route: Point[];
  readonly end: Point;
  constructor(readonly to: FieldSite, state: TractorState,
    private navigation: TractorNavigation, private obstacles: Obstacle[] = []) {
    this.route = laneRoute(state, to, obstacles);
    this.end = { ...this.route.at(-1)! };
    navigation.cancel();
    this.advance(state);
  }
  private advance(state: TractorState) {
    const next = this.route.shift();
    if (next) this.navigation.choose(next, state, "wander", this.obstacles);
  }
  /** Call after each navigation step. Waypoints roll on before the tractor slows. */
  update(state: TractorState, blocked: boolean): "riding" | "arrived" | "blocked" {
    if (blocked) return "blocked";
    const waypoint = this.navigation.target;
    if (!waypoint && !this.route.length) return "arrived";
    if (!waypoint || (this.route.length
      && Math.hypot(waypoint.x - state.x, waypoint.z - state.z) < 2.5)) this.advance(state);
    return "riding";
  }
}
