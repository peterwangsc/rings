import {
  GOOMBA_CHARGE_DURATION_MS,
  GOOMBA_COOLDOWN_DURATION_MS,
  GOOMBA_ENRAGE_RADIUS,
  GOOMBA_PLAYER_HIT_RADIUS,
  GOOMBA_RUN_DURATION_MS,
  GOOMBA_RUN_SPEED,
  GOOMBA_STATE_CHARGE,
  GOOMBA_STATE_COOLDOWN,
  GOOMBA_STATE_DEFEATED,
  GOOMBA_STATE_ENRAGED,
  GOOMBA_STATE_IDLE,
  MAX_SPILL_RING_COUNT,
  RING_DROP_SOURCE_SPILL,
} from '../shared/constants';
import { hashStringToUint32, clampWorldAxis } from '../shared/mathUtils';
import { getChunkCoordFromWorld, getChunkKey } from '../shared/chunks';
import type {
  GoombaChunkSpawnStateRow,
  GoombaStateRow,
  PlayerInventoryRow,
  PlayerStateRow,
  RingDropStateRow,
} from '../shared/rows';
import { sampleTerrainHeight } from '../shared/terrain';
import { tickGoombaChunkSpawns } from './goombaChunkSpawns';
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
      insert(row: GoombaStateRow): void;
      delete(row: GoombaStateRow): boolean;
      goombaId: {
        find(goombaId: string): GoombaStateRow | null;
        update(row: GoombaStateRow): GoombaStateRow;
      };
    };
    goombaChunkSpawnState: {
      insert(row: GoombaChunkSpawnStateRow): void;
      chunkKey: {
        find(chunkKey: string): GoombaChunkSpawnStateRow | null;
        update(row: GoombaChunkSpawnStateRow): GoombaChunkSpawnStateRow;
      };
    };
    ringDropState: {
      insert(row: RingDropStateRow): void;
    };
  };
};

const GOOMBA_HIT_RADIUS_SQUARED = GOOMBA_PLAYER_HIT_RADIUS * GOOMBA_PLAYER_HIT_RADIUS;
const GOOMBA_TICK_MIN_INTERVAL_MS = 50;
const MAX_IDLE_ELAPSED_SECONDS = 30 * 60;
const IDLE_PATH_RADIUS_X_MIN = 1.8;
const IDLE_PATH_RADIUS_X_MAX = 3.0;
const IDLE_PATH_RADIUS_Z_MIN = 1.6;
const IDLE_PATH_RADIUS_Z_MAX = 2.8;
const IDLE_PATH_FREQUENCY_X_MIN = 0.4;
const IDLE_PATH_FREQUENCY_X_MAX = 0.65;
const IDLE_PATH_FREQUENCY_Z_MIN = 0.45;
const IDLE_PATH_FREQUENCY_Z_MAX = 0.7;
let lastGoombaTickAtMs = -Infinity;

type NearestPlayer = {
  player: PlayerStateRow;
  distanceSquared: number;
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
  const angleStep = (Math.PI * 2) / spillCount;
  for (let index = 0; index < spillCount; index += 1) {
    const angle = index * angleStep;
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
    ringCount: ringCount - spillCount,
    updatedAtMs: timestampMs,
  });
}

function findNearestPlayerWithinRadius(
  players: readonly PlayerStateRow[],
  x: number,
  z: number,
  radius: number,
): NearestPlayer | null {
  let nearest: PlayerStateRow | null = null;
  let nearestDistanceSquared = radius * radius;

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const dx = player.x - x;
    const dz = player.z - z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared > nearestDistanceSquared) {
      continue;
    }
    nearest = player;
    nearestDistanceSquared = distanceSquared;
  }

  return nearest ? { player: nearest, distanceSquared: nearestDistanceSquared } : null;
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
  if (dx * dx + dz * dz <= 1e-12) {
    return normalizeYaw(fallbackYaw);
  }
  return Math.atan2(dx, -dz);
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

