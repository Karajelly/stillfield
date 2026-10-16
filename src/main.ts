import * as THREE from "three";
import "./style.css";
import { createWorld } from "./world";
import { createField } from "./field";
import { createTractor } from "./tractor";
import { FarmAudio } from "./audio";
import { advanceTractor, clamp, FIELD } from "./simulation";
import type { Point, Tool, TractorState } from "./simulation";
import { icon, brandMark } from "./icons";

interface Save {
  version: 1;
  grid: number[];
  tractor: TractorState;
  tool: Tool;
  guide: boolean;
  pace: number;
  golden: boolean;
  intro: boolean;
  volume: number;
}
let saved: Partial<Save> = {};
try {
  const data = JSON.parse(localStorage.getItem("stillfield-v1") || "null");
  if (data?.version === 1) saved = data;
} catch {
  /* A private meadow works even without browser storage. */
}
const tools: Tool[] = ["mow", "till", "sow", "wander"];
let selectedTool: Tool = tools.includes(saved.tool!) ? saved.tool! : "mow";
let guide = saved.guide ?? true,
  pace = typeof saved.pace === "number" ? clamp(saved.pace, 0.55, 1.25) : 0.85,
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
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="farm-app">
    <div id="scene" aria-label="Your pastoral farm. Tap or drag the meadow to drive, or use arrow keys." role="application" tabindex="0"></div>
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
      <h1>A good day<br>to take it <em>slow.</em></h1>
      <p>A little fresh air. A few tidy rows.<br>Nothing you need to finish.</p>
      <button class="welcome-button" id="begin">Let’s wander ${icon("arrow")}</button>
    </section>
    <div class="field-note" id="field-note"><span class="note-line"></span><span>THE MEADOW<small>Room to do your own thing.</small></span></div>
    <div class="world-label" id="windmill-label"><span></span>Windmill hill</div>
    <div class="world-label" id="pond-label"><span></span>The quiet pond</div>
    <div id="destination" aria-hidden="true"><span></span></div>
    <section class="bottom-center menu-panel" id="tool-controls" aria-label="Tractor tools">
      <nav class="tool-dock" aria-label="Choose your tool">${[
        ["mow", "Mow", "Trim the meadow"],
        ["till", "Till", "Turn the earth"],
        ["sow", "Sow", "Plant wildflowers"],
        ["wander", "Wander", "Just enjoy the ride"],
      ]
        .map(
          ([id, name, desc], i) =>
            `<button class="tool-button ${id === selectedTool ? "selected" : ""}" data-tool="${id}" aria-pressed="${id === selectedTool}" title="${desc} (${i + 1})"><span class="tool-illustration ${id}">${icon(id)}</span><span>${name}</span><kbd>${i + 1}</kbd></button>`,
        )
        .join("")}</nav>
      <div class="drive-hint" id="drive-hint"><span class="hint-desktop"><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> to drive <span class="hint-dot">·</span></span> tap or drag to find your way</div>
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
const controlsToggle = document.querySelector<HTMLButtonElement>("#controls-toggle")!;
let controlsHidden = false;
let controlsHideTimer: number | undefined;

