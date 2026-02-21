"use client";

/**
 * GameHUD2
 *
 * All HTML overlays (HUD, chat, leaderboard, splash, mobile controls, FPS).
 *
 * Each slice subscribes directly to the store slice and/or SpacetimeDB table
 * it needs, so only the relevant child re-renders when that slice changes.
 * Nothing here touches the R3F Canvas.
 *
 * Table ownership:
 *   - LeaderboardSlice → useTable(playerInventory) + useTable(playerStats)
 *   - ChatFeedSlice    → useTable(chatMessageEvent) + useSpacetimeReducer(sendChatMessage)
 *   (playerState and chatMessageEvent are also ingested in GameCanvas slices,
 *    but those writes to the store are cheap and idempotent.)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MutableRefObject } from "react";
import {
  useReducer as useSpacetimeReducer,
  useTable,
} from "spacetimedb/react";
import { ChatOverlay } from "../hud/ChatOverlay";
import { GameHUD } from "../hud/GameHUD";
import { GlobalChatFeed } from "../hud/GlobalChatFeed";
import {
  LeaderboardOverlay,
  type AllTimeLeaderboardEntry,
  type OnlineLeaderboardEntry,
} from "../hud/LeaderboardOverlay";
import {
  useConnectionStatus,
  useLocalDisplayName,
  useLocalIdentity,
  useRemotePlayers,
  useChatMessages,
  useAuthoritativeLocalPlayer,
  useRemotePlayerCount,
  setPlayerInventories,
  setPlayerStats,
  type MultiplayerStore,
} from "../multiplayer/state/multiplayerStore";
import { tables, reducers } from "../multiplayer/spacetime/bindings";
import type {
  ChatMessageEvent,
  NetPlayerInventoryRow,
  NetPlayerStatsRow,
  PlayerInventorySnapshot,
  PlayerStatsSnapshot,
} from "../multiplayer/state/multiplayerTypes";
import { toSendChatMessageCommand } from "../multiplayer/protocol";
import type { WorldEntityManager } from "./world/worldEntityManager";
import { DesktopSplashOverlay, MobileOrientationOverlay } from "./SceneOverlays";
import { MobileControlsOverlay } from "./MobileControlsOverlay";
import type { MobileMoveInput } from "../controller/controllerTypes";

const FPS_TOGGLE_KEY = "KeyF";
const CHAT_CLOCK_TICK_MS = 250;
const CHAT_LOG_MAX_MESSAGES = 32;
const CHAT_RESUME_CLOSE_DELAY_MS = 120;
const CHAT_SESSION_HISTORY_MAX_MESSAGES = 512;
const LEADERBOARD_ROW_LIMIT = 15;

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function toFallbackLeaderboardName(identity: string) {
  return identity.length <= 8 ? identity : `${identity.slice(0, 8)}...`;
}

function normalizeLeaderboardName(preferredName: string | undefined, identity: string) {
  const normalized = preferredName?.trim() ?? "";
  return normalized.length > 0 ? normalized : toFallbackLeaderboardName(identity);
}

// Row converters (same logic as was in useMultiplayerSync)

function toPlayerInventorySnapshot(
  row: NetPlayerInventoryRow,
  previous?: PlayerInventorySnapshot,
): PlayerInventorySnapshot {
  const ringCount = Math.max(0, Math.floor(row.ringCount));
  if (
    previous &&
    previous.identity === row.identity &&
    previous.ringCount === ringCount &&
    previous.updatedAtMs === row.updatedAtMs
  ) {
    return previous;
  }
  return { identity: row.identity, ringCount, updatedAtMs: row.updatedAtMs };
}

function toPlayerStatsSnapshot(
  row: NetPlayerStatsRow,
  previous?: PlayerStatsSnapshot,
): PlayerStatsSnapshot {
  const normalizedDisplayName = row.displayName.trim();
  const displayName = normalizedDisplayName.length > 0 ? normalizedDisplayName : "Guest";
  const highestRingCount = Math.max(0, Math.floor(row.highestRingCount));
  if (
    previous &&
    previous.identity === row.identity &&
    previous.displayName === displayName &&
    previous.highestRingCount === highestRingCount &&
    previous.updatedAtMs === row.updatedAtMs
  ) {
    return previous;
  }
  return { identity: row.identity, displayName, highestRingCount, updatedAtMs: row.updatedAtMs };
}

// ---------------------------------------------------------------------------
// Isolated child components — each subscribes only to its slice
// ---------------------------------------------------------------------------

function HudSlice({
  store,
  worldEntityManager,
}: {
  store: MultiplayerStore;
  worldEntityManager: WorldEntityManager;
}) {
  const connectionStatus = useConnectionStatus(store);
  const localDisplayName = useLocalDisplayName(store);
  const remotePlayerCount = useRemotePlayerCount(store);
  return (
    <GameHUD
      worldEntityManager={worldEntityManager}
      localDisplayName={localDisplayName}
      connectionStatus={connectionStatus}
      remotePlayerCount={remotePlayerCount}
    />
  );
}

// ChatFeedSlice — owns useTable(chatMessageEvent) + useSpacetimeReducer(sendChatMessage)
// It writes chat messages to the store so RemotePlayersLayer (in GameCanvas) can
// also show them as player labels without duplicating the ingest logic.
// Note: RemotePlayersSlice in GameCanvas ALSO reads from useTable(chatMessageEvent)
// and writes to the store. Both writes are idempotent (setChatMessages diffs before emitting).

function ChatFeedSlice({
  store,
  chatNowMs,
  onSendChatMessageReady,
}: {
  store: MultiplayerStore;
  chatNowMs: number;
  /** Called once on mount with the stable sendChatMessage function. */
  onSendChatMessageReady: (fn: (text: string) => void) => void;
}) {
  const sendChatMessageReducer = useSpacetimeReducer(reducers.sendChatMessage);

  // Expose the send function to the parent (GameHUD2) via callback on mount.
  // We use a ref to keep the exposed function stable even if the reducer identity changes.
  const sendChatMessageReducerRef = useRef(sendChatMessageReducer);
  useEffect(() => { sendChatMessageReducerRef.current = sendChatMessageReducer; }, [sendChatMessageReducer]);

  useEffect(() => {
    onSendChatMessageReady((text: string) => {
      const command = toSendChatMessageCommand(text);
      if (!command) return;
      sendChatMessageReducerRef.current(command);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chatMessages = useChatMessages(store);
  const localIdentity = useLocalIdentity(store);

  const activeChatMessages = useMemo(() => {
    const visible = chatMessages.filter((m) => m.expiresAtMs > chatNowMs);
    if (visible.length <= CHAT_LOG_MAX_MESSAGES) return visible;
    return visible.slice(visible.length - CHAT_LOG_MAX_MESSAGES);
  }, [chatMessages, chatNowMs]);

  return (
    <GlobalChatFeed messages={activeChatMessages} localIdentity={localIdentity} />
  );
}

// LeaderboardSlice — owns useTable(playerInventory) + useTable(playerStats)
function LeaderboardSlice({
  store,
  isVisible,
  onClose,
}: {
  store: MultiplayerStore;
  isVisible: boolean;
  onClose: () => void;
}) {
  const [playerInventoryRows] = useTable(tables.playerInventory);
  const [playerStatsRows] = useTable(tables.playerStats);

  const playerInventoriesBufferRef = useRef<Map<string, PlayerInventorySnapshot>>(new Map());
  const playerStatsBufferRef = useRef<Map<string, PlayerStatsSnapshot>>(new Map());

  // Sync inventory rows → store
  useEffect(() => {
    const inventoryByIdentity = playerInventoriesBufferRef.current;
    inventoryByIdentity.clear();
    const previousInventories = store.state.playerInventories;
    for (const row of playerInventoryRows) {
      inventoryByIdentity.set(
        row.identity,
        toPlayerInventorySnapshot(row, previousInventories.get(row.identity)),
      );
    }
    setPlayerInventories(store, inventoryByIdentity);
  }, [playerInventoryRows, store]);

  // Sync stats rows → store
  useEffect(() => {
    const statsByIdentity = playerStatsBufferRef.current;
    statsByIdentity.clear();
    const previousStats = store.state.playerStats;
    for (const row of playerStatsRows) {
      statsByIdentity.set(
        row.identity,
        toPlayerStatsSnapshot(row, previousStats.get(row.identity)),
      );
    }
    setPlayerStats(store, statsByIdentity);
  }, [playerStatsRows, store]);

  const remotePlayers = useRemotePlayers(store);
  const localPlayer = useAuthoritativeLocalPlayer(store);
  const localDisplayName = useLocalDisplayName(store);
  const playerInventories = store.state.playerInventories;
  const playerStats = store.state.playerStats;

  const onlineLeaderboardEntries = useMemo<OnlineLeaderboardEntry[]>(() => {
    if (!isVisible) return [];
    const entries: OnlineLeaderboardEntry[] = [];

    if (localPlayer) {
      const inventory = playerInventories.get(localPlayer.identity);
      const stats = playerStats.get(localPlayer.identity);
      const ringCount = inventory?.ringCount ?? 0;
      entries.push({
        identity: localPlayer.identity,
        displayName: normalizeLeaderboardName(
          stats?.displayName ?? localPlayer.displayName ?? localDisplayName,
          localPlayer.identity,
        ),
        ringCount,
        highestRingCount: Math.max(stats?.highestRingCount ?? 0, ringCount),
      });
    }

    for (const player of remotePlayers.values()) {
      const inventory = playerInventories.get(player.identity);
      const stats = playerStats.get(player.identity);
      const ringCount = inventory?.ringCount ?? 0;
      entries.push({
        identity: player.identity,
        displayName: normalizeLeaderboardName(
          stats?.displayName ?? player.displayName,
          player.identity,
        ),
        ringCount,
        highestRingCount: Math.max(stats?.highestRingCount ?? 0, ringCount),
      });
    }

    const ranked = entries.filter((e) => e.highestRingCount > 0);
    ranked.sort((a, b) => {
      if (a.ringCount !== b.ringCount) return b.ringCount - a.ringCount;
      if (a.highestRingCount !== b.highestRingCount) return b.highestRingCount - a.highestRingCount;
      const n = a.displayName.localeCompare(b.displayName);
      if (n !== 0) return n;
      return a.identity.localeCompare(b.identity);
    });
    return ranked.slice(0, LEADERBOARD_ROW_LIMIT);
  }, [isVisible, localPlayer, localDisplayName, playerInventories, playerStats, remotePlayers]);

  const allTimeLeaderboardEntries = useMemo<AllTimeLeaderboardEntry[]>(() => {
    if (!isVisible) return [];
    const entries = Array.from(playerStats.values())
      .filter((s) => s.highestRingCount > 0)
      .map((s) => ({
        identity: s.identity,
        displayName: normalizeLeaderboardName(s.displayName, s.identity),
        highestRingCount: s.highestRingCount,
      }));
    entries.sort((a, b) => {
      if (a.highestRingCount !== b.highestRingCount) return b.highestRingCount - a.highestRingCount;
      const n = a.displayName.localeCompare(b.displayName);
      if (n !== 0) return n;
      return a.identity.localeCompare(b.identity);
    });
    return entries.slice(0, LEADERBOARD_ROW_LIMIT);
  }, [isVisible, playerStats]);

  return (
    <LeaderboardOverlay
      isVisible={isVisible}
      onlineEntries={onlineLeaderboardEntries}
      allTimeEntries={allTimeLeaderboardEntries}
      onClose={onClose}
    />
  );
}

function SplashSlice({
  store,
  isPointerLocked,
  isSplashDismissedByTouch,
  isChatOpen,
  onSetLocalDisplayName,
}: {
  store: MultiplayerStore;
  isPointerLocked: boolean;
  isSplashDismissedByTouch: boolean;
  isChatOpen: boolean;
  onSetLocalDisplayName: (name: string) => void;
}) {
  const localDisplayName = useLocalDisplayName(store);
  return (
    <>
      <DesktopSplashOverlay
        isPointerLocked={isPointerLocked}
        isSplashDismissedByTouch={isSplashDismissedByTouch}
        isChatOpen={isChatOpen}
        localDisplayName={localDisplayName}
        onSetLocalDisplayName={onSetLocalDisplayName}
      />
      <MobileOrientationOverlay
        localDisplayName={localDisplayName}
        onSetLocalDisplayName={onSetLocalDisplayName}
      />
    </>
  );
}

function ChatOverlaySlice({
  store,
  isOpen,
  chatSessionHistory,
  chatDraft,
  onDraftMessageChange,
  onSendMessage,
  onResumeGameplay,
}: {
  store: MultiplayerStore;
  isOpen: boolean;
  chatSessionHistory: readonly ChatMessageEvent[];
  chatDraft: string;
  onDraftMessageChange: (v: string) => void;
  onSendMessage: () => void;
  onResumeGameplay: () => void;
}) {
  const localIdentity = useLocalIdentity(store);
  return (
    <ChatOverlay
      isOpen={isOpen}
      messages={chatSessionHistory}
      draftMessage={chatDraft}
      localIdentity={localIdentity}
      onDraftMessageChange={onDraftMessageChange}
      onSendMessage={onSendMessage}
      onResumeGameplay={onResumeGameplay}
    />
  );
}

// ---------------------------------------------------------------------------
// GameHUD2 — the root HUD component
// ---------------------------------------------------------------------------

export interface GameHUD2Props {
  store: MultiplayerStore;
  worldEntityManager: WorldEntityManager;
  canvasElementRef: MutableRefObject<HTMLCanvasElement | null>;
  mobileMoveInputRef: MutableRefObject<MobileMoveInput>;
  mobileJumpPressedRef: MutableRefObject<boolean>;
  mobileFireballTriggerRef: MutableRefObject<number>;
  onSetLocalDisplayName: (name: string) => void;
  onToggleCameraMode: () => void;
  onPointerLockChange: (isLocked: boolean) => void;
  onCameraModeChange: (mode: import("../camera/cameraTypes").CameraMode) => void;
  isChatOpenRef: MutableRefObject<boolean>;
  isResumingFromChatRef: MutableRefObject<boolean>;
}

export function GameHUD2({
  store,
  worldEntityManager,
  canvasElementRef,
  mobileMoveInputRef,
  mobileJumpPressedRef,
  mobileFireballTriggerRef,
  onSetLocalDisplayName,
  onToggleCameraMode,
  onPointerLockChange,
  isChatOpenRef,
  isResumingFromChatRef,
}: GameHUD2Props) {
  const [isFpsVisible, setIsFpsVisible] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isSplashDismissedByTouch, setIsSplashDismissedByTouch] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isResumingFromChat, setIsResumingFromChat] = useState(false);
  const [isLeaderboardVisible, setIsLeaderboardVisible] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatNowMs, setChatNowMs] = useState(() => Date.now());
  const [chatSessionHistory, setChatSessionHistory] = useState<ChatMessageEvent[]>([]);

  // sendChatMessage is populated by ChatFeedSlice via the callback below
  const sendChatMessageRef = useRef<((text: string) => void) | null>(null);
  const handleSendChatMessageReady = useCallback((fn: (text: string) => void) => {
    sendChatMessageRef.current = fn;
  }, []);

  const resumeFromChatTimeoutRef = useRef<number | null>(null);

  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen, isChatOpenRef]);
  useEffect(() => { isResumingFromChatRef.current = isResumingFromChat; }, [isResumingFromChat, isResumingFromChatRef]);

  const requestGameplayPointerLock = useCallback(() => {
    const canvas = canvasElementRef.current;
    if (!canvas || document.pointerLockElement === canvas) return;
    if (typeof canvas.requestPointerLock === "function") canvas.requestPointerLock();
  }, [canvasElementRef]);

  const handlePointerLockChange = useCallback(
    (isLocked: boolean) => {
      setIsPointerLocked(isLocked);
      onPointerLockChange(isLocked);
      if (!isLocked) return;
      if (resumeFromChatTimeoutRef.current !== null) {
        window.clearTimeout(resumeFromChatTimeoutRef.current);
        resumeFromChatTimeoutRef.current = null;
      }
      setIsResumingFromChat(false);
      setIsChatOpen(false);
    },
    [onPointerLockChange],
  );

  const handleResumeGameplayFromChat = useCallback(() => {
    setIsResumingFromChat(true);
    setIsLeaderboardVisible(false);
    requestGameplayPointerLock();
    if (resumeFromChatTimeoutRef.current !== null) window.clearTimeout(resumeFromChatTimeoutRef.current);
    resumeFromChatTimeoutRef.current = window.setTimeout(() => {
      setIsChatOpen(false);
      setIsResumingFromChat(false);
      resumeFromChatTimeoutRef.current = null;
    }, CHAT_RESUME_CLOSE_DELAY_MS);
  }, [requestGameplayPointerLock]);

  const handleOpenChatOverlay = useCallback(() => {
    if (resumeFromChatTimeoutRef.current !== null) {
      window.clearTimeout(resumeFromChatTimeoutRef.current);
      resumeFromChatTimeoutRef.current = null;
    }
    setIsResumingFromChat(false);
    setIsLeaderboardVisible(false);
    setIsChatOpen(true);
  }, []);

  const handleSendChatMessage = useCallback(() => {
    const normalized = chatDraft.replace(/\s+/g, " ").trim();
    if (normalized.length > 0) sendChatMessageRef.current?.(normalized);
    setChatDraft("");
  }, [chatDraft]);

  const handleFpsUpdate = useCallback((nextFps: number) => {
    const rounded = Math.round(nextFps);
    setFps((cur) => (cur === rounded ? cur : rounded));
  }, []);
  void handleFpsUpdate;

  // Chat clock — ticks only when there are active messages
  const chatMessages = useChatMessages(store);
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const intervalId = window.setInterval(() => setChatNowMs(Date.now()), CHAT_CLOCK_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [chatMessages.length]);

  // Accumulate chat session history
  useEffect(() => {
    if (chatMessages.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatSessionHistory((current) => {
      const knownIds = new Set(current.map((m) => m.messageId));
      let didChange = false;
      const next = [...current];
      for (const message of chatMessages) {
        if (knownIds.has(message.messageId)) continue;
        knownIds.add(message.messageId);
        next.push(message);
        didChange = true;
      }
      if (!didChange) return current;
      if (next.length > CHAT_SESSION_HISTORY_MAX_MESSAGES) {
        return next.slice(next.length - CHAT_SESSION_HISTORY_MAX_MESSAGES);
      }
      return next;
    });
  }, [chatMessages]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === FPS_TOGGLE_KEY && !event.repeat) {
        setIsFpsVisible((v) => !v);
      }
      if (event.code === "Tab") {
        if (isEditableEventTarget(event.target)) return;
        if (isChatOpen || isResumingFromChat) return;
        event.preventDefault();
        setIsLeaderboardVisible(true);
        return;
      }
      if (event.code === "Escape" && isChatOpen) {
        event.preventDefault();
        handleResumeGameplayFromChat();
        return;
      }
      if (event.code === "Enter" && !event.repeat) {
        if (isEditableEventTarget(event.target)) return;
        event.preventDefault();
        handleOpenChatOverlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenChatOverlay, handleResumeGameplayFromChat, isChatOpen, isResumingFromChat]);

  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Tab") return;
      if (isEditableEventTarget(event.target)) return;
      event.preventDefault();
      setIsLeaderboardVisible(false);
    };
    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") setIsSplashDismissedByTouch(true);
    };
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleWindowBlur = () => setIsLeaderboardVisible(false);
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, []);

  useEffect(() => {
    if (!isChatOpen || isResumingFromChat) return;
    if (document.pointerLockElement) document.exitPointerLock();
  }, [isChatOpen, isResumingFromChat]);

  useEffect(() => {
    const onLockChange = () => {
      const canvas = canvasElementRef.current;
      handlePointerLockChange(!!canvas && document.pointerLockElement === canvas);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [canvasElementRef, handlePointerLockChange]);

  useEffect(() => {
    return () => {
      if (resumeFromChatTimeoutRef.current !== null) {
        window.clearTimeout(resumeFromChatTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <HudSlice store={store} worldEntityManager={worldEntityManager} />
      <ChatFeedSlice
        store={store}
        chatNowMs={chatNowMs}
        onSendChatMessageReady={handleSendChatMessageReady}
      />
      <LeaderboardSlice
        store={store}
        isVisible={isLeaderboardVisible}
        onClose={() => setIsLeaderboardVisible(false)}
      />
      <ChatOverlaySlice
        store={store}
        isOpen={isChatOpen}
        chatSessionHistory={chatSessionHistory}
        chatDraft={chatDraft}
        onDraftMessageChange={setChatDraft}
        onSendMessage={handleSendChatMessage}
        onResumeGameplay={handleResumeGameplayFromChat}
      />
      {isFpsVisible && (
        <div className="ui-nonselectable pointer-events-none absolute right-4 top-4 z-20 rounded-lg border border-white/35 bg-black/40 px-3 py-2 text-[11px] leading-4 text-white/95 backdrop-blur-sm">
          <p className="font-semibold tracking-wide text-white">FPS</p>
          <p>{fps ?? "--"}</p>
        </div>
      )}
      <SplashSlice
        store={store}
        isPointerLocked={isPointerLocked}
        isSplashDismissedByTouch={isSplashDismissedByTouch}
        isChatOpen={isChatOpen || isResumingFromChat}
        onSetLocalDisplayName={onSetLocalDisplayName}
      />
      <MobileControlsOverlay
        moveInputRef={mobileMoveInputRef}
        jumpPressedRef={mobileJumpPressedRef}
        fireballTriggerRef={mobileFireballTriggerRef}
        onToggleCameraMode={onToggleCameraMode}
        isChatOpen={isChatOpen || isResumingFromChat}
      />
    </>
  );
}
