export type Tool = "cultivate" | "sow" | "harvest" | "mow" | "restore" | "wander";
export interface Point {
  x: number;
  z: number;
}
export interface TractorState extends Point {
  heading: number;
  speed: number;
}
export interface Obstacle extends Point {
  radius: number;
}
export interface FieldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cell: number;
}
/** The original working field beside the barn. */
export const FIELD: FieldBounds = { minX: -25, maxX: 20, minZ: -12, maxZ: 13, cell: 0.5 };
/** A smaller field to the west, reached along the lane past the tree line. */
export const FAR_FIELD: FieldBounds = { minX: -87, maxX: -57, minZ: -11, maxZ: 9, cell: 0.5 };
export const FIELDS: readonly FieldBounds[] = [FIELD, FAR_FIELD];
/** Where the tractor may roam: both fields, the lanes, and the meadow around them. */
export const WORLD = { minX: -95, maxX: 39, minZ: -30, maxZ: 28 };
export const fieldColumns = (bounds: FieldBounds) =>
  Math.round((bounds.maxX - bounds.minX) / bounds.cell);
export const fieldRows = (bounds: FieldBounds) =>
  Math.round((bounds.maxZ - bounds.minZ) / bounds.cell);
export const FIELD_COLUMNS = fieldColumns(FIELD);
export const FIELD_ROWS = fieldRows(FIELD);
export const inBounds = (bounds: FieldBounds, p: Point) =>
  Number.isFinite(p.x) && Number.isFinite(p.z)
  && p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
/** The field that contains a ground point, if any. */
export const fieldAt = (p: Point) => FIELDS.find((bounds) => inBounds(bounds, p));
export function clampToWorld(p: Point): Point {
  return { x: clamp(p.x, WORLD.minX, WORLD.maxX), z: clamp(p.z, WORLD.minZ, WORLD.maxZ) };
}
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const angleDifference = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Keep saved slider positions: the default cruises at 3 m/s, the maximum at 4.5 m/s. */
export function cruiseSpeed(pace = 0.85) {
  return 3 + (clamp(pace, 0.55, 1.25) - 0.85) / (1.25 - 0.85) * (4.5 - 3);
}
export function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function advanceTractor(
  state: TractorState,
  target: Point | null,
  dt: number,
  obstacles: Obstacle[],
  rowAssist: boolean,
  pace = 0.85,
  paceScale = 1,
): TractorState {
  dt = clamp(dt, 0, 0.05);
  let { x, z, heading, speed } = state;
  const distance = target ? Math.hypot(target.x - x, target.z - z) : 0;
  let desiredSpeed = 0;
  if (target && distance > 0.38) {
    let desiredHeading = Math.atan2(target.x - x, target.z - z);
    const snap = (Math.round(desiredHeading / (Math.PI / 2)) * Math.PI) / 2;
    if (
      rowAssist &&
      distance > 3 &&
      Math.abs(angleDifference(snap, desiredHeading)) < 0.13
    )
      desiredHeading = snap;
    const turn = angleDifference(desiredHeading, heading);
    heading += clamp(turn, -dt * 2.4, dt * 2.4);
    desiredSpeed =
      Math.min(cruiseSpeed(pace) * clamp(paceScale, 0, 1), distance * 1.8) *
      (0.18 + 0.82 * Math.max(0, Math.cos(turn)));
  }
  speed += (desiredSpeed - speed) * Math.min(1, dt * (desiredSpeed ? 3.8 : 7));
  if (speed < 0.015) speed = 0;
  x += Math.sin(heading) * speed * dt;
  z += Math.cos(heading) * speed * dt;
  let constrained = false;
  for (const obstacle of obstacles) {
    const dx = x - obstacle.x,
      dz = z - obstacle.z;
    const distanceToObstacle = Math.hypot(dx, dz),
      clearance = obstacle.radius + 0.9;
    if (distanceToObstacle < clearance) {
      const direction =
        distanceToObstacle > 0.001 ? Math.atan2(dx, dz) : heading + Math.PI;
      x = obstacle.x + Math.sin(direction) * clearance;
      z = obstacle.z + Math.cos(direction) * clearance;
      constrained = true;
    }
  }
  const boundedX = clamp(x, WORLD.minX, WORLD.maxX),
    boundedZ = clamp(z, WORLD.minZ, WORLD.maxZ);
  constrained ||= boundedX !== x || boundedZ !== z;
  x = boundedX;
  z = boundedZ;
  if (constrained && dt > 0) {
    // Let glancing contact slide along an obstacle, but make the wheels and
    // engine reflect actual travel when the tractor meets it head-on. Capping
    // at the requested speed also avoids acceleration from overlap recovery.
    speed = Math.min(speed, Math.hypot(x - state.x, z - state.z) / dt);
    if (speed < 0.015) speed = 0;
  }
  return { x, z, heading, speed };
}
export function cellsUnderBrush(
  x: number,
  z: number,
  radius: number,
  bounds: FieldBounds = FIELD,
): number[] {
  return cellsUnderSweep({ x, z }, { x, z }, radius, bounds);
}

/** Paint the actual swept disk, including tangent cells between render frames. */
export function cellsUnderSweep(from: Point, to: Point, radius: number,
  bounds: FieldBounds = FIELD): number[] {
  if (![from.x, from.z, to.x, to.z, radius].every(Number.isFinite) || radius < 0) return [];
  const dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz;
  const columns = fieldColumns(bounds);
  const rows = fieldRows(bounds);
  const result: number[] = [];
  const minCol = clamp(
    Math.floor((Math.min(from.x, to.x) - radius - bounds.minX) / bounds.cell),
    0,
    columns - 1,
  );
  const maxCol = clamp(
    Math.floor((Math.max(from.x, to.x) + radius - bounds.minX) / bounds.cell),
    0,
    columns - 1,
  );
  const minRow = clamp(
    Math.floor((Math.min(from.z, to.z) - radius - bounds.minZ) / bounds.cell),
    0,
    rows - 1,
  );
  const maxRow = clamp(
    Math.floor((Math.max(from.z, to.z) + radius - bounds.minZ) / bounds.cell),
    0,
    rows - 1,
  );
  for (let row = minRow; row <= maxRow; row++)
    for (let col = minCol; col <= maxCol; col++) {
      const cx = bounds.minX + (col + 0.5) * bounds.cell,
        cz = bounds.minZ + (row + 0.5) * bounds.cell;
      const t = lengthSquared ? clamp(((cx - from.x) * dx + (cz - from.z) * dz) / lengthSquared, 0, 1) : 0;
      if ((from.x + t * dx - cx) ** 2 + (from.z + t * dz - cz) ** 2 <= radius ** 2 + 1e-10)
        result.push(row * columns + col);
    }
  return result;
}
