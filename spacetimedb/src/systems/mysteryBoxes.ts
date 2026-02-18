import {
  MYSTERY_BOX_STATE_DEPLETED,
  type MysteryBoxStateTag,
} from '../shared/constants';
import { getChunkCoordFromWorld, getChunkKey } from '../shared/chunks';
import type {
  MysteryBoxChunkSpawnStateRow,
  MysteryBoxStateRow,
  PlayerStateRow,
} from '../shared/rows';
import { tickMysteryBoxChunkSpawns } from './mysteryBoxChunkSpawns';
import { sanitizeMysteryBoxState } from '../validation/reducerValidation';

type MysteryBoxTickContext = {
  db: {
    playerState: {
      iter(): IteratorObject<PlayerStateRow, undefined>;
    };
    mysteryBoxState: {
      iter(): IteratorObject<MysteryBoxStateRow, undefined>;
      delete(row: MysteryBoxStateRow): boolean;
      mysteryBoxId: {
        find(mysteryBoxId: string): MysteryBoxStateRow | null;
        update(row: MysteryBoxStateRow): MysteryBoxStateRow;
      };
      insert(row: MysteryBoxStateRow): void;
    };
    mysteryBoxChunkSpawnState: {
      insert(row: MysteryBoxChunkSpawnStateRow): void;
      chunkKey: {
        find(chunkKey: string): MysteryBoxChunkSpawnStateRow | null;
        update(row: MysteryBoxChunkSpawnStateRow): MysteryBoxChunkSpawnStateRow;
      };
    };
  };
};

const MYSTERY_BOX_TICK_MIN_INTERVAL_MS = 50;
let lastMysteryBoxTickAtMs = -Infinity;

function maybeReleaseChunkSlot(
  ctx: MysteryBoxTickContext,
  mysteryBox: MysteryBoxStateRow,
  timestampMs: number,
) {
  const chunk = getChunkCoordFromWorld(mysteryBox.spawnX, mysteryBox.spawnZ);
  const chunkKey = getChunkKey(chunk.x, chunk.z);
  const spawnState = ctx.db.mysteryBoxChunkSpawnState.chunkKey.find(chunkKey);
  if (!spawnState || spawnState.activeMysteryBoxId !== mysteryBox.mysteryBoxId) {
    return;
  }

  ctx.db.mysteryBoxChunkSpawnState.chunkKey.update({
    ...spawnState,
    activeMysteryBoxId: undefined,
    updatedAtMs: timestampMs,
  });
}

function hasMysteryBoxChanged(previous: MysteryBoxStateRow, next: MysteryBoxStateRow) {
  return (
    previous.spawnX !== next.spawnX ||
    previous.spawnY !== next.spawnY ||
    previous.spawnZ !== next.spawnZ ||
    previous.x !== next.x ||
    previous.y !== next.y ||
    previous.z !== next.z ||
    previous.state !== next.state ||
    previous.respawnAtMs !== next.respawnAtMs
  );
}

function maybeUpdateMysteryBox(
  ctx: MysteryBoxTickContext,
  previous: MysteryBoxStateRow,
  next: MysteryBoxStateRow,
  timestampMs: number,
) {
  if (!hasMysteryBoxChanged(previous, next)) {
    return;
  }

  ctx.db.mysteryBoxState.mysteryBoxId.update({
    ...next,
    updatedAtMs: timestampMs,
  });
}

function resolveMysteryBoxState(state: string): MysteryBoxStateTag {
  return sanitizeMysteryBoxState(state);
}

export function tickMysteryBoxes(ctx: MysteryBoxTickContext, timestampMs: number) {
  if (timestampMs - lastMysteryBoxTickAtMs < MYSTERY_BOX_TICK_MIN_INTERVAL_MS) {
    return;
  }
  lastMysteryBoxTickAtMs = timestampMs;

  tickMysteryBoxChunkSpawns(ctx, timestampMs);

  for (const mysteryBox of ctx.db.mysteryBoxState.iter()) {
    const next: MysteryBoxStateRow = {
      ...mysteryBox,
      state: resolveMysteryBoxState(mysteryBox.state),
    };

    if (
      next.state === MYSTERY_BOX_STATE_DEPLETED &&
      next.respawnAtMs !== undefined &&
      timestampMs >= next.respawnAtMs
    ) {
      maybeReleaseChunkSlot(ctx, mysteryBox, timestampMs);
      ctx.db.mysteryBoxState.delete(mysteryBox);
      continue;
    }

    maybeUpdateMysteryBox(ctx, mysteryBox, next, timestampMs);
  }
}
