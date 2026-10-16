import * as THREE from "three";
import { advanceTractor, angleDifference, clamp } from "../src/simulation";
import type { Obstacle, Point, TractorState } from "../src/simulation";

export type Profile = "native" | "web" | "gentle";
export const tuning = {
  turnRate: 1.2, tapTurnRate: 1.4, steeringResponse: 12,
  acceleration: 4, braking: 10, deadzone: 10, dragRange: 110,
  brushRadius: 1.25, rowPitch: 2.15, rowCapture: 0.55,
};

function constrain(before: TractorState, after: TractorState, dt: number, obstacles: Obstacle[]) {
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
  const boundedX = clamp(x, -39, 39), boundedZ = clamp(z, -30, 28);
  constrained ||= boundedX !== x || boundedZ !== z;
  x = boundedX; z = boundedZ;
  if (constrained && dt > 0) speed = Math.min(speed, Math.hypot(x - before.x, z - before.z) / dt);
  return { x, z, heading, speed: speed < 0.015 ? 0 : speed };
}

/** Literal movement port from StillfieldCore/FarmSimulation.swift, at 4acab01.
 * Browser comparison only; this does not replace or invoke RealityKit. */
export function advanceNative(state: TractorState, target: Point | null, dt: number,
  obstacles: Obstacle[] = [], rowAssist = true, pace = 0.85): TractorState {
  dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
  let { x, z, heading, speed } = state;
  const distance = target ? Math.hypot(target.x - x, target.z - z) : 0;
  let desiredSpeed = 0;
  if (target && distance > 0.38) {
    let desiredHeading = Math.atan2(target.x - x, target.z - z);
    const snap = Math.round(desiredHeading / (Math.PI / 2)) * Math.PI / 2;
    if (rowAssist && distance > 3 && Math.abs(angleDifference(snap, desiredHeading)) < 0.13)
      desiredHeading = snap;
    const turn = angleDifference(desiredHeading, heading);
    heading += clamp(turn, -dt * 4.8, dt * 4.8);
    const alignment = Math.max(0, Math.cos(angleDifference(desiredHeading, heading)));
    desiredSpeed = Math.min(5.5 * pace, distance * 2.6) * (0.06 + 0.94 * alignment);
  }
  speed += (desiredSpeed - speed) * (1 - Math.exp(-(desiredSpeed > speed ? 10 : 14) * dt));
  if (speed < 0.015) speed = 0;
  x += Math.sin(heading) * speed * dt;
  z += Math.cos(heading) * speed * dt;
  return constrain(state, { x, z, heading, speed }, dt, obstacles);
}

export function baseline(profile: Profile, state: TractorState, target: Point | null,
  dt: number, obstacles: Obstacle[] = [], rowAssist = true, paceScale = 1) {
  return profile === "web" ? advanceTractor(state, target, dt, obstacles, rowAssist, 0.85 * paceScale)
    : advanceNative(state, target, dt, obstacles, rowAssist, 0.85 * paceScale);
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
    obstacles: Obstacle[] = [], paceScale = 1): TractorState {
    dt = clamp(dt, 0, 0.05);
    let { x, z, heading, speed } = state;
    let desiredSpeed = 0;
    if (input && "drag" in input) {
      // Center and release remove turn immediately. There is no angular inertia.
      const requested = dragAmount(input.drag);
      this.steering = requested === 0 ? 0 : this.steering + (requested - this.steering) * (1 - Math.exp(-tuning.steeringResponse * dt));
      // Heading-positive is screen-left for the +Z forward tractor.
      heading -= this.steering * tuning.turnRate * dt;
      desiredSpeed = 5.5 * 0.85 * (1 - 0.4 * Math.abs(this.steering));
    } else if (input && "target" in input) {
      this.steering = 0;
      const distance = Math.hypot(input.target.x - x, input.target.z - z);
      if (distance > 0.38) {
        const turn = angleDifference(Math.atan2(input.target.x - x, input.target.z - z), heading);
        heading += clamp(turn * (1 - Math.exp(-4 * dt)), -tuning.tapTurnRate * dt, tuning.tapTurnRate * dt);
        const alignment = Math.max(0, Math.cos(turn));
        desiredSpeed = Math.min(5.5 * 0.85 * paceScale, distance * 2.4) * (0.04 + 0.96 * alignment ** 2);
      }
    } else this.steering = 0;
    speed += (desiredSpeed - speed) * (1 - Math.exp(-(desiredSpeed > speed ? tuning.acceleration : tuning.braking) * dt));
    if (speed < 0.015) speed = 0;
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
    return constrain(state, { x, z, heading, speed }, dt, obstacles);
  }
}

export function nearbyRow(requested: number, lanes: number[]) {
  let selected = requested, distance = tuning.rowCapture;
  for (const lane of lanes) {
    for (const candidate of [lane - tuning.rowPitch, lane + tuning.rowPitch]) {
      const error = Math.abs(candidate - requested);
      if (error < distance) { distance = error; selected = candidate; }
    }
  }
  return selected;
}

