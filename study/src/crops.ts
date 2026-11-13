import * as THREE from "three";
import { seededRandom } from "../../src/simulation";
import { PlantGeometry } from "./plant-material";
import type { PartStyle } from "./plant-material";

/**
 * The proposed plants. Each is drawn to be read twice: as a texture from the
 * farm view, where a plant is a few pixels and only colour, density and grain
 * survive, and as a character from behind the tractor, where silhouette does
 * the work. They are chunkier and softer than the shipping plants on purpose,
 * to sit in the same toy world as the trees, the barn and the tractor.
 */
export const PALETTE = {
  // Wheat: fresh green, then straw with a deep gold ear.
  wheatLeaf: "#7fa651",
  wheatStraw: "#cfa24a",
  wheatEarYoung: "#a8c26a",
  wheatEar: "#e3a12a",
  wheatAwn: "#f0c964",
  // Sunflowers: a dark stem and leaf so the face is the brightest thing in the field.
  sunStem: "#5f8f48",
  sunStemRipe: "#6c8c46",
  sunLeaf: "#568c46",
  sunLeafRipe: "#6a8c44",
  sunBud: "#9db652",
  sunPetalYoung: "#cfd457",
  sunPetal: "#f7bd12",
  sunPetalBack: "#eba40c",
  sunDisc: "#6b4424",
  sunDiscRim: "#4a2f1b",
  // Pumpkins: orange against its complement, not against terracotta soil.
  vineLeaf: "#4f8a4c",
  vineLeafLight: "#6aa257",
  vineLeafOld: "#557f45",
  vineLeafOldLight: "#6c9350",
  vineStem: "#6d9450",
  blossom: "#f3c93e",
  fruitYoung: "#c9c566",
  fruit: "#e9741a",
  fruitStem: "#7d7b46",
  // The meadow, calmed down so that crops are the figure and grass the ground.
  grass: "#97af6b",
  grassLight: "#a8bc78",
  straw: "#dcc68a",
  strawDark: "#c9b074",
  wickerDark: "#96744a",
} as const;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const still: [number, number] = [-1, -0.5];
const TAU = Math.PI * 2;

/** A plump tuft of wheat that fills its 50 cm square. */
export function wheatTuft(seed: number) {
  const random = seededRandom(seed), g = new PlantGeometry();
  g.skyward = 0.5;
  const stalk: PartStyle = { a: PALETTE.wheatLeaf, b: PALETTE.wheatStraw, appear: [0.02, 0.6], ripen: [0.68, 0.95], flex: 1 };
  const tips: { point: THREE.Vector3; direction: THREE.Vector3 }[] = [];
  g.part(stalk, V(0, 0, 0));
  const stalks = 9;
  for (let i = 0; i < stalks; i++) {
    const angle = (i / stalks) * TAU + random() * 0.7;
    const lean = 0.1 + random() * 0.26, length = 0.5 + random() * 0.2, away = random() * 0.09;
    const foot = V(Math.sin(angle) * away, 0, Math.cos(angle) * away);
    const direction = V(Math.sin(angle) * Math.sin(lean), Math.cos(lean), Math.cos(angle) * Math.sin(lean));
    g.blade(foot, direction, length, 0.07, 0.015, 0.55, 2, 0.9 + random() * 0.2);
    tips.push({ point: foot.clone().addScaledVector(direction, length), direction });
  }
  // Flag leaves arch out low down and give the tuft a body.
  g.part({ ...stalk, appear: [0.1, 0.52], ripen: [0.6, 0.9] }, V(0, 0, 0));
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * TAU + random() * 1.2;
    g.blade(V(0, 0.04, 0), V(Math.sin(angle) * 0.8, 0.6, Math.cos(angle) * 0.8), 0.36 + random() * 0.1, 0.09, 0.2, 0, 2, 0.82);
  }
  for (const tip of tips.slice(0, 6)) {
    const ear: PartStyle = {
      a: PALETTE.wheatEarYoung, b: PALETTE.wheatEar, appear: [0.5, 0.78], ripen: [0.72, 0.97],
      parent: stalk.appear, flex: 1, nod: 1, glow: 1,
    };
    const axis = tip.direction.clone().add(V(tip.direction.x, 0, tip.direction.z).multiplyScalar(0.6)).normalize();
    g.part(ear, tip.point);
    g.ellipsoid(tip.point.clone().addScaledVector(axis, 0.1), axis, 0.22, 0.048, 5, 3, 1.08, 0.86);
    // A short beard at the tip is what makes the silhouette read as wheat.
    g.part({ ...ear, a: PALETTE.wheatEarYoung, b: PALETTE.wheatAwn }, tip.point);
    const top = tip.point.clone().addScaledVector(axis, 0.2);
    for (let k = 0; k < 2; k++) {
      const spread = V(random() - 0.5, 0.2, random() - 0.5).multiplyScalar(0.5).add(axis).normalize();
      g.blade(top, spread, 0.11, 0.022, 0, 0, 1);
    }
  }
  return g;
}

