import { advanceTractor, angleDifference, clamp } from "./simulation";
import type { Obstacle, Point, Tool, TractorState } from "./simulation";
import { GentleDrive } from "./handling";
import type { DriveKeys } from "./handling";
import { attachmentOffset, attachmentPoint, WorkDestination } from "./work-destination";
import { alignmentForTap, EndTurn, WorkedRows } from "./row-end";
import { advanceGridTractor } from "./keyboard-navigation";
import type { GridInput } from "./keyboard-navigation";
import { constrain } from "./handling";
import { DECK_REACH, TidyRun, cellAt, fieldNear, fieldOf, laneAt, laneCentre, nearField, planRows, previewManualRow, rowEnd, rowHeading, settle } from "./tidy-rows";
import { FIELD } from "./simulation";
import type { FieldBounds } from "./simulation";
import { ManualPasses, remainingPass } from "./manual-passes";
import type { Row } from "./tidy-rows";

export interface ChooseOptions {
  /** A drag steers freely; only taps ask for tidy rows. */
  freehand?: boolean;
  /** Work every lane up to the tap instead of the tapped lane alone. */
  fill?: boolean;
  /** Whether the current tool would change a cell of a field, so a fill can skip idle lanes. */
  workable?: (cell: number, field: FieldBounds) => boolean;
}

