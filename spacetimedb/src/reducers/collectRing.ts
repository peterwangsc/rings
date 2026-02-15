import { t } from 'spacetimedb/server';
import {
  RING_COLLECT_RADIUS,
  RING_DROP_LIFETIME_MS,
} from '../shared/constants';
import { ensurePlayerInventory } from '../shared/playerInventory';
import { nowMs } from '../shared/time';
import { ringPositionById } from '../shared/worldSeeds';
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

    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const starterRing = ctx.db.ringState.ringId.find(ringId);
    if (starterRing) {
      if (!starterRing.collected) {
        const ringPosition = ringPositionById.get(ringId);
        if (!ringPosition) {
          return { tag: 'err', value: 'ring_position_missing' };
        }

        const distanceToRing = Math.hypot(
          player.x - ringPosition.x,
          player.y - ringPosition.y,
          player.z - ringPosition.z,
        );

        if (distanceToRing > RING_COLLECT_RADIUS) {
          return { tag: 'err', value: 'ring_out_of_range' };
        }

        ctx.db.ringState.ringId.update({
          ...starterRing,
          collected: true,
          collectedBy: identity,
          collectedAtMs: timestampMs,
        });

        const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
        ctx.db.playerInventory.identity.update({
          ...inventory,
          ringCount: normalizeRingCount(inventory.ringCount + 1),
          updatedAtMs: timestampMs,
        });
      }

      return { tag: 'ok' };
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

    const distanceToRing = Math.hypot(
      player.x - dropRing.x,
      player.y - dropRing.y,
      player.z - dropRing.z,
    );

    if (distanceToRing > RING_COLLECT_RADIUS) {
      return { tag: 'err', value: 'ring_out_of_range' };
    }

    ctx.db.ringDropState.ringId.update({
      ...dropRing,
      collected: true,
      collectedBy: identity,
      collectedAtMs: timestampMs,
    });

    const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
    ctx.db.playerInventory.identity.update({
      ...inventory,
      ringCount: normalizeRingCount(inventory.ringCount + 1),
      updatedAtMs: timestampMs,
    });

    return { tag: 'ok' };
  },
);