/**
 * A sunflower built facing +z. The field turns every plant the same way, so a
 * field has a front, and from the farm view the fronts look back at you.
 */
export function sunflower(seed: number) {
  const random = seededRandom(seed), g = new PlantGeometry();
  g.skyward = 0.35;
  const height = 1.24 + random() * 0.34;
  const stem: PartStyle = { a: PALETTE.sunStem, b: PALETTE.sunStemRipe, appear: [0.02, 0.74], ripen: [0.8, 1], flex: 0.7 };
  const sway = (random() - 0.5) * 0.06;
  const path = [V(0, 0, 0), V(sway, height * 0.38, 0), V(-sway, height * 0.76, 0.02), V(0, height * 0.95, 0.07), V(0, height, 0.13)];
  g.part(stem, V(0, 0, 0));
  g.tube(path, 0.034, 0.022, 5);
  for (let i = 0; i < 6; i++) {
    const y = height * (0.16 + 0.125 * i), angle = i * 2.4 + random() * 0.5;
    const length = 0.36 - i * 0.022, width = 0.27 - i * 0.015;
    const out = V(Math.sin(angle), 0, Math.cos(angle)), side = V(Math.cos(angle), 0, -Math.sin(angle));
    const attach = V(0, y, 0);
    g.part({
      a: i % 2 ? PALETTE.sunLeaf : PALETTE.sunStem, b: i % 2 ? PALETTE.sunLeafRipe : PALETTE.sunStemRipe,
      appear: [0.08 + 0.085 * i, 0.3 + 0.085 * i], ripen: [0.8, 1], parent: stem.appear, flex: 0.7,
    }, attach);
    // A heart: broad near the stem, a drooping point.
    const shoulder = (sign: number) => attach.clone().addScaledVector(out, length * 0.34).addScaledVector(side, (sign * width) / 2).add(V(0, 0.05, 0));
    const tip = attach.clone().addScaledVector(out, length).add(V(0, -0.11, 0));
    const middle = attach.clone().addScaledVector(out, length * 0.5).add(V(0, 0.015, 0));
    g.tri(attach, shoulder(-1), middle, 0.94).tri(attach, middle, shoulder(1), 1.04);
    g.tri(shoulder(-1), tip, middle, 0.9).tri(middle, tip, shoulder(1), 1);
  }
  // The head looks a little above the horizon, which is face-on to the farm view.
  const tilt = 0.5;
  const facing = V(0, Math.sin(tilt), Math.cos(tilt));
  const across = V(1, 0, 0), up = new THREE.Vector3().crossVectors(facing, across);
  const centre = path[4].clone().addScaledVector(facing, 0.035);
  const on = (radius: number, angle: number, forward = 0) =>
    centre.clone().addScaledVector(across, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius).addScaledVector(facing, forward);
  const scale = 0.92 + random() * 0.2;
  const head = { parent: stem.appear, flex: 0.7 };
  g.part({ a: PALETTE.sunBud, b: PALETTE.sunLeaf, appear: [0.5, 0.76], ripen: [0.7, 0.9], ...head }, centre);
  for (let i = 0; i < 8; i++)
    g.tri(centre.clone().addScaledVector(facing, -0.085), on(0.15 * scale, ((i + 1) / 8) * TAU), on(0.15 * scale, (i / 8) * TAU));
  for (const [ring, radius, forward, tone] of [[0, 0.205, -0.012, PALETTE.sunPetalBack], [1, 0.245, 0.012, PALETTE.sunPetal]] as const) {
    g.part({ a: PALETTE.sunPetalYoung, b: tone, appear: [0.66, 0.9], ripen: [0.66, 0.9], glow: 1, ...head }, centre);
    const petals = 13;
    for (let i = 0; i < petals; i++) {
      const angle = ((i + ring * 0.5) / petals) * TAU + 0.2, half = (TAU / petals) * 0.46;
      g.tri(on(0.075 * scale, angle, forward), on(0.15 * scale, angle - half, forward + 0.01), on(radius * scale, angle, forward + 0.028), 0.96);
      g.tri(on(0.075 * scale, angle, forward), on(radius * scale, angle, forward + 0.028), on(0.15 * scale, angle + half, forward + 0.01), 1.05);
    }
  }
  // A seed disc that darkens toward its rim, like the real thing.
  const disc = { appear: [0.5, 0.78] as [number, number], ripen: [0.7, 0.93] as [number, number], ...head };
  const hub = centre.clone().addScaledVector(facing, 0.05);
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * TAU, a1 = ((i + 1) / 10) * TAU;
    g.part({ a: PALETTE.sunBud, b: PALETTE.sunDisc, ...disc }, centre);
    g.smooth(hub, facing, on(0.065 * scale, a0, 0.04), facing, on(0.065 * scale, a1, 0.04), facing, [1.5, 1.12, 1.12]);
    g.part({ a: PALETTE.sunBud, b: PALETTE.sunDiscRim, ...disc }, centre);
    const rim0 = on(0.118 * scale, a0, 0.016), rim1 = on(0.118 * scale, a1, 0.016);
    const n0 = rim0.clone().sub(centre).normalize().lerp(facing, 0.6).normalize(), n1 = rim1.clone().sub(centre).normalize().lerp(facing, 0.6).normalize();
    g.smooth(on(0.065 * scale, a0, 0.04), facing, rim0, n0, rim1, n1, [1.5, 1, 1]);
    g.smooth(on(0.065 * scale, a0, 0.04), facing, rim1, n1, on(0.065 * scale, a1, 0.04), facing, [1.5, 1, 1.5]);
  }
  return g;
}

