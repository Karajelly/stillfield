import * as THREE from "three";
import { Ground } from "../../src/farming";
import type { Crop } from "../../src/farming";
import type { DayHold } from "../../src/daylight";
import { createFollowCamera, createStage, farmCamera, withoutBirds } from "./stage";
import { createFarmScene, FieldPlan } from "./farm-scene";
import type { FarmScene, Look } from "./farm-scene";
import { plantUniforms } from "./plant-material";
import { createYard } from "./yard";

/**
 * A capture surface for stills. A script describes a field, chooses a look and
 * a camera, and asks for a frame. Used to make the study's pictures and to
 * check the proposed plants against the shipping ones under the same light.
 */
const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
let stage = createStage(canvas, { pixelRatio: 1 });
let farm: FarmScene | null = null;
let plan = new FieldPlan();
let camera: THREE.Camera = farmCamera(new THREE.Vector3(-1, 0, -2), 66, 1.6);
const follow = createFollowCamera();
let yard: ReturnType<typeof createYard> | null = null;

const api = {
  /** Start a new field description. */
  plan() {
    plan = new FieldPlan();
    return true;
  },
  starter() {
    plan = FieldPlan.starter();
    return true;
  },
  stubble(x0: number, x1: number, z0: number, z1: number, crop: Crop) {
    plan.stubble(x0, x1, z0, z1, crop);
    return true;
  },
  display(wheat: number, sunflowers: number, pumpkins: number) {
    Object.assign(plan.display, { wheat, sunflowers, pumpkins });
    return true;
  },
  ground(x0: number, x1: number, z0: number, z1: number, state: keyof typeof Ground) {
    plan.ground(x0, x1, z0, z1, Ground[state]);
    return true;
  },
  plant(x0: number, x1: number, z0: number, z1: number, crop: Crop, progress: number) {
    plan.plant(x0, x1, z0, z1, crop, progress);
    return true;
  },
  /** Build the scene with one look. Replaces whatever was there. */
  build(look: Look, light: DayHold = "morning", width = 1440, height = 900, pixelRatio = 1) {
    stage.dispose();
    // A canvas keeps its first WebGL context, so each scene gets a new one.
    const current = document.querySelector<HTMLCanvasElement>("#stage")!;
    const fresh = current.cloneNode() as HTMLCanvasElement;
    current.replaceWith(fresh);
    stage = createStage(fresh, { pixelRatio });
    stage.resize(width, height);
    fresh.style.width = `${width}px`;
    fresh.style.height = `${height}px`;
    stage.light(light);
    yard = null;
    farm = createFarmScene(stage, { look, plan, motion: false });
    withoutBirds(stage.scene);
    farm.hideTractor();
    plantUniforms.uBreeze.value = 0;
    return farm.fieldTriangles();
  },
  light(light: DayHold) {
    stage.light(light);
    return true;
  },
  /** Stand the proposed yard by the lane as it would be after this many squares of each crop. */
  yard(wheat: number, sunflowers: number, pumpkins: number) {
    yard ??= createYard(stage.scene);
    yard.set({ wheat, sunflowers, pumpkins });
    return true;
  },
  /** The farm view, `metres` tall, looking at a point on the ground. */
  farm(x: number, z: number, metres: number) {
    const size = stage.renderer.getSize(new THREE.Vector2());
    const focus = new THREE.Vector3(x, 0, z);
    camera = farmCamera(focus, metres, size.x / size.y);
    stage.lookAt(focus);
    return true;
  },
  /** Tractor view, with the tractor standing where a player would have driven it. */
  tractor(x: number, z: number, heading: number, zoom = 0.65, tool = "harvest") {
    const size = stage.renderer.getSize(new THREE.Vector2());
    const state = { x, z, heading, speed: 0 };
    farm!.tractor.group.visible = true;
    farm!.placeTractor(state, tool as never);
    camera = follow.update(state, zoom, size.x / size.y, 0, true);
    stage.lookAt(new THREE.Vector3(x, 0, z));
    return true;
  },
  /** Stand the tractor somewhere without moving the camera. */
  park(x: number, z: number, heading: number, tool = "wander") {
    farm!.tractor.group.visible = true;
    farm!.placeTractor({ x, z, heading, speed: 0 }, tool as never);
    return true;
  },
  /** A free camera, for close studies no player camera reaches. */
  free(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 30) {
    const size = stage.renderer.getSize(new THREE.Vector2());
    const view = new THREE.PerspectiveCamera(fov, size.x / size.y, 0.1, 300);
    view.position.set(px, py, pz);
    view.lookAt(tx, ty, tz);
    view.updateMatrixWorld();
    camera = view;
    stage.lookAt(new THREE.Vector3(tx, 0, tz));
    return true;
  },
  time(seconds: number, breeze = 0, gustFront: number | null = null) {
    plantUniforms.uBreeze.value = breeze;
    farm?.study?.update(0, seconds, gustFront);
    return true;
  },
  frame() {
    stage.renderer.render(stage.scene, camera);
    return (document.querySelector("#stage") as HTMLCanvasElement).toDataURL("image/png");
  },
  info() {
    return { triangles: farm?.fieldTriangles() ?? 0, calls: stage.renderer.info.render.calls, drawn: stage.renderer.info.render.triangles };
  },
};
Object.assign(window, { __shots: api });
export type ShotsApi = typeof api;
