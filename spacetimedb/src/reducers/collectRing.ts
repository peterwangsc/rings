import { t } from 'spacetimedb/server';
import {
  RING_COLLECT_RADIUS,
  RING_DROP_LIFETIME_MS,
} from '../shared/constants';
import { ensurePlayerInventory } from '../shared/playerInventory';
import { ensurePlayerStats } from '../shared/playerStats';
import { nowMs } from '../shared/time';
import { spacetimedb } from '../schema';
import { normalizeRingCount } from '../validation/reducerValidation';

spacetimedb.reducer(
  'collect_ring',
  {
    ringId: t.string(),
  },
  (ctx, { ringId }) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);
    const collectRadiusSquared = RING_COLLECT_RADIUS * RING_COLLECT_RADIUS;

    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const dropRing = ctx.db.ringDropState.ringId.find(ringId);
    if (!dropRing) {
      return { tag: 'err', value: 'ring_missing' };
    }

    if (timestampMs - dropRing.spawnedAtMs >= RING_DROP_LIFETIME_MS) {
      ctx.db.ringDropState.delete(dropRing);
      return { tag: 'err', value: 'ring_expired' };
    }

    if (dropRing.collected) {
      return { tag: 'ok' };
    }

    const dx = player.x - dropRing.x;
    const dy = player.y - dropRing.y;
    const dz = player.z - dropRing.z;
    if (dx * dx + dy * dy + dz * dz > collectRadiusSquared) {
      return { tag: 'err', value: 'ring_out_of_range' };
    }

    ctx.db.ringDropState.ringId.update({
      ...dropRing,
      collected: true,
      collectedBy: identity,
      collectedAtMs: timestampMs,
    });

    const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
    const nextRingCount = normalizeRingCount(inventory.ringCount + 1);
    ctx.db.playerInventory.identity.update({
      ...inventory,
      ringCount: nextRingCount,
      updatedAtMs: timestampMs,
    });

    const stats = ensurePlayerStats(ctx, identity, timestampMs);
    const currentHighest = normalizeRingCount(stats.highestRingCount);
    if (nextRingCount > currentHighest) {
      ctx.db.playerStats.identity.update({
        ...stats,
        highestRingCount: nextRingCount,
        updatedAtMs: timestampMs,
      });
    }

    return { tag: 'ok' };
  },
);
