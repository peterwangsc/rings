import type { GoombaState } from "../../multiplayer/state/multiplayerTypes";
import { sampleTerrainHeight } from "../../utils/terrain";

const MAX_WORLD_ABS = 1000;
const MAX_IDLE_ELAPSED_SECONDS = 30 * 60;
const IDLE_PATH_RADIUS_X_MIN = 1.8;
const IDLE_PATH_RADIUS_X_MAX = 3.0;
const IDLE_PATH_RADIUS_Z_MIN = 1.6;
const IDLE_PATH_RADIUS_Z_MAX = 2.8;
const IDLE_PATH_FREQUENCY_X_MIN = 0.4;
const IDLE_PATH_FREQUENCY_X_MAX = 0.65;
const IDLE_PATH_FREQUENCY_Z_MIN = 0.45;
const IDLE_PATH_FREQUENCY_Z_MAX = 0.7;

export type GoombaPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

function clampWorldAxis(value: number) {
  return Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, value));
}

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeYaw(yaw: number) {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

function toIdlePathParams(goombaId: string) {
  const seed = hashStringToUint32(goombaId) || 1;
  const n0 = (seed & 0xff) / 255;
  const n1 = ((seed >>> 8) & 0xff) / 255;
  const n2 = ((seed >>> 16) & 0xff) / 255;
  const n3 = ((seed >>> 24) & 0xff) / 255;
  return {
    amplitudeX:
      IDLE_PATH_RADIUS_X_MIN +
      (IDLE_PATH_RADIUS_X_MAX - IDLE_PATH_RADIUS_X_MIN) * n0,
    amplitudeZ:
      IDLE_PATH_RADIUS_Z_MIN +
      (IDLE_PATH_RADIUS_Z_MAX - IDLE_PATH_RADIUS_Z_MIN) * n1,
    frequencyX:
      IDLE_PATH_FREQUENCY_X_MIN +
      (IDLE_PATH_FREQUENCY_X_MAX - IDLE_PATH_FREQUENCY_X_MIN) * n2,
    frequencyZ:
      IDLE_PATH_FREQUENCY_Z_MIN +
      (IDLE_PATH_FREQUENCY_Z_MAX - IDLE_PATH_FREQUENCY_Z_MIN) * n3,
  };
}

export function writePredictedGoombaPose(
  goomba: GoombaState,
  estimatedServerNowMs: number,
  out: GoombaPose,
) {
  out.x = goomba.x;
  out.y = goomba.y;
  out.z = goomba.z;
  out.yaw = goomba.yaw;

  if (goomba.state !== "idle") {
    return out;
  }

  const elapsedSeconds = Math.max(
    0,
    Math.min(
      (estimatedServerNowMs - goomba.updatedAtMs) / 1000,
      MAX_IDLE_ELAPSED_SECONDS,
    ),
  );
  const { amplitudeX, amplitudeZ, frequencyX, frequencyZ } = toIdlePathParams(
    goomba.goombaId,
  );
  const phaseX = elapsedSeconds * frequencyX;
  const phaseZ = elapsedSeconds * frequencyZ;
  out.x = clampWorldAxis(goomba.x + Math.sin(phaseX) * amplitudeX);
  out.z = clampWorldAxis(goomba.z + Math.sin(phaseZ) * amplitudeZ);
  out.y = sampleTerrainHeight(out.x, out.z);
  const vx = Math.cos(phaseX) * amplitudeX * frequencyX;
  const vz = Math.cos(phaseZ) * amplitudeZ * frequencyZ;
  if (vx * vx + vz * vz > 1e-9) {
    out.yaw = normalizeYaw(Math.atan2(vx, -vz));
  }

  return out;
}
