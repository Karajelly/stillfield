import * as THREE from "three";
import "./style.css";
import { createWorld } from "./world";
import { createField } from "./field";
import { CROPS, CROP_NAMES, Ground, HOME_SITE } from "./farming";
import type { Crop, FarmSnapshot, FarmingEvents } from "./farming";
import { createTractor } from "./tractor";
import { FarmAudio } from "./audio";
import { clamp, clampToWorld, FAR_FIELD, FIELD } from "./simulation";
import type { FieldBounds } from "./simulation";
import { TractorNavigation } from "./tractor-navigation";
import type { ChooseOptions } from "./tractor-navigation";
import { rowRect } from "./tidy-rows";
import type { Point, Tool, TractorState } from "./simulation";
import { icon, brandMark } from "./icons";
import { overviewFraming } from "./overview";
import { DriveKeyboard, GridKeyboard, isDriveKey } from "./keyboard-navigation";
import { drivableTarget, FOLLOW_ZOOM, SteeringGesture, TractorFollowCamera } from "./follow-camera";
import type { CameraMode } from "./follow-camera";
import {
  DAY_COPY,
  DAY_HOLDS,
  daylightAt,
  holdSeconds,
  wrapDay,
} from "./daylight";
import type { DayHold, DayPhase } from "./daylight";
import { createDusk } from "./dusk";
import {
  Wind,
  beatAccent,
  sliceNotes,
  windFrequency,
} from "./wind";
import {
  PHOTO,
  POSTCARD_SIZE,
  composePostcard,
  growingLine,
  photograph,
  postcardBlob,
  postcardCamera,
} from "./postcard";
import type { PostcardView } from "./postcard";
import {
  FAR_SITE,
  LaneRide,
  laneDestination,
  SITE_NAMES,
  siteForView,
  viewBlend,
} from "./farm-map";

interface Save {
  version: 1 | 2 | 3;
  grid?: number[];
  farm?: FarmSnapshot;
  /** Fields beyond the original one, by field ID. Older saves simply omit it. */
  fields?: FarmSnapshot[];
  crop?: Crop;
  tractor: TractorState;
  tool: Tool;
  guide: boolean;
  pace: number;
  /** Kept for saves from before the day began to move. */
  golden: boolean;
  light?: DayHold;
  day?: number;
  intro: boolean;
  volume: number;
  cameraMode?: CameraMode;
  tidy?: boolean;
}
let saved: Partial<Save> = {};
let legacySaveBackup: string | undefined;
try {
  const raw = localStorage.getItem("stillfield-v1");
  const data = JSON.parse(raw || "null");
  if (data?.version === 1 || data?.version === 2 || data?.version === 3) {
    saved = { ...data, tool: data.tool === "till" || data.tool === "cultivate" ? "plow" : data.tool };
    if (data.version < 3 && raw) legacySaveBackup = raw;
  }
} catch {
  /* A private meadow works even without browser storage. */
}
const tools: Tool[] = ["plow", "sow", "harvest", "mow", "wander"];
const LIGHT_NAMES: Record<DayHold, string> = {
  flow: "Drifting",
  morning: "Morning",
  golden: "Golden",
  dusk: "Dusk",
  night: "Night",
};
let selectedTool: Tool = tools.includes(saved.tool!)
  ? saved.tool!
  : saved.tool === "restore"
    ? "wander"
    : "harvest";
let selectedCrop: Crop = CROPS.includes(saved.crop!) ? saved.crop! : "wheat";
let cameraMode: CameraMode = saved.cameraMode === "tractor" ? "tractor" : "overview";
let windowActive = document.hasFocus();
let pace =
    typeof saved.pace === "number" ? clamp(saved.pace, 0.55, 1.25) : 0.85;
// The day drifts unless the player keeps a favourite light. An older save with
// golden light switched on keeps its golden hour.
let light: DayHold = DAY_HOLDS.includes(saved.light!)
  ? saved.light!
  : saved.golden
    ? "golden"
    : "flow";
let dayTime =
  light === "flow"
    ? wrapDay(typeof saved.day === "number" ? saved.day : 0)
    : holdSeconds(light);
let paused = false,
  soundEnabled = false,
  modalOpen = false,
  introDismissed = false,
  storageAvailable = true;
const defaultTractor: TractorState = {
  x: -4,
  z: 4.8,
  heading: -Math.PI / 2,
  speed: 0,
};
let tractorState: TractorState =
  saved.tractor &&
  [saved.tractor.x, saved.tractor.z, saved.tractor.heading].every(
    Number.isFinite,
  )
    ? { ...saved.tractor, speed: 0 }
    : defaultTractor;
