"use client";

/**
 * CharacterRigScene (v2)
 *
 * Thin orchestrator. Responsibilities:
 *   1. Create stable store/builder instances (useMemo).
 *   2. Render <ConnectionStateSync> — null-renderer that owns the three
 *      connection-level tables (connectionState, worldState, diagnostics).
 *   3. Render <GameCanvas> — Three.js canvas; each slice owns its table.
 *   4. Render <GameHUD2> — HTML overlays; each slice owns its table.
 *
 * Re-render contract:
 *   - GameSceneContent itself holds no useSyncExternalStore and no useTable.
 *     It re-renders only on its own useState changes (camera mode, walk toggle).
 *   - Every useTable() subscription lives in the leaf component that consumes
 *     the data. Network ticks cascade only to those leaves, never upward.
 */

import { SpacetimeDBProvider } from "spacetimedb/react";
import {
  useSpacetimeDB,
  useTable,
} from "spacetimedb/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraMode } from "../camera/cameraTypes";
import type { MobileMoveInput } from "../controller/controllerTypes";
import {
  createMultiplayerStore,
  setLocalDisplayName,
  setMultiplayerConnectionStatus,
  setMultiplayerIdentity,
  setServerTimeOffsetMs,
  setWorldDayCycleConfig,
  setMultiplayerDiagnostics,
  type MultiplayerStore,
} from "../multiplayer/state/multiplayerStore";
import {
  createSpacetimeConnectionBuilder,
  getOrCreateGuestDisplayName,
  setStoredGuestDisplayName,
  persistMultiplayerToken,
} from "../multiplayer/spacetime/client";
import { DEFAULT_GUEST_DISPLAY_NAME } from "../multiplayer/spacetime/guestDisplayNames";
import { tables } from "../multiplayer/spacetime/bindings";
import type { NetWorldStateRow } from "../multiplayer/state/multiplayerTypes";
import { GameCanvas } from "./GameCanvas";
import { GameHUD2 } from "./GameHUD2";
import { useGameScene } from "./useGameScene";
import {
  GameStartupLoadingScreen,
  useGameStartupPreload,
} from "./useGameStartupPreload";
import type { AuthoritativePlayerState } from "../multiplayer/state/multiplayerTypes";

const DEFAULT_DAY_CYCLE_DURATION_SECONDS = 300;

function pickWorldStateRow(rows: readonly NetWorldStateRow[]): NetWorldStateRow | null {
  if (rows.length <= 0) return null;
  return rows.find((row) => row.id === "global") ?? rows[0];
}

function getConnectionErrorMessage(error: unknown) {
  if (!error) return "unknown_connection_error";
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  const e = error as { message?: unknown };
  if (typeof e.message === "string" && e.message.trim().length > 0) return e.message;
  try {
    const s = JSON.stringify(error);
    if (s && s !== "{}") return s;
  } catch { /* ignore */ }
  return String(error);
}

// ---------------------------------------------------------------------------
// ConnectionStateSync — null-rendering component that owns the three
// connection-level useTable subscriptions plus useSpacetimeDB.
// Re-renders on every connection event, but renders null.
// ---------------------------------------------------------------------------

