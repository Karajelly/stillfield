import * as THREE from "three";
import type { Crop } from "../../src/farming";
import { churn, pumpkinFruit, stook, PALETTE } from "./crops";
import { createPlantMaterial, createPlantMesh, PlantGeometry } from "./plant-material";
import type { PartStyle } from "./plant-material";

/**
 * A yard that never fills. Today each crop's display shows 1, 4, then 9 items
 * and is full after 64 squares, for good. Here every fourfold harvest adds
 * something you can see from the field: 1, 16, 64, 256, 1,024, 4,096 and
 * 16,384 squares. The first three are today's own steps; the rest carry on
 * from them. Still decoration, never an inventory: nothing is counted on screen.
 */
export const YARD_STEPS = [1, 16, 64, 256, 1024, 4096, 16384];
export const yardStage = (squares: number) => YARD_STEPS.filter((step) => squares >= step).length;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const still: [number, number] = [-1, -0.5];

/** A round corn rick with a thatched cap, one metre in radius; the yard scales it. */
function rick() {
  const g = new PlantGeometry();
  const straw = (colour: string): PartStyle => ({ a: colour, b: colour, appear: still, flex: 0 });
  const sides = 16;
  const ring = (radius: number, y: number, i: number) => V(Math.cos((i / sides) * Math.PI * 2) * radius, y, Math.sin((i / sides) * Math.PI * 2) * radius);
  const out = (i: number, lift = 0.15) => V(Math.cos((i / sides) * Math.PI * 2), lift, Math.sin((i / sides) * Math.PI * 2)).normalize();
  // Courses of sheaves, each a shade apart, swelling toward the eaves.
  const courses: [number, number, number, string][] = [[0.86, 0, 0.36, "#cfa650"], [0.94, 0.36, 0.72, "#d8b25a"], [1.0, 0.72, 1.06, "#cfa650"]];
  for (const [radius, y0, y1, colour] of courses) {
    g.part(straw(colour), V(0, 0, 0));
    for (let i = 0; i < sides; i++)
      g.smooth(ring(radius, y0, i), out(i), ring(radius, y0, i + 1), out(i + 1), ring(radius + 0.06, y1, i + 1), out(i + 1))
        .smooth(ring(radius, y0, i), out(i), ring(radius + 0.06, y1, i + 1), out(i + 1), ring(radius + 0.06, y1, i), out(i));
  }
  g.part(straw("#b98f43"), V(0, 0, 0));
  const apex = V(0, 2.02, 0);
  for (let i = 0; i < sides; i++)
    g.smooth(ring(1.16, 1.02, i), out(i, 0.9), ring(1.16, 1.02, i + 1), out(i + 1, 0.9), apex, V(0, 1, 0), [i % 2 ? 0.94 : 1.04, i % 2 ? 0.94 : 1.04, 1.1]);
  // A twist of straw at the peak, the thatcher's signature.
  g.part(straw(PALETTE.wheatEar), V(0, 0, 0));
  g.ellipsoid(V(0, 2.1, 0), V(0, 1, 0), 0.26, 0.09, 6, 3);
  return g;
}

/** The yard runs along the north side of the lane, between the barn door and the fenced plot. */
export function createYard(scene: THREE.Scene, at = { x: -12, z: -17.6 }) {
  const group = new THREE.Group();
  group.name = "yard";
  scene.add(group);
  const material = createPlantMaterial(0.82);
  const make = (geometry: PlantGeometry, capacity: number) => {
    const made = createPlantMesh(geometry.build(), material, capacity);
    made.mesh.castShadow = true;
    group.add(made.mesh);
    return made;
  };
  const ricks = make(rick(), 4), stooks = make(stook(), 6), churns = make(churn(), 28), fruit = make(pumpkinFruit(), 64);
  const dummy = new THREE.Object3D();
  const put = (made: ReturnType<typeof make>, items: [number, number, number, number, number?][]) => {
    made.mesh.count = items.length;
    items.forEach(([x, y, z, scale, yaw = 0], i) => {
      dummy.position.set(at.x + x, 0.02 + y, at.z + z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      made.mesh.setMatrixAt(i, dummy.matrix);
      made.plant.setXYZW(i, (i * 0.37) % 1, 1, 0, 0);
    });
    made.mesh.instanceMatrix.needsUpdate = true;
    made.plant.needsUpdate = true;
  };
  const noise = (i: number) => ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;

  /** Show the yard as it stands after this many squares of each crop. */
  function set(squares: Record<Crop, number>) {
    const wheat = yardStage(squares.wheat), sun = yardStage(squares.sunflowers), pumpkin = yardStage(squares.pumpkins);
    // Wheat: a stook, then ricks that grow and multiply westward along the lane.
    const rickSets: [number, number, number, number][][] = [
      [], [], [], [[-3.4, 0, -0.6, 0.8]], [[-3.6, 0, -0.7, 1.15]], [[-4.4, 0, -0.8, 1.45], [-1.3, 0, -0.2, 0.9]],
      [[-5.7, 0, -0.9, 1.55], [-2.1, 0, -0.6, 1.4]], [[-7.6, 0, -1.0, 1.6], [-4.2, 0, -1.1, 1.72], [-0.9, 0, -0.7, 1.5]],
    ];
    put(ricks, rickSets[wheat]);
    const stookSets: [number, number, number, number, number][][] = [
      [], [[-2.2, 0, 0.1, 1, 0.3]], [[-2.2, 0, 0.1, 1, 0.3], [-0.9, 0, 0, 1, -0.2]], [[-1.7, 0, 0.3, 1, 0.3]],
      [[-1.5, 0, 0.4, 1, 0.3]], [[0.2, 0, 0.5, 1, 0.3]], [[0.2, 0, 0.5, 1, 0.3]], [[1.0, 0, 0.5, 1, 0.3]],
    ];
    put(stooks, stookSets[wheat]);
    // Sunflowers: churns lining up two deep.
    const churnCount = [0, 1, 2, 4, 7, 11, 16, 22][sun];
    put(churns, Array.from({ length: churnCount }, (_, i) => {
      const column = Math.floor(i / 2), row = i % 2;
      return [2.4 + column * 0.78 + row * 0.2, 0, row * 0.85 - 0.25 + (noise(i) - 0.5) * 0.12, 0.95 + noise(i + 9) * 0.15, noise(i + 3) * 6.28] as [number, number, number, number, number];
    }));
    // Pumpkins: a stepped pile against the fence, biggest at the bottom.
    const fruitCount = [0, 1, 3, 6, 10, 18, 30, 46][pumpkin];
    const pile: [number, number, number, number, number][] = [];
    let width = 1;
    while ((width * (width + 1)) / 2 < Math.ceil(fruitCount / 2)) width++;
    for (let depth = 0; depth < 2 && pile.length < fruitCount; depth++)
      for (let tier = 0; tier < width && pile.length < fruitCount; tier++)
        for (let k = 0; k < width - tier && pile.length < fruitCount; k++) {
          const i = pile.length, size = 0.5 + noise(i + 20) * 0.16 - tier * 0.03;
          pile.push([12.2 + (k + tier * 0.5) * 0.56, tier * 0.36, depth * 0.56 - 0.25 + (noise(i) - 0.5) * 0.1, size, noise(i + 5) * 6.28]);
        }
    put(fruit, pile);
  }
  set({ wheat: 0, sunflowers: 0, pumpkins: 0 });
  return {
    group,
    set,
    dispose() {
      scene.remove(group);
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      material.dispose();
    },
  };
}