Object.assign(tractorState, clampToWorld(tractorState));
let target: Point | null = null;
// Taps ask for whole rows on the field's lanes once this is switched on.
// Tidy rows are on unless this meadow chose freehand.
let tidy = saved.tidy !== false;
let navigation = new TractorNavigation();
navigation.tidy = tidy;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="farm-app welcoming">
    <div id="scene" aria-label="Your pastoral farm. Tap or drag the meadow to drive. WASD or arrow keys follow the field rows, turning in place; in tractor view, W rolls, A and D steer, and S settles." role="application" tabindex="0"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar menu-panel" id="top-controls">
      <a class="brand" href="#" aria-label="Stillfield home">stillfield</a>
      <button class="place-pill" id="place" aria-label="About Stillfield"><span class="live-dot"></span>Your farm ${icon("down")}</button>
      <div class="top-actions">
        <div class="weather" id="weather"></div>
        <div class="action-group"><button class="round-button" id="postcard" aria-label="Make a postcard of your meadow" title="A postcard">${icon("camera")}</button><button class="round-button" id="sound" aria-label="Turn on nature sounds" aria-pressed="false" title="Nature sounds">${icon("muted")}</button><button class="round-button" id="pause" aria-label="Pause" aria-pressed="false" title="Pause (space)">${icon("pause")}</button><button class="round-button" id="settings" aria-label="Open settings" title="Make yourself at home">${icon("settings")}</button></div>
      </div>
    </header>
    <section class="welcome" id="welcome" aria-labelledby="welcome-title">
      <div class="welcome-content">
        <div class="eyebrow"><span></span> THERE’S NO HURRY HERE <span></span></div>
        <h1 id="welcome-title">A good day<br>to take it <em>slow.</em></h1>
        <p>A little fresh air. A few tidy rows.<br>Nothing you need to finish.</p>
        <button class="welcome-button" id="begin">Let’s wander ${icon("arrow")}</button>
      </div>
    </section>
    <div class="world-label" id="windmill-label"><span></span>Windmill hill</div>
    <div class="world-label" id="barn-label"><span></span>The barn</div>
    <div class="world-label" id="pond-label"><span></span>The pond</div>
    <div class="world-label" id="field-label"><span></span>The field</div>
    <div class="world-label" id="far-field-label"><span></span>${SITE_NAMES[FAR_SITE.id]}</div>
    <div id="destination" aria-hidden="true"><span></span></div>
    <section class="bottom-center menu-panel" id="tool-controls" aria-label="Tractor tools">
      <div class="crop-choices" id="crop-choice" role="group" aria-label="Crop to sow" hidden>${CROPS.map((crop) => `<button class="crop-button ${crop} ${crop === selectedCrop ? "selected" : ""}" data-crop="${crop}" aria-label="Sow ${CROP_NAMES[crop]}" aria-pressed="${crop === selectedCrop}">${icon(crop)}<span>${CROP_NAMES[crop]}</span></button>`).join("")}</div>
      <nav class="tool-dock" aria-label="Choose your tool">${[
        ["plow", "Plow", "Prepare soil, clearing any crops"],
        ["sow", "Sow", "Plant the chosen crop in soil"],
        ["harvest", "Harvest", "Gather mature crops"],
        ["mow", "Mow", "Cut anything back to flat green grass"],
        ["wander", "Wander", "Just enjoy the ride"],
      ]
        .map(
          ([id, name, desc], i) =>
            `<button class="tool-button ${id === selectedTool ? "selected" : ""}" data-tool="${id}" aria-pressed="${id === selectedTool}" title="${desc} (${i + 1})"><span class="tool-illustration ${id}">${icon(id)}</span><span>${name}</span><kbd>${i + 1}</kbd></button>`,
        )
        .join("")}</nav>
      <div class="drive-hint" id="drive-hint"></div>
    </section>
    <footer class="bottom-bar menu-panel" id="view-controls">
      <button class="travel-button" id="travel" aria-pressed="false"></button>
      <div class="zoom-controls"><button class="view-toggle" id="view-mode" aria-pressed="false" aria-label="Drive in tractor view" title="Tractor view (V)">${icon("tractor")}</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="recenter" aria-label="Center the farm" title="Center the farm">${icon("expand")}</button><button id="zoom-in" aria-label="Zoom in">+</button></div>
    </footer>
    <button class="controls-toggle" id="controls-toggle" aria-label="Hide controls" aria-expanded="true" aria-controls="top-controls tool-controls view-controls" title="Hide controls (M)" hidden>${icon("right")}</button>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div class="pause-veil" id="pause-veil" hidden><div>${icon("feather")}<span>A moment to breathe.</span><button id="resume">Back to the meadow ${icon("play")}</button></div></div>
    <dialog id="dialog" aria-labelledby="dialog-title"><div id="dialog-content"></div></dialog>
  </main>`;
const sceneContainer = document.querySelector<HTMLDivElement>("#scene")!;
const welcome = document.querySelector<HTMLElement>("#welcome")!;
let introSeconds = 0;
sceneContainer.inert = true;
const ambientCopy = document.querySelectorAll<HTMLElement>(
  ".brand, .place-pill, .weather, .world-label, .drive-hint",
);
ambientCopy.forEach((element) => {
  element.classList.add("ambient-copy");
  element.inert = true;
});
const menuPanels = document.querySelectorAll<HTMLElement>(".menu-panel");
menuPanels.forEach((panel) => { panel.inert = true; });
const controlsToggle =
  document.querySelector<HTMLButtonElement>("#controls-toggle")!;
let controlsHidden = false;
let controlsAutoHideDone = false;
let controlsHideTimer: number | undefined;

function cancelControlsHide() {
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = undefined;
}
function setControlsHidden(hidden: boolean) {
  cancelControlsHide();
  // After the first dismissal, the user decides when to tuck the menus away.
  controlsAutoHideDone ||= hidden;
  const moveFocus =
    hidden &&
    Array.from(menuPanels).some((panel) =>
      panel.contains(document.activeElement),
    );
  controlsHidden = hidden;
  document
    .querySelector(".farm-app")!
    .classList.toggle("controls-hidden", hidden);
  menuPanels.forEach((panel) => {
    panel.inert = hidden || !introDismissed;
    if (hidden) panel.setAttribute("aria-hidden", "true");
    else panel.removeAttribute("aria-hidden");
  });
  const label = hidden ? "Show controls" : "Hide controls";
  controlsToggle.setAttribute("aria-label", label);
  controlsToggle.setAttribute("aria-expanded", String(!hidden));
  controlsToggle.title = `${label} (M)`;
  controlsToggle.innerHTML = icon(hidden ? "menu" : "right");
  if (moveFocus) controlsToggle.focus({ preventScroll: true });
}
function scheduleControlsHide(delay = 2000) {
  if (!hasDriven || controlsAutoHideDone || controlsHidden || controlsHideTimer !== undefined) return;
  controlsHideTimer = window.setTimeout(() => {
    controlsHideTimer = undefined;
    if (!paused && !modalOpen && !document.hidden) setControlsHidden(true);
  }, delay);
}
controlsToggle.addEventListener("click", () =>
  setControlsHidden(!controlsHidden),
);
menuPanels.forEach((panel) => {
  panel.addEventListener("pointerdown", cancelControlsHide);
  panel.addEventListener("focusin", cancelControlsHide);
  panel.addEventListener("click", cancelControlsHide);
});
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
} catch {
  welcome.remove();
  sceneContainer.inert = false;
  sceneContainer.innerHTML =
    '<div class="fallback"><h1>Your meadow needs WebGL.</h1><p>Please open Stillfield in a current Safari or Chrome browser with graphics acceleration enabled.</p></div>';
  throw new Error("WebGL unavailable");
}
const touchDevice = window.matchMedia("(pointer: coarse)").matches;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, touchDevice ? 1.5 : 2),
);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor("#e8ecda");
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
sceneContainer.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const sky = new THREE.Color("#e8ecda");
scene.background = sky;
scene.fog = new THREE.Fog("#e8ecda", 125, 230);
const camera = new THREE.OrthographicCamera(-55, 55, 35, -35, 0.1, 300);
const followView = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
const followCamera = new TractorFollowCamera();
const viewCamera = () => (cameraMode === "tractor" ? followView : camera);
const keyboardDown = new THREE.Vector3();
const hemi = new THREE.HemisphereLight("#fff8df", "#7c9060", 2.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff1ce", 3.1);
sun.position.set(-32, 55, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(touchDevice ? 1024 : 2048, touchDevice ? 1024 : 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.normalBias = 0.04;
sun.shadow.bias = -0.0003;
sun.shadow.radius = 3;
scene.add(sun);
// The target moves with the farm view, keeping shadows sharp over either field.
scene.add(sun.target);
const world = createWorld(scene);
const savedField = (id: string) =>
  Array.isArray(saved.fields) ? saved.fields.find((f) => f?.fieldId === id) : undefined;
const fields = [
  createField(scene, saved.farm ?? saved.grid, HOME_SITE),
  createField(scene, savedField(FAR_SITE.id), FAR_SITE),
];
/** The original field, which keeps the save's `farm` entry. */
const field = fields[0];
const fieldFor = (bounds: FieldBounds) =>
  fields.find((f) => f.site.bounds === bounds) ?? field;
const tractor = createTractor(scene);
tractor.setTool(selectedTool);
const dusk = createDusk(scene, tractor.group);
const wind = new Wind();
let volume =
  typeof saved.volume === "number" ? clamp(saved.volume, 0, 1) : 0.45;
const audio = new FarmAudio();
audio.setVolume(volume);
const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.6, 0.7, 40),
  new THREE.MeshBasicMaterial({
    color: "#f9f4d9",
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  }),
);
cursor.rotation.x = -Math.PI / 2;
cursor.position.y = 0.08;
cursor.visible = false;
scene.add(cursor);
// A pale wash over the rows the tractor has been asked to work. It shrinks
// as each row is done, so what is left to do is always plain to see. It is
// drawn over the meadow, because at ground level the grass hides it, so it
// shows in the overhead view only.
const rowWashMaterial = new THREE.MeshBasicMaterial({
  color: "#f9f4d9",
  transparent: true,
  opacity: 0.24,
  depthWrite: false,
  depthTest: false,
});
const rowWash = Array.from({ length: 12 }, () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rowWashMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.056;
  mesh.renderOrder = 2;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
});
function updateRowWash() {
  const rows = cameraMode === "overview" ? navigation.plannedRows : [],
    run = navigation.run;
  rowWash.forEach((mesh, index) => {
    const row = rows[index];
    // Only the part of the current row still ahead of the deck.
    const from =
      row && index === 0 && run && run.workedTo !== null
        ? run.workedTo + row.dir
        : row?.from;
    mesh.visible =
      !!row && from !== undefined && (row.to - from) * row.dir >= 0;
    if (!mesh.visible) return;
    const rect = rowRect(row, from);
    mesh.position.set(rect.x, 0.056, rect.z);
    // A sliver of meadow between washes keeps neighbouring rows distinct.
    mesh.scale.set(
      rect.width - (row.axis === "z" ? 0.3 : 0),
      rect.depth - (row.axis === "x" ? 0.3 : 0),
      1,
    );
  });
}
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  intersection = new THREE.Vector3();
// The farm view slides along the lane with the tractor; inside a field it holds still.
let fieldView = viewBlend(tractorState);
let travel: LaneRide | null = null;
let zoom = 1,
  tractorZoom = FOLLOW_ZOOM.default,
  lastTime = 0,
  time = 0,
  lastSave = 0,
  hasDriven = false;
const keyboard = new GridKeyboard();
function updateTool(tool: Tool) {
  selectedTool = tool;
  // A ride down the lane keeps its implement lifted, whatever the tool.
  if (!travel) navigation.changeTool(tractorState, tool, world.obstacles);
  target = navigation.target;
  tractor.setTool(tool);
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    const active = b.dataset.tool === tool;
    b.classList.toggle("selected", active);
    b.setAttribute("aria-pressed", String(active));
  });
  document.querySelector<HTMLElement>("#crop-choice")!.hidden = tool !== "sow";
  positionLabels();
  persist();
}
function dismissIntro() {
  if (introDismissed) return;
  introDismissed = true;
  const moveFocus = welcome.contains(document.activeElement);
  welcome.classList.add("dismissed");
  welcome.inert = true;
  welcome.setAttribute("aria-hidden", "true");
  document.querySelector(".farm-app")!.classList.remove("welcoming");
  sceneContainer.inert = false;
  menuPanels.forEach((panel) => { panel.inert = controlsHidden; });
  ambientCopy.forEach((element) => { element.inert = false; });
  if (moveFocus) sceneContainer.focus({ preventScroll: true });
  persist();
}
/** Where the farm view is centred; the sun and its shadows follow it. */
const viewFocus = new THREE.Vector3();
function resize() {
  const width = window.innerWidth,
    height = window.innerHeight;
  renderer.setSize(width, height);
  const aspect = width / height;
  frameOverview();
  followView.aspect = aspect;
  followView.fov = TractorFollowCamera.verticalFieldOfView(aspect);
  followView.updateProjectionMatrix();
  updateFollowCamera(0, true);
  positionLabels();
}
/** Rotation keeps the same field (and the same spot on the lane) in view. */
function frameOverview() {
  const aspect = window.innerWidth / window.innerHeight;
  const { position, focus, vertical } = overviewFraming(aspect, fieldView);
  viewFocus.copy(focus);
  sun.target.position.copy(focus);
  camera.position.copy(position);
  camera.lookAt(focus);
  camera.updateMatrixWorld();
  keyboardDown.copy(position).sub(focus).setY(0).normalize();
  camera.left = (-vertical * aspect) / 2;
  camera.right = (vertical * aspect) / 2;
  camera.top = vertical / 2;
  camera.bottom = -vertical / 2;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}
function updateFollowCamera(dt: number, snap = false) {
  if (cameraMode !== "tractor") return;
  const pose = followCamera.update(tractorState, tractorZoom, dt, world.obstacles, snap || reducedMotion);
  followView.position.copy(pose.position);
  followView.lookAt(pose.focus);
  followView.updateMatrixWorld();
}
function setCameraMode(mode: CameraMode, announce = true) {
  setControlsHidden(false);
  stop();
  cameraMode = mode;
  const tractorView = mode === "tractor";
  document.querySelector(".farm-app")!.classList.toggle("tractor-view", tractorView);
  const button = document.querySelector<HTMLButtonElement>("#view-mode")!;
  button.setAttribute("aria-pressed", String(tractorView));
  button.setAttribute("aria-label", tractorView ? "Return to farm view" : "Drive in tractor view");
  button.title = `${tractorView ? "Farm view" : "Tractor view"} (V)`;
  document.querySelector("#recenter")!.setAttribute("aria-label", tractorView ? "Center behind the tractor" : "Center the farm");
  document.querySelector("#drive-hint")!.innerHTML = tractorView
    ? `<span class="hint-desktop"><kbd>W</kbd> to roll <span class="hint-dot">·</span><kbd>A</kbd><kbd>D</kbd> to steer <span class="hint-dot">·</span></span> drag to roll and steer <span class="hint-dot">·</span> tap a spot`
    : `<span class="hint-desktop"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to drive <span class="hint-dot">·</span></span> tap or click to roam around`;
  resize();
  if (!announce) return;
  dismissIntro();
  persist();
  toast(tractorView ? "Drag to roll. Slide sideways to steer, then let go to settle." : "A little room to see it all.");
}
function zoomBy(amount: number) {
  if (cameraMode === "tractor")
    tractorZoom = clamp(tractorZoom + amount * 1.25, FOLLOW_ZOOM.min, FOLLOW_ZOOM.max);
  else zoom = clamp(zoom + amount, 0.7, 1.65);
  resize();
}
function recenter() {
  if (cameraMode === "tractor") tractorZoom = FOLLOW_ZOOM.default;
  else zoom = 1;
  resize();
}
function positionLabels() {
  camera.updateMatrixWorld();
  const controlBounds = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".topbar, .bottom-center, .zoom-controls",
    ),
    (element) => element.getBoundingClientRect(),
  );
  for (const [id, p, offsetY] of [
    ["windmill-label", new THREE.Vector3(25, 0, -10), 28],
    ["barn-label", new THREE.Vector3(-18, 8, -29), 0],
    ["pond-label", new THREE.Vector3(30.5, 0, 20), -8],
    ["field-label", new THREE.Vector3(-12, 0, FIELD.maxZ + 1.5), -6],
    [
      "far-field-label",
      new THREE.Vector3((FAR_FIELD.minX + FAR_FIELD.maxX) / 2, 0, FAR_FIELD.maxZ + 1.5),
      -6,
    ],
  ] as const) {
    const v = p.clone().project(camera);
    const el = document.getElementById(id)!;
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    const labelY = (-v.y * 0.5 + 0.5) * innerHeight + offsetY;
    el.style.top = `${labelY}px`;
    const bounds = el.getBoundingClientRect();
    const overlapsControls = controlBounds.some(
      (control) =>
        bounds.left < control.right + 12 &&
        bounds.right > control.left - 12 &&
        bounds.top < control.bottom + 12 &&
        bounds.bottom > control.top - 12,
    );
    el.style.visibility =
      overlapsControls ||
      bounds.left < 20 ||
      bounds.right > innerWidth - 20 ||
      bounds.top < 20 ||
      bounds.bottom > innerHeight - 20
        ? "hidden"
        : "visible";
  }
}
void document.fonts.ready.then(positionLabels);
const SUN_DISTANCE = 67.4;
let shownPhase: DayPhase | undefined,
  shownHaze = "";
/** Set the lights, the sky, and the interface's tint for this moment of the day. */
function applyDaylight() {
  const now = daylightAt(dayTime);
  sun.color.setRGB(...now.sun, THREE.SRGBColorSpace);
  sun.intensity = now.sunPower;
  // The light comes from the same direction over either field.
  sun.position.set(
    viewFocus.x + now.sunFrom[0] * SUN_DISTANCE,
    viewFocus.y + now.sunFrom[1] * SUN_DISTANCE,
    viewFocus.z + now.sunFrom[2] * SUN_DISTANCE,
  );
  sun.shadow.intensity = now.shadow;
  hemi.color.setRGB(...now.skyLight, THREE.SRGBColorSpace);
  hemi.groundColor.setRGB(...now.groundLight, THREE.SRGBColorSpace);
  hemi.intensity = now.ambient;
  sky.setRGB(...now.sky, THREE.SRGBColorSpace);
  scene.fog!.color.copy(sky);
  renderer.toneMappingExposure = now.exposure;
  // The page edges take a paler shade of the sky by day and the sky itself at night.
  const haze = now.sky.map((value) =>
    Math.round(255 * (value + (1 - value) * 0.5 * (1 - now.glow))),
  );
  const hazeCss = haze.join(" ");
  if (hazeCss !== shownHaze) {
    shownHaze = hazeCss;
    document.body.style.setProperty("--haze", hazeCss);
    document.body.classList.toggle(
      "after-dark",
      0.2126 * haze[0] + 0.7152 * haze[1] + 0.0722 * haze[2] < 150,
    );
  }
  // The ground darkens before the sky does, so labels on it switch earlier.
  document.body.classList.toggle("lamplit", now.glow > 0.4);
  if (now.phase !== shownPhase) {
    shownPhase = now.phase;
    const [title, detail] = DAY_COPY[now.phase];
    const dark = now.phase === "dusk" || now.phase === "night";
    document.querySelector("#weather")!.innerHTML =
      `${icon(dark ? "moon" : "sun")}<span id="weather-copy">${title}<span>${detail}</span></span>`;
  }
  return now;
}
function persist() {
  try {
    const data: Save = {
      version: 3,
      farm: field.engine.snapshot(),
      fields: fields.slice(1).map((f) => f.engine.snapshot()),
      crop: selectedCrop,
      tractor: { ...tractorState, speed: 0 },
      tool: selectedTool,
      guide: false,
      pace,
      golden: light === "golden",
      light,
      day: dayTime,
      intro: introDismissed,
      volume,
      cameraMode,
      tidy,
    };
    if (legacySaveBackup) {
      localStorage.setItem("stillfield-before-grid-v3", legacySaveBackup);
      legacySaveBackup = undefined;
    }
    localStorage.setItem("stillfield-v1", JSON.stringify(data));
  } catch {
    storageAvailable = false;
  }
}
let toastTimer: number | undefined;
function toast(message: string) {
  const el = document.querySelector("#toast")!;
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("visible"), 3400);
}
function stop() {
  endTravel();
  navigation.cancel();
  pointerId = null;
  steering = null;
  target = null;
  keyboard.reset();
  driveKeys.reset();
  cursor.visible = false;
  updateRowWash();
  tractorState.speed = 0;
  audio.setDriving(0);
}
function setPaused(value: boolean) {
  setControlsHidden(false);
  paused = value;
  stop();
  document.querySelector<HTMLDivElement>("#pause-veil")!.hidden = !value;
  const button = document.querySelector("#pause")!;
  button.innerHTML = icon(value ? "play" : "pause");
  button.setAttribute("aria-label", value ? "Resume" : "Pause");
  button.setAttribute("aria-pressed", String(value));
  if (value) persist();
}
async function toggleSound() {
  const next = !soundEnabled;
  try {
    await audio.setEnabled(next);
    soundEnabled = next;
    const b = document.querySelector("#sound")!;
    b.innerHTML = icon(soundEnabled ? "sound" : "muted");
    b.setAttribute(
      "aria-label",
      soundEnabled ? "Turn off nature sounds" : "Turn on nature sounds",
    );
    b.setAttribute("aria-pressed", String(soundEnabled));
    toast(
      soundEnabled ? "A little birdsong. A gentle breeze." : "A little quiet.",
    );
  } catch {
    toast("Sound is resting. Tap again to wake it.");
  }
}
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
let modalOpener: HTMLElement | null = null;
let postcardUrl: string | undefined;
function closeDialog() {
  dialog.close();
  modalOpen = false;
  modalOpener?.focus();
}
function openDialog(content: string, kind = "") {
  setControlsHidden(false);
  stop();
  // A dialog that replaces another keeps the control that first opened one.
  if (!dialog.open) modalOpener = document.activeElement as HTMLElement;
  modalOpen = true;
  dialog.className = kind;
  document.querySelector("#dialog-content")!.innerHTML =
    `<button class="dialog-close round-button" aria-label="Close">${icon("close")}</button>${content}`;
  dialog.showModal();
  dialog.querySelector(".dialog-close")!.addEventListener("click", closeDialog);
}
function showHelp() {
  openDialog(
    `<div class="dialog-symbol">${brandMark}</div><div class="eyebrow">WELCOME TO STILLFIELD</div><h2 id="dialog-title">Make yourself<br><em>at home.</em></h2><p>There’s nothing to win and nowhere to fall behind. Just a little land to make your own.</p><div class="help-steps"><div>${icon("wander")}<span><strong>Find your way</strong>${tidy ? "Tap where a row should end and the tractor works a straight row to it. Tap more rows whenever you like and it works them in turn. Tap twice to fill every row up to that spot. Drag to steer freehand." : "Tap where the work should finish. Drag to keep steering. Tap beside a finished row to face back down it and stop."}<br>WASD or arrow keys follow the field rows. Tap a new direction to turn in place; hold to drive. Up follows the view, even when the window is narrow.<br>A lane past the tree line leads to Foxglove field, twice the size of this one. Tap the signpost to ride there, or tap the lane and follow it.<br>The tractor button beside the zoom controls, or V, follows behind your tractor. Drag to roll; slide left or right from where you pressed to choose its direction, and let go to settle. With keys, W rolls, A and D steer, and S settles.</span></div><div>${icon("sow")}<span><strong>Make your mark</strong>Plow prepares soil and clears any crops. Mow cuts anything back to flat green grass, which slowly grows back into tufts. Sow wheat, sunflowers, or pumpkins, then harvest when they’re ready. Three little plots of wheat, sunflowers, and pumpkins are ready to gather. Harvests gather in pots and carts by the field.</span></div><div>${icon("feather")}<span><strong>Stay for a while</strong>Crops grow only while you’re here: sunflowers in 3 minutes, wheat in 6, pumpkins in 9. Nothing withers. Your meadow saves on this device.</span></div></div><p class="ipad-tip">On iPad, open in Safari and choose Share → Add to Home Screen for a little more room to roam.</p><button class="primary-button" id="help-done">A little time outside ${icon("arrow")}</button>`,
  );
  dialog.querySelector("#help-done")!.addEventListener("click", closeDialog);
}
function showSettings() {
  openDialog(
    `<div class="eyebrow">THE WAY YOU LIKE IT</div><h2 id="dialog-title">Settle <em>in.</em></h2><p>A few small comforts for your time outside.</p><div class="settings-list"><div class="choice-setting"><span id="light-label"><strong>Time of day</strong><small>Let the day drift by, or keep the light you like.</small></span><div class="choice-row" role="group" aria-labelledby="light-label">${DAY_HOLDS.map((hold) => `<button class="choice ${hold === light ? "selected" : ""}" data-light="${hold}" aria-pressed="${hold === light}">${LIGHT_NAMES[hold]}</button>`).join("")}</div></div><div class="choice-setting"><span id="rows-label"><strong>Making rows</strong><small>Drive them your own way, or let taps lay them straight, side by side.</small></span><div class="choice-row" role="group" aria-labelledby="rows-label">${[false, true].map((on) => `<button class="choice ${on === tidy ? "selected" : ""}" data-tidy="${on}" aria-pressed="${on === tidy}">${on ? "Tidy rows" : "Freehand"}</button>`).join("")}</div></div><label class="range-setting" for="pace-setting"><strong>Your pace</strong><input type="range" id="pace-setting" min="0.55" max="1.25" step="0.05" value="${pace}"><span><small>Unhurried</small><small>A little breezier</small></span></label><label class="range-setting" for="volume-setting"><strong>Nature sounds</strong><input type="range" id="volume-setting" min="0" max="1" step="0.05" value="${volume}"><span><small>A whisper</small><small>All around you</small></span></label></div><button class="reset-button" id="fresh">${icon("reset")} A fresh meadow</button><p class="settings-footnote">${storageAvailable ? "Your meadow is saved automatically on this device." : "Browser storage is unavailable. This meadow lasts for this visit."}</p>`,
  );
  const lightChoices =
    dialog.querySelectorAll<HTMLButtonElement>("[data-light]");
  lightChoices.forEach((choice) =>
    choice.addEventListener("click", () => {
      light = choice.dataset.light as DayHold;
      // A held light jumps to its moment; drifting carries on from wherever it is.
      if (light !== "flow") dayTime = holdSeconds(light);
      lightChoices.forEach((other) => {
        const selected = other === choice;
        other.classList.toggle("selected", selected);
        other.setAttribute("aria-pressed", String(selected));
      });
      persist();
    }),
  );
  const rowChoices = dialog.querySelectorAll<HTMLButtonElement>("[data-tidy]");
  rowChoices.forEach((choice) =>
    choice.addEventListener("click", () => {
      tidy = choice.dataset.tidy === "true";
      navigation.tidy = tidy;
      rowChoices.forEach((other) => {
        const selected = other === choice;
        other.classList.toggle("selected", selected);
        other.setAttribute("aria-pressed", String(selected));
      });
      persist();
    }),
  );
  dialog.querySelector("#pace-setting")!.addEventListener("input", (e) => {
    pace = Number((e.target as HTMLInputElement).value);
    persist();
  });
  dialog
    .querySelector("#volume-setting")!
    .addEventListener("input", async (e) => {
      volume = Number((e.target as HTMLInputElement).value);
      audio.setVolume(volume);
      persist();
      if (!soundEnabled) await toggleSound();
    });
  dialog.querySelector("#fresh")!.addEventListener("click", showReset);
}
async function showPostcard(view: PostcardView = "farm") {
  openDialog(
    `<div class="eyebrow">A KEEPSAKE</div><h2 id="dialog-title">Wish you <em>were here.</em></h2><p>Your meadow, just as it is right now. It stays on this device unless you send it somewhere.</p><img class="postcard-preview" id="postcard-preview" width="${POSTCARD_SIZE.width}" height="${POSTCARD_SIZE.height}" alt="A postcard of your meadow"><div class="choice-row" role="group" aria-label="What the postcard shows">${(
      [
        ["farm", "The whole farm"],
        ["field", "Just the field"],
      ] as const
    )
      .map(
        ([id, name]) =>
          `<button class="choice ${id === view ? "selected" : ""}" data-view="${id}" aria-pressed="${id === view}">${name}</button>`,
      )
      .join(
        "",
      )}</div><button class="primary-button" id="postcard-save" disabled>Save the postcard ${icon("arrow")}</button><button class="text-button" id="postcard-share" hidden>Send it to someone</button>`,
    "postcard",
  );
  const preview = dialog.querySelector<HTMLImageElement>("#postcard-preview")!;
  dialog
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((choice) =>
      choice.addEventListener("click", () => {
        if (choice.dataset.view !== view)
          void showPostcard(choice.dataset.view as PostcardView);
      }),
    );
  dialog
    .querySelector<HTMLButtonElement>(`[data-view="${view}"]`)!
    .focus({ preventScroll: true });
  // The caption uses the interface fonts, so wait for them before drawing.
  await Promise.all([
    document.fonts.load('italic 400 62px "Lora Variable"'),
    document.fonts.load('500 72px "Lora Variable"'),
    document.fonts.load('400 30px "DM Sans Variable"'),
  ]).catch(() => {});
  if (!preview.isConnected) return;
  // The postcard shows the field the player is at.
  const here = fieldFor(siteForView(fieldView).bounds);
  const shot = postcardCamera(view, fieldView, here.site.bounds);
  const cursorShown = cursor.visible;
  cursor.visible = false;
  rowWash.forEach((mesh) => (mesh.visible = false));
  // Fireflies are sized in screen pixels, so scale them to the larger picture.
  dusk.setPointScale(
    PHOTO.height /
      (shot.top - shot.bottom) /
      ((innerHeight * zoom) / (camera.top - camera.bottom)),
  );
  let photo: HTMLCanvasElement;
  try {
    photo = photograph(renderer, scene, shot);
  } finally {
    cursor.visible = cursorShown;
    updateRowWash();
    dusk.setPointScale(1);
    renderer.render(scene, viewCamera());
  }
  const card = composePostcard(
    photo,
    DAY_COPY[daylightAt(dayTime).phase][0],
    growingLine(here.engine.cells, (cell) => here.engine.cropAt(cell)),
  );
  const blob = await postcardBlob(card);
  if (!blob || !preview.isConnected) return;
  if (postcardUrl) URL.revokeObjectURL(postcardUrl);
  postcardUrl = URL.createObjectURL(blob);
  preview.src = postcardUrl;
  preview.classList.add("ready");
  const save = dialog.querySelector<HTMLButtonElement>("#postcard-save")!;
  save.disabled = false;
  save.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = postcardUrl!;
    link.download = "stillfield-postcard.png";
    link.click();
    toast("Saved. A little meadow to keep.");
  });
  const file = new File([blob], "stillfield-postcard.png", {
    type: "image/png",
  });
  const share = dialog.querySelector<HTMLButtonElement>("#postcard-share")!;
  if (navigator.canShare?.({ files: [file] })) {
    share.hidden = false;
    share.addEventListener("click", () => {
      // Closing the share sheet is not an error worth mentioning.
      void navigator.share({ files: [file] }).catch(() => {});
    });
  }
}
function showReset() {
  openDialog(
    `<div class="dialog-symbol">${icon("sow")}</div><div class="eyebrow">BEGIN AGAIN, GENTLY</div><h2 id="dialog-title">A fresh <em>meadow.</em></h2><p>Return your paths, crops, and harvest displays to an empty meadow. A blank canvas for another quiet afternoon.</p><button class="primary-button" id="confirm-reset">Let it grow ${icon("sow")}</button><button class="text-button" id="cancel-reset">Keep my little corner</button>`,
  );
  dialog.querySelector("#confirm-reset")!.addEventListener("click", () => {
    fields.forEach((f) => f.reset());
    navigation = new TractorNavigation();
    navigation.tidy = tidy;
    tractorState = { ...defaultTractor };
    stop();
    fieldView = viewBlend(tractorState);
    resize();
    persist();
    closeDialog();
    toast("A fresh start. Take your time.");
  });
  dialog.querySelector("#cancel-reset")!.addEventListener("click", closeDialog);
}
/** Whether the selected tool would change a cell, so a fill can pass over idle lanes. */
function workable(cell: number, bounds: FieldBounds) {
  const field = fieldFor(bounds),
    ground = field.grid[cell];
  return selectedTool === "plow"
    ? ground !== Ground.soil
    : selectedTool === "sow"
      ? ground === Ground.soil
      : selectedTool === "harvest"
        ? ground === Ground.mature
        : selectedTool === "mow" &&
          (ground !== Ground.mown || field.engine.progress[cell] > 0);
}
// A pass that changes nothing says why, once, instead of leaving it a puzzle.
let changedSinceTap = 0,
  lastHint = -Infinity;
function explainIdlePass() {
  const message =
    selectedTool === "sow"
      ? "Seeds like prepared soil. Plow here first."
      : selectedTool === "harvest"
        ? "Nothing here is ripe just yet."
        : "";
  if (!message || time - lastHint < 30) return;
  lastHint = time;
  toast(message);
}
function pointerTarget(
  event: { clientX: number; clientY: number },
  options: ChooseOptions = {},
) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    (-(event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const view = viewCamera();
  raycaster.setFromCamera(pointer, view);
  if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
    // Sky and far-scenery taps behind the tractor must never send it to a far edge.
    if (view === followView && !drivableTarget(intersection)) return;
    keyboard.reset();
    endTravel();
    navigation.choose(
      clampToWorld(intersection),
      tractorState,
      selectedTool,
      world.obstacles,
      { ...options, workable },
    );
    changedSinceTap = 0;
    // A tidy row ends on its lane, not exactly under the finger.
    target = navigation.target;
    if (target) cursor.position.set(target.x, 0.09, target.z);
    cursor.visible = target !== null;
    updateRowWash();
    dismissIntro();
    scheduleControlsHide();
  }
}
let pointerId: number | null = null;
let pointerOrigin = { x: 0, y: 0 },
  pointerMoved = false,
  pointerDownAt = 0,
  lastTap = { time: -Infinity, x: 0, y: 0 };
/** With tidy rows, a second tap on the same spot asks for every row up to it. */
function secondTap(x: number, y: number) {
  const now = performance.now();
  const again =
    tidy &&
    now - lastTap.time < 400 &&
    Math.hypot(x - lastTap.x, y - lastTap.y) < 30;
  lastTap = { time: again ? -Infinity : now, x, y };
  return again;
}
/** Tractor view: drag to roll and steer from where you pressed; a tap that stays put chooses a destination. */
let steering: SteeringGesture | null = null;
const driveKeys = new DriveKeyboard();
sceneContainer.addEventListener("pointerdown", (e) => {
  if (
    paused ||
    modalOpen ||
    e.button !== 0 ||
    !e.isPrimary ||
    pointerId !== null
  )
    return;
  pointerId = e.pointerId;
  pointerOrigin = { x: e.clientX, y: e.clientY };
  pointerMoved = false;
  pointerDownAt = performance.now();
  sceneContainer.setPointerCapture(e.pointerId);
  if (cameraMode === "tractor") {
    // Tidy rows wait their turn, so a new touch must not drop them. Steering
    // by hand still takes over, in the navigation step.
    if (!tidy) {
      navigation.cancel();
      target = null;
      cursor.visible = false;
    }
    keyboard.reset();
    driveKeys.reset();
    // Steering by hand takes over from a ride down the lane.
    endTravel();
    steering = new SteeringGesture(e.clientX, e.clientY, tractorState.heading);
    dismissIntro();
    scheduleControlsHide();
  } else pointerTarget(e, { fill: secondTap(e.clientX, e.clientY) });
  sceneContainer.focus({ preventScroll: true });
});
sceneContainer.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId || paused || modalOpen) return;
  if (steering) {
    steering.update(e.clientX, e.clientY);
    return;
  }
  const moved = Math.hypot(
    e.clientX - pointerOrigin.x,
    e.clientY - pointerOrigin.y,
  );
  // A tap may wobble under a finger. With tidy rows, only a press that is
  // held or carried well away from where it began becomes freehand steering.
  pointerMoved ||= tidy
    ? moved > 8 && (performance.now() - pointerDownAt > 160 || moved > 28)
    : moved > 8;
  if (pointerMoved) pointerTarget(e, { freehand: true });
});
sceneContainer.addEventListener("pointerup", (e) => {
  if (e.pointerId === pointerId) {
    // The next frame has no drag input: yaw stops immediately, travel settles.
    if (steering && !steering.moved)
      pointerTarget(
        { clientX: steering.location.x, clientY: steering.location.y },
        { fill: secondTap(steering.location.x, steering.location.y) },
      );
    steering = null;
    pointerId = null;
    if (sceneContainer.hasPointerCapture(e.pointerId))
      sceneContainer.releasePointerCapture(e.pointerId);
  }
});
sceneContainer.addEventListener("pointercancel", () => {
  pointerId = null;
  stop();
});
sceneContainer.addEventListener("lostpointercapture", () => {
  if (pointerId !== null) stop();
});
sceneContainer.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (
    modalOpen ||
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement ||
    (e.target instanceof HTMLElement && e.target.isContentEditable) ||
    e.metaKey || e.ctrlKey || e.altKey
  )
    return;
  if (!introDismissed) {
    if (isDriveKey(e.code) || ["Enter", "Space", "Escape"].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) dismissIntro();
    }
    return;
  }
  if (isDriveKey(e.code)) {
    e.preventDefault();
    if (!paused && !e.repeat && cameraMode === "tractor") {
      // Behind the tractor, keys drive it like a vehicle instead of following the rows.
      endTravel();
      navigation.cancel();
      target = null;
      driveKeys.press(e.code);
      dismissIntro();
      scheduleControlsHide();
    } else if (!paused && !e.repeat) {
      endTravel();
      keyboard.press(e.code, keyboardDown);
      dismissIntro();
      scheduleControlsHide();
    }
  } else if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    setPaused(!paused);
  } else if (["1", "2", "3", "4", "5"].includes(e.key)) {
    updateTool(tools[Number(e.key) - 1]);
  } else if (e.key.toLowerCase() === "v" && !paused && !e.repeat) {
    e.preventDefault();
    setCameraMode(cameraMode === "tractor" ? "overview" : "tractor");
  } else if (e.key.toLowerCase() === "m" && hasDriven && !paused && !e.repeat) {
    e.preventDefault();
    setControlsHidden(!controlsHidden);
  } else if (e.key === "Escape") {
    if (!paused) setPaused(true);
    else setPaused(false);
  }
});
window.addEventListener("keyup", (e) => {
  keyboard.release(e.code);
  driveKeys.release(e.code);
});
window.addEventListener("focus", () => {
  windowActive = true;
  lastTime = performance.now();
});
window.addEventListener("blur", () => {
  windowActive = false;
  cancelControlsHide();
  stop();
  persist();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    windowActive = false;
    cancelControlsHide();
    stop();
    persist();
    if (soundEnabled) void audio.setEnabled(false);
  } else {
    windowActive = document.hasFocus();
    lastTime = performance.now();
    if (soundEnabled) void audio.setEnabled(true).catch(() => {});
  }
});
window.addEventListener("pagehide", persist);
window.addEventListener("resize", resize);
document
  .querySelectorAll<HTMLButtonElement>("[data-tool]")
  .forEach((b) =>
    b.addEventListener("click", () => updateTool(b.dataset.tool as Tool)),
  );
document
  .querySelectorAll<HTMLButtonElement>("[data-crop]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      selectedCrop = button.dataset.crop as Crop;
      document
        .querySelectorAll<HTMLButtonElement>("[data-crop]")
        .forEach((choice) => {
          const selected = choice.dataset.crop === selectedCrop;
          choice.classList.toggle("selected", selected);
          choice.setAttribute("aria-pressed", String(selected));
        });
      persist();
    });
  });
welcome.addEventListener("click", dismissIntro);
document.querySelector(".brand")!.addEventListener("click", (e) => {
  e.preventDefault();
  zoom = 1;
  resize();
});
document.querySelector("#sound")!.addEventListener("click", toggleSound);
document
  .querySelector("#pause")!
  .addEventListener("click", () => setPaused(!paused));
document
  .querySelector("#resume")!
  .addEventListener("click", () => setPaused(false));
document.querySelector("#settings")!.addEventListener("click", showSettings);
document
  .querySelector("#postcard")!
  .addEventListener("click", () => void showPostcard());
document.querySelector("#place")!.addEventListener("click", showHelp);
document.querySelector("#zoom-in")!.addEventListener("click", () => zoomBy(0.12));
document.querySelector("#zoom-out")!.addEventListener("click", () => zoomBy(-0.12));
document.querySelector("#recenter")!.addEventListener("click", recenter);
const travelButton = document.querySelector<HTMLButtonElement>("#travel")!;
let travelButtonState = "";
/** The signpost always points to the other end of the lane. */
function updateTravelButton() {
  const destination = travel?.to ?? laneDestination(tractorState);
  const state = `${travel ? "riding" : "idle"}:${destination.id}`;
  if (state === travelButtonState) return;
  travelButtonState = state;
  const name = SITE_NAMES[destination.id];
  travelButton.innerHTML = travel
    ? `${icon("pause")}<span>Stop here</span>`
    : `${icon("signpost")}<span>${name}</span>`;
  travelButton.setAttribute("aria-pressed", String(!!travel));
  travelButton.setAttribute(
    "aria-label",
    travel ? `Stop on the way to ${name}` : `Ride the lane to ${name}`,
  );
  travelButton.title = travel ? "Stop here" : `Ride the lane to ${name}`;
}
function startTravel() {
  if (paused || modalOpen) return;
  keyboard.reset();
  driveKeys.reset();
  steering = null;
  travel = new LaneRide(
    laneDestination(tractorState),
    tractorState,
    navigation,
    world.obstacles,
  );
  target = navigation.target;
  cursor.position.set(travel.end.x, 0.09, travel.end.z);
  updateRowWash();
  dismissIntro();
  scheduleControlsHide();
  updateTravelButton();
}
function endTravel() {
  if (!travel) return;
  travel = null;
  navigation.cancel();
  target = null;
  updateTravelButton();
}
travelButton.addEventListener("click", () => {
  if (travel) {
    endTravel();
    cursor.visible = false;
  } else startTravel();
});
document.querySelector("#view-mode")!.addEventListener("click", () =>
  setCameraMode(cameraMode === "tractor" ? "overview" : "tractor"),
);
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) closeDialog();
});
dialog.addEventListener("cancel", () => {
  modalOpen = false;
});
dialog.addEventListener("close", () => {
  if (postcardUrl) URL.revokeObjectURL(postcardUrl);
  postcardUrl = undefined;
});
applyDaylight();
setCameraMode(cameraMode, false);
updateTool(selectedTool);
updateTravelButton();
let changedSinceSave = false;
const attachment = tractor.group.getObjectByName("attachment")!;
function animate(now: number) {
  requestAnimationFrame(animate);
  const activeSeconds = lastTime ? Math.max(0, (now - lastTime) / 1000) : 0;
  const dt = Math.min(activeSeconds, 0.05);
  lastTime = now;
  if (document.hidden) return;
  // Count visible time, allowing keyboard users to linger on the welcome button.
  if (!introDismissed && windowActive && !welcome.contains(document.activeElement)) {
    introSeconds += Math.min(activeSeconds, 0.25);
    if (introSeconds >= 5) dismissIntro();
  }
  const daylight = applyDaylight();
  dusk.update(daylight.glow, reducedMotion ? 0 : time);
  if (!paused && !modalOpen && windowActive) {
    time += dt;
    if (light === "flow") dayTime = wrapDay(dayTime + activeSeconds);
    for (const f of fields)
      changedSinceSave ||= f.advance(activeSeconds).advancedSeconds > 0;
    const gridInput = keyboard.input;
    const previousHeading = tractorState.heading;
    const movement = navigation.step(
      tractorState,
      dt,
      travel ? "wander" : selectedTool,
      world.obstacles,
      pace,
      travel
        ? null
        : steering?.moved
          ? { heading: steering.heading }
          : cameraMode === "tractor" && driveKeys.input
            ? { keys: driveKeys.input }
            : gridInput
              ? { grid: gridInput }
              : null,
      cameraMode === "tractor",
    );
    tractorState = movement.state;
    changedSinceSave ||= tractorState.heading !== previousHeading;
    if (travel) {
      const arrived = travel.to,
        ride = travel.update(tractorState, movement.blocked);
      if (ride === "blocked") {
        endTravel();
        toast("Something’s in the way. Tap the lane to find a way round.");
      } else if (ride === "arrived") {
        endTravel();
        toast(
          arrived.id === FAR_SITE.id
            ? "Foxglove field. A little more room to roam."
            : "Home again, by the barn.",
        );
      }
    }
    // Follow the tractor along the lane; settle on whichever field it reaches.
    const desiredView = viewBlend(tractorState);
    if (Math.abs(desiredView - fieldView) > 1e-4) {
      fieldView = reducedMotion
        ? desiredView
        : fieldView + (desiredView - fieldView) * (1 - Math.exp(-3 * dt));
      if (Math.abs(desiredView - fieldView) <= 1e-4) fieldView = desiredView;
      frameOverview();
      if (!hasDriven) positionLabels();
    }
    updateTravelButton();
    target = navigation.target;
    cursor.visible = target !== null;
    if (target) cursor.position.set(target.x, 0.09, target.z);
    updateRowWash();
    const worked = (event: FarmingEvents) => {
      changedSinceSave ||= event.groundChanges.length > 0;
      changedSinceTap += event.groundChanges.length;
      if (event.harvestResults.length)
        audio.harvest(event.harvestResults[0].crop);
    };
    // A sweep only touches cells under the implement, so every field can listen.
    movement.paint.forEach((point, index, points) => {
      for (const f of fields)
        worked(
          f.paint(
            point.x,
            point.z,
            selectedTool,
            points[Math.max(0, index - 1)],
            selectedCrop,
          ),
        );
    });
    // A tidy row works exactly its own cells, in its own field.
    if (movement.cells.length)
      worked(
        fieldFor(movement.field).paintCells(movement.cells, selectedTool, selectedCrop),
      );
    if (movement.completed && tidy && changedSinceTap === 0) explainIdlePass();
    if (tractorState.speed > 0.1) {
      if (!hasDriven) {
        hasDriven = true;
        document.querySelector(".farm-app")!.classList.add("has-driven");
        ambientCopy.forEach((element) => {
          element.inert = true;
          element.setAttribute("aria-hidden", "true");
        });
        window.clearTimeout(toastTimer);
        document.querySelector("#toast")!.classList.remove("visible");
        controlsToggle.hidden = false;
        scheduleControlsHide(3200);
      }
      changedSinceSave = true;
    }
    tractor.group.position.set(tractorState.x, 0, tractorState.z);
    tractor.group.rotation.y = tractorState.heading;
    tractor.update(tractorState.speed, dt, time);
    attachment.position.y +=
      ((navigation.turn || navigation.gridTurning || navigation.lifted || travel ? 0.4 : 0) -
        attachment.position.y) *
      (1 - Math.exp(-8 * dt));
    // A gust reads the field as it crosses: each beat sounds what grows there.
    // Gusts cross whichever field you are at; one under way finishes its field.
    wind.follow(siteForView(fieldView).bounds);
    const gust = wind.advance(activeSeconds),
      gusting = fieldFor(wind.bounds);
    for (const step of gust.steps)
      for (const note of sliceNotes(gusting.engine, step))
        audio.windNote(
          note.voice,
          note.voice === "stubble"
            ? 0
            : windFrequency(note.voice, note.band, daylight.glow > 0.6),
          note.level * beatAccent(step),
          (step / (wind.steps - 1)) * 1.2 - 0.6,
        );
    for (const f of fields)
      f.wind(f === gusting && !reducedMotion ? gust.front : null, time);
    audio.setGust(gust.strength);
    audio.setAmbience(daylight.birds, daylight.glow);
    // The windmills pick up while the gust passes.
    world.update(
      reducedMotion ? 0 : time,
      reducedMotion ? 0 : dt * (1 + gust.strength * 2.2),
    );
    updateFollowCamera(dt);
    audio.setDriving(tractorState.speed / 6);
    cursor.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
    if (time - lastSave > 3 && changedSinceSave) {
      persist();
      changedSinceSave = false;
      lastSave = time;
    }
  }
  renderer.render(scene, viewCamera());
}
requestAnimationFrame(animate);
// A read-only inspection surface for development and browser verification.
if (import.meta.env.DEV)
  Object.defineProperty(window, "__STILLFIELD__", {
    get: () => ({
      tractor: { ...tractorState },
      tool: selectedTool,
      paused,
      guide: false,
      pace,
      golden: light === "golden",
      light,
      day: dayTime,
      phase: daylightAt(dayTime).phase,
      gusting: wind.gusting,
      // Development helpers for checking the day and the wind without waiting.
      setDay(seconds: number) {
        dayTime = wrapDay(seconds);
      },
      gust() {
        wind.gust();
      },
      hasDriven,
      controlsHidden,
      introDismissed,
      grid: Array.from(field.grid),
      farm: field.engine.snapshot(),
      farms: fields.map((f) => f.engine.snapshot()),
      view: fieldView,
      traveling: travel ? travel.to.id : null,
      route: travel ? travel.route.map((p) => ({ ...p })) : [],
      crop: selectedCrop,
      cameraMode,
      tractorZoom,
      followHeading: followCamera.heading,
      steering: steering?.moved ? steering.heading : null,
      driveKeys: driveKeys.input,
      drawCalls: renderer.info.render.calls,
      camera: {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      },
      target,
      tidy,
      rows: navigation.plannedRows,
      queued: navigation.hasQueued,
      turningAtRowEnd: !!navigation.turn,
      turningInPlace: navigation.gridTurning,
      workedRow: navigation.rows.last,
    }),
  });
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
