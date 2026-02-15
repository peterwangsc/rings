import { spacetimedb } from '../schema';
import { ringSeedData } from '../shared/worldSeeds';
import { ensureWorldStateRow } from '../shared/worldState';

spacetimedb.init((ctx) => {
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

  ensureWorldStateRow(ctx);
});
