import type { PlayerInventoryRow } from './rows';

type InventoryContext = {
  db: {
    playerInventory: {
      identity: {
        find(identity: string): PlayerInventoryRow | null;
      };
      insert(row: PlayerInventoryRow): void;
    };
  };
};

export function ensurePlayerInventory(
  ctx: InventoryContext,
  identity: string,
  timestampMs: number,
) {
  const existing = ctx.db.playerInventory.identity.find(identity);
  if (existing) {
    return existing;
  }

  const created: PlayerInventoryRow = {
    identity,
    ringCount: 0,
    updatedAtMs: timestampMs,
  };
  ctx.db.playerInventory.insert(created);
  return created;
}
