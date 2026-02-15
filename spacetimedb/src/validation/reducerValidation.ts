import {
  FIREBALL_MAX_DIR_LENGTH,
  FIREBALL_MAX_SPAWN_DISTANCE,
  FIREBALL_MIN_DIR_LENGTH,
  FIREBALL_MIN_SPAWN_DISTANCE,
  GOOMBA_STATE_CHARGE,
  GOOMBA_STATE_COOLDOWN,
  GOOMBA_STATE_DEFEATED,
  GOOMBA_STATE_ENRAGED,
  GOOMBA_STATE_IDLE,
  MAX_RING_COUNT,
  MOTION_STATES,
  type GoombaStateTag,
  type MotionState,
} from '../shared/constants';
import { getIdentitySeededGuestDisplayName } from '../shared/guestDisplayNames';

export function isFiniteNumber(value: number) {
  return Number.isFinite(value) && !Number.isNaN(value);
}

export function hasInvalidNumericPayload(values: readonly number[]) {
  return values.some((value) => !isFiniteNumber(value));
}

export function sanitizeMotionState(motionState: string): MotionState {
  return MOTION_STATES.has(motionState as MotionState)
    ? (motionState as MotionState)
    : 'idle';
}

export function sanitizeDisplayName(displayName: string, identity: string) {
  const trimmed = displayName.trim().slice(0, 24);
  if (trimmed.length > 0) {
    return trimmed;
  }
  return getIdentitySeededGuestDisplayName(identity);
}

export function sanitizeGoombaState(state: string): GoombaStateTag {
  switch (state) {
    case GOOMBA_STATE_IDLE:
      return GOOMBA_STATE_IDLE;
    case GOOMBA_STATE_CHARGE:
      return GOOMBA_STATE_CHARGE;
    case GOOMBA_STATE_ENRAGED:
      return GOOMBA_STATE_ENRAGED;
    case GOOMBA_STATE_COOLDOWN:
      return GOOMBA_STATE_COOLDOWN;
    case GOOMBA_STATE_DEFEATED:
      return GOOMBA_STATE_DEFEATED;
    default:
      return GOOMBA_STATE_IDLE;
  }
}

export function normalizeRingCount(value: number) {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_RING_COUNT, Math.floor(value)));
}

export function isValidFireballDirectionLength(directionLength: number) {
  return (
    directionLength >= FIREBALL_MIN_DIR_LENGTH &&
    directionLength <= FIREBALL_MAX_DIR_LENGTH
  );
}

export function isValidFireballSpawnDistance(spawnDistance: number) {
  return (
    spawnDistance >= FIREBALL_MIN_SPAWN_DISTANCE &&
    spawnDistance <= FIREBALL_MAX_SPAWN_DISTANCE
  );
}
