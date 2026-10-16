import * as THREE from "three";
import "./lab.css";
import { createWorld } from "../src/world";
import { createTractor } from "../src/tractor";
import { overviewFraming } from "../src/overview";
import { angleDifference, clamp, FIELD } from "../src/simulation";
import type { Point, Tool, TractorState } from "../src/simulation";
import { createField } from "./field";
import { baseline, FollowCamera, followFov, GentleDrive, projectGround, tuning } from "./handling";
import { attachmentPoint, WorkDestination } from "./work-destination";
import { alignmentForTap, EndTurn, WorkedRows } from "./row-end";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div id="scene" tabindex="0" aria-label="Handling sandbox. Tap or drag the farm to drive."></div>
  <header><div class="identity"><span class="eyebrow">STILLFIELD / PRIVATE EXPERIMENT</span><h1>A gentler way around.</h1></div>
    <div class="switches"><div class="segmented" aria-label="Handling"><button data-profile="current" aria-pressed="false">Current</button><button data-profile="gentle" aria-pressed="true">Proposed</button></div>
    <div class="segmented" aria-label="Camera"><button data-view="iso" aria-pressed="false">Isometric</button><button data-view="follow" aria-pressed="true">Third person</button></div></div>
  </header>
  <aside id="study"><div class="eyebrow">TRY THE DIFFERENCE</div>
    <p id="description"></p>
    <label class="reference">Comparison <select id="reference"><option value="native">Native logic · browser replay</option><option value="web">Web logic · isometric only</option></select></label>
    <div class="study-actions"><button id="turn-demo">Replay turn & release</button><button id="endpoint-demo">Work through the far square</button></div>
    <p class="study-note" id="study-note">Use the same gesture in both versions. Switching starts a fresh sandbox meadow.</p>
    <p id="endpoint-result" role="status" aria-live="polite" hidden></p>
    <div class="telemetry"><span>Travel<strong id="speed">0.0 m/s</strong></span><span>Turning<strong id="turn">0°/s</strong></span><span>After release<strong id="release">—</strong></span></div>
    <div class="fine">Isolated experiment. No saves or production changes. Third person replays the native camera and movement; this checkout’s web app has only isometric view.</div>
  </aside>
  <button id="study-toggle" aria-expanded="true" aria-controls="study">Hide comparison notes</button>
  <div id="gesture" hidden><span id="gesture-dot"></span></div>
  <footer><div class="tools" aria-label="Tools"><button data-tool="mow" aria-pressed="true">Mow</button><button data-tool="till" aria-pressed="false">Till</button><button data-tool="sow" aria-pressed="false">Sow</button><button data-tool="wander" aria-pressed="false">Wander</button></div>
    <p id="hint"></p><div class="utilities"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="stop">Stop</button><button id="reset">Start fresh</button></div>
  </footer>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(id)!;
const surface = el<HTMLDivElement>("#scene");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
surface.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#e8ecda");
scene.fog = new THREE.Fog("#e8ecda", 125, 230);
scene.add(new THREE.HemisphereLight("#fff8df", "#7c9060", 2.5));
const sun = new THREE.DirectionalLight("#fff1ce", 3.1);
sun.position.set(-32, 55, 22); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 });
sun.shadow.normalBias = 0.04; sun.shadow.bias = -0.0003; sun.shadow.radius = 3;
scene.add(sun);
const world = createWorld(scene);
const field = createField(scene, Array.from({ length: Math.round((FIELD.maxX - FIELD.minX) / FIELD.cell) * Math.round((FIELD.maxZ - FIELD.minZ) / FIELD.cell) }, () => 0));
const tractor = createTractor(scene);
const iso = new THREE.OrthographicCamera(-55, 55, 35, -35, 0.1, 300);
const follow = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
const boom = new FollowCamera(), drive = new GentleDrive();
const cursor = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 40), new THREE.MeshBasicMaterial({ color: "#fff8e6", depthWrite: false, transparent: true, opacity: 0.85 }));
cursor.rotation.x = -Math.PI / 2; cursor.visible = false; scene.add(cursor);
const endpointOutline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-0.125, 0.12, -0.125), new THREE.Vector3(0.125, 0.12, -0.125),
  new THREE.Vector3(0.125, 0.12, 0.125), new THREE.Vector3(-0.125, 0.12, 0.125),
]), new THREE.LineBasicMaterial({ color: "#fff8e6", depthTest: false }));
endpointOutline.visible = false; scene.add(endpointOutline);

