import {
  GOOMBA_CHARGE_DURATION_MS,
  GOOMBA_COOLDOWN_DURATION_MS,
  GOOMBA_ENRAGE_RADIUS,
  GOOMBA_IDLE_LEASH_RADIUS,
  GOOMBA_IDLE_WALK_SPEED,
  GOOMBA_IDLE_WANDER_MAX_DURATION_MS,
  GOOMBA_IDLE_WANDER_MIN_DURATION_MS,
  GOOMBA_PLAYER_HIT_RADIUS,
  GOOMBA_RUN_DURATION_MS,
  GOOMBA_RUN_SPEED,
  GOOMBA_STATE_CHARGE,
  GOOMBA_STATE_COOLDOWN,
  GOOMBA_STATE_DEFEATED,
  GOOMBA_STATE_ENRAGED,
  GOOMBA_STATE_IDLE,
  MAX_WORLD_ABS,
  MAX_SPILL_RING_COUNT,
  RING_DROP_SOURCE_SPILL,
} from '../shared/constants';
import type {
  GoombaStateRow,
  PlayerInventoryRow,
  PlayerStateRow,
  RingDropStateRow,
} from '../shared/rows';
import { sampleTerrainHeight } from '../shared/terrain';
import { insertDropRing } from './ringDrops';
import {
  normalizeRingCount,
  sanitizeGoombaState,
} from '../validation/reducerValidation';
import {
  stepPlanarControllerMovement,
  toPlanarControllerInput,
} from './movementController';

type GoombaTickContext = {
  newUuidV4(): { toString(): string };
  db: {
    playerState: {
      identity: {
        find(identity: string): PlayerStateRow | null;
      };
      iter(): IteratorObject<PlayerStateRow, undefined>;
    };
    playerInventory: {
      identity: {
        find(identity: string): PlayerInventoryRow | null;
        update(row: PlayerInventoryRow): PlayerInventoryRow;
      };
    };
    goombaState: {
      iter(): IteratorObject<GoombaStateRow, undefined>;
      goombaId: {
        update(row: GoombaStateRow): GoombaStateRow;
      };
    };
    ringDropState: {
      insert(row: RingDropStateRow): void;
    };
  };
};

const RANDOM_UINT32_MAX = 4_294_967_295;
const IDLE_RETURN_HOME_JITTER_RADIANS = 0.35;

type NearestPlayer = {
  player: PlayerStateRow;
};

type RandomCursor = {
  state: number;
};

function spillPlayerRings(
  ctx: GoombaTickContext,
  identity: string,
  x: number,
  z: number,
  timestampMs: number,
) {
  const inventory = ctx.db.playerInventory.identity.find(identity);
  if (!inventory) {
    return;
  }
  const ringCount = normalizeRingCount(inventory.ringCount);
  if (ringCount <= 0) {
    return;
  }

  const spillCount = Math.min(MAX_SPILL_RING_COUNT, ringCount);
  for (let index = 0; index < spillCount; index += 1) {
    const angle = (index / Math.max(1, spillCount)) * Math.PI * 2;
    const radius = 1.35 + (index % 4) * 0.65;
    insertDropRing(
      ctx,
      timestampMs,
      RING_DROP_SOURCE_SPILL,
      x + Math.cos(angle) * radius,
      z + Math.sin(angle) * radius,
    );
  }

  ctx.db.playerInventory.identity.update({
    ...inventory,
    ringCount: 0,
    updatedAtMs: timestampMs,
  });
}

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toRandomSeed(seed: number, goombaId: string) {
  if (Number.isFinite(seed)) {
    const normalized = Math.floor(seed) >>> 0;
    if (normalized !== 0) {
      return normalized;
    }
  }
  return hashStringToUint32(goombaId) || 1;
}

function sampleRandom(cursor: RandomCursor) {
  const next = (Math.imul(cursor.state, 1664525) + 1013904223) >>> 0;
  cursor.state = next || 1;
  return cursor.state / RANDOM_UINT32_MAX;
}

function findNearestPlayerWithinRadius(
  ctx: GoombaTickContext,
  x: number,
  z: number,
  radius: number,
): NearestPlayer | null {
  let nearest: PlayerStateRow | null = null;
  let nearestDistance = radius;

  for (const player of ctx.db.playerState.iter()) {
    const dx = player.x - x;
    const dz = player.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance > nearestDistance) {
      continue;
    }
    nearest = player;
    nearestDistance = distance;
  }

  return nearest ? { player: nearest } : null;
}

