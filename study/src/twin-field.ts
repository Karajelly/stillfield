import * as THREE from "three";
import { createField } from "../../src/field";
import { FARMING_CONFIG, FarmingEngine } from "../../src/farming";
import type { Crop, FieldSite } from "../../src/farming";
import { fieldColumns, fieldRows } from "../../src/simulation";
import type { Tool } from "../../src/simulation";
import { createStudyField } from "./study-field";
import type { Look } from "./farm-scene";

/**
 * One plot drawn twice: by the shipping renderer (src/field.ts, untouched) and
 * by the proposed one. Each has its own engine and both are given exactly the
 * same work, so flipping between them compares looks and nothing else.
 */
export class TwinField {
  readonly shipping: ReturnType<typeof createField>;
  readonly study: ReturnType<typeof createStudyField>;
  readonly columns: number;
  readonly rows: number;
  look: Look = "proposed";
  private readonly shippingObjects: THREE.Object3D[];
  private readonly engine: FarmingEngine;

  constructor(scene: THREE.Scene, readonly site: FieldSite, motion: boolean) {
    this.columns = fieldColumns(site.bounds);
    this.rows = fieldRows(site.bounds);
    const before = new Set(scene.children);
    this.shipping = createField(scene, undefined, site);
    this.shippingObjects = scene.children.filter((child) => !before.has(child));
    this.engine = new FarmingEngine(undefined, FARMING_CONFIG, false, site);
    this.study = createStudyField(scene, this.engine, { motion });
    this.setLook("proposed");
  }

  setLook(look: Look) {
    this.look = look;
    for (const object of this.shippingObjects) object.visible = look === "today";
    this.study.group.visible = look === "proposed";
  }

  get all() {
    return Array.from({ length: this.columns * this.rows }, (_, i) => i);
  }
  /** The cells of one column between two rows. */
  column(column: number, row0 = 0, row1 = this.rows) {
    const cells: number[] = [];
    for (let row = row0; row < row1; row++) cells.push(row * this.columns + column);
    return cells;
  }

  /** Give both fields the same work. Returns what the proposed field made of it. */
  work(cells: number[], tool: Tool, crop: Crop, heading = -Math.PI / 2) {
    const today = this.shipping.paintCells(cells, tool, crop);
    const events = this.engine.applyCells(cells, tool, crop);
    return { events, today, moments: this.study.respond(events, heading) };
  }

  advance(seconds: number) {
    this.shipping.advance(seconds);
    const events = this.engine.advance(seconds);
    this.study.respond(events);
    return events;
  }

  /** Begin again from bare meadow, in both fields. */
  clear() {
    this.shipping.reset();
    this.engine.reset();
    this.study.syncAll();
  }

  /** A rectangle of cells, by column and row. */
  block(column0: number, column1: number, row0: number, row1: number) {
    const cells: number[] = [];
    for (let row = row0; row < row1; row++) for (let column = column0; column < column1; column++) cells.push(row * this.columns + column);
    return cells;
  }

  /** One crop at one point in its life, with meadow left around it. */
  fill(crop: Crop, progress: number, cells = this.all) {
    this.clear();
    this.work(cells, "plow", crop);
    this.work(cells, "sow", crop);
    if (progress > 0) this.advance(FARMING_CONFIG.growthSeconds[crop] * progress + (progress >= 1 ? 1 : 0));
    this.study.syncAll();
  }

  wind(front: number | null, time: number) {
    if (this.look === "today") this.shipping.wind(front, time);
  }
}
