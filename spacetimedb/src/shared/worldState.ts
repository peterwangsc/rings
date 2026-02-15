import {
  WORLD_DAY_CYCLE_DURATION_SECONDS,
  WORLD_STATE_ROW_ID,
} from './constants';
import type { WorldStateRow } from './rows';
import { nowMs } from './time';

type WorldStateContext = {
  timestamp: { toMillis(): bigint };
  db: {
    worldState: {
      id: {
        find(id: string): WorldStateRow | null;
      };
      insert(row: WorldStateRow): void;
    };
  };
};

export function ensureWorldStateRow(ctx: WorldStateContext) {
  const existing = ctx.db.worldState.id.find(WORLD_STATE_ROW_ID);
  if (existing) {
    return existing;
  }

  const nextWorldState: WorldStateRow = {
    id: WORLD_STATE_ROW_ID,
    dayCycleAnchorMs: nowMs(ctx),
    dayCycleDurationSeconds: WORLD_DAY_CYCLE_DURATION_SECONDS,
  };
  ctx.db.worldState.insert(nextWorldState);
  return nextWorldState;
}
