import { angleDifference, clamp, cruiseSpeed, WORLD } from "./simulation";
import type { Obstacle, Point, TractorState } from "./simulation";

const quarterTurn = Math.PI / 2;
const turnRate = Math.PI * 2;
const acceleration = 4;
const directions: Record<string, number> = {
  KeyW: 2, ArrowUp: 2,
  KeyA: -1, ArrowLeft: -1,
  KeyS: 0, ArrowDown: 0,
  KeyD: 1, ArrowRight: 1,
};

export interface GridInput { heading: number; driving: boolean }

export function isDriveKey(code: string) {
  return Object.hasOwn(directions, code);
}

/** Snap the camera's ground axes to the field, keeping all four keys orthogonal. */
export function gridHeading(code: string, cameraDown: Point): number {
  const down = Math.round(Math.atan2(cameraDown.x, cameraDown.z) / quarterTurn);
  return angleDifference((down + directions[code]) * quarterTurn, 0);
}

/** A press owns its direction until release, even when the camera is reframed. */
export class GridKeyboard {
  private held = new Map<string, number>();
  private heading: number | null = null;

  press(code: string, cameraDown: Point) {
    if (!isDriveKey(code) || this.held.has(code)) return;
    this.heading = gridHeading(code, cameraDown);
    this.held.set(code, this.heading);
  }
  release(code: string) {
    if (!this.held.delete(code)) return;
    this.heading = Array.from(this.held.values()).at(-1) ?? this.heading;
  }
  reset() {
    this.held.clear();
    this.heading = null;
  }
  get input(): GridInput | null {
    return this.heading === null ? null : { heading: this.heading, driving: this.held.size > 0 };
  }
}

/** Stop at the first contact along a row; collision response must not slide diagonally. */
function clearTravel(state: TractorState, direction: Point, distance: number, obstacles: Obstacle[]) {
  let travel = distance;
  if (direction.x) travel = Math.min(travel, direction.x > 0 ? WORLD.maxX - state.x : state.x - WORLD.minX);
  if (direction.z) travel = Math.min(travel, direction.z > 0 ? WORLD.maxZ - state.z : state.z - WORLD.minZ);
  for (const obstacle of obstacles) {
    const dx = obstacle.x - state.x, dz = obstacle.z - state.z;
    const along = dx * direction.x + dz * direction.z;
    const across = dx * direction.z - dz * direction.x;
    const clearance = obstacle.radius + 0.9;
    if (Math.abs(across) >= clearance || along <= 0) continue;
    const entry = along - Math.sqrt(clearance ** 2 - across ** 2);
    travel = Math.min(travel, Math.max(0, entry));
  }
  return Math.max(0, travel);
}

/** Pivot within the current cell, then travel along exactly one field axis. */
export function advanceGridTractor(state: TractorState, input: GridInput, dt: number,
  obstacles: Obstacle[], pace = 0.85): TractorState {
  dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
  if (dt === 0) return state;
  const turn = angleDifference(input.heading, state.heading);
  if (Math.abs(turn) > 1e-8) {
    // A reversal passes through two exact quarter turns. A diagonal heading from
    // pointer driving first reaches the next grid axis without moving the tractor.
    const sign = Math.sign(turn);
    const nextAxis = (sign > 0
      ? Math.floor(state.heading / quarterTurn + 1e-8) + 1
      : Math.ceil(state.heading / quarterTurn - 1e-8) - 1) * quarterTurn;
    const amount = Math.min(Math.abs(turn), Math.abs(nextAxis - state.heading), turnRate * dt);
    return { ...state, heading: angleDifference(state.heading + sign * amount, 0), speed: 0 };
  }
  const heading = input.heading;
  if (!input.driving) return { ...state, heading, speed: 0 };
  const cruise = cruiseSpeed(pace), response = 1 - Math.exp(-acceleration * dt);
  const speed = state.speed + (cruise - state.speed) * response;
  const distance = cruise * dt + (state.speed - cruise) * response / acceleration;
  const direction = { x: Math.round(Math.sin(heading)), z: Math.round(Math.cos(heading)) };
  const travel = clearTravel(state, direction, distance, obstacles);
  return { x: state.x + direction.x * travel, z: state.z + direction.z * travel,
    heading, speed: travel < distance ? 0 : speed };
}
