import { advanceTractor, angleDifference, clamp } from "./simulation";
import type { Obstacle, Point, Tool, TractorState } from "./simulation";
import { GentleDrive } from "./handling";
import { attachmentPoint, WorkDestination } from "./work-destination";
import { alignmentForTap, EndTurn, WorkedRows } from "./row-end";
import { advanceGridTractor } from "./keyboard-navigation";
import type { GridInput } from "./keyboard-navigation";

/** Destination work and row-end arrivals, independent of rendering and input events. */
export class TractorNavigation {
  target: Point | null = null;
  work: WorkDestination | null = null;
  rows = new WorkedRows();
  turn: EndTurn | null = null;
  gridTurning = false;
  private aligning = false;
  private painting = true;
  private lastBrush: Point | null = null;
  private blockedTime = 0;
  private drive = new GentleDrive();

  cancel() {
    this.target = null; this.work = null; this.turn = null;
    this.aligning = false; this.painting = false; this.lastBrush = null;
    this.blockedTime = 0; this.drive.reset();
    this.gridTurning = false;
  }
  choose(point: Point, state: TractorState, tool: Tool, obstacles: Obstacle[]) {
    const previousBrush = this.painting ? this.lastBrush : null;
    this.cancel();
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
    this.target = { ...point }; this.painting = true;
    this.lastBrush = previousBrush;
    this.work = WorkDestination.create(point, state, tool);
    const alignment = this.work ? alignmentForTap(this.rows.last, state, point, obstacles) : null;
    if (alignment) {
      this.turn = new EndTurn(state, alignment); this.aligning = true; this.painting = false; this.lastBrush = null;
    }
  }
  changeTool(state: TractorState, tool: Tool, obstacles: Obstacle[]) {
    this.lastBrush = null;
    if (this.target && (!this.aligning || tool === "wander")) this.choose(this.target, state, tool, obstacles);
  }
  step(state: TractorState, dt: number, tool: Tool, obstacles: Obstacle[], pace = 0.85,
    manual: { target: Point } | { drag: number } | { grid: GridInput } | null = null, follow = false) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    const paint: Point[] = [];
    let completed = false, blocked = false;
    const sweep = () => {
      if (tool === "wander") { this.lastBrush = null; return; }
      const point = attachmentPoint(state), from = this.lastBrush ?? point;
      paint.push(from, point);
      this.lastBrush = point;
    };
    const finish = () => {
      sweep();
      this.rows.finish(this.work!.point, state);
      this.cancel(); completed = true;
    };
    if (manual) {
      this.target = null; this.work = null; this.turn = null; this.aligning = false; this.painting = true;
    }
    if (!this.turn && this.work?.covered(state)) finish();
    const previous = state, plan = this.turn ? null : this.work?.plan(state);
    const target = plan?.target ?? this.target;
    this.gridTurning = false;
    if (this.turn) {
      state = this.turn.step(state, dt, obstacles);
      if (this.turn.blocked) { this.cancel(); blocked = true; }
      else if (this.turn.done) {
        this.work?.setArrivalHeading(this.turn.alignment.heading);
        this.turn = null; this.painting = true; this.lastBrush = null;
      }
    } else if (manual && "grid" in manual) {
      this.gridTurning = Math.abs(angleDifference(manual.grid.heading, state.heading)) > 1e-8;
      this.painting = !this.gridTurning && manual.grid.driving;
      if (!this.painting) this.lastBrush = null;
      else this.lastBrush ??= attachmentPoint(state);
      state = advanceGridTractor(state, manual.grid, dt, obstacles, pace);
    } else if (follow) {
      state = this.drive.step(state, dt, manual ?? (target ? { target } : null), obstacles, plan?.paceScale ?? 1, pace);
    } else {
      const destination = manual && "target" in manual ? manual.target : target;
      state = advanceTractor(state, destination, dt, obstacles, false, pace, plan?.paceScale ?? 1);
    }
    this.rows.sample(state, this.painting && tool !== "wander" && state.speed > 0.1);
    if (!this.turn && this.work?.covered(state)) finish();
    else if (!this.work && this.target && Math.hypot(this.target.x - state.x, this.target.z - state.z) < 0.5) {
      this.target = null;
    }
    if (!this.turn && this.target && plan?.paceScale !== 0 && state.speed < 0.15
      && Math.hypot(state.x - previous.x, state.z - previous.z) < 0.003
      && Math.abs(angleDifference(state.heading, previous.heading)) < dt * 0.1) {
      this.blockedTime += dt;
      if (this.blockedTime > 1) { this.cancel(); blocked = true; }
    } else this.blockedTime = 0;
    if (this.painting && state.speed > 0.1) sweep();
    if (state.speed === 0) this.lastBrush = null;
    return { state, paint, completed, blocked };
  }
}
