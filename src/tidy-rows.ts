import {
  FIELD,
  FIELDS,
  angleDifference,
  cellsUnderSweep,
  clamp,
  fieldColumns,
  fieldRows,
  WORLD,
} from "./simulation";
import type { FieldBounds, Obstacle, Point, TractorState } from "./simulation";
import { tuning } from "./handling";
import { attachmentOffset, attachmentPoint } from "./work-destination";

/**
 * Tidy rows: the field is divided into lanes one implement wide, and a tap
 * asks for a whole row along one of them. The tractor drives to the lane with
 * its implement lifted, then works exactly that lane's cells from where it
 * stood to where the player tapped. Rows therefore sit side by side with no
 * slivers, no overlap onto a neighbour, and nothing worked on the way there.
 */
export type Axis = "x" | "z";

export interface Row {
  /** The direction the row runs. */
  axis: Axis;
  /** Which lane across the field, counted from its minimum edge. */
  lane: number;
  /** First and last cell along the row, both worked. */
  from: number;
  to: number;
  /** +1 toward the field's maximum, -1 toward its minimum. */
  dir: 1 | -1;
  /** The field the row belongs to. Left out for the home field. */
  field?: FieldBounds;
}
/** Each field has its own lanes; a row or lane without one is in the home field. */
export const fieldOf = (row: { field?: FieldBounds }) => row.field ?? FIELD;
/** Tag a row with its field, leaving home-field rows exactly as they were. */
const inField = <T extends object>(value: T, f: FieldBounds): T =>
  f === FIELD ? value : { ...value, field: f };

export const LANE_CELLS = Math.round((tuning.brushRadius * 2) / FIELD.cell);
export const LANE_WIDTH = LANE_CELLS * FIELD.cell;
/** A tap just past the field's edge still means its outermost cells. */
export const EDGE_REACH = 2;
/** How far inside a lane's edge a tap can still be read as its neighbour. */
const LANE_SLACK = 0.7;

const other = (axis: Axis): Axis => (axis === "x" ? "z" : "x");
const alongOf = (axis: Axis, p: Point) => (axis === "x" ? p.x : p.z);
const acrossOf = (axis: Axis, p: Point) => (axis === "x" ? p.z : p.x);
const alongMin = (axis: Axis, f = FIELD) => (axis === "x" ? f.minX : f.minZ);
const acrossMin = (axis: Axis, f = FIELD) => (axis === "x" ? f.minZ : f.minX);
const pointAt = (axis: Axis, along: number, across: number): Point =>
  axis === "x" ? { x: along, z: across } : { x: across, z: along };

export const alongCells = (axis: Axis, f = FIELD) =>
  axis === "x" ? fieldColumns(f) : fieldRows(f);
export const laneCount = (axis: Axis, f = FIELD) =>
  Math.floor((axis === "x" ? fieldRows(f) : fieldColumns(f)) / LANE_CELLS);
export const laneCentre = (axis: Axis, lane: number, f = FIELD) =>
  acrossMin(axis, f) + (lane + 0.5) * LANE_WIDTH;
export const cellCentre = (axis: Axis, cell: number, f = FIELD) =>
  alongMin(axis, f) + (cell + 0.5) * f.cell;
export const laneAt = (axis: Axis, p: Point, f = FIELD) =>
  clamp(
    Math.floor((acrossOf(axis, p) - acrossMin(axis, f)) / LANE_WIDTH),
    0,
    laneCount(axis, f) - 1,
  );
export const cellAt = (axis: Axis, p: Point, f = FIELD) =>
  clamp(
    Math.floor((alongOf(axis, p) - alongMin(axis, f)) / f.cell),
    0,
    alongCells(axis, f) - 1,
  );
export const rowHeading = (axis: Axis, dir: number) =>
  axis === "x" ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
/** Where a row finishes: the centre of its last cell, on the lane's centre line. */
export const rowEnd = (row: Row): Point =>
  pointAt(
    row.axis,
    cellCentre(row.axis, row.to, fieldOf(row)),
    laneCentre(row.axis, row.lane, fieldOf(row)),
  );

