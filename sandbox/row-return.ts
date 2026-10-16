import { angleDifference, clamp, FIELD } from "../src/simulation";
import type { Obstacle, Point, TractorState } from "../src/simulation";
import { constrain, tuning } from "./handling";
import { attachmentPoint } from "./work-destination";

export interface WorkedRow {
  axis: 0 | 1;
  lane: number;
  heading: number;
  from: number;
  to: number;
}
export const along = (point: Point, axis: number) => axis === 0 ? point.x : point.z;
export const across = (point: Point, axis: number) => axis === 0 ? point.z : point.x;
export const rowPoint = (axis: number, distance: number, lane: number): Point =>
  axis === 0 ? { x: distance, z: lane } : { x: lane, z: distance };

/** Remember a row only after the actual working attachment has driven it. */
export class WorkedRows {
  last: WorkedRow | null = null;
  private streak: WorkedRow | null = null;
  sample(state: TractorState, working: boolean) {
    if (!working) { this.streak = null; return; }
    const heading = Math.round(state.heading / (Math.PI / 2)) * Math.PI / 2;
    if (Math.abs(angleDifference(heading, state.heading)) > 0.06) { this.streak = null; return; }
    const axis = Math.abs(Math.sin(heading)) > 0.5 ? 0 : 1;
    const brush = attachmentPoint(state), lane = across(brush, axis);
    const min = axis === 0 ? FIELD.minX : FIELD.minZ, max = axis === 0 ? FIELD.maxX : FIELD.maxZ;
    const position = clamp(along(brush, axis), min + FIELD.cell / 2, max - FIELD.cell / 2);
    if (!this.streak || this.streak.axis !== axis || Math.abs(angleDifference(this.streak.heading, heading)) > 0.1
      || Math.abs(this.streak.lane - lane) > 0.12)
      this.streak = { axis, heading, lane, from: position, to: position };
    this.streak.to = position;
    if (Math.abs(this.streak.to - this.streak.from) >= 6) this.last = { ...this.streak };
  }
  finish(point: Point, state: TractorState, lane?: number) {
    if (this.streak && Math.abs(this.streak.to - this.streak.from) >= 6
      && Math.abs((lane ?? across(point, this.streak.axis)) - this.streak.lane) < 0.55
      && Math.abs(angleDifference(state.heading, this.streak.heading)) < 0.1)
      this.last = { ...this.streak, lane: lane ?? across(point, this.streak.axis), to: along(point, this.streak.axis) };
    this.streak = null;
  }
}

export interface RowChoice {
  row: WorkedRow;
  point: Point;
  side: -1 | 1;
}

/** A choice is available at a worked row end, never an automatic next pass. */
export function nextRow(last: WorkedRow | null, state: TractorState, side: -1 | 1,
  obstacles: Obstacle[] = []): RowChoice | null {
  if (!last || state.speed > 0.15 || Math.abs(angleDifference(last.heading, state.heading)) > 0.12
    || Math.abs(across(state, last.axis) - last.lane) > 0.18
    || Math.abs(along(state, last.axis) - last.to) > 3) return null;
  const right = last.axis === 0 ? Math.sin(last.heading) : -Math.cos(last.heading);
  const lane = last.lane + side * right * tuning.rowPitch;
  const min = last.axis === 0 ? FIELD.minZ : FIELD.minX, max = last.axis === 0 ? FIELD.maxZ : FIELD.maxX;
  if (lane < min + FIELD.cell / 2 || lane > max - FIELD.cell / 2) return null;
  const row = { ...last, lane, heading: last.heading + Math.PI, from: last.to, to: last.from };
  const choice: RowChoice = { row, point: rowPoint(row.axis, row.to, lane), side };
  const turn = new RowReturn(state, choice);
  const points = [...turn.path];
  const start = turn.path.at(-1)!;
  const length = Math.hypot(choice.point.x - start.x, choice.point.z - start.z);
  for (let d = 0; d <= length; d += 0.25) points.push({
    x: start.x + (choice.point.x - start.x) * d / length,
    z: start.z + (choice.point.z - start.z) * d / length,
  });
  // Decline a blocked lane. This is not an obstacle-routing experiment.
  if (points.some(p => p.x < -38.8 || p.x > 38.8 || p.z < -29.8 || p.z > 27.8
    || obstacles.some(o => Math.hypot(p.x - o.x, p.z - o.z) < o.radius + 1.05))) return null;
  return choice;
}

