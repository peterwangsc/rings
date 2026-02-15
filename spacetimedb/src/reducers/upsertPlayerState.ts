import { t } from 'spacetimedb/server';
import {
  MAX_SNAPSHOT_SPEED,
  MAX_VERTICAL_DELTA,
  MAX_WORLD_ABS,
  SNAPSHOT_POSITION_LEEWAY,
} from '../shared/constants';
import { ensurePlayerInventory } from '../shared/playerInventory';
import { ensurePlayerStats } from '../shared/playerStats';
import type { PlayerStateRow } from '../shared/rows';
import { nowMs } from '../shared/time';
import { spacetimedb } from '../schema';
import { tickGoombas } from '../systems/goombas';
import { pruneExpiredRows } from '../systems/prune';
import {
  hasInvalidNumericPayload,
  sanitizeDisplayName,
  sanitizeMotionState,
} from '../validation/reducerValidation';

spacetimedb.reducer(
  'upsert_player_state',
  {
    displayName: t.string(),
    x: t.f64(),
    y: t.f64(),
    z: t.f64(),
    yaw: t.f64(),
    pitch: t.f64(),
    vx: t.f64(),
    vy: t.f64(),
    vz: t.f64(),
    planarSpeed: t.f64(),
    motionState: t.string(),
    lastInputSeq: t.f64(),
  },
  (ctx, payload) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);

    const numericValues = [
      payload.x,
      payload.y,
      payload.z,
      payload.yaw,
      payload.pitch,
      payload.vx,
      payload.vy,
      payload.vz,
      payload.planarSpeed,
      payload.lastInputSeq,
    ];

    if (hasInvalidNumericPayload(numericValues)) {
      return { tag: 'err', value: 'invalid_numeric_payload' };
    }

    const previous = ctx.db.playerState.identity.find(identity);

    let nextX = payload.x;
    let nextY = payload.y;
    let nextZ = payload.z;

    if (previous) {
      const dtMs = Math.max(1, timestampMs - previous.updatedAtMs);
      const maxPlanarStep =
        (MAX_SNAPSHOT_SPEED * dtMs) / 1000 + SNAPSHOT_POSITION_LEEWAY;

      const deltaX = nextX - previous.x;
      const deltaZ = nextZ - previous.z;
      const planarStep = Math.hypot(deltaX, deltaZ);

      if (planarStep > maxPlanarStep && planarStep > 1e-6) {
        const scale = maxPlanarStep / planarStep;
        nextX = previous.x + deltaX * scale;
        nextZ = previous.z + deltaZ * scale;
      }

      const deltaY = nextY - previous.y;
      if (Math.abs(deltaY) > MAX_VERTICAL_DELTA) {
        nextY = previous.y + Math.sign(deltaY) * MAX_VERTICAL_DELTA;
      }
    }

    nextX = Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, nextX));
    nextY = Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, nextY));
    nextZ = Math.max(-MAX_WORLD_ABS, Math.min(MAX_WORLD_ABS, nextZ));
    const sanitizedDisplayName = sanitizeDisplayName(payload.displayName, identity);

    const nextRow: PlayerStateRow = {
      identity,
      displayName: sanitizedDisplayName,
      x: nextX,
      y: nextY,
      z: nextZ,
      yaw: payload.yaw,
      pitch: payload.pitch,
      vx: payload.vx,
      vy: payload.vy,
      vz: payload.vz,
      planarSpeed: Math.max(0, payload.planarSpeed),
      motionState: sanitizeMotionState(payload.motionState),
      lastInputSeq: Math.max(0, payload.lastInputSeq),
      updatedAtMs: timestampMs,
      lastCastAtMs: previous?.lastCastAtMs ?? -1,
    };

    if (previous) {
      ctx.db.playerState.delete(previous);
    }
    ctx.db.playerState.insert(nextRow);

    ensurePlayerInventory(ctx, identity, timestampMs);
    const playerStats = ensurePlayerStats(ctx, identity, timestampMs);
    if (playerStats.displayName !== sanitizedDisplayName) {
      ctx.db.playerStats.identity.update({
        ...playerStats,
        displayName: sanitizedDisplayName,
        updatedAtMs: timestampMs,
      });
    }
    tickGoombas(ctx, timestampMs);
    pruneExpiredRows(ctx, timestampMs);

    return { tag: 'ok' };
  },
);
