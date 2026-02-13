"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatMessageEvent } from "../multiplayer/state/multiplayerTypes";

function formatChatTimestamp(timestampMs: number) {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatOverlay({
  isOpen,
  messages,
  draftMessage,
  localIdentity,
  onDraftMessageChange,
  onSendMessage,
  onResumeGameplay,
}: {
  isOpen: boolean;
  messages: readonly ChatMessageEvent[];
  draftMessage: string;
  localIdentity: string | null;
  onDraftMessageChange: (value: string) => void;
  onSendMessage: () => void;
  onResumeGameplay: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    inputRef.current?.focus();
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [isOpen, messages]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center p-4 sm:justify-start sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onResumeGameplay();
        }
      }}
    >
      <div className="pointer-events-auto flex w-full max-w-xl flex-col rounded-2xl border border-cyan-200/35 bg-black/70 shadow-[0_14px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-cyan-200/25 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/85">
          <span>Chat</span>
          <button
            type="button"
            onClick={onResumeGameplay}
            aria-label="Close chat"
            className="rounded border border-cyan-200/35 px-2 py-1 text-[10px] tracking-[0.1em] text-cyan-100/90 transition hover:bg-cyan-100/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div
          ref={scrollRef}
          className="max-h-56 min-h-24 overflow-y-auto px-3 py-2 text-xs text-cyan-50/95"
        >
          {messages.length === 0 ? (
            <p className="py-2 text-cyan-100/55">No recent chat yet.</p>
          ) : (
            messages.map((message) => (
              <div key={message.messageId} className="mb-2 last:mb-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className={
                      message.ownerIdentity === localIdentity
                        ? "font-semibold text-cyan-100"
                        : "font-semibold text-cyan-200/90"
                    }
                  >
                    {message.ownerDisplayName}
                  </span>
                  <span className="text-[10px] text-cyan-100/45">
                    {formatChatTimestamp(message.createdAtMs)}
                  </span>
                </div>
                <p className="break-words leading-5 text-cyan-50/95">
                  {message.messageText}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-cyan-200/25 p-2">
          <input
            ref={inputRef}
            type="text"
            value={draftMessage}
            maxLength={120}
            placeholder="Type a message and press Enter"
            onChange={(event) => {
              onDraftMessageChange(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                onResumeGameplay();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                onSendMessage();
              }
            }}
            className="h-10 w-full rounded-lg border border-cyan-200/35 bg-black/45 px-3 text-sm text-cyan-50 outline-none transition placeholder:text-cyan-100/45 focus:border-cyan-100/65 focus:bg-black/55"
          />
        </div>
      </div>
    </div>
  );
}
