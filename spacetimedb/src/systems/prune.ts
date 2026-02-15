import {
  RING_DROP_LIFETIME_MS,
  RING_DROP_PRUNE_AFTER_COLLECT_MS,
} from '../shared/constants';
import type {
  ChatMessageEventRow,
  FireballEventRow,
  RingDropStateRow,
} from '../shared/rows';

type PruneContext = {
  db: {
    fireballEvent: {
      iter(): IteratorObject<FireballEventRow, undefined>;
      delete(row: FireballEventRow): boolean;
    };
    chatMessageEvent: {
      iter(): IteratorObject<ChatMessageEventRow, undefined>;
      delete(row: ChatMessageEventRow): boolean;
    };
    ringDropState: {
      iter(): IteratorObject<RingDropStateRow, undefined>;
      delete(row: RingDropStateRow): boolean;
    };
  };
};

export function pruneExpiredRows(ctx: PruneContext, timestampMs: number) {
  for (const event of ctx.db.fireballEvent.iter()) {
    if (event.expiresAtMs <= timestampMs) {
      ctx.db.fireballEvent.delete(event);
    }
  }

  for (const chatMessage of ctx.db.chatMessageEvent.iter()) {
    if (chatMessage.expiresAtMs <= timestampMs) {
      ctx.db.chatMessageEvent.delete(chatMessage);
    }
  }

  for (const drop of ctx.db.ringDropState.iter()) {
    if (timestampMs - drop.spawnedAtMs >= RING_DROP_LIFETIME_MS) {
      ctx.db.ringDropState.delete(drop);
      continue;
    }

    if (!drop.collected || drop.collectedAtMs === undefined) {
      continue;
    }
    if (timestampMs - drop.collectedAtMs >= RING_DROP_PRUNE_AFTER_COLLECT_MS) {
      ctx.db.ringDropState.delete(drop);
    }
  }
}
