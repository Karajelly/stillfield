import * as THREE from "three";
import { FIELD, FIELD_COLUMNS } from "./simulation";
import type { Crop } from "./farming";

/** What the implement is throwing up: turned soil, falling seed, or cut crop. */
export type WorkKind = "cultivate" | "sow" | "harvest";

const COUNT = 96;
// A shade darker than the bed, so turned earth shows against fresh soil.
const SOIL = ["#a98863", "#8f7453", "#7d6548"];
const SEED: Record<Crop, string[]> = {
  wheat: ["#edcf88", "#e2c076"],
  sunflowers: ["#f4e1b0", "#6d6145"],
  pumpkins: ["#eaa15b", "#f0b877"],
};
const CHAFF: Record<Crop, string[]> = {
  wheat: ["#ddc176", "#cbb36a", "#e8d595"],
  sunflowers: ["#e4c45e", "#f0d77c", "#78934e"],
  pumpkins: ["#78934e", "#8aa35c", "#ce884a"],
};
// Soil is heavy and drops quickly, seed falls from the hopper, chaff drifts.
const MOTION: Record<
  WorkKind,
  {
    perCell: number;
    up: [number, number];
    back: number;
    drift: number;
    gravity: number;
    life: [number, number];
    size: [number, number];
    from: number;
  }
> = {
  cultivate: {
    perCell: 0.6,
    up: [1.7, 2.9],
    back: 1.5,
    drift: 0.5,
    gravity: 7,
    life: [0.45, 0.7],
    size: [0.8, 1.5],
    from: 0.1,
  },
  sow: {
    perCell: 0.35,
    up: [0, 0.4],
    back: 0.2,
    drift: 0.15,
    gravity: 5,
    life: [0.3, 0.45],
    size: [0.45, 0.7],
    from: 0.55,
  },
  harvest: {
    perCell: 0.7,
    up: [1.3, 2.5],
    back: 0.5,
    drift: 0.9,
    gravity: 3.6,
    life: [0.7, 1.1],
    size: [0.6, 1.3],
    from: 0.35,
  },
};

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  gravity: number;
}

/**
 * Small matte flecks where the ground actually changed. They are presentation
 * only: the engine's events decide where and when, and nothing here feeds back.
 */
export function createWorkEffects(scene: THREE.Scene) {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.085, 0),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 }),
    COUNT,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  const bits: Bit[] = Array.from({ length: COUNT }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
    life: 0,
    size: 0,
    spin: 0,
    gravity: 0,
  }));
  dummy.scale.setScalar(0);
  dummy.updateMatrix();
  for (let i = 0; i < COUNT; i++) {
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set("#ffffff"));
  }
  scene.add(mesh);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const between = ([min, max]: [number, number]) =>
    min + Math.random() * (max - min);
  let next = 0,
    owed = 0,
    live = 0;
  return {
    /** Throw a few flecks from the cells the implement just worked. */
    emit(
      kind: WorkKind,
      cells: number[],
      heading: number,
      crop: Crop = "wheat",
    ) {
      if (reduced || !cells.length) return;
      const motion = MOTION[kind];
      const colors =
        kind === "cultivate" ? SOIL : kind === "sow" ? SEED[crop] : CHAFF[crop];
      // Carry the fraction over, so a slow pass still sheds the occasional fleck.
      owed += cells.length * motion.perCell;
      const backX = -Math.sin(heading),
        backZ = -Math.cos(heading);
      for (; owed >= 1; owed--) {
        const cell = cells[Math.floor(Math.random() * cells.length)];
        const bit = bits[next];
        if (bit.age >= bit.life) live++;
        bit.x =
          FIELD.minX + ((cell % FIELD_COLUMNS) + Math.random()) * FIELD.cell;
        bit.z =
          FIELD.minZ +
          (Math.floor(cell / FIELD_COLUMNS) + Math.random()) * FIELD.cell;
        bit.y = motion.from;
        const back = motion.back * (0.4 + Math.random() * 0.6),
          drift = (Math.random() - 0.5) * 2 * motion.drift;
        bit.vx = backX * back + backZ * drift;
        bit.vz = backZ * back - backX * drift;
        bit.vy = between(motion.up);
        bit.age = 0;
        bit.life = between(motion.life);
        bit.size = between(motion.size);
        bit.spin = (Math.random() - 0.5) * 9;
        bit.gravity = motion.gravity;
        mesh.setColorAt(
          next,
          color.set(colors[Math.floor(Math.random() * colors.length)]),
        );
        next = (next + 1) % COUNT;
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    update(dt: number) {
      if (!live) return;
      live = 0;
      for (let i = 0; i < COUNT; i++) {
        const bit = bits[i];
        if (bit.age >= bit.life) continue;
        bit.age += dt;
        bit.vy -= bit.gravity * dt;
        bit.x += bit.vx * dt;
        bit.y = Math.max(0.06, bit.y + bit.vy * dt);
        bit.z += bit.vz * dt;
        const t = Math.min(1, bit.age / bit.life);
        // Ease out at the end instead of popping away.
        const scale = t >= 1 ? 0 : bit.size * (1 - t * t * t);
        if (scale > 0) live++;
        dummy.position.set(bit.x, bit.y, bit.z);
        dummy.rotation.set(bit.spin * bit.age, bit.spin * bit.age * 0.7, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    clear() {
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      for (let i = 0; i < COUNT; i++) {
        bits[i].age = bits[i].life = 0;
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      live = 0;
      owed = 0;
    },
  };
}
