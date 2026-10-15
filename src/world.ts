import * as THREE from "three";

type Obstacle = { x: number; z: number; radius: number };

/** A small, unhurried corner of the countryside. Coordinates are world metres. */
export function createWorld(scene: THREE.Scene): {
  update: (time: number, dt: number) => void;
  obstacles: Obstacle[];
} {
  const world = new THREE.Group();
  world.name = "The quiet countryside";
  scene.add(world);
  const obstacles: Obstacle[] = [];
  const material = (color: string, roughness = 1) =>
    new THREE.MeshStandardMaterial({ color, roughness });
  const palette = {
    grass: material("#9aaf79"),
    grassLight: material("#a3b580"),
    hill: material("#a4b789"),
    hillLight: material("#b3c293"),
    path: material("#ddcda6"),
    pathEdge: material("#c8bc92"),
    trunk: material("#79664d"),
    wood: material("#a28a65"),
    lightWood: material("#c2aa7d"),
    leaf: material("#7e9b65"),
    leafLight: material("#a6b578"),
    leafDark: material("#668967"),
    leafGold: material("#bcc387"),
    cream: material("#f6eacf"),
    ivory: material("#ede3c8"),
    terracotta: material("#b97858"),
    roof: material("#985e4c"),
    roofLight: material("#ba7e60"),
    dark: material("#5c6655"),
    stone: material("#b9b7a1"),
    stoneLight: material("#cecab1"),
    water: material("#7eafa9", 0.48),
    waterLight: material("#a6c8bb", 0.5),
    wheat: material("#d4bc78"),
    wheatLight: material("#e5ce8e"),
    wheatDark: material("#b5a268"),
    soil: material("#a99969"),
    lavender: material("#aaa0b1"),
    lavenderDark: material("#888d9c"),
    sheep: material("#f1e8cd"),
    sheepFace: material("#7e7964"),
    flower: material("#f2dcaf"),
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const cone = new THREE.ConeGeometry(1, 1, 8);
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const pebble = new THREE.IcosahedronGeometry(1, 0);
  const batches = new Map<
    string,
    {
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      matrices: THREE.Matrix4[];
    }
  >();
  const temp = new THREE.Object3D();
  function add(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    const key = `${geometry.uuid}:${mat.uuid}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { geometry, material: mat, matrices: [] };
      batches.set(key, batch);
    }
    temp.position.set(x, y, z);
    temp.rotation.set(rx, ry, rz);
    temp.scale.set(sx, sy, sz);
    temp.updateMatrix();
    batch.matrices.push(temp.matrix.clone());
  }
  function mesh(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D = world,
  ) {
    const object = new THREE.Mesh(geometry, mat);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  let seed = 2187;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // The broad ground dissolves into the scene's mist, without a hard board edge.
  add(box, palette.grass, 0, -0.7, 0, 240, 1.3, 220);
  const hills = [
    [-43, -0.5, -41, 18, 5, 14],
    [-18, -1, -48, 21, 6, 15],
    [12, -1, -45, 21, 5, 13],
    [42, -1.5, -36, 20, 6, 16],
    [56, -1, -9, 15, 5, 21],
    [-52, -1, -7, 16, 4, 23],
    [-50, -2, 33, 20, 5, 17],
    [6, -2, 51, 34, 5, 18],
  ];
  hills.forEach((h, i) =>
    add(
      sphere,
      i % 2 ? palette.hill : palette.hillLight,
      ...(h as [number, number, number, number, number, number]),
    ),
  );

  // A soft, continuous lane frames the working field.
  function lane(
    points: THREE.Vector3[],
    width: number,
    mat: THREE.Material,
    closed = false,
  ) {
    const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.3);
    const vertices: number[] = [],
      indices: number[] = [];
    const n = points.length * 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        p = curve.getPoint(t),
        d = curve.getTangent(t);
      const dx = (d.z * width) / 2,
        dz = (-d.x * width) / 2;
      vertices.push(p.x + dx, p.y, p.z + dz, p.x - dx, p.y, p.z - dz);
      if (i < n) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const object = mesh(geometry, mat);
    object.castShadow = false;
  }
  const lanePoints = [
    [-27, -10],
    [-27, 10],
    [-25, 17],
    [-17, 18],
    [13, 18],
    [22, 14],
    [23, 3],
    [22, -12],
    [16, -16],
    [-17, -16],
    [-26, -14],
  ];
  lane(
    lanePoints.map(([x, z]) => new THREE.Vector3(x, 0.07, z)),
    2.4,
    palette.path,
    true,
  );
  lane(
    [
      new THREE.Vector3(-26, 0.075, -15),
      new THREE.Vector3(-31, 0.075, -20),
      new THREE.Vector3(-30, 0.075, -29),
    ],
    2.6,
    palette.path,
  );
  lane(
    [
      new THREE.Vector3(22, 0.075, -8),
      new THREE.Vector3(28, 0.075, -8),
      new THREE.Vector3(33, 0.075, -15),
      new THREE.Vector3(40, 0.075, -27),
    ],
    1.75,
    palette.path,
  );
  lane(
    [
      new THREE.Vector3(-26, 0.075, 12),
      new THREE.Vector3(-32, 0.075, 21),
      new THREE.Vector3(-40, 0.075, 26),
      new THREE.Vector3(-55, 0.075, 27),
    ],
    2.7,
    palette.path,
  );

  function tree(x: number, z: number, scale: number, variant = 0) {
    const height = (4.7 + rand() * 1.4) * scale;
    add(
      cylinder,
      palette.trunk,
      x,
      height * 0.35,
      z,
      0.25 * scale,
      height * 0.7,
      0.25 * scale,
    );
    const foliage = [
      palette.leaf,
      palette.leafLight,
      palette.leafDark,
      palette.leafGold,
    ][variant % 4];
    add(
      sphere,
      foliage,
      x,
      height * 0.82,
      z,
      2.1 * scale,
      2.5 * scale,
      1.9 * scale,
      0,
      rand() * 6,
      0.1,
    );
    add(
      sphere,
      foliage,
      x - 1.1 * scale,
      height * 0.66,
      z + 0.25,
      1.55 * scale,
      1.7 * scale,
      1.55 * scale,
      0,
      rand() * 6,
    );
    add(
      sphere,
      variant % 2 ? foliage : palette.leafLight,
      x + 0.95 * scale,
      height * 0.86,
      z + 0.25,
      1.5 * scale,
      1.8 * scale,
      1.45 * scale,
      0,
      rand() * 6,
    );
    obstacles.push({ x, z, radius: 1.2 * scale });
  }
  const trees = [
    [-36, -25, 1.3, 2],
    [-39, -18, 1.0, 0],
    [-34, -12, 1.1, 1],
    [-37, -4, 1.3, 0],
    [-34, 3, 0.85, 1],
    [-38, 11, 1.1, 2],
    [-32, 25, 1.2, 0],
    [-39, 28, 0.9, 1],
    [-20, 28, 1.1, 1],
    [-14, 31, 0.9, 0],
    [3, 30, 0.8, 1],
    [10, 32, 1.05, 0],
    [41, 25, 1.05, 0],
    [43, 16, 1.25, 2],
    [41, 5, 1.1, 1],
    [39, -6, 1.2, 0],
    [34, -25, 1.4, 2],
    [28, -30, 1.1, 0],
    [15, -32, 1.1, 1],
    [6, -34, 1, 0],
    [-6, -34, 1.05, 2],
    [-14, -33, 1.15, 0],
    [-31, -33, 0.8, 1],
    [45, -27, 1, 1],
  ];
  trees.forEach(([x, z, s, v]) => tree(x, z, s, v));

  // Smaller meadow details are instanced, so the scene stays light on an iPad.
  for (let i = 0; i < 115; i++) {
    const x = rand() * 90 - 45,
      z = rand() * 68 - 34;
    if (x > -30 && x < 26 && z > -18 && z < 21) continue;
    if (x > 19 && x < 39 && z > 10 && z < 29) continue;
    if (x > -31 && x < 11 && z < -18) continue;
    add(
      sphere,
      i % 3 ? palette.leaf : palette.leafLight,
      x,
      0.25,
      z,
      0.6 + rand() * 0.5,
      0.4,
      0.6 + rand() * 0.4,
    );
    if (i % 3 === 0)
      for (let j = 0; j < 4; j++)
        add(
          sphere,
          palette.flower,
          x + rand() - 0.5,
          0.5,
          z + rand() - 0.5,
          0.12,
          0.12,
          0.12,
        );
  }

  function fence(points: [number, number][]) {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i],
        [x2, z2] = points[i + 1];
      const length = Math.hypot(x2 - x1, z2 - z1),
        count = Math.ceil(length / 3);
      const angle = -Math.atan2(z2 - z1, x2 - x1);
      for (let j = 0; j <= count; j++) {
        const t = j / count;
        add(
          box,
          palette.lightWood,
          x1 + (x2 - x1) * t,
          0.85,
          z1 + (z2 - z1) * t,
          0.23,
          1.7,
          0.23,
        );
      }
      for (const y of [0.6, 1.25])
        add(
          box,
          palette.wood,
          (x1 + x2) / 2,
          y,
          (z1 + z2) / 2,
          length,
          0.16,
          0.14,
          0,
          angle,
        );
    }
  }
  fence([
    [-33, -28],
    [-33, -15],
  ]);
  fence([
    [-12, -29],
    [11, -29],
    [11, -21],
  ]);
  fence([
    [-29, 22],
    [-21, 25],
    [-7, 25],
  ]);
  fence([
    [26, -22],
    [36, -22],
  ]);

  // A little barn: warm plaster, a standing-seam roof, and open cream doors.
  const bx = -23,
    bz = -24;
  add(box, palette.terracotta, bx, 2.35, bz, 9, 4.6, 7);
  const gable = new THREE.BufferGeometry();
  gable.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -4.5, 0, 3.5, 4.5, 0, 3.5, 0, 3.1, 3.5, 4.5, 0, -3.5, -4.5, 0, -3.5, 0,
        3.1, -3.5,
      ],
      3,
    ),
  );
  gable.computeVertexNormals();
  add(gable, palette.terracotta, bx, 4.65, bz);
  const roofAngle = Math.atan2(3.1, 4.5),
    roofLength = Math.hypot(4.5, 3.1) + 0.55;
  add(
    box,
    palette.roof,
    bx - 2.25,
    6.24,
    bz,
    roofLength,
    0.24,
    8,
    0,
    0,
    roofAngle,
  );
  add(
    box,
    palette.roof,
    bx + 2.25,
    6.24,
    bz,
    roofLength,
    0.24,
    8,
    0,
    0,
    -roofAngle,
  );
  for (let z = bz - 3.7; z <= bz + 3.8; z += 0.9) {
    add(
      box,
      palette.roofLight,
      bx - 2.25,
      6.38,
      z,
      roofLength,
      0.05,
      0.06,
      0,
      0,
      roofAngle,
    );
    add(
      box,
      palette.roofLight,
      bx + 2.25,
      6.38,
      z,
      roofLength,
      0.05,
      0.06,
      0,
      0,
      -roofAngle,
    );
  }
  for (const x of [bx - 4.4, bx + 4.4])
    add(box, palette.cream, x, 2.4, bz + 3.54, 0.22, 4.8, 0.12);
  add(box, palette.dark, bx, 1.85, bz + 3.55, 3.2, 3.7, 0.12);
  for (const x of [bx - 1.74, bx + 1.74])
    add(box, palette.cream, x, 1.95, bz + 3.65, 0.24, 3.9, 0.2);
  add(box, palette.cream, bx, 3.9, bz + 3.65, 3.7, 0.23, 0.22);
  for (const side of [-1, 1]) {
    add(
      box,
      palette.ivory,
      bx + side * 1.05,
      1.8,
      bz + 3.7,
      1.35,
      3.45,
      0.16,
      0,
      side * 0.16,
    );
    add(
      box,
      palette.lightWood,
      bx + side * 1.05,
      1.8,
      bz + 3.82,
      0.12,
      3.25,
      0.09,
      0,
      0,
      side * 0.35,
    );
  }
  add(box, palette.dark, bx, 5.65, bz + 3.55, 1.2, 1.1, 0.12);
  add(box, palette.cream, bx, 5.65, bz + 3.65, 0.1, 1.2, 0.1);
  add(box, palette.cream, bx, 5.65, bz + 3.65, 1.3, 0.1, 0.1);
  // Right-hand window catches the afternoon light.
  add(box, palette.ivory, bx + 4.55, 2.8, bz, 0.12, 1.7, 2.1);
  add(box, palette.dark, bx + 4.63, 2.8, bz, 0.1, 1.3, 1.7);
  add(box, palette.cream, bx + 4.7, 2.8, bz, 0.1, 1.4, 0.11);
  add(box, palette.cream, bx + 4.7, 2.8, bz, 0.1, 0.11, 1.8);
  obstacles.push({ x: bx, z: bz, radius: 5.5 });
  for (let i = 0; i < 3; i++) {
    add(
      cylinder,
      palette.wheat,
      -16.5 + (i % 2) * 1.6,
      0.75 + (i === 2 ? 1.35 : 0),
      -25.5,
      0.8,
      1.4,
      0.8,
      Math.PI / 2,
      0,
      0,
    );
  }

  // The windmill sails have an intentionally slow, almost meditative cadence.
  const wx = 26,
    wz = -10.8;
  const tower = new THREE.CylinderGeometry(1.35, 2.15, 8.4, 12);
  add(tower, palette.ivory, wx, 4.25, wz);
  add(cylinder, palette.stoneLight, wx, 0.27, wz, 2.45, 0.45, 2.45);
  add(cone, palette.roof, wx, 9.65, wz, 2.1, 2.8, 2.1, 0, Math.PI / 8);
  add(cylinder, palette.lightWood, wx, 8.25, wz, 1.48, 0.25, 1.48);
  add(box, palette.dark, wx, 1.25, wz + 1.97, 0.95, 2.2, 0.12);
  add(box, palette.wood, wx, 1.23, wz + 2.06, 0.78, 2.12, 0.1);
  add(sphere, palette.cream, wx + 0.26, 1.25, wz + 2.14, 0.07, 0.07, 0.07);
  for (const y of [4.1, 6.3]) {
    add(box, palette.dark, wx, y, wz + 1.65 - (y - 4) * 0.08, 0.55, 0.9, 0.1);
    add(box, palette.cream, wx, y, wz + 1.73 - (y - 4) * 0.08, 0.07, 0.94, 0.1);
  }
  const sails = new THREE.Group();
  sails.name = "windmill-sails";
  sails.position.set(wx, 7.6, wz + 1.85);
  sails.rotation.z = Math.PI / 5;
  world.add(sails);
  const armGeometry = new THREE.BoxGeometry(0.14, 10.6, 0.17);
  for (const rotation of [0, Math.PI / 2]) {
    const arm = mesh(armGeometry, palette.wood, sails);
    arm.rotation.z = rotation;
  }
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (i * Math.PI) / 2;
    sails.add(blade);
    const fabric = mesh(
      new THREE.BoxGeometry(0.88, 3.15, 0.055),
      palette.cream,
      blade,
    );
    fabric.position.set(0.5, 3.46, 0.01);
    for (const x of [0.07, 0.94]) {
      const spar = mesh(
        new THREE.BoxGeometry(0.065, 3.32, 0.09),
        palette.lightWood,
        blade,
      );
      spar.position.set(x, 3.46, 0.05);
    }
    for (let j = 0; j < 6; j++) {
      const rib = mesh(
        new THREE.BoxGeometry(0.98, 0.055, 0.08),
        palette.wood,
        blade,
      );
      rib.position.set(0.5, 1.88 + j * 0.63, 0.08);
    }
  }
  const hub = mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.6, 12),
    palette.terracotta,
    sails,
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.2;
  obstacles.push({ x: wx, z: wz, radius: 2.7 });

  // A smaller mill sits in the meadow, inviting gentle circles and tidy passes.
  const meadowMillX = 10,
    meadowMillZ = -5,
    meadowMillScale = 0.7;
  const millPart = (
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    rx = 0,
    ry = 0,
    rz = 0,
  ) => {
    add(
      geometry,
      mat,
      meadowMillX + x * meadowMillScale,
      y * meadowMillScale,
      meadowMillZ + z * meadowMillScale,
      sx * meadowMillScale,
      sy * meadowMillScale,
      sz * meadowMillScale,
      rx,
      ry,
      rz,
    );
  };
  add(
    new THREE.CylinderGeometry(1, 1, 1, 32),
    palette.stoneLight,
    meadowMillX,
    0.14,
    meadowMillZ,
    1.85,
    0.26,
    1.85,
  );
  millPart(tower, palette.cream, 0, 4.25, 0);
  millPart(cone, palette.terracotta, 0, 9.65, 0, 2.1, 2.8, 2.1, 0, Math.PI / 8);
  millPart(cylinder, palette.lightWood, 0, 8.25, 0, 1.48, 0.25, 1.48);
  millPart(box, palette.dark, 0, 1.25, 1.97, 0.95, 2.2, 0.12);
  millPart(box, palette.wood, 0, 1.23, 2.06, 0.78, 2.12, 0.1);
  millPart(sphere, palette.cream, 0.26, 1.25, 2.14, 0.07, 0.07, 0.07);
  for (const y of [4.1, 6.3]) {
    millPart(box, palette.dark, 0, y, 1.65 - (y - 4) * 0.08, 0.55, 0.9, 0.1);
    millPart(box, palette.ivory, 0, y, 1.73 - (y - 4) * 0.08, 0.07, 0.94, 0.1);
  }
  const meadowSails = new THREE.Group();
  meadowSails.name = "meadow-sails";
  meadowSails.position.set(
    meadowMillX,
    7.6 * meadowMillScale,
    meadowMillZ + 1.85 * meadowMillScale,
  );
  meadowSails.scale.setScalar(meadowMillScale);
  meadowSails.rotation.z = -Math.PI / 9;
  world.add(meadowSails);
  const sailBatches = new Map<THREE.Material, THREE.Matrix4[]>();
  function sailPart(
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    angle: number,
  ) {
    const matrices = sailBatches.get(mat) ?? [];
    temp.position.set(
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
      z,
    );
    temp.rotation.set(0, 0, angle);
    temp.scale.set(sx, sy, sz);
    temp.updateMatrix();
    matrices.push(temp.matrix.clone());
    sailBatches.set(mat, matrices);
  }
  for (const angle of [0, Math.PI / 2])
    sailPart(palette.wood, 0, 0, 0, 0.14, 10.6, 0.17, angle);
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    sailPart(palette.cream, 0.5, 3.46, 0.01, 0.88, 3.15, 0.055, angle);
    for (const x of [0.07, 0.94])
      sailPart(palette.lightWood, x, 3.46, 0.05, 0.065, 3.32, 0.09, angle);
    for (let j = 0; j < 6; j++)
      sailPart(
        palette.wood,
        0.5,
        1.88 + j * 0.63,
        0.08,
        0.98,
        0.055,
        0.08,
        angle,
      );
  }
  for (const [mat, matrices] of sailBatches) {
    const parts = new THREE.InstancedMesh(box, mat, matrices.length);
    matrices.forEach((matrix, i) => parts.setMatrixAt(i, matrix));
    parts.castShadow = true;
    parts.receiveShadow = true;
    parts.instanceMatrix.needsUpdate = true;
    meadowSails.add(parts);
  }
  const meadowHub = mesh(cylinder, palette.terracotta, meadowSails);
  meadowHub.scale.set(0.38, 0.6, 0.38);
  meadowHub.rotation.x = Math.PI / 2;
  meadowHub.position.z = 0.2;
  obstacles.push({ x: meadowMillX, z: meadowMillZ, radius: 1.6 });

  // Wheat is a quiet visual counterpoint to the generous open working field.
  add(box, palette.soil, -1, 0.08, -23, 21, 0.12, 8.2);
  for (let row = 0; row < 12; row++) {
    const z = -26.7 + row * 0.68;
    add(box, palette.wheatDark, -1, 0.17, z, 20.5, 0.16, 0.43);
    for (let col = 0; col < 39; col++) {
      const x = -10.9 + col * 0.52 + rand() * 0.1,
        h = 0.55 + rand() * 0.24;
      add(
        cylinder,
        palette.wheatDark,
        x,
        h / 2 + 0.15,
        z,
        0.022,
        h,
        0.022,
        0.07,
        0,
        -0.09,
      );
      add(
        sphere,
        (col + row) % 3 ? palette.wheat : palette.wheatLight,
        x + 0.025,
        h + 0.1,
        z,
        0.13,
        0.32,
        0.12,
        0.1,
        0,
        -0.12,
      );
    }
  }

  // An irregular pond with a sandy margin, reeds, lilies, and delicate ripples.
  function pondSurface(
    x: number,
    z: number,
    sx: number,
    sz: number,
    y: number,
    mat: THREE.Material,
  ) {
    const vertices = [x, y, z],
      indices: number[] = [];
    const count = 52;
    for (let i = 0; i <= count; i++) {
      const a = (i / count) * Math.PI * 2,
        wave = 1 + 0.065 * Math.sin(a * 3 + 0.5) + 0.045 * Math.sin(a * 5);
      vertices.push(
        x + Math.cos(a) * sx * wave,
        y,
        z + Math.sin(a) * sz * wave,
      );
      if (i < count) indices.push(0, i + 2, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const object = mesh(geometry, mat);
    object.castShadow = false;
    return object;
  }
  pondSurface(30.5, 20, 7.6, 5.6, 0.09, palette.pathEdge);
  pondSurface(30.5, 20, 7.1, 5.15, 0.12, palette.water);
  obstacles.push({ x: 30.5, z: 20, radius: 7 });
  const rippleMaterial = new THREE.LineBasicMaterial({
    color: "#cce1cc",
    transparent: true,
    opacity: 0.47,
  });
  const ripples: THREE.Line[] = [];
  for (let i = 0; i < 5; i++) {
    const points: THREE.Vector3[] = [];
    const x = 27 + i * 1.4,
      z = 18 + (i % 2) * 3;
    for (let j = 0; j <= 30; j++) {
      const a = (j / 30) * Math.PI * 1.4;
      points.push(
        new THREE.Vector3(
          Math.cos(a) * (0.7 + i * 0.16),
          0,
          Math.sin(a) * 0.35,
        ),
      );
    }
    const ripple = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      rippleMaterial,
    );
    ripple.position.set(x, 0.14, z);
    world.add(ripple);
    ripples.push(ripple);
  }
  for (let i = 0; i < 9; i++) {
    const a = i * 0.74,
      x = 30.5 + Math.cos(a) * 6.5,
      z = 20 + Math.sin(a) * 4.7;
    for (let j = 0; j < 4; j++) {
      const xx = x + rand() * 0.6,
        zz = z + rand() * 0.5,
        height = 0.55 + rand() * 0.7;
      add(
        cylinder,
        palette.leafDark,
        xx,
        height / 2,
        zz,
        0.035,
        height,
        0.035,
        0,
        0,
        (rand() - 0.5) * 0.3,
      );
      if (j % 2)
        add(cylinder, palette.trunk, xx, height, zz, 0.065, 0.3, 0.065);
    }
    if (i % 2 === 0)
      add(
        pebble,
        palette.stone,
        x + 0.35,
        0.27,
        z + 0.35,
        0.65,
        0.4,
        0.45,
        0.1,
        a,
      );
  }
  for (let i = 0; i < 7; i++) {
    const x = 33 + rand() * 2,
      z = 18 + rand() * 4;
    add(cylinder, palette.leaf, x, 0.15, z, 0.34, 0.04, 0.3);
    if (i % 3 === 0) add(sphere, palette.cream, x, 0.23, z, 0.15, 0.12, 0.15);
  }

  // Lavender and a bench invite a pause on the far side of the lane.
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 10; col++) {
      const x = 31 + row * 1.35,
        z = -3.5 + col * 0.8;
      add(sphere, palette.leaf, x, 0.3, z, 0.6, 0.4, 0.53);
      for (let j = 0; j < 3; j++)
        add(
          sphere,
          j % 2 ? palette.lavender : palette.lavenderDark,
          x + (j - 1) * 0.22,
          0.77,
          z,
          0.16,
          0.5 + rand() * 0.1,
          0.17,
        );
    }
  for (const x of [22.7, 25]) {
    add(box, palette.dark, x, 0.4, 24.4, 0.16, 0.8, 0.9);
    add(box, palette.dark, x, 0.95, 24.8, 0.16, 1.5, 0.14);
  }
  add(box, palette.lightWood, 23.85, 0.85, 24.4, 3, 0.16, 1);
  add(box, palette.lightWood, 23.85, 1.45, 24.85, 3, 0.5, 0.16);

  // A few contented sheep, intentionally far from the driving space.
  const sheep = new THREE.Group();
  world.add(sheep);
  const sheepBodies: { object: THREE.Group; phase: number }[] = [];
  function makeSheep(x: number, z: number, angle: number) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = angle;
    sheep.add(group);
    const body = mesh(sphere, palette.sheep, group);
    body.position.y = 0.88;
    body.scale.set(0.73, 0.58, 0.48);
    const head = mesh(sphere, palette.sheepFace, group);
    head.position.set(0.73, 0.8, 0);
    head.scale.set(0.32, 0.34, 0.25);
    head.rotation.z = -0.35;
    for (const xx of [-0.4, 0.4])
      for (const zz of [-0.24, 0.24]) {
        const leg = mesh(cylinder, palette.sheepFace, group);
        leg.position.set(xx, 0.31, zz);
        leg.scale.set(0.065, 0.65, 0.065);
      }
    for (const zz of [-0.3, 0.3]) {
      const ear = mesh(sphere, palette.sheepFace, group);
      ear.position.set(0.67, 1.04, zz);
      ear.scale.set(0.18, 0.07, 0.15);
    }
    sheepBodies.push({ object: group, phase: rand() * Math.PI * 2 });
  }
  makeSheep(-16, 22.4, 0.6);
  makeSheep(-11.5, 22.8, 2.8);
  makeSheep(-20, 21.6, -0.7);

  // Two small birds drift above the wheat. Their silhouettes remain understated.
  const birds: THREE.Group[] = [];
  const birdMat = material("#6d7660");
  for (let i = 0; i < 3; i++) {
    const bird = new THREE.Group();
    bird.name = `bird-${i}`;
    world.add(bird);
    for (const side of [-1, 1]) {
      const wing = mesh(new THREE.BoxGeometry(0.7, 0.045, 0.15), birdMat, bird);
      wing.position.x = side * 0.3;
      wing.rotation.z = side * 0.22;
    }
    birds.push(bird);
  }
  for (const batch of batches.values()) {
    const instances = new THREE.InstancedMesh(
      batch.geometry,
      batch.material,
      batch.matrices.length,
    );
    batch.matrices.forEach((matrix, i) => instances.setMatrixAt(i, matrix));
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.instanceMatrix.needsUpdate = true;
    world.add(instances);
  }
  return {
    obstacles,
    update(time: number, dt: number) {
      sails.rotation.z -= dt * 0.11;
      meadowSails.rotation.z -= dt * 0.085;
      ripples.forEach((ripple, i) => {
        const scale = 1 + Math.sin(time * 0.4 + i) * 0.12;
        ripple.scale.set(scale, 1, scale);
      });
      birds.forEach((bird, i) => {
        const t = time * 0.075 + i * 0.32;
        bird.position.set(
          Math.sin(t) * 13 - 2,
          13 + Math.sin(t * 2 + i) * 0.7,
          -22 + Math.cos(t) * 5 + i,
        );
        bird.rotation.y = -t;
        bird.children.forEach((wing, j) => {
          wing.rotation.z =
            (j ? 1 : -1) * (0.16 + Math.sin(time * 3 + i) * 0.2);
        });
      });
      sheepBodies.forEach(({ object, phase }) => {
        object.rotation.z = Math.sin(time * 0.45 + phase) * 0.014;
      });
    },
  };
}
