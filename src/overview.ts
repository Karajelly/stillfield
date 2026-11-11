import * as THREE from "three";
import { FAR_FIELD, FIELD } from "./simulation";

const HOME_FOCUS = new THREE.Vector3(-1, 0, -2);
/** Foxglove field is framed exactly like the home field, just further west. */
const FAR_FOCUS = HOME_FOCUS.clone().add(new THREE.Vector3(
  (FAR_FIELD.minX + FAR_FIELD.maxX - FIELD.minX - FIELD.maxX) / 2, 0,
  (FAR_FIELD.minZ + FAR_FIELD.maxZ - FIELD.minZ - FIELD.maxZ) / 2,
));

/**
 * Keep in sync with StillfieldCore/OverviewCamera.swift. `blend` slides the
 * same composition from the home field (0) to Foxglove field (1). The camera's
 * angle never changes, so rotating the device or riding the lane never changes
 * which way is "up" for the keyboard. Where a screen is too narrow for the
 * larger field (portrait phones), the view eases back while riding the lane.
 */
export function overviewFraming(aspect: number, blend = 0) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const amount = THREE.MathUtils.clamp((1 - safeAspect) / 0.2, 0, 1);
  const portrait = amount * amount * (3 - 2 * amount);
  const shift = Number.isFinite(blend) ? THREE.MathUtils.clamp(blend, 0, 1) : 0;
  const focus = HOME_FOCUS.clone().lerp(FAR_FOCUS, shift);
  // Look along the meadow in portrait: the barn, paths and pond unfold vertically.
  // The oblique angle keeps the windmill sails and the sides of the barn visible.
  const position = focus.clone().add(new THREE.Vector3(60, 73, 89).lerp(
    new THREE.Vector3(84, 94, 38), portrait,
  ));
  const landscapeHeight = safeAspect < 1.35 ? 76 : 66;
  const base = THREE.MathUtils.lerp(
    landscapeHeight, Math.max(90, 54 / safeAspect), portrait,
  );
  // Foxglove field is twice the home field. Pull back only as far as this
  // screen needs to show all of it, so the tractor stays as large as it can.
  const vertical = THREE.MathUtils.lerp(
    base, Math.max(base, fitHeight(position.clone().sub(focus), safeAspect)), shift,
  );
  return { position, focus, vertical };
}

/** The view height that fits Foxglove field, leaving room for the controls. */
function fitHeight(offset: THREE.Vector3, aspect: number) {
  const forward = offset.clone().negate().normalize();
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const up = right.clone().cross(forward);
  let height = 0;
  for (const x of [FAR_FIELD.minX, FAR_FIELD.maxX])
    for (const z of [FAR_FIELD.minZ, FAR_FIELD.maxZ]) {
      const corner = new THREE.Vector3(x, 0, z).sub(FAR_FOCUS);
      height = Math.max(
        height,
        (2 * Math.abs(corner.dot(up))) / 0.6,
        (2 * Math.abs(corner.dot(right))) / (0.85 * aspect),
      );
    }
  return height;
}
