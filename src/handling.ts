import { angleDifference, clamp, cruiseSpeed, WORLD } from "./simulation";
import type { Obstacle, Point, TractorState } from "./simulation";

export const tuning = {
  turnRate: 1.2, tapTurnRate: 1.4, steeringResponse: 12,
  acceleration: 4, braking: 10, deadzone: 10, dragRange: 110,
  brushRadius: 1.25,
  tightTurnSpeed: 1.29,
};

export function constrain(before: TractorState, after: TractorState, dt: number, obstacles: Obstacle[]) {
  let { x, z, heading, speed } = after;
  let constrained = false;
  for (const obstacle of obstacles) {
    const dx = x - obstacle.x, dz = z - obstacle.z;
    const distance = Math.hypot(dx, dz), clearance = obstacle.radius + 0.9;
    if (distance < clearance) {
      const direction = distance > 0.001 ? Math.atan2(dx, dz) : heading + Math.PI;
      x = obstacle.x + Math.sin(direction) * clearance;
      z = obstacle.z + Math.cos(direction) * clearance;
      constrained = true;
    }
  }
  const boundedX = clamp(x, WORLD.minX, WORLD.maxX), boundedZ = clamp(z, WORLD.minZ, WORLD.maxZ);
  constrained ||= boundedX !== x || boundedZ !== z;
  x = boundedX; z = boundedZ;
  if (constrained && dt > 0) speed = Math.min(speed, Math.hypot(x - before.x, z - before.z) / dt);
  return { x, z, heading, speed: speed < 0.015 ? 0 : speed };
}

/** A neutral-centered, camera-independent gesture. Small finger tremor is ignored. */
export function dragAmount(dx: number) {
  const amount = clamp((Math.abs(dx) - tuning.deadzone) / (tuning.dragRange - tuning.deadzone), 0, 1);
  return amount === 0 ? 0 : Math.sign(dx) * amount ** 1.7;
}

export class GentleDrive {
  steering = 0;
  reset() { this.steering = 0; }
  step(state: TractorState, dt: number, input: { drag: number } | { target: Point } | null,
    obstacles: Obstacle[] = [], paceScale = 1, pace = 0.85): TractorState {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    let { x, z, heading, speed } = state;
    let desiredSpeed = 0;
    if (input && "drag" in input) {
      // Center and release remove turn immediately. There is no angular inertia.
      const requested = dragAmount(input.drag);
      this.steering = requested === 0 ? 0 : this.steering + (requested - this.steering) * (1 - Math.exp(-tuning.steeringResponse * dt));
      // Heading-positive is screen-left for the +Z forward tractor.
      heading -= this.steering * tuning.turnRate * dt;
      // A small radius comes from slowing travel, without increasing camera yaw.
      const cruise = cruiseSpeed(pace);
      desiredSpeed = cruise - (cruise - tuning.tightTurnSpeed) * Math.abs(this.steering) ** 1.3;
    } else if (input && "target" in input) {
      this.steering = 0;
      const distance = Math.hypot(input.target.x - x, input.target.z - z);
      if (distance > 0.38) {
        const turn = angleDifference(Math.atan2(input.target.x - x, input.target.z - z), heading);
        heading += clamp(turn * (1 - Math.exp(-4 * dt)), -tuning.tapTurnRate * dt, tuning.tapTurnRate * dt);
        const alignment = Math.max(0, Math.cos(turn));
        desiredSpeed = Math.min(cruiseSpeed(pace) * clamp(paceScale, 0, 1), distance * 2.4) * (0.04 + 0.96 * alignment ** 2);
      }
    } else this.steering = 0;
    speed += (desiredSpeed - speed) * (1 - Math.exp(-(desiredSpeed > speed ? tuning.acceleration : tuning.braking) * dt));
    if (speed < 0.015) speed = 0;
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
    return constrain(state, { x, z, heading, speed }, dt, obstacles);
  }
}

