import * as THREE from "three";

/** Keep in sync with StillfieldCore/OverviewCamera.swift. */
export function overviewFraming(aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const amount = THREE.MathUtils.clamp((1 - safeAspect) / 0.2, 0, 1);
  const portrait = amount * amount * (3 - 2 * amount);
  const focus = new THREE.Vector3(-1, 0, -2);
  // Look along the meadow in portrait: the barn, paths and pond unfold vertically.
  // The oblique angle keeps the windmill sails and the sides of the barn visible.
  const position = new THREE.Vector3(59, 73, 87).lerp(
    focus.clone().add(new THREE.Vector3(84, 94, 38)), portrait,
  );
  const landscapeHeight = safeAspect < 1.35 ? 76 : 66;
  const vertical = THREE.MathUtils.lerp(
    landscapeHeight, Math.max(90, 54 / safeAspect), portrait,
  );
  return { position, focus, vertical };
}
