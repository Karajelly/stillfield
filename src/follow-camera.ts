import * as THREE from "three";
import { clamp } from "./simulation";
import { steeringOffset } from "./handling";
import type { Obstacle, TractorState } from "./simulation";

export type CameraMode = "overview" | "tractor";

export const FOLLOW_ZOOM = { default: 0.65, min: 0.65, max: 1.8 };

export interface FollowPose {
  position: THREE.Vector3;
  focus: THREE.Vector3;
}

/**
 * A level, gently turning camera boom. Tractor suspension never moves the camera.
 * Keep in sync with StillfieldCore/TractorFollowCamera.swift.
 */
export class TractorFollowCamera {
  heading: number | null = null;
  distance: number | null = null;

  update(tractor: TractorState, zoom: number, dt: number, obstacles: Obstacle[] = [], snap = false): FollowPose {
    const previous = this.heading ?? tractor.heading;
    let turn = Math.atan2(Math.sin(tractor.heading - previous), Math.cos(tractor.heading - previous));
    // A small quiet zone keeps the horizon still through tiny steering corrections.
    if (!snap) turn = (turn < 0 ? -1 : 1) * Math.max(0, Math.abs(turn) - (1.3 * Math.PI) / 180);
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    const response = snap ? 1 : 1 - Math.exp(-8 * step);
    const angle = previous + turn * response;
    this.heading = Math.atan2(Math.sin(angle), Math.cos(angle));
    const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const center = new THREE.Vector3(tractor.x, 0, tractor.z);
    const boundedZoom = clamp(zoom, FOLLOW_ZOOM.min, FOLLOW_ZOOM.max);
    // A gentler dolly range leaves room for the attachment at close zoom.
    const scale = 1 / Math.sqrt(boundedZoom);
    const lookAhead = Math.max(0, 1.5 - 2 * (boundedZoom - 1));
    const focusHeight = 1.1;
    const horizontal = 14 * scale + lookAhead;
    const vertical = 2.2 + 4 * scale - focusHeight;
    // Raise the boom by 15 degrees around its focus without changing zoom distance.
    const tilt = (15 * Math.PI) / 180;
    const desiredDistance = horizontal * Math.cos(tilt) - vertical * Math.sin(tilt) - lookAhead;
    const cameraHeight = focusHeight + horizontal * Math.sin(tilt) + vertical * Math.cos(tilt);
    let distance = desiredDistance;

    // Stop the boom before scenery, using the same conservative footprints
    // that keep the tractor out of buildings, trees, and the pond.
    for (const obstacle of obstacles) {
      const dx = obstacle.x - tractor.x, dz = obstacle.z - tractor.z;
      const along = -dx * forward.x - dz * forward.z;
      const acrossSquared = Math.max(0, dx * dx + dz * dz - along * along);
      const radius = obstacle.radius + 0.4;
      if (acrossSquared >= radius * radius) continue;
      const halfChord = Math.sqrt(radius * radius - acrossSquared);
      if (along + halfChord <= 0) continue;
      distance = Math.min(distance, Math.max(0.25, along - halfChord));
    }

    // Clear obstructions immediately; ease outward after they leave the boom.
    if (!snap && this.distance !== null && distance > this.distance)
      distance = this.distance + (distance - this.distance) * (1 - Math.exp(-3 * step));
    this.distance = distance;

    // In a tight space, look down toward the tractor instead of past it.
    const focusAhead = lookAhead * Math.min(1, distance / 8);
    return {
      position: center.clone().addScaledVector(forward, -distance).setY(cameraHeight),
      focus: center.clone().addScaledVector(forward, focusAhead).setY(focusHeight),
    };
  }

  /** Preserve enough horizontal room for the attachment on narrow phones. */
  static verticalFieldOfView(aspect: number) {
    const safe = Number.isFinite(aspect) ? Math.max(0.1, aspect) : 1;
    return Math.max(58, (2 * Math.atan(Math.tan((24 * Math.PI) / 180) / safe) * 180) / Math.PI);
  }
}

/**
 * Tractor view's touch and mouse gesture. A tap that stays put chooses a destination;
 * moving more than 8 px starts rolling, and the sideways offset from where you
 * pressed sets the direction to hold, relative to where the tractor faced then.
 * There is no hold timer: only movement turns a tap into driving.
 */
export class SteeringGesture {
  readonly origin: { x: number; y: number };
  location: { x: number; y: number };
  moved = false;
  constructor(x: number, y: number, readonly startHeading: number) {
    this.origin = { x, y };
    this.location = { x, y };
  }
  update(x: number, y: number) {
    this.location = { x, y };
    this.moved ||= Math.hypot(x - this.origin.x, y - this.origin.y) > 8;
  }
  get drag() { return this.location.x - this.origin.x; }
  /** Drag right to turn right. Heading-positive is screen-left for the +Z forward tractor. */
  get heading() { return this.startHeading - steeringOffset(this.drag); }
}
