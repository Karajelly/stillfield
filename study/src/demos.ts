import * as THREE from "three";
import { createWorld } from "../../src/world";
import { createTractor } from "../../src/tractor";
import { FarmAudio } from "../../src/audio";
import { CROP_NAMES, FARMING_CONFIG } from "../../src/farming";
import type { Crop, FieldSite } from "../../src/farming";
import { cruiseSpeed } from "../../src/simulation";
import type { TractorState } from "../../src/simulation";
import { tuning } from "../../src/handling";
import type { DayHold } from "../../src/daylight";
import { createFollowCamera, createStage, farmCamera, withoutBirds } from "./stage";
import type { Stage } from "./stage";
import { plot } from "./farm-scene";
import type { Look } from "./farm-scene";
import { TwinField } from "./twin-field";
import { createReaper } from "./reaper";
import type { Reaper } from "./reaper";
import { HarvestSound } from "./harvest-sound";
import { plantUniforms } from "./plant-material";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = () => window.matchMedia("(pointer: coarse)").matches;
/** How far the working deck trails the tractor, from src/tractor.ts. */
const DECK = 2.1;
/** A gust crosses one metre per beat, as in src/wind.ts. */
const GUST_SPEED = 1 / 0.42;

type View = "farm" | "tractor";

/** Shared by both demos: the game's stage, world and tractor around one twin plot. */
abstract class Demo {
  protected stage: Stage | null = null;
  protected twin!: TwinField;
  protected world!: ReturnType<typeof createWorld>;
  protected tractor!: ReturnType<typeof createTractor>;
  protected attachment!: THREE.Object3D;
  protected reaper!: Reaper;
  protected readonly follow = createFollowCamera();
  protected readonly farmView = new THREE.OrthographicCamera();
  protected state: TractorState = { x: 0, z: 0, heading: 0, speed: 0 };
  protected time = 0;
  protected lifted = 0;
  protected gustStart = 5;
  look: Look = "proposed";
  crop: Crop = "wheat";
  view: View = "farm";
  light: DayHold = "morning";
  running = false;
  canvas: HTMLCanvasElement;
  readonly sound = new HarvestSound();
  protected readonly gameAudio = new FarmAudio();
  protected soundOn = false;
  private raf = 0;
  private last = 0;

  constructor(readonly root: HTMLElement) {
    this.canvas = root.querySelector("canvas")!;
    this.bind();
  }

  protected abstract site(): FieldSite;
  /** Called once the scene exists. */
  protected abstract setup(): void;
  protected abstract tick(dt: number): void;
  /** Where the farm view looks, and how many metres tall it is at this aspect. */
  protected abstract framing(aspect: number): { focus: THREE.Vector3; metres: number };
  protected tractorZoom = 0.85;

  get live() {
    return this.stage !== null;
  }

  boot() {
    if (this.stage || this.root.classList.contains("is-unavailable")) return;
    try {
      const stage = createStage(this.canvas, {
        pixelRatio: Math.min(window.devicePixelRatio, touch() ? 1.5 : 2),
        shadows: touch() ? 1024 : 2048,
      });
      this.stage = stage;
      stage.light(this.light);
      this.world = createWorld(stage.scene);
      withoutBirds(stage.scene);
      this.twin = new TwinField(stage.scene, this.site(), !reducedMotion());
      this.tractor = createTractor(stage.scene);
      this.attachment = this.tractor.group.getObjectByName("attachment")!;
      this.reaper = createReaper(this.attachment);
      plantUniforms.uBreeze.value = reducedMotion() ? 0 : 0.035;
      this.setup();
      this.setLook(this.look);
      this.resize();
      this.root.classList.add("is-live");
    } catch {
      // No WebGL here: the still picture and the frames beside it carry the point.
      this.stage = null;
      this.root.classList.add("is-unavailable");
    }
  }

  resize() {
    if (!this.stage) return;
    const box = this.canvas.getBoundingClientRect();
    if (box.width && box.height) this.stage.resize(Math.round(box.width), Math.round(box.height));
  }

