import { attachmentOffset, attachmentPoint } from "./work-destination";
import { cellCentre, DECK_REACH, fieldOf, LANE_CELLS, LANE_WIDTH, laneWork, manualCorner } from "./tidy-rows";
import type { LaneProgress, Row } from "./tidy-rows";
import type { Obstacle, TractorState } from "./simulation";

export interface MatchedPass {
  row: Row;
  phase: "approach" | "working" | "finished";
}

function samePass(a: Row, b: Row) {
  return fieldOf(a) === fieldOf(b) && a.axis === b.axis && a.dir === b.dir && a.lane === b.lane;
}

/** Distance until the deck's leading edge reaches the final cell centre. */
export function remainingPass(row: Row, state: TractorState) {
  return (cellCentre(row.axis, row.to, fieldOf(row)) - attachmentPoint(state)[row.axis]) * row.dir - DECK_REACH;
}

/** Remembers actual strips emitted by the deck, including their first and last cells. */
export class ManualPasses {
  private previous: Row | null = null;
  private travel = 0;
  private progress: LaneProgress | null = null;
  private canExtend = false;
  match: MatchedPass | null = null;

  clear() {
    this.previous = null;
    this.travel = 0;
    this.match = null;
    this.progress = null;
    this.canExtend = false;
  }

  lift(released: boolean) {
    this.progress = null;
    if (released && this.match?.phase === "finished") this.canExtend = true;
  }

  moved(distance: number) {
    if (!this.previous) return;
    this.travel += distance;
    // Allow room for a semicircle and the length of the hitch on both sides.
    // A trip away from the headland starts a fresh pass.
    if (this.travel > Math.PI * LANE_WIDTH + 2 * attachmentOffset) this.clear();
  }

  preview(lane: Row, state: TractorState): MatchedPass | null {
    if (this.match && samePass(this.match.row, lane)) {
      // A detour can rejoin beyond the stop. There is no row left ahead then.
      if (this.match.phase !== "finished" && remainingPass(this.match.row, state) < -2 * DECK_REACH) return null;
      return this.match;
    }
    const old = this.previous;
    if (!old || fieldOf(old) !== fieldOf(lane) || old.axis !== lane.axis
      || old.dir === lane.dir || Math.abs(old.lane - lane.lane) !== 1
      || Math.abs(old.to - old.from) + 1 < LANE_CELLS) return null;
    const field = fieldOf(old);
    const acrossEnd = (attachmentPoint(state)[old.axis] - cellCentre(old.axis, old.to, field)) * old.dir;
    // Accept a normal headland turnaround. If the deck has already passed
    // the entry by more than its own reach, this is a new independent stroke.
    if (acrossEnd < -DECK_REACH || acrossEnd > 2 * attachmentOffset + LANE_WIDTH) return null;
    return { row: { ...lane, from: old.to, to: old.from }, phase: "approach" };
  }

  acquire(lane: Row, state: TractorState) {
    // Keep the flags and confirmation visible after the driver lets go.
    // Starting forward again in that lane deliberately extends the strip.
    const extending = this.canExtend && this.match && samePass(this.match.row, lane);
    this.match = extending ? null : this.preview(lane, state);
    this.canExtend = false;
    return this.match;
  }

  work(lane: Row, state: TractorState, obstacles: Obstacle[]) {
    const old = this.previous;
    const matched = this.match;
    const prior = old && { ...old, cell: old.to };
    const corner = !matched && prior && this.travel <= LANE_WIDTH * 1.5
      ? manualCorner(prior, lane, state, obstacles) : null;
    let progress = corner?.progress ?? this.progress;
    if (matched && !progress) {
      // After a lift the deck can only touch its current footprint. An early
      // release resumes smoothly, while a detour leaves the skipped soil alone.
      const field = fieldOf(lane);
      const behind = attachmentPoint(state)[lane.axis] - lane.dir * DECK_REACH;
      const index = (behind - cellCentre(lane.axis, 0, field)) / field.cell;
      const trailing = lane.dir > 0 ? Math.ceil(index) : Math.floor(index);
      const next = old && samePass(old, lane) ? old.to + lane.dir : matched.row.from;
      const first = (trailing - next) * lane.dir > 0 ? trailing : next;
      progress = { ...lane, cell: first - lane.dir };
    }
    const work = laneWork(state, progress, lane, matched?.row);
    this.progress = work.progress;
    const strip = work.strip;
    if (strip) {
      // Keep the original start across frame boundaries and brief pauses.
      const contiguous = old && samePass(old, strip)
        && (strip.from - old.to) * strip.dir <= 1 && (strip.to - old.from) * strip.dir >= 0;
      this.previous = contiguous ? { ...old, to: (strip.to - old.to) * strip.dir > 0 ? strip.to : old.to } : strip;
      this.travel = 0;
      if (matched) matched.phase = strip.to === matched.row.to ? "finished" : "working";
    }
    return {
      cells: corner && strip ? [...corner.tail, ...work.cells] : work.cells,
      lowered: matched ? matched.phase === "working" : !corner || !!strip,
    };
  }
}