/** Add one ribbed pumpkin, sitting on `ground`. Radius 1 is a metre across at the widest rib. */
export function addPumpkin(g: PlantGeometry, ground: THREE.Vector3, radius: number, squash = 0.74, yaw = 0, ribs = 8) {
  const radial = ribs * 2, rings = 5;
  const point = (ring: number, seg: number) => {
    const lat = (ring / rings) * Math.PI, lon = (seg / radial) * TAU + yaw;
    // Creases run pole to pole between the ribs.
    const crease = Math.pow(Math.abs(Math.cos((ribs * (lon - yaw)) / 2)), 2.2);
    const r = Math.pow(Math.sin(lat), 0.82) * (1 - 0.13 * crease) * radius;
    const dimple = Math.pow(Math.abs(Math.cos(lat)), 6) * 0.1;
    return {
      p: V(ground.x + Math.cos(lon) * r, ground.y + (squash + (Math.cos(lat) - Math.sign(Math.cos(lat)) * dimple) * squash) * radius, ground.z + Math.sin(lon) * r),
      shade: (1.06 - 0.24 * crease) * (0.86 + 0.16 * (0.5 + Math.cos(lat) / 2)),
    };
  };
  const normalAt = (ring: number, seg: number) => {
    const a = point(ring, seg - 1).p, b = point(ring, seg + 1).p;
    const c = point(Math.max(0, ring - 1), seg).p, d = point(Math.min(rings, ring + 1), seg).p;
    const n = new THREE.Vector3().crossVectors(b.sub(a), d.sub(c));
    if (n.lengthSq() < 1e-10) n.set(0, ring === 0 ? 1 : -1, 0);
    // Keep normals pointing out of the fruit.
    const outward = point(ring, seg).p.sub(V(ground.x, ground.y + squash * radius, ground.z));
    if (n.dot(outward) < 0) n.negate();
    return n.normalize();
  };
  for (let ring = 0; ring < rings; ring++)
    for (let seg = 0; seg < radial; seg++) {
      const a = point(ring, seg), b = point(ring + 1, seg), c = point(ring + 1, seg + 1), d = point(ring, seg + 1);
      const na = normalAt(ring, seg), nb = normalAt(ring + 1, seg), nc = normalAt(ring + 1, seg + 1), nd = normalAt(ring, seg + 1);
      if (ring > 0) g.smooth(a.p, na, d.p, nd, b.p, nb, [a.shade, d.shade, b.shade]);
      if (ring < rings - 1) g.smooth(d.p, nd, c.p, nc, b.p, nb, [d.shade, c.shade, b.shade]);
    }
}

