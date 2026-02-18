import * as THREE from "three";

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function getForwardFromYaw(
  yaw: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  // Right-handed world: yaw = 0 faces -Z, positive yaw rotates toward +X.
  target.set(Math.sin(yaw), 0, -Math.cos(yaw));
  return target;
}

export function getRightFromForward(
  forward: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  // RH basis with up=(0,1,0): right = (-forward.z, 0, forward.x).
  const rightX = -forward.z;
  const rightZ = forward.x;
  const planarLengthSquared = rightX * rightX + rightZ * rightZ;
  if (planarLengthSquared <= 1e-12) {
    target.set(1, 0, 0);
    return target;
  }
  const inversePlanarLength = 1 / Math.sqrt(planarLengthSquared);
  target.set(rightX * inversePlanarLength, 0, rightZ * inversePlanarLength);
  return target;
}

export function getLookDirection(
  yaw: number,
  pitch: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const cosPitch = Math.cos(pitch);
  target.set(
    Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
  );
  return target;
}
