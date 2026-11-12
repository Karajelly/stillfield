import * as THREE from "three";

/**
 * The small lights that come on as the day ends: warm windows in the barn and
 * the windmill, the tractor's lamps, and fireflies over the pond. They sit in
 * their own module so the exported native geometry in world.ts and tractor.ts
 * stays untouched.
 */
export function createDusk(scene: THREE.Scene, tractor: THREE.Group) {
  const group = new THREE.Group();
  group.name = "dusk";
  scene.add(group);
  // Unlit and outside tone mapping, so a lit pane reads as a light source.
  const glowing = (color: string) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
  const windowLight = glowing("#ffd38a"),
    doorLight = glowing("#e9a45c"),
    lampLight = glowing("#fff3cf"),
    tailLight = glowing("#ff8a6e");
  const pane = new THREE.PlaneGeometry(1, 1);
  function lit(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    facingX = false,
    parent: THREE.Object3D = group,
  ) {
    const mesh = new THREE.Mesh(pane, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, 1);
    if (facingX) mesh.rotation.y = Math.PI / 2;
    mesh.renderOrder = 1;
    parent.add(mesh);
    return mesh;
  }
  // Each pane sits a few millimetres proud of the dark glass built in world.ts.
  const bx = -23,
    bz = -24,
    wx = 26,
    wz = -10.8;
  lit(doorLight, bx, 1.85, bz + 3.615, 3.2, 3.7);
  lit(windowLight, bx, 5.65, bz + 3.615, 1.2, 1.1);
  lit(windowLight, bx + 4.685, 2.8, bz, 1.7, 1.3, true);
  for (const y of [4.1, 6.3])
    lit(windowLight, wx, y, wz + 1.705 - (y - 4) * 0.08, 0.55, 0.9);

  // Two soft pools of lamplight on the ground, by the barn and the windmill.
  const barnLamp = new THREE.PointLight("#ffb066", 0, 26, 1.6);
  barnLamp.position.set(bx + 5.2, 3.4, bz + 6);
  const millLamp = new THREE.PointLight("#ffbe7a", 0, 15, 1.6);
  millLamp.position.set(wx, 3.2, wz + 3.4);
  group.add(barnLamp, millLamp);

  // The tractor's lamps: lit lenses, tail lights, and a beam down the row.
  const lamps = new THREE.Group();
  lamps.name = "lamps";
  tractor.add(lamps);
  const lens = new THREE.CircleGeometry(0.125, 16);
  for (const side of [-1, 1]) {
    const front = new THREE.Mesh(lens, lampLight);
    front.position.set(side * 0.52, 1.39, 1.572);
    const rear = new THREE.Mesh(lens, tailLight);
    rear.position.set(side * 1.01, 1.13, -1.75);
    rear.rotation.y = Math.PI;
    rear.scale.set(0.8, 0.5, 1);
    lamps.add(front, rear);
  }
  const beam = new THREE.SpotLight("#ffe7b4", 0, 24, 0.5, 0.9, 1.4);
  beam.position.set(0, 1.9, 1.3);
  beam.target.position.set(0, 0, 11);
  lamps.add(beam, beam.target);

  // Fireflies drift over the pond and the reeds around it.
  const COUNT = 54;
  const flies = Array.from({ length: COUNT }, (_, i) => {
    const turn = i * 2.399963,
      reach = Math.sqrt((i + 0.5) / COUNT);
    return {
      x: 30.5 + Math.cos(turn) * reach * 11.5,
      z: 20 + Math.sin(turn) * reach * 8.5,
      y: 0.5 + ((i * 7) % 11) * 0.17,
      phase: i * 1.7,
      pace: 0.5 + ((i * 13) % 7) * 0.09,
    };
  });
  const positions = new Float32Array(COUNT * 3),
    colors = new Float32Array(COUNT * 3);
  const flyGeometry = new THREE.BufferGeometry();
  flyGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  flyGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const dot = document.createElement("canvas");
  dot.width = dot.height = 64;
  const ctx = dot.getContext("2d")!;
  const halo = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  halo.addColorStop(0, "rgba(255,255,255,1)");
  halo.addColorStop(0.25, "rgba(255,255,255,0.55)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 64, 64);
  const flyMaterial = new THREE.PointsMaterial({
    size: 9,
    sizeAttenuation: false,
    map: new THREE.CanvasTexture(dot),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const fireflies = new THREE.Points(flyGeometry, flyMaterial);
  fireflies.frustumCulled = false;
  fireflies.visible = false;
  group.add(fireflies);

  return {
    /** Postcards render larger than the screen, so their fireflies grow to match. */
    setPointScale(scale: number) {
      flyMaterial.size = 9 * scale;
    },
    /** `glow` is 0 by day and 1 after dark. A still `time` holds the fireflies. */
    update(glow: number, time: number) {
      const on = Math.max(0, Math.min(1, glow));
      windowLight.opacity = on;
      doorLight.opacity = on * 0.85;
      lampLight.opacity = on;
      tailLight.opacity = on * 0.9;
      barnLamp.intensity = on * 95;
      millLamp.intensity = on * 38;
      beam.intensity = on * 85;
      fireflies.visible = on > 0.02;
      if (!fireflies.visible) return;
      // They come out a little after the windows do.
      const out = Math.max(0, (on - 0.35) / 0.65);
      flies.forEach((fly, i) => {
        const t = time * fly.pace + fly.phase;
        positions[i * 3] = fly.x + Math.sin(t * 0.31) * 1.6;
        positions[i * 3 + 1] = fly.y + Math.sin(t * 0.47 + 1) * 0.35;
        positions[i * 3 + 2] = fly.z + Math.cos(t * 0.23) * 1.3;
        // Each one glows and fades on its own slow rhythm.
        const blink = Math.max(0, Math.sin(t * 0.9)) ** 3 * out;
        colors[i * 3] = 1.0 * blink;
        colors[i * 3 + 1] = 0.86 * blink;
        colors[i * 3 + 2] = 0.32 * blink;
      });
      flyGeometry.attributes.position.needsUpdate = true;
      flyGeometry.attributes.color.needsUpdate = true;
    },
  };
}
