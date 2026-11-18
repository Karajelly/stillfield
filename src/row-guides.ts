import * as THREE from "three";
import { fieldOf, LANE_WIDTH, rowEnd, rowRect } from "./tidy-rows";
import type { Axis, Row } from "./tidy-rows";

type GuideStyle = "ready" | "working" | "queued" | "mark";

// Thin ground markings need a minimum width in screen pixels at farm-view distance.
// A darker outside edge holds up on grass, and the light inside edge reads on soil.
const vertexShader = `
  uniform vec2 size;
  varying vec2 ground;
  void main() {
    ground = uv * size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;
const fragmentShader = `
  varying vec2 ground;
  uniform vec2 size;
  uniform vec2 across;
  uniform float laneWidth;
  uniform float fillOpacity;
  uniform float edgeOpacity;
  uniform vec3 fillColor;
  uniform vec3 ink;
  uniform vec3 chalk;

  void main() {
    vec2 edge = min(ground, size - ground);
    vec2 pixel = max(fwidth(ground), vec2(.001));
    // Work in metres close up and pixels in the overview. Leave open ground
    // in the middle even when the final bit of a pass is just one cell long.
    vec2 rim = min(max(vec2(.105), pixel * 2.8), size * .25);
    vec2 ratio = edge / rim;
    float dist = min(ratio.x, ratio.y);
    float aa = clamp(fwidth(dist), .035, .6);
    float outer = 1. - smoothstep(1. - aa, 1. + aa, dist);
    float light = smoothstep(.4 - aa, .4 + aa, dist);
    vec3 edgeColor = mix(ink, chalk, light);

    float lane = dot(ground, across);
    float seam = abs(fract(lane / laneWidth + .5) - .5) * laneWidth;
    float seamWidth = max(fwidth(lane), .025);
    float inside = min(lane, dot(size, across) - lane);
    float stripe = (1. - smoothstep(0., seamWidth, seam)) * step(laneWidth * .5, inside);
    vec4 field = mix(vec4(fillColor, fillOpacity), vec4(chalk, .7), stripe * .8);
    gl_FragColor = mix(field, vec4(edgeColor, edgeOpacity), outer);
    #include <colorspace_fragment>
  }
`;

const opacity = {
  ready: { fill: .12, edge: .78 },
  working: { fill: .20, edge: .95 },
  queued: { fill: .10, edge: .53 },
  mark: { fill: .26, edge: 1 },
};

/** A chalk line between two field flags. The flags stay legible above grass
 * as the hood starts to hide the ground line. Local Z is the travel axis. */
function makeEndMarker() {
  const group = new THREE.Group();
  group.name = "manual-row-end";
  const ink = new THREE.MeshBasicMaterial({ color: "#67543c", toneMapped: false });
  const chalk = new THREE.MeshBasicMaterial({ color: "#fff0c1", toneMapped: false });
  const ochre = new THREE.MeshBasicMaterial({ color: "#da9a45", side: THREE.DoubleSide, toneMapped: false });

  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH, 0.14), ink);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.15;
  group.add(stripe);
  const inset = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH, 0.075), chalk);
  inset.position.z = 0.003;
  stripe.add(inset);

  const pole = new THREE.CylinderGeometry(0.025, 0.035, 1.05, 6);
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute("position", new THREE.Float32BufferAttribute(
    [0, 1.05, 0, 0, 0.82, 0, 0.28, 0.94, -0.035], 3,
  ));
  for (const side of [-1, 1]) {
    const x = side * LANE_WIDTH / 2;
    const post = new THREE.Mesh(pole, ink);
    post.position.set(x, 0.525, 0);
    group.add(post);
    const flag = new THREE.Mesh(pennant, ochre);
    flag.position.x = x;
    flag.scale.x = -side;
    group.add(flag);
  }
  group.visible = false;
  return group;
}

/** World-space footprints shared by the map, the chase camera and the driver's seat. */
export class RowGuides {
  readonly group = new THREE.Group();
  private plane = new THREE.PlaneGeometry(1, 1);
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private count = 0;
  private endMarker?: THREE.Group;
  private plotAxis: Axis | null = null;
  private left = Infinity;
  private right = -Infinity;
  private near = Infinity;
  private far = -Infinity;

  begin() {
    this.count = 0;
    if (this.endMarker) this.endMarker.visible = false;
    this.plotAxis = null;
    this.left = this.near = Infinity;
    this.right = this.far = -Infinity;
  }
  /** Mark the outside edge of the final cell on the returning pass. */
  showEnd(row: Row) {
    if (!this.endMarker) {
      this.endMarker = makeEndMarker();
      this.group.add(this.endMarker);
    }
    const end = rowEnd(row);
    const edge = row.dir * fieldOf(row).cell / 2;
    const alongX = row.axis === "x";
    this.endMarker.position.set(end.x + (alongX ? edge : 0), 0, end.z + (alongX ? 0 : edge));
    this.endMarker.rotation.y = alongX ? Math.PI / 2 : 0;
    this.endMarker.visible = true;
  }
  show(row: Row, style: GuideStyle, from = row.from) {
    if ((row.to - from) * row.dir < 0) return;
    const rect = rowRect(row, from);
    if (style === "mark") {
      // The two corners describe one rectangular plot with parallel passes inside.
      this.plotAxis = row.axis;
      this.left = Math.min(this.left, rect.x - rect.width / 2);
      this.right = Math.max(this.right, rect.x + rect.width / 2);
      this.near = Math.min(this.near, rect.z - rect.depth / 2);
      this.far = Math.max(this.far, rect.z + rect.depth / 2);
    } else this.draw(rect.x, rect.z, rect.width, rect.depth, style);
  }
  private draw(x: number, z: number, width: number, depth: number, style: GuideStyle, axis?: Axis) {
    let mesh = this.pool[this.count++];
    if (!mesh) {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
        uniforms: {
          size: { value: new THREE.Vector2() }, across: { value: new THREE.Vector2() },
          laneWidth: { value: LANE_WIDTH }, fillOpacity: { value: 0 }, edgeOpacity: { value: 0 },
          fillColor: { value: new THREE.Color("#dba953") },
          ink: { value: new THREE.Color("#574735") }, chalk: { value: new THREE.Color("#fff0c1") },
        },
        vertexShader, fragmentShader,
      });
      mesh = new THREE.Mesh(this.plane, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.pool.push(mesh);
    }
    mesh.visible = true;
    mesh.position.set(x, 0.14, z);
    mesh.scale.set(width, depth, 1);
    const u = mesh.material.uniforms;
    u.size.value.set(width, depth);
    u.across.value.set(axis === "z" ? 1 : 0, axis === "x" ? 1 : 0);
    u.fillOpacity.value = opacity[style].fill;
    u.edgeOpacity.value = opacity[style].edge;
  }
  end() {
    if (this.plotAxis)
      this.draw((this.left + this.right) / 2, (this.near + this.far) / 2,
        this.right - this.left, this.far - this.near, "mark", this.plotAxis);
    for (let i = this.count; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
