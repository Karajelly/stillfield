import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CROPS } from "./farming";
import type { Crop, FarmingEngine } from "./farming";
import { seededRandom } from "./simulation";

/**
 * The lasting mark of a harvest. The displays by the barn path fill within
 * the first plot; the yard keeps filling for about a whole field of each crop:
 * potted sunflowers along the lane to the barn, wheat stooks along the near
 * lane, and pumpkins gathering against the barn. Nothing is counted on screen and
 * nothing is ever taken away, except by a fresh meadow.
 */
export const CELLS_PER_PIECE = 100;

/** The first piece comes at half a measure, so a starter plot earns one. */
export function yardPieces(gathered: number, slots: number) {
  if (!Number.isFinite(gathered) || gathered <= 0) return 0;
  return Math.min(
    slots,
    Math.floor((gathered + CELLS_PER_PIECE / 2) / CELLS_PER_PIECE),
  );
}

export interface YardSlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Offsets 0, 1, -1, 2, -2…: a row that grows evenly from its middle. */
const outward = (index: number) => (index % 2 ? (index + 1) / 2 : -index / 2);

/**
 * Every piece's place, in the order pieces arrive. All of them stand on grass
 * verges clear of the lanes (see the loop lane and barn in world.ts), and none
 * of them is an obstacle.
 */
export function yardSlots(): Record<Crop, YardSlot[]> {
  const random = seededRandom(41);
  const vary = (amount: number) => (random() - 0.5) * 2 * amount;

  // Pots line the far lane on the way to the barn, turned toward the view.
  const sunflowers: YardSlot[] = Array.from({ length: 41 }, (_, i) => ({
    x: -0.2 + outward(i) * 0.75,
    y: 0.1,
    z: -18.1 + vary(0.04),
    yaw: 0.7 + vary(0.3),
    scale: 0.92 + random() * 0.14,
  }));

  // Stooks stand along the far verge of the near lane, golden against grass.
  const wheat: YardSlot[] = Array.from({ length: 33 }, (_, i) => ({
    x: -1.85 + outward(i) * 0.95,
    y: 0.1,
    z: 19.95 + vary(0.05),
    yaw: random() * Math.PI * 2,
    scale: 1.05 + random() * 0.18,
  }));

  // Pumpkins flank the barn doors, then run along its sunny wall.
  const pumpkins: YardSlot[] = [];
  const pumpkin = (
    x: number,
    z: number,
    y = 0.1,
    scale = 0.84 + random() * 0.26,
  ) =>
    pumpkins.push({
      x: x + vary(0.05),
      y,
      z: z + vary(0.05),
      yaw: random() * Math.PI * 2,
      scale,
    });
  const step = 0.76,
    frontZ = -20.06,
    leftX = -25.3,
    rightX = -20.7,
    wallX = -18.06,
    wallZ = -21.2;
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++) {
      pumpkin(leftX - col * step, frontZ + row * 0.7);
      pumpkin(rightX + col * step, frontZ + row * 0.7);
    }
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 5; col++)
      pumpkin(wallX + row * 0.7, wallZ - col * step);
  // A third, shorter row before the doors.
  for (let col = 0; col < 3; col++) {
    pumpkin(leftX - col * step, frontZ + 1.4);
    pumpkin(rightX + col * step, frontZ + 1.4);
  }
  // The last few rest on top, nestled between four below.
  for (let col = 0; col < 3; col++) {
    pumpkin(leftX - (col + 0.5) * step, frontZ + 0.35, 0.46, 0.8);
    pumpkin(rightX + (col + 0.5) * step, frontZ + 0.35, 0.46, 0.8);
  }
  for (let col = 0; col < 4; col++)
    pumpkin(wallX + 0.35, wallZ - (col + 0.5) * step, 0.46, 0.8);

  return { wheat, sunflowers, pumpkins };
}

/** One part of a piece, tinted through vertex colours so a piece is one mesh. */
function part(
  geometry: THREE.BufferGeometry,
  color: string,
  place: (g: THREE.BufferGeometry) => void,
) {
  place(geometry);
  const c = new THREE.Color(color),
    count = geometry.getAttribute("position").count,
    colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}

function merged(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return geometry;
}

/** Three sunflowers in a terracotta pot, as in the display by the barn path. */
function potGeometry() {
  const parts = [
    part(new THREE.CylinderGeometry(0.22, 0.16, 0.3, 9), "#bd9679", (g) =>
      g.translate(0, 0.15, 0),
    ),
  ];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.4,
      x = Math.sin(a) * 0.14,
      z = Math.cos(a) * 0.14,
      h = 0.62 + i * 0.09,
      head = 0.15 + h;
    parts.push(
      part(new THREE.CylinderGeometry(0.018, 0.022, h, 4), "#718b51", (g) =>
        g.translate(x, 0.15 + h / 2, z),
      ),
    );
    for (let j = 0; j < 8; j++) {
      const b = (j / 8) * Math.PI * 2;
      parts.push(
        part(new THREE.SphereGeometry(0.095, 5, 3), "#e4c45e", (g) => {
          g.scale(0.8, 1, 0.35);
          g.translate(x + Math.sin(b) * 0.14, head + Math.cos(b) * 0.14, z);
        }),
      );
    }
    parts.push(
      part(new THREE.SphereGeometry(0.09, 6, 4), "#75634a", (g) => {
        g.scale(1, 1, 0.4);
        g.translate(x, head, z + 0.025);
      }),
    );
  }
  return merged(parts);
}