let profile: "current" | "gentle" = "gentle";
let reference: "native" | "web" = "native";
let view: "iso" | "follow" = "follow";
let tool: Tool = "mow", zoom = 1;
const start = (): TractorState => ({ x: -15, z: -7, heading: Math.PI / 2, speed: 0 });
let state = start(), target: Point | null = null, lastBrush: Point | null = null;
let workDestination: WorkDestination | null = null, endpointStudy: WorkDestination | null = null;
let paintEnabled = true;
let workedRows = new WorkedRows(), endTurn: EndTurn | null = null;
let aligningAtEnd = false;
const attachment = tractor.group.getObjectByName("attachment")!;
let time = 0, lastTime = performance.now(), lastPaint = 0, blockedTime = 0;
let turnRate = 0, releaseTurn: number | null = null, releaseAnchor: number | null = null;
let sampleTime = 0, demo: { start: number; released: boolean; nextEvent: number } | null = null;
type Gesture = { id: number; x: number; y: number; lastX: number; lastY: number; start: number; moved: boolean; driving: boolean };
let gesture: Gesture | null = null;
const keys = new Set<string>();

function camera() { return view === "iso" ? iso : follow; }
function updateCamera(dt = 0) {
  if (view === "follow") {
    const pose = boom.update(state, dt, world.obstacles, profile === "gentle", 0.65 * zoom);
    follow.position.copy(pose.position); follow.lookAt(pose.focus); follow.updateMatrixWorld();
  }
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  const frame = overviewFraming(aspect);
  iso.position.copy(frame.position); iso.lookAt(frame.focus);
  iso.left = -frame.vertical * aspect / 2; iso.right = -iso.left;
  iso.top = frame.vertical / 2; iso.bottom = -iso.top; iso.zoom = 1.35 * zoom;
  iso.updateProjectionMatrix(); iso.updateMatrixWorld();
  follow.aspect = aspect; follow.fov = followFov(aspect); follow.updateProjectionMatrix();
  updateCamera();
}
function syncUI() {
  document.querySelectorAll<HTMLButtonElement>("[data-profile]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.profile === profile)));
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  el<HTMLSelectElement>("#reference").value = reference;
  el("#description").textContent = view === "follow"
    ? profile === "gentle" ? "A quiet center, gradual turns, and a short coast when you let go. A quick tap still chooses a destination."
      : "Each drag event picks ground through the moving camera. Lifting leaves the last destination active."
    : profile === "gentle" ? "Point where the work should finish. A tap beside a finished row lines you up facing back, then stops."
      : "Familiar destination steering. Row help straightens headings; it does not space adjacent passes.";
  el("#hint").textContent = view === "follow" && profile === "gentle"
    ? "Hold to roll · move left or right to turn · return to center for straight · lift to settle"
    : profile === "gentle" && tool !== "wander"
      ? "Tap where the work should finish · the marker stays on your chosen square"
      : "Tap a destination or drag across the meadow · lift to continue to that destination";
  if (profile === "gentle" && view === "follow")
    el("#description").textContent = "Hold and steer gently; lift to coast. Tap beside a finished row to face back down it and stop at your spot.";
  if (profile === "gentle" && tool === "wander")
    el("#description").textContent = "Wander leaves the field as it is. A ground tap marks where the tractor should stop.";
}
function stop() {
  gesture = null; target = null; workDestination = null; endTurn = null; aligningAtEnd = false; keys.clear(); demo = null; cursor.visible = false;
  el("#gesture").hidden = true; drive.reset();
}
function reset() {
  stop(); state = start(); field.reset(); lastBrush = null;
  boom.reset(); blockedTime = 0; releaseTurn = null; releaseAnchor = null;
  endpointStudy = null; endpointOutline.visible = false; paintEnabled = true;
  workedRows = new WorkedRows();
  el("#endpoint-result").hidden = true;
  el("#study-note").textContent = "Use the same gesture in both versions. Switching starts a fresh sandbox meadow.";
  updateCamera();
}
function chooseDestination(point: Point) {
  endTurn = null; aligningAtEnd = false;
  const alignment = profile === "gentle" && tool !== "wander"
    ? alignmentForTap(workedRows.last, state, point, world.obstacles) : null;
  target = { ...point }; paintEnabled = true;
  workDestination = profile === "gentle" ? WorkDestination.create(point, state, tool) : null;
  if (alignment && workDestination) {
    endTurn = new EndTurn(state, alignment); aligningAtEnd = true; paintEnabled = false; lastBrush = null;
  }
  cursor.position.set(point.x, 0.1, point.z); cursor.visible = true;
  if (workDestination) {
    el("#endpoint-result").hidden = false;
    el("#endpoint-result").textContent = endTurn ? "Turning to face back down your row…" : "Working toward your square…";
  }
}
function setTarget(x: number, y: number) {
  const hit = projectGround(camera(), x / innerWidth, y / innerHeight);
  if (!hit) return;
  chooseDestination(hit);
}
function pointerStart(x: number, y: number, id: number) {
  gesture = { id, x, y, lastX: x, lastY: y, start: time, moved: false, driving: false };
  releaseTurn = null; releaseAnchor = null;
  workDestination = null; endTurn = null; aligningAtEnd = false; paintEnabled = true;
  endpointStudy = null; endpointOutline.visible = false; el("#endpoint-result").hidden = true;
  if (profile === "gentle" && view === "follow") { target = null; cursor.visible = false; }
  else setTarget(x, y);
}
function pointerMove(x: number, y: number) {
  if (!gesture) return;
  gesture.lastX = x; gesture.lastY = y;
  gesture.moved ||= Math.hypot(x - gesture.x, y - gesture.y) > 8;
  if (profile === "gentle" && view === "follow") gesture.driving ||= gesture.moved;
  else if (profile === "current" || gesture.moved) setTarget(x, y);
}
function pointerEnd() {
  if (!gesture) return;
  const releasedSteering = gesture.driving || gesture.moved;
  if (profile === "gentle" && view === "follow") {
    if (!gesture.driving && !gesture.moved) setTarget(gesture.lastX, gesture.lastY);
    else { target = null; workDestination = null; cursor.visible = false; }
    drive.reset();
  }
  releaseAnchor = releasedSteering ? state.heading : null;
  releaseTurn = releasedSteering ? 0 : null; gesture = null;
  el("#gesture").hidden = true;
}
surface.addEventListener("pointerdown", e => {
  if (gesture || e.button !== 0 || !e.isPrimary) return;
  demo = null; pointerStart(e.clientX, e.clientY, e.pointerId);
  surface.setPointerCapture(e.pointerId); surface.focus({ preventScroll: true });
});
surface.addEventListener("pointermove", e => { if (gesture?.id === e.pointerId) pointerMove(e.clientX, e.clientY); });
surface.addEventListener("pointerup", e => { if (gesture?.id === e.pointerId) pointerEnd(); });
surface.addEventListener("pointercancel", () => stop());
surface.addEventListener("contextmenu", e => e.preventDefault());
window.addEventListener("blur", () => { stop(); state.speed = 0; });
document.addEventListener("visibilitychange", () => { if (document.hidden) { stop(); state.speed = 0; } });
window.addEventListener("resize", () => { stop(); resize(); });
window.addEventListener("keydown", e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(e.key)) {
    e.preventDefault(); keys.add(e.key.toLowerCase()); target = null; workDestination = null; endTurn = null; aligningAtEnd = false; paintEnabled = true;
  }
  if (e.code === "Space" || e.key === "Escape") { e.preventDefault(); stop(); }
});
window.addEventListener("keyup", e => { keys.delete(e.key.toLowerCase()); if (!keys.size) { target = null; cursor.visible = false; } });