/** The field a point is in, or just beside. */
export function fieldNear(p: Point, reach = EDGE_REACH): FieldBounds | undefined {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return undefined;
  return FIELDS.find(
    (f) =>
      p.x >= f.minX - reach &&
      p.x <= f.maxX + reach &&
      p.z >= f.minZ - reach &&
      p.z <= f.maxZ + reach,
  );
}
export function nearField(p: Point, reach = EDGE_REACH) {
  return fieldNear(p, reach) !== undefined;
}
/** The closest field to a point, wherever it is. Ties go to the home field. */
export function nearestField(p: Point): FieldBounds {
  let best = FIELD,
    distance = Infinity;
  for (const f of FIELDS) {
    const d = Math.hypot(
      Math.max(f.minX - p.x, 0, p.x - f.maxX),
      Math.max(f.minZ - p.z, 0, p.z - f.maxZ),
    );
    if (d < distance) {
      best = f;
      distance = d;
    }
  }
  return best;
}

/** The ground a row covers from `from` to its end, for drawing it. */
export function rowRect(row: Row, from = row.from) {
  const f = fieldOf(row);
  const a = Math.min(from, row.to),
    b = Math.max(from, row.to);
  const length = (b - a + 1) * f.cell,
    centre = pointAt(
      row.axis,
      alongMin(row.axis, f) + ((a + b + 1) / 2) * f.cell,
      laneCentre(row.axis, row.lane, f),
    );
  return {
    ...centre,
    width: row.axis === "x" ? length : LANE_WIDTH,
    depth: row.axis === "x" ? LANE_WIDTH : length,
  };
}

/** The lane's full width of field cells at each step from `a` to `b` along a row. */
export function rowCells(row: Row, a = row.from, b = row.to): number[] {
  const cells: number[] = [],
    step = b >= a ? 1 : -1,
    first = row.lane * LANE_CELLS,
    columns = fieldColumns(fieldOf(row));
  for (let along = a; along !== b + step; along += step)
    for (let across = first; across < first + LANE_CELLS; across++)
      cells.push(
        row.axis === "x"
          ? across * columns + along
          : along * columns + across,
      );
  return cells;
}

/**
 * Rows keep running the way the tractor faces, unless the tap is well off to
 * one side: then a row across is the shorter, more natural job.
 */
function chooseAxis(state: TractorState, brush: Point, tap: Point): Axis {
  const dx = Math.abs(tap.x - brush.x),
    dz = Math.abs(tap.z - brush.z);
  const quarter = Math.round(state.heading / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(angleDifference(state.heading, quarter)) >= 0.35)
    return dx >= dz ? "x" : "z";
  const facing: Axis = Math.abs(Math.sin(state.heading)) > 0.5 ? "x" : "z";
  const along = facing === "x" ? dx : dz,
    across = facing === "x" ? dz : dx;
  return across > 1.5 * LANE_WIDTH && along < 0.5 * across
    ? other(facing)
    : facing;
}

export interface PlanOptions {
  /** Work every lane between the implement and the tap, not only the tapped one. */
  fill?: boolean;
  /** The row most recently finished, so new rows can line their ends up with it. */
  last?: Row | null;
  /** Whether the current tool would change a cell of a field. Lets a fill skip idle lanes. */
  workable?: (cell: number, field: FieldBounds) => boolean;
}

/**
 * Turn a tap into rows. A row starts beside the implement and ends at the
 * tapped cell, in the tapped lane. Ends settle onto the field's edge or the
 * last row's ends when the tap is close to them, so blocks come out square.
 */