/** Destination work and row-end arrivals, independent of rendering and input events. */
export class TractorNavigation {
  target: Point | null = null;
  work: WorkDestination | null = null;
  rows = new WorkedRows();
  turn: EndTurn | null = null;
  gridTurning = false;
  /** Taps ask for whole rows on the field's lanes. Off keeps the original free approach. */
  tidy = false;
  /** The row being driven to or worked. */
  run: TidyRun | null = null;
  /** The row most recently finished, so the next can line up with its ends. */
  lastRow: Row | null = null;
  private pending: Row[] = [];
  /** Taps made while a row was under way, in the order they will be worked. */
  private queue: { point: Point; fill: boolean }[] = [];
  /** The rows those taps are expected to become, for showing what is planned. */
  private preview: Row[] = [];
  private workable: ((cell: number, field: FieldBounds) => boolean) | undefined;
  private passes = new ManualPasses();
  get matchedPass() { return this.passes.match; }
  previewReturn(lane: Row, state: TractorState) { return this.passes.preview(lane, state); }
  manualLane(state: TractorState, requested = state.heading, control: "drive" | "drag" = "drive") {
    const lane = previewManualRow(state, requested, this.manualRow);
    if (lane) return lane;
    // A driver coming out of a U-turn can straighten a little early or late.
    // Only offer the wider angle when the worked edge identifies the next lane.
    const candidate = previewManualRow(state, requested, this.manualRow, control);
    return candidate && this.previewReturn(candidate, state) ? candidate : null;
  }
  /** What a hand-driven pass will cover from the deck to the field edge. */
  manualRow: Row | null = null;
  private handDriving = false;
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
    this.manualRow = null; this.handDriving = false; this.passes.clear();
    this.run = null; this.pending = []; this.queue = []; this.preview = [];
  }
  /** Rows still to come, the one in progress first. */
  get plannedRows(): Row[] { return this.run ? [this.run.row, ...this.pending, ...this.preview] : []; }
  get hasQueued() { return this.queue.length > 0; }
  /** The implement rides up on the way to a row, between rows, and when travelling. */
  get lifted() {
    if (this.handDriving) return !this.painting;
    return this.run ? !this.run.lowered : this.tidy && !!this.target && !this.work && !this.painting;
  }
  choose(point: Point, state: TractorState, tool: Tool, obstacles: Obstacle[], options: ChooseOptions = {}) {
    if (this.tidy && !options.freehand && tool !== "wander"
      && Number.isFinite(point.x) && Number.isFinite(point.z)) {
      if (options.workable) this.workable = options.workable;
      this.chooseTidy(point, state, !!options.fill, obstacles);
      return;
    }
    const previousBrush = this.painting ? this.lastBrush : null;
    this.cancel(); this.lastRow = null;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
    this.target = { ...point }; this.painting = true;
    this.lastBrush = previousBrush;
    this.work = WorkDestination.create(point, state, tool);
    const alignment = this.work ? alignmentForTap(this.rows.last, state, point, obstacles) : null;
    if (alignment) {
      this.turn = new EndTurn(state, alignment); this.aligning = true; this.painting = false; this.lastBrush = null;
    }
  }
  private chooseTidy(point: Point, state: TractorState, fill: boolean, obstacles: Obstacle[]) {
    const inside = nearField(point);
    if (this.run && inside) {
      // A row that has been asked for is never dropped by another tap. One in
      // its own lane moves its end; one anywhere else joins the list behind it.
      const row = this.run.row, field = fieldOf(row);
      const laneOf = (p: Point) => (fieldNear(p) === field ? laneAt(row.axis, p, field) : -1);
      const lane = laneOf(point);
      if (lane === row.lane && !fill) {
        this.run.retarget(cellAt(row.axis, point, field));
        this.target = rowEnd(this.run.row);
      } else {
        // Tapping a lane that is already waiting replaces what was asked of it.
        this.queue = this.queue.filter(waiting => lane < 0 || laneOf(waiting.point) !== lane);
        this.queue.push({ point: { ...point }, fill });
        this.target = { ...point };
      }
      this.foresee();
      return;
    }
    const last = this.lastRow;
    this.cancel(); this.lastRow = last;
    if (!inside) {
      // Beyond the field there is nothing to work: leave any rows and travel
      // there with the implement up.
      this.target = { ...point }; this.painting = false;
      return;
    }
    this.begin(planRows(state, point, { fill, last: this.lastRow, workable: this.workable }), state, obstacles, point);
  }
  /** Work out the rows the waiting taps will become, from where each will start. */
  private foresee() {
    this.preview = [];
    let last = this.pending.at(-1) ?? this.run?.row;
    for (const waiting of this.queue) {
      if (!last) break;
      const end = rowEnd(last), heading = rowHeading(last.axis, last.dir);
      const rows = planRows({ x: end.x + Math.sin(heading) * attachmentOffset,
        z: end.z + Math.cos(heading) * attachmentOffset, heading, speed: 0 },
        waiting.point, { fill: waiting.fill, last, workable: this.workable });
      this.preview.push(...rows);
      last = rows.at(-1) ?? last;
    }
  }
  /** A marked plot replaces the previous destination with the rows shown in its preview. */
  choosePlot(rows: Row[], state: TractorState, obstacles: Obstacle[]) {
    if (!rows.length) return;
    this.cancel();
    this.lastRow = null;
    this.begin([...rows], state, obstacles);
  }
  /** `tap` says which way to swing round when a row turns back along its own lane. */
  private begin(rows: Row[], state: TractorState, obstacles: Obstacle[], tap?: Point) {
    const first = rows.shift();
    if (!first) return;
    this.run = new TidyRun(first, state, obstacles, tap);
    this.pending = rows;
    // The ring marks the corner that was asked for: the tapped lane, at the tapped cell.
    this.target = rowEnd({ ...(rows.at(-1) ?? first), to: first.to });
  }
  changeTool(state: TractorState, tool: Tool, obstacles: Obstacle[]) {
    this.lastBrush = null;
    this.manualRow = null; this.handDriving = false; this.passes.clear();
    // A row in progress carries on with the new tool; wandering simply drives on.
    if (this.run && tool !== "wander") return;
    // Travelling with the implement up stays that way.
    if (this.tidy && !this.work && tool !== "wander") { this.painting = false; return; }
    if (this.target && (!this.aligning || tool === "wander")) this.choose(this.target, state, tool, obstacles, { freehand: true });
  }
  private stepTidy(state: TractorState, dt: number, tool: Tool, obstacles: Obstacle[], pace: number, follow: boolean) {
    const run = this.run!, previous = state;
    const guide = run.guide(state);
    state = follow
      ? this.drive.step(state, dt, { target: guide.target }, obstacles, guide.paceScale, pace)
      : advanceTractor(state, guide.target, dt, obstacles, false, pace, guide.paceScale);
    const cells = tool === "wander" ? [] : run.work(state);
    let completed = false, blocked = false;
    if (run.done) {
      this.lastRow = { ...run.row };
      this.blockedTime = 0;
      const next = this.pending.shift(), waiting = next ? undefined : this.queue.shift();
      if (next) this.run = new TidyRun(next, state, obstacles);
      else if (waiting) {
        const queue = this.queue;
        this.cancel(); this.queue = queue;
        this.begin(planRows(state, waiting.point, { fill: waiting.fill, last: this.lastRow, workable: this.workable }), state, obstacles, waiting.point);
        this.foresee();
        if (queue.length) this.target = { ...queue.at(-1)!.point };
      } else { this.cancel(); completed = true; }
    } else if (guide.paceScale > 0 && state.speed < 0.15 && Math.hypot(state.x - previous.x, state.z - previous.z) < 0.003
      && Math.abs(angleDifference(state.heading, previous.heading)) < dt * 0.1) {
      this.blockedTime += dt;
      if (this.blockedTime > 1) { this.cancel(); blocked = true; }
    } else this.blockedTime = 0;
    return { state, paint: [] as Point[], cells, field: fieldOf(run.row), completed, blocked };
  }
  private stepManualRows(state: TractorState, dt: number, obstacles: Obstacle[], pace: number,
    input: { grid: GridInput } | { keys: DriveKeys } | { heading: number }) {
    this.handDriving = true;
    this.lastBrush = null;
    const before = state;
    let requested: number | null;
    if ("grid" in input) requested = input.grid.driving ? input.grid.heading : null;
    else if ("keys" in input) requested = input.keys.throttle > 0 && input.keys.steer === 0 ? state.heading : null;
    else requested = input.heading;
    const control = "heading" in input ? "drag" : "drive";
    const row = requested === null ? null : this.manualLane(state, requested, control);
    const heading = row ? rowHeading(row.axis, row.dir) : state.heading;
    this.gridTurning = "grid" in input && Math.abs(angleDifference(input.grid.heading, state.heading)) > 1e-8;
    const match = row && !this.gridTurning ? this.passes.acquire(row, state) : null;
    const stopIn = match ? remainingPass(match.row, state) + 0.001 : Infinity;
    if (match?.phase === "finished") {
      state = { ...state, speed: 0 };
    } else if ("grid" in input) {
      state = advanceGridTractor(state, input.grid, dt, obstacles, pace, stopIn);
    } else if (row && Math.abs(angleDifference(heading, state.heading)) <= 0.009) {
      this.drive.reset();
      state = advanceGridTractor({ ...state, heading }, { heading, driving: true }, dt, obstacles, pace, stopIn);
    } else {
      state = this.drive.step(state, dt, row ? { heading } : input, obstacles, 1, pace);
    }
    this.manualRow = row && !this.gridTurning ? row : null;
    this.painting = false;
    let cells: number[] = [];
    const field = row ? fieldOf(row) : FIELD;
    if (this.manualRow && state.speed > 0.1) {
      state = constrain(before, settle(state, dt, this.manualRow), dt, obstacles);
      this.manualRow = previewManualRow(state, heading, this.manualRow, match ? control : undefined);
    }
    const travelled = Math.hypot(state.x - before.x, state.z - before.z);
    this.passes.moved(travelled);
    // Releasing just before the stop may let the lifted deck coast onto the
    // last cell. A fresh forward input can lower it there at zero speed.
    const atUnfinishedEnd = match && match.phase !== "finished" && stopIn <= 0;
    if (this.manualRow && (state.speed > 0.1 || travelled > 0 || atUnfinishedEnd) && dt > 0) {
      const brush = attachmentPoint(state);
      const lane = this.manualRow;
      const across = lane.axis === "x" ? brush.z : brush.x;
      if (nearField(brush, DECK_REACH) && Math.abs(across - laneCentre(lane.axis, lane.lane, field)) <= 1) {
        const work = this.passes.work(lane, state, obstacles);
        cells = work.cells;
        this.painting = work.lowered;
        if (match?.phase === "finished") state = { ...state, speed: 0 };
      }
    }
    if (!this.painting) this.passes.lift(requested === null);
    return { state, cells, field, paint: [] as Point[], completed: false, blocked: false };
  }
  step(state: TractorState, dt: number, tool: Tool, obstacles: Obstacle[], pace = 0.85,
    manual: { target: Point } | { heading: number } | { keys: DriveKeys } | { grid: GridInput } | null = null, follow = false) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    if (manual) { this.run = null; this.pending = []; this.queue = []; this.preview = []; this.lastRow = null; }
    if (this.run) return this.stepTidy(state, dt, tool, obstacles, pace, follow);
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
    if (this.tidy && tool !== "wander" && manual && ("grid" in manual || (follow && !("target" in manual)))) {
      return this.stepManualRows(state, dt, obstacles, pace, manual);
    }
    if (this.handDriving) {
      // Releasing the controls lifts the deck as the tractor coasts, so the
      // last rectangular cells never acquire a round freehand brush mark.
      this.manualRow = null;
      this.passes.lift(!manual);
      this.painting = !!manual;
      this.handDriving = this.tidy && !manual && tool !== "wander";
      if (!this.handDriving) this.passes.clear();
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
    if (this.handDriving) this.passes.moved(Math.hypot(state.x - previous.x, state.z - previous.z));
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
    return { state, paint, cells: [] as number[], field: FIELD, completed, blocked };
  }
}
