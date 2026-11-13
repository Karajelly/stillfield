import * as THREE from "three";

/**
 * One material draws every proposed crop. A plant is a single instanced mesh;
 * its whole life (growing, ripening, leaning in the wind, falling to the cutter)
 * happens in the vertex shader from four numbers per plant. A growing field
 * costs the CPU one number per plant, written a few times a second.
 *
 * Each vertex knows which part it belongs to: the colour it has while growing and
 * when ripe, the point it grows out of, and the stretch of the plant's life over
 * which it appears.
 */
export interface PartStyle {
  /** Colour while growing. */
  a: THREE.ColorRepresentation;
  /** Colour once ripe. */
  b: THREE.ColorRepresentation;
  /** Progress (0 sown, 1 ripe) over which the part grows out of its pivot. */
  appear: [number, number];
  /** Progress over which the colour turns from `a` to `b`. */
  ripen?: [number, number];
  /** The growth window of whatever the part sits on, so it rides up with it. */
  parent?: [number, number];
  /** How much the part follows the wind, 0 to 1. */
  flex?: number;
  /** How far the part droops away from the plant's centre once ripe, in metres per metre. */
  nod?: number;
  /** How much low sun shows through it. */
  glow?: number;
}

const tmpA = new THREE.Vector3(),
  tmpB = new THREE.Vector3(),
  tmpN = new THREE.Vector3(),
  colour = new THREE.Color();

/** Collects triangles with the per-part attributes the plant shader reads. */
export class PlantGeometry {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly colA: number[] = [];
  private readonly colB: number[] = [];
  private readonly pivot: number[] = [];
  private readonly growth: number[] = [];
  private readonly parent: number[] = [];
  private readonly flex: number[] = [];
  private style: PartStyle = { a: "#fff", b: "#fff", appear: [0, 1] };
  private origin = new THREE.Vector3();
  /** Foliage catches the sky evenly when its normals lean upward a little. */
  skyward = 0;

  /** Everything added from here on belongs to this part, growing out of `pivot`. */
  part(style: PartStyle, pivot: THREE.Vector3) {
    this.style = style;
    this.origin = pivot.clone();
    return this;
  }

  private push(p: THREE.Vector3, n: THREE.Vector3, shade = 1) {
    const s = this.style;
    this.position.push(p.x, p.y, p.z);
    tmpN.copy(n);
    if (this.skyward) tmpN.lerp(THREE.Object3D.DEFAULT_UP, this.skyward).normalize();
    this.normal.push(tmpN.x, tmpN.y, tmpN.z);
    colour.set(s.a).multiplyScalar(shade);
    this.colA.push(colour.r, colour.g, colour.b);
    colour.set(s.b).multiplyScalar(shade);
    this.colB.push(colour.r, colour.g, colour.b);
    this.pivot.push(this.origin.x, this.origin.y, this.origin.z);
    const ripen = s.ripen ?? [0.8, 1];
    this.growth.push(s.appear[0], s.appear[1], ripen[0], ripen[1]);
    const parent = s.parent ?? [0, 0];
    this.parent.push(parent[0], parent[1]);
    this.flex.push(s.flex ?? 1, s.nod ?? 0, s.glow ?? 0);
  }

  /** A flat triangle. `shade` darkens or lightens it a touch for dapple. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, shade = 1) {
    tmpN.copy(tmpA.subVectors(b, a).cross(tmpB.subVectors(c, a))).normalize();
    const n = tmpN.clone();
    // Leaves are drawn double-sided; keep their shared normal on the sunny side.
    if (this.skyward && n.y < 0) n.negate();
    this.push(a, n, shade);
    this.push(b, n, shade);
    this.push(c, n, shade);
    return this;
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, shade = 1) {
    return this.tri(a, b, c, shade).tri(a, c, d, shade);
  }

  /** A triangle with its own smooth normals, for rounded toy forms. */
  smooth(
    a: THREE.Vector3, na: THREE.Vector3,
    b: THREE.Vector3, nb: THREE.Vector3,
    c: THREE.Vector3, nc: THREE.Vector3,
    shades: [number, number, number] = [1, 1, 1],
  ) {
    this.push(a, na, shades[0]);
    this.push(b, nb, shades[1]);
    this.push(c, nc, shades[2]);
    return this;
  }

