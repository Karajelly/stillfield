import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { FAR_SITE, LANE, LaneRide, laneDestination, laneRoute, viewBlend } from "./farm-map";
import { FarmingEngine, FARMING_CONFIG, Ground, HOME_SITE, cellCount } from "./farming";
import { overviewFraming } from "./overview";
import { FAR_FIELD, FIELD, fieldAt, WORLD } from "./simulation";
import type { Point, TractorState } from "./simulation";
import { TractorNavigation } from "./tractor-navigation";
import { WorkDestination } from "./work-destination";
import { createWorld } from "./world";

const obstacles = createWorld(new THREE.Scene()).obstacles;
const home: TractorState = { x: -4, z: 4.8, heading: -Math.PI / 2, speed: 0 };

function cameraFor(width: number, height: number, blend: number) {
  const aspect = width / height;
  const framing = overviewFraming(aspect, blend);
  const half = framing.vertical / 2;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 300);
  camera.position.copy(framing.position);
  camera.lookAt(framing.focus);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

test("the two fields sit apart inside the world, joined by the lane", () => {
  assert.ok(FAR_FIELD.maxX < FIELD.minX);
  for (const f of [FIELD, FAR_FIELD]) {
    assert.ok(f.minX > WORLD.minX && f.maxX < WORLD.maxX);
    assert.ok(f.minZ > WORLD.minZ && f.maxZ < WORLD.maxZ);
  }
  assert.equal(fieldAt({ x: -70, z: 0 }), FAR_FIELD);
  assert.equal(fieldAt({ x: 0, z: 0 }), FIELD);
  assert.equal(fieldAt({ x: -40, z: -1 }), undefined, "the lane itself is not a field");
  // The lane runs between the two field loops and stays clear of every tree.
  assert.ok(LANE[0].x < FIELD.minX && LANE.at(-1)!.x > FAR_FIELD.maxX);
  for (const p of LANE)
    for (const o of obstacles)
      assert.ok(Math.hypot(p.x - o.x, p.z - o.z) > o.radius + 1.5, `lane at ${p.x} meets an obstacle`);
});

test("the view holds still inside each field and follows along the lane", () => {
  for (let x = FIELD.minX; x <= FIELD.maxX; x += 2.5) assert.equal(viewBlend({ x, z: 0 }), 0);
  for (let x = FAR_FIELD.minX; x <= FAR_FIELD.maxX; x += 2.5) assert.equal(viewBlend({ x, z: 0 }), 1);
  let previous = 0;
  for (let x = FIELD.minX; x >= FAR_FIELD.maxX; x -= 0.5) {
    const blend = viewBlend({ x, z: -1 });
    assert.ok(blend >= previous);
    previous = blend;
  }
  assert.equal(laneDestination(home), FAR_SITE);
  assert.equal(laneDestination({ x: -70, z: 0 }), HOME_SITE);
});

test("each framing fits its field in portrait and landscape without turning the camera", () => {
  for (const [width, height] of [[375, 667], [402, 874], [820, 1180], [874, 402], [1280, 800], [1920, 1080]]) {
    const camera = cameraFor(width, height, 1);
    for (const x of [FAR_FIELD.minX, FAR_FIELD.maxX])
      for (const z of [FAR_FIELD.minZ, FAR_FIELD.maxZ]) {
        const p = new THREE.Vector3(x, 0, z).project(camera);
        assert.ok(Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.65, `${width}×${height} hides a corner`);
      }
    // The keyboard's "up" depends on the camera's angle, which must not change in transit.
    const direction = (blend: number) =>
      cameraFor(width, height, blend).getWorldDirection(new THREE.Vector3());
    assert.ok(direction(0).distanceTo(direction(1)) < 1e-9);
    assert.ok(direction(0).distanceTo(direction(0.5)) < 1e-9);
  }
});

