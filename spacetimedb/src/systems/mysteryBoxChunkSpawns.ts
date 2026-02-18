import {
  MAX_WORLD_ABS,
  MYSTERY_BOX_CHUNK_ACTIVE_RADIUS,
  MYSTERY_BOX_CHUNK_HASH_SEED,
  MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
  MYSTERY_BOX_CHUNK_SPAWN_MARGIN,
  MYSTERY_BOX_CHUNK_SPAWN_THRESHOLD,
  MYSTERY_BOX_DISABLE_ORIGIN_CHUNK_SPAWN,
  MYSTERY_BOX_HOVER_HEIGHT,
  MYSTERY_BOX_STATE_READY,
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
  MysteryBoxChunkSpawnStateRow,
  MysteryBoxStateRow,
  PlayerStateRow,
} from '../shared/rows';
import { sampleTerrainHeight } from '../shared/terrain';

type MysteryBoxChunkSpawnTickContext = {
  db: {
    playerState: {
      iter(): IteratorObject<PlayerStateRow, undefined>;
    };
    mysteryBoxState: {
      insert(row: MysteryBoxStateRow): void;
      mysteryBoxId: {
        find(mysteryBoxId: string): MysteryBoxStateRow | null;
      };
    };
    mysteryBoxChunkSpawnState: {
      insert(row: MysteryBoxChunkSpawnStateRow): void;
      chunkKey: {
        find(chunkKey: string): MysteryBoxChunkSpawnStateRow | null;
        update(row: MysteryBoxChunkSpawnStateRow): MysteryBoxChunkSpawnStateRow;
      };
    };
  };
};

const SPAWN_X_SALT = 17.61;
const SPAWN_Z_SALT = 41.93;

function clampWorldAxis(value: number) {
  return Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, value));
}

function isChunkEligible(chunkX: number, chunkZ: number) {
  if (MYSTERY_BOX_DISABLE_ORIGIN_CHUNK_SPAWN && chunkX === 0 && chunkZ === 0) {
    return false;
  }
  const spawnChance = chunkHashN(chunkX, chunkZ, 0, MYSTERY_BOX_CHUNK_HASH_SEED);
  return spawnChance >= MYSTERY_BOX_CHUNK_SPAWN_THRESHOLD;
}

function collectActiveChunks(ctx: MysteryBoxChunkSpawnTickContext) {
  const chunks = new Map<string, ChunkCoord>();
  for (const player of ctx.db.playerState.iter()) {
    const center = getChunkCoordFromWorld(player.x, player.z);
    for (const chunk of iterateChunksAround(
      center.x,
      center.z,
      MYSTERY_BOX_CHUNK_ACTIVE_RADIUS,
    )) {
      chunks.set(getChunkKey(chunk.x, chunk.z), chunk);
    }
  }
  return chunks;
}

function sampleSpawnPosition(chunkX: number, chunkZ: number, spawnSequence: number) {
  const availableSpan = Math.max(
    0,
    TERRAIN_CHUNK_SIZE - MYSTERY_BOX_CHUNK_SPAWN_MARGIN * 2,
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
  const y = sampleTerrainHeight(x, z) + MYSTERY_BOX_HOVER_HEIGHT;
  return { x, y, z };
}

function spawnMysteryBoxForChunk(
  ctx: MysteryBoxChunkSpawnTickContext,
  chunkX: number,
  chunkZ: number,
  spawnSequence: number,
  timestampMs: number,
) {
  const mysteryBoxId = `mystery-box-${chunkX}-${chunkZ}`;
  if (ctx.db.mysteryBoxState.mysteryBoxId.find(mysteryBoxId)) {
    return mysteryBoxId;
  }

  const spawnPoint = sampleSpawnPosition(chunkX, chunkZ, spawnSequence);

  ctx.db.mysteryBoxState.insert({
    mysteryBoxId,
    spawnX: spawnPoint.x,
    spawnY: spawnPoint.y,
    spawnZ: spawnPoint.z,
    x: spawnPoint.x,
    y: spawnPoint.y,
    z: spawnPoint.z,
    state: MYSTERY_BOX_STATE_READY,
    respawnAtMs: undefined,
    updatedAtMs: timestampMs,
  });

  return mysteryBoxId;
}

export function tickMysteryBoxChunkSpawns(
  ctx: MysteryBoxChunkSpawnTickContext,
  timestampMs: number,
) {
  const activeChunks = collectActiveChunks(ctx);

  for (const chunk of activeChunks.values()) {
    if (!isChunkEligible(chunk.x, chunk.z)) {
      continue;
    }

    const chunkKey = getChunkKey(chunk.x, chunk.z);
    const existing = ctx.db.mysteryBoxChunkSpawnState.chunkKey.find(chunkKey);
    if (!existing) {
      ctx.db.mysteryBoxChunkSpawnState.insert({
        chunkKey,
        chunkX: chunk.x,
        chunkZ: chunk.z,
        nextSpawnAtMs: timestampMs + MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
        spawnSequence: 0,
        activeMysteryBoxId: undefined,
        updatedAtMs: timestampMs,
      });
      continue;
    }

    const next: MysteryBoxChunkSpawnStateRow = { ...existing };
    let changed = false;

    if (
      next.activeMysteryBoxId !== undefined &&
      !ctx.db.mysteryBoxState.mysteryBoxId.find(next.activeMysteryBoxId)
    ) {
      next.activeMysteryBoxId = undefined;
      changed = true;
    }

    if (next.activeMysteryBoxId !== undefined) {
      if (changed) {
        next.updatedAtMs = timestampMs;
        ctx.db.mysteryBoxChunkSpawnState.chunkKey.update(next);
      }
      continue;
    }

    if (timestampMs < next.nextSpawnAtMs) {
      if (changed) {
        next.updatedAtMs = timestampMs;
        ctx.db.mysteryBoxChunkSpawnState.chunkKey.update(next);
      }
      continue;
    }

    const spawnSequence = Math.max(0, Math.floor(next.spawnSequence));
    const spawnedMysteryBoxId = spawnMysteryBoxForChunk(
      ctx,
      chunk.x,
      chunk.z,
      spawnSequence,
      timestampMs,
    );

    next.spawnSequence = spawnSequence + 1;
    next.activeMysteryBoxId = spawnedMysteryBoxId;
    next.nextSpawnAtMs = timestampMs + MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS;
    next.updatedAtMs = timestampMs;
    ctx.db.mysteryBoxChunkSpawnState.chunkKey.update(next);
  }

  return activeChunks;
}