/** The fruit alone, a metre across; the field scales each one to its own size. */
export function pumpkinFruit() {
  const g = new PlantGeometry();
  const fruit: PartStyle = { a: PALETTE.fruitYoung, b: PALETTE.fruit, appear: [0.4, 0.96], ripen: [0.76, 0.98], flex: 0 };
  g.part(fruit, V(0, 0, 0));
  addPumpkin(g, V(0, 0, 0), 0.5);
  g.part({ a: PALETTE.vineStem, b: PALETTE.fruitStem, appear: [0.5, 0.95], ripen: [0.7, 0.96], parent: fruit.appear, flex: 0 }, V(0, 0.7, 0));
  g.tube([V(0, 0.68, 0), V(0.02, 0.8, 0), V(0.09, 0.9, 0.02)], 0.075, 0.05, 5);
  return g;
}

/** The leaves of a pumpkin vine in one 50 cm square, with the odd blossom. */
export function pumpkinVine(seed: number, blossom: boolean) {
  const random = seededRandom(seed), g = new PlantGeometry();
  g.skyward = 0.65;
  for (let i = 0; i < 4; i++) {
    const angle = i * 1.65 + random() * 0.9, reach = 0.09 + random() * 0.15;
    const height = 0.15 + random() * 0.17, size = 0.23 + random() * 0.07;
    const centre = V(Math.sin(angle) * reach, height, Math.cos(angle) * reach);
    const light = i % 2 === 0;
    const leaf: PartStyle = {
      a: light ? PALETTE.vineLeafLight : PALETTE.vineLeaf, b: light ? PALETTE.vineLeafOldLight : PALETTE.vineLeafOld,
      appear: [0.04 + 0.05 * i, 0.46 + 0.05 * i], ripen: [0.74, 0.98], flex: 0.45, nod: 1.1,
    };
    g.part({ ...leaf, a: PALETTE.vineStem, b: PALETTE.vineLeafOld }, V(0, 0, 0));
    g.blade(V(0, 0, 0), centre.clone().normalize(), centre.length(), 0.022, 0, 0.8, 1);
    // A broad five-pointed leaf, cupped and tilted its own way.
    g.part(leaf, V(0, 0, 0));
    const tilt = V((random() - 0.5) * 0.7, 1, (random() - 0.5) * 0.7).normalize();
    const u = new THREE.Vector3().crossVectors(tilt, V(0, 0, 1)).normalize(), w = new THREE.Vector3().crossVectors(tilt, u);
    const rim = (k: number) => {
      const a = (k / 10) * TAU + angle, r = size * (k % 2 ? 0.9 : 1);
      return centre.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r).addScaledVector(tilt, -r * 0.16);
    };
    for (let k = 0; k < 10; k++) g.tri(centre, rim(k), rim(k + 1), 0.9 + (k % 3) * 0.07);
  }
  if (blossom) {
    // Open through the middle of the season, then fold away under the leaves.
    const at = V((random() - 0.5) * 0.2, 0.3, (random() - 0.5) * 0.2);
    g.part({ a: PALETTE.blossom, b: PALETTE.vineLeafOld, appear: [0.3, 0.44], ripen: [0.62, 0.8], flex: 0.45, nod: 3.2, glow: 1 }, V(0, 0, 0));
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * TAU, a1 = ((k + 1) / 5) * TAU, am = (a0 + a1) / 2;
      g.tri(at, at.clone().add(V(Math.cos(a0) * 0.05, 0.02, Math.sin(a0) * 0.05)), at.clone().add(V(Math.cos(am) * 0.11, 0.045, Math.sin(am) * 0.11)));
      g.tri(at, at.clone().add(V(Math.cos(am) * 0.11, 0.045, Math.sin(am) * 0.11)), at.clone().add(V(Math.cos(a1) * 0.05, 0.02, Math.sin(a1) * 0.05)));
    }
  }
  return g;
}

/** Soft meadow grass: three arching blades, as the native app already draws it. */
export function grassTuft(seed: number) {
  const random = seededRandom(seed), g = new PlantGeometry();
  g.skyward = 0.6;
  for (let i = 0; i < 3; i++) {
    const angle = i * 2.3 + random() * 0.8, height = 0.3 + random() * 0.24;
    g.part({ a: i === 1 ? PALETTE.grassLight : PALETTE.grass, b: PALETTE.grass, appear: still, flex: 0.9 }, V(0, 0, 0));
    g.blade(V(0, 0, 0), V(Math.sin(angle) * 0.3, 1, Math.cos(angle) * 0.3), height, 0.075, height * 0.35, 0, 2);
  }
  return g;
}

