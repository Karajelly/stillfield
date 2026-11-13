import * as THREE from "three";
import { daylightAt, holdSeconds } from "../../src/daylight";
import type { DayHold } from "../../src/daylight";
import { TractorFollowCamera } from "../../src/follow-camera";
import type { Obstacle, TractorState } from "../../src/simulation";

/**
 * The game's own renderer settings, lights and cameras, copied from
 * src/main.ts so a study picture and a game picture are lit the same way.
 * If main.ts changes its lights, change them here.
 */
export function createStage(canvas: HTMLCanvasElement, options: { shadows?: number; pixelRatio?: number } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor("#e8ecda");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const sky = new THREE.Color("#e8ecda");
  scene.background = sky;
  scene.fog = new THREE.Fog("#e8ecda", 125, 230);
  const hemi = new THREE.HemisphereLight("#fff8df", "#7c9060", 2.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff1ce", 3.1);
  sun.position.set(-32, 55, 22);
  sun.castShadow = true;
  const size = options.shadows ?? 2048;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.0003;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const focus = new THREE.Vector3(-1, 0, -2);
  const SUN_DISTANCE = 67.4;
  let seconds = 0;

  /** The light of a kept time of day, or of any second of the twelve-minute day. */
  function light(when: DayHold | number) {
    seconds = typeof when === "number" ? when : when === "flow" ? 0 : holdSeconds(when);
    const now = daylightAt(seconds);
    sun.color.setRGB(...now.sun, THREE.SRGBColorSpace);
    sun.intensity = now.sunPower;
    sun.position.set(focus.x + now.sunFrom[0] * SUN_DISTANCE, focus.y + now.sunFrom[1] * SUN_DISTANCE, focus.z + now.sunFrom[2] * SUN_DISTANCE);
    sun.target.position.copy(focus);
    sun.shadow.intensity = now.shadow;
    hemi.color.setRGB(...now.skyLight, THREE.SRGBColorSpace);
    hemi.groundColor.setRGB(...now.groundLight, THREE.SRGBColorSpace);
    hemi.intensity = now.ambient;
    sky.setRGB(...now.sky, THREE.SRGBColorSpace);
    scene.fog!.color.copy(sky);
    renderer.toneMappingExposure = now.exposure;
    return now;
  }
  light("morning");

  return {
    renderer,
    scene,
    sun,
    light,
    /** Shadows stay sharp around whatever the picture is of. */
    lookAt(point: THREE.Vector3) {
      focus.copy(point);
      light(seconds);
    },
    resize(width: number, height: number) {
      renderer.setSize(width, height, false);
    },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
export type Stage = ReturnType<typeof createStage>;

/** The farm view: the game's fixed angle, framed on `focus` and `metres` tall. */
export function farmCamera(focus: THREE.Vector3, metres: number, aspect: number, camera = new THREE.OrthographicCamera()) {
  camera.position.copy(focus).add(new THREE.Vector3(60, 73, 89));
  camera.lookAt(focus);
  camera.left = (-metres * aspect) / 2;
  camera.right = (metres * aspect) / 2;
  camera.top = metres / 2;
  camera.bottom = -metres / 2;
  camera.near = 0.1;
  camera.far = 300;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** Tractor view: the game's level boom behind the tractor. */
export function createFollowCamera() {
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
  const boom = new TractorFollowCamera();
  return {
    camera,
    /** Pass the world's obstacles and the boom stops short of scenery, as it does in the game. */
    update(tractor: TractorState, zoom: number, aspect: number, dt: number, snap = false, obstacles: Obstacle[] = []) {
      camera.aspect = aspect;
      camera.fov = TractorFollowCamera.verticalFieldOfView(aspect);
      camera.updateProjectionMatrix();
      const pose = boom.update(tractor, zoom, dt, obstacles, snap);
      camera.position.copy(pose.position);
      camera.lookAt(pose.focus);
      camera.updateMatrixWorld();
      return camera;
    },
  };
}

/**
 * The game's two birds circle at thirteen metres, over the barn-side plot. A
 * closer framing than the game ever uses catches them as stray grey marks, so
 * the study's pictures leave them out. Nothing else in the world is touched.
 */
export function withoutBirds(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object.name.startsWith("bird-")) object.visible = false;
  });
}
