import { t } from 'spacetimedb/server';
import {
  CHAT_MESSAGE_EVENT_TTL_MS,
  CHAT_MESSAGE_MAX_LENGTH,
} from '../shared/constants';
import { nowMs } from '../shared/time';
import { spacetimedb } from '../schema';
import { pruneExpiredRows } from '../systems/prune';

spacetimedb.reducer(
  'send_chat_message',
  {
    messageText: t.string(),
  },
  (ctx, payload) => {
    const identity = ctx.sender.toHexString();
    const timestampMs = nowMs(ctx);
    const player = ctx.db.playerState.identity.find(identity);
    if (!player) {
      return { tag: 'err', value: 'player_missing' };
    }

    const messageText = payload.messageText.replace(/\s+/g, ' ').trim();
    if (messageText.length <= 0) {
      return { tag: 'err', value: 'message_empty' };
    }
    if (messageText.length > CHAT_MESSAGE_MAX_LENGTH) {
      return { tag: 'err', value: 'message_too_long' };
    }

    pruneExpiredRows(ctx, timestampMs);

    const messageId = `${identity}-${timestampMs}-${ctx.newUuidV4().toString()}`;
    ctx.db.chatMessageEvent.insert({
      messageId,
      ownerIdentity: identity,
      ownerDisplayName: player.displayName,
      messageText,
      createdAtMs: timestampMs,
      expiresAtMs: timestampMs + CHAT_MESSAGE_EVENT_TTL_MS,
    });

    return { tag: 'ok' };
  },
);
