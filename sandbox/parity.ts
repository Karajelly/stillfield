import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceNative, FollowCamera } from "./handling";

const swift = JSON.parse(readFileSync(process.argv[2], "utf8"));
let maxError = 0;
for (const row of swift) {
  const { fps, scenario } = row;
  let tractor = { x: -15, z: -7, heading: Math.PI / 2, speed: 0 };
  const camera = new FollowCamera();
  const obstacles = scenario === 2 ? [{ x: -10, z: -7, radius: 1.2 }] : [];
  let pose = camera.update(tractor, 0);
  for (let frame = 0; frame < fps * 3; frame++) {
    const t = frame / fps;
    const target = t >= 2.4 ? null : scenario === 1 ? { x: -18 + Math.sin(t * 2) * 2, z: -10 }
      : { x: 12, z: -7 + Math.sin(t * 0.7) * 0.4 };
    tractor = advanceNative(tractor, target, 1 / fps, obstacles, true, 0.85);
    pose = camera.update(tractor, 1 / fps, obstacles);
  }
  const actual = [tractor.x, tractor.z, tractor.heading, tractor.speed, ...pose.position.toArray(), ...pose.focus.toArray()];
  const expected = [...row.state, ...row.camera];
  actual.forEach((value, i) => {
    const error = Math.abs(value - expected[i]); maxError = Math.max(error, maxError);
    assert.ok(error < 1e-9, `${fps} fps / scenario ${scenario} / component ${i}: ${value} vs ${expected[i]}`);
  });
}
console.log(`Swift / TypeScript baseline parity passed for ${swift.length} scenarios; max error ${maxError}.`);
