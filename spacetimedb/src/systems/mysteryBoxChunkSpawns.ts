import {
  MYSTERY_BOX_CHUNK_ACTIVE_RADIUS,
  MYSTERY_BOX_CHUNK_HASH_SEED,
  MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
  MYSTERY_BOX_CHUNK_SPAWN_MARGIN,
  MYSTERY_BOX_CHUNK_SPAWN_THRESHOLD,
  MYSTERY_BOX_DISABLE_ORIGIN_CHUNK_SPAWN,
  MYSTERY_BOX_HOVER_HEIGHT,
  MYSTERY_BOX_STATE_READY,
} from '../shared/constants';
import type {
  MysteryBoxChunkSpawnStateRow,
  MysteryBoxStateRow,
  PlayerStateRow,
} from '../shared/rows';
import {
  tickEntityChunkSpawns,
  type ChunkSpawnConfig,
  type ChunkSpawnTickCtx,
} from '../shared/chunkSpawns';

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

const MYSTERY_BOX_CHUNK_CONFIG: ChunkSpawnConfig = {
  activeRadius: MYSTERY_BOX_CHUNK_ACTIVE_RADIUS,
  hashSeed: MYSTERY_BOX_CHUNK_HASH_SEED,
  spawnThreshold: MYSTERY_BOX_CHUNK_SPAWN_THRESHOLD,
  spawnCooldownMs: MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
  spawnMargin: MYSTERY_BOX_CHUNK_SPAWN_MARGIN,
  disableOriginChunk: MYSTERY_BOX_DISABLE_ORIGIN_CHUNK_SPAWN,
  spawnXSalt: SPAWN_X_SALT,
  spawnZSalt: SPAWN_Z_SALT,
  yOffset: MYSTERY_BOX_HOVER_HEIGHT,
};

export function tickMysteryBoxChunkSpawns(
  ctx: MysteryBoxChunkSpawnTickContext,
  timestampMs: number,
) {
  const tickCtx: ChunkSpawnTickCtx = {
    playerState: ctx.db.playerState,
    chunkSpawnState: {
      insert(row) {
        ctx.db.mysteryBoxChunkSpawnState.insert({
          chunkKey: row.chunkKey,
          chunkX: row.chunkX,
          chunkZ: row.chunkZ,
          nextSpawnAtMs: row.nextSpawnAtMs,
          spawnSequence: row.spawnSequence,
          activeMysteryBoxId: row.activeEntityId,
          updatedAtMs: row.updatedAtMs,
        });
      },
      findByChunkKey(chunkKey) {
        const row = ctx.db.mysteryBoxChunkSpawnState.chunkKey.find(chunkKey);
        if (!row) return null;
        return {
          chunkKey: row.chunkKey,
          chunkX: row.chunkX,
          chunkZ: row.chunkZ,
          nextSpawnAtMs: row.nextSpawnAtMs,
          spawnSequence: row.spawnSequence,
          activeEntityId: row.activeMysteryBoxId,
          updatedAtMs: row.updatedAtMs,
        };
      },
      updateByChunkKey(row) {
        ctx.db.mysteryBoxChunkSpawnState.chunkKey.update({
          chunkKey: row.chunkKey,
          chunkX: row.chunkX,
          chunkZ: row.chunkZ,
          nextSpawnAtMs: row.nextSpawnAtMs,
          spawnSequence: row.spawnSequence,
          activeMysteryBoxId: row.activeEntityId,
          updatedAtMs: row.updatedAtMs,
        });
        return row;
      },
    },
    entityExists(entityId) {
      return ctx.db.mysteryBoxState.mysteryBoxId.find(entityId) !== null;
    },
    spawnEntity(chunkX, chunkZ, _spawnSequence, pos, ts) {
      const mysteryBoxId = `mystery-box-${chunkX}-${chunkZ}`;
      if (ctx.db.mysteryBoxState.mysteryBoxId.find(mysteryBoxId)) {
        return mysteryBoxId;
      }
      ctx.db.mysteryBoxState.insert({
        mysteryBoxId,
        spawnX: pos.x,
        spawnY: pos.y,
        spawnZ: pos.z,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        state: MYSTERY_BOX_STATE_READY,
        respawnAtMs: undefined,
        updatedAtMs: ts,
      });
      return mysteryBoxId;
    },
  };

  return tickEntityChunkSpawns(tickCtx, MYSTERY_BOX_CHUNK_CONFIG, timestampMs);
}