/** Five sheaves leaning together, tied below their ears. */
function stookGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const sheaves = 5,
    lean = 0.15,
    height = 0.86;
  for (let i = 0; i < sheaves; i++) {
    const a = (i / sheaves) * Math.PI * 2;
    // Stand each sheaf on a small circle and tip it toward the middle.
    const stand = (g: THREE.BufferGeometry) => {
      g.rotateX(-lean);
      g.translate(0, 0, 0.21);
      g.rotateY(a);
    };
    parts.push(
      part(
        new THREE.CylinderGeometry(0.05, 0.085, height, 5),
        "#cbb36a",
        (g) => {
          g.translate(0, height / 2, 0);
          stand(g);
        },
      ),
      part(new THREE.SphereGeometry(0.1, 5, 4), "#ddc176", (g) => {
        g.scale(0.8, 2.1, 0.8);
        g.translate(0, height + 0.08, 0);
        stand(g);
      }),
    );
  }
  parts.push(
    part(new THREE.TorusGeometry(0.115, 0.028, 4, 10), "#ad8861", (g) => {
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.6, 0);
    }),
  );
  return merged(parts);
}

/** A lobed pumpkin with a short stalk, as in the cart by the barn path. */
function pumpkinGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(
      part(new THREE.SphereGeometry(0.27, 6, 4), "#ce884a", (g) => {
        g.scale(0.85, 0.87, 0.85);
        g.translate(Math.sin(a) * 0.12, 0.235, Math.cos(a) * 0.12);
      }),
    );
  }
  parts.push(
    part(new THREE.CylinderGeometry(0.035, 0.05, 0.17, 5), "#75634a", (g) =>
      g.translate(0, 0.5, 0),
    ),
  );
  return merged(parts);
}

const RISE_SECONDS = 0.6;

export function createHarvestYard(scene: THREE.Scene, farm: FarmingEngine) {
  const slots = yardSlots();
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 1,
    vertexColors: true,
  });
  const geometries: Record<Crop, THREE.BufferGeometry> = {
    wheat: stookGeometry(),
    sunflowers: potGeometry(),
    pumpkins: pumpkinGeometry(),
  };
  const dummy = new THREE.Object3D();
  // One instanced mesh per crop keeps the whole yard to three draw calls.
  const rows = {} as Record<
    Crop,
    {
      mesh: THREE.InstancedMesh;
      /** Pieces already standing or promised to a delivery in flight. */
      claimed: number;
      /** Seconds since each easing piece touched down. */
      rising: Map<number, number>;
    }
  >;
  function place(crop: Crop, index: number, grown: number) {
    const slot = slots[crop][index];
    dummy.position.set(slot.x, slot.y, slot.z);
    dummy.rotation.set(0, slot.yaw, 0);
    dummy.scale.setScalar(slot.scale * grown);
    dummy.updateMatrix();
    rows[crop].mesh.setMatrixAt(index, dummy.matrix);
    rows[crop].mesh.instanceMatrix.needsUpdate = true;
  }
  for (const crop of CROPS) {
    const mesh = new THREE.InstancedMesh(
      geometries[crop],
      material,
      slots[crop].length,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    rows[crop] = { mesh, claimed: 0, rising: new Map() };
  }
  const earned = (crop: Crop) =>
    yardPieces(farm.gathered[crop], slots[crop].length);
  /** Show exactly what the tally has earned, with nothing in motion. */
  function sync() {
    for (const crop of CROPS) {
      const row = rows[crop],
        count = earned(crop);
      row.rising.clear();
      row.claimed = count;
      for (let i = 0; i < slots[crop].length; i++)
        place(crop, i, i < count ? 1 : 0);
    }
  }
  sync();
  return {
    sync,
    /** Indices of pieces the tally has earned since the last call. */
    claim(crop: Crop): number[] {
      const row = rows[crop],
        count = earned(crop),
        fresh: number[] = [];
      while (row.claimed < count) fresh.push(row.claimed++);
      return fresh;
    },
    /** Where a delivery for this piece should land. */
    landing(crop: Crop, index: number) {
      const slot = slots[crop][index];
      return new THREE.Vector3(slot.x, slot.y + 0.5, slot.z);
    },
    /** Stand a claimed piece in its place, easing up unless told otherwise. */
    reveal(crop: Crop, index: number, ease = true) {
      if (ease) rows[crop].rising.set(index, 0);
      place(crop, index, ease ? 0 : 1);
    },
    update(dt: number) {
      for (const crop of CROPS) {
        const row = rows[crop];
        for (const [index, age] of row.rising) {
          const t = Math.min(1, (age + dt) / RISE_SECONDS);
          if (t === 1) row.rising.delete(index);
          else row.rising.set(index, age + dt);
          // Settle a touch past full size, then relax.
          const back = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
          place(crop, index, t === 1 ? 1 : Math.max(0, back));
        }
      }
    },
  };
}