test("the lane is on screen from the home field, so it can be tapped", () => {
  for (const [width, height] of [[402, 874], [874, 402], [1280, 800]]) {
    const camera = cameraFor(width, height, 0);
    const p = new THREE.Vector3(LANE[2].x, 0, LANE[2].z).project(camera);
    assert.ok(Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95, `${width}×${height}`);
  }
});

test("a ride down the lane reaches the other field with the implement lifted", () => {
  const starts: TractorState[] = [
    home,
    { x: 18, z: -6, heading: 0, speed: 0 }, // behind the little meadow mill
    { x: 15, z: 10, heading: Math.PI, speed: 0 },
    { x: -24, z: -11, heading: 0, speed: 0 },
  ];
  for (const start of starts) {
    let state = start;
    const navigation = new TractorNavigation();
    for (const destination of [FAR_SITE, HOME_SITE]) {
      const ride = new LaneRide(destination, state, navigation, obstacles);
      let result = "riding", seconds = 0;
      while (result === "riding" && seconds < 90) {
        const step = navigation.step(state, 1 / 30, "wander", obstacles);
        assert.equal(step.paint.length, 0);
        state = step.state;
        result = ride.update(state, step.blocked);
        seconds += 1 / 30;
      }
      assert.equal(result, "arrived", `from ${start.x},${start.z} to ${destination.id}`);
      assert.equal(fieldAt(state), destination.bounds);
      assert.equal(laneDestination(state).id === destination.id, false);
      assert.ok(seconds < 45, "the ride is unhurried, not endless");
    }
  }
});

test("routes step around anything on the way to the lane", () => {
  const route = laneRoute({ x: 18, z: -5 }, FAR_SITE, obstacles);
  const legs: [Point, Point][] = route.map((p, i) => [i ? route[i - 1] : { x: 18, z: -5 }, p]);
  for (const [a, b] of legs)
    for (const o of obstacles) {
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / (length * length)));
      assert.ok(Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) > o.radius + 0.9);
    }
});

test("Foxglove field keeps its own soil, crops, harvest display, and save", () => {
  const far = new FarmingEngine(undefined, FARMING_CONFIG, true, FAR_SITE);
  assert.equal(far.cells.length, cellCount(FAR_FIELD));
  assert.equal(far.cells.length, 60 * 40);
  assert.ok(far.cells.every((c) => c === Ground.grass), "a new field starts as quiet meadow");
  assert.equal(far.fieldId, "foxglove");
  const events = far.apply({ x: -80, z: 0 }, { x: -64, z: 0 }, "cultivate");
  assert.ok(events.groundChanges.length > 100);
  far.apply({ x: -80, z: 0 }, { x: -64, z: 0 }, "sow", "pumpkins");
  far.rest();
  const harvest = far.apply({ x: -80, z: 0 }, { x: -64, z: 0 }, "harvest");
  assert.equal(harvest.harvestResults[0].fieldId, "foxglove");
  assert.ok(far.display.pumpkins > 0);

  // The home field never sees work done in Foxglove field.
  const homeEngine = new FarmingEngine();
  assert.equal(homeEngine.apply({ x: -80, z: 0 }, { x: -64, z: 0 }, "cultivate").groundChanges.length, 0);

  const restored = new FarmingEngine(far.snapshot(), FARMING_CONFIG, true, FAR_SITE);
  assert.deepEqual(restored.snapshot(), far.snapshot());
  // A home-field save is never mistaken for Foxglove field.
  const mistaken = new FarmingEngine(homeEngine.snapshot(), FARMING_CONFIG, true, FAR_SITE);
  assert.ok(mistaken.cells.every((c) => c === Ground.grass));
  assert.equal(mistaken.display.pumpkins, 0);
});

test("taps in Foxglove field snap to its own grid", () => {
  const destination = WorkDestination.create({ x: -70.1, z: 2.3 }, home, "cultivate")!;
  assert.ok(destination);
  assert.equal(destination.field, FAR_FIELD);
  assert.deepEqual(destination.center, { x: -70.25, z: 2.25 });
  assert.equal(WorkDestination.create({ x: -40, z: -1 }, home, "cultivate"), null);
});
