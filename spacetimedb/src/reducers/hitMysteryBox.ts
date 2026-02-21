import { t } from 'spacetimedb/server';
import {
  MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
  MYSTERY_BOX_DEPLETED_DESPAWN_MS,
  MYSTERY_BOX_HIT_VALIDATION_RADIUS,
  MYSTERY_BOX_RING_BURST_COUNT,
  MYSTERY_BOX_STATE_DEPLETED,
  RING_DROP_SOURCE_MYSTERY_BOX,
} from '../shared/constants';
import { getChunkCoordFromWorld, getChunkKey } from '../shared/chunks';
import { nowMs } from '../shared/time';
import { spacetimedb } from '../schema';
import { pruneExpiredRows } from '../systems/prune';
import { insertDropRing } from '../systems/ringDrops';
import { sanitizeMysteryBoxState } from '../validation/reducerValidation';

spacetimedb.reducer(
  'hit_mystery_box',
  {
    mysteryBoxId: t.string(),
  },
  (ctx, { mysteryBoxId }) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);
    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const mysteryBox = ctx.db.mysteryBoxState.mysteryBoxId.find(mysteryBoxId);
    if (!mysteryBox) {
      return { tag: 'err', value: 'mystery_box_missing' };
    }

    if (sanitizeMysteryBoxState(mysteryBox.state) === MYSTERY_BOX_STATE_DEPLETED) {
      return { tag: 'ok' };
    }

    // Horizontal-only proximity check — snapshot lag doesn't affect XZ significantly
    // during a jump, so this reliably rejects out-of-range spoofed requests.
    const dx = player.x - mysteryBox.x;
    const dz = player.z - mysteryBox.z;
    if (
      dx * dx + dz * dz >
      MYSTERY_BOX_HIT_VALIDATION_RADIUS * MYSTERY_BOX_HIT_VALIDATION_RADIUS
    ) {
      return { tag: 'err', value: 'mystery_box_out_of_range' };
    }

    ctx.db.mysteryBoxState.mysteryBoxId.update({
      ...mysteryBox,
      state: MYSTERY_BOX_STATE_DEPLETED,
      respawnAtMs: timestampMs + MYSTERY_BOX_DEPLETED_DESPAWN_MS,
      updatedAtMs: timestampMs,
    });

    const spawnChunk = getChunkCoordFromWorld(mysteryBox.spawnX, mysteryBox.spawnZ);
    const chunkKey = getChunkKey(spawnChunk.x, spawnChunk.z);
    const existingChunkSpawnState =
      ctx.db.mysteryBoxChunkSpawnState.chunkKey.find(chunkKey);

    if (existingChunkSpawnState) {
      ctx.db.mysteryBoxChunkSpawnState.chunkKey.update({
        ...existingChunkSpawnState,
        nextSpawnAtMs: timestampMs + MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
        activeMysteryBoxId: mysteryBox.mysteryBoxId,
        updatedAtMs: timestampMs,
      });
    } else {
      ctx.db.mysteryBoxChunkSpawnState.insert({
        chunkKey,
        chunkX: spawnChunk.x,
        chunkZ: spawnChunk.z,
        nextSpawnAtMs: timestampMs + MYSTERY_BOX_CHUNK_SPAWN_COOLDOWN_MS,
        spawnSequence: 1,
        activeMysteryBoxId: mysteryBox.mysteryBoxId,
        updatedAtMs: timestampMs,
      });
    }

    const angleStep = (Math.PI * 2) / MYSTERY_BOX_RING_BURST_COUNT;
    for (let index = 0; index < MYSTERY_BOX_RING_BURST_COUNT; index += 1) {
      const angle = index * angleStep;
      const radius = 0.8 + (index % 3) * 0.28;
      insertDropRing(
        ctx,
        timestampMs,
        RING_DROP_SOURCE_MYSTERY_BOX,
        mysteryBox.x + Math.cos(angle) * radius,
        mysteryBox.z + Math.sin(angle) * radius,
      );
    }

    pruneExpiredRows(ctx, timestampMs);

    return { tag: 'ok' };
  },
);
