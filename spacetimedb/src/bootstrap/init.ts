import { spacetimedb } from '../schema';
import { ensureGoombaRows } from './seedGoombas';
import { ringSeedData } from '../shared/worldSeeds';
import { nowMs } from '../shared/time';
import { ensureWorldStateRow } from '../shared/worldState';

spacetimedb.init((ctx) => {
  const timestampMs = nowMs(ctx);

  if (Number(ctx.db.ringState.count()) <= 0) {
    for (const ring of ringSeedData) {
      ctx.db.ringState.insert({
        ringId: ring.ringId,
        collected: false,
        collectedBy: undefined,
        collectedAtMs: undefined,
      });
    }
  }

  ensureGoombaRows(ctx, timestampMs);
  ensureWorldStateRow(ctx);
});
