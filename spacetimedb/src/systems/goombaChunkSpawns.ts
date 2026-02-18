import {
  GOOMBA_CHUNK_ACTIVE_RADIUS,
  GOOMBA_CHUNK_HASH_SEED,
  GOOMBA_CHUNK_SPAWN_COOLDOWN_MS,
  GOOMBA_CHUNK_SPAWN_MARGIN,
  GOOMBA_CHUNK_SPAWN_THRESHOLD,
  GOOMBA_DISABLE_ORIGIN_CHUNK_SPAWN,
  GOOMBA_STATE_IDLE,
  MAX_WORLD_ABS,
  TERRAIN_CHUNK_SIZE,
} from '../shared/constants';
import {
  chunkHashN,
  getChunkCenterWorld,
  getChunkCoordFromWorld,
  getChunkKey,
  type ChunkCoord,
  iterateChunksAround,
} from '../shared/chunks';
import type {
  GoombaChunkSpawnStateRow,
  GoombaStateRow,
  PlayerStateRow,
} from '../shared/rows';
import { sampleTerrainHeight } from '../shared/terrain';

type GoombaChunkSpawnTickContext = {
  db: {
    playerState: {
      iter(): IteratorObject<PlayerStateRow, undefined>;
    };
    goombaState: {
      insert(row: GoombaStateRow): void;
      goombaId: {
        find(goombaId: string): GoombaStateRow | null;
      };
    };
    goombaChunkSpawnState: {
      insert(row: GoombaChunkSpawnStateRow): void;
      chunkKey: {
        find(chunkKey: string): GoombaChunkSpawnStateRow | null;
        update(row: GoombaChunkSpawnStateRow): GoombaChunkSpawnStateRow;
      };
    };
  };
};

const TWO_PI = Math.PI * 2;
const SPAWN_X_SALT = 37.91;
const SPAWN_Z_SALT = 53.27;
const SPAWN_YAW_SALT = 71.13;

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampWorldAxis(value: number) {
  return Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, value));
}

function isChunkEligible(chunkX: number, chunkZ: number) {
  if (GOOMBA_DISABLE_ORIGIN_CHUNK_SPAWN && chunkX === 0 && chunkZ === 0) {
    return false;
  }
  const spawnChance = chunkHashN(chunkX, chunkZ, 0, GOOMBA_CHUNK_HASH_SEED);
  return spawnChance >= GOOMBA_CHUNK_SPAWN_THRESHOLD;
}

function collectActiveChunks(ctx: GoombaChunkSpawnTickContext) {
  const chunks = new Map<string, ChunkCoord>();
  for (const player of ctx.db.playerState.iter()) {
    const center = getChunkCoordFromWorld(player.x, player.z);
    for (const chunk of iterateChunksAround(
      center.x,
      center.z,
      GOOMBA_CHUNK_ACTIVE_RADIUS,
    )) {
      chunks.set(getChunkKey(chunk.x, chunk.z), chunk);
    }
  }
  return chunks;
}

function sampleSpawnPosition(chunkX: number, chunkZ: number, spawnSequence: number) {
  const availableSpan = Math.max(
    0,
    TERRAIN_CHUNK_SIZE - GOOMBA_CHUNK_SPAWN_MARGIN * 2,
  );
  const centerX = getChunkCenterWorld(chunkX);
  const centerZ = getChunkCenterWorld(chunkZ);
  const offsetX =
    (chunkHashN(chunkX, chunkZ, spawnSequence, SPAWN_X_SALT) - 0.5) *
    availableSpan;
  const offsetZ =
    (chunkHashN(chunkX, chunkZ, spawnSequence, SPAWN_Z_SALT) - 0.5) *
    availableSpan;

  const x = clampWorldAxis(centerX + offsetX);
  const z = clampWorldAxis(centerZ + offsetZ);
  const y = sampleTerrainHeight(x, z);
  return { x, y, z };
}

function sampleSpawnYaw(chunkX: number, chunkZ: number, spawnSequence: number) {
  const yawRatio = chunkHashN(chunkX, chunkZ, spawnSequence, SPAWN_YAW_SALT);
  return yawRatio * TWO_PI;
}

function spawnGoombaForChunk(
  ctx: GoombaChunkSpawnTickContext,
  chunkX: number,
  chunkZ: number,
  spawnSequence: number,
  timestampMs: number,
) {
  const goombaId = `goomba-${chunkX}-${chunkZ}`;
  if (ctx.db.goombaState.goombaId.find(goombaId)) {
    return goombaId;
  }

  const spawnPoint = sampleSpawnPosition(chunkX, chunkZ, spawnSequence);
  const yaw = sampleSpawnYaw(chunkX, chunkZ, spawnSequence);

  ctx.db.goombaState.insert({
    goombaId,
    spawnX: spawnPoint.x,
    spawnY: spawnPoint.y,
    spawnZ: spawnPoint.z,
    x: spawnPoint.x,
    y: spawnPoint.y,
    z: spawnPoint.z,
    yaw,
    state: GOOMBA_STATE_IDLE,
    targetIdentity: undefined,
    stateEndsAtMs: 0,
    nextChargeAllowedAtMs: hashStringToUint32(`${goombaId}:${spawnSequence}`) || 1,
    respawnAtMs: undefined,
    updatedAtMs: timestampMs,
  });

  return goombaId;
}

export function tickGoombaChunkSpawns(
  ctx: GoombaChunkSpawnTickContext,
  timestampMs: number,
) {
  const activeChunks = collectActiveChunks(ctx);

  for (const chunk of activeChunks.values()) {
    if (!isChunkEligible(chunk.x, chunk.z)) {
      continue;
    }

    const chunkKey = getChunkKey(chunk.x, chunk.z);
    const existing = ctx.db.goombaChunkSpawnState.chunkKey.find(chunkKey);
    if (!existing) {
      ctx.db.goombaChunkSpawnState.insert({
        chunkKey,
        chunkX: chunk.x,
        chunkZ: chunk.z,
        nextSpawnAtMs: timestampMs + GOOMBA_CHUNK_SPAWN_COOLDOWN_MS,
        spawnSequence: 0,
        activeGoombaId: undefined,
        updatedAtMs: timestampMs,
      });
      continue;
    }

    const next: GoombaChunkSpawnStateRow = { ...existing };
    let changed = false;

    if (
      next.activeGoombaId !== undefined &&
      !ctx.db.goombaState.goombaId.find(next.activeGoombaId)
    ) {
      next.activeGoombaId = undefined;
      changed = true;
    }

    if (next.activeGoombaId !== undefined) {
      if (changed) {
        next.updatedAtMs = timestampMs;
        ctx.db.goombaChunkSpawnState.chunkKey.update(next);
      }
      continue;
    }

    if (timestampMs < next.nextSpawnAtMs) {
      if (changed) {
        next.updatedAtMs = timestampMs;
        ctx.db.goombaChunkSpawnState.chunkKey.update(next);
      }
      continue;
    }

    const spawnSequence = Math.max(0, Math.floor(next.spawnSequence));
    const spawnedGoombaId = spawnGoombaForChunk(
      ctx,
      chunk.x,
      chunk.z,
      spawnSequence,
      timestampMs,
    );

    next.spawnSequence = spawnSequence + 1;
    next.activeGoombaId = spawnedGoombaId;
    next.nextSpawnAtMs = timestampMs + GOOMBA_CHUNK_SPAWN_COOLDOWN_MS;
    next.updatedAtMs = timestampMs;
    ctx.db.goombaChunkSpawnState.chunkKey.update(next);
  }

  return activeChunks;
}