document.querySelectorAll<HTMLButtonElement>("[data-profile]").forEach(b => b.onclick = () => { profile = b.dataset.profile as typeof profile; reset(); syncUI(); });
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b => b.onclick = () => {
  view = b.dataset.view as typeof view; if (view === "follow") reference = "native";
  reset(); resize(); syncUI();
});
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(b => b.onclick = () => {
  lastBrush = null; tool = b.dataset.tool as Tool; tractor.setTool(tool);
  if (target) {
    // Working tools share the same approach. Keep an in-progress arrival aligned.
    if (!aligningAtEnd || tool === "wander") chooseDestination(target);
  }
  else { endpointStudy = null; endpointOutline.visible = false; el("#endpoint-result").hidden = true; }
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  syncUI();
});
el<HTMLSelectElement>("#reference").onchange = e => {
  reference = (e.target as HTMLSelectElement).value as typeof reference;
  if (reference === "web") view = "iso";
  reset(); resize(); syncUI();
};
el("#reset").onclick = reset;
el("#stop").onclick = stop;
el("#zoom-in").onclick = () => { zoom = clamp(zoom + 0.2, 0.75, 2); resize(); };
el("#zoom-out").onclick = () => { zoom = clamp(zoom - 0.2, 0.75, 2); resize(); };
el("#study-toggle").onclick = () => {
  const hidden = el("#study").hidden = !el("#study").hidden;
  el("#study-toggle").textContent = hidden ? "Show comparison notes" : "Hide comparison notes";
  el("#study-toggle").setAttribute("aria-expanded", String(!hidden));
};
el("#turn-demo").onclick = () => {
  view = "follow"; reference = "native"; reset(); resize(); syncUI();
  demo = { start: time, released: false, nextEvent: 0 };
  pointerStart(innerWidth * 0.5, innerHeight * 0.45, -1);
  el("#study-note").textContent = "Script: drag right, hold with ±2 px tremor, then lift at 1.5 s. Watch the turn after release. Run once in each version.";
};
el("#endpoint-demo").onclick = () => {
  reset();
  state = { x: 5, z: 0.125, heading: Math.PI / 2, speed: 0 };
  const point = { x: FIELD.maxX - FIELD.cell / 2, z: 0.125 };
  chooseDestination(point);
  endpointStudy = WorkDestination.create(point, state, "mow");
  endpointOutline.position.set(point.x, 0, point.z); endpointOutline.visible = true;
  el("#endpoint-result").hidden = false;
  el("#endpoint-result").textContent = "Travelling to the far square…";
  el("#study-note").textContent = "A real drive to the last square at the meadow's edge. The outline stays on that square. Compare Current and Proposed in either view, with any tool.";
  boom.reset(); updateCamera();
};

