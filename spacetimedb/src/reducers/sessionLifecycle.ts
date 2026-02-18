import { spacetimedb } from '../schema';
import { ensurePlayerInventory } from '../shared/playerInventory';
import { ensurePlayerStats } from '../shared/playerStats';
import { getConnectionIdHex, nowMs } from '../shared/time';
import { ensureWorldStateRow } from '../shared/worldState';
import { normalizeRingCount } from '../validation/reducerValidation';

spacetimedb.clientConnected((ctx) => {
  const timestampMs = nowMs(ctx);
  ensureWorldStateRow(ctx);
  const identity = ctx.sender.toHexString();
  const inventory = ensurePlayerInventory(ctx, identity, timestampMs);
  const playerStats = ensurePlayerStats(ctx, identity, timestampMs);
  const ringCount = normalizeRingCount(inventory.ringCount);
  const highestRingCount = normalizeRingCount(playerStats.highestRingCount);
  if (ringCount > highestRingCount) {
    ctx.db.playerStats.identity.update({
      ...playerStats,
      highestRingCount: ringCount,
      updatedAtMs: timestampMs,
    });
  }

  const connectionId = getConnectionIdHex(ctx.connectionId);
  if (!connectionId) {
    return;
  }

  const existing = ctx.db.session.connectionId.find(connectionId);
  if (existing) {
    ctx.db.session.connectionId.update({
      ...existing,
      identity,
      connectedAtMs: timestampMs,
    });
    return;
  }

  ctx.db.session.insert({
    connectionId,
    identity,
    connectedAtMs: timestampMs,
  });
});

spacetimedb.clientDisconnected((ctx) => {
  const connectionId = getConnectionIdHex(ctx.connectionId);
  if (!connectionId) {
    return;
  }

  const identity = ctx.sender.toHexString();

  const existingSession = ctx.db.session.connectionId.find(connectionId);
  if (existingSession) {
    ctx.db.session.delete(existingSession);
  }

  let hasAnySession = false;
  for (const candidate of ctx.db.session.iter()) {
    if (candidate.identity === identity) {
      hasAnySession = true;
      break;
    }
  }

  if (!hasAnySession) {
    const player = ctx.db.playerState.identity.find(identity);
    if (player) {
      ctx.db.playerState.delete(player);
    }
  }
});
