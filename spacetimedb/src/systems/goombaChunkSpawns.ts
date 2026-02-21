import {
  GOOMBA_CHUNK_ACTIVE_RADIUS,
  GOOMBA_CHUNK_HASH_SEED,
  GOOMBA_CHUNK_SPAWN_COOLDOWN_MS,
  GOOMBA_CHUNK_SPAWN_MARGIN,
  GOOMBA_CHUNK_SPAWN_THRESHOLD,
  GOOMBA_DISABLE_ORIGIN_CHUNK_SPAWN,
  GOOMBA_STATE_IDLE,
} from '../shared/constants';
import { hashStringToUint32 } from '../shared/mathUtils';
import { chunkHashN } from '../shared/chunks';
import type {
  GoombaChunkSpawnStateRow,
  GoombaStateRow,
  PlayerStateRow,
} from '../shared/rows';
import {
  tickEntityChunkSpawns,
  type ChunkSpawnConfig,
  type ChunkSpawnTickCtx,
} from '../shared/chunkSpawns';

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

const SPAWN_X_SALT = 37.91;
const SPAWN_Z_SALT = 53.27;
const SPAWN_YAW_SALT = 71.13;
const TWO_PI = Math.PI * 2;

const GOOMBA_CHUNK_CONFIG: ChunkSpawnConfig = {
  activeRadius: GOOMBA_CHUNK_ACTIVE_RADIUS,
  hashSeed: GOOMBA_CHUNK_HASH_SEED,
  spawnThreshold: GOOMBA_CHUNK_SPAWN_THRESHOLD,
  spawnCooldownMs: GOOMBA_CHUNK_SPAWN_COOLDOWN_MS,
  spawnMargin: GOOMBA_CHUNK_SPAWN_MARGIN,
  disableOriginChunk: GOOMBA_DISABLE_ORIGIN_CHUNK_SPAWN,
  spawnXSalt: SPAWN_X_SALT,
  spawnZSalt: SPAWN_Z_SALT,
  yOffset: 0,
};

export function tickGoombaChunkSpawns(
  ctx: GoombaChunkSpawnTickContext,
  timestampMs: number,
) {
  const tickCtx: ChunkSpawnTickCtx = {
    playerState: ctx.db.playerState,
    chunkSpawnState: {
      insert(row) {
        ctx.db.goombaChunkSpawnState.insert({
          chunkKey: row.chunkKey,
          chunkX: row.chunkX,
          chunkZ: row.chunkZ,
          nextSpawnAtMs: row.nextSpawnAtMs,
          spawnSequence: row.spawnSequence,
          activeGoombaId: row.activeEntityId,
          updatedAtMs: row.updatedAtMs,
        });
      },
      findByChunkKey(chunkKey) {
        const row = ctx.db.goombaChunkSpawnState.chunkKey.find(chunkKey);
        if (!row) return null;
        return {
          chunkKey: row.chunkKey,
          chunkX: row.chunkX,
          chunkZ: row.chunkZ,
          nextSpawnAtMs: row.nextSpawnAtMs,
          spawnSequence: row.spawnSequence,
          activeEntityId: row.activeGoombaId,
          updatedAtMs: row.updatedAtMs,
        };
      },
      updateByChunkKey(row) {
        ctx.db.goombaChunkSpawnState.chunkKey.update({
          chunkKey: row.chunkKey,
          chunkX: row.chunkX,
          chunkZ: row.chunkZ,
          nextSpawnAtMs: row.nextSpawnAtMs,
          spawnSequence: row.spawnSequence,
          activeGoombaId: row.activeEntityId,
          updatedAtMs: row.updatedAtMs,
        });
        return row;
      },
    },
    entityExists(entityId) {
      return ctx.db.goombaState.goombaId.find(entityId) !== null;
    },
    spawnEntity(chunkX, chunkZ, spawnSequence, pos, ts) {
      const goombaId = `goomba-${chunkX}-${chunkZ}`;
      if (ctx.db.goombaState.goombaId.find(goombaId)) {
        return goombaId;
      }
      const yaw = chunkHashN(chunkX, chunkZ, spawnSequence, SPAWN_YAW_SALT) * TWO_PI;
      ctx.db.goombaState.insert({
        goombaId,
        spawnX: pos.x,
        spawnY: pos.y,
        spawnZ: pos.z,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw,
        state: GOOMBA_STATE_IDLE,
        targetIdentity: undefined,
        stateEndsAtMs: 0,
        nextChargeAllowedAtMs: hashStringToUint32(`${goombaId}:${spawnSequence}`) || 1,
        respawnAtMs: undefined,
        updatedAtMs: ts,
      });
      return goombaId;
    },
  };

  return tickEntityChunkSpawns(tickCtx, GOOMBA_CHUNK_CONFIG, timestampMs);
}