/** Deliberate, near-cardinal passes only. No autopilot turns or gap completion. */
export class RowGuide {
  lanes: [number[], number[]] = [[], []];
  active: { axis: number; lane: number; heading: number; start: Point } | null = null;
  recorded = false;
  finish(state: TractorState) {
    if (this.active && !this.recorded && Math.hypot(state.x - this.active.start.x, state.z - this.active.start.z) >= 6) {
      this.lanes[this.active.axis].push(this.active.lane);
    }
    this.active = null; this.recorded = false;
  }
  target(state: TractorState, target: Point) {
    const distance = Math.hypot(target.x - state.x, target.z - state.z);
    const desired = Math.atan2(target.x - state.x, target.z - state.z);
    const snapped = Math.round(desired / (Math.PI / 2)) * Math.PI / 2;
    if (this.active && Math.abs(angleDifference(desired, this.active.heading)) > 0.28) this.finish(state);
    if (!this.active && distance > 6 && Math.abs(angleDifference(desired, snapped)) < 0.13
      && Math.abs(angleDifference(state.heading, snapped)) < 0.2) {
      const axis = Math.abs(Math.sin(snapped)) > 0.5 ? 0 : 1;
      const lane = nearbyRow(axis === 0 ? target.z : target.x, this.lanes[axis]);
      this.active = { axis, lane, heading: snapped, start: { x: state.x, z: state.z } };
      this.recorded = false;
    }
    if (!this.active) return target;
    if (!this.recorded && Math.hypot(state.x - this.active.start.x, state.z - this.active.start.z) >= 6) {
      this.lanes[this.active.axis].push(this.active.lane); this.recorded = true;
    }
    return this.active.axis === 0 ? { x: target.x, z: this.active.lane } : { x: this.active.lane, z: target.z };
  }
}

export class FollowCamera {
  heading: number | null = null;
  distance: number | null = null;
  reset() { this.heading = null; this.distance = null; }
  update(tractor: TractorState, dt: number, obstacles: Obstacle[] = [], gentle = false, zoom = 0.65) {
    const previous = this.heading ?? tractor.heading;
    let turn = angleDifference(tractor.heading, previous);
    if (gentle) turn = Math.sign(turn) * Math.max(0, Math.abs(turn) - 1.3 * Math.PI / 180);
    const angle = previous + turn * (1 - Math.exp(-8 * clamp(dt, 0, 0.05)));
    this.heading = Math.atan2(Math.sin(angle), Math.cos(angle));
    const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const center = new THREE.Vector3(tractor.x, 0, tractor.z);
    const boundedZoom = clamp(zoom, 0.65, 1.8), scale = 1 / Math.sqrt(boundedZoom);
    const ahead = Math.max(0, 1.5 - 2 * (boundedZoom - 1));
    const horizontal = 14 * scale + ahead, vertical = 2.2 + 4 * scale - 1.1, tilt = Math.PI / 12;
    const desiredDistance = horizontal * Math.cos(tilt) - vertical * Math.sin(tilt) - ahead;
    const height = 1.1 + horizontal * Math.sin(tilt) + vertical * Math.cos(tilt);
    let distance = desiredDistance;
    for (const obstacle of obstacles) {
      const dx = obstacle.x - tractor.x, dz = obstacle.z - tractor.z;
      const along = -dx * forward.x - dz * forward.z;
      const acrossSquared = Math.max(0, dx * dx + dz * dz - along * along), radius = obstacle.radius + 0.4;
      if (acrossSquared >= radius * radius) continue;
      const halfChord = Math.sqrt(radius * radius - acrossSquared);
      if (along + halfChord <= 0) continue;
      distance = Math.min(distance, Math.max(0.25, along - halfChord));
    }
    // Obstruction clearance takes priority. Ease outward after it clears.
    if (gentle && this.distance !== null && distance > this.distance)
      distance = this.distance + (distance - this.distance) * (1 - Math.exp(-3 * dt));
    this.distance = distance;
    const focusAhead = ahead * Math.min(1, distance / 8);
    return {
      position: center.clone().addScaledVector(forward, -distance).add(new THREE.Vector3(0, height, 0)),
      focus: center.clone().addScaledVector(forward, focusAhead).add(new THREE.Vector3(0, 1.1, 0)),
    };
  }
}

export function followFov(aspect: number) {
  return Math.max(58, 2 * Math.atan(Math.tan(24 * Math.PI / 180) / Math.max(0.1, aspect)) * 180 / Math.PI);
}
export function projectGround(camera: THREE.Camera, x: number, y: number): Point | null {
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
  if (ray.ray.direction.y >= -0.000001) return null;
  const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  if (!point || Math.hypot(point.x - camera.position.x, point.z - camera.position.z) > 180) return null;
  return { x: clamp(point.x, -39, 39), z: clamp(point.z, -30, 28) };
}
