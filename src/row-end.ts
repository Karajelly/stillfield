import { angleDifference, clamp, fieldAt, WORLD } from "./simulation";
import type { Obstacle, Point, TractorState } from "./simulation";
import { constrain, tuning } from "./handling";
import { attachmentOffset, attachmentPoint } from "./work-destination";

export interface WorkedRow { start: Point; end: Point; heading: number }
const forward = (heading: number): Point => ({ x: Math.sin(heading), z: Math.cos(heading) });
const sideways = (heading: number): Point => ({ x: Math.cos(heading), z: -Math.sin(heading) });
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const delta = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
const inField = (p: Point) => fieldAt(p) !== undefined;

/** Observe actual straight work, including diagonal rows. Never change steering. */
export class WorkedRows {
  last: WorkedRow | null = null;
  private streak: WorkedRow | null = null;
  sample(state: TractorState, working: boolean) {
    const brush = attachmentPoint(state);
    if (!working) { this.streak = null; return; }
    if (!inField(brush)) return;
    if (!this.streak || Math.abs(angleDifference(state.heading, this.streak.heading)) > 0.04
      || Math.abs(dot(delta(brush, this.streak.start), sideways(this.streak.heading))) > 0.12)
      this.streak = { start: brush, end: brush, heading: state.heading };
    this.streak.end = brush;
    const length = Math.hypot(brush.x - this.streak.start.x, brush.z - this.streak.start.z);
    // Measure the worked line instead of retaining a tiny initial steering error
    // that would accumulate into a false bend over a long pass.
    if (length >= 1) this.streak.heading = Math.atan2(brush.x - this.streak.start.x, brush.z - this.streak.start.z);
    if (length >= 6)
      this.last = { ...this.streak, start: { ...this.streak.start }, end: { ...brush } };
  }
  finish(point: Point, state: TractorState) {
    if (this.streak && Math.hypot(this.streak.end.x - this.streak.start.x, this.streak.end.z - this.streak.start.z) >= 6
      && Math.abs(dot(delta(point, this.streak.start), sideways(this.streak.heading))) < 0.55
      && Math.abs(angleDifference(state.heading, this.streak.heading)) < 0.1)
    {
      const f = forward(this.streak.heading), length = dot(delta(point, this.streak.start), f);
      this.last = { ...this.streak, end: { x: this.streak.start.x + f.x * length, z: this.streak.start.z + f.z * length } };
    }
    this.streak = null;
  }
}

export interface EndAlignment { point: Point; incomingHeading: number; heading: number }

/** Only a nearby tap beside a finished row requests a terminal facing direction. */
export function alignmentForTap(last: WorkedRow | null, state: TractorState, point: Point,
  obstacles: Obstacle[] = []): EndAlignment | null {
  if (!last || !inField(point) || state.speed > 0.15
    || Math.hypot(last.end.x - last.start.x, last.end.z - last.start.z) < 6
    || Math.abs(angleDifference(last.heading, state.heading)) > 0.12) return null;
  const f = forward(last.heading), s = sideways(last.heading);
  const parked = delta(state, last.end), tap = delta(point, last.end);
  if (Math.abs(dot(parked, s)) > 0.2 || dot(parked, f) < -0.5 || dot(parked, f) > 3
    || Math.abs(dot(tap, f)) > 1.25 || Math.abs(dot(tap, s)) < 0.18 || Math.abs(dot(tap, s)) > 3.5) return null;
  const alignment = { point: { ...point }, incomingHeading: last.heading, heading: last.heading + Math.PI };
  const turn = new EndTurn(state, alignment);
  const finish = { x: point.x - f.x * (attachmentOffset + 0.6), z: point.z - f.z * (attachmentOffset + 0.6) };
  const start = turn.path.at(-1)!;
  const length = Math.hypot(finish.x - start.x, finish.z - start.z), points = [...turn.path, finish];
  for (let d = 0; d < length; d += 0.2)
    points.push({ x: start.x + (finish.x - start.x) * d / length, z: start.z + (finish.z - start.z) * d / length });
  if (points.some(p => p.x < WORLD.minX + 0.2 || p.x > WORLD.maxX - 0.2
    || p.z < WORLD.minZ + 0.2 || p.z > WORLD.maxZ - 0.2
    || obstacles.some(o => Math.hypot(p.x - o.x, p.z - o.z) < o.radius + 1.05))) return null;
  return alignment;
}