export function planRows(
  state: TractorState,
  tap: Point,
  options: PlanOptions = {},
): Row[] {
  const f = fieldNear(tap);
  if (!f) return [];
  const brush = attachmentPoint(state);
  const axis = chooseAxis(state, brush, tap),
    cells = alongCells(axis, f);
  const nearest = (cell: number, reach: number, anchors: number[]) => {
    let best = cell,
      distance = reach + 1;
    for (const anchor of anchors) {
      const d = Math.abs(anchor - cell);
      if (d <= reach && d < distance) {
        best = anchor;
        distance = d;
      }
    }
    return best;
  };
  // Only a row in this same field can line the new one up.
  const last =
    options.last && fieldOf(options.last) === f ? options.last : null;
  const ends = last?.axis === axis ? [last.from, last.to] : [];
  const to = nearest(cellAt(axis, tap, f), 3, [0, cells - 1, ...ends]);
  const from = nearest(cellAt(axis, brush, f), 2, ends);
  const facing =
    axis === "x" ? Math.sin(state.heading) : Math.cos(state.heading);
  const dir: 1 | -1 = to > from ? 1 : to < from ? -1 : facing >= 0 ? 1 : -1;
  const row = (lane: number): Row => inField({ axis, lane, from, to, dir }, f);
  const hasWork = (lane: number) =>
    !options.workable ||
    rowCells(row(lane)).some((cell) => options.workable!(cell, f));
  let tapLane = laneAt(axis, tap, f);
  if (!options.fill) {
    // A tap near a lane's edge may have been meant for its neighbour. Prefer
    // the lane with something to do, then the one beside the last row.
    const within =
      acrossOf(axis, tap) - acrossMin(axis, f) - tapLane * LANE_WIDTH;
    const beside =
      within < LANE_SLACK
        ? tapLane - 1
        : within > LANE_WIDTH - LANE_SLACK
          ? tapLane + 1
          : tapLane;
    if (
      beside !== tapLane &&
      beside >= 0 &&
      beside < laneCount(axis, f) &&
      hasWork(beside)
    ) {
      const follows = (lane: number) =>
        last?.axis === axis && Math.abs(lane - last.lane) === 1;
      if (!hasWork(tapLane) || (follows(beside) && !follows(tapLane)))
        tapLane = beside;
    }
    return [row(tapLane)];
  }

  const startLane = laneAt(axis, brush, f),
    step = tapLane >= startLane ? 1 : -1;
  let rows: Row[] = [];
  for (let lane = startLane; lane !== tapLane + step; lane += step)
    rows.push(row(lane));
  const busy = rows.filter((planned) => hasWork(planned.lane));
  rows = busy.length ? busy : rows.slice(-1);
  // Back and forth, each row starting at the end the last one finished on.
  return rows.map((planned, index) =>
    index % 2
      ? { ...planned, from: to, to: from, dir: -dir as 1 | -1 }
      : planned,
  );
}

const STRAIGHT_LOOK = 2.6,
  ARC_LOOK = 0.9;
/** How far the deck's leading edge works ahead of the implement's centre. */
const DECK_REACH = 0.75;
/** Cells a row may pick up behind the deck once it is back on its lane. */
const CATCH_UP = 4;
/** Room kept beyond the tractor's own clearance when passing an obstacle. */
const PASSING_ROOM = 0.9 + 0.35;

/**
 * Waypoints that carry a straight leg around anything standing on it, by the
 * shorter way round. A row through the meadow's mill bends past and carries on.
 */
function around(a: Point, b: Point, obstacles: Obstacle[]): Point[] {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];
  const crossings: { t: number; points: Point[] }[] = [];
  for (const obstacle of obstacles) {
    const radius = obstacle.radius + PASSING_ROOM;
    const along = ((obstacle.x - a.x) * dx + (obstacle.z - a.z) * dz) / length;
    const off = ((obstacle.x - a.x) * dz - (obstacle.z - a.z) * dx) / length;
    if (Math.abs(off) >= radius - 0.05) continue;
    const half = Math.sqrt(radius * radius - off * off);
    const enter = along - half,
      leave = along + half;
    // A leg that starts or ends inside the circle cannot be routed clear of it.
    if (enter <= 0 || leave >= length) continue;
    const at = (d: number) => ({
      x: a.x + (dx * d) / length,
      z: a.z + (dz * d) / length,
    });
    const from = at(enter),
      to = at(leave);
    const start = Math.atan2(from.x - obstacle.x, from.z - obstacle.z);
    const sweep = angleDifference(
      Math.atan2(to.x - obstacle.x, to.z - obstacle.z),
      start,
    );
    const points: Point[] = [from];
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.3));
    for (let i = 1; i < steps; i++) {
      const angle = start + (sweep * i) / steps;
      points.push({
        x: obstacle.x + Math.sin(angle) * radius,
        z: obstacle.z + Math.cos(angle) * radius,
      });
    }
    points.push(to);
    crossings.push({ t: enter, points });
  }
  return crossings
    .sort((p, q) => p.t - q.t)
    .flatMap((crossing) => crossing.points);
}