/** Low-speed path following: integrates movement, respects collisions, never sets a pose. */
export class RowReturn {
  readonly path: Point[];
  readonly radius: number;
  readonly heading: number;
  done = false;
  blocked = false;
  elapsed = 0;
  private index = 0;
  private stalled = 0;
  private arcEnd: Point;
  constructor(state: TractorState, readonly choice: RowChoice) {
    const incoming = choice.row.heading - Math.PI;
    const forward = { x: Math.sin(incoming), z: Math.cos(incoming) };
    const delta = choice.row.lane - across(state, choice.row.axis);
    this.radius = Math.abs(delta) / 2;
    const side = rowPoint(choice.row.axis, 0, Math.sign(delta));
    this.heading = choice.row.heading;
    this.path = [];
    for (let i = 0; i <= 48; i++) {
      const angle = i / 48 * Math.PI;
      this.path.push({ x: state.x + forward.x * this.radius * Math.sin(angle) + side.x * this.radius * (1 - Math.cos(angle)),
        z: state.z + forward.z * this.radius * Math.sin(angle) + side.z * this.radius * (1 - Math.cos(angle)) });
    }
    this.arcEnd = this.path.at(-1)!;
    for (let d = 0.1; d <= 3; d += 0.1)
      this.path.push({ x: this.arcEnd.x - forward.x * d, z: this.arcEnd.z - forward.z * d });
  }
  step(state: TractorState, dt: number, obstacles: Obstacle[] = []): TractorState {
    dt = clamp(dt, 0, 0.05); this.elapsed += dt;
    let closest = this.index, distance = Infinity;
    for (let i = this.index; i < Math.min(this.path.length, this.index + 16); i++) {
      const d = Math.hypot(this.path[i].x - state.x, this.path[i].z - state.z);
      if (d < distance) { closest = i; distance = d; }
    }
    this.index = closest;
    let look = closest, lookDistance = 0;
    while (look < this.path.length - 1 && lookDistance < 0.55) {
      lookDistance += Math.hypot(this.path[look + 1].x - this.path[look].x, this.path[look + 1].z - this.path[look].z); look++;
    }
    const target = this.path[look], dx = target.x - state.x, dz = target.z - state.z;
    const error = angleDifference(Math.atan2(dx, dz), state.heading);
    const desiredSpeed = Math.min(1.15, this.radius * tuning.turnRate * 0.9) * Math.max(0.15, Math.cos(error));
    const speed = state.speed + (desiredSpeed - state.speed) * (1 - Math.exp(-tuning.acceleration * dt));
    const yaw = clamp(2 * speed * Math.sin(error) / Math.max(0.25, Math.hypot(dx, dz)), -tuning.turnRate, tuning.turnRate);
    const heading = state.heading + yaw * dt;
    const result = constrain(state, { x: state.x + Math.sin(heading) * speed * dt,
      z: state.z + Math.cos(heading) * speed * dt, heading, speed }, dt, obstacles);
    const returnDistance = (result.x - this.arcEnd.x) * Math.sin(this.heading)
      + (result.z - this.arcEnd.z) * Math.cos(this.heading);
    this.done = returnDistance > 0.85 && Math.abs(across(result, this.choice.row.axis) - this.choice.row.lane) < 0.025
      && Math.abs(angleDifference(result.heading, this.heading)) < 0.025;
    this.stalled = Math.hypot(result.x - state.x, result.z - state.z) < 0.0005 ? this.stalled + dt : 0;
    this.blocked = this.stalled > 1 || this.elapsed > 10;
    return result;
  }
}
