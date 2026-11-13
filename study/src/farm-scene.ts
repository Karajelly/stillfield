import * as THREE from "three";
import { createWorld } from "../../src/world";
import { createField } from "../../src/field";
import { createTractor } from "../../src/tractor";
import { CROPS, FARMING_CONFIG, FarmingEngine, Ground, HOME_SITE } from "../../src/farming";
import type { Crop, FarmSnapshot, FieldSite } from "../../src/farming";
import { fieldColumns, fieldRows } from "../../src/simulation";
import type { FieldBounds, Tool, TractorState } from "../../src/simulation";
import { createStudyField } from "./study-field";
import type { StudyField } from "./study-field";
import type { Stage } from "./stage";
import { createReaper } from "./reaper";

/** Describe a field in world metres, then hand it to either renderer. */
export class FieldPlan {
  readonly cells: number[];
  readonly crops: number[];
  readonly progress: number[];
  readonly display: Record<Crop, number> = { wheat: 0, sunflowers: 0, pumpkins: 0 };
  /** What each square of stubble used to be; the shipping engine does not keep this. */
  readonly stubbleCrop: number[];
  private readonly columns: number;
  constructor(readonly site: FieldSite = HOME_SITE) {
    this.columns = fieldColumns(site.bounds);
    const count = this.columns * fieldRows(site.bounds);
    this.cells = Array(count).fill(Ground.grass);
    this.crops = Array(count).fill(0);
    this.progress = Array(count).fill(0);
    this.stubbleCrop = Array(count).fill(0);
  }
  /** Start from the farm a new player is given. */
  static starter() {
    const plan = new FieldPlan();
    const snapshot = new FarmingEngine(undefined, FARMING_CONFIG, true, HOME_SITE).snapshot();
    plan.cells.splice(0, plan.cells.length, ...snapshot.cells);
    plan.crops.splice(0, plan.crops.length, ...snapshot.crops);
    plan.progress.splice(0, plan.progress.length, ...snapshot.progress);
    return plan;
  }
  /** A harvested rectangle that remembers its crop. */
  stubble(x0: number, x1: number, z0: number, z1: number, crop: Crop) {
    this.ground(x0, x1, z0, z1, Ground.stubble);
    this.each(x0, x1, z0, z1, (i) => (this.stubbleCrop[i] = CROPS.indexOf(crop) + 1));
    return this;
  }
  private each(x0: number, x1: number, z0: number, z1: number, visit: (cell: number) => void) {
    const b = this.site.bounds;
    for (let z = z0 + b.cell / 2; z < z1; z += b.cell)
      for (let x = x0 + b.cell / 2; x < x1; x += b.cell) {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        visit(Math.floor((z - b.minZ) / b.cell) * this.columns + Math.floor((x - b.minX) / b.cell));
      }
  }
  ground(x0: number, x1: number, z0: number, z1: number, state: number) {
    this.each(x0, x1, z0, z1, (i) => {
      this.cells[i] = state;
      this.crops[i] = 0;
      this.progress[i] = 0;
    });
    return this;
  }
  /** Plant a rectangle at a point in its life: 0 just sown, 1 ripe. */
  plant(x0: number, x1: number, z0: number, z1: number, crop: Crop, progress: number) {
    this.each(x0, x1, z0, z1, (i) => {
      this.cells[i] = progress >= 1 ? Ground.mature : Ground.growing;
      this.crops[i] = CROPS.indexOf(crop) + 1;
      this.progress[i] = Math.min(1, Math.max(0, progress));
    });
    return this;
  }
  snapshot(): FarmSnapshot {
    return {
      version: 3, fieldId: this.site.id, displayLocation: { ...this.site.displayLocation },
      cells: [...this.cells], crops: [...this.crops], progress: [...this.progress], display: { ...this.display },
    };
  }
}

export type Look = "today" | "proposed";

/** A small working field of its own, for demos that only need a few lanes. */
export function plot(bounds: Omit<FieldBounds, "cell">, display = { x: bounds.maxX + 3, z: bounds.minZ - 3 }): FieldSite {
  return { id: "study-plot", bounds: { ...bounds, cell: 0.5 }, displayLocation: display, original: false };
}

/**
 * The farm with one field drawn either by the shipping renderer (src/field.ts,
 * untouched) or by the proposed one. Both read the same engine.
 */
export function createFarmScene(stage: Stage, options: { look: Look; plan: FieldPlan; world?: boolean; motion?: boolean }) {
  const { scene } = stage;
  const world = options.world === false ? null : createWorld(scene);
  const site = options.plan.site;
  let shipping: ReturnType<typeof createField> | null = null;
  let study: StudyField | null = null;
  let engine: FarmingEngine;
  const shippingObjects: THREE.Object3D[] = [];
  if (options.look === "today") {
    const before = new Set(scene.children);
    shipping = createField(scene, options.plan.snapshot(), site);
    for (const child of scene.children) if (!before.has(child)) shippingObjects.push(child);
    engine = shipping.engine;
  } else {
    engine = new FarmingEngine(options.plan.snapshot(), FARMING_CONFIG, false, site);
    study = createStudyField(scene, engine, { motion: options.motion, stubbleCrop: options.plan.stubbleCrop });
  }
  const tractor = createTractor(scene);
  const attachment = tractor.group.getObjectByName("attachment")!;
  // The proposed look harvests with its own implement; today's keeps the mower deck.
  if (options.look === "proposed") createReaper(attachment);
  tractor.setTool("wander");
  return {
    world,
    engine,
    shipping,
    study,
    tractor,
    look: options.look,
    placeTractor(state: TractorState, tool: Tool = "harvest", lifted = false) {
      tractor.group.position.set(state.x, 0, state.z);
      tractor.group.rotation.y = state.heading;
      tractor.setTool(tool);
      attachment.position.y = lifted ? 0.4 : 0;
    },
    hideTractor() {
      tractor.group.visible = false;
    },
    /** Triangles the field sends to the GPU each frame, counted from the scene itself. */
    fieldTriangles() {
      if (study) return study.triangles;
      let total = 0;
      for (const object of shippingObjects)
        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const g = child.geometry as THREE.BufferGeometry;
          const each = (g.index ? g.index.count : g.attributes.position.count) / 3;
          total += each * (child instanceof THREE.InstancedMesh ? child.count : 1);
        });
      return total;
    },
  };
}
export type FarmScene = ReturnType<typeof createFarmScene>;