/** Turn toward the clicked spot; the caller then works that spot and stops. */
export class EndTurn {
  readonly path: Point[] = [];
  readonly radius: number;
  done = false;
  blocked = false;
  elapsed = 0;
  private index = 0;
  private stalled = 0;
  private arcEnd: Point;
  constructor(state: TractorState, readonly alignment: EndAlignment) {
    const f = forward(alignment.incomingHeading), s = sideways(alignment.incomingHeading);
    const shift = dot(delta(alignment.point, state), s);
    this.radius = Math.abs(shift) / 2;
    for (let i = 0; i <= 48; i++) {
      const angle = i / 48 * Math.PI, along = this.radius * Math.sin(angle), across = shift / 2 * (1 - Math.cos(angle));
      this.path.push({ x: state.x + f.x * along + s.x * across, z: state.z + f.z * along + s.z * across });
    }
    this.arcEnd = this.path.at(-1)!;
    for (let d = 0.05; d <= 3; d += 0.05)
      this.path.push({ x: this.arcEnd.x - f.x * d, z: this.arcEnd.z - f.z * d });
  }
  step(state: TractorState, dt: number, obstacles: Obstacle[] = []): TractorState {
    dt = clamp(dt, 0, 0.05); this.elapsed += dt;
    let closest = this.index, distance = Infinity;
    for (let i = this.index; i < Math.min(this.path.length, this.index + 16); i++) {
      const d = Math.hypot(this.path[i].x - state.x, this.path[i].z - state.z);
      if (d < distance) { closest = i; distance = d; }
    }
    this.index = closest;
    const onStraight = closest >= 48;
    const lookAhead = onStraight ? 0.55 : clamp(this.radius * 0.5, 0.04, 0.55);
    let look = closest, lookDistance = 0;
    while (look < this.path.length - 1 && lookDistance < lookAhead) {
      lookDistance += Math.hypot(this.path[look + 1].x - this.path[look].x, this.path[look + 1].z - this.path[look].z); look++;
    }
    const target = this.path[look], dx = target.x - state.x, dz = target.z - state.z;
    const error = angleDifference(Math.atan2(dx, dz), state.heading);
    const desiredSpeed = (onStraight ? 1.15 : Math.min(1.15, this.radius * tuning.turnRate * 0.9)) * Math.max(0.15, Math.cos(error));
    // Stay above the shared movement model's resting threshold for very small turns.
    const speed = Math.max(0.02, state.speed + (desiredSpeed - state.speed) * (1 - Math.exp(-tuning.acceleration * dt)));
    const yaw = clamp(2 * speed * Math.sin(error) / Math.max(0.03, Math.hypot(dx, dz)), -tuning.turnRate, tuning.turnRate);
    const heading = state.heading + yaw * dt;
    const result = constrain(state, { x: state.x + Math.sin(heading) * speed * dt,
      z: state.z + Math.cos(heading) * speed * dt, heading, speed }, dt, obstacles);
    const returning = forward(this.alignment.heading);
    this.done = dot(delta(result, this.arcEnd), returning) > 0.85
      && Math.abs(dot(delta(result, this.alignment.point), sideways(this.alignment.heading))) < 0.025
      && Math.abs(angleDifference(result.heading, this.alignment.heading)) < 0.025;
    this.stalled = Math.hypot(result.x - state.x, result.z - state.z) < 0.0002 ? this.stalled + dt : 0;
    this.blocked = this.stalled > 1 || this.elapsed > 12;
    return result;
  }
}
