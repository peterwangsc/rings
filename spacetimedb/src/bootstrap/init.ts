import { spacetimedb } from '../schema';
import { ensureWorldStateRow } from '../shared/worldState';

spacetimedb.init((ctx) => {
  ensureWorldStateRow(ctx);
});