/** What each crop leaves standing in its square once it is cut. */
export function stubble(kind: "wheat" | "sunflowers" | "pumpkins", seed: number) {
  const random = seededRandom(seed), g = new PlantGeometry();
  g.skyward = 0.5;
  if (kind === "wheat") {
    // Two drill lines of short straw, so a cut lane reads as combed.
    g.part({ a: PALETTE.straw, b: PALETTE.straw, appear: still, flex: 0.2 }, V(0, 0, 0));
    for (const z of [-0.125, 0.125])
      for (let i = 0; i < 3; i++) {
        const x = -0.17 + i * 0.17 + (random() - 0.5) * 0.05;
        g.blade(V(x, 0, z), V((random() - 0.5) * 0.3, 1, (random() - 0.5) * 0.3), 0.07 + random() * 0.05, 0.035, 0, 0.6, 1, 0.9 + random() * 0.2);
      }
  } else if (kind === "sunflowers") {
    // One cut stalk, knee high.
    g.part({ a: "#a9a36c", b: "#a9a36c", appear: still, flex: 0.1 }, V(0, 0, 0));
    g.tube([V(0, 0, 0), V(0.01, 0.16 + random() * 0.08, 0)], 0.03, 0.026, 5);
  } else {
    // Vines die back flat against the soil: one faded leaf, most of the story is in the ground.
    g.part({ a: "#aaa672", b: "#aaa672", appear: still, flex: 0 }, V(0, 0, 0));
    const angle = random() * TAU, reach = 0.06 + random() * 0.1;
    g.blade(V(Math.sin(angle) * reach, 0.012, Math.cos(angle) * reach), V(Math.cos(angle), 0.02, -Math.sin(angle)), 0.17, 0.14, 0, 0.5, 1, 0.94 + random() * 0.1);
  }
  return g;
}

/**
 * What a lane leaves behind every three metres. These stand in the field for
 * as long as the stubble does, so the field itself keeps the tally.
 */
export function stook() {
  const g = new PlantGeometry(), random = seededRandom(7);
  const body: PartStyle = { a: PALETTE.wheatStraw, b: PALETTE.wheatStraw, appear: still, flex: 0 };
  const ear: PartStyle = { a: PALETTE.wheatEar, b: PALETTE.wheatEar, appear: still, flex: 0, glow: 1 };
  const band: PartStyle = { a: PALETTE.wickerDark, b: PALETTE.wickerDark, appear: still, flex: 0 };
  // Six sheaves leaning into a ridge along x, the way a stook is built to shed rain.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, along = (Math.floor(i / 2) - 1) * 0.3 + (random() - 0.5) * 0.05;
    const foot = V(along, 0, side * 0.3), top = V(along + (random() - 0.5) * 0.06, 0.86, side * 0.05);
    const axis = top.clone().sub(foot);
    const waist = foot.clone().addScaledVector(axis, 0.56);
    g.part(body, V(0, 0, 0));
    g.tube([foot, waist], 0.125, 0.06, 6).tube([waist, top], 0.06, 0.12, 6);
    g.part(band, V(0, 0, 0));
    g.tube([waist.clone().addScaledVector(axis, -0.03), waist.clone().addScaledVector(axis, 0.03)], 0.068, 0.068, 6);
    g.part(ear, V(0, 0, 0));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + random(), spread = V(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55 - side * 0.25).normalize();
      g.ellipsoid(top.clone().addScaledVector(spread, 0.1), spread, 0.22, 0.05, 5, 3, 1.08, 0.9);
    }
  }
  return g;
}