function clampWorldAxis(value: number) {
  return Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, value));
}

function normalizeYaw(yaw: number) {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

function yawToTarget(
  fromX: number,
  fromZ: number,
  targetX: number,
  targetZ: number,
  fallbackYaw: number,
) {
  const dx = targetX - fromX;
  const dz = targetZ - fromZ;
  if (Math.hypot(dx, dz) <= 1e-6) {
    return normalizeYaw(fallbackYaw);
  }
  return Math.atan2(dx, -dz);
}

function randomDurationMs(cursor: RandomCursor) {
  return Math.round(
    GOOMBA_IDLE_WANDER_MIN_DURATION_MS +
      (GOOMBA_IDLE_WANDER_MAX_DURATION_MS - GOOMBA_IDLE_WANDER_MIN_DURATION_MS) *
        sampleRandom(cursor),
  );
}

function startIdleWanderSegment(
  goomba: GoombaStateRow,
  timestampMs: number,
  cursor: RandomCursor,
) {
  const toSpawnX = goomba.spawnX - goomba.x;
  const toSpawnZ = goomba.spawnZ - goomba.z;
  const distanceFromSpawn = Math.hypot(toSpawnX, toSpawnZ);

  if (distanceFromSpawn > GOOMBA_IDLE_LEASH_RADIUS) {
    const towardSpawnYaw = Math.atan2(toSpawnX, -toSpawnZ);
    const jitter =
      (sampleRandom(cursor) * 2 - 1) * IDLE_RETURN_HOME_JITTER_RADIANS;
    goomba.yaw = normalizeYaw(towardSpawnYaw + jitter);
  } else {
    goomba.yaw = normalizeYaw(sampleRandom(cursor) * Math.PI * 2);
  }

  goomba.stateEndsAtMs = timestampMs + randomDurationMs(cursor);
}

function stepGoombaForward(
  goomba: GoombaStateRow,
  speed: number,
  deltaSeconds: number,
) {
  if (deltaSeconds <= 0 || speed <= 0) {
    return;
  }

  const nextPose = stepPlanarControllerMovement(
    {
      x: goomba.x,
      z: goomba.z,
      yaw: goomba.yaw,
    },
    toPlanarControllerInput({
      forward: true,
      backward: false,
      left: false,
      right: false,
      lookYaw: goomba.yaw,
      moveSpeed: speed,
    }),
    deltaSeconds,
  );

  goomba.x = clampWorldAxis(nextPose.x);
  goomba.z = clampWorldAxis(nextPose.z);
  goomba.yaw = nextPose.yaw;
  goomba.y = sampleTerrainHeight(goomba.x, goomba.z);
}

function setIdleState(goomba: GoombaStateRow) {
  goomba.state = GOOMBA_STATE_IDLE;
  goomba.targetIdentity = undefined;
  goomba.stateEndsAtMs = 0;
}

function setChargeState(
  goomba: GoombaStateRow,
  timestampMs: number,
  target: PlayerStateRow,
) {
  goomba.state = GOOMBA_STATE_CHARGE;
  goomba.targetIdentity = target.identity;
  goomba.yaw = yawToTarget(goomba.x, goomba.z, target.x, target.z, goomba.yaw);
  goomba.stateEndsAtMs = timestampMs + GOOMBA_CHARGE_DURATION_MS;
}

function setCooldownState(
  goomba: GoombaStateRow,
  timestampMs: number,
  target: PlayerStateRow,
) {
  goomba.state = GOOMBA_STATE_COOLDOWN;
  goomba.targetIdentity = target.identity;
  goomba.yaw = yawToTarget(goomba.x, goomba.z, target.x, target.z, goomba.yaw);
  goomba.stateEndsAtMs = timestampMs + GOOMBA_COOLDOWN_DURATION_MS;
}

function startEnragedRun(
  goomba: GoombaStateRow,
  timestampMs: number,
  target: PlayerStateRow,
) {
  goomba.state = GOOMBA_STATE_ENRAGED;
  goomba.targetIdentity = target.identity;
  goomba.yaw = yawToTarget(goomba.x, goomba.z, target.x, target.z, goomba.yaw);
  goomba.stateEndsAtMs = timestampMs + GOOMBA_RUN_DURATION_MS;
}

function maybeHitNearbyPlayer(
  ctx: GoombaTickContext,
  goomba: GoombaStateRow,
  timestampMs: number,
) {
  const nearby = findNearestPlayerWithinRadius(
    ctx,
    goomba.x,
    goomba.z,
    GOOMBA_PLAYER_HIT_RADIUS,
  );
  if (!nearby) {
    return false;
  }

  spillPlayerRings(
    ctx,
    nearby.player.identity,
    nearby.player.x,
    nearby.player.z,
    timestampMs,
  );
  return true;
}

export function tickGoombas(ctx: GoombaTickContext, timestampMs: number) {
  for (const goomba of ctx.db.goombaState.iter()) {
    const next: GoombaStateRow = {
      ...goomba,
      state: sanitizeGoombaState(goomba.state),
      updatedAtMs: timestampMs,
    };
    const randomCursor: RandomCursor = {
      // Reuse legacy cooldown storage as deterministic RNG state.
      state: toRandomSeed(next.nextChargeAllowedAtMs, next.goombaId),
    };
    const dtSeconds = Math.max(
      0,
      Math.min((timestampMs - goomba.updatedAtMs) / 1000, 0.2),
    );

    if (next.state === GOOMBA_STATE_DEFEATED) {
      if (next.respawnAtMs !== undefined && timestampMs >= next.respawnAtMs) {
        next.x = next.spawnX;
        next.y = next.spawnY;
        next.z = next.spawnZ;
        setIdleState(next);
        next.respawnAtMs = undefined;
        startIdleWanderSegment(next, timestampMs, randomCursor);
      }
      next.nextChargeAllowedAtMs = randomCursor.state;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    const nearbyTarget = findNearestPlayerWithinRadius(
      ctx,
      next.x,
      next.z,
      GOOMBA_ENRAGE_RADIUS,
    );

    if (!nearbyTarget) {
      if (next.state !== GOOMBA_STATE_IDLE) {
        setIdleState(next);
      }
      if (timestampMs >= next.stateEndsAtMs) {
        startIdleWanderSegment(next, timestampMs, randomCursor);
      }
      stepGoombaForward(next, GOOMBA_IDLE_WALK_SPEED, dtSeconds);
      next.nextChargeAllowedAtMs = randomCursor.state;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (next.state === GOOMBA_STATE_IDLE) {
      setChargeState(next, timestampMs, nearbyTarget.player);
      next.nextChargeAllowedAtMs = randomCursor.state;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (next.state === GOOMBA_STATE_COOLDOWN) {
      next.targetIdentity = nearbyTarget.player.identity;
      if (timestampMs < next.stateEndsAtMs) {
        next.nextChargeAllowedAtMs = randomCursor.state;
        ctx.db.goombaState.goombaId.update(next);
        continue;
      }
      setChargeState(next, timestampMs, nearbyTarget.player);
      next.nextChargeAllowedAtMs = randomCursor.state;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (next.state === GOOMBA_STATE_CHARGE) {
      next.targetIdentity = nearbyTarget.player.identity;
      if (timestampMs < next.stateEndsAtMs) {
        next.nextChargeAllowedAtMs = randomCursor.state;
        ctx.db.goombaState.goombaId.update(next);
        continue;
      }
      startEnragedRun(next, timestampMs, nearbyTarget.player);
    }

    if (next.state !== GOOMBA_STATE_ENRAGED) {
      startEnragedRun(next, timestampMs, nearbyTarget.player);
    }

    if (timestampMs >= next.stateEndsAtMs) {
      setCooldownState(next, timestampMs, nearbyTarget.player);
      next.nextChargeAllowedAtMs = randomCursor.state;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    stepGoombaForward(next, GOOMBA_RUN_SPEED, dtSeconds);

    if (maybeHitNearbyPlayer(ctx, next, timestampMs)) {
      setCooldownState(next, timestampMs, nearbyTarget.player);
    }

    next.nextChargeAllowedAtMs = randomCursor.state;
    ctx.db.goombaState.goombaId.update(next);
  }
}