function cancelControlsHide() {
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = undefined;
}
function setControlsHidden(hidden: boolean) {
  cancelControlsHide();
  const moveFocus = hidden && Array.from(menuPanels).some((panel) =>
    panel.contains(document.activeElement),
  );
  controlsHidden = hidden;
  document.querySelector(".farm-app")!.classList.toggle("controls-hidden", hidden);
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
controlsToggle.addEventListener("click", () => setControlsHidden(!controlsHidden));
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
camera.position.set(59, 73, 87);
camera.lookAt(-1, 0, -2);
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
const field = createField(scene, saved.grid);
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
  lastPaint = 0,
  lastSave = 0,
  hasDriven = false;
const keys = new Set<string>();
function updateTool(tool: Tool) {
  selectedTool = tool;
  tractor.setTool(tool);
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    const active = b.dataset.tool === tool;
    b.classList.toggle("selected", active);
    b.setAttribute("aria-pressed", String(active));
  });
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
  let vertical = aspect < 1 ? 94 : aspect < 1.35 ? 76 : 66;
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
      version: 1,
      grid: Array.from(field.grid),
      tractor: { ...tractorState, speed: 0 },
      tool: selectedTool,
      guide,
      pace,
      golden,
      intro: introDismissed,
      volume,
    };
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
  target = null;
  keys.clear();
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
    `<div class="dialog-symbol">${brandMark}</div><div class="eyebrow">WELCOME TO WILLOWBROOK</div><h2 id="dialog-title">Make yourself<br><em>at home.</em></h2><p>There’s nothing to win and nowhere to fall behind. Just a little land to make your own.</p><div class="help-steps"><div>${icon("wander")}<span><strong>Find your way</strong>Tap a spot to drive there. Drag to keep steering.<br>Arrow keys or WASD work, too.</span></div><div>${icon("sow")}<span><strong>Make your mark</strong>Mow soft paths, till tidy rows, or sow wildflowers. Switch tools whenever you like.</span></div><div>${icon("feather")}<span><strong>Stay for a while</strong>Your meadow saves on this device. Pause with the space bar. Nothing changes while you’re away.</span></div></div><p class="ipad-tip">On iPad, open in Safari and choose Share → Add to Home Screen for a little more room to roam.</p><button class="primary-button" id="help-done">A little time outside ${icon("arrow")}</button>`,
  );
  dialog.querySelector("#help-done")!.addEventListener("click", closeDialog);
}
function showSettings() {
  openDialog(
    `<div class="eyebrow">THE WAY YOU LIKE IT</div><h2 id="dialog-title">Settle <em>in.</em></h2><p>A few small comforts for your time outside.</p><div class="settings-list"><label class="setting-row"><span><strong>A helping hand</strong><small>Gently straighten near-perfect rows.</small></span><input type="checkbox" id="guide-setting" ${guide ? "checked" : ""}><span class="switch"></span></label><label class="setting-row"><span><strong>Golden light</strong><small>A warmer kind of afternoon.</small></span><input type="checkbox" id="golden-setting" ${golden ? "checked" : ""}><span class="switch"></span></label><label class="range-setting" for="pace-setting"><strong>Your pace</strong><input type="range" id="pace-setting" min="0.55" max="1.25" step="0.05" value="${pace}"><span><small>Unhurried</small><small>A little breezier</small></span></label><label class="range-setting" for="volume-setting"><strong>Nature sounds</strong><input type="range" id="volume-setting" min="0" max="1" step="0.05" value="${volume}"><span><small>A whisper</small><small>All around you</small></span></label></div><button class="reset-button" id="fresh">${icon("reset")} A fresh meadow</button><p class="settings-footnote">${storageAvailable ? "Your meadow is saved automatically on this device." : "Browser storage is unavailable. This meadow lasts for this visit."}</p>`,
  );
  dialog.querySelector("#guide-setting")!.addEventListener("change", (e) => {
    guide = (e.target as HTMLInputElement).checked;
    persist();
  });
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
    `<div class="dialog-symbol">${icon("sow")}</div><div class="eyebrow">BEGIN AGAIN, GENTLY</div><h2 id="dialog-title">A fresh <em>meadow.</em></h2><p>Let the grass grow back over your paths and flowers. A blank canvas for another quiet afternoon.</p><button class="primary-button" id="confirm-reset">Let it grow ${icon("sow")}</button><button class="text-button" id="cancel-reset">Keep my little corner</button>`,
  );
  dialog.querySelector("#confirm-reset")!.addEventListener("click", () => {
    field.reset();
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
    target = {
      x: clamp(intersection.x, -39, 39),
      z: clamp(intersection.z, -30, 28),
    };
    cursor.position.set(target.x, 0.09, target.z);
    cursor.visible = true;
    dismissIntro();
    scheduleControlsHide();
  }
}
let pointerId: number | null = null;
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
  sceneContainer.setPointerCapture(e.pointerId);
  pointerTarget(e);
  sceneContainer.focus({ preventScroll: true });
});
sceneContainer.addEventListener("pointermove", (e) => {
  if (e.pointerId === pointerId && !paused && !modalOpen) pointerTarget(e);
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
sceneContainer.addEventListener("contextmenu", (e) => e.preventDefault());
const driveKeys = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "w",
  "a",
  "s",
  "d",
  "W",
  "A",
  "S",
  "D",
];
window.addEventListener("keydown", (e) => {
  if (modalOpen || e.target instanceof HTMLInputElement) return;
  if (driveKeys.includes(e.key)) {
    e.preventDefault();
    if (!paused) {
      keys.add(e.key.toLowerCase());
      dismissIntro();
      scheduleControlsHide();
    }
  } else if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    setPaused(!paused);
  } else if (["1", "2", "3", "4"].includes(e.key)) {
    updateTool(tools[Number(e.key) - 1]);
  } else if (e.key.toLowerCase() === "m" && hasDriven && !paused && !e.repeat) {
    e.preventDefault();
    setControlsHidden(!controlsHidden);
  } else if (e.key === "Escape") {
    if (!paused) setPaused(true);
    else setPaused(false);
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
  if (driveKeys.includes(e.key) && keys.size === 0) {
    target = null;
    cursor.visible = false;
  }
});
window.addEventListener("blur", () => {
  cancelControlsHide();
  stop();
  persist();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelControlsHide();
    stop();
    persist();
    if (soundEnabled) void audio.setEnabled(false);
  } else {
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
let changedSinceSave = false,
  blockedTime = 0;
const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000 || 0, 0.05);
  lastTime = now;
  if (document.hidden) return;
  if (!paused && !modalOpen) {
    time += dt;
    if (keys.size) {
      let sx = 0,
        sy = 0;
      if (keys.has("arrowup") || keys.has("w")) sy -= 1;
      if (keys.has("arrowdown") || keys.has("s")) sy += 1;
      if (keys.has("arrowleft") || keys.has("a")) sx -= 1;
      if (keys.has("arrowright") || keys.has("d")) sx += 1;
      if (sx || sy) {
        const angle = Math.atan2(sx * 0.83 + sy * 0.56, -sx * 0.56 + sy * 0.83);
        target = {
          x: tractorState.x + Math.sin(angle) * 12,
          z: tractorState.z + Math.cos(angle) * 12,
        };
        cursor.visible = false;
      } else {
        target = null;
      }
    }
    const beforeMove = { x: tractorState.x, z: tractorState.z };
    tractorState = advanceTractor(
      tractorState,
      target,
      dt,
      world.obstacles,
      guide,
      pace,
    );
    if (
      target &&
      Math.hypot(tractorState.x - beforeMove.x, tractorState.z - beforeMove.z) <
        0.003 &&
      tractorState.speed < 0.15
    ) {
      blockedTime += dt;
      if (blockedTime > 1) {
        target = null;
        cursor.visible = false;
      }
    } else blockedTime = 0;
    if (
      target &&
      Math.hypot(target.x - tractorState.x, target.z - tractorState.z) < 0.5
    ) {
      target = null;
      cursor.visible = false;
    }
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
      if (time - lastPaint > 1 / 24) {
        field.paint(
          tractorState.x - Math.sin(tractorState.heading) * 2.1,
          tractorState.z - Math.cos(tractorState.heading) * 2.1,
          selectedTool,
        );
        lastPaint = time;
      }
    }
    tractor.group.position.set(tractorState.x, 0, tractorState.z);
    tractor.group.rotation.y = tractorState.heading;
    tractor.update(tractorState.speed, dt, time);
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
      guide,
      pace,
      golden,
      hasDriven,
      controlsHidden,
      grid: Array.from(field.grid),
      drawCalls: renderer.info.render.calls,
      camera: {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
      },
      target,
    }),
  });
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
