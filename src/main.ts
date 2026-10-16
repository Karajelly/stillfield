import * as THREE from "three";
import "./style.css";
import { createWorld } from "./world";
import { createField } from "./field";
import { CROPS, CROP_NAMES } from "./farming";
import type { Crop, FarmSnapshot } from "./farming";
import { createTractor } from "./tractor";
import { FarmAudio } from "./audio";
import { clamp, FIELD } from "./simulation";
import { TractorNavigation } from "./tractor-navigation";
import type { Point, Tool, TractorState } from "./simulation";
import { icon, brandMark } from "./icons";
import { overviewFraming } from "./overview";
import { GridKeyboard, isDriveKey } from "./keyboard-navigation";

interface Save {
  version: 1 | 2 | 3;
  grid?: number[];
  farm?: FarmSnapshot;
  crop?: Crop;
  tractor: TractorState;
  tool: Tool;
  guide: boolean;
  pace: number;
  golden: boolean;
  intro: boolean;
  volume: number;
}
let saved: Partial<Save> = {};
let legacySaveBackup: string | undefined;
try {
  const raw = localStorage.getItem("stillfield-v1");
  const data = JSON.parse(raw || "null");
  if (data?.version === 1 || data?.version === 2 || data?.version === 3) {
    saved = { ...data, tool: data.tool === "till" ? "cultivate" : data.tool };
    if (data.version < 3 && raw) legacySaveBackup = raw;
  }
} catch {
  /* A private meadow works even without browser storage. */
}
const tools: Tool[] = ["cultivate", "sow", "harvest", "wander"];
let selectedTool: Tool = tools.includes(saved.tool!)
  ? saved.tool!
  : saved.tool === "mow" || saved.tool === "restore"
    ? "wander"
    : "harvest";
let selectedCrop: Crop = CROPS.includes(saved.crop!) ? saved.crop! : "wheat";
let windowActive = document.hasFocus();
let pace =
    typeof saved.pace === "number" ? clamp(saved.pace, 0.55, 1.25) : 0.85,
  golden = saved.golden ?? false;
