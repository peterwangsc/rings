"use client";

import { Physics } from "@react-three/rapier";
import { Canvas } from "@react-three/fiber";
import { SpacetimeDBProvider } from "spacetimedb/react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PCFShadowMap } from "three";
import type { CameraMode } from "../camera/cameraTypes";
import { CharacterRigController } from "../controller/CharacterRigController";
import type { MobileMoveInput } from "../controller/controllerTypes";
import { RingField } from "../gameplay/collectibles/RingField";
import { GoombaLayer } from "../gameplay/goombas/GoombaLayer";
import { RemotePlayersLayer } from "../gameplay/multiplayer/RemotePlayersLayer";
import { ChatOverlay } from "../hud/ChatOverlay";
import { GameHUD } from "../hud/GameHUD";
import { GlobalChatFeed } from "../hud/GlobalChatFeed";
import {
  LeaderboardOverlay,
  type AllTimeLeaderboardEntry,
  type OnlineLeaderboardEntry,
} from "../hud/LeaderboardOverlay";
import {
  createMultiplayerStore,
  setLocalDisplayName,
  useMultiplayerStoreSnapshot,
  type MultiplayerStore,
} from "../multiplayer/state/multiplayerStore";
import type {
  ChatMessageEvent,
  FireballSpawnEvent,
} from "../multiplayer/state/multiplayerTypes";
import { useMultiplayerSync } from "../multiplayer/state/useMultiplayerSync";
import {
  createSpacetimeConnectionBuilder,
  getOrCreateGuestDisplayName,
  setStoredGuestDisplayName,
} from "../multiplayer/spacetime/client";
import { DEFAULT_GUEST_DISPLAY_NAME } from "../multiplayer/spacetime/guestDisplayNames";
import {
  FPS_TOGGLE_KEY,
  HORIZON_COLOR,
  SKY_FOG_FAR,
  SKY_FOG_NEAR,
  THIRD_PERSON_CAMERA_FOV,
  WORLD_GRAVITY_Y,
} from "../utils/constants";
import { AnimatedSun } from "./AnimatedSun";
import { FrameRateProbe } from "./FrameRateProbe";
import { MobileControlsOverlay } from "./MobileControlsOverlay";
import { DesktopSplashOverlay, MobileOrientationOverlay } from "./SceneOverlays";
import { WorldGeometry } from "./WorldGeometry";
import {
  ACTIVE_TERRAIN_CHUNK_RADIUS,
  TERRAIN_CHUNK_SIZE,
} from "./world/terrainChunks";
import {
  createWorldEntityManager,
  disposeWorldEntityManager,
  updateWorldPlayerPosition,
} from "./world/worldEntityManager";

const CAMERA_MODE_CYCLE: readonly CameraMode[] = [
  "third_person",
  "first_person",
];
const ACTIVE_CHUNK_GRID_SIZE = ACTIVE_TERRAIN_CHUNK_RADIUS * 2 + 1;
const ACTIVE_CHUNK_GRID_WORLD_SPAN = ACTIVE_CHUNK_GRID_SIZE * TERRAIN_CHUNK_SIZE;
const CAMERA_FAR_DISTANCE = ACTIVE_CHUNK_GRID_WORLD_SPAN * 1.5;
const CHAT_MESSAGE_MAX_LENGTH = 120;
const CHAT_CLOCK_TICK_MS = 250;
const CHAT_LOG_MAX_MESSAGES = 32;
const CHAT_RESUME_CLOSE_DELAY_MS = 120;
const CHAT_SESSION_HISTORY_MAX_MESSAGES = 512;
const LEADERBOARD_ROW_LIMIT = 15;

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function toFallbackLeaderboardName(identity: string) {
  if (identity.length <= 8) {
    return identity;
  }
  return `${identity.slice(0, 8)}...`;
}

function normalizeLeaderboardName(
  preferredName: string | undefined,
  identity: string,
) {
  const normalized = preferredName?.trim() ?? "";
  if (normalized.length > 0) {
    return normalized;
  }
  return toFallbackLeaderboardName(identity);
}