/** Radius of the turn back along a lane: the tractor's tightest comfortable circle. */
const TURN_BACK_RADIUS = LANE_WIDTH / 2;

/**
 * Turning back along the tractor's own lane: a half circle out to one side,
 * so the tractor turns that way from the very first moment, then the lane is
 * rejoined from beside it. It turns toward the side the player tapped; a tap
 * on the centre line turns toward the middle of the field, where there is
 * more room. Returns no points when neither side is clear, leaving the plain
 * approach.
 */
function turnBack(
  state: TractorState,
  row: Row,
  f: FieldBounds,
  hint: Point | undefined,
  obstacles: Obstacle[],
): Point[] {
  // Forward along the lane the way the tractor faces, and the tractor's left.
  const back = rowHeading(row.axis, row.dir);
  const fx = -Math.sin(back),
    fz = -Math.cos(back);
  const lx = fz,
    lz = -fx;
  const leftOf = (p: Point) => (p.x - state.x) * lx + (p.z - state.z) * lz;
  const middle = { x: (f.minX + f.maxX) / 2, z: (f.minZ + f.maxZ) / 2 };
  const tapped = hint ? leftOf(hint) : 0;
  const preferred =
    Math.abs(tapped) > 0.15
      ? Math.sign(tapped)
      : Math.sign(leftOf(middle)) || 1;
  const r = TURN_BACK_RADIUS;
  const build = (side: number): Point[] => {
    const points: Point[] = [];
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * Math.PI,
        along = r * Math.sin(a),
        aside = side * r * (1 - Math.cos(a));
      points.push({
        x: state.x + fx * along + lx * aside,
        z: state.z + fz * along + lz * aside,
      });
    }
    return points;
  };
  const clear = (points: Point[]) =>
    points.every(
      (p) =>
        p.x > WORLD.minX + 0.2 &&
        p.x < WORLD.maxX - 0.2 &&
        p.z > WORLD.minZ + 0.2 &&
        p.z < WORLD.maxZ - 0.2 &&
        obstacles.every((o) => Math.hypot(p.x - o.x, p.z - o.z) >= o.radius + 1.05),
    );
  for (const side of [preferred, -preferred]) {
    const points = build(side);
    if (clear(points)) return points;
  }
  return [];
}

/** One row in progress: the way to it, and the cells worked so far. */
export class TidyRun {
  readonly row: Row;
  /** The last cell along the row already worked, once work has begun. */
  workedTo: number | null = null;
  /** Whether the implement is down: on its row, not on the way to it. */
  lowered = false;
  private points: Point[];
  private look: number[];
  private segment = 0;
  private finished = false;
  private lastBrush: Point | null = null;
  private readonly obstacles: Obstacle[];
  /** Cells under something standing in the field. Nothing grows through a mill. */
  private readonly covered = new Set<number>();

  private readonly field: FieldBounds;

