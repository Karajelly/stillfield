import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { FOLLOW_ZOOM, SteeringGesture, TractorFollowCamera } from "./follow-camera";
import type { TractorState } from "./simulation";

const tractorAt = (heading: number, x = 0, z = 0): TractorState => ({ x, z, heading, speed: 0 });
const viewports: [number, number][] = [[402, 874], [874, 402], [744, 1133], [1133, 744], [1440, 900]];
const zooms = [FOLLOW_ZOOM.min, 1, FOLLOW_ZOOM.max];

function perspective(width: number, height: number, follow: TractorFollowCamera, tractor: TractorState, zoom: number, dt = 0, snap = true) {
  const pose = follow.update(tractor, zoom, dt, [], snap);
  const camera = new THREE.PerspectiveCamera(TractorFollowCamera.verticalFieldOfView(width / height), width / height, 0.1, 300);
  camera.position.copy(pose.position);
  camera.lookAt(pose.focus);
  camera.updateMatrixWorld();
  return camera;
}

test("the follow camera stays level behind the tractor at every heading and zoom", () => {
  for (let heading = -Math.PI; heading <= Math.PI; heading += Math.PI / 4) {
    for (const zoom of zooms) {
      const tractor = tractorAt(heading, 18, -12);
      const pose = new TractorFollowCamera().update(tractor, zoom, 0, [], true);
      const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      const offset = pose.position.clone().sub(new THREE.Vector3(tractor.x, 0, tractor.z));
      assert.ok(offset.dot(forward) < -6);
      assert.ok(Math.abs(offset.x * forward.z - offset.z * forward.x) < 1e-6);
      assert.ok(pose.position.y > 4);
      assert.ok(pose.focus.clone().sub(new THREE.Vector3(tractor.x, 0, tractor.z)).dot(forward) >= 0);
    }
  }
});

test("the tractor and its implement stay framed above the tool dock", () => {
  for (const [width, height] of viewports) {
    for (const zoom of zooms) {
      const camera = perspective(width, height, new TractorFollowCamera(), tractorAt(0), zoom);
      // Roof, wheels, and the rear implement's outer bounds.
      for (const [x, y, z] of [[-0.9, 2.8, -1.2], [0.9, 2.8, 0.5], [-1.1, 0, -0.8], [1.1, 0, 1.5], [-1.4, 0.1, -2.6], [1.4, 0.8, -2.6]]) {
        const v = new THREE.Vector3(x, y, z).project(camera);
        const screenX = (v.x + 1) / 2, screenY = (1 - v.y) / 2;
        assert.ok(screenX > 0.1 && screenX < 0.9, `x ${screenX} at ${width}×${height}, zoom ${zoom}`);
        assert.ok(screenY > 0.18 && screenY < 0.74, `y ${screenY} at ${width}×${height}, zoom ${zoom}`);
      }
    }
  }
});

test("the camera turns the short way across ±π at the same rate for 30, 60, and 120 Hz", () => {
  const results = [30, 60, 120].map((fps) => {
    const camera = new TractorFollowCamera();
    camera.update(tractorAt(Math.PI - 0.1), 1, 0, [], true);
    for (let i = 0; i < fps / 2; i++) {
      camera.update(tractorAt(-Math.PI + 0.1), 1, 1 / fps);
      assert.ok(Math.abs(camera.heading!) > 3);
    }
    return camera.heading!;
  });
  assert.ok(Math.abs(results[0] - results[1]) < 1e-6);
  assert.ok(Math.abs(results[1] - results[2]) < 1e-6);
  assert.ok(Math.abs(results[0] - (-Math.PI + 0.1)) < 0.027); // Includes the 1.3° quiet zone.
});

test("the boom stops before scenery, then eases back to full distance", () => {
  const tractor = tractorAt(0);
  const wall = { x: 0, z: -8, radius: 2 };
  const camera = new TractorFollowCamera();
  const pose = camera.update(tractor, 1, 0, [wall], true);
  assert.ok(Math.abs(pose.position.z + 5.6) < 1e-6);
  assert.ok(pose.position.y > pose.focus.y);
  const first = camera.update(tractor, 1, 1 / 60);
  assert.ok(first.position.z < pose.position.z && first.position.z > -6);
  let restored = first;
  for (let i = 0; i < 240; i++) restored = camera.update(tractor, 1, 1 / 60);
  const unobstructed = new TractorFollowCamera().update(tractor, 1, 0, [], true);
  assert.ok(Math.abs(restored.position.z - unobstructed.position.z) < 1e-4);
  const retracted = camera.update(tractor, 1, 1 / 60, [wall]);
  assert.ok(Math.abs(retracted.position.z + 5.6) < 1e-6);
});

test("ground taps round-trip through the rendered, lagging perspective camera", () => {
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  for (const [width, height] of viewports) {
    for (const zoom of zooms) {
      for (const heading of [-3.1, -1.5, 0, 2.8]) {
        const follow = new TractorFollowCamera();
        follow.update(tractorAt(heading - 0.2), zoom, 0, [], true);
        const camera = perspective(width, height, follow, tractorAt(heading), zoom, 1 / 60, false);
        for (const lateral of [-2, 0, 2]) {
          const ground = new THREE.Vector3(
            Math.sin(heading) * 8 + Math.cos(heading) * lateral, 0,
            Math.cos(heading) * 8 - Math.sin(heading) * lateral,
          );
          const ndc = ground.clone().project(camera);
          assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1);
          raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          assert.ok(raycaster.ray.intersectPlane(plane, hit));
          assert.ok(hit.distanceTo(ground) < 1e-4);
        }
      }
    }
  }
});

test("narrow screens widen the field of view; wide screens keep a calm 58°", () => {
  assert.equal(TractorFollowCamera.verticalFieldOfView(16 / 9), 58);
  assert.ok(TractorFollowCamera.verticalFieldOfView(402 / 874) > 80);
  assert.equal(TractorFollowCamera.verticalFieldOfView(Number.NaN), 58);
});

test("a quick tap chooses a destination; holding or moving starts steering", () => {
  const tap = new SteeringGesture(100, 200, 10);
  tap.update(104, 203);
  assert.equal(tap.isDriving(10.2), false);
  assert.equal(tap.isDriving(10.23), true);
  const drag = new SteeringGesture(100, 200, 10);
  drag.update(140, 200);
  assert.equal(drag.isDriving(10.01), true);
  assert.equal(drag.drag, 40);
  drag.update(100, 200);
  assert.equal(drag.moved, true, "returning to center still steers straight");
  assert.equal(drag.drag, 0);
});