  start() {
    this.boot();
    if (this.running || !this.stage) return;
    this.running = true;
    this.last = 0;
    this.root.classList.add("is-running");
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
    this.syncControls();
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.remove("is-running");
    this.gameAudio.setDriving(0);
    this.syncControls();
  }
  /** Give the graphics context back, and show the still picture again. */
  dispose() {
    this.stop();
    void this.setSound(false);
    if (!this.stage) return;
    this.stage.dispose();
    this.stage = null;
    // A canvas keeps its lost context, so the next visit starts on a fresh one.
    const fresh = this.canvas.cloneNode() as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.root.classList.remove("is-live");
  }

  /** Run forward with a fixed step and draw once: how the study's own pictures are made. */
  advance(seconds: number, step = 1 / 30) {
    this.boot();
    for (let t = 0; t < seconds - 1e-9; t += step) this.frame(step, false);
    this.render();
    return this.canvas.toDataURL("image/png");
  }

  /** One frame. */
  frame(dt: number, draw = true) {
    if (!this.stage) return;
    this.time += dt;
    this.tick(dt);
    // A gust every so often, sooner than in the game so a short visit sees one.
    const bounds = this.twin.site.bounds;
    let front: number | null = null;
    if (!reducedMotion() && this.time > this.gustStart) {
      front = bounds.minX - 1 + (this.time - this.gustStart) * GUST_SPEED;
      if (front > bounds.maxX + 7) {
        front = null;
        this.gustStart = this.time + 20;
      }
    }
    this.twin.wind(front, this.time);
    this.twin.study.update(dt, this.time, front);
    this.world.update(reducedMotion() ? 0 : this.time, reducedMotion() ? 0 : dt * (front === null ? 1 : 2.4));
    this.tractor.group.position.set(this.state.x, 0, this.state.z);
    this.tractor.group.rotation.y = this.state.heading;
    this.tractor.update(this.state.speed, dt, this.time);
    this.attachment.position.y += (this.lifted * 0.4 - this.attachment.position.y) * (1 - Math.exp(-8 * dt));
    this.reaper.update(this.state.speed, dt, this.lifted === 0);
    this.gameAudio.setDriving(this.state.speed / 6);
    if (draw) this.render(dt);
  }

  render(dt = 0) {
    if (!this.stage) return;
    this.twin.study.flush();
    const size = this.stage.renderer.getSize(new THREE.Vector2());
    const aspect = size.x / Math.max(1, size.y);
    let camera: THREE.Camera;
    if (this.view === "tractor") {
      camera = this.follow.update(this.state, this.tractorZoom, aspect, dt, dt === 0 || reducedMotion(), this.world.obstacles);
      this.stage.lookAt(new THREE.Vector3(this.state.x, 0, this.state.z));
    } else {
      const { focus, metres } = this.framing(aspect);
      camera = farmCamera(focus, metres, aspect, this.farmView);
      this.stage.lookAt(focus);
    }
    this.stage.renderer.render(this.stage.scene, camera);
  }

  setLook(look: Look) {
    this.look = look;
    if (this.stage) {
      this.twin.setLook(look);
      this.reaper.visible = look === "proposed";
      if (!this.running) this.render();
    }
    this.syncControls();
  }
  setView(view: View) {
    this.view = view;
    if (this.stage && !this.running) this.render();
    this.syncControls();
  }
  setLight(light: DayHold) {
    this.light = light;
    this.stage?.light(light);
    if (this.stage && !this.running) this.render();
    this.syncControls();
  }
  abstract setCrop(crop: Crop): void;

  async setSound(on: boolean) {
    this.soundOn = on;
    try {
      // The game's own wind, birdsong and engine sit under both looks.
      this.gameAudio.setVolume(0.6);
      await Promise.all([this.gameAudio.setEnabled(on), this.sound.setEnabled(on)]);
    } catch {
      this.soundOn = false;
    }
    this.syncControls();
  }

  protected say(text: string) {
    const readout = this.root.querySelector("[data-readout]");
    if (readout && readout.textContent !== text) readout.textContent = text;
  }