  /**
   * A tapering leaf or stalk: a strip from `base` along `direction`, arching
   * over by `droop` metres at its tip.
   */
  blade(
    base: THREE.Vector3, direction: THREE.Vector3, length: number, width: number,
    droop = 0, tipWidth = 0.25, segments = 2, shade = 1,
  ) {
    const dir = direction.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, THREE.Object3D.DEFAULT_UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const out = new THREE.Vector3(dir.x, 0, dir.z);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    out.normalize();
    const at = (t: number) =>
      base.clone().addScaledVector(dir, length * t)
        .addScaledVector(out, droop * t * t * 0.55)
        .add(new THREE.Vector3(0, -droop * t * t, 0));
    const half = (t: number) => (width / 2) * (1 + (tipWidth - 1) * t) * (t < 0.12 ? 0.6 + t * 3.3 : 1);
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      const p0 = at(t0), p1 = at(t1);
      const l0 = p0.clone().addScaledVector(side, -half(t0)), r0 = p0.clone().addScaledVector(side, half(t0));
      const l1 = p1.clone().addScaledVector(side, -half(t1)), r1 = p1.clone().addScaledVector(side, half(t1));
      if (i === segments - 1 && tipWidth === 0) this.tri(l0, r0, p1, shade);
      else this.quad(l0, r0, r1, l1, shade);
    }
    return this;
  }

  /** A rounded solid stretched along `axis`: ears, buds, fruit. */
  ellipsoid(
    centre: THREE.Vector3, axis: THREE.Vector3, length: number, radius: number,
    radial = 5, rings = 3, shadeTop = 1, shadeBottom = 1,
  ) {
    const up = axis.clone().normalize();
    const u = new THREE.Vector3().crossVectors(up, Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : THREE.Object3D.DEFAULT_UP).normalize();
    const v = new THREE.Vector3().crossVectors(up, u);
    const point = (ring: number, seg: number) => {
      const lat = (ring / rings) * Math.PI, lon = (seg / radial) * Math.PI * 2;
      const n = new THREE.Vector3()
        .addScaledVector(u, Math.sin(lat) * Math.cos(lon))
        .addScaledVector(v, Math.sin(lat) * Math.sin(lon))
        .addScaledVector(up, Math.cos(lat));
      const p = centre.clone()
        .addScaledVector(u, Math.sin(lat) * Math.cos(lon) * radius)
        .addScaledVector(v, Math.sin(lat) * Math.sin(lon) * radius)
        .addScaledVector(up, Math.cos(lat) * (length / 2));
      const shade = shadeBottom + (shadeTop - shadeBottom) * (0.5 + Math.cos(lat) / 2);
      return { p, n: n.normalize(), shade };
    };
    for (let ring = 0; ring < rings; ring++)
      for (let seg = 0; seg < radial; seg++) {
        const a = point(ring, seg), b = point(ring + 1, seg), c = point(ring + 1, seg + 1), d = point(ring, seg + 1);
        if (ring > 0) this.smooth(a.p, a.n, b.p, b.n, d.p, d.n, [a.shade, b.shade, d.shade]);
        if (ring < rings - 1) this.smooth(d.p, d.n, b.p, b.n, c.p, c.n, [d.shade, b.shade, c.shade]);
      }
    return this;
  }

  /** A stem through `points`, tapering from `r0` to `r1`. */
  tube(points: THREE.Vector3[], r0: number, r1: number, sides = 5) {
    const frames = points.map((p, i) => {
      const tangent = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const u = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 0, 1));
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
      u.normalize();
      const v = new THREE.Vector3().crossVectors(tangent, u).normalize();
      return { p, u, v, r: r0 + ((r1 - r0) * i) / (points.length - 1) };
    });
    const ring = (f: (typeof frames)[number], seg: number) => {
      const a = (seg / sides) * Math.PI * 2;
      const n = new THREE.Vector3().addScaledVector(f.u, Math.cos(a)).addScaledVector(f.v, Math.sin(a));
      return { p: f.p.clone().addScaledVector(n, f.r), n };
    };
    for (let i = 0; i < frames.length - 1; i++)
      for (let seg = 0; seg < sides; seg++) {
        const a = ring(frames[i], seg), b = ring(frames[i], seg + 1), c = ring(frames[i + 1], seg + 1), d = ring(frames[i + 1], seg);
        this.smooth(a.p, a.n, b.p, b.n, c.p, c.n).smooth(a.p, a.n, c.p, c.n, d.p, d.n);
      }
    return this;
  }

  get triangles() {
    return this.position.length / 9;
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    const set = (name: string, data: number[], size: number) =>
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
    set("position", this.position, 3);
    set("normal", this.normal, 3);
    set("aColA", this.colA, 3);
    set("aColB", this.colB, 3);
    set("aPivot", this.pivot, 3);
    set("aGrowth", this.growth, 4);
    set("aParent", this.parent, 2);
    set("aFlex", this.flex, 3);
    // Plants are never culled one by one; the field decides what is drawn.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return geometry;
  }
}

