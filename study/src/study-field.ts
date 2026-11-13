import * as THREE from "three";
import { fieldColumns, fieldRows } from "../../src/simulation";
import { CROPS, Ground } from "../../src/farming";
import type { Crop, FarmingEngine, FarmingEvents } from "../../src/farming";
import {
  churn, grassTuft, pumpkinFruit, pumpkinHeap, pumpkinVine, stook, stubble, sunflower, wheatTuft,
  PALETTE, SUNFLOWER_FACING,
} from "./crops";
import { createPlantMaterial, createPlantMesh, plantUniforms } from "./plant-material";
import type { PlantGeometry } from "./plant-material";

/** Three metres of lane, one implement wide: the unit a bundle stands for. */
export const TILE = { columns: 6, rows: 5 };
/** A bundle stands once this much of its tile is that crop's stubble. */
const TILE_SHARE = 0.6;
const PIXELS = 8;
const VARIANTS = 4;

/** A repeatable 0 to 1 number for a cell, so a field looks the same every visit. */
export function cellNoise(cell: number, salt: number) {
  let h = (cell * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One instanced mesh that only ever draws the plants that exist. */
class Layer {
  readonly mesh: THREE.InstancedMesh;
  private readonly plant: THREE.InstancedBufferAttribute;
  private readonly cells: Int32Array;
  private readonly slotOf = new Map<number, number>();
  constructor(geometry: PlantGeometry, material: THREE.Material, capacity: number, parent: THREE.Object3D) {
    const made = createPlantMesh(geometry.build(), material, capacity);
    this.mesh = made.mesh;
    this.plant = made.plant;
    this.cells = new Int32Array(capacity);
    this.triangles = geometry.triangles;
    parent.add(this.mesh);
  }
  readonly triangles: number;
  has(key: number) {
    return this.slotOf.has(key);
  }
  get count() {
    return this.mesh.count;
  }
  keyAt(slot: number) {
    return this.cells[slot];
  }
  add(key: number, matrix: THREE.Matrix4, seed: number, grow: number) {
    let slot = this.slotOf.get(key);
    if (slot === undefined) {
      if (this.mesh.count >= this.cells.length) return;
      slot = this.mesh.count++;
      this.slotOf.set(key, slot);
      this.cells[slot] = key;
    }
    this.mesh.setMatrixAt(slot, matrix);
    this.plant.setXYZW(slot, seed, grow, 0, 0);
    this.touch();
  }
  remove(key: number) {
    const slot = this.slotOf.get(key);
    if (slot === undefined) return;
    const last = --this.mesh.count;
    if (slot !== last) {
      const moved = this.cells[last];
      this.mesh.instanceMatrix.array.copyWithin(slot * 16, last * 16, last * 16 + 16);
      this.plant.array.copyWithin(slot * 4, last * 4, last * 4 + 4);
      this.cells[slot] = moved;
      this.slotOf.set(moved, slot);
    }
    this.slotOf.delete(key);
    this.touch();
  }
  setMatrix(key: number, matrix: THREE.Matrix4) {
    const slot = this.slotOf.get(key);
    if (slot === undefined) return;
    this.mesh.setMatrixAt(slot, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  setGrow(slot: number, grow: number) {
    if (this.plant.getY(slot) === grow) return false;
    this.plant.setY(slot, grow);
    this.plant.needsUpdate = true;
    return true;
  }
  setPulse(key: number, pulse: number) {
    const slot = this.slotOf.get(key);
    if (slot === undefined || this.plant.getZ(slot) > 0) return;
    this.plant.setW(slot, pulse);
    this.plant.needsUpdate = true;
  }
  setCut(key: number, amount: number, direction: number) {
    const slot = this.slotOf.get(key);
    if (slot === undefined) return;
    this.plant.setZ(slot, amount);
    this.plant.setW(slot, direction);
    this.plant.needsUpdate = true;
  }
  clear() {
    this.mesh.count = 0;
    this.slotOf.clear();
  }
  private touch() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.plant.needsUpdate = true;
  }
}

export interface HarvestMoment {
  crop: Crop;
  /** Lane (0 at the far side) for pitch, and how many squares were cut. */
  lane: number;
  cells: number;
  /** Bundles that this pass completed, in world coordinates. */
  bundles: { x: number; z: number }[];
}

export interface StudyFieldOptions {
  /** Animate cutting, gathering and bundles. Off for stills and reduced motion. */
  motion?: boolean;
  /** What existing stubble used to be (1 wheat, 2 sunflowers, 3 pumpkins), by cell. */
  stubbleCrop?: ArrayLike<number>;
}

/**
 * The proposed field renderer. It reads the game's own FarmingEngine and never
 * changes it: every plant, stubble row and bundle here is derived from the
 * cells the engine already keeps.
 */
export function createStudyField(scene: THREE.Scene, engine: FarmingEngine, options: StudyFieldOptions = {}) {
  const bounds = engine.bounds, columns = fieldColumns(bounds), rows = fieldRows(bounds), count = columns * rows;
  const group = new THREE.Group();
  group.name = "study-field";
  scene.add(group);
  let motion = options.motion ?? true;

  // The one thing the engine does not keep today: what a square of stubble used to be.
  const lastCrop = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (engine.cells[i] === Ground.stubble) lastCrop[i] = options.stubbleCrop?.[i] || 1;

  const canvas = document.createElement("canvas");
  canvas.width = columns * PIXELS;
  canvas.height = rows * PIXELS;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0.045, (bounds.minZ + bounds.maxZ) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const material = createPlantMaterial();
  // Grass and stubble are the ground of the picture, so they are lit flat and quiet.
  const quiet = createPlantMaterial(0.9);
  const layer = (geometry: PlantGeometry, capacity = count, lit = material) => new Layer(geometry, lit, capacity, group);
  const variants = (make: (seed: number) => PlantGeometry, seed: number, lit = material) =>
    Array.from({ length: VARIANTS }, (_, i) => layer(make(seed + i * 17), count, lit));
  const layers = {
    grass: variants(grassTuft, 5, quiet),
    wheat: variants(wheatTuft, 101),
    sunflowers: variants(sunflower, 211),
    vines: Array.from({ length: VARIANTS }, (_, i) => layer(pumpkinVine(307 + i * 13, i === 1))),
    fruit: [layer(pumpkinFruit())],
    stubbleWheat: variants((seed) => stubble("wheat", seed), 401, quiet),
    stubbleSunflowers: variants((seed) => stubble("sunflowers", seed), 431, quiet),
    stubblePumpkins: variants((seed) => stubble("pumpkins", seed), 461, quiet),
  };
  const tileColumns = Math.ceil(columns / TILE.columns), tileRows = Math.ceil(rows / TILE.rows);
  const bundles: Record<Crop, Layer> = {
    wheat: layer(stook(), tileColumns * tileRows),
    sunflowers: layer(churn(), tileColumns * tileRows),
    pumpkins: layer(pumpkinHeap(), tileColumns * tileRows),
  };
  const tileBundle = new Uint8Array(tileColumns * tileRows);
  // Fruit on its way to a heap, and bundles settling into place.
  const loose = layer(pumpkinFruit(), 96);
  const flying: { key: number; from: THREE.Vector3; to: THREE.Vector3; size: number; yaw: number; age: number }[] = [];
  const settling: { tile: number; crop: Crop; age: number }[] = [];
  const falling: { layer: Layer; cell: number; age: number; direction: number }[] = [];
  const ripening: { cell: number; age: number }[] = [];
  let looseKey = 0;

  // Chaff, petals and leaf scraps lifted by the cutter.
  const CHAFF = 220;
  const chaffGeometry = new THREE.BufferGeometry();
  chaffGeometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, 0, 0.9, 0.5, 0, 0, -0.5, 0, 0, 0, 0, -0.9], 3));
  chaffGeometry.computeVertexNormals();
  const chaff = new THREE.InstancedMesh(
    chaffGeometry,
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, side: THREE.DoubleSide, emissive: "#ffffff", emissiveIntensity: 0.12 }),
    CHAFF,
  );
  chaff.count = 0;
  chaff.frustumCulled = false;
  chaff.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(chaff);
  const motes: { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; life: number; span: number; size: number; tone: THREE.Color }[] = [];
  const CHAFF_TONES: Record<Crop, string[]> = {
    wheat: ["#f6e2a0", "#ecc660", "#fbf0c8"],
    sunflowers: ["#f7c21d", "#f9d657", "#7da552"],
    pumpkins: ["#7fae5a", "#a9bf66", "#f3c93e"],
  };

  const dummy = new THREE.Object3D(), tone = new THREE.Color();
  const cellX = (cell: number) => bounds.minX + ((cell % columns) + 0.5) * bounds.cell;
  const cellZ = (cell: number) => bounds.minZ + (Math.floor(cell / columns) + 0.5) * bounds.cell;
  const tileOf = (cell: number) =>
    Math.floor(Math.floor(cell / columns) / TILE.rows) * tileColumns + Math.floor((cell % columns) / TILE.columns);
  const tileCentre = (tile: number) => {
    const tc = tile % tileColumns, tr = Math.floor(tile / tileColumns);
    const c0 = tc * TILE.columns, c1 = Math.min(columns, c0 + TILE.columns);
    const r0 = tr * TILE.rows, r1 = Math.min(rows, r0 + TILE.rows);
    return {
      x: bounds.minX + ((c0 + c1) / 2) * bounds.cell + (cellNoise(tile, 91) - 0.5) * 0.25,
      z: bounds.minZ + ((r0 + r1) / 2) * bounds.cell + (cellNoise(tile, 92) - 0.5) * 0.2,
    };
  };
  const hasFruit = (cell: number) => cellNoise(cell, 21) < 0.3;
  function fruitPose(cell: number) {
    const giant = cellNoise(cell, 22) < 0.04;
    const size = giant ? 0.92 + cellNoise(cell, 23) * 0.2 : 0.42 + cellNoise(cell, 23) * 0.3;
    return {
      x: cellX(cell) + (cellNoise(cell, 24) - 0.5) * 0.26, z: cellZ(cell) + (cellNoise(cell, 25) - 0.5) * 0.26,
      size, yaw: cellNoise(cell, 26) * Math.PI * 2,
    };
  }
  function place(x: number, z: number, yaw: number, sx: number, sy = sx, sz = sx, y = 0.05) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    return dummy.matrix;
  }

  const SOIL = ["#b89570", "#c29f79"], GRASS = ["#a4b376", "#a8b67a"];
  const MOWN = [["#b9c48b", "#bdc991"], ["#b2bf84", "#b6c388"], ["#abb97d", "#afbc81"]];
  const mixTo = new THREE.Color();
  const mix = (from: string, to: string, t: number) => "#" + tone.set(from).lerp(mixTo.set(to), t).getHexString();
  const smooth = (a: number, b: number, t: number) => {
    const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  /** Paint a square of ground. Ground tone follows the canopy, so gaps read as more crop, not dirt. */
  function drawCell(i: number) {
    const col = i % columns, row = Math.floor(i / columns), x = col * PIXELS, y = row * PIXELS;
    const state = engine.cells[i], crop = engine.cropAt(i), progress = state === Ground.mature ? 1 : engine.progress[i];
    const band = row % 8 < 4 ? 0 : 1;
    const furrows = (colour: string) => {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y + 1.5, PIXELS, 1);
      ctx.fillRect(x, y + 5.5, PIXELS, 1);
    };
    if (state === Ground.grass) {
      ctx.fillStyle = GRASS[band];
      ctx.fillRect(x, y, PIXELS, PIXELS);
    } else if (state === Ground.mown) {
      ctx.fillStyle = MOWN[engine.stage(i)][band];
      ctx.fillRect(x, y, PIXELS, PIXELS);
    } else if (state === Ground.soil) {
      ctx.fillStyle = SOIL[band];
      ctx.fillRect(x, y, PIXELS, PIXELS);
      furrows("rgba(104,77,52,.26)");
    } else if (state === Ground.stubble) {
      const was = CROPS[lastCrop[i] - 1];
      if (was === "sunflowers") {
        ctx.fillStyle = band ? "#c4b086" : "#bfab80";
        ctx.fillRect(x, y, PIXELS, PIXELS);
        ctx.fillStyle = "rgba(120,110,70,.35)";
        ctx.fillRect(x + 3, y + 3, 2.4, 2.4);
      } else if (was === "pumpkins") {
        ctx.fillStyle = band ? "#bcab7c" : "#b6a576";
        ctx.fillRect(x, y, PIXELS, PIXELS);
        ctx.strokeStyle = "rgba(110,120,70,.5)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        const bend = (cellNoise(i, 31) - 0.5) * 5;
        ctx.moveTo(x, y + 4 + bend);
        ctx.quadraticCurveTo(x + 4, y + 4 - bend, x + PIXELS, y + 4 + bend * 0.6);
        ctx.stroke();
      } else {
        // Straw in two bright drill lines: a cut lane reads as combed.
        ctx.fillStyle = band ? "#decb92" : "#d9c58a";
        ctx.fillRect(x, y, PIXELS, PIXELS);
        furrows("#c2a865");
      }
    } else {
      // Seed marks fade as the canopy closes over them, with no step between the two.
      const seeds = 1 - smooth(0.1, 0.36, progress), canopy = smooth(0.12, 0.6, progress);
      if (crop === "wheat") {
        ctx.fillStyle = mix(mix(SOIL[band], "#9a8a52", canopy), "#b8964d", smooth(0.62, 1, progress));
        ctx.fillRect(x, y, PIXELS, PIXELS);
        furrows(`rgba(96,74,42,${0.26 + 0.06 * canopy})`);
        if (seeds > 0) {
          ctx.fillStyle = `rgba(237,207,136,${seeds})`;
          for (const [dx, dy] of [[1, 1.2], [5, 1.2], [3, 5.2], [7, 5.2]]) ctx.fillRect(x + dx - 0.8, y + dy, 1.9, 1.4);
        }
      } else if (crop === "sunflowers") {
        ctx.fillStyle = mix(band ? "#8e8056" : "#82754e", "#676a3e", canopy);
        ctx.fillRect(x, y, PIXELS, PIXELS);
        if (seeds > 0) {
          ctx.fillStyle = `rgba(244,225,176,${seeds})`;
          ctx.beginPath();
          ctx.ellipse(x + 4, y + 4, 1.3, 1.9, -0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(109,97,69,${seeds})`;
          ctx.fillRect(x + 3.6, y + 2.9, 0.8, 2.2);
        }
        // A soft pool of shade under each plant, on the side away from the sun.
        ctx.fillStyle = `rgba(42,52,28,${0.24 * canopy})`;
        ctx.beginPath();
        ctx.ellipse(x + 5.2, y + 3.4, 2.9, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = mix(SOIL[band], "#66884c", smooth(0.14, 0.5, progress));
        ctx.fillRect(x, y, PIXELS, PIXELS);
        if (seeds > 0) {
          ctx.fillStyle = `rgba(234,161,91,${seeds})`;
          ctx.fillRect(x + 1, y + 1.5, 2.6, 1.4);
          ctx.fillRect(x + 4.6, y + 5.2, 2.6, 1.4);
        }
      }
    }
  }

  let groundDirty = false;
  const groundLevel = new Uint8Array(count);
  const level = (i: number) => (engine.cells[i] === Ground.mature ? 12 : Math.floor(engine.progress[i] * 12));
  function paint(i: number) {
    groundLevel[i] = level(i);
    drawCell(i);
    groundDirty = true;
  }

  const cropLayers = (crop: Crop) => (crop === "wheat" ? layers.wheat : crop === "sunflowers" ? layers.sunflowers : layers.vines);
  const stubbleLayers = (crop: number) =>
    crop === 2 ? layers.stubbleSunflowers : crop === 3 ? layers.stubblePumpkins : layers.stubbleWheat;
  const everyCellLayer = [...layers.grass, ...layers.wheat, ...layers.sunflowers, ...layers.vines, ...layers.fruit,
    ...layers.stubbleWheat, ...layers.stubbleSunflowers, ...layers.stubblePumpkins];

  /** Stand the right plant in a square, or clear it. `keep` leaves a falling plant alone. */
  function plantCell(i: number, keep?: Layer) {
    for (const l of everyCellLayer) if (l !== keep) l.remove(i);
    const state = engine.cells[i], x = cellX(i), z = cellZ(i), variant = Math.floor(cellNoise(i, 1) * VARIANTS);
    const seed = cellNoise(i, 2), turn = cellNoise(i, 3) * Math.PI * 2;
    if (state === Ground.grass || (state === Ground.mown && engine.stage(i) > 0)) {
      const height = state === Ground.grass ? 0.8 + cellNoise(i, 4) * 0.5 : (0.8 + cellNoise(i, 4) * 0.5) * (engine.stage(i) === 1 ? 0.3 : 0.6);
      layers.grass[variant].add(i, place(x + (seed - 0.5) * 0.2, z + (cellNoise(i, 5) - 0.5) * 0.2, turn, 1, height, 1), seed, 1);
    } else if (state === Ground.stubble) {
      const yaw = lastCrop[i] === 1 ? 0 : turn;
      stubbleLayers(lastCrop[i])[variant].add(i, place(x, z, yaw, 1), seed, 1);
    } else if (state === Ground.growing || state === Ground.mature) {
      const crop = engine.cropAt(i)!, grow = state === Ground.mature ? 1 : engine.progress[i];
      if (crop === "wheat") {
        const wide = 0.94 + cellNoise(i, 6) * 0.2;
        layers.wheat[variant].add(i, place(x + (seed - 0.5) * 0.1, z + (cellNoise(i, 5) - 0.5) * 0.1, turn, wide, 0.88 + cellNoise(i, 7) * 0.28, wide), seed, grow);
      } else if (crop === "sunflowers") {
        // Odd rows step half a pace sideways, so faces nest instead of lining up.
        const stagger = Math.floor(i / columns) % 2 ? 0.12 : -0.12;
        const size = 0.9 + cellNoise(i, 6) * 0.2;
        layers.sunflowers[variant].add(
          i,
          place(x + stagger + (seed - 0.5) * 0.1, z + (cellNoise(i, 5) - 0.5) * 0.1, SUNFLOWER_FACING + (cellNoise(i, 8) - 0.5) * 0.5, size),
          seed, grow,
        );
      } else {
        const size = 0.95 + cellNoise(i, 6) * 0.3;
        layers.vines[variant].add(i, place(x + (seed - 0.5) * 0.16, z + (cellNoise(i, 5) - 0.5) * 0.16, turn, size), seed, grow);
        if (hasFruit(i)) {
          const pose = fruitPose(i);
          layers.fruit[0].add(i, place(pose.x, pose.z, pose.yaw, pose.size), seed, grow);
        }
      }
    }
  }

  function standBundle(tile: number, crop: Crop, scale = 1) {
    const at = tileCentre(tile);
    const yaw = crop === "wheat" ? (cellNoise(tile, 93) - 0.5) * 0.2 : cellNoise(tile, 93) * Math.PI * 2;
    bundles[crop].add(tile, place(at.x, at.z, yaw, scale), cellNoise(tile, 94), 1);
  }
  /** Decide from the stubble alone whether a tile's bundle stands. Returns the crop if it just appeared. */
  function refreshTile(tile: number, animate: boolean): Crop | undefined {
    const tc = tile % tileColumns, tr = Math.floor(tile / tileColumns);
    const tally = [0, 0, 0, 0];
    let cells = 0;
    for (let r = tr * TILE.rows; r < Math.min(rows, (tr + 1) * TILE.rows); r++)
      for (let c = tc * TILE.columns; c < Math.min(columns, (tc + 1) * TILE.columns); c++) {
        cells++;
        const i = r * columns + c;
        if (engine.cells[i] === Ground.stubble) tally[lastCrop[i]]++;
      }
    let next = 0;
    for (let crop = 1; crop <= 3; crop++) if (tally[crop] >= cells * TILE_SHARE) next = crop;
    const before = tileBundle[tile];
    if (next === before) return;
    if (before) {
      bundles[CROPS[before - 1]].remove(tile);
      for (let k = settling.length - 1; k >= 0; k--) if (settling[k].tile === tile) settling.splice(k, 1);
    }
    tileBundle[tile] = next;
    if (!next) return;
    const crop = CROPS[next - 1];
    if (animate && motion) {
      standBundle(tile, crop, 0.001);
      settling.push({ tile, crop, age: 0 });
    } else standBundle(tile, crop);
    return crop;
  }

  function syncAll() {
    for (const l of everyCellLayer) l.clear();
    for (const crop of CROPS) bundles[crop].clear();
    loose.clear();
    flying.length = settling.length = falling.length = ripening.length = motes.length = 0;
    chaff.count = 0;
    tileBundle.fill(0);
    for (let i = 0; i < count; i++) {
      if (engine.cells[i] !== Ground.stubble) lastCrop[i] = 0;
      else if (!lastCrop[i]) lastCrop[i] = 1;
      paint(i);
      plantCell(i);
    }
    for (let tile = 0; tile < tileBundle.length; tile++) refreshTile(tile, false);
  }

  function puff(crop: Crop, x: number, y: number, z: number, heading: number, amount: number) {
    const tones = CHAFF_TONES[crop];
    for (let k = 0; k < amount && motes.length < CHAFF; k++)
      motes.push({
        p: new THREE.Vector3(x + (Math.random() - 0.5) * 0.4, y * (0.5 + Math.random() * 0.6), z + (Math.random() - 0.5) * 0.4),
        v: new THREE.Vector3(
          -Math.sin(heading) * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.9 + 0.5,
          0.9 + Math.random() * 1.5,
          -Math.cos(heading) * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.9,
        ),
        spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        life: 0, span: 0.9 + Math.random() * 0.9,
        size: crop === "wheat" ? 0.05 + Math.random() * 0.05 : 0.07 + Math.random() * 0.07,
        tone: new THREE.Color(tones[Math.floor(Math.random() * tones.length)]),
      });
  }

  /**
   * Draw what the engine just did. Pass the heading of the cutter so cut plants
   * fall the way it is travelling. Returns what a harvest left, for sound.
   */
  function respond(events: FarmingEvents, heading = -Math.PI / 2): HarvestMoment[] {
    const harvested = new Map<number, Crop>();
    for (const result of events.harvestResults)
      for (const cell of result.cells) {
        harvested.set(cell, result.crop);
        lastCrop[cell] = CROPS.indexOf(result.crop) + 1;
      }
    const tiles = new Set<number>();
    for (const i of events.groundChanges) {
      if (engine.cells[i] !== Ground.stubble) lastCrop[i] = 0;
      paint(i);
      tiles.add(tileOf(i));
      const crop = harvested.get(i);
      const standing = crop && cropLayers(crop).find((l) => l.has(i));
      if (crop && standing && motion) {
        plantCell(i, standing);
        // Vines wilt where they lie; anything taller falls the way the cutter is going.
        falling.push({ layer: standing, cell: i, age: 0, direction: crop === "pumpkins" ? 100 : heading });
        puff(crop, cellX(i), crop === "sunflowers" ? 1.5 : crop === "wheat" ? 0.8 : 0.3, cellZ(i), heading, crop === "wheat" ? 2 : 1);
      } else plantCell(i);
      if (crop === "pumpkins" && hasFruit(i) && motion) {
        const pose = fruitPose(i), at = tileCentre(tileOf(i));
        flying.push({
          key: looseKey++, from: new THREE.Vector3(pose.x, 0.05, pose.z), to: new THREE.Vector3(at.x, 0.05, at.z),
          size: pose.size, yaw: pose.yaw, age: 0,
        });
      }
    }
    for (const i of [...events.cropStages, ...events.grassRegrowth]) {
      paint(i);
      if (engine.cells[i] !== Ground.growing && engine.cells[i] !== Ground.mature) plantCell(i);
    }
    // Ripening arrives in the order the row was sown, at the pace it was sown.
    if (motion) for (const cell of events.cropMaturities) ripening.push({ cell, age: 0 });
    const moments = new Map<string, HarvestMoment>();
    for (const result of events.harvestResults) {
      const row = Math.floor(result.cells[0] / columns);
      const lane = Math.min(9, Math.floor((row * 10) / rows));
      moments.set(result.crop, { crop: result.crop, lane, cells: result.cells.length, bundles: [] });
    }
    for (const tile of tiles) {
      const crop = refreshTile(tile, true);
      if (crop) moments.get(crop)?.bundles.push(tileCentre(tile));
    }
    return [...moments.values()];
  }

  let sinceGrowth = 0;
  /** Growth is the engine's own progress, read a few times a second: no pops. */
  function readGrowth() {
    for (const set of [layers.wheat, layers.sunflowers, layers.vines, layers.fruit])
      for (const l of set)
        for (let slot = 0; slot < l.count; slot++) {
          const i = l.keyAt(slot);
          if (engine.cells[i] === Ground.growing) l.setGrow(slot, engine.progress[i]);
          else if (engine.cells[i] === Ground.mature) l.setGrow(slot, 1);
        }
    for (let i = 0; i < count; i++)
      if ((engine.cells[i] === Ground.growing || engine.cells[i] === Ground.mature) && groundLevel[i] !== level(i)) paint(i);
  }

  const ease = (t: number) => t * t * (3 - 2 * t);
  function update(dt: number, time: number, gustFront: number | null = null) {
    plantUniforms.uTime.value = time;
    plantUniforms.uGustFront.value = gustFront ?? -1e6;
    sinceGrowth += dt;
    if (sinceGrowth > 0.2) {
      sinceGrowth = 0;
      readGrowth();
    }
    for (let k = ripening.length - 1; k >= 0; k--) {
      const r = ripening[k];
      r.age += dt / 0.9;
      const pulse = r.age >= 1 ? 0 : Math.sin(Math.min(1, r.age * 3) * Math.PI * 0.5) * (1 - r.age);
      const crop = engine.cropAt(r.cell);
      if (crop) for (const l of [...cropLayers(crop), ...(crop === "pumpkins" ? layers.fruit : [])]) l.setPulse(r.cell, pulse);
      if (r.age >= 1) ripening.splice(k, 1);
    }
    for (let k = falling.length - 1; k >= 0; k--) {
      const f = falling[k];
      f.age += dt / 0.5;
      if (f.age >= 1) {
        f.layer.remove(f.cell);
        falling.splice(k, 1);
      } else f.layer.setCut(f.cell, f.age, f.direction);
    }
    for (let k = flying.length - 1; k >= 0; k--) {
      const f = flying[k];
      f.age += dt / 0.62;
      if (f.age >= 1) {
        loose.remove(f.key);
        flying.splice(k, 1);
        continue;
      }
      const t = ease(f.age), hop = Math.sin(f.age * Math.PI) * 0.7;
      dummy.position.lerpVectors(f.from, f.to, t);
      dummy.position.y += hop;
      dummy.rotation.set(f.age * 2.4, f.yaw, 0);
      dummy.scale.setScalar(f.size * (1 - 0.35 * t));
      dummy.updateMatrix();
      if (loose.has(f.key)) loose.setMatrix(f.key, dummy.matrix);
      else loose.add(f.key, dummy.matrix, 0.5, 1);
    }
    for (let k = settling.length - 1; k >= 0; k--) {
      const s = settling[k];
      s.age += dt / 0.42;
      const t = Math.min(1, s.age);
      // Lands with a little give, like something with weight set down.
      const scale = t < 0.7 ? ease(t / 0.7) * 1.08 : 1.08 - 0.08 * ease((t - 0.7) / 0.3);
      const at = tileCentre(s.tile);
      const yaw = s.crop === "wheat" ? (cellNoise(s.tile, 93) - 0.5) * 0.2 : cellNoise(s.tile, 93) * Math.PI * 2;
      bundles[s.crop].setMatrix(s.tile, place(at.x, at.z, yaw, scale, scale * (t < 0.7 ? 1 : 2 - scale), scale, 0.05 + (1 - ease(t)) * 0.35));
      if (s.age >= 1) settling.splice(k, 1);
    }
    for (let k = motes.length - 1; k >= 0; k--) {
      const m = motes[k];
      m.life += dt;
      if (m.life >= m.span) {
        motes.splice(k, 1);
        continue;
      }
      m.v.y -= 2.6 * dt;
      m.v.multiplyScalar(1 - 1.6 * dt);
      m.p.addScaledVector(m.v, dt);
      if (m.p.y < 0.08) m.p.y = 0.08;
    }
    chaff.count = motes.length;
    motes.forEach((m, k) => {
      const fade = 1 - Math.max(0, (m.life / m.span - 0.6) / 0.4);
      dummy.position.copy(m.p);
      dummy.rotation.set(m.spin.x * m.life, m.spin.y * m.life, m.spin.z * m.life);
      dummy.scale.setScalar(m.size * fade);
      dummy.updateMatrix();
      chaff.setMatrixAt(k, dummy.matrix);
      chaff.setColorAt(k, m.tone);
    });
    if (motes.length) {
      chaff.instanceMatrix.needsUpdate = true;
      if (chaff.instanceColor) chaff.instanceColor.needsUpdate = true;
    }
    flush();
  }
  /** Send repainted ground to the GPU. `update` does this; a still drawn without it must too. */
  function flush() {
    if (!groundDirty) return;
    texture.needsUpdate = true;
    groundDirty = false;
  }

  syncAll();
  return {
    group,
    engine,
    respond,
    syncAll,
    update,
    flush,
    /** Read growth now, for a time-lapse that moves faster than the usual reading. */
    readGrowth,
    setMotion(value: boolean) {
      motion = value;
    },
    /** Triangles on screen right now: only what is planted is drawn. */
    get triangles() {
      let total = 2 + chaff.count * 2;
      for (const l of [...everyCellLayer, bundles.wheat, bundles.sunflowers, bundles.pumpkins, loose]) total += l.count * l.triangles;
      return total;
    },
    get busy() {
      return falling.length + flying.length + settling.length + ripening.length + motes.length > 0;
    },
    tileCentre,
    /** The pitch lane (0 at the far side) a cell sits in. */
    laneOf: (cell: number) => Math.min(9, Math.floor((Math.floor(cell / columns) * 10) / rows)),
    palette: PALETTE,
    dispose() {
      scene.remove(group);
      texture.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      material.dispose();
      quiet.dispose();
    },
  };
}
export type StudyField = ReturnType<typeof createStudyField>;
