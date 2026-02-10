import * as THREE from "three";
import {
  CAMERA_LOOK_SENSITIVITY,
  LOOK_TARGET_DISTANCE,
  MAX_PITCH,
  MIN_PITCH,
  MOUSE_PITCH_SIGN,
  MOUSE_YAW_SIGN,
  THIRD_PERSON_CAMERA_DISTANCE,
  THIRD_PERSON_CAMERA_SMOOTHNESS,
  THIRD_PERSON_PIVOT_HEIGHT_OFFSET,
} from "../utils/constants";
import { normalizeAngle } from "../utils/math";

interface LookAngles {
  readonly yaw: number;
  readonly pitch: number;
}

export function updateLookAngles(
  yaw: number,
  pitch: number,
  movementX: number,
  movementY: number,
): LookAngles {
  const nextYaw = normalizeAngle(
    yaw + movementX * CAMERA_LOOK_SENSITIVITY * MOUSE_YAW_SIGN,
  );
  const nextPitch = THREE.MathUtils.clamp(
    pitch + -movementY * CAMERA_LOOK_SENSITIVITY * MOUSE_PITCH_SIGN,
    MIN_PITCH,
    MAX_PITCH,
  );

  return { yaw: nextYaw, pitch: nextPitch };
}

export function applyFirstPersonCamera(
  camera: THREE.Camera,
  focusPosition: THREE.Vector3,
  lookDirection: THREE.Vector3,
  lookTarget: THREE.Vector3,
): void {
  camera.position.copy(focusPosition);
  lookTarget
    .copy(camera.position)
    .addScaledVector(lookDirection, LOOK_TARGET_DISTANCE);
  camera.lookAt(lookTarget);
}

export function applyThirdPersonCamera(
  camera: THREE.Camera,
  orbitOriginPosition: THREE.Vector3,
  lookDirection: THREE.Vector3,
  deltaSeconds: number,
  cameraPivot: THREE.Vector3,
  desiredCameraPosition: THREE.Vector3,
  lookTarget: THREE.Vector3,
  cameraDistance = THIRD_PERSON_CAMERA_DISTANCE,
): void {
  cameraPivot.set(
    orbitOriginPosition.x,
    orbitOriginPosition.y + THIRD_PERSON_PIVOT_HEIGHT_OFFSET,
    orbitOriginPosition.z,
  );

  desiredCameraPosition
    .copy(cameraPivot)
    .addScaledVector(lookDirection, -cameraDistance);

  const cameraBlend = 1 - Math.exp(-THIRD_PERSON_CAMERA_SMOOTHNESS * deltaSeconds);
  camera.position.lerp(desiredCameraPosition, cameraBlend);

  lookTarget
    .copy(cameraPivot)
    .addScaledVector(lookDirection, LOOK_TARGET_DISTANCE);
  camera.lookAt(lookTarget);
}