let paused = false,
  soundEnabled = false,
  modalOpen = false,
  introDismissed = !!saved.intro,
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
tractorState.x = clamp(tractorState.x, -39, 39);
tractorState.z = clamp(tractorState.z, -30, 28);
let target: Point | null = null;
let navigation = new TractorNavigation();
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="farm-app">
    <div id="scene" aria-label="Your pastoral farm. Tap or drag the meadow to drive. WASD or arrow keys follow the field rows, turning in place." role="application" tabindex="0"></div>
    <div class="vignette" aria-hidden="true"></div>
    <header class="topbar menu-panel" id="top-controls">
      <a class="brand" href="#" aria-label="Stillfield home">${brandMark}<span>stillfield<span class="brand-tagline">a little farm. a little peace.</span></span></a>
      <button class="place-pill" id="place" aria-label="About Willowbrook farm"><span class="live-dot"></span>Willowbrook farm ${icon("down")}</button>
      <div class="top-actions">
        <div class="weather">${icon("sun")}<span id="weather-copy">A slow spring afternoon<span>18° · a gentle breeze</span></span></div>
        <div class="action-group"><button class="round-button" id="sound" aria-label="Turn on nature sounds" aria-pressed="false" title="Nature sounds">${icon("muted")}</button><button class="round-button" id="pause" aria-label="Pause" aria-pressed="false" title="Pause (space)">${icon("pause")}</button><button class="round-button" id="settings" aria-label="Open settings" title="Make yourself at home">${icon("settings")}</button></div>
      </div>
    </header>
    <section class="welcome ${introDismissed ? "dismissed" : ""}" id="welcome">
      <div class="eyebrow"><span></span> THERE’S NO HURRY HERE</div>
      <h1><span class="welcome-title">A good day<br>to take it <em>slow.</em></span><span class="welcome-title-short">Take it <em>slow.</em></span></h1>
      <p>A little fresh air. A few tidy rows.<br>Nothing you need to finish.</p>
      <button class="welcome-button" id="begin">Let’s wander ${icon("arrow")}</button>
    </section>
    <div class="field-note" id="field-note"><span class="note-line"></span><span>THE MEADOW<small>Room to do your own thing.</small></span></div>
    <div class="world-label" id="windmill-label"><span></span>Windmill hill</div>
    <div class="world-label" id="pond-label"><span></span>The quiet pond</div>
    <div id="destination" aria-hidden="true"><span></span></div>
    <section class="bottom-center menu-panel" id="tool-controls" aria-label="Tractor tools">
      <div class="crop-choices" id="crop-choice" role="group" aria-label="Crop to sow" hidden>${CROPS.map((crop) => `<button class="crop-button ${crop} ${crop === selectedCrop ? "selected" : ""}" data-crop="${crop}" aria-label="Sow ${CROP_NAMES[crop]}" aria-pressed="${crop === selectedCrop}">${icon(crop)}<span>${CROP_NAMES[crop]}</span></button>`).join("")}</div>
      <nav class="tool-dock" aria-label="Choose your tool">${[
        ["cultivate", "Cultivate", "Prepare soil, clearing any crops"],
        ["sow", "Sow", "Plant the chosen crop in soil"],
        ["harvest", "Harvest", "Gather mature crops"],
        ["wander", "Wander", "Just enjoy the ride"],
      ]
        .map(
          ([id, name, desc], i) =>
            `<button class="tool-button ${id === selectedTool ? "selected" : ""}" data-tool="${id}" aria-pressed="${id === selectedTool}" title="${desc} (${i + 1})"><span class="tool-illustration ${id}">${icon(id)}</span><span>${name}</span><kbd>${i + 1}</kbd></button>`,
        )
        .join("")}</nav>
      <div class="drive-hint" id="drive-hint"><span class="hint-desktop"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> along the rows <span class="hint-dot">·</span></span> tap where the work should finish</div>
    </section>
    <footer class="bottom-bar menu-panel" id="view-controls">
      <div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="recenter" aria-label="Center the farm" title="Center the farm">${icon("expand")}</button><button id="zoom-in" aria-label="Zoom in">+</button></div>
    </footer>
    <button class="controls-toggle" id="controls-toggle" aria-label="Hide controls" aria-expanded="true" aria-controls="top-controls tool-controls view-controls" title="Hide controls (M)" hidden>${icon("right")}</button>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div class="pause-veil" id="pause-veil" hidden><div>${icon("feather")}<span>A moment to breathe.</span><button id="resume">Back to the meadow ${icon("play")}</button></div></div>
    <dialog id="dialog" aria-labelledby="dialog-title"><div id="dialog-content"></div></dialog>
  </main>`;
const sceneContainer = document.querySelector<HTMLDivElement>("#scene")!;
const ambientCopy = document.querySelectorAll<HTMLElement>(
  ".brand, .place-pill, .weather, .field-note, .world-label, .drive-hint",
);
ambientCopy.forEach((element) => element.classList.add("ambient-copy"));
const menuPanels = document.querySelectorAll<HTMLElement>(".menu-panel");
const controlsToggle =
  document.querySelector<HTMLButtonElement>("#controls-toggle")!;
let controlsHidden = false;
let controlsHideTimer: number | undefined;

function cancelControlsHide() {
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = undefined;
}
function setControlsHidden(hidden: boolean) {
  cancelControlsHide();
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
    panel.inert = hidden;
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
  if (!hasDriven || controlsHidden || controlsHideTimer !== undefined) return;
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
  sceneContainer.innerHTML =
    '<div class="fallback"><h1>Your meadow needs WebGL.</h1><p>Please open Stillfield in a current Safari or Chrome browser with graphics acceleration enabled.</p></div>';
  throw new Error("WebGL unavailable");
}
const touchDevice = window.matchMedia("(pointer: coarse)").matches;
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
scene.background = new THREE.Color("#e8ecda");
scene.fog = new THREE.Fog("#e8ecda", 125, 230);
const camera = new THREE.OrthographicCamera(-55, 55, 35, -35, 0.1, 300);
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
const world = createWorld(scene);
const field = createField(scene, saved.farm ?? saved.grid);
const tractor = createTractor(scene);
tractor.setTool(selectedTool);
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
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  intersection = new THREE.Vector3();
let zoom = 1,
  lastTime = 0,
  time = 0,
  lastSave = 0,
  hasDriven = false;
const keyboard = new GridKeyboard();
function updateTool(tool: Tool) {
  selectedTool = tool;
  navigation.changeTool(tractorState, tool, world.obstacles);
  target = navigation.target;
  tractor.setTool(tool);
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    const active = b.dataset.tool === tool;
    b.classList.toggle("selected", active);
    b.setAttribute("aria-pressed", String(active));
  });
  document.querySelector<HTMLElement>("#crop-choice")!.hidden = tool !== "sow";
  persist();
}
function dismissIntro() {
  if (introDismissed) return;
  introDismissed = true;
  document.querySelector("#welcome")!.classList.add("dismissed");
  document.querySelector<HTMLElement>("#welcome")!.inert = true;
  persist();
}
function resize() {
  const width = window.innerWidth,
    height = window.innerHeight;
  renderer.setSize(width, height);
  const aspect = width / height;
  const { position, focus, vertical } = overviewFraming(aspect);
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
  positionLabels();
}
function positionLabels() {
  camera.updateMatrixWorld();
  for (const [id, p] of [
    ["windmill-label", new THREE.Vector3(25, 0, -10)],
    ["pond-label", new THREE.Vector3(28, 0, 23)],
  ] as const) {
    const v = p.clone().project(camera);
    const el = document.getElementById(id)!;
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    const labelY = (-v.y * 0.5 + 0.5) * innerHeight + 28;
    el.style.top = `${labelY}px`;
    el.style.visibility =
      labelY > innerHeight - 190 || labelY < 120 || v.x > 0.85 || v.x < -0.85
        ? "hidden"
        : "visible";
  }
}
function setLight() {
  sun.color.set(golden ? "#ffd299" : "#fff1ce");
  sun.intensity = golden ? 3.3 : 3.1;
  hemi.color.set(golden ? "#ffe3bb" : "#fff8df");
  hemi.intensity = golden ? 2.0 : 2.5;
  scene.background = new THREE.Color(golden ? "#eee5ce" : "#e8ecda");
  scene.fog!.color.set(golden ? "#eee5ce" : "#e8ecda");
  document.querySelector("#weather-copy")!.innerHTML =
    `${golden ? "A little golden hour" : "A slow spring afternoon"}<span>18° · a gentle breeze</span>`;
  document.body.classList.toggle("golden", golden);
}
function persist() {
  try {
    const data: Save = {
      version: 3,
      farm: field.engine.snapshot(),
      crop: selectedCrop,
      tractor: { ...tractorState, speed: 0 },
      tool: selectedTool,
      guide: false,
      pace,
      golden,
      intro: introDismissed,
      volume,
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
  navigation.cancel();
  pointerId = null;
  target = null;
  keyboard.reset();
  cursor.visible = false;
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
function closeDialog() {
  dialog.close();
  modalOpen = false;
  modalOpener?.focus();
}
function openDialog(content: string) {
  setControlsHidden(false);
  stop();
  modalOpener = document.activeElement as HTMLElement;
  modalOpen = true;
  document.querySelector("#dialog-content")!.innerHTML =
    `<button class="dialog-close round-button" aria-label="Close">${icon("close")}</button>${content}`;
  dialog.showModal();
  dialog.querySelector(".dialog-close")!.addEventListener("click", closeDialog);
}
function showHelp() {
  openDialog(
    `<div class="dialog-symbol">${brandMark}</div><div class="eyebrow">WELCOME TO WILLOWBROOK</div><h2 id="dialog-title">Make yourself<br><em>at home.</em></h2><p>There’s nothing to win and nowhere to fall behind. Just a little land to make your own.</p><div class="help-steps"><div>${icon("wander")}<span><strong>Find your way</strong>Tap where the work should finish. Drag to keep steering. Tap beside a finished row to face back down it and stop.<br>WASD or arrow keys follow the field rows. Tap a new direction to turn in place; hold to drive. Up follows the view, even when the window is narrow.</span></div><div>${icon("sow")}<span><strong>Make your mark</strong>Cultivate prepares soil and clears any crops. Sow wheat, sunflowers, or pumpkins, then harvest when they’re ready. A golden wheat patch is waiting beside your tractor. Harvests gather in pots and carts by the field.</span></div><div>${icon("feather")}<span><strong>Stay for a while</strong>Crops grow only while you’re here: sunflowers in 3 minutes, wheat in 6, pumpkins in 9. Nothing withers. Your meadow saves on this device.</span></div></div><p class="ipad-tip">On iPad, open in Safari and choose Share → Add to Home Screen for a little more room to roam.</p><button class="primary-button" id="help-done">A little time outside ${icon("arrow")}</button>`,
  );
  dialog.querySelector("#help-done")!.addEventListener("click", closeDialog);
}
function showSettings() {
  openDialog(
    `<div class="eyebrow">THE WAY YOU LIKE IT</div><h2 id="dialog-title">Settle <em>in.</em></h2><p>A few small comforts for your time outside.</p><div class="settings-list"><label class="setting-row"><span><strong>Golden light</strong><small>A warmer kind of afternoon.</small></span><input type="checkbox" id="golden-setting" ${golden ? "checked" : ""}><span class="switch"></span></label><label class="range-setting" for="pace-setting"><strong>Your pace</strong><input type="range" id="pace-setting" min="0.55" max="1.25" step="0.05" value="${pace}"><span><small>Unhurried</small><small>A little breezier</small></span></label><label class="range-setting" for="volume-setting"><strong>Nature sounds</strong><input type="range" id="volume-setting" min="0" max="1" step="0.05" value="${volume}"><span><small>A whisper</small><small>All around you</small></span></label></div><button class="reset-button" id="fresh">${icon("reset")} A fresh meadow</button><p class="settings-footnote">${storageAvailable ? "Your meadow is saved automatically on this device." : "Browser storage is unavailable. This meadow lasts for this visit."}</p>`,
  );
  dialog.querySelector("#golden-setting")!.addEventListener("change", (e) => {
    golden = (e.target as HTMLInputElement).checked;
    setLight();
    persist();
  });
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
function showReset() {
  openDialog(
    `<div class="dialog-symbol">${icon("sow")}</div><div class="eyebrow">BEGIN AGAIN, GENTLY</div><h2 id="dialog-title">A fresh <em>meadow.</em></h2><p>Return your paths, crops, and harvest displays to an empty meadow. A blank canvas for another quiet afternoon.</p><button class="primary-button" id="confirm-reset">Let it grow ${icon("sow")}</button><button class="text-button" id="cancel-reset">Keep my little corner</button>`,
  );
  dialog.querySelector("#confirm-reset")!.addEventListener("click", () => {
    field.reset();
    navigation = new TractorNavigation();
    tractorState = { ...defaultTractor };
    stop();
    persist();
    closeDialog();
    toast("A fresh start. Take your time.");
  });
  dialog.querySelector("#cancel-reset")!.addEventListener("click", closeDialog);
}
function pointerTarget(event: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    (-(event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
    keyboard.reset();
    target = {
      x: clamp(intersection.x, -39, 39),
      z: clamp(intersection.z, -30, 28),
    };
    navigation.choose(target, tractorState, selectedTool, world.obstacles);
    cursor.position.set(target.x, 0.09, target.z);
    cursor.visible = true;
    dismissIntro();
    scheduleControlsHide();
  }
}
let pointerId: number | null = null;
let pointerOrigin = { x: 0, y: 0 },
  pointerMoved = false;
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
  sceneContainer.setPointerCapture(e.pointerId);
  pointerTarget(e);
  sceneContainer.focus({ preventScroll: true });
});
sceneContainer.addEventListener("pointermove", (e) => {
  if (e.pointerId !== pointerId || paused || modalOpen) return;
  pointerMoved ||=
    Math.hypot(e.clientX - pointerOrigin.x, e.clientY - pointerOrigin.y) > 8;
  if (pointerMoved) pointerTarget(e);
});
sceneContainer.addEventListener("pointerup", (e) => {
  if (e.pointerId === pointerId) {
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
  if (isDriveKey(e.code)) {
    e.preventDefault();
    if (!paused && !e.repeat) {
      keyboard.press(e.code, keyboardDown);
      dismissIntro();
      scheduleControlsHide();
    }
  } else if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    setPaused(!paused);
  } else if (["1", "2", "3", "4"].includes(e.key)) {
    updateTool(
      (["cultivate", "sow", "harvest", "wander"] as Tool[])[Number(e.key) - 1],
    );
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
document.querySelector("#begin")!.addEventListener("click", () => {
  dismissIntro();
  sceneContainer.focus({ preventScroll: true });
  toast("Tap anywhere on the meadow. We’ll take the slow road.");
});
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
document.querySelector("#place")!.addEventListener("click", showHelp);
document.querySelector("#zoom-in")!.addEventListener("click", () => {
  zoom = clamp(zoom + 0.12, 0.7, 1.65);
  resize();
});
document.querySelector("#zoom-out")!.addEventListener("click", () => {
  zoom = clamp(zoom - 0.12, 0.7, 1.65);
  resize();
});
document.querySelector("#recenter")!.addEventListener("click", () => {
  zoom = 1;
  resize();
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) closeDialog();
});
dialog.addEventListener("cancel", () => {
  modalOpen = false;
});
setLight();
resize();
updateTool(selectedTool);
document.querySelector<HTMLElement>("#welcome")!.inert = introDismissed;
let changedSinceSave = false;
const attachment = tractor.group.getObjectByName("attachment")!;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
function animate(now: number) {
  requestAnimationFrame(animate);
  const activeSeconds = lastTime ? Math.max(0, (now - lastTime) / 1000) : 0;
  const dt = Math.min(activeSeconds, 0.05);
  lastTime = now;
  if (document.hidden) return;
  if (!paused && !modalOpen && windowActive) {
    time += dt;
    const growth = field.advance(activeSeconds);
    changedSinceSave ||= growth.advancedSeconds > 0;
    const gridInput = keyboard.input;
    const previousHeading = tractorState.heading;
    const movement = navigation.step(
      tractorState,
      dt,
      selectedTool,
      world.obstacles,
      pace,
      gridInput ? { grid: gridInput } : null,
    );
    tractorState = movement.state;
    changedSinceSave ||= tractorState.heading !== previousHeading;
    target = navigation.target;
    cursor.visible = target !== null;
    movement.paint.forEach((point, index, points) => {
      const event = field.paint(
        point.x,
        point.z,
        selectedTool,
        points[Math.max(0, index - 1)],
        selectedCrop,
      );
      changedSinceSave ||= event.groundChanges.length > 0;
      if (event.harvestResults.length)
        audio.harvest(event.harvestResults[0].crop);
    });
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
      ((navigation.turn || navigation.gridTurning ? 0.4 : 0) - attachment.position.y) *
      (1 - Math.exp(-8 * dt));
    world.update(reducedMotion ? 0 : time, reducedMotion ? 0 : dt);
    audio.setDriving(tractorState.speed / 6);
    cursor.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
    if (time - lastSave > 3 && changedSinceSave) {
      persist();
      changedSinceSave = false;
      lastSave = time;
    }
  }
  renderer.render(scene, camera);
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
      golden,
      hasDriven,
      controlsHidden,
      grid: Array.from(field.grid),
      farm: field.engine.snapshot(),
      crop: selectedCrop,
      drawCalls: renderer.info.render.calls,
      camera: {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      },
      target,
      turningAtRowEnd: !!navigation.turn,
      turningInPlace: navigation.gridTurning,
      workedRow: navigation.rows.last,
    }),
  });
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
