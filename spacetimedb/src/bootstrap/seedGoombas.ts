import {
  GOOMBA_STATE_IDLE,
} from '../shared/constants';
import type { GoombaStateRow } from '../shared/rows';
import { goombaSeedData } from '../shared/worldSeeds';

type GoombaSeedContext = {
  db: {
    goombaState: {
      iter(): IteratorObject<GoombaStateRow, undefined>;
      delete(row: GoombaStateRow): boolean;
      insert(row: GoombaStateRow): void;
      goombaId: {
        find(goombaId: string): GoombaStateRow | null;
      };
    };
  };
};

function hashStringToUint32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function ensureGoombaRows(ctx: GoombaSeedContext, timestampMs: number) {
  const seedById = new Map(
    goombaSeedData.map((seed) => [seed.goombaId, seed] as const),
  );

  for (const existing of ctx.db.goombaState.iter()) {
    if (seedById.has(existing.goombaId)) {
      continue;
    }
    ctx.db.goombaState.delete(existing);
  }

  for (const goomba of goombaSeedData) {
    if (ctx.db.goombaState.goombaId.find(goomba.goombaId)) {
      continue;
    }
    ctx.db.goombaState.insert({
      goombaId: goomba.goombaId,
      spawnX: goomba.spawnX,
      spawnY: goomba.spawnY,
      spawnZ: goomba.spawnZ,
      x: goomba.spawnX,
      y: goomba.spawnY,
      z: goomba.spawnZ,
      yaw: 0,
      state: GOOMBA_STATE_IDLE,
      targetIdentity: undefined,
      stateEndsAtMs: 0,
      // Stored as deterministic RNG seed by goomba behavior tick.
      nextChargeAllowedAtMs: hashStringToUint32(goomba.goombaId) || 1,
      respawnAtMs: undefined,
      updatedAtMs: timestampMs,
    });
  }
}