function CharacterRigSceneContent({
  multiplayerStore,
}: {
  multiplayerStore: MultiplayerStore;
}) {
  const [cameraMode, setCameraMode] = useState<CameraMode>("third_person");
  const [isWalkDefault, setIsWalkDefault] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isFpsVisible, setIsFpsVisible] = useState(false);
  const [isSplashDismissedByTouch, setIsSplashDismissedByTouch] =
    useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isResumingFromChat, setIsResumingFromChat] = useState(false);
  const [isLeaderboardVisible, setIsLeaderboardVisible] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatNowMs, setChatNowMs] = useState(() => Date.now());
  const [chatSessionHistory, setChatSessionHistory] = useState<ChatMessageEvent[]>(
    [],
  );
  const worldEntityManager = useMemo(() => createWorldEntityManager(), []);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const resumeFromChatTimeoutRef = useRef<number | null>(null);
  const mobileMoveInputRef = useRef<MobileMoveInput>({ x: 0, y: 0 });
  const mobileJumpPressedRef = useRef(false);
  const mobileFireballTriggerRef = useRef(0);
  const networkFireballSpawnQueueRef = useRef<FireballSpawnEvent[]>([]);

  const multiplayerVersion = useMultiplayerStoreSnapshot(multiplayerStore);
  void multiplayerVersion;

  const {
    sendLocalPlayerSnapshot,
    sendLocalFireballCast,
    sendRingCollect,
    sendChatMessage,
    sendGoombaHit,
  } = useMultiplayerSync({
    store: multiplayerStore,
    worldEntityManager,
    networkFireballSpawnQueueRef,
  });

  const multiplayerState = multiplayerStore.state;
  const hasAuthoritativeMultiplayer =
    multiplayerState.connectionStatus === "connected";
  const remotePlayers = useMemo(
    () => Array.from(multiplayerState.remotePlayers.values()),
    [multiplayerState.remotePlayers],
  );
  const goombas = useMemo(
    () => Array.from(multiplayerState.goombas.values()),
    [multiplayerState.goombas],
  );
  const activeChatMessages = useMemo(() => {
    const visible = multiplayerState.chatMessages.filter(
      (message) => message.expiresAtMs > chatNowMs,
    );
    if (visible.length <= CHAT_LOG_MAX_MESSAGES) {
      return visible;
    }
    return visible.slice(visible.length - CHAT_LOG_MAX_MESSAGES);
  }, [chatNowMs, multiplayerState.chatMessages]);
  const activeChatByIdentity = useMemo(() => {
    const next = new Map<string, string>();
    for (const message of activeChatMessages) {
      next.set(message.ownerIdentity, message.messageText);
    }
    return next;
  }, [activeChatMessages]);
  const onlineLeaderboardEntries = useMemo(() => {
    const entries: OnlineLeaderboardEntry[] = [];
    const inventoryByIdentity = multiplayerState.playerInventories;
    const statsByIdentity = multiplayerState.playerStats;

    const localPlayer = multiplayerState.authoritativeLocalPlayerState;
    if (localPlayer) {
      const inventory = inventoryByIdentity.get(localPlayer.identity);
      const stats = statsByIdentity.get(localPlayer.identity);
      const ringCount = inventory?.ringCount ?? 0;
      entries.push({
        identity: localPlayer.identity,
        displayName: normalizeLeaderboardName(
          stats?.displayName ?? localPlayer.displayName ?? multiplayerState.localDisplayName,
          localPlayer.identity,
        ),
        ringCount,
        highestRingCount: Math.max(stats?.highestRingCount ?? 0, ringCount),
      });
    }

    for (const player of remotePlayers) {
      const inventory = inventoryByIdentity.get(player.identity);
      const stats = statsByIdentity.get(player.identity);
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

    entries.sort((a, b) => {
      if (a.ringCount !== b.ringCount) {
        return b.ringCount - a.ringCount;
      }
      if (a.highestRingCount !== b.highestRingCount) {
        return b.highestRingCount - a.highestRingCount;
      }
      const nameSort = a.displayName.localeCompare(b.displayName);
      if (nameSort !== 0) {
        return nameSort;
      }
      return a.identity.localeCompare(b.identity);
    });

    return entries.slice(0, LEADERBOARD_ROW_LIMIT);
  }, [
    multiplayerState.authoritativeLocalPlayerState,
    multiplayerState.localDisplayName,
    multiplayerState.playerInventories,
    multiplayerState.playerStats,
    remotePlayers,
  ]);
  const allTimeLeaderboardEntries = useMemo(() => {
    const entries: AllTimeLeaderboardEntry[] = Array.from(
      multiplayerState.playerStats.values(),
    ).map((stats) => ({
      identity: stats.identity,
      displayName: normalizeLeaderboardName(stats.displayName, stats.identity),
      highestRingCount: stats.highestRingCount,
    }));

    entries.sort((a, b) => {
      if (a.highestRingCount !== b.highestRingCount) {
        return b.highestRingCount - a.highestRingCount;
      }
      const nameSort = a.displayName.localeCompare(b.displayName);
      if (nameSort !== 0) {
        return nameSort;
      }
      return a.identity.localeCompare(b.identity);
    });

    return entries.slice(0, LEADERBOARD_ROW_LIMIT);
  }, [multiplayerState.playerStats]);

  const handleToggleCameraMode = useCallback(() => {
    setCameraMode((currentMode) => {
      const currentModeIndex = CAMERA_MODE_CYCLE.indexOf(currentMode);
      const nextModeIndex = (currentModeIndex + 1) % CAMERA_MODE_CYCLE.length;
      return CAMERA_MODE_CYCLE[nextModeIndex];
    });
  }, []);

  const handleToggleDefaultGait = useCallback(() => {
    setIsWalkDefault((currentMode) => !currentMode);
  }, []);

  const handlePointerLockChange = useCallback((isLocked: boolean) => {
    setIsPointerLocked(isLocked);
    if (!isLocked) {
      return;
    }
    if (resumeFromChatTimeoutRef.current !== null) {
      window.clearTimeout(resumeFromChatTimeoutRef.current);
      resumeFromChatTimeoutRef.current = null;
    }
    setIsResumingFromChat(false);
    setIsChatOpen(false);
  }, []);

  const handleFpsUpdate = useCallback((nextFps: number) => {
    const roundedFps = Math.round(nextFps);
    setFps((currentFps) =>
      currentFps === roundedFps ? currentFps : roundedFps,
    );
  }, []);

  const handleToggleFpsOverlay = useCallback(() => {
    setIsFpsVisible((isVisible) => !isVisible);
  }, []);

  const handleSetLocalDisplayName = useCallback(
    (nextDisplayName: string) => {
      const storedDisplayName = setStoredGuestDisplayName(nextDisplayName);
      if (!storedDisplayName) {
        return;
      }
      setLocalDisplayName(multiplayerStore, storedDisplayName);
    },
    [multiplayerStore],
  );

  const handleSendChatMessage = useCallback(() => {
    const normalized = chatDraft.replace(/\s+/g, " ").trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);
    if (normalized.length > 0) {
      sendChatMessage(normalized);
    }
    setChatDraft("");
  }, [chatDraft, sendChatMessage]);

  const requestGameplayPointerLock = useCallback(() => {
    const canvas = canvasElementRef.current;
    if (!canvas) {
      return;
    }
    if (document.pointerLockElement === canvas) {
      return;
    }
    if (typeof canvas.requestPointerLock === "function") {
      canvas.requestPointerLock();
    }
  }, []);

  const handleResumeGameplayFromChat = useCallback(() => {
    setIsResumingFromChat(true);
    setIsLeaderboardVisible(false);
    requestGameplayPointerLock();
    if (resumeFromChatTimeoutRef.current !== null) {
      window.clearTimeout(resumeFromChatTimeoutRef.current);
    }
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

  const handleToggleLeaderboardOverlay = useCallback(() => {
    setIsLeaderboardVisible((isVisible) => !isVisible);
  }, []);

  const handlePlayerPositionUpdate = useCallback(
    (x: number, y: number, z: number) => {
      updateWorldPlayerPosition(worldEntityManager, x, y, z);
    },
    [worldEntityManager],
  );

  useEffect(() => {
    return () => {
      disposeWorldEntityManager(worldEntityManager);
    };
  }, [worldEntityManager]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === FPS_TOGGLE_KEY && !event.repeat) {
        handleToggleFpsOverlay();
      }

      if (event.code === "Tab") {
        if (isEditableEventTarget(event.target)) {
          return;
        }
        if (isChatOpen || isResumingFromChat) {
          return;
        }
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
        if (isEditableEventTarget(event.target)) {
          return;
        }
        event.preventDefault();
        handleOpenChatOverlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    handleOpenChatOverlay,
    handleResumeGameplayFromChat,
    handleToggleFpsOverlay,
    isChatOpen,
    isResumingFromChat,
  ]);

  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Tab") {
        return;
      }
      if (isEditableEventTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setIsLeaderboardVisible(false);
    };

    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (resumeFromChatTimeoutRef.current !== null) {
        window.clearTimeout(resumeFromChatTimeoutRef.current);
        resumeFromChatTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        setIsSplashDismissedByTouch(true);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const persistedDisplayName = getOrCreateGuestDisplayName();
    setLocalDisplayName(multiplayerStore, persistedDisplayName);
  }, [multiplayerStore]);

  useEffect(() => {
    if (!isChatOpen || isResumingFromChat) {
      return;
    }
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [isChatOpen, isResumingFromChat]);

  useEffect(() => {
    const handleWindowBlur = () => {
      setIsLeaderboardVisible(false);
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (multiplayerState.chatMessages.length === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setChatNowMs(Date.now());
    }, CHAT_CLOCK_TICK_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [multiplayerState.chatMessages.length]);

  useEffect(() => {
    if (multiplayerState.chatMessages.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setChatSessionHistory((currentHistory) => {
        const nextHistory = [...currentHistory];
        const knownIds = new Set(
          nextHistory.map((message) => message.messageId),
        );
        const incoming = [...multiplayerState.chatMessages].sort(
          (a, b) => a.createdAtMs - b.createdAtMs,
        );
        let didChange = false;

        for (const message of incoming) {
          if (knownIds.has(message.messageId)) {
            continue;
          }
          knownIds.add(message.messageId);
          nextHistory.push(message);
          didChange = true;
        }

        if (!didChange) {
          return currentHistory;
        }

        if (nextHistory.length > CHAT_SESSION_HISTORY_MAX_MESSAGES) {
          return nextHistory.slice(
            nextHistory.length - CHAT_SESSION_HISTORY_MAX_MESSAGES,
          );
        }

        return nextHistory;
      });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [multiplayerState.chatMessages]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{
          fov: THIRD_PERSON_CAMERA_FOV,
          near: 0.1,
          far: CAMERA_FAR_DISTANCE,
          position: [0, 2.2, 6],
        }}
        onCreated={({ gl }) => {
          canvasElementRef.current = gl.domElement;
        }}
        className="h-full w-full touch-none"
      >
        <AnimatedSun
          worldEntityManager={worldEntityManager}
          dayCycleAnchorMs={multiplayerState.dayCycleAnchorMs}
          dayCycleDurationSeconds={multiplayerState.dayCycleDurationSeconds}
          estimatedServerTimeOffsetMs={multiplayerState.serverTimeOffsetMs}
        />
        {isFpsVisible ? <FrameRateProbe onUpdate={handleFpsUpdate} /> : null}
        <fog attach="fog" args={[HORIZON_COLOR, SKY_FOG_NEAR, SKY_FOG_FAR]} />
        <Physics gravity={[0, WORLD_GRAVITY_Y, 0]}>
          <Suspense fallback={null}>
            <WorldGeometry worldEntityManager={worldEntityManager} />
            <RingField
              worldEntityManager={worldEntityManager}
              onCollectRing={
                hasAuthoritativeMultiplayer ? sendRingCollect : undefined
              }
            />
            <GoombaLayer goombas={goombas} />
            <RemotePlayersLayer
              players={remotePlayers}
              activeChatByIdentity={activeChatByIdentity}
            />
            <CharacterRigController
              cameraMode={cameraMode}
              onToggleCameraMode={handleToggleCameraMode}
              isWalkDefault={isWalkDefault}
              onToggleDefaultGait={handleToggleDefaultGait}
              onPointerLockChange={handlePointerLockChange}
              isInputSuspended={isChatOpen || isResumingFromChat}
              onPlayerPositionUpdate={handlePlayerPositionUpdate}
              mobileMoveInputRef={mobileMoveInputRef}
              mobileJumpPressedRef={mobileJumpPressedRef}
              mobileFireballTriggerRef={mobileFireballTriggerRef}
              fireballManager={worldEntityManager.fireballManager}
              onLocalPlayerSnapshot={sendLocalPlayerSnapshot}
              onLocalFireballCast={sendLocalFireballCast}
              goombas={goombas}
              onLocalGoombaHit={sendGoombaHit}
              authoritativeLocalPlayerState={
                multiplayerState.authoritativeLocalPlayerState
              }
              networkFireballSpawnQueueRef={networkFireballSpawnQueueRef}
            />
          </Suspense>
        </Physics>
      </Canvas>
      <GameHUD
        worldEntityManager={worldEntityManager}
        localDisplayName={multiplayerState.localDisplayName}
        connectionStatus={multiplayerState.connectionStatus}
        remotePlayerCount={remotePlayers.length}
      />
      <GlobalChatFeed
        messages={activeChatMessages}
        localIdentity={multiplayerState.localIdentity}
      />
      <LeaderboardOverlay
        isVisible={isLeaderboardVisible}
        onlineEntries={onlineLeaderboardEntries}
        allTimeEntries={allTimeLeaderboardEntries}
        onClose={() => {
          setIsLeaderboardVisible(false);
        }}
      />
      <ChatOverlay
        isOpen={isChatOpen}
        messages={chatSessionHistory}
        draftMessage={chatDraft}
        localIdentity={multiplayerState.localIdentity}
        onDraftMessageChange={setChatDraft}
        onSendMessage={handleSendChatMessage}
        onResumeGameplay={handleResumeGameplayFromChat}
      />
      {isFpsVisible ? (
        <div className="ui-nonselectable pointer-events-none absolute right-4 top-4 z-20 rounded-lg border border-white/35 bg-black/40 px-3 py-2 text-[11px] leading-4 text-white/95 backdrop-blur-sm">
          <p className="font-semibold tracking-wide text-white">FPS</p>
          <p>{fps ?? "--"}</p>
        </div>
      ) : null}
      <DesktopSplashOverlay
        isPointerLocked={isPointerLocked}
        isSplashDismissedByTouch={isSplashDismissedByTouch}
        isChatOpen={isChatOpen || isResumingFromChat}
        localDisplayName={multiplayerState.localDisplayName}
        onSetLocalDisplayName={handleSetLocalDisplayName}
      />
      <MobileControlsOverlay
        moveInputRef={mobileMoveInputRef}
        jumpPressedRef={mobileJumpPressedRef}
        fireballTriggerRef={mobileFireballTriggerRef}
        onToggleCameraMode={handleToggleCameraMode}
        onOpenChat={handleOpenChatOverlay}
        onToggleLeaderboard={handleToggleLeaderboardOverlay}
        isLeaderboardVisible={isLeaderboardVisible}
        isChatOpen={isChatOpen || isResumingFromChat}
      />
      <MobileOrientationOverlay
        localDisplayName={multiplayerState.localDisplayName}
        onSetLocalDisplayName={handleSetLocalDisplayName}
      />
    </div>
  );
}

export function CharacterRigScene() {
  const connectionBuilder = useMemo(() => createSpacetimeConnectionBuilder(), []);
  const multiplayerStore = useMemo(
    () => createMultiplayerStore(DEFAULT_GUEST_DISPLAY_NAME),
    [],
  );

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <CharacterRigSceneContent multiplayerStore={multiplayerStore} />
    </SpacetimeDBProvider>
  );
}
