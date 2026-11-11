import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FIELD, FIELD_COLUMNS, FIELD_ROWS, seededRandom } from "./simulation";
import type { Point, Tool } from "./simulation";
import { FarmingEngine, Ground } from "./farming";
import type { Crop, FarmSnapshot, FarmingEvents } from "./farming";
import { createHarvestDisplay } from "./harvest-display";
export const COLUMNS = FIELD_COLUMNS,
  ROWS = FIELD_ROWS;

export function createField(
  scene: THREE.Scene,
  saved?: FarmSnapshot | number[],
) {
  const engine = new FarmingEngine(saved);
  const grid = engine.cells;
  const canvas = document.createElement("canvas");
  canvas.width = COLUMNS * 5;
  canvas.height = ROWS * 5;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.maxX - FIELD.minX, FIELD.maxZ - FIELD.minZ),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(
    (FIELD.minX + FIELD.maxX) / 2,
    0.045,
    (FIELD.minZ + FIELD.maxZ) / 2,
  );
  ground.receiveShadow = true;
  scene.add(ground);
  function drawCell(i: number) {
    const col = i % COLUMNS,
      row = Math.floor(i / COLUMNS),
      state = grid[i],
      stage = engine.stage(i),
      crop = engine.cropAt(i),
      planted = state === Ground.growing || state === Ground.mature;
    const palette =
      state === Ground.grass
        ? ["#a4b376", "#a8b67a"]
        : state === Ground.mown
          ? ["#b9c48b", "#bdc991"]
          : state === Ground.stubble
            ? ["#bdab7e", "#b8a579"]
            : planted
              ? crop === "wheat"
                ? ["#a08050", "#ac8c5b"]
                : crop === "sunflowers"
                  ? ["#82754e", "#8e8056"]
                  : stage === 0
                    ? ["#a08050", "#ac8c5b"]
                    : ["#aa7052", "#b57d5b"]
              : ["#b89570", "#c29f79"];
    ctx.fillStyle = palette[row % 8 < 4 ? 0 : 1];
    ctx.fillRect(col * 5, row * 5, 5, 5);
    if (state >= Ground.soil) {
      ctx.fillStyle = "rgba(104,77,52,.22)";
      ctx.fillRect(col * 5, row * 5 + 2, 5, 0.7);
    }
    if (planted && stage === 0) {
      // Distinct seedbeds read immediately, even before any shoots appear.
      const x = col * 5,
        y = row * 5;
      if (crop === "wheat" || crop === "pumpkins") {
        ctx.fillStyle = crop === "wheat" ? "#edcf88" : "#eaa15b";
        ctx.fillRect(x + 0.5, y + 0.9, 2.1, 0.85);
        ctx.fillRect(x + 2.4, y + 3.25, 2.1, 0.85);
      } else if (crop === "sunflowers") {
        for (const offset of [1.35, 3.65]) {
          ctx.fillStyle = "#f4e1b0";
          ctx.beginPath();
          ctx.ellipse(x + offset, y + 2.5, 0.8, 1.2, -0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#6d6145";
          ctx.fillRect(x + offset - 0.25, y + 1.8, 0.5, 1.4);
        }
      }
    } else if (planted) {
      ctx.fillStyle =
        stage === 3
          ? crop === "wheat"
            ? "#d6bb6b"
            : crop === "pumpkins"
              ? "#ca8b4a"
              : "#dcca65"
          : "#829755";
      ctx.fillRect(col * 5 + 1, row * 5 + 1, 3, stage < 2 ? 1 : 3);
    } else if (state === Ground.stubble) {
      ctx.fillStyle = "#d6c28a";
      ctx.fillRect(col * 5 + 2, row * 5 + 1, 1, 2);
    }
  }
  const random = seededRandom(22);
  const points: {
    x: number;
    z: number;
    height: number;
    angle: number;
    cell: number;
  }[] = [];
  const byCell = new Map<number, number[]>();
  for (let z = FIELD.minZ + FIELD.cell / 2; z < FIELD.maxZ; z += FIELD.cell)
    for (let x = FIELD.minX + FIELD.cell / 2; x < FIELD.maxX; x += FIELD.cell) {
      const px = x + (random() - 0.5) * 0.18,
        pz = z + (random() - 0.5) * 0.18;
      const cell =
        Math.floor((pz - FIELD.minZ) / FIELD.cell) * COLUMNS +
        Math.floor((px - FIELD.minX) / FIELD.cell);
      const i = points.length;
      points.push({
        x: px,
        z: pz,
        height: 0.45 + random() * 0.5,
        angle: random() * 6.28,
        cell,
      });
      byCell.set(cell, [...(byCell.get(cell) ?? []), i]);
    }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.1, 0, 0, 0.1, 0, 0, 0.045, 0.7, 0, 0, 0, -0.1, 0, 0, 0.1, 0.02, 0.52,
        0.04,
      ],
      3,
    ),
  );
  blade.computeVertexNormals();
  const petalParts = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4,
      g = new THREE.SphereGeometry(0.12, 6, 4);
    g.scale(0.6, 1, 0.3);
    g.rotateZ(-a);
    g.translate(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0);
    return g;
  });
  const petals = mergeGeometries(petalParts);
  petalParts.forEach((g) => g.dispose());
  function instances(geometry: THREE.BufferGeometry, color: string) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      points.length,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  const grass = instances(blade, "#ffffff"),
    heads = instances(new THREE.SphereGeometry(0.1, 6, 5), "#ffffff");
  const stems = instances(
    new THREE.CylinderGeometry(0.025, 0.03, 1, 5),
    "#718b51",
  );
  const flowers = instances(petals, "#e4c45e"),
    centers = instances(new THREE.SphereGeometry(0.095, 8, 6), "#796447");
  const pumpkins = instances(new THREE.SphereGeometry(0.28, 10, 7), "#ce884a");
  const seedPairs = instances(new THREE.SphereGeometry(0.1, 6, 4), "#ffffff"),
    seedCenters = instances(new THREE.SphereGeometry(0.1, 6, 4), "#6d6145");
  const meshes = [
      grass,
      heads,
      stems,
      flowers,
      centers,
      pumpkins,
      seedPairs,
      seedCenters,
    ],
    dummy = new THREE.Object3D(),
    color = new THREE.Color(),
    tint = new THREE.Color();
  // A ripening plant swells briefly about its base; 1 leaves it at rest.
  let lift = 1;
  function put(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy = sx,
    sz = sx,
    angle = 0,
  ) {
    dummy.position.set(x, y * lift, z);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.set(sx * lift, sy * lift, sz * lift);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  function updatePoint(i: number) {
    const p = points[i],
      state = grid[p.cell],
      crop = engine.cropAt(p.cell),
      stage = engine.stage(p.cell),
      growing = state === Ground.growing || state === Ground.mature;
    for (const mesh of meshes) put(mesh, i, p.x, 0.05, p.z, 0);
    if (state === Ground.grass) {
      put(grass, i, p.x, 0.05, p.z, p.height, p.height, p.height, p.angle);
      grass.setColorAt(i, color.set(i % 2 ? "#7e9557" : "#a8b775"));
    }
    if (state === Ground.stubble) {
      put(grass, i, p.x, 0.05, p.z, 0.25, 0.16, 0.25, p.angle);
      grass.setColorAt(i, color.set("#cfbb85"));
    }
    if (!growing) return;
    if (stage === 0) {
      const wheat = crop === "wheat",
        sunflower = crop === "sunflowers";
      const y = 0.08;
      const width = sunflower ? 0.75 : 0.4,
        length = sunflower ? 1.1 : 1.3;
      put(heads, i, p.x - 0.09, y, p.z, width, 0.25, length, 0.3);
      put(
        seedPairs,
        i,
        p.x + 0.09,
        y,
        p.z + 0.06,
        width,
        0.25,
        length,
        -0.3,
      );
      heads.setColorAt(i, color.set(wheat ? "#edcf88" : sunflower ? "#f4e1b0" : "#eaa15b"));
      seedPairs.setColorAt(i, color);
      if (sunflower) {
        put(centers, i, p.x - 0.09, y + 0.015, p.z, 0.35, 0.2, 0.85, 0.3);
        put(
          seedCenters,
          i,
          p.x + 0.09,
          y + 0.015,
          p.z + 0.06,
          0.35,
          0.2,
          0.85,
          -0.3,
        );
      }
      return;
    }
    // The engine saves exact progress, so plants rise within each stage
    // instead of jumping between three heights.
    const within = stage === 3 ? 1 : engine.progress[p.cell] * 3 - stage,
      rise = within * within * (3 - 2 * within);
    const full =
        crop === "sunflowers" ? 1.15 : crop === "pumpkins" ? 0.22 : 0.85,
      sprout = Math.min(0.3, full);
    const h =
      stage === 1
        ? 0.12 + (sprout - 0.12) * rise
        : stage === 2
          ? sprout + (full - sprout) * rise
          : full;
    const spread =
      crop === "pumpkins"
        ? stage === 1
          ? 0.2 + 0.25 * rise
          : stage === 2
            ? 0.45 + 0.75 * rise
            : 1.2
        : stage === 1
          ? 0.45 + 0.25 * rise
          : 0.7;
    put(
      grass,
      i,
      p.x,
      0.05,
      p.z,
      spread,
      h,
      crop === "pumpkins" ? spread : spread * (0.8 / 0.7),
      p.angle,
    );
    // Wheat turns from green toward gold as it nears harvest.
    const ripening = crop === "wheat" && stage === 2 ? rise * rise * 0.6 : 0;
    grass.setColorAt(
      i,
      crop === "wheat" && stage === 3
        ? color.set("#cbb36a")
        : color.set("#78934e").lerp(tint.set("#cbb36a"), ripening),
    );
    if (crop === "wheat" && stage >= 2) {
      const ear = stage === 3 ? 1 : 0.35 + 0.65 * rise;
      put(
        heads,
        i,
        p.x,
        0.05 + h * 0.7,
        p.z,
        0.75 * ear,
        2.3 * ear,
        0.75 * ear,
        p.angle,
      );
      heads.setColorAt(
        i,
        stage === 3
          ? color.set("#ddc176")
          : color.set("#90a65e").lerp(tint.set("#ddc176"), ripening),
      );
    }
    if (crop === "sunflowers" && stage >= 2) {
      put(stems, i, p.x, h / 2, p.z, 1, h, 1);
      if (stage === 3) {
        put(flowers, i, p.x, h, p.z, 1, 1, 1, p.angle);
        put(
          centers,
          i,
          p.x + Math.sin(p.angle) * 0.035,
          h,
          p.z + Math.cos(p.angle) * 0.035,
          1,
          1,
          0.5,
          p.angle,
        );
      }
    }
    if (crop === "pumpkins" && stage === 3) {
      put(pumpkins, i, p.x, 0.28, p.z, 1, 0.85, 1, p.angle);
      put(stems, i, p.x, 0.52, p.z, 1, 0.15, 1);
    }
  }
  function dirty() {
    texture.needsUpdate = true;
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  function redraw() {
    for (let i = 0; i < grid.length; i++) drawCell(i);
    points.forEach((_, i) => updatePoint(i));
    dirty();
  }
  redraw();
  const display = createHarvestDisplay(scene, engine);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Cells that have just ripened, with the seconds since they did.
  const swells = new Map<number, number>();
  const SWELL_SECONDS = 0.7,
    GROWTH_REFRESH_SECONDS = 2,
    GROWTH_REFRESH_FRAMES = 8;
  let sinceGrowthRefresh = 0,
    growCursor = grid.length,
    growTouched = false;
  function respond(events: FarmingEvents) {
    const cells = [...events.groundChanges, ...events.cropStages];
    for (const i of events.groundChanges) swells.delete(i);
    for (const i of cells) {
      drawCell(i);
      byCell.get(i)?.forEach(updatePoint);
    }
    if (cells.length) dirty();
    if (events.harvestResults.length) display.harvest(events.harvestResults);
    // A whole field ripening in one step, as after a long frame, stays still.
    if (!reducedMotion && events.cropMaturities.length <= 400)
      for (const i of events.cropMaturities) swells.set(i, 0);
    return events;
  }
  /** Ripening follows the path the seed was sown along, a row at a time. */
  function swell(seconds: number) {
    if (!swells.size) return;
    for (const [cell, age] of swells) {
      const next = age + seconds;
      if (next >= SWELL_SECONDS) swells.delete(cell);
      else {
        swells.set(cell, next);
        lift = 1 + 0.24 * Math.sin((next / SWELL_SECONDS) * Math.PI);
      }
      byCell.get(cell)?.forEach(updatePoint);
      lift = 1;
    }
    dirty();
  }
  /** Redraw growing plants a slice per frame, so a full field never stalls one. */
  function grow(seconds: number) {
    sinceGrowthRefresh += seconds;
    if (growCursor >= grid.length) {
      if (sinceGrowthRefresh < GROWTH_REFRESH_SECONDS) return;
      sinceGrowthRefresh = 0;
      growCursor = 0;
      growTouched = false;
    }
    const end = Math.min(
      grid.length,
      growCursor + Math.ceil(grid.length / GROWTH_REFRESH_FRAMES),
    );
    for (; growCursor < end; growCursor++) {
      // Seed beds look the same until the first shoots appear.
      if (
        grid[growCursor] !== Ground.growing ||
        engine.progress[growCursor] < 1 / 3
      )
        continue;
      byCell.get(growCursor)?.forEach(updatePoint);
      growTouched = true;
    }
    if (growCursor >= grid.length && growTouched) dirty();
  }
  return {
    engine,
    grid,
    paint(
      x: number,
      z: number,
      tool: Tool,
      from: Point = { x, z },
      crop: Crop = "wheat",
    ) {
      return respond(engine.apply(from, { x, z }, tool, crop));
    },
    advance(seconds: number) {
      const event = respond(engine.advance(seconds));
      grow(event.advancedSeconds);
      swell(seconds);
      display.update(seconds);
      return event;
    },
    reset() {
      engine.reset();
      swells.clear();
      growCursor = grid.length;
      redraw();
      display.clear();
    },
  };
}
