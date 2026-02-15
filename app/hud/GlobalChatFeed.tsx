"use client";

import type { ChatMessageEvent } from "../multiplayer/state/multiplayerTypes";

const GLOBAL_CHAT_VISIBLE_COUNT = 6;

export function GlobalChatFeed({
  messages,
  localIdentity,
}: {
  messages: readonly ChatMessageEvent[];
  localIdentity: string | null;
}) {
  if (messages.length === 0) {
    return null;
  }

  const visibleMessages = messages.slice(
    Math.max(0, messages.length - GLOBAL_CHAT_VISIBLE_COUNT),
  );

  return (
    <div className="ui-nonselectable mobile-global-chat-feed pointer-events-none absolute bottom-12 left-8 z-30 w-[min(32rem,calc(100vw-2rem))]">
      <div className="mobile-global-chat-feed__list space-y-1">
        {visibleMessages.map((message) => (
          <p
            key={message.messageId}
            className="text-xs leading-4 text-cyan-50/95"
          >
            <span
              className={
                message.ownerIdentity === localIdentity
                  ? "font-semibold text-cyan-100"
                  : "font-semibold text-cyan-200/90"
              }
            >
              {message.ownerDisplayName}
            </span>
            <span className="mx-1 text-cyan-100/55">:</span>
            <span>{message.messageText}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
