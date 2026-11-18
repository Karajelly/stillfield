import { fieldNear, LANE_CELLS, laneAt } from "./tidy-rows";
import type { Row } from "./tidy-rows";
import type { Point } from "./simulation";

/** The two tapped squares are inclusive. A square is one implement wide on both axes. */
export function planPlot(anchor: Point, corner: Point, heading: number): Row[] {
  const field = fieldNear(anchor);
  if (!field || fieldNear(corner) !== field) return [];
  const x0 = laneAt("z", anchor, field), x1 = laneAt("z", corner, field);
  const z0 = laneAt("x", anchor, field), z1 = laneAt("x", corner, field);
  const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
  // Run the longer side to keep headland turns to a minimum.
  const horizontal = dx === dz ? Math.abs(Math.sin(heading)) > Math.SQRT1_2 : dx > dz;
  const [start, end, firstLane, lastLane] = horizontal ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const facing = horizontal ? Math.sin(heading) : Math.cos(heading);
  let dir: 1 | -1 = (end === start ? facing >= 0 : end > start) ? 1 : -1;
  let from = start * LANE_CELLS + (dir > 0 ? 0 : LANE_CELLS - 1);
  let to = end * LANE_CELLS + (dir > 0 ? LANE_CELLS - 1 : 0);
  const step = lastLane >= firstLane ? 1 : -1;
  const rows: Row[] = [];
  for (let lane = firstLane; lane !== lastLane + step; lane += step) {
    rows.push({ axis: horizontal ? "x" : "z", lane, from, to, dir, field });
    [from, to] = [to, from];
    dir = dir === 1 ? -1 : 1;
  }
  return rows;
}
