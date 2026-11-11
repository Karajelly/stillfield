import { angleDifference, clamp, fieldAt, fieldColumns, fieldRows } from "./simulation";
import type { FieldBounds } from "./simulation";
import type { Point, Tool, TractorState } from "./simulation";
import { tuning } from "./handling";

export const attachmentOffset = 2.1;
export function attachmentPoint(state: TractorState): Point {
  return { x: state.x - Math.sin(state.heading) * attachmentOffset,
    z: state.z - Math.cos(state.heading) * attachmentOffset };
}

/** The user's ground point stays fixed. Only the vehicle's approach extends past it. */
export class WorkDestination {
  readonly point: Point;
  readonly center: Point;
  readonly cell: number;
  readonly field: FieldBounds;
  readonly corners: Point[];
  private heading: number;
  private routePoint: Point;
  private locked = false;
  private aligning = false;

  static create(point: Point, state: TractorState, tool: Tool): WorkDestination | null {
    const field = fieldAt(point);
    if (tool === "wander" || !field) return null;
    return new WorkDestination(point, state, field);
  }
  private constructor(point: Point, state: TractorState, field: FieldBounds) {
    this.point = { ...point };
    this.field = field;
    const columns = fieldColumns(field);
    const rows = fieldRows(field);
    const col = clamp(Math.floor((point.x - field.minX) / field.cell), 0, columns - 1);
    const row = clamp(Math.floor((point.z - field.minZ) / field.cell), 0, rows - 1);
    this.cell = row * columns + col;
    this.center = { x: field.minX + (col + 0.5) * field.cell, z: field.minZ + (row + 0.5) * field.cell };
    this.corners = [-0.5, 0.5].flatMap(x => [-0.5, 0.5].map(z =>
      ({ x: this.center.x + x * field.cell, z: this.center.z + z * field.cell })));
    const dx = this.center.x - state.x, dz = this.center.z - state.z;
    const along = dx * Math.sin(state.heading) + dz * Math.cos(state.heading);
    const across = dx * Math.cos(state.heading) - dz * Math.sin(state.heading);
    // A click under the tractor's existing swath needs a little forward travel,
    // not a U-turn toward the point the tractor has already passed.
    const underSwath = Math.abs(across) < tuning.brushRadius - field.cell && along >= -attachmentOffset && along < 2;
    this.heading = underSwath ? state.heading : Math.atan2(dx, dz);
    this.routePoint = underSwath
      ? { x: state.x + Math.sin(state.heading) * along, z: state.z + Math.cos(state.heading) * along }
      : { ...this.center };
    this.locked = underSwath;
    this.aligning = !underSwath && Math.hypot(dx, dz) <= 4.5 && Math.abs(angleDifference(this.heading, state.heading)) > 0.3;
  }
  plan(state: TractorState): { target: Point; paceScale: number } {
    const distance = Math.hypot(this.center.x - state.x, this.center.z - state.z);
    // Follow the approach while far away, then keep it stable through the finish.
    // It must never flip when the tractor passes the user's fixed ground point.
    if (this.aligning) {
      this.heading = Math.atan2(this.center.x - state.x, this.center.z - state.z);
      if (Math.abs(angleDifference(this.heading, state.heading)) < 0.1 && state.speed < 0.15) {
        this.aligning = false; this.locked = true;
      }
    } else if (!this.locked && distance > 4.5)
      this.heading = Math.atan2(this.center.x - state.x, this.center.z - state.z);
    else this.locked = true;
    const brush = attachmentPoint(state);
    const remaining = Math.max(0, Math.hypot(brush.x - this.center.x, brush.z - this.center.z)
      - (tuning.brushRadius - this.field.cell * Math.SQRT2 / 2));
    return {
      target: { x: this.routePoint.x + Math.sin(this.heading) * (attachmentOffset + 0.6),
        z: this.routePoint.z + Math.cos(this.heading) * (attachmentOffset + 0.6) },
      paceScale: this.aligning ? 0 : clamp((remaining + 0.4) / 3, 0.2, 1),
    };
  }
  covered(state: TractorState): boolean {
    const brush = attachmentPoint(state);
    const throughEnd = (brush.x - this.routePoint.x) * Math.sin(this.heading)
      + (brush.z - this.routePoint.z) * Math.cos(this.heading);
    return throughEnd >= 0
      && this.corners.every(corner => Math.hypot(corner.x - brush.x, corner.z - brush.z) <= tuning.brushRadius);
  }
  setArrivalHeading(heading: number) {
    this.routePoint = { ...this.point };
    this.heading = heading; this.locked = true; this.aligning = false;
  }
}