  private bind() {
    const on = (selector: string, handler: (element: HTMLElement) => void) =>
      this.root.querySelectorAll<HTMLElement>(selector).forEach((element) =>
        element.addEventListener("click", () => handler(element)),
      );
    on("[data-look]", (b) => {
      this.boot();
      this.setLook(b.dataset.look as Look);
    });
    on("[data-crop]", (b) => {
      this.boot();
      this.setCrop(b.dataset.crop as Crop);
    });
    on("[data-view]", (b) => {
      this.boot();
      this.setView(b.dataset.view as View);
    });
    on("[data-light]", (b) => {
      this.boot();
      this.setLight(b.dataset.light as DayHold);
    });
    on("[data-action=play]", () => (this.running ? this.stop() : this.start()));
    on("[data-action=sound]", () => {
      this.boot();
      void this.setSound(!this.soundOn);
    });
  }

  protected syncControls() {
    const mark = (attribute: string, value: string) =>
      this.root.querySelectorAll<HTMLElement>(`[data-${attribute}]`).forEach((b) => {
        const active = b.dataset[attribute] === value;
        b.classList.toggle("is-on", active);
        b.setAttribute("aria-pressed", String(active));
      });
    mark("look", this.look);
    mark("crop", this.crop);
    mark("view", this.view);
    mark("light", this.light);
    this.root.querySelectorAll<HTMLElement>("[data-action=play]").forEach((play) => {
      play.setAttribute("aria-pressed", String(this.running));
      const label = play.querySelector("[data-label]") ?? play;
      label.textContent = this.running ? play.dataset.pause ?? "Pause" : play.dataset.play ?? "Play";
    });
    const sound = this.root.querySelector<HTMLElement>("[data-action=sound]");
    if (sound) {
      sound.setAttribute("aria-pressed", String(this.soundOn));
      sound.classList.toggle("is-on", this.soundOn);
      const label = sound.querySelector("[data-label]") ?? sound;
      label.textContent = this.soundOn ? "Sound on" : "Sound off";
    }
  }
}

/**
 * A plot sown in three passes, then left to grow. Today's plants change three
 * times in a life; the proposed ones never stop. At the end the rows ripen in
 * the order, and at the pace, that they were sown.
 */
export class GrowthDemo extends Demo {
  /** The patch of meadow, and the 12 m by 7.5 m of it that is sown: three lanes. */
  private readonly bounds = { minX: -17, maxX: 1, minZ: -6.25, maxZ: 6.25 };
  private readonly sownColumns: [number, number] = [6, 30];
  private readonly sownRows: [number, number] = [5, 20];
  private tau = 0;
  private sown = 0;
  private hold = 0;
  private order: { at: number; column: number; lane: number }[] = [];
  private readonly scrub: HTMLInputElement | null;
  protected tractorZoom = 1.8;

