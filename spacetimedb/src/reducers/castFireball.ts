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
  isFiniteNumber,
  isValidFireballDirectionLengthSquared,
  isValidFireballSpawnDistanceSquared,
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

    if (
      !isFiniteNumber(payload.originX) ||
      !isFiniteNumber(payload.originY) ||
      !isFiniteNumber(payload.originZ) ||
      !isFiniteNumber(payload.directionX) ||
      !isFiniteNumber(payload.directionY) ||
      !isFiniteNumber(payload.directionZ)
    ) {
      return { tag: 'err', value: 'invalid_numeric_payload' };
    }

    if (
      player.lastCastAtMs >= 0 &&
      timestampMs - player.lastCastAtMs < PLAYER_CAST_COOLDOWN_MS
    ) {
      return { tag: 'err', value: 'cast_cooldown' };
    }

    pruneExpiredRows(ctx, timestampMs);

    const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
    const ringCount = normalizeRingCount(inventory.ringCount);
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

    const directionLengthSquared =
      payload.directionX * payload.directionX +
      payload.directionY * payload.directionY +
      payload.directionZ * payload.directionZ;
    if (!isValidFireballDirectionLengthSquared(directionLengthSquared)) {
      return { tag: 'err', value: 'invalid_direction' };
    }

    const spawnDeltaX = payload.originX - player.x;
    const spawnDeltaY = payload.originY - player.y;
    const spawnDeltaZ = payload.originZ - player.z;
    const spawnDistanceSquared =
      spawnDeltaX * spawnDeltaX +
      spawnDeltaY * spawnDeltaY +
      spawnDeltaZ * spawnDeltaZ;
    if (!isValidFireballSpawnDistanceSquared(spawnDistanceSquared)) {
      return { tag: 'err', value: 'invalid_spawn_distance' };
    }

    const directionLength = Math.sqrt(directionLengthSquared);
    const normalizedDirectionX = payload.directionX / directionLength;
    const normalizedDirectionY = payload.directionY / directionLength;
    const normalizedDirectionZ = payload.directionZ / directionLength;

    ctx.db.playerState.identity.update({
      ...player,
      lastCastAtMs: timestampMs,
      updatedAtMs: timestampMs,
    });

    const eventId = `${identity}-${timestampMs}-${ctx.newUuidV4().toString()}`;
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
