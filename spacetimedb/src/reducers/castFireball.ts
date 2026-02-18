import { t } from 'spacetimedb/server';
import {
  FIREBALL_EVENT_TTL_MS,
  PLAYER_CAST_COOLDOWN_MS,
} from '../shared/constants';
import { ensurePlayerInventory } from '../shared/playerInventory';
import { nowMs } from '../shared/time';
import { spacetimedb } from '../schema';
import { pruneExpiredRows } from '../systems/prune';
import {
  hasInvalidNumericPayload,
  isValidFireballDirectionLength,
  isValidFireballSpawnDistance,
  normalizeRingCount,
} from '../validation/reducerValidation';

spacetimedb.reducer(
  'cast_fireball',
  {
    originX: t.f64(),
    originY: t.f64(),
    originZ: t.f64(),
    directionX: t.f64(),
    directionY: t.f64(),
    directionZ: t.f64(),
  },
  (ctx, payload) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);

    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
    const ringCount = normalizeRingCount(inventory.ringCount);

    const numericValues = [
      payload.originX,
      payload.originY,
      payload.originZ,
      payload.directionX,
      payload.directionY,
      payload.directionZ,
    ];
    if (hasInvalidNumericPayload(numericValues)) {
      return { tag: 'err', value: 'invalid_numeric_payload' };
    }

    if (
      player.lastCastAtMs >= 0 &&
      timestampMs - player.lastCastAtMs < PLAYER_CAST_COOLDOWN_MS
    ) {
      return { tag: 'err', value: 'cast_cooldown' };
    }

    pruneExpiredRows(ctx, timestampMs);

    if (ringCount <= 0) {
      return { tag: 'err', value: 'fireball_limit_reached' };
    }

    let activeOwnedFireballCount = 0;
    for (const event of ctx.db.fireballEvent.iter()) {
      if (event.ownerIdentity === identity) {
        activeOwnedFireballCount += 1;
        if (activeOwnedFireballCount >= ringCount) {
          break;
        }
      }
    }
    if (activeOwnedFireballCount >= ringCount) {
      return { tag: 'err', value: 'fireball_limit_reached' };
    }

    const directionLength = Math.hypot(
      payload.directionX,
      payload.directionY,
      payload.directionZ,
    );
    if (!isValidFireballDirectionLength(directionLength)) {
      return { tag: 'err', value: 'invalid_direction' };
    }

    const spawnDistance = Math.hypot(
      payload.originX - player.x,
      payload.originY - player.y,
      payload.originZ - player.z,
    );
    if (!isValidFireballSpawnDistance(spawnDistance)) {
      return { tag: 'err', value: 'invalid_spawn_distance' };
    }

    const normalizedDirectionX = payload.directionX / directionLength;
    const normalizedDirectionY = payload.directionY / directionLength;
    const normalizedDirectionZ = payload.directionZ / directionLength;

    ctx.db.playerState.delete(player);
    ctx.db.playerState.insert({
      ...player,
      lastCastAtMs: timestampMs,
      updatedAtMs: timestampMs,
    });

    const eventId = `${identity}-${Math.floor(timestampMs)}-${ctx.newUuidV4().toString()}`;
    ctx.db.fireballEvent.insert({
      eventId,
      ownerIdentity: identity,
      originX: payload.originX,
      originY: payload.originY,
      originZ: payload.originZ,
      directionX: normalizedDirectionX,
      directionY: normalizedDirectionY,
      directionZ: normalizedDirectionZ,
      createdAtMs: timestampMs,
      expiresAtMs: timestampMs + FIREBALL_EVENT_TTL_MS,
    });

    return { tag: 'ok' };
  },
);