  constructor(root: HTMLElement) {
    super(root);
    this.scrub = root.querySelector<HTMLInputElement>("[data-scrub]");
    this.scrub?.addEventListener("input", () => {
      this.boot();
      this.stop();
      this.seek((Number(this.scrub!.value) / 1000) * this.end);
      this.render();
    });
    this.syncControls();
  }
  protected site() {
    return plot(this.bounds, { x: 40, z: 40 });
  }
  private get growth() {
    return FARMING_CONFIG.growthSeconds[this.crop];
  }
  /** Sowing takes eighteen seconds of tractor time; the crop is ripe one season later. */
  private get end() {
    return this.order[this.order.length - 1].at + this.growth + 2;
  }
  protected setup() {
    // Three lanes sown back and forth at the tractor's own 3 m/s, with a turn between.
    const [first, last] = this.sownColumns, columns = last - first, perColumn = 0.5 / cruiseSpeed();
    this.order = [];
    for (let lane = 0; lane < 3; lane++)
      for (let k = 0; k < columns; k++)
        this.order.push({ at: lane * (columns * perColumn + 3) + k * perColumn, column: first + (lane % 2 ? columns - 1 - k : k), lane });
    this.state = { x: (this.bounds.minX + this.bounds.maxX) / 2, z: this.bounds.maxZ + 3.5, heading: Math.PI, speed: 0 };
    this.tractor.setTool("wander");
    this.seek(this.end);
  }
  protected framing(aspect: number) {
    return { focus: new THREE.Vector3(-8, 0.5, 0), metres: Math.max(10.2, 15.6 / aspect) };
  }
  private sowUpTo(tau: number) {
    while (this.sown < this.order.length && this.order[this.sown].at <= tau) {
      const next = this.order[this.sown++];
      if (next.at > this.tau) {
        this.twin.advance(next.at - this.tau);
        this.tau = next.at;
      }
      const row = this.sownRows[0] + next.lane * 5;
      this.twin.work(this.twin.column(next.column, row, row + 5), "sow", this.crop);
    }
  }
  /** Rebuild the plot as it stands `tau` seconds after sowing began. */
  seek(tau: number) {
    this.twin.clear();
    this.twin.work(this.twin.block(...this.sownColumns, ...this.sownRows), "plow", this.crop);
    this.tau = 0;
    this.sown = 0;
    this.sowUpTo(tau);
    if (tau > this.tau) this.twin.advance(tau - this.tau);
    this.tau = tau;
    this.twin.study.syncAll();
    this.hold = 0;
    this.report();
  }
  setCrop(crop: Crop) {
    this.crop = crop;
    if (this.live) {
      this.seek(this.end);
      if (!this.running) this.render();
    }
    this.syncControls();
  }
  /** The plants are the subject here; the tractor only appears when you sit behind it. */
  render(dt = 0) {
    if (this.live) this.tractor.group.visible = this.view === "tractor";
    super.render(dt);
  }
  start() {
    // Pressing play on a ripe plot starts the season over, including the very first press.
    this.boot();
    if (this.live && this.tau >= this.end) this.seek(0);
    super.start();
  }
  protected tick(dt: number) {
    if (this.tau >= this.end) {
      this.hold += dt;
      if (this.hold > 4.5) this.seek(0);
      return;
    }
    // Sowing and ripening play near the tractor's pace; the long middle is a time-lapse.
    const sowing = this.order[this.order.length - 1].at + 0.5, ripening = this.end - sowing - 3;
    const speed = this.tau < sowing || this.tau > ripening ? 3 : (ripening - sowing) / 7;
    const next = Math.min(this.end, this.tau + speed * dt);
    this.sowUpTo(next);
    if (next > this.tau) {
      const events = this.twin.advance(next - this.tau);
      if (this.look === "proposed" && events.cropMaturities.length)
        this.sound.ripen(this.crop, 3 + Math.floor((Math.floor(events.cropMaturities[0] / this.twin.columns) - this.sownRows[0]) / 5));
    }
    this.tau = next;
    this.twin.study.readGrowth();
    this.report();
  }
  private report() {
    if (this.scrub) this.scrub.value = String(Math.round((this.tau / this.end) * 1000));
    const sowing = this.order[this.order.length - 1].at;
    const grown = Math.max(0, Math.min(this.growth, this.tau - sowing));
    const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    const stage =
      this.tau < sowing ? "sowing" : grown >= this.growth ? "ripe" : ["seeds", "shoots", "leafy"][Math.min(2, Math.floor((grown / this.growth) * 3))];
    this.say(`${CROP_NAMES[this.crop]} · ${clock(grown)} of ${clock(this.growth)} · ${stage}`);
  }
}

interface Leg {
  length: number;
  /** Position and heading `d` metres into the leg. */
  pose(d: number): { x: number; z: number; heading: number };
  /** The lane being harvested, or -1 while turning with the implement up. */
  lane: number;
  /** Travelling west (-1) or east (1) while working. */
  dir: number;
  /** The field regrows while the tractor rides back round. */
  regrow?: boolean;
}

/**
 * Four ripe lanes, harvested back and forth exactly as tidy rows would: the
 * deck works a full lane width as it passes, then lifts for a half-circle onto
 * the next lane. The field regrows while the tractor rides back to the start.
 */
export class PassDemo extends Demo {
  /** The patch of meadow, and the 21 m by 10 m of it that is sown: four lanes. */
  private readonly bounds = { minX: -25, maxX: 5, minZ: -7.5, maxZ: 12.5 };
  // Kept clear of the meadow windmill, so the camera behind the tractor never looks through it.
  private readonly sown = { minX: -22, maxX: -1, minZ: -2.5, maxZ: 7.5 };
  private readonly sownColumns: [number, number] = [6, 48];
  private readonly sownRows: [number, number] = [10, 30];
  private legs: Leg[] = [];
  private leg = 0;
  private along = 0;
  private cut = 0;
  private beat = 0;
  private regrown = 0;
  private harvested = 0;

