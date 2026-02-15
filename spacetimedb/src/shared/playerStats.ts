import { getIdentitySeededGuestDisplayName } from './guestDisplayNames';
import type { PlayerStatsRow } from './rows';

type PlayerStatsContext = {
  db: {
    playerStats: {
      identity: {
        find(identity: string): PlayerStatsRow | null;
      };
      insert(row: PlayerStatsRow): void;
    };
  };
};

export function ensurePlayerStats(
  ctx: PlayerStatsContext,
  identity: string,
  timestampMs: number,
) {
  const existing = ctx.db.playerStats.identity.find(identity);
  if (existing) {
    return existing;
  }

  const created: PlayerStatsRow = {
    identity,
    displayName: getIdentitySeededGuestDisplayName(identity),
    highestRingCount: 0,
    updatedAtMs: timestampMs,
  };
  ctx.db.playerStats.insert(created);
  return created;
}
