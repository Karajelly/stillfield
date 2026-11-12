import * as THREE from "three";
import { CROPS, CROP_NAMES, Ground } from "./farming";
import type { Crop } from "./farming";
import { overviewFraming } from "./overview";
import { FIELD } from "./simulation";

/**
 * A meadow postcard: a still picture of the farm exactly as it stands, on a
 * cream card with a line about what is growing. It is drawn on this device and
 * goes nowhere unless the player saves or shares it.
 */
export const POSTCARD_VIEWS = ["farm", "field"] as const;
export type PostcardView = (typeof POSTCARD_VIEWS)[number];

export const PHOTO = { width: 1800, height: 1200 };
const MARGIN = 66;
const CAPTION = 204;
export const POSTCARD_SIZE = {
  width: PHOTO.width + MARGIN * 2,
  height: PHOTO.height + MARGIN + CAPTION,
};

/** The whole farm as the game frames it, or a closer look down onto the field. */
export function postcardCamera(view: PostcardView): THREE.OrthographicCamera {
  const aspect = PHOTO.width / PHOTO.height;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  let vertical: number;
  if (view === "farm") {
    const framing = overviewFraming(aspect);
    camera.position.copy(framing.position);
    camera.lookAt(framing.focus);
    vertical = framing.vertical;
  } else {
    // Steep enough to read rows as a pattern, tilted enough to see the crops.
    const focus = new THREE.Vector3(
      (FIELD.minX + FIELD.maxX) / 2,
      0,
      (FIELD.minZ + FIELD.maxZ) / 2,
    );
    camera.position.copy(focus).add(new THREE.Vector3(0, 82, 44));
    camera.lookAt(focus);
    vertical = (FIELD.maxX - FIELD.minX + 4) / aspect;
  }
  camera.left = (-vertical * aspect) / 2;
  camera.right = (vertical * aspect) / 2;
  camera.top = vertical / 2;
  camera.bottom = -vertical / 2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** "Wheat and pumpkins in the field", from whatever is sown or grown. */
export function growingLine(
  cells: ArrayLike<number>,
  cropAt: (cell: number) => Crop | undefined,
): string {
  const present = new Set<Crop>();
  for (let i = 0; i < cells.length && present.size < CROPS.length; i++)
    if (cells[i] === Ground.growing || cells[i] === Ground.mature) {
      const crop = cropAt(i);
      if (crop) present.add(crop);
    }
  const names = CROPS.filter((crop) => present.has(crop)).map((crop, i) =>
    i ? CROP_NAMES[crop].toLowerCase() : CROP_NAMES[crop],
  );
  if (!names.length) return "A quiet meadow, resting";
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} in the field`;
}

/**
 * Render one still frame at postcard size through the game's own renderer, so
 * the picture gets the same light and tone as the screen. The canvas is read
 * straight after drawing and restored before the browser paints again.
 */
export function photograph(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): HTMLCanvasElement {
  const photo = document.createElement("canvas");
  photo.width = PHOTO.width;
  photo.height = PHOTO.height;
  const size = renderer.getSize(new THREE.Vector2()),
    ratio = renderer.getPixelRatio();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(PHOTO.width, PHOTO.height, false);
    renderer.render(scene, camera);
    photo.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
  } finally {
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.x, size.y, false);
  }
  return photo;
}

/** Lay the photograph on its card with a two-line caption and the wordmark. */
export function composePostcard(
  photo: CanvasImageSource,
  title: string,
  line: string,
): HTMLCanvasElement {
  const card = document.createElement("canvas");
  card.width = POSTCARD_SIZE.width;
  card.height = POSTCARD_SIZE.height;
  const ctx = card.getContext("2d")!;
  ctx.fillStyle = "#f7f5e9";
  ctx.fillRect(0, 0, card.width, card.height);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(MARGIN, MARGIN, PHOTO.width, PHOTO.height, 14);
  ctx.clip();
  ctx.drawImage(photo, MARGIN, MARGIN, PHOTO.width, PHOTO.height);
  ctx.restore();
  ctx.strokeStyle = "rgba(52, 76, 64, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(MARGIN, MARGIN, PHOTO.width, PHOTO.height, 14);
  ctx.stroke();

  const serif = '"Lora Variable", Georgia, serif',
    sans = '"DM Sans Variable", -apple-system, sans-serif',
    top = MARGIN + PHOTO.height;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#344c40";
  ctx.font = `italic 400 62px ${serif}`;
  ctx.fillText(title, MARGIN + 4, top + 96);
  ctx.fillStyle = "#7d8874";
  ctx.font = `400 30px ${sans}`;
  ctx.fillText(line, MARGIN + 6, top + 148);
  ctx.textAlign = "right";
  ctx.fillStyle = "#344c40";
  ctx.font = `500 72px ${serif}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-3.6px";
  ctx.fillText("stillfield", card.width - MARGIN - 2, top + 118);
  return card;
}

export const postcardBlob = (card: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => card.toBlob(resolve, "image/png"));