  protected site() {
    return plot(this.bounds, { x: -11.5, z: -5.2 });
  }
  protected framing(aspect: number) {
    return { focus: new THREE.Vector3(-10.6, 0.3, 2.3), metres: Math.max(14.2, 28.5 / aspect) };
  }
  protected setup() {
    const b = this.sown, radius = 1.25, west = b.minX - DECK - 0.5, east = b.maxX + DECK + 0.5;
    const laneZ = (lane: number) => b.minZ + 1.25 + lane * 2.5;
    const line = (x0: number, z0: number, x1: number, z1: number, lane: number, regrow = false): Leg => {
      const length = Math.hypot(x1 - x0, z1 - z0), heading = Math.atan2(x1 - x0, z1 - z0);
      return {
        length, lane, dir: Math.sign(x1 - x0), regrow,
        pose: (d) => ({ x: x0 + ((x1 - x0) * d) / length, z: z0 + ((z1 - z0) * d) / length, heading }),
      };
    };
    // A turn of `sweep` radians, to the left when positive, starting at (x, z) facing `heading`.
    const arc = (x: number, z: number, heading: number, sweep: number, regrow = false): Leg => {
      const side = Math.sign(sweep);
      const cx = x + Math.cos(heading) * radius * side, cz = z - Math.sin(heading) * radius * side;
      return {
        length: Math.abs(sweep) * radius, lane: -1, dir: 0, regrow,
        pose: (d) => {
          const h = heading + (d / radius) * side;
          return { x: cx - Math.cos(h) * radius * side, z: cz + Math.sin(h) * radius * side, heading: h };
        },
      };
    };
    const W = -Math.PI / 2, E = Math.PI / 2;
    this.legs = [
      line(east, laneZ(0), west, laneZ(0), 0),
      arc(west, laneZ(0), W, Math.PI),
      line(west, laneZ(1), east, laneZ(1), 1),
      arc(east, laneZ(1), E, -Math.PI),
      line(east, laneZ(2), west, laneZ(2), 2),
      arc(west, laneZ(2), W, Math.PI),
      line(west, laneZ(3), east, laneZ(3), 3),
      // Home along the headland while the field grows back.
      arc(east, laneZ(3), E, Math.PI / 2, true),
      line(east + radius, laneZ(3) - radius, east + radius, laneZ(0) + radius, -1, true),
      arc(east + radius, laneZ(0) + radius, Math.PI, Math.PI / 2, true),
    ];
    this.tractor.setTool("harvest");
    this.twin.fill(this.crop, 1, this.cells);
    this.restart();
  }
  private get cells() {
    return this.twin.block(...this.sownColumns, ...this.sownRows);
  }
  private restart() {
    this.leg = 0;
    this.along = 0;
    this.cut = 0;
    this.beat = 0;
    this.regrown = 0;
    this.harvested = 0;
    this.state = { ...this.legs[0].pose(0), speed: 0 };
    this.lifted = 0;
    this.report();
  }
  setCrop(crop: Crop) {
    this.crop = crop;
    if (this.live) {
      this.twin.fill(crop, 1, this.cells);
      this.restart();
      if (!this.running) this.render();
    }
    this.syncControls();
  }
  /** The pitch this lane plays in, from the middle of the wind's ten-lane scale. */
  private pitch(lane: number) {
    return 3 + lane;
  }
  protected tick(dt: number) {
    const leg = this.legs[this.leg];
    const desired = leg.lane < 0 ? tuning.tightTurnSpeed : cruiseSpeed();
    let speed = this.state.speed;
    speed += (desired - speed) * (1 - Math.exp(-(desired > speed ? tuning.acceleration : tuning.braking) * dt));
    this.along += speed * dt;
    this.lifted = leg.lane < 0 ? 1 : 0;
    if (leg.regrow) this.regrow(dt);
    if (this.along >= leg.length) {
      this.along -= leg.length;
      this.leg = (this.leg + 1) % this.legs.length;
      this.cut = 0;
      if (this.leg === 0) {
        // Whatever the time-lapse left unfinished is ripe by the time the cutter arrives.
        this.finishRegrow();
        this.harvested = 0;
      }
    }
    const now = this.legs[this.leg];
    this.state = { ...now.pose(Math.min(this.along, now.length)), speed };
    if (now.lane >= 0) this.harvest(now);
    this.report();
  }
  private harvest(leg: Leg) {
    const b = this.bounds, [first, last] = this.sownColumns, columns = last - first;
    const deck = this.state.x - leg.dir * DECK;
    const row = this.sownRows[0] + leg.lane * 5;
    const rows: [number, number] = [row, row + 5];
    while (this.cut < columns) {
      const column = leg.dir < 0 ? last - 1 - this.cut : first + this.cut;
      const centre = b.minX + (column + 0.5) * 0.5;
      if ((deck - centre) * leg.dir < 0) break;
      const { moments, today } = this.twin.work(this.twin.column(column, ...rows), "harvest", this.crop, this.state.heading);
      this.cut++;
      this.harvested += 5;
      if (this.look === "proposed") {
        // One note for each metre cut; a lower one as each bundle is set down.
        if (this.cut % 2 === 1) this.sound.cut(this.crop, this.pitch(leg.lane), this.beat++);
        for (const moment of moments)
          for (let k = 0; k < moment.bundles.length; k++) {
            this.sound.bundle(this.crop, this.pitch(leg.lane));
            this.reaper.tie();
          }
        if (this.cut === columns) this.sound.close(this.crop, this.pitch(leg.lane));
      } else if (today.harvestResults.length) this.gameAudio.harvest(today.harvestResults[0].crop);
    }
  }
  private regrow(dt: number) {
    const season = FARMING_CONFIG.growthSeconds[this.crop];
    if (this.regrown === 0) {
      this.twin.clear();
      this.twin.work(this.cells, "plow", this.crop);
      this.twin.work(this.cells, "sow", this.crop);
      this.twin.study.syncAll();
    }
    if (this.regrown >= season) return;
    // A season in the time it takes to ride home.
    const step = Math.min(season - this.regrown + 1, (season / 4.6) * dt);
    this.regrown += step;
    this.twin.advance(step);
    this.twin.study.readGrowth();
  }
  private finishRegrow() {
    const season = FARMING_CONFIG.growthSeconds[this.crop];
    if (this.regrown < season) this.twin.advance(season - this.regrown + 1);
    this.twin.study.readGrowth();
    this.regrown = 0;
    this.beat = 0;
  }
  private report() {
    const leg = this.legs[this.leg];
    const squares = this.cells.length;
    this.say(
      leg.regrow
        ? `${CROP_NAMES[this.crop]} · growing back while the tractor rides home`
        : `${CROP_NAMES[this.crop]} · ${this.harvested} of ${squares} squares cut`,
    );
  }
}

/** Find the demos on a page and wire them up. Only one runs at a time. */
export function mountDemos(scope: ParentNode = document) {
  const demos: Demo[] = [];
  scope.querySelectorAll<HTMLElement>("[data-demo]").forEach((root) => {
    const demo = root.dataset.demo === "growth" ? new GrowthDemo(root) : new PassDemo(root);
    demos.push(demo);
    const start = demo.start.bind(demo);
    demo.start = () => {
      for (const other of demos) if (other !== demo) other.dispose();
      start();
    };
    const boot = demo.boot.bind(demo);
    demo.boot = () => {
      for (const other of demos) if (other !== demo) other.dispose();
      boot();
    };
  });
  window.addEventListener("resize", () => demos.forEach((demo) => demo.resize()));
  if ("IntersectionObserver" in window) {
    // A demo left behind by scrolling stops, and hands its graphics memory back.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const demo = demos.find((d) => d.root === entry.target);
        if (demo && !entry.isIntersecting && demo.live) demo.dispose();
      }
    }, { threshold: 0 });
    demos.forEach((demo) => observer.observe(demo.root));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) demos.forEach((demo) => demo.running && demo.stop());
  });
  return demos;
}
