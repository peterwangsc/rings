import { spacetimedb } from '../schema';
import { ensurePlayerInventory } from '../shared/playerInventory';
import { getConnectionIdHex, nowMs } from '../shared/time';
import { ensureWorldStateRow } from '../shared/worldState';

spacetimedb.clientConnected((ctx) => {
  const timestampMs = nowMs(ctx);
  ensureWorldStateRow(ctx);
  ensurePlayerInventory(ctx, ctx.sender.toHexString(), timestampMs);

  const connectionId = getConnectionIdHex(ctx.connectionId);
  if (!connectionId) {
    return;
  }

  const existing = ctx.db.session.connectionId.find(connectionId);
  if (existing) {
    ctx.db.session.delete(existing);
  }

  ctx.db.session.insert({
    connectionId,
    identity: ctx.sender.toHexString(),
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

  const hasAnySession = Array.from(ctx.db.session.iter()).some(
    (candidate) => candidate.identity === identity,
  );

  if (!hasAnySession) {
    const player = ctx.db.playerState.identity.find(identity);
    if (player) {
      ctx.db.playerState.delete(player);
    }
  }
});
