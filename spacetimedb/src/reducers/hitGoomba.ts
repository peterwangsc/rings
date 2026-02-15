import { t } from 'spacetimedb/server';
import {
  GOOMBA_CHARGE_COOLDOWN_MS,
  GOOMBA_HIT_VALIDATION_RADIUS,
  GOOMBA_RESPAWN_MS,
  GOOMBA_STATE_DEFEATED,
  RING_DROP_SOURCE_GOOMBA,
} from '../shared/constants';
import { nowMs } from '../shared/time';
import { spacetimedb } from '../schema';
import { pruneExpiredRows } from '../systems/prune';
import { insertDropRing } from '../systems/ringDrops';
import { sanitizeGoombaState } from '../validation/reducerValidation';

spacetimedb.reducer(
  'hit_goomba',
  {
    goombaId: t.string(),
  },
  (ctx, { goombaId }) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);
    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const goomba = ctx.db.goombaState.goombaId.find(goombaId);
    if (!goomba) {
      return { tag: 'err', value: 'goomba_missing' };
    }

    if (sanitizeGoombaState(goomba.state) === GOOMBA_STATE_DEFEATED) {
      return { tag: 'ok' };
    }

    const planarDistanceToGoomba = Math.hypot(
      player.x - goomba.x,
      player.z - goomba.z,
    );

    if (planarDistanceToGoomba > GOOMBA_HIT_VALIDATION_RADIUS) {
      return { tag: 'err', value: 'goomba_out_of_range' };
    }

    ctx.db.goombaState.goombaId.update({
      ...goomba,
      state: GOOMBA_STATE_DEFEATED,
      targetIdentity: undefined,
      stateEndsAtMs: 0,
      nextChargeAllowedAtMs: timestampMs + GOOMBA_CHARGE_COOLDOWN_MS,
      respawnAtMs: timestampMs + GOOMBA_RESPAWN_MS,
      updatedAtMs: timestampMs,
    });

    insertDropRing(
      ctx,
      timestampMs,
      RING_DROP_SOURCE_GOOMBA,
      goomba.x,
      goomba.z,
    );

    pruneExpiredRows(ctx, timestampMs);

    return { tag: 'ok' };
  },
);
