// Sandbox-only copy: expose brush radius for the A/B comparison.
import * as THREE from "three";
import { FIELD, cellsUnderBrush, seededRandom } from "../src/simulation";
import type { Tool } from "../src/simulation";
export const COLUMNS = Math.round((FIELD.maxX - FIELD.minX) / FIELD.cell);
export const ROWS = Math.round((FIELD.maxZ - FIELD.minZ) / FIELD.cell);
const SIZE = COLUMNS * ROWS;
export function createField(scene: THREE.Scene, saved?: number[]) {
  const grid = new Uint8Array(SIZE);
  if (
    saved &&
    saved.length === SIZE &&
    saved.every((n) => Number.isInteger(n) && n >= 0 && n <= 3)
  )
    grid.set(saved);
  else {
    // A few beginnings, with plenty of space to make this place your own.
    for (let x = -21; x <= 13; x += 0.2)
      for (const z of [10.8, 7.8])
        for (const index of cellsUnderBrush(x, z, 1.05)) grid[index] = 1;
    for (let x = -4; x <= 13; x += 0.2)
      for (const index of cellsUnderBrush(x, 4.8, 1.05)) grid[index] = 1;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 860;
  canvas.height = 540;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(43, 27),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-2.5, 0.045, 0.5);
  ground.receiveShadow = true;
  scene.add(ground);
  const random = seededRandom(22);
  function drawCell(index: number) {
    const col = index % COLUMNS,
      row = Math.floor(index / COLUMNS),
      state = grid[index];
    const noise = ((index * 17 + Math.floor(index / COLUMNS) * 31) % 13) / 13;
    const colors =
      state === 0
        ? ["#a4b376", "#a8b67a", "#a6b578"]
        : state === 1
          ? ["#b9c48b", "#bdc991", "#c2cc94"]
          : state === 2
            ? ["#b89570", "#c29f79", "#bc9873"]
            : ["#97ab78", "#9cae7b", "#a3b480"];
    ctx.fillStyle = colors[row % 8 < 4 ? 0 : 1];
    ctx.fillRect(col * 5, row * 5, 5, 5);
    if (noise > 0.65) {
      ctx.fillStyle =
        state === 2 ? "#ac8968" : state === 1 ? "#a5b77d" : "#8fa368";
      ctx.globalAlpha = 0.28;
      ctx.fillRect(col * 5 + 1.5, row * 5 + 1, 0.75, 2);
      ctx.globalAlpha = 1;
    }
    if (state === 2 && row % 3 === 0) {
      ctx.fillStyle = "rgba(104,77,52,.16)";
      ctx.fillRect(col * 5, row * 5 + 1.5, 5, 0.75);
    }
  }
  function redraw() {
    for (let i = 0; i < SIZE; i++) drawCell(i);
    texture.needsUpdate = true;
  }
  redraw();
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.12, 0, 0, 0.12, 0, 0, 0.045, 0.7, 0, 0, 0, -0.12, 0, 0, 0.12, 0.02,
        0.52, 0.04,
      ],
      3,
    ),
  );
  bladeGeometry.computeVertexNormals();
  const points: {
    x: number;
    z: number;
    height: number;
    angle: number;
    cell: number;
  }[] = [];
  const byCell = new Map<number, number[]>();
  for (let z = FIELD.minZ + 0.24; z < FIELD.maxZ; z += 0.6)
    for (let x = FIELD.minX + 0.22; x < FIELD.maxX; x += 0.6) {
      const px = x + (random() - 0.5) * 0.3,
        pz = z + (random() - 0.5) * 0.3;
      const cell =
        Math.floor((pz - FIELD.minZ) / FIELD.cell) * COLUMNS +
        Math.floor((px - FIELD.minX) / FIELD.cell);
      const index = points.length;
      points.push({
        x: px,
        z: pz,
        height: 0.45 + random() * 0.5,
        angle: random() * 6.28,
        cell,
      });
      if (!byCell.has(cell)) byCell.set(cell, []);
      byCell.get(cell)!.push(index);
    }
  const grass = new THREE.InstancedMesh(
    bladeGeometry,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      side: THREE.DoubleSide,
      roughness: 1,
    }),
    points.length,
  );
  const flowers = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.15, 0),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    points.length,
  );
  grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grass.receiveShadow = true;
  flowers.castShadow = false;
  grass.frustumCulled = false;
  flowers.frustumCulled = false;
  scene.add(grass, flowers);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const flowerPalette = ["#eee7c3", "#d8bb75", "#d3ab9b", "#b9a9cf", "#f3ebce"];
  for (let i = 0; i < points.length; i++) {
    grass.setColorAt(
      i,
      color.set(i % 3 === 0 ? "#9aab68" : i % 3 === 1 ? "#7e9557" : "#a8b775"),
    );
    flowers.setColorAt(i, color.set(flowerPalette[i % flowerPalette.length]));
  }
  function updatePoint(i: number) {
    const p = points[i],
      state = grid[p.cell];
    dummy.position.set(p.x, 0.05, p.z);
    dummy.rotation.set(0, p.angle, 0);
    dummy.scale.setScalar(
      state === 0 ? p.height : state === 3 ? p.height * 0.85 : 0,
    );
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.06 + p.height * 0.54;
    dummy.scale.setScalar(state === 3 && i % 3 !== 0 ? 1 : 0);
    dummy.rotation.set(0, p.angle, 0);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
  }
  function updateAll() {
    points.forEach((_, i) => updatePoint(i));
    grass.instanceMatrix.needsUpdate = true;
    flowers.instanceMatrix.needsUpdate = true;
  }
  updateAll();
  let dirty = false;
  return {
    grid,
    paint(x: number, z: number, tool: Tool, radius = 1.15) {
      if (tool === "wander") return false;
      const value = tool === "mow" ? 1 : tool === "till" ? 2 : 3;
      let changed = false;
      for (const cell of cellsUnderBrush(x, z, radius)) {
        if (grid[cell] === value) continue;
        grid[cell] = value;
        drawCell(cell);
        byCell.get(cell)?.forEach(updatePoint);
        changed = true;
      }
      if (changed) {
        texture.needsUpdate = true;
        grass.instanceMatrix.needsUpdate = true;
        flowers.instanceMatrix.needsUpdate = true;
        dirty = true;
      }
      return changed;
    },
    reset() {
      grid.fill(0);
      redraw();
      updateAll();
      dirty = true;
    },
    consumeDirty() {
      const result = dirty;
      dirty = false;
      return result;
    },
  };
}