  /**
   * `hint` is where the player tapped. When the row means turning back along
   * the tractor's own lane, it says which way to swing round.
   */
  constructor(
    row: Row,
    state: TractorState,
    obstacles: Obstacle[] = [],
    hint?: Point,
  ) {
    this.row = { ...row };
    this.obstacles = obstacles;
    const f = (this.field = fieldOf(row));
    for (const obstacle of obstacles)
      for (const cell of cellsUnderSweep(
        obstacle,
        obstacle,
        obstacle.radius - 0.2,
        f,
      ))
        this.covered.add(cell);
    const { axis, dir } = row,
      heading = rowHeading(axis, dir),
      centre = laneCentre(axis, row.lane, f);
    const brush = attachmentPoint(state);
    const across = acrossOf(axis, state) - centre,
      turn = angleDifference(state.heading, heading);
    const first = cellCentre(axis, row.from, f);
    this.points = [{ x: state.x, z: state.z }];
    this.look = [STRAIGHT_LOOK];
    const aligned =
      Math.abs(across) <= 0.35 &&
      Math.abs(turn) <= 0.2 &&
      (first - alongOf(axis, brush)) * dir >= -0.75;
    // After turning round on the spot, the implement trails ahead of the
    // tractor's old position, so the row must begin further on than that.
    const canTurnRound =
      Math.abs(Math.abs(turn) - Math.PI) <= 0.3 &&
      Math.abs(across) >= 1.5 &&
      Math.abs(across) <= 2.2 * LANE_WIDTH &&
      (first - alongOf(axis, state)) * dir >= 0.5 - attachmentOffset;
    if (canTurnRound) {
      // A half circle onto the neighbouring lane, facing back the way it came.
      const forward = {
        x: Math.sin(state.heading),
        z: Math.cos(state.heading),
      };
      const abeam = pointAt(axis, alongOf(axis, state), centre);
      const sx = abeam.x - state.x,
        sz = abeam.z - state.z,
        radius = Math.hypot(sx, sz) / 2;
      for (let i = 1; i <= 16; i++) {
        const a = (i / 16) * Math.PI;
        this.points.push({
          x:
            state.x +
            forward.x * radius * Math.sin(a) +
            (sx / 2) * (1 - Math.cos(a)),
          z:
            state.z +
            forward.z * radius * Math.sin(a) +
            (sz / 2) * (1 - Math.cos(a)),
        });
        this.look.push(ARC_LOOK);
      }
    } else if (!aligned) {
      // Join the lane with the implement a little short of the first cell.
      const join = pointAt(axis, first + (attachmentOffset - 1.25) * dir, centre);
      // Heading back along its own lane, the join point sits dead astern, where
      // "the shorter way round" is a coin toss. Turn round deliberately instead.
      const behind =
        Math.abs(Math.abs(turn) - Math.PI) <= 0.6 &&
        Math.abs(across) < 1.5 &&
        (alongOf(axis, join) - alongOf(axis, state)) * dir > 1;
      const loop = behind ? turnBack(state, row, f, hint, obstacles) : [];
      for (const point of loop) {
        this.points.push(point);
        this.look.push(ARC_LOOK);
      }
      this.points.push(join);
      this.look.push(STRAIGHT_LOOK);
    }
    this.points.push(this.finish());
    this.look.push(STRAIGHT_LOOK);
    this.clear(1);
  }

  /** Bend every straight leg from `first` on around the obstacles in its way. */
  private clear(first: number) {
    const points = this.points.slice(0, first),
      look = this.look.slice(0, first);
    for (let i = first; i < this.points.length; i++) {
      if (this.look[i] === STRAIGHT_LOOK)
        for (const point of around(
          this.points[i - 1],
          this.points[i],
          this.obstacles,
        )) {
          points.push(point);
          look.push(ARC_LOOK);
        }
      points.push(this.points[i]);
      look.push(this.look[i]);
    }
    this.points = points;
    this.look = look;
  }

  /** Where the tractor is headed once the row is done: past its end, on the lane. */
  private finish(): Point {
    const { axis, dir } = this.row;
    return pointAt(
      axis,
      cellCentre(axis, this.row.to, this.field) + (attachmentOffset + 1.6) * dir,
      laneCentre(axis, this.row.lane, this.field),
    );
  }

  get started() {
    return this.workedTo !== null;
  }
  get done() {
    return this.finished;
  }