function predictIdlePose(
  goomba: GoombaStateRow,
  toTimestampMs: number,
) {
  const elapsedSeconds = Math.max(
    0,
    Math.min((toTimestampMs - goomba.updatedAtMs) / 1000, MAX_IDLE_ELAPSED_SECONDS),
  );
  const { amplitudeX, amplitudeZ, frequencyX, frequencyZ } = toIdlePathParams(
    goomba.goombaId,
  );
  const phaseX = elapsedSeconds * frequencyX;
  const phaseZ = elapsedSeconds * frequencyZ;

  const x = clampWorldAxis(goomba.x + Math.sin(phaseX) * amplitudeX);
  const z = clampWorldAxis(goomba.z + Math.sin(phaseZ) * amplitudeZ);
  const y = sampleTerrainHeight(x, z);
  const vx = Math.cos(phaseX) * amplitudeX * frequencyX;
  const vz = Math.cos(phaseZ) * amplitudeZ * frequencyZ;
  let yaw = goomba.yaw;
  if (vx * vx + vz * vz > 1e-9) {
    yaw = Math.atan2(vx, -vz);
  }
  return { x, y, z, yaw: normalizeYaw(yaw) };
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

function maybeReleaseChunkSlot(
  ctx: GoombaTickContext,
  goomba: GoombaStateRow,
  timestampMs: number,
) {
  const chunk = getChunkCoordFromWorld(goomba.spawnX, goomba.spawnZ);
  const chunkKey = getChunkKey(chunk.x, chunk.z);
  const spawnState = ctx.db.goombaChunkSpawnState.chunkKey.find(chunkKey);
  if (!spawnState || spawnState.activeGoombaId !== goomba.goombaId) {
    return;
  }

  ctx.db.goombaChunkSpawnState.chunkKey.update({
    ...spawnState,
    activeGoombaId: undefined,
    updatedAtMs: timestampMs,
  });
}

function hasGoombaChanged(previous: GoombaStateRow, next: GoombaStateRow) {
  return (
    previous.spawnX !== next.spawnX ||
    previous.spawnY !== next.spawnY ||
    previous.spawnZ !== next.spawnZ ||
    previous.x !== next.x ||
    previous.y !== next.y ||
    previous.z !== next.z ||
    previous.yaw !== next.yaw ||
    previous.state !== next.state ||
    previous.targetIdentity !== next.targetIdentity ||
    previous.stateEndsAtMs !== next.stateEndsAtMs ||
    previous.nextChargeAllowedAtMs !== next.nextChargeAllowedAtMs ||
    previous.respawnAtMs !== next.respawnAtMs
  );
}

function maybeUpdateGoomba(
  ctx: GoombaTickContext,
  previous: GoombaStateRow,
  next: GoombaStateRow,
  timestampMs: number,
) {
  if (!hasGoombaChanged(previous, next)) {
    return;
  }

  ctx.db.goombaState.goombaId.update({
    ...next,
    updatedAtMs: timestampMs,
  });
}

export function tickGoombas(ctx: GoombaTickContext, timestampMs: number) {
  if (timestampMs - lastGoombaTickAtMs < GOOMBA_TICK_MIN_INTERVAL_MS) {
    return;
  }
  lastGoombaTickAtMs = timestampMs;

  const activeChunks = tickGoombaChunkSpawns(ctx, timestampMs);
  let players: PlayerStateRow[] | null = null;
  const getPlayers = () => {
    if (!players) {
      players = Array.from(ctx.db.playerState.iter());
    }
    return players;
  };
  for (const goomba of ctx.db.goombaState.iter()) {
    const next: GoombaStateRow = {
      ...goomba,
      state: sanitizeGoombaState(goomba.state),
    };

    const spawnChunk = getChunkCoordFromWorld(next.spawnX, next.spawnZ);
    const spawnChunkKey = getChunkKey(spawnChunk.x, spawnChunk.z);

    if (next.state === GOOMBA_STATE_DEFEATED) {
      if (next.respawnAtMs !== undefined && timestampMs >= next.respawnAtMs) {
        maybeReleaseChunkSlot(ctx, goomba, timestampMs);
        ctx.db.goombaState.delete(goomba);
        continue;
      }
      maybeUpdateGoomba(ctx, goomba, next, timestampMs);
      continue;
    }

    if (!activeChunks.has(spawnChunkKey)) {
      maybeReleaseChunkSlot(ctx, goomba, timestampMs);
      ctx.db.goombaState.delete(goomba);
      continue;
    }

    const dtSeconds = Math.max(
      0,
      Math.min((timestampMs - goomba.updatedAtMs) / 1000, 0.2),
    );

    let idlePose: ReturnType<typeof predictIdlePose> | null = null;
    let proximityX = next.x;
    let proximityZ = next.z;
    if (next.state === GOOMBA_STATE_IDLE) {
      idlePose = predictIdlePose(next, timestampMs);
      proximityX = idlePose.x;
      proximityZ = idlePose.z;
    }

    const nearbyTarget = findNearestPlayerWithinRadius(
      getPlayers(),
      proximityX,
      proximityZ,
      GOOMBA_ENRAGE_RADIUS,
    );

    if (!nearbyTarget) {
      if (next.state !== GOOMBA_STATE_IDLE) {
        setIdleState(next);
        maybeUpdateGoomba(ctx, goomba, next, timestampMs);
      }
      continue;
    }

    if (next.state === GOOMBA_STATE_IDLE) {
      if (idlePose) {
        next.x = idlePose.x;
        next.y = idlePose.y;
        next.z = idlePose.z;
        next.yaw = idlePose.yaw;
      }
      setChargeState(next, timestampMs, nearbyTarget.player);
      maybeUpdateGoomba(ctx, goomba, next, timestampMs);
      continue;
    }

    if (next.state === GOOMBA_STATE_COOLDOWN) {
      next.targetIdentity = nearbyTarget.player.identity;
      if (timestampMs < next.stateEndsAtMs) {
        maybeUpdateGoomba(ctx, goomba, next, timestampMs);
        continue;
      }
      setChargeState(next, timestampMs, nearbyTarget.player);
      maybeUpdateGoomba(ctx, goomba, next, timestampMs);
      continue;
    }

    if (next.state === GOOMBA_STATE_CHARGE) {
      next.targetIdentity = nearbyTarget.player.identity;
      if (timestampMs < next.stateEndsAtMs) {
        maybeUpdateGoomba(ctx, goomba, next, timestampMs);
        continue;
      }
      startEnragedRun(next, timestampMs, nearbyTarget.player);
    }

    if (next.state !== GOOMBA_STATE_ENRAGED) {
      startEnragedRun(next, timestampMs, nearbyTarget.player);
    }

    if (timestampMs >= next.stateEndsAtMs) {
      setCooldownState(next, timestampMs, nearbyTarget.player);
      maybeUpdateGoomba(ctx, goomba, next, timestampMs);
      continue;
    }

    stepGoombaForward(next, GOOMBA_RUN_SPEED, dtSeconds);

    if (nearbyTarget.distanceSquared <= GOOMBA_HIT_RADIUS_SQUARED) {
      spillPlayerRings(
        ctx,
        nearbyTarget.player.identity,
        nearbyTarget.player.x,
        nearbyTarget.player.z,
        timestampMs,
      );
      setCooldownState(next, timestampMs, nearbyTarget.player);
    }

    maybeUpdateGoomba(ctx, goomba, next, timestampMs);
  }
}
