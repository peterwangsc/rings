import * as THREE from "three";
import { WORLD_UP } from "./constants";

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
  return target.normalize();
}

export function getRightFromForward(
  forward: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  // RH basis: right = forward x up.
  target.crossVectors(forward, WORLD_UP);
  return target.normalize();
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
  return target.normalize();
}
