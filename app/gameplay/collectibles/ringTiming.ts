import {
  RING_DROP_FALL_DURATION_MS,
  RING_DROP_FALL_START_HEIGHT,
  RING_DROP_LIFETIME_MS,
} from "../../utils/constants";

const DROP_RING_COLLECT_READY_PROGRESS = 0.97;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function getDropRingAgeMs(spawnedAtMs: number, nowMs: number) {
  return Math.max(0, nowMs - spawnedAtMs);
}

export function getDropRingFallProgress(spawnedAtMs: number, nowMs: number) {
  return clamp01(getDropRingAgeMs(spawnedAtMs, nowMs) / RING_DROP_FALL_DURATION_MS);
}

export function getDropRingFallOffset(spawnedAtMs: number, nowMs: number) {
  const fallProgress = getDropRingFallProgress(spawnedAtMs, nowMs);
  return (1 - fallProgress * fallProgress) * RING_DROP_FALL_START_HEIGHT;
}

export function isDropRingExpired(spawnedAtMs: number, nowMs: number) {
  return getDropRingAgeMs(spawnedAtMs, nowMs) >= RING_DROP_LIFETIME_MS;
}

export function isDropRingCollectible(spawnedAtMs: number, nowMs: number) {
  return (
    !isDropRingExpired(spawnedAtMs, nowMs) &&
    getDropRingFallProgress(spawnedAtMs, nowMs) >= DROP_RING_COLLECT_READY_PROGRESS
  );
}