function ConnectionStateSync({ store }: { store: MultiplayerStore }) {
  const connectionState = useSpacetimeDB();
  const [worldStateRows] = useTable(tables.worldState);
  const [ringDropRows] = useTable(tables.ringDropState);
  const [fireballRows] = useTable(tables.fireballEvent);
  const [chatMessageRows] = useTable(tables.chatMessageEvent);
  const [playerRows] = useTable(tables.playerState);

  const hasConnectedOnceRef = useRef(false);
  const localIdentity = connectionState.identity?.toHexString() ?? null;

  // Token persistence
  useEffect(() => {
    if (connectionState.token && connectionState.token.length > 0) {
      persistMultiplayerToken(connectionState.token);
    }
  }, [connectionState.token]);

  // Identity
  useEffect(() => {
    setMultiplayerIdentity(store, localIdentity);
  }, [localIdentity, store]);

  // Server time reset on disconnect
  useEffect(() => {
    if (!connectionState.isActive) setServerTimeOffsetMs(store, null);
  }, [connectionState.isActive, store]);

  // Connection status
  useEffect(() => {
    if (connectionState.connectionError) {
      setMultiplayerConnectionStatus(store, "error", getConnectionErrorMessage(connectionState.connectionError));
      return;
    }
    if (connectionState.isActive) {
      hasConnectedOnceRef.current = true;
      setMultiplayerConnectionStatus(store, "connected", null);
      return;
    }
    setMultiplayerConnectionStatus(
      store,
      hasConnectedOnceRef.current ? "disconnected" : "connecting",
      null,
    );
  }, [connectionState.connectionError, connectionState.isActive, store]);

  // Connection error logging (dev only)
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !connectionState.connectionError) return;
    console.error("[multiplayer] SpacetimeDB connection error", {
      message: getConnectionErrorMessage(connectionState.connectionError),
      uri: process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? "ws://127.0.0.1:3001",
      module: process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "rings-multiplayer",
      rawError: connectionState.connectionError,
    });
  }, [connectionState.connectionError]);

  // World state → store (day/night cycle config for music + AnimatedSun)
  useEffect(() => {
    const worldState = pickWorldStateRow(worldStateRows);
    if (!worldState) {
      setWorldDayCycleConfig(store, null, DEFAULT_DAY_CYCLE_DURATION_SECONDS);
      return;
    }
    setWorldDayCycleConfig(store, worldState.dayCycleAnchorMs, worldState.dayCycleDurationSeconds);
  }, [store, worldStateRows]);

  // Diagnostics (debug HUD row counts)
  useEffect(() => {
    setMultiplayerDiagnostics(store, {
      playerRowCount: playerRows.length,
      ringRowCount: ringDropRows.length,
      fireballEventRowCount: fireballRows.length,
      chatMessageRowCount: chatMessageRows.length,
    });
  }, [playerRows.length, ringDropRows.length, fireballRows.length, chatMessageRows.length, store]);

  return null;
}

// ---------------------------------------------------------------------------
// GameSceneContent — holds UI state and stable refs. No useTable here.
// ---------------------------------------------------------------------------

