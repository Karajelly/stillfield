import * as THREE from "three";
import { CROPS } from "./farming";
import type { Crop, FarmingEngine, HarvestResult } from "./farming";
import { FIELD, FIELD_COLUMNS } from "./simulation";
import { createHarvestYard } from "./harvest-yard";

const matte = (color: string) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1 });
const green = matte("#718b51"),
  gold = matte("#d6b75f"),
  yellow = matte("#e4c45e");
const orange = matte("#ce884a"),
  wood = matte("#ad8861"),
  dark = matte("#75634a");
function part(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
export function produce(crop: Crop): THREE.Group {
  const group = new THREE.Group();
  if (crop === "pumpkins") {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const lobe = part(
        group,
        new THREE.SphereGeometry(0.27, 8, 6),
        orange,
        Math.sin(a) * 0.12,
        0.25,
        Math.cos(a) * 0.12,
      );
      lobe.scale.set(0.85, 0.87, 0.85);
    }
    part(
      group,
      new THREE.CylinderGeometry(0.035, 0.05, 0.17, 5),
      dark,
      0,
      0.51,
      0,
    );
  } else {
    for (let i = 0; i < (crop === "wheat" ? 7 : 3); i++) {
      const a = i * 2.4,
        x = Math.sin(a) * 0.16,
        z = Math.cos(a) * 0.16,
        h = 0.65 + (i % 3) * 0.08;
      part(
        group,
        new THREE.CylinderGeometry(0.018, 0.022, h, 4),
        crop === "wheat" ? gold : green,
        x,
        h / 2,
        z,
      );
      if (crop === "wheat") {
        const head = part(
          group,
          new THREE.SphereGeometry(0.09, 5, 5),
          gold,
          x,
          h,
          z,
        );
        head.scale.set(0.7, 2.5, 0.7);
      } else {
        for (let j = 0; j < 8; j++) {
          const b = (j / 8) * Math.PI * 2;
          const petal = part(
            group,
            new THREE.SphereGeometry(0.095, 6, 4),
            yellow,
            x + Math.sin(b) * 0.14,
            h + Math.cos(b) * 0.14,
            z,
          );
          petal.scale.set(0.8, 1, 0.35);
        }
        const center = part(
          group,
          new THREE.SphereGeometry(0.09, 8, 6),
          dark,
          x,
          h,
          z + 0.025,
        );
        center.scale.z = 0.4;
      }
    }
    if (crop === "wheat")
      part(
        group,
        new THREE.TorusGeometry(0.17, 0.025, 4, 10),
        wood,
        0,
        0.3,
        0,
      ).rotation.x = Math.PI / 2;
  }
  return group;
}
export function createHarvestDisplay(scene: THREE.Scene, farm: FarmingEngine) {
  const root = new THREE.Group();
  root.position.set(farm.displayLocation.x, 0.1, farm.displayLocation.z);
  scene.add(root);
  const sections = new Map<
    Crop,
    { group: THREE.Group; items: THREE.Group[]; stage: number; pulse: number }
  >();
  for (const [index, crop] of CROPS.entries()) {
    const group = new THREE.Group();
    group.position.x = (index - 1) * 3.2;
    root.add(group);
    if (crop !== "sunflowers") {
      part(group, new THREE.BoxGeometry(1.8, 0.13, 1.2), wood, 0, 0.48, 0);
      for (const z of [-0.6, 0.6]) {
        for (const y of [0.62, 0.84])
          part(group, new THREE.BoxGeometry(1.9, 0.13, 0.08), wood, 0, y, z);
      }
      for (const x of [-0.93, 0.93])
        part(group, new THREE.BoxGeometry(0.08, 0.4, 1.2), wood, x, 0.7, 0);
      for (const z of [-0.48, 0.48])
        part(
          group,
          new THREE.BoxGeometry(1.25, 0.08, 0.08),
          wood,
          1.35,
          0.65,
          z,
        );
      if (crop === "wheat") {
        part(
          group,
          new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12),
          dark,
          -0.95,
          0.28,
          0,
        ).rotation.x = Math.PI / 2;
        for (const z of [-0.45, 0.45])
          part(
            group,
            new THREE.BoxGeometry(0.08, 0.4, 0.08),
            wood,
            0.55,
            0.25,
            z,
          );
      } else
        for (const x of [-0.65, 0.65]) {
          for (const z of [-0.72, 0.72])
            part(
              group,
              new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12),
              dark,
              x,
              0.28,
              z,
            ).rotation.x = Math.PI / 2;
        }
    }
    const items: THREE.Group[] = [];
    for (let i = 0; i < 9; i++) {
      const item = produce(crop);
      item.position.set(
        ((i % 3) - 1) * 0.5,
        crop === "sunflowers" ? 0.25 : 0.54 + Math.floor(i / 6) * 0.3,
        (crop === "sunflowers"
          ? Math.floor(i / 3) - 1
          : (Math.floor(i / 3) % 2) - 0.5) * 0.5,
      );
      if (crop === "sunflowers")
        part(
          item,
          new THREE.CylinderGeometry(0.22, 0.16, 0.3, 9),
          matte("#bd9679"),
          0,
          0,
          0,
        );
      if (crop === "wheat") {
        item.rotation.z = 0.8;
        item.position.y += 0.12;
      }
      item.visible = false;
      group.add(item);
      items.push(item);
    }
    sections.set(crop, { group, items, stage: -1, pulse: 0 });
  }
  const flights: {
    mesh: THREE.Group;
    start: THREE.Vector3;
    end: THREE.Vector3;
    age: number;
    crop: Crop;
    /** The yard piece this delivery stands up when it lands. */
    piece?: number;
  }[] = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The displays above fill within the first plot. The yard goes on filling.
  const yard = createHarvestYard(scene, farm);
  /** Yard pieces earned while their crop already had produce in the air. */
  const deliveries: { crop: Crop; piece: number; start: THREE.Vector3 }[] = [];
  function launch(
    crop: Crop,
    start: THREE.Vector3,
    end: THREE.Vector3,
    piece?: number,
  ) {
    const mesh = produce(crop);
    mesh.position.copy(start);
    mesh.scale.setScalar(0.8);
    scene.add(mesh);
    flights.push({ mesh, start, end, age: 0, crop, piece });
  }
  /** One delivery per crop at a time, in the order the pieces were earned. */
  function deliver() {
    for (let i = 0; i < deliveries.length; i++) {
      const { crop, piece, start } = deliveries[i];
      if (flights.some((f) => f.crop === crop)) continue;
      launch(crop, start, yard.landing(crop, piece), piece);
      deliveries.splice(i--, 1);
    }
  }
  function sync() {
    for (const crop of CROPS) {
      const section = sections.get(crop)!,
        stage = farm.displayStage(crop);
      if (stage === section.stage) continue;
      section.stage = stage;
      section.items.forEach((item, i) => {
        item.visible = i < [0, 1, 4, 9][stage];
      });
    }
  }
  sync();
  return {
    sync,
    harvest(results: HarvestResult[]) {
      sync();
      for (const result of results) {
        const section = sections.get(result.crop)!;
        section.pulse = 0.8;
        const cell = result.cells[Math.floor(result.cells.length / 2)];
        const start = new THREE.Vector3(
          FIELD.minX + ((cell % FIELD_COLUMNS) + 0.5) * FIELD.cell,
          0.4,
          FIELD.minZ + (Math.floor(cell / FIELD_COLUMNS) + 0.5) * FIELD.cell,
        );
        for (const piece of yard.claim(result.crop)) {
          // Without motion, a new piece is simply there.
          if (reduced) yard.reveal(result.crop, piece, false);
          else deliveries.push({ crop: result.crop, piece, start });
        }
        deliver();
        if (
          reduced ||
          flights.some((f) => f.crop === result.crop) ||
          flights.length >= 3
        )
          continue;
        const end = root.position
          .clone()
          .add(section.group.position)
          .add(new THREE.Vector3(0, 0.9, 0));
        launch(result.crop, start.clone(), end);
      }
    },
    update(dt: number) {
      for (const section of sections.values()) {
        section.pulse = Math.max(0, section.pulse - dt);
        section.group.scale.y =
          1 + (reduced ? 0 : Math.sin((section.pulse / 0.8) * Math.PI) * 0.07);
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        f.age += dt;
        const t = Math.min(1, f.age / 1.8),
          eased = t * t * (3 - 2 * t);
        f.mesh.position.lerpVectors(f.start, f.end, eased);
        f.mesh.position.y += Math.sin(t * Math.PI) * 2;
        f.mesh.rotation.z =
          f.crop === "wheat"
            ? eased * 0.8
            : f.crop === "pumpkins"
              ? Math.sin(t * Math.PI) * 0.3
              : 0;
        f.mesh.scale.setScalar(0.8 * (1 - 0.2 * t));
        if (t === 1) {
          scene.remove(f.mesh);
          f.mesh.traverse((o) => {
            if (o instanceof THREE.Mesh) o.geometry.dispose();
          });
          flights.splice(i, 1);
          if (f.piece !== undefined) yard.reveal(f.crop, f.piece);
        }
      }
      deliver();
      yard.update(dt);
    },
    clear() {
      for (const f of flights) {
        scene.remove(f.mesh);
        f.mesh.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
      }
      flights.length = 0;
      deliveries.length = 0;
      sync();
      yard.sync();
    },
  };
}
