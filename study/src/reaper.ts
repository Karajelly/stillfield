import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * A harvest implement of its own. Today the tractor harvests with the mower
 * deck, so harvesting and mowing look the same from the seat. This keeps the
 * deck as the bed and adds a slow wooden reel, kin to the windmill's sails,
 * and a small binder at the back where the bundles come out.
 *
 * It hangs from the tractor's existing "attachment" group, so it lifts and
 * lowers with the hitch exactly as the deck does.
 */
export function createReaper(attachment: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = "reaper";
  attachment.add(group);
  const matte = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
  // The tractor's own enamel and timber.
  const green = matte("#638c79", 0.65), light = matte("#91b399", 0.65), cream = matte("#f5e7c6");
  const wood = matte("#c2a06c"), woodDark = matte("#a28a65"), red = matte("#cc7862"), metal = matte("#7b8b7c");
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, radius = 0.04) => new RoundedBoxGeometry(w, h, d, 2, radius);

  // Side boards carry the reel above the deck's leading edge (the edge nearest the tractor).
  const reelZ = -1.78, reelY = 0.86, radius = 0.5, width = 2.36;
  for (const side of [-1, 1]) {
    add(box(0.07, 0.62, 0.3), green, side * 1.2, 0.6, reelZ);
    add(box(0.09, 0.14, 0.9), light, side * 1.2, 0.32, -2.05);
  }
  const reel = new THREE.Group();
  reel.position.set(0, reelY, reelZ);
  group.add(reel);
  add(new THREE.CylinderGeometry(0.035, 0.035, width + 0.12, 8).rotateZ(Math.PI / 2), metal, 0, 0, 0, reel);
  const disc = new THREE.CylinderGeometry(radius * 0.36, radius * 0.36, 0.05, 14).rotateZ(Math.PI / 2);
  for (const side of [-1, 1]) add(disc, cream, side * (width / 2), 0, 0, reel);
  const BATS = 5;
  for (let i = 0; i < BATS; i++) {
    const angle = (i / BATS) * Math.PI * 2;
    const y = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const bat = add(box(width, 0.035, 0.13, 0.015), i % 2 ? wood : woodDark, 0, y, z, reel);
    bat.rotation.x = angle;
    // Two spokes hold each bat to the hubs.
    for (const side of [-1, 1]) {
      const spoke = add(box(0.04, radius, 0.05, 0.015), cream, side * (width / 2 - 0.02), y / 2, z / 2, reel);
      spoke.rotation.x = angle;
    }
  }
  // The binder: a small cream box at the back with a red knotter arm.
  add(box(0.74, 0.3, 0.42, 0.1), cream, 0, 0.62, -2.34);
  add(box(0.5, 0.05, 0.3, 0.02), light, 0, 0.8, -2.34);
  const arm = add(box(0.06, 0.34, 0.06, 0.02), red, 0.26, 0.86, -2.4);
  arm.rotation.z = -0.5;
  add(new THREE.SphereGeometry(0.06, 10, 8), red, 0.34, 1.0, -2.4);

  let spin = 0, kick = 0;
  return {
    group,
    /** The reel turns with the ground: one bat per pace of travel. */
    update(speed: number, dt: number, working: boolean) {
      spin += (working ? speed / radius : speed * 0.4) * dt;
      reel.rotation.x = -spin;
      kick = Math.max(0, kick - dt * 4);
      arm.rotation.z = -0.5 - Math.sin(kick * Math.PI) * 0.9;
    },
    /** The knotter arm flicks as a bundle leaves. */
    tie() {
      kick = 1;
    },
    set visible(value: boolean) {
      group.visible = value;
    },
  };
}
export type Reaper = ReturnType<typeof createReaper>;
