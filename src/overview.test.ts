import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { overviewFraming } from "./overview";
import { FIELD } from "./simulation";

function cameraFor(width: number, height: number, zoom = 1) {
  const aspect = width / height;
  const framing = overviewFraming(aspect);
  const half = framing.vertical / 2;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 300);
  camera.position.copy(framing.position);
  camera.lookAt(framing.focus);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

test("portrait keeps the working meadow in view and gives its long rows vertical room", () => {
  for (const [width, height] of [[375, 667], [402, 874], [744, 1133], [820, 1180], [1024, 1366]]) {
    const camera = cameraFor(width, height);
    for (const x of [FIELD.minX, FIELD.maxX]) {
      for (const z of [FIELD.minZ, FIELD.maxZ]) {
        const point = new THREE.Vector3(x, 0, z).project(camera);
        assert.ok(Math.abs(point.x) < 0.9, "Leave a visible margin beside the field");
        assert.ok(Math.abs(point.y) < 0.65, "Leave room above and below for controls");
      }
    }
    const start = new THREE.Vector3(FIELD.minX, 0, 0).project(camera);
    const end = new THREE.Vector3(FIELD.maxX, 0, 0).project(camera);
    assert.ok(Math.abs(end.y - start.y) * height > 1.5 * Math.abs(end.x - start.x) * width);
  }
});

test("ground taps agree with the rendered field after rotation and zoom", () => {
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  for (const [width, height] of [[402, 874], [874, 402], [744, 1133], [1133, 744]]) {
    for (const zoom of [0.7, 1, 1.65]) {
      const camera = cameraFor(width, height, zoom);
      for (const point of [new THREE.Vector3(-12, 0, 6), new THREE.Vector3(10, 0, -5)]) {
        const screen = point.clone().project(camera);
        ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
        const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
        assert.ok(hit && hit.distanceTo(point) < 1e-8);
      }
    }
  }
});

test("the established landscape camera is preserved", () => {
  for (const aspect of [1, 1.2, 1.5, 2]) {
    const framing = overviewFraming(aspect);
    assert.deepEqual(framing.position.toArray(), [59, 73, 87]);
    assert.equal(framing.vertical, aspect < 1.35 ? 76 : 66);
  }
});
