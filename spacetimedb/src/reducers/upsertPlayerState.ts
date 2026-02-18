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
import { tickMysteryBoxes } from '../systems/mysteryBoxes';
import { pruneExpiredRows } from '../systems/prune';
import {
  isFiniteNumber,
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

    if (
      !isFiniteNumber(payload.x) ||
      !isFiniteNumber(payload.y) ||
      !isFiniteNumber(payload.z) ||
      !isFiniteNumber(payload.yaw) ||
      !isFiniteNumber(payload.pitch) ||
      !isFiniteNumber(payload.vx) ||
      !isFiniteNumber(payload.vy) ||
      !isFiniteNumber(payload.vz) ||
      !isFiniteNumber(payload.planarSpeed) ||
      !isFiniteNumber(payload.lastInputSeq)
    ) {
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
      const planarStepSquared = deltaX * deltaX + deltaZ * deltaZ;
      const maxPlanarStepSquared = maxPlanarStep * maxPlanarStep;
      if (planarStepSquared > maxPlanarStepSquared && planarStepSquared > 1e-12) {
        const scale = maxPlanarStep / Math.sqrt(planarStepSquared);
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
    const sanitizedDisplayName =
      previous && payload.displayName === previous.displayName
        ? previous.displayName
        : sanitizeDisplayName(payload.displayName, identity);
    const motionState =
      previous && payload.motionState === previous.motionState
        ? previous.motionState
        : sanitizeMotionState(payload.motionState);

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
      motionState,
      lastInputSeq: Math.max(0, payload.lastInputSeq),
      updatedAtMs: timestampMs,
      lastCastAtMs: previous?.lastCastAtMs ?? -1,
    };

    if (previous) {
      ctx.db.playerState.identity.update(nextRow);
    } else {
      ctx.db.playerState.insert(nextRow);
    }

    if (!previous) {
      ensurePlayerInventory(ctx, identity, timestampMs);
    }
    if (!previous || previous.displayName !== sanitizedDisplayName) {
      const playerStats = ensurePlayerStats(ctx, identity, timestampMs);
      if (playerStats.displayName !== sanitizedDisplayName) {
        ctx.db.playerStats.identity.update({
          ...playerStats,
          displayName: sanitizedDisplayName,
          updatedAtMs: timestampMs,
        });
      }
    }
    tickGoombas(ctx, timestampMs);
    tickMysteryBoxes(ctx, timestampMs);
    pruneExpiredRows(ctx, timestampMs);

    return { tag: 'ok' };
  },
);
