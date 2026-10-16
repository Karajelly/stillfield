import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { tuning } from "./handling";
import type { Tool } from "./simulation";

/** A small enamel toy tractor, built to hold up at the driver's-eye distance. */
export function createTractor(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = "tractor";
  scene.add(group);
  const matte = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
  const materials = {
    green: matte("#638c79", 0.65), light: matte("#91b399", 0.65),
    cream: matte("#f5e7c6"), tire: matte("#48534c"), tread: matte("#535f55"),
    metal: matte("#7b8b7c"), seat: matte("#ae7859"), leather: matte("#c59370"),
    red: matte("#cc7862"), gold: matte("#d6b46b"), skin: matte("#dfb28b"),
    hair: matte("#79604a"), overalls: matte("#658e91"), shirt: matte("#f3ddac"),
  };
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material,
                x: number, y: number, z: number, parent: THREE.Object3D = group) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  }
  function box(x: number, y: number, z: number, w: number, h: number, d: number,
               material: THREE.Material, parent: THREE.Object3D = group, radius = 0.08, segments = 2) {
    const geometry = new RoundedBoxGeometry(w, h, d, segments, radius);
    geometry.deleteAttribute("uv");
    return mesh(mergeVertices(geometry), material, x, y, z, parent);
  }
  function oval(x: number, y: number, z: number, rx: number, ry: number, rz: number,
                material: THREE.Material, parent: THREE.Object3D = group) {
    const part = mesh(new THREE.SphereGeometry(1, 16, 10), material, x, y, z, parent);
    part.scale.set(rx, ry, rz);
    return part;
  }
  function rod(from: THREE.Vector3, to: THREE.Vector3, radius: number,
               material: THREE.Material, parent: THREE.Object3D = group) {
    const direction = to.clone().sub(from);
    const center = from.clone().add(to).multiplyScalar(0.5);
    const part = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material,
                      center.x, center.y, center.z, parent);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return part;
  }
  function panel(x: number, y: number, z: number, w: number, h: number, d: number,
                 radius: number, material: THREE.Material, parent: THREE.Object3D = group) {
    const shape = new THREE.Shape();
    const a = w / 2, b = d / 2, r = radius;
    shape.moveTo(-a + r, -b);
    shape.lineTo(a - r, -b); shape.quadraticCurveTo(a, -b, a, -b + r);
    shape.lineTo(a, b - r); shape.quadraticCurveTo(a, b, a - r, b);
    shape.lineTo(-a + r, b); shape.quadraticCurveTo(-a, b, -a, b - r);
    shape.lineTo(-a, -b + r); shape.quadraticCurveTo(-a, -b, -a + r, -b);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: h, bevelEnabled: true, bevelSize: Math.min(0.045, h / 2),
      bevelThickness: Math.min(0.035, h / 2), bevelSegments: 2, steps: 1, curveSegments: 5,
    });
    geometry.translate(0, 0, -h / 2);
    geometry.rotateX(-Math.PI / 2);
    return mesh(geometry, material, x, y, z, parent);
  }

  box(0, 0.65, 0, 1.32, 0.36, 2.55, materials.green, group, 0.16);
  box(0, 1.15, 0.66, 1.35, 0.87, 1.6, materials.green, group, 0.23, 3);
  box(0, 1.46, 0.62, 1.21, 0.30, 1.47, materials.light, group, 0.14);
  box(0, 1.09, 1.46, 1.10, 0.58, 0.13, materials.cream, group, 0.06);
  for (let i = 0; i < 7; i++)
    box(-0.39 + i * 0.13, 1.09, 1.535, 0.035, 0.36, 0.035, materials.metal, group, 0.016, 1);
  box(0, 0.64, 1.66, 1.45, 0.18, 0.22, materials.metal);
  // Cream piping and a little brass badge make the hood read as enamel.
  for (const side of [-1, 1]) {
    box(side * 0.677, 1.28, 0.63, 0.025, 0.045, 1.02, materials.cream, group, 0.01, 1);
    oval(side * 0.69, 1.12, 0.79, 0.025, 0.11, 0.15, materials.gold);
    oval(side * 0.52, 1.39, 1.45, 0.17, 0.17, 0.09, materials.metal);
    oval(side * 0.52, 1.39, 1.51, 0.13, 0.13, 0.055, materials.cream);
    panel(side * 0.85, 0.71, -0.18, 0.5, 0.09, 0.66, 0.12, materials.metal);
    rod(new THREE.Vector3(side * 0.62, 1.39, -0.86), new THREE.Vector3(side * 0.65, 2.58, -0.81), 0.045, materials.cream);
    rod(new THREE.Vector3(side * 0.62, 1.48, 0.27), new THREE.Vector3(side * 0.65, 2.58, 0.23), 0.04, materials.cream);

    // Curved wheel arches replace the flat rectangular mudguards.
    const arch = new THREE.Shape();
    const start = -1.22, end = 1.22;
    arch.moveTo(Math.sin(start) * 0.94, Math.cos(start) * 0.94);
    for (let i = 1; i <= 24; i++) {
      const a = start + (end - start) * i / 24;
      arch.lineTo(Math.sin(a) * 0.94, Math.cos(a) * 0.94);
    }
    for (let i = 24; i >= 0; i--) {
      const a = start + (end - start) * i / 24;
      arch.lineTo(Math.sin(a) * 0.85, Math.cos(a) * 0.85);
    }
    arch.closePath();
    const geometry = new THREE.ExtrudeGeometry(arch, { depth: 0.50, bevelEnabled: true,
      bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, steps: 1 });
    geometry.translate(0, 0, -0.25);
    geometry.rotateY(Math.PI / 2);
    mesh(geometry, materials.green, side * 1.01, 0.77, -0.77);
    box(side * 1.01, 1.12, -1.63, 0.27, 0.19, 0.12, materials.cream);
    oval(side * 1.01, 1.13, -1.71, 0.105, 0.065, 0.035, materials.red);
  }
  panel(0, 2.63, -0.30, 1.85, 0.12, 1.70, 0.29, materials.cream);
  panel(0, 2.72, -0.30, 1.73, 0.07, 1.58, 0.28, materials.light);
  box(0, 1.20, -0.66, 0.70, 0.20, 0.60, materials.seat, group, 0.095);
  box(0, 1.45, -0.96, 0.70, 0.49, 0.20, materials.seat, group, 0.095);
  box(0, 1.45, -1.069, 0.52, 0.33, 0.025, materials.leather, group, 0.012);
  rod(new THREE.Vector3(-0.44, 1.50, 0.83), new THREE.Vector3(-0.44, 2.37, 0.83), 0.065, materials.metal);
  oval(-0.44, 2.40, 0.83, 0.12, 0.065, 0.10, materials.tire);

  const wheelProfile = [
    [0.30, -0.18], [0.49, -0.24], [0.66, -0.24], [0.76, -0.16], [0.79, -0.06],
    [0.79, 0.06], [0.76, 0.16], [0.66, 0.24], [0.49, 0.24], [0.30, 0.18], [0.30, -0.18],
  ].map(([r, w]) => new THREE.Vector2(r, w));
  const tireGeometry = new THREE.LatheGeometry(wheelProfile, 28);
  tireGeometry.rotateZ(Math.PI / 2);
  const wheels: THREE.Group[] = [];
  for (const side of [-1, 1]) for (const front of [false, true]) {
    const wheel = new THREE.Group();
    wheel.name = `wheel-${side}-${front ? "front" : "rear"}`;
    wheel.position.set(side * (front ? 0.85 : 1.02), front ? 0.49 : 0.79, front ? 1.05 : -0.77);
    mesh(tireGeometry, materials.tire, 0, 0, 0, wheel);
    oval(side * 0.21, 0, 0, 0.06, 0.43, 0.43, materials.cream, wheel);
    oval(side * 0.26, 0, 0, 0.06, 0.24, 0.24, materials.green, wheel);
    oval(side * 0.31, 0, 0, 0.035, 0.085, 0.085, materials.gold, wheel);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      oval(side * 0.285, Math.cos(a) * 0.30, Math.sin(a) * 0.30, 0.025, 0.035, 0.035, materials.metal, wheel);
    }
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const tread = new THREE.Group();
      tread.position.set(0, Math.cos(a) * 0.775, Math.sin(a) * 0.775);
      tread.rotation.x = a;
      wheel.add(tread);
      for (const half of [-1, 1]) {
        const chevron = box(half * 0.115, 0, 0, 0.28, 0.055, 0.105, materials.tread, tread, 0.025, 1);
        chevron.rotation.y = half * 0.48;
      }
    }
    if (front) wheel.scale.set(0.78, 0.62, 0.62);
    group.add(wheel);
    wheels.push(wheel);
  }

  // A soft little figure: rolled sleeves, dungarees, ears, and a tilted straw hat.
  oval(0, 1.62, -0.49, 0.26, 0.33, 0.21, materials.shirt);
  box(0, 1.43, -0.49, 0.46, 0.27, 0.38, materials.overalls, group, 0.12);
  for (const side of [-1, 1]) {
    box(side * 0.16, 1.68, -0.675, 0.055, 0.32, 0.04, materials.overalls, group, 0.018, 1);
    oval(side * 0.27, 1.63, -0.38, 0.13, 0.19, 0.13, materials.shirt);
    rod(new THREE.Vector3(side * 0.26, 1.58, -0.34), new THREE.Vector3(side * 0.21, 1.55, -0.03), 0.075, materials.skin);
    oval(side * 0.21, 1.55, -0.02, 0.08, 0.07, 0.08, materials.skin);
  }
  const steering = mesh(new THREE.TorusGeometry(0.26, 0.028, 8, 20), materials.tire, 0, 1.59, 0.04);
  steering.rotation.x = -0.75;
  oval(0, 1.97, -0.47, 0.235, 0.25, 0.22, materials.skin);
  oval(0, 1.99, -0.54, 0.24, 0.22, 0.18, materials.hair);
  for (const side of [-1, 1]) oval(side * 0.23, 1.96, -0.46, 0.06, 0.075, 0.065, materials.skin);
  const hat = new THREE.Group();
  hat.position.set(0, 2.16, -0.47);
  hat.rotation.z = -0.08;
  group.add(hat);
  oval(0, 0, 0, 0.40, 0.055, 0.35, materials.gold, hat);
  oval(0, 0.075, 0, 0.245, 0.16, 0.225, materials.cream, hat);
  const ribbon = mesh(new THREE.CylinderGeometry(0.239, 0.247, 0.045, 24), materials.seat, 0, 0.045, 0, hat);
  ribbon.scale.z = 0.92;

  const attachment = new THREE.Group();
  attachment.name = "attachment";
  group.add(attachment);
  for (const side of [-1, 1]) rod(new THREE.Vector3(side * 0.42, 0.58, -1.25), new THREE.Vector3(side * 0.65, 0.46, -2.0), 0.055, materials.metal, attachment);
  const mower = panel(0, 0.35, -2.1, tuning.brushRadius * 2, 0.24, 0.82, 0.24, materials.light, attachment);
  mower.name = "mower";
  panel(0, 0.20, -2.1, 2.41, 0.08, 0.76, 0.22, materials.green, attachment);
  for (const side of [-1, 1]) {
    oval(side * 1.11, 0.49, -2.14, 0.08, 0.045, 0.075, materials.cream, attachment);
    box(side * 0.94, 0.34, -2.535, 0.18, 0.07, 0.035, materials.red, attachment, 0.017, 1);
  }
  // A tiny ivory daisy on the deck is visible from the follow camera.
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const petal = oval(Math.sin(a) * 0.12, 0.51, -2.12 + Math.cos(a) * 0.12, 0.055, 0.015, 0.095, materials.cream, attachment);
    petal.rotation.y = a;
  }
  oval(0, 0.525, -2.12, 0.065, 0.02, 0.065, materials.gold, attachment);
  const teeth: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const tooth = box(-1.08 + i * 0.36, 0.16, -2.3, 0.085, 0.30, 0.32, materials.metal, attachment, 0.035, 1);
    tooth.name = `till-tooth-${i}`;
    teeth.push(tooth);
  }
  const seedBox = box(0, 0.69, -2.1, 1.66, 0.40, 0.56, materials.cream, attachment, 0.16);
  seedBox.name = "seed-box";
  seedBox.visible = false;
  return {
    group,
    update(speed: number, dt: number, time: number) {
      wheels.forEach((wheel) => (wheel.rotation.x += speed * dt / 0.7));
      group.position.y = speed > 0.2 ? Math.sin(time * 9) * 0.025 : 0;
    },
    setTool(tool: Tool) {
      attachment.visible = tool !== "wander";
      mower.material = tool === "cultivate" ? materials.seat : materials.light;
      teeth.forEach((tooth) => (tooth.visible = tool === "cultivate"));
      seedBox.visible = tool === "sow";
    },
  };
}