/** Shared by every plant mesh so one clock and one gust move the whole field. */
export const plantUniforms = {
  uTime: { value: 0 },
  /** Radians of idle sway. Zero under reduced motion. */
  uBreeze: { value: 0.035 },
  /** World x of the gust front, or far to the west when the air is still. */
  uGustFront: { value: -1e6 },
  uGustTrail: { value: 6.5 },
  /** Strength of the backlit glow at low sun. */
  uGlow: { value: 0.55 },
};

/**
 * Per plant: seed (0 to 1), growth (0 to 1), cut (0 standing, 1 laid down), and a
 * fourth number that is the compass direction a cut plant falls in, or, while it
 * stands, a pulse from 1 to 0 as it comes ripe.
 */
export const INSTANCE_ATTRIBUTE = "aPlant";

/**
 * `shade` is how dark a plant is at its foot, standing in its neighbours' shade:
 * deep for a tall crop, barely there for meadow grass and stubble.
 */
export function createPlantMaterial(shade = 0.66) {
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, side: THREE.DoubleSide });
  const uShade = { value: shade };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, plantUniforms, { uShade });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute vec3 aColA;
        attribute vec3 aColB;
        attribute vec3 aPivot;
        attribute vec4 aGrowth;
        attribute vec2 aParent;
        attribute vec3 aFlex;
        attribute vec4 ${INSTANCE_ATTRIBUTE};
        uniform float uTime;
        uniform float uBreeze;
        uniform float uGustFront;
        uniform float uGustTrail;
        uniform float uShade;
        varying vec3 vPlantTint;
        varying float vPlantGlow;
        float sfGrow;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        // A little spread, so neighbours never change on the same frame.
        sfGrow = clamp(${INSTANCE_ATTRIBUTE}.y * (1.0 + (${INSTANCE_ATTRIBUTE}.x - 0.5) * 0.08), 0.0, 1.0);
        float sfAppear = smoothstep(aGrowth.x, aGrowth.y, sfGrow);
        float sfCarried = aParent.y > aParent.x ? smoothstep(aParent.x, aParent.y, sfGrow) : 1.0;
        float sfRipe = smoothstep(aGrowth.z, aGrowth.w, sfGrow);
        vec3 sfPivot = aPivot * sfCarried;
        vec3 sfArm = (position - aPivot) * sfAppear;
        // Ripe heads grow heavy: they tip outward and down from the plant's centre.
        vec2 sfOut = length(aPivot.xz) > 0.001 ? normalize(aPivot.xz) : vec2(0.0);
        float sfReach = length(sfArm);
        sfArm.xz += sfOut * sfReach * aFlex.y * sfRipe * 0.55;
        sfArm.y -= sfReach * aFlex.y * sfRipe * 0.45;
        vec3 transformed = sfPivot + sfArm;
        vPlantTint = mix(aColA, aColB, sfRipe);
        vPlantGlow = aFlex.z;
        // The moment a plant comes ripe it lifts and glows for a breath.
        float sfPulse = ${INSTANCE_ATTRIBUTE}.z > 0.0 ? 0.0 : ${INSTANCE_ATTRIBUTE}.w;
        vPlantTint *= 1.0 + sfPulse * (0.25 + 0.3 * aFlex.z);
        transformed.y *= 1.0 + sfPulse * 0.07;`,
      )
      .replace(
        "#include <project_vertex>",
        /* glsl */ `
        vec4 sfWorld = vec4(transformed, 1.0);
        vec3 sfFoot = vec3(0.0);
        #ifdef USE_INSTANCING
          sfWorld = instanceMatrix * sfWorld;
          sfFoot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        sfWorld = modelMatrix * sfWorld;
        sfFoot = (modelMatrix * vec4(sfFoot, 1.0)).xyz;
        vec3 sfRel = sfWorld.xyz - sfFoot;
        float sfHeight = max(0.0, sfRel.y);
        // Plants stand in each other's shade near the ground.
        vPlantTint *= mix(uShade, 1.0, smoothstep(0.0, 0.42, sfHeight));
        // The breeze never quite stops; a gust leans the field as its front passes.
        float sfSeed = ${INSTANCE_ATTRIBUTE}.x * 6.2832;
        float sfLean = uBreeze * (sin(uTime * 1.3 + sfSeed + sfFoot.x * 0.42) * 0.62 + sin(uTime * 2.1 + sfSeed * 1.7 + sfFoot.z * 0.51) * 0.38);
        float sfU = (uGustFront - sfFoot.x) / uGustTrail;
        if (sfU > 0.0 && sfU < 1.0) {
          float sfRise = min(1.0, sfU / 0.22), sfFall = min(1.0, (1.0 - sfU) / 0.78);
          sfLean += sfRise * sfRise * (3.0 - 2.0 * sfRise) * sfFall * sfFall * (0.42 + sin(uTime * 7.0 + sfSeed * 3.0) * 0.07);
        }
        // Tops travel further than stems, so a plant bows instead of tipping.
        sfLean += (${INSTANCE_ATTRIBUTE}.z > 0.0 ? 0.0 : ${INSTANCE_ATTRIBUTE}.w) * sin(uTime * 9.0 + sfSeed) * 0.06;
        float sfBend = sfLean * aFlex.x * (0.35 + 0.65 * smoothstep(0.0, 1.1, sfHeight));
        float sfC = cos(sfBend), sfS = sin(sfBend);
        sfRel = vec3(sfRel.x * sfC + sfRel.y * sfS, sfRel.y * sfC - sfRel.x * sfS, sfRel.z);
        // Cut plants lie down the way the cutter is travelling, then settle into the stubble.
        float sfCut = ${INSTANCE_ATTRIBUTE}.z;
        if (sfCut > 0.0) {
          // Tall plants topple; a direction past a full turn means a low one that only wilts.
          float sfTopple = ${INSTANCE_ATTRIBUTE}.w > 50.0 ? 0.0 : 1.0;
          float sfTurn = smoothstep(0.0, 0.7, sfCut) * 1.42 * sfTopple;
          vec2 sfDir = vec2(sin(${INSTANCE_ATTRIBUTE}.w), cos(${INSTANCE_ATTRIBUTE}.w));
          float sfAlong = dot(sfRel.xz, sfDir);
          vec2 sfAcross = sfRel.xz - sfDir * sfAlong;
          float sfC2 = cos(sfTurn), sfS2 = sin(sfTurn);
          float sfForward = sfAlong * sfC2 + sfRel.y * sfS2;
          sfRel.y = sfRel.y * sfC2 - sfAlong * sfS2;
          sfRel.xz = sfAcross + sfDir * sfForward;
          sfRel *= 1.0 - smoothstep(mix(0.0, 0.62, sfTopple), 1.0, sfCut);
        }
        sfWorld.xyz = sfFoot + sfRel;
        vec4 mvPosition = viewMatrix * sfWorld;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uGlow;
        varying vec3 vPlantTint;
        varying float vPlantGlow;`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        diffuseColor.rgb *= vPlantTint;`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        /* glsl */ `#include <normal_fragment_begin>
        // A leaf is lit the same from either side: undo the flip three.js gives back faces.
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          // Thin petals and ears let the sun through from behind.
          float sfBack = max(0.0, dot(-normal, directionalLights[0].direction));
          reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * sfBack * vPlantGlow * uGlow * RECIPROCAL_PI;
        #endif`,
      );
  };
  // Every plant mesh shares this program.
  material.customProgramCacheKey = () => "stillfield-plant";
  return material;
}

/** An instanced plant mesh whose live count tracks what is actually growing. */
export function createPlantMesh(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // The geometry carries its mesh's plants, so each mesh is given a geometry of its own.
  const plant = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  plant.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(INSTANCE_ATTRIBUTE, plant);
  return { mesh, plant };
}