  /** Move the row's end along its lane. Cells already worked stay worked. */
  retarget(cell: number) {
    const { dir } = this.row;
    const limit = this.workedTo ?? this.row.from;
    this.row.to = (cell - limit) * dir >= 0 ? cell : limit;
    // Rebuild the last leg from wherever the route has reached.
    const kept = Math.min(this.segment + 1, this.points.length - 1);
    this.points = [...this.points.slice(0, kept), this.finish()];
    this.look = [...this.look.slice(0, kept), STRAIGHT_LOOK];
    this.clear(kept);
  }

  /** The point to steer toward, and how gently to arrive at the row's end. */
  guide(state: TractorState): { target: Point; paceScale: number } {
    const last = this.points.length - 1;
    // Progress only moves forward, so a tight turn cannot double back.
    let best = this.segment,
      bestT = 0,
      bestDistance = Infinity;
    for (let i = this.segment; i < Math.min(last, this.segment + 4); i++) {
      const a = this.points[i],
        b = this.points[i + 1];
      const dx = b.x - a.x,
        dz = b.z - a.z,
        lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared
        ? clamp(
            ((state.x - a.x) * dx + (state.z - a.z) * dz) / lengthSquared,
            0,
            1,
          )
        : 1;
      const d = Math.hypot(a.x + dx * t - state.x, a.z + dz * t - state.z);
      if (d < bestDistance - 1e-9) {
        best = i;
        bestT = t;
        bestDistance = d;
      }
    }
    this.segment = best;
    // Walk the look-ahead distance along the route from the closest point.
    let remaining = this.look[Math.min(last, best + 1)],
      index = best,
      t = bestT,
      target = this.points[last];
    while (index < last) {
      const a = this.points[index],
        b = this.points[index + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z),
        left = length * (1 - t);
      if (remaining <= left && length > 0) {
        const u = t + remaining / length;
        target = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
        break;
      }
      remaining -= left;
      index++;
      t = 0;
    }
    const { axis, dir } = this.row;
    const toGo =
      (cellCentre(axis, this.row.to, this.field) -
        alongOf(axis, attachmentPoint(state))) *
      dir;
    return { target, paceScale: clamp((toGo + 0.5) / 3, 0.25, 1) };
  }

  /** The cells the deck has just passed over, a full lane width at a time. */
  work(state: TractorState): number[] {
    const cells = this.passed(state);
    return this.covered.size
      ? cells.filter((cell) => !this.covered.has(cell))
      : cells;
  }

  private passed(state: TractorState): number[] {
    const { axis, dir } = this.row;
    const brush = attachmentPoint(state),
      previous = this.lastBrush ?? brush;
    this.lastBrush = brush;
    this.lowered = false;
    if (this.finished) return [];
    const f = this.field;
    const centre = laneCentre(axis, this.row.lane, f);
    const onLane =
      Math.abs(acrossOf(axis, brush) - centre) <= 1 &&
      Math.abs(angleDifference(state.heading, rowHeading(axis, dir))) <= 0.6;
    const along = alongOf(axis, brush);
    this.lowered =
      (onLane || this.workedTo !== null) &&
      (along - cellCentre(axis, this.row.from, f)) * dir >= -0.9 &&
      (cellCentre(axis, this.row.to, f) - along) * dir >= -0.6;
    if (!onLane) {
      // Bending past an obstacle, the deck still works whatever part of the
      // row it actually crosses. Getting to a row, it works nothing.
      if (this.workedTo === null) return [];
      const first = this.row.lane * LANE_CELLS;
      const columns = fieldColumns(f);
      return cellsUnderSweep(previous, brush, tuning.brushRadius, f).filter(
        (cell) => {
          const column = cell % columns,
            line = Math.floor(cell / columns);
          const along = axis === "x" ? column : line,
            across = axis === "x" ? line : column;
          return (
            across >= first &&
            across < first + LANE_CELLS &&
            (along - this.workedTo!) * dir > 0 &&
            (this.row.to - along) * dir >= 0
          );
        },
      );
    }
    // The furthest cell whose centre the deck's leading edge has reached.
    const reach =
      (alongOf(axis, brush) + DECK_REACH * dir - alongMin(axis, f)) / f.cell -
      0.5;
    const passed = dir > 0 ? Math.floor(reach) : Math.ceil(reach);
    const upTo = (passed - this.row.to) * dir > 0 ? this.row.to : passed;
    let start = this.workedTo === null ? this.row.from : this.workedTo + dir;
    // Ground the deck was carried around stays as it was.
    if (this.workedTo !== null && (upTo - start) * dir > CATCH_UP)
      start = upTo - CATCH_UP * dir;
    let cells: number[] = [];
    if ((upTo - start) * dir >= 0) {
      cells = rowCells(this.row, start, upTo);
      this.workedTo = upTo;
    }
    this.finished =
      this.workedTo === this.row.to &&
      (alongOf(axis, brush) - cellCentre(axis, this.row.to, f)) * dir >= -0.1;
    return cells;
  }
}

