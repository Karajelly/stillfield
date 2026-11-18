import assert from "node:assert/strict";
import { it } from "node:test";
import { FIELD, FAR_FIELD, fieldColumns } from "./simulation";
import { planPlot } from "./plot";
import { fieldOf, rowCells } from "./tidy-rows";

it("marks the same flush square from either corner, including at either field's edge", () => {
  for (const field of [FIELD, FAR_FIELD]) {
    const a = { x: field.maxX + 0.4, z: field.maxZ + 0.2 };
    const b = { x: field.maxX - 3, z: field.maxZ - 3 };
    const columns = fieldColumns(field);
    const cells = columns * (field.maxZ - field.minZ) / field.cell;
    const expected = new Set<number>();
    for (let row = 0; row < 10; row++)
      for (let col = 0; col < 10; col++) expected.add(cells - 1 - row * columns - col);
    for (const [anchor, corner] of [[a, b], [b, a]]) {
      for (const heading of [0, Math.PI / 2]) {
        const rows = planPlot(anchor, corner, heading);
        assert.equal(rows.length, 2);
        assert.ok(rows.every((r) => fieldOf(r) === field));
        assert.equal(rows[0].to, rows[1].from);
        assert.deepEqual(new Set(rows.flatMap((r) => rowCells(r))), expected);
      }
    }
    assert.equal(rowCells(planPlot(a, a, 0)[0]).length, 25);
  }
  assert.deepEqual(planPlot({ x: 0, z: 0 }, { x: -80, z: 0 }, 0), []);
});
