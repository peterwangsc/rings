import {
  GOOMBA_CHARGE_COOLDOWN_MS,
  GOOMBA_CHARGE_DURATION_MS,
  GOOMBA_CHARGE_SPEED,
  GOOMBA_DETECT_RADIUS,
  GOOMBA_PLAYER_HIT_RADIUS,
  GOOMBA_STATE_CHARGE,
  GOOMBA_STATE_COOLDOWN,
  GOOMBA_STATE_DEFEATED,
  GOOMBA_STATE_IDLE,
  MAX_SPILL_RING_COUNT,
  RING_DROP_SOURCE_SPILL,
} from '../shared/constants';
import type {
  GoombaStateRow,
  PlayerInventoryRow,
  PlayerStateRow,
  RingDropStateRow,
} from '../shared/rows';
import { sampleTerrainHeight } from '../shared/terrain';
import { insertDropRing } from './ringDrops';
import {
  normalizeRingCount,
  sanitizeGoombaState,
} from '../validation/reducerValidation';

type GoombaTickContext = {
  newUuidV4(): { toString(): string };
  db: {
    playerState: {
      identity: {
        find(identity: string): PlayerStateRow | null;
      };
      iter(): IteratorObject<PlayerStateRow, undefined>;
    };
    playerInventory: {
      identity: {
        find(identity: string): PlayerInventoryRow | null;
        update(row: PlayerInventoryRow): PlayerInventoryRow;
      };
    };
    goombaState: {
      iter(): IteratorObject<GoombaStateRow, undefined>;
      goombaId: {
        update(row: GoombaStateRow): GoombaStateRow;
      };
    };
    ringDropState: {
      insert(row: RingDropStateRow): void;
    };
  };
};

function spillPlayerRings(
  ctx: GoombaTickContext,
  identity: string,
  x: number,
  z: number,
  timestampMs: number,
) {
  const inventory = ctx.db.playerInventory.identity.find(identity);
  if (!inventory) {
    return;
  }
  const ringCount = normalizeRingCount(inventory.ringCount);
  if (ringCount <= 0) {
    return;
  }

  const spillCount = Math.min(MAX_SPILL_RING_COUNT, ringCount);
  for (let index = 0; index < spillCount; index += 1) {
    const angle = (index / Math.max(1, spillCount)) * Math.PI * 2;
    const radius = 1.35 + (index % 4) * 0.65;
    insertDropRing(
      ctx,
      timestampMs,
      RING_DROP_SOURCE_SPILL,
      x + Math.cos(angle) * radius,
      z + Math.sin(angle) * radius,
    );
  }

  ctx.db.playerInventory.identity.update({
    ...inventory,
    ringCount: 0,
    updatedAtMs: timestampMs,
  });
}

function tryPickChargeTarget(ctx: GoombaTickContext, goomba: GoombaStateRow) {
  let nearest: PlayerStateRow | null = null;
  let nearestDistance = GOOMBA_DETECT_RADIUS;

  for (const player of ctx.db.playerState.iter()) {
    const dx = player.x - goomba.x;
    const dz = player.z - goomba.z;
    const distance = Math.hypot(dx, dz);
    if (distance > nearestDistance) {
      continue;
    }
    nearest = player;
    nearestDistance = distance;
  }

  return nearest;
}

export function tickGoombas(ctx: GoombaTickContext, timestampMs: number) {
  for (const goomba of ctx.db.goombaState.iter()) {
    const next: GoombaStateRow = {
      ...goomba,
      state: sanitizeGoombaState(goomba.state),
      updatedAtMs: timestampMs,
    };

    if (next.state === GOOMBA_STATE_DEFEATED) {
      if (next.respawnAtMs !== undefined && timestampMs >= next.respawnAtMs) {
        next.x = next.spawnX;
        next.y = next.spawnY;
        next.z = next.spawnZ;
        next.state = GOOMBA_STATE_IDLE;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
        next.respawnAtMs = undefined;
      }
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (next.state === GOOMBA_STATE_CHARGE) {
      const targetIdentity = next.targetIdentity;
      const target = targetIdentity
        ? ctx.db.playerState.identity.find(targetIdentity)
        : undefined;
      if (!target) {
        next.state = GOOMBA_STATE_COOLDOWN;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
        ctx.db.goombaState.goombaId.update(next);
        continue;
      }

      const dtSeconds = Math.max(
        0,
        Math.min((timestampMs - goomba.updatedAtMs) / 1000, 0.2),
      );
      const dx = target.x - next.x;
      const dz = target.z - next.z;
      const planarDistance = Math.hypot(dx, dz);

      if (planarDistance > 1e-6 && dtSeconds > 0) {
        const step = Math.min(planarDistance, GOOMBA_CHARGE_SPEED * dtSeconds);
        const invDistance = 1 / planarDistance;
        next.x += dx * invDistance * step;
        next.z += dz * invDistance * step;
        next.y = sampleTerrainHeight(next.x, next.z);
        next.yaw = Math.atan2(dx, -dz);
      }

      if (planarDistance <= GOOMBA_PLAYER_HIT_RADIUS) {
        spillPlayerRings(ctx, target.identity, target.x, target.z, timestampMs);
        next.state = GOOMBA_STATE_COOLDOWN;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
      } else if (timestampMs >= next.stateEndsAtMs) {
        next.state = GOOMBA_STATE_COOLDOWN;
        next.targetIdentity = undefined;
        next.stateEndsAtMs = 0;
        next.nextChargeAllowedAtMs = timestampMs + GOOMBA_CHARGE_COOLDOWN_MS;
      }

      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    if (
      next.state === GOOMBA_STATE_COOLDOWN &&
      timestampMs < next.nextChargeAllowedAtMs
    ) {
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    const target = tryPickChargeTarget(ctx, next);
    if (!target) {
      next.state = GOOMBA_STATE_IDLE;
      next.targetIdentity = undefined;
      next.stateEndsAtMs = 0;
      ctx.db.goombaState.goombaId.update(next);
      continue;
    }

    next.state = GOOMBA_STATE_CHARGE;
    next.targetIdentity = target.identity;
    next.stateEndsAtMs = timestampMs + GOOMBA_CHARGE_DURATION_MS;
    ctx.db.goombaState.goombaId.update(next);
  }
}