/** The lane a keyboard-driven tractor is working, and how far along it has got. */
export interface LaneProgress {
  axis: Axis;
  lane: number;
  dir: 1 | -1;
  cell: number;
  /** Left out for the home field. */
  field?: FieldBounds;
}

/**
 * Keyboard rows use the same lanes. `settle` eases the tractor onto the centre
 * of the lane it is in, and `laneWork` returns that lane's cells as the deck
 * passes, so a row driven by hand lines up with one asked for by a tap.
 */
export function laneFor(
  state: TractorState,
): { axis: Axis; lane: number; dir: 1 | -1; field?: FieldBounds } | null {
  const f = nearestField(state);
  const axis: Axis = Math.abs(Math.sin(state.heading)) > 0.5 ? "x" : "z";
  const across = acrossOf(axis, state) - acrossMin(axis, f);
  if (across < 0 || across >= laneCount(axis, f) * LANE_WIDTH) return null;
  const facing =
    axis === "x" ? Math.sin(state.heading) : Math.cos(state.heading);
  return inField(
    {
      axis,
      lane: Math.floor(across / LANE_WIDTH),
      dir: (facing >= 0 ? 1 : -1) as 1 | -1,
    },
    f,
  );
}

export function settle(state: TractorState, dt: number): TractorState {
  const lane = laneFor(state);
  if (!lane || state.speed <= 0.1) return state;
  const offset =
    laneCentre(lane.axis, lane.lane, fieldOf(lane)) - acrossOf(lane.axis, state);
  const shift = offset * (1 - Math.exp(-5 * dt));
  return lane.axis === "x"
    ? { ...state, z: state.z + shift }
    : { ...state, x: state.x + shift };
}

export function laneWork(
  state: TractorState,
  progress: LaneProgress | null,
): { cells: number[]; progress: LaneProgress | null; field: FieldBounds } {
  const lane = laneFor(state);
  if (!lane) return { cells: [], progress: null, field: nearestField(state) };
  const f = fieldOf(lane);
  const { axis, dir } = lane,
    brush = attachmentPoint(state),
    count = alongCells(axis, f);
  const reach =
    (alongOf(axis, brush) + DECK_REACH * dir - alongMin(axis, f)) / f.cell -
    0.5;
  const passed = dir > 0 ? Math.floor(reach) : Math.ceil(reach);
  const same =
    progress &&
    progress.axis === axis &&
    progress.lane === lane.lane &&
    progress.dir === dir &&
    fieldOf(progress) === f;
  // A fresh lane starts under the deck; nothing behind it is worked.
  const start = same ? progress.cell + dir : passed;
  const row: Row = { ...lane, from: start, to: passed };
  const first = clamp(start, 0, count - 1),
    last = clamp(passed, 0, count - 1);
  const inside =
    (passed - start) * dir >= 0 &&
    (dir > 0
      ? passed >= 0 && start <= count - 1
      : passed <= count - 1 && start >= 0);
  return {
    field: f,
    cells: inside ? rowCells(row, first, last) : [],
    progress: {
      ...lane,
      cell: same && (passed - progress.cell) * dir < 0 ? progress.cell : passed,
    },
  };
}
