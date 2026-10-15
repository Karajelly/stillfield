import * as THREE from "three";
import type { Tool } from "./simulation";
export function createTractor(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = "tractor";
  scene.add(group);
  const materials = {
    green: new THREE.MeshStandardMaterial({ color: "#5e8170", roughness: 0.8 }),
    light: new THREE.MeshStandardMaterial({ color: "#89a38a", roughness: 0.8 }),
    cream: new THREE.MeshStandardMaterial({ color: "#f4e9c9", roughness: 0.8 }),
    tire: new THREE.MeshStandardMaterial({ color: "#333e36", roughness: 1 }),
    metal: new THREE.MeshStandardMaterial({ color: "#738073", roughness: 0.7 }),
    seat: new THREE.MeshStandardMaterial({ color: "#8d674e", roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({
      color: "#c5dbd3",
      roughness: 0.5,
      transparent: true,
      opacity: 0.5,
    }),
  };
  function box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  box(0, 0.68, 0, 1.45, 0.38, 2.6, materials.green);
  const hood = box(0, 1.18, 0.64, 1.32, 0.8, 1.55, materials.green);
  hood.rotation.z = 0;
  box(0, 1.35, 0.55, 1.05, 0.32, 1.48, materials.light);
  box(0, 1.04, 1.45, 1.12, 0.53, 0.07, materials.cream);
  for (let i = 0; i < 6; i++)
    box(-0.43 + i * 0.17, 1.04, 1.5, 0.045, 0.36, 0.025, materials.metal);
  box(0, 0.65, 1.65, 1.5, 0.17, 0.18, materials.metal);
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      materials.cream,
    );
    lamp.position.set(side * 0.52, 1.4, 1.38);
    group.add(lamp);
    box(side * 0.94, 1.37, -0.77, 0.53, 0.1, 1.65, materials.green);
    box(side * 0.63, 1.92, -0.72, 0.07, 1.3, 0.07, materials.cream);
    box(side * 0.63, 1.92, 0.13, 0.07, 1.3, 0.07, materials.cream);
  }
  box(0, 2.61, -0.32, 1.78, 0.15, 1.75, materials.cream);
  box(0, 2.71, -0.32, 1.66, 0.07, 1.63, materials.light);
  box(0, 1.23, -0.66, 0.74, 0.18, 0.56, materials.seat);
  box(0, 1.52, -0.91, 0.74, 0.57, 0.12, materials.seat);
  box(-0.43, 1.87, 0.83, 0.1, 1.14, 0.1, materials.metal);
  box(-0.43, 2.46, 0.83, 0.19, 0.08, 0.19, materials.tire);
  const wheelGeometry = new THREE.CylinderGeometry(0.73, 0.73, 0.4, 16);
  wheelGeometry.rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.42, 12);
  hubGeometry.rotateZ(Math.PI / 2);
  const wheels: THREE.Group[] = [];
  for (const side of [-1, 1])
    for (const front of [false, true]) {
      const wheel = new THREE.Group();
      wheel.name = `wheel-${side}-${front ? "front" : "rear"}`;
      wheel.position.set(
        side * (front ? 0.83 : 1.02),
        front ? 0.46 : 0.73,
        front ? 1.03 : -0.77,
      );
      const tire = new THREE.Mesh(wheelGeometry, materials.tire);
      tire.castShadow = true;
      const hub = new THREE.Mesh(hubGeometry, materials.cream);
      wheel.add(tire, hub);
      if (front) wheel.scale.set(0.8, 0.64, 0.64);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const tread = box(
          0,
          Math.sin(a) * 0.72,
          Math.cos(a) * 0.72,
          0.43,
          0.14,
          0.14,
          materials.tire,
          wheel,
        );
        tread.rotation.x = -a;
      }
      group.add(wheel);
      wheels.push(wheel);
    }
  // A little straw-hatted driver.
  box(0, 1.56, -0.49, 0.47, 0.52, 0.36, materials.cream);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 8),
    new THREE.MeshStandardMaterial({ color: "#d4a57d" }),
  );
  head.position.set(0, 1.98, -0.45);
  group.add(head);
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.06, 14),
    materials.cream,
  );
  hat.position.set(0, 2.13, -0.45);
  group.add(hat);
  const hatTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.23, 0.18, 12),
    materials.cream,
  );
  hatTop.position.set(0, 2.22, -0.45);
  group.add(hatTop);
  const attachment = new THREE.Group();
  attachment.name = "attachment";
  group.add(attachment);
  box(0, 0.49, -1.62, 0.14, 0.14, 1.0, materials.metal, attachment);
  const mower = box(
    0,
    0.35,
    -2.1,
    2.65,
    0.36,
    0.85,
    materials.light,
    attachment,
  );
  mower.name = "mower";
  const teeth: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++)
    teeth.push(
      box(
        -1.08 + i * 0.36,
        0.18,
        -2.3,
        0.09,
        0.32,
        0.36,
        materials.metal,
        attachment,
      ),
    );
  const seedBox = box(
    0,
    0.73,
    -2.1,
    1.74,
    0.48,
    0.58,
    materials.cream,
    attachment,
  );
  seedBox.name = "seed-box";
  teeth.forEach((tooth, i) => tooth.name = `till-tooth-${i}`);
  seedBox.visible = false;
  return {
    group,
    update(speed: number, dt: number, time: number) {
      wheels.forEach((w) => (w.rotation.x += (speed * dt) / 0.7));
      group.position.y = speed > 0.2 ? Math.sin(time * 9) * 0.025 : 0;
    },
    setTool(tool: Tool) {
      attachment.visible = tool !== "wander";
      mower.material = tool === "till" ? materials.seat : materials.light;
      teeth.forEach((t) => (t.visible = tool === "till"));
      seedBox.visible = tool === "sow";
    },
  };
}