function GameSceneContent({ multiplayerStore }: { multiplayerStore: MultiplayerStore }) {
  const {
    worldEntityManager,
    networkFireballSpawnQueueRef,
    playCoin,
    playShoot,
    playJump,
    playGoombaDefeated,
    setFootstepsActive,
    fireballLoops,
    handlePlayerPositionUpdate,
  } = useGameScene(multiplayerStore);

  // Camera + gait state
  const [cameraMode, setCameraMode] = useState<CameraMode>("third_person");
  const [isWalkDefault, setIsWalkDefault] = useState(false);

  const CAMERA_MODE_CYCLE = useMemo<readonly CameraMode[]>(() => ["third_person", "first_person"], []);
  const handleToggleCameraMode = useCallback(() => {
    setCameraMode((c) => {
      const idx = CAMERA_MODE_CYCLE.indexOf(c);
      return CAMERA_MODE_CYCLE[(idx + 1) % CAMERA_MODE_CYCLE.length];
    });
  }, [CAMERA_MODE_CYCLE]);
  const handleToggleDefaultGait = useCallback(() => setIsWalkDefault((v) => !v), []);

  // Shared refs
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const mobileMoveInputRef = useRef<MobileMoveInput>({ x: 0, y: 0 });
  const mobileJumpPressedRef = useRef(false);
  const mobileFireballTriggerRef = useRef(0);
  const damageEventCounterRef = useRef(0);
  const isChatOpenRef = useRef(false);
  const isResumingFromChatRef = useRef(false);

  // authoritativeLocalPlayerState as a ref — written by RemotePlayersSlice,
  // read imperatively by CharacterRigController in useFrame.
  const authoritativeLocalPlayerStateRef = useRef<AuthoritativePlayerState | null>(null);

  // localDisplayName as a ref — written here, read by ControllerSlice's send callback.
  const localDisplayNameRef = useRef(multiplayerStore.state.localDisplayName);
  useEffect(() => {
    const listener = () => {
      localDisplayNameRef.current = multiplayerStore.state.localDisplayName;
    };
    multiplayerStore.listeners.add(listener);
    return () => multiplayerStore.listeners.delete(listener);
  }, [multiplayerStore]);

  // Audio callbacks as refs so GoombaLayerSlice / MysteryBoxLayerSlice never
  // re-render when the audio function identity changes.
  const onGoombaDefeatedRef = useRef(playGoombaDefeated);
  useEffect(() => { onGoombaDefeatedRef.current = playGoombaDefeated; }, [playGoombaDefeated]);
  const onMysteryBoxActivatedRef = useRef(playGoombaDefeated);
  useEffect(() => { onMysteryBoxActivatedRef.current = playGoombaDefeated; }, [playGoombaDefeated]);

  // Pointer lock forwarding
  // GameHUD2 handles pointer lock state internally via pointerlockchange events.
  // The prop is kept for the GameCanvas interface but no action is needed here.
  const handlePointerLockChange = useCallback(() => {}, []);

  // isInputSuspended ref for CharacterRigController
  const isInputSuspendedRef = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      isInputSuspendedRef.current = isChatOpenRef.current || isResumingFromChatRef.current;
    }, 16);
    return () => window.clearInterval(id);
  }, []);

  // Display name
  useEffect(() => {
    const persisted = getOrCreateGuestDisplayName();
    setLocalDisplayName(multiplayerStore, persisted);
  }, [multiplayerStore]);

  const handleSetLocalDisplayName = useCallback(
    (nextDisplayName: string) => {
      const stored = setStoredGuestDisplayName(nextDisplayName);
      if (stored) setLocalDisplayName(multiplayerStore, stored);
    },
    [multiplayerStore],
  );

  const handleCanvasCreated = useCallback((canvas: HTMLCanvasElement) => {
    canvasElementRef.current = canvas;
  }, []);

  return (
    <div className="relative h-full w-full">
      {/* Null-rendering: owns connection-level tables and diagnostics. */}
      <ConnectionStateSync store={multiplayerStore} />
      <div className="h-full w-full">
        <GameCanvas
          store={multiplayerStore}
          worldEntityManager={worldEntityManager}
          cameraMode={cameraMode}
          onToggleCameraMode={handleToggleCameraMode}
          isWalkDefault={isWalkDefault}
          onToggleDefaultGait={handleToggleDefaultGait}
          onPointerLockChange={handlePointerLockChange}
          isInputSuspendedRef={isInputSuspendedRef}
          onPlayerPositionUpdate={handlePlayerPositionUpdate}
          mobileMoveInputRef={mobileMoveInputRef}
          mobileJumpPressedRef={mobileJumpPressedRef}
          mobileFireballTriggerRef={mobileFireballTriggerRef}
          damageEventCounterRef={damageEventCounterRef}
          onLocalShootSound={playShoot}
          onLocalJump={playJump}
          onLocalFootstepsActiveChange={setFootstepsActive}
          authoritativeLocalPlayerStateRef={authoritativeLocalPlayerStateRef}
          networkFireballSpawnQueueRef={networkFireballSpawnQueueRef}
          fireballLoopController={fireballLoops}
          localDisplayNameRef={localDisplayNameRef}
          onGoombaDefeatedRef={onGoombaDefeatedRef}
          onMysteryBoxActivatedRef={onMysteryBoxActivatedRef}
          onCollect={playCoin}
          onCanvasCreated={handleCanvasCreated}
        />
      </div>
      <GameHUD2
        store={multiplayerStore}
        worldEntityManager={worldEntityManager}
        canvasElementRef={canvasElementRef}
        mobileMoveInputRef={mobileMoveInputRef}
        mobileJumpPressedRef={mobileJumpPressedRef}
        mobileFireballTriggerRef={mobileFireballTriggerRef}
        onSetLocalDisplayName={handleSetLocalDisplayName}
        onToggleCameraMode={handleToggleCameraMode}
        onPointerLockChange={handlePointerLockChange}
        onCameraModeChange={setCameraMode}
        isChatOpenRef={isChatOpenRef}
        isResumingFromChatRef={isResumingFromChatRef}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export function CharacterRigScene() {
  const preloadState = useGameStartupPreload();
  const connectionBuilder = useMemo(() => createSpacetimeConnectionBuilder(), []);
  const multiplayerStore = useMemo(() => createMultiplayerStore(DEFAULT_GUEST_DISPLAY_NAME), []);

  if (!preloadState.isReady) {
    return (
      <GameStartupLoadingScreen
        percent={preloadState.percent}
        loaded={preloadState.loaded}
        total={preloadState.total}
        itemLabel={preloadState.itemLabel}
      />
    );
  }

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <GameSceneContent multiplayerStore={multiplayerStore} />
    </SpacetimeDBProvider>
  );
}
