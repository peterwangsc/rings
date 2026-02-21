import { TERRAIN_CHUNK_SIZE } from './constants';
import { clampWorldAxis } from './mathUtils';
import {
  chunkHashN,
  getChunkCenterWorld,
  getChunkCoordFromWorld,
  getChunkKey,
  type ChunkCoord,
  iterateChunksAround,
} from './chunks';
import type { PlayerStateRow } from './rows';
import { sampleTerrainHeight } from './terrain';

// ---------------------------------------------------------------------------
// Generic chunk spawn DB interface
// ---------------------------------------------------------------------------

export type ChunkSpawnStateRow = {
  chunkKey: string;
  chunkX: number;
  chunkZ: number;
  nextSpawnAtMs: number;
  spawnSequence: number;
  activeEntityId: string | undefined;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type ChunkSpawnConfig = {
  activeRadius: number;
  hashSeed: number;
  spawnThreshold: number;
  spawnCooldownMs: number;
  spawnMargin: number;
  disableOriginChunk: boolean;
  spawnXSalt: number;
  spawnZSalt: number;
  /** Extra y offset above terrain (0 for goombas, MYSTERY_BOX_HOVER_HEIGHT for boxes) */
  yOffset: number;
};

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

function isChunkEligible(
  chunkX: number,
  chunkZ: number,
  config: ChunkSpawnConfig,
) {
  if (config.disableOriginChunk && chunkX === 0 && chunkZ === 0) {
    return false;
  }
  return chunkHashN(chunkX, chunkZ, 0, config.hashSeed) >= config.spawnThreshold;
}

function collectActiveChunks(
  playerStateIter: () => IteratorObject<PlayerStateRow, undefined>,
  activeRadius: number,
) {
  const chunks = new Map<string, ChunkCoord>();
  for (const player of playerStateIter()) {
    const center = getChunkCoordFromWorld(player.x, player.z);
    for (const chunk of iterateChunksAround(center.x, center.z, activeRadius)) {
      chunks.set(getChunkKey(chunk.x, chunk.z), chunk);
    }
  }
  return chunks;
}

function sampleChunkSpawnPosition(
  chunkX: number,
  chunkZ: number,
  spawnSequence: number,
  config: Pick<ChunkSpawnConfig, 'spawnMargin' | 'spawnXSalt' | 'spawnZSalt' | 'yOffset'>,
) {
  const availableSpan = Math.max(0, TERRAIN_CHUNK_SIZE - config.spawnMargin * 2);
  const centerX = getChunkCenterWorld(chunkX);
  const centerZ = getChunkCenterWorld(chunkZ);
  const offsetX = (chunkHashN(chunkX, chunkZ, spawnSequence, config.spawnXSalt) - 0.5) * availableSpan;
  const offsetZ = (chunkHashN(chunkX, chunkZ, spawnSequence, config.spawnZSalt) - 0.5) * availableSpan;
  const x = clampWorldAxis(centerX + offsetX);
  const z = clampWorldAxis(centerZ + offsetZ);
  const y = sampleTerrainHeight(x, z) + config.yOffset;
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Generic tick
// ---------------------------------------------------------------------------

export type ChunkSpawnTickCtx = {
  playerState: { iter(): IteratorObject<PlayerStateRow, undefined> };
  chunkSpawnState: {
    insert(row: ChunkSpawnStateRow): void;
    findByChunkKey(chunkKey: string): ChunkSpawnStateRow | null;
    updateByChunkKey(row: ChunkSpawnStateRow): ChunkSpawnStateRow;
  };
  entityExists(entityId: string): boolean;
  spawnEntity(
    chunkX: number,
    chunkZ: number,
    spawnSequence: number,
    pos: { x: number; y: number; z: number },
    timestampMs: number,
  ): string;
};

export function tickEntityChunkSpawns(
  ctx: ChunkSpawnTickCtx,
  config: ChunkSpawnConfig,
  timestampMs: number,
) {
  const activeChunks = collectActiveChunks(() => ctx.playerState.iter(), config.activeRadius);

  for (const chunk of activeChunks.values()) {
    if (!isChunkEligible(chunk.x, chunk.z, config)) {
      continue;
    }

    const chunkKey = getChunkKey(chunk.x, chunk.z);
    const existing = ctx.chunkSpawnState.findByChunkKey(chunkKey);

    // First time this chunk enters the active set: register it and spawn immediately.
    if (!existing) {
      const spawnSequence = 0;
      const pos = sampleChunkSpawnPosition(chunk.x, chunk.z, spawnSequence, config);
      const spawnedEntityId = ctx.spawnEntity(chunk.x, chunk.z, spawnSequence, pos, timestampMs);
      ctx.chunkSpawnState.insert({
        chunkKey,
        chunkX: chunk.x,
        chunkZ: chunk.z,
        nextSpawnAtMs: timestampMs + config.spawnCooldownMs,
        spawnSequence: spawnSequence + 1,
        activeEntityId: spawnedEntityId,
        updatedAtMs: timestampMs,
      });
      continue;
    }

    const next: ChunkSpawnStateRow = { ...existing };
    let changed = false;

    if (next.activeEntityId !== undefined && !ctx.entityExists(next.activeEntityId)) {
      next.activeEntityId = undefined;
      changed = true;
    }

    if (next.activeEntityId !== undefined) {
      if (changed) {
        next.updatedAtMs = timestampMs;
        ctx.chunkSpawnState.updateByChunkKey(next);
      }
      continue;
    }

    if (timestampMs < next.nextSpawnAtMs) {
      if (changed) {
        next.updatedAtMs = timestampMs;
        ctx.chunkSpawnState.updateByChunkKey(next);
      }
      continue;
    }

    const spawnSequence = Math.max(0, Math.floor(next.spawnSequence));
    const pos = sampleChunkSpawnPosition(chunk.x, chunk.z, spawnSequence, config);
    const spawnedEntityId = ctx.spawnEntity(chunk.x, chunk.z, spawnSequence, pos, timestampMs);

    next.spawnSequence = spawnSequence + 1;
    next.activeEntityId = spawnedEntityId;
    next.nextSpawnAtMs = timestampMs + config.spawnCooldownMs;
    next.updatedAtMs = timestampMs;
    ctx.chunkSpawnState.updateByChunkKey(next);
  }

  return activeChunks;
}