/** A milk churn of cut sunflowers: faces every way, so some always look at you. */
export function churn() {
  const g = new PlantGeometry(), random = seededRandom(11);
  const flat = (colour: string, glow = 0): PartStyle => ({ a: colour, b: colour, appear: still, flex: 0, glow });
  const sides = 10;
  const ring = (radius: number, y: number, i: number) => V(Math.cos((i / sides) * TAU) * radius, y, Math.sin((i / sides) * TAU) * radius);
  // A cream enamel churn with a rolled lip, kin to the tractor's bodywork.
  for (let i = 0; i < sides; i++) {
    g.part(flat("#efe4c6"), V(0, 0, 0));
    g.quad(ring(0.19, 0, i), ring(0.19, 0, i + 1), ring(0.23, 0.3, i + 1), ring(0.23, 0.3, i), i % 2 ? 0.96 : 1.03);
    g.quad(ring(0.23, 0.3, i), ring(0.23, 0.3, i + 1), ring(0.17, 0.43, i + 1), ring(0.17, 0.43, i), 0.92);
    g.part(flat("#7c9c82"), V(0, 0, 0));
    g.quad(ring(0.17, 0.43, i), ring(0.17, 0.43, i + 1), ring(0.2, 0.47, i + 1), ring(0.2, 0.47, i));
  }
  const stems = 8;
  for (let k = 0; k < stems; k++) {
    const middle = k === 0;
    const angle = (k / (stems - 1)) * TAU + random() * 0.4;
    const lean = middle ? 0.05 : 0.42 + random() * 0.2, height = middle ? 1.12 : 0.82 + random() * 0.2;
    const out = V(Math.cos(angle), 0, Math.sin(angle));
    const top = V(out.x * Math.sin(lean) * height, 0.42 + Math.cos(lean) * (height - 0.42), out.z * Math.sin(lean) * height);
    g.part(flat(PALETTE.sunStem), V(0, 0, 0));
    g.tube([V(out.x * 0.05, 0.4, out.z * 0.05), top], 0.022, 0.018, 4);
    const facing = (middle ? V(0.2, 1, 0.3) : out.clone().multiplyScalar(0.85).add(V(0, 0.62, 0))).normalize();
    const across = new THREE.Vector3().crossVectors(facing, V(0, 1, 0.01)).normalize(), up = new THREE.Vector3().crossVectors(facing, across);
    const radius = 0.19 + random() * 0.04;
    const on = (r: number, a: number, lift = 0) => top.clone().addScaledVector(across, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).addScaledVector(facing, lift);
    g.part(flat(PALETTE.sunPetal, 1), V(0, 0, 0));
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + k, half = (TAU / 11) * 0.5;
      g.tri(on(radius * 0.4, a - half, 0.02), on(radius * 0.4, a + half, 0.02), on(radius, a, 0.035), 0.95 + (i % 2) * 0.1);
    }
    g.part(flat(PALETTE.sunLeaf), V(0, 0, 0));
    for (let i = 0; i < 6; i++) g.tri(top.clone().addScaledVector(facing, -0.05), on(radius * 0.5, ((i + 1) / 6) * TAU), on(radius * 0.5, (i / 6) * TAU));
    g.part(flat(PALETTE.sunDisc), V(0, 0, 0));
    for (let i = 0; i < 8; i++)
      g.smooth(on(0, 0, 0.06), facing, on(radius * 0.46, (i / 8) * TAU, 0.03), facing, on(radius * 0.46, ((i + 1) / 8) * TAU, 0.03), facing, [1.5, 0.95, 0.95]);
  }
  return g;
}

/** A small heap of pumpkins in mixed sizes. */
export function pumpkinHeap() {
  const g = new PlantGeometry();
  const fruit = (tone: string): PartStyle => ({ a: tone, b: tone, appear: still, flex: 0 });
  const place: [number, number, number, number, string][] = [
    [-0.24, 0.12, 0.3, 0, PALETTE.fruit],
    [0.27, 0.16, 0.26, 0, "#ef8a26"],
    [0.03, -0.27, 0.27, 0, "#e06a16"],
    [0.02, 0.02, 0.22, 0.34, "#f0922c"],
    [0.5, -0.2, 0.15, 0, "#f3a43c"],
  ];
  place.forEach(([x, z, radius, y, tone], index) => {
    g.part(fruit(tone), V(0, 0, 0));
    addPumpkin(g, V(x, y, z), radius, 0.74, index * 0.9, 7);
    g.part(fruit(PALETTE.fruitStem), V(0, 0, 0));
    const top = V(x, y + radius * 1.4, z);
    g.tube([top, top.clone().add(V(0.02, radius * 0.3, 0.02))], radius * 0.15, radius * 0.1, 5);
  });
  return g;
}

export type CropName = "wheat" | "sunflowers" | "pumpkins";

/** Which way every sunflower faces: south-east, toward the farm view in both orientations. */
export const SUNFLOWER_FACING = (50 * Math.PI) / 180;