function paint() {
  const point = attachmentPoint(state);
  if (profile === "gentle" && lastBrush) {
    const length = Math.hypot(point.x - lastBrush.x, point.z - lastBrush.z);
    const steps = Math.max(1, Math.ceil(length / 0.12));
    for (let i = 1; i <= steps; i++) field.paint(lastBrush.x + (point.x - lastBrush.x) * i / steps, lastBrush.z + (point.z - lastBrush.z) * i / steps, tool, tuning.brushRadius);
  } else field.paint(point.x, point.z, tool, profile === "gentle" ? tuning.brushRadius : 1.15);
  lastBrush = point;
}

function finishWork() {
  // Flush the actual attachment sweep, including a point already under the tool.
  paint(); lastPaint = time; paintEnabled = false; lastBrush = null;
  if (workDestination) workedRows.finish(workDestination.point, state);
  el("#endpoint-result").textContent = aligningAtEnd
    ? "Worked your spot. Facing down the row and settling here." : "Selected square worked. Settling gently.";
  aligningAtEnd = false;
  target = null; workDestination = null; cursor.visible = false;
}

function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = clamp((now - lastTime) / 1000, 0, 0.05); lastTime = now;
  if (document.hidden) return;
  time += dt;
  if (demo) {
    const elapsed = time - demo.start;
    if (elapsed < 1.5 && elapsed >= demo.nextEvent) {
      const dx = Math.min(1, elapsed / 0.35) * 85 + Math.sin(elapsed * 31) * 2;
      pointerMove(innerWidth * 0.5 + dx, innerHeight * 0.45 + Math.sin(elapsed * 27) * 2);
      demo.nextEvent += 1 / 30;
    } else if (elapsed >= 1.5 && !demo.released) { pointerEnd(); demo.released = true; }
    if (elapsed > 5) demo = null;
  }
  if (gesture && profile === "gentle" && view === "follow" && time - gesture.start > 0.22) gesture.driving = true;
  if (gesture?.driving && profile === "gentle" && view === "follow") {
    el("#gesture").hidden = false;
    el("#gesture").style.left = `${gesture.x}px`; el("#gesture").style.top = `${gesture.y}px`;
    el("#gesture-dot").style.transform = `translateX(${clamp(gesture.lastX - gesture.x, -110, 110)}px)`;
  }
  const previous = state;
  if (!endTurn && workDestination?.covered(state)) finishWork();
  const workPlan = !endTurn ? workDestination?.plan(state) : undefined;
  let movementTarget = workPlan?.target ?? target;
  if (keys.size && !(profile === "gentle" && view === "follow")) {
    let sx = Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a"));
    let sy = Number(keys.has("arrowdown") || keys.has("s")) - Number(keys.has("arrowup") || keys.has("w"));
    const right = new THREE.Vector3().setFromMatrixColumn(camera().matrixWorld, 0);
    const down = new THREE.Vector3().setFromMatrixColumn(camera().matrixWorld, 2).setY(0).normalize();
    const direction = right.multiplyScalar(sx).addScaledVector(down, sy).normalize();
    movementTarget = sx || sy ? { x: state.x + direction.x * 12, z: state.z + direction.z * 12 } : null;
  }
  if (endTurn) {
    state = endTurn.step(state, dt, world.obstacles);
    if (endTurn.blocked) {
      stop(); el("#endpoint-result").textContent = "There isn't room to turn here. Choose another spot.";
    } else if (endTurn.done) {
      workDestination?.setArrivalHeading(endTurn.alignment.heading);
      endTurn = null; paintEnabled = true; lastBrush = null;
      el("#endpoint-result").textContent = "Finishing the spot you clicked, then stopping here…";
    }
  } else if (profile === "gentle" && view === "follow") {
    let input: { drag: number } | { target: Point } | null = gesture?.driving ? { drag: gesture.lastX - gesture.x } : movementTarget ? { target: movementTarget } : null;
    if (keys.size) input = { drag: 110 * (Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a"))) };
    state = drive.step(state, dt, input, world.obstacles, workPlan?.paceScale ?? 1);
  } else state = baseline(reference, state, movementTarget, dt, world.obstacles, profile === "current", workPlan?.paceScale ?? 1);
  workedRows.sample(state, paintEnabled && tool !== "wander" && state.speed > 0.1);
  if (!endTurn && target && workPlan?.paceScale !== 0 && Math.hypot(state.x - previous.x, state.z - previous.z) < 0.003 && state.speed < 0.15
    && Math.abs(angleDifference(state.heading, previous.heading)) < dt * 0.1) {
    blockedTime += dt; if (blockedTime > 1) {
      if (workDestination) el("#endpoint-result").textContent = "That square needs a different approach.";
      target = null; workDestination = null; cursor.visible = false;
    }
  } else blockedTime = 0;
  if (!endTurn && workDestination?.covered(state)) {
    finishWork();
  } else if (!workDestination && movementTarget && target && Math.hypot(movementTarget.x - state.x, movementTarget.z - state.z) < 0.5) {
    target = null; cursor.visible = false;
  }
  turnRate = dt ? angleDifference(state.heading, previous.heading) / dt * 180 / Math.PI : 0;
  if (releaseAnchor !== null) releaseTurn = (releaseTurn ?? 0) + Math.abs(angleDifference(state.heading, previous.heading)) * 180 / Math.PI;
  if (paintEnabled && state.speed > 0.1 && time - lastPaint >= 1 / 24) { paint(); lastPaint = time; }
  if (state.speed === 0) lastBrush = null;
  tractor.group.position.set(state.x, 0, state.z); tractor.group.rotation.y = state.heading;
  tractor.update(state.speed, dt, time);
  attachment.position.y += ((endTurn ? 0.4 : 0) - attachment.position.y) * (1 - Math.exp(-8 * dt));
  world.update(time, dt); updateCamera(dt);
  if (time - sampleTime > 0.1) {
    el("#speed").textContent = `${state.speed.toFixed(1)} m/s`;
    el("#turn").textContent = `${Math.abs(turnRate).toFixed(0)}°/s`;
    el("#release").textContent = releaseTurn === null ? "—" : `${releaseTurn.toFixed(1)}°`;
    if (endpointStudy && !target && state.speed === 0) {
      el("#endpoint-result").textContent = tool === "wander" ? "Wander: tractor stopped at the point. No field work."
        : field.grid[endpointStudy.cell] === ({ mow: 1, till: 2, sow: 3 } as const)[tool]
          ? "The selected square is worked. Tractor settled beyond it."
          : "Tractor stopped; the selected square is still untouched.";
    }
    sampleTime = time;
  }
  renderer.render(scene, camera());
}
resize(); syncUI(); tractor.setTool(tool); requestAnimationFrame(tick);
Object.defineProperty(window, "__HANDLING_LAB__", { get: () => ({ profile, reference, view, tool, state: { ...state }, target,
  workPoint: workDestination?.point ?? null, endpointCell: endpointStudy?.cell ?? null,
  endpointValue: endpointStudy ? field.grid[endpointStudy.cell] : null,
  turnRate, releaseTurn, endTurn: !!endTurn, workedRow: workedRows.last, painted: field.grid.filter(x => x !== 0).length }) });
