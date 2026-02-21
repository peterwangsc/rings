"use client";

/**
 * GameCanvas
 *
 * The R3F Canvas and all 3D scene content. Each slice component owns its own
 * useTable() subscription and calls store setters directly — no intermediary
 * hook or bridge needed. Re-render isolation is achieved by:
 *
 *   - GoombaLayerSlice     → useTable(goombaState),    re-renders on goomba change only
 *   - MysteryBoxLayerSlice → useTable(mysteryBoxState), re-renders on box change only
 *   - RemotePlayersSlice   → useTable(playerState) + useTable(chatMessageEvent)
 *   - ControllerSlice      → useTable(fireballEvent), owns all player-action reducers
 *   - RingField            → useTable(ringDropState), writes directly to worldEntityManager
 *   - AnimatedSun          → reads store via ref in useFrame, zero React re-renders
 *   - WorldGeometry        → useWorldEntityVersion(), re-renders on chunk change only
 */

import { Physics } from "@react-three/rapier";
import { Canvas } from "@react-three/fiber";
import { Suspense, memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { PCFShadowMap } from "three";
import {
  useReducer as useSpacetimeReducer,
  useSpacetimeDB,
  useTable,
} from "spacetimedb/react";
import type { CameraMode } from "../camera/cameraTypes";
import { CharacterRigController } from "../controller/CharacterRigController";
import type { MobileMoveInput } from "../controller/controllerTypes";
import { RingField } from "../gameplay/collectibles/RingField";
import { GoombaLayer } from "../gameplay/goombas/GoombaLayer";
import { MysteryBoxLayer } from "../gameplay/mysteryBoxes/MysteryBoxLayer";
import { RemotePlayersLayer } from "../gameplay/multiplayer/RemotePlayersLayer";
import type { FireballLoopController } from "../audio/useGameAudio";
import type {
  FireballSpawnEvent,
  NetPlayerSnapshot,
} from "../multiplayer/state/multiplayerTypes";
import type {
  CastFireballCommand,
  HitGoombaCommand,
} from "../multiplayer/protocol";
import {
  useGoombas,
  useMysteryBoxes,
  useRemotePlayers,
  useChatMessages,
  useConnectionStatus,
  setAuthoritativeLocalPlayerState,
  setRemotePlayers,
  setServerTimeOffsetMs,
  setGoombas,
  setMysteryBoxes,
  setChatMessages,
  type MultiplayerStore,
} from "../multiplayer/state/multiplayerStore";
import { tables, reducers } from "../multiplayer/spacetime/bindings";
import type {
  AuthoritativePlayerState,
  ChatMessageEvent,
  GoombaState,
  MysteryBoxState,
  NetPlayerRow,
  NetFireballEventRow,
  NetChatMessageEventRow,
  NetGoombaRow,
  NetMysteryBoxRow,
} from "../multiplayer/state/multiplayerTypes";
import {
  toUpsertPlayerStateCommand,
  toCastFireballCommand,
  toHitGoombaCommand,
  toHitMysteryBoxCommand,
} from "../multiplayer/protocol";
import { persistMultiplayerToken } from "../multiplayer/spacetime/client";
import {
  GOOMBA_INTERACT_DISABLED_STATE,
  MYSTERY_BOX_INTERACT_DISABLED_STATE,
  HORIZON_COLOR,
  SKY_FOG_FAR,
  SKY_FOG_NEAR,
  THIRD_PERSON_CAMERA_FOV,
  WORLD_GRAVITY_Y,
} from "../utils/constants";
import type { WorldEntityManager } from "./world/worldEntityManager";
import { AnimatedSun } from "./AnimatedSun";
import { BirdFlock } from "./BirdFlock";
import { FrameRateProbe } from "./FrameRateProbe";
import { WorldGeometry } from "./WorldGeometry";
import {
  ACTIVE_TERRAIN_CHUNK_RADIUS,
  TERRAIN_CHUNK_SIZE,
} from "./world/terrainChunks";
import type { FireballManager } from "../gameplay/abilities/fireballManager";

const ACTIVE_CHUNK_GRID_SIZE = ACTIVE_TERRAIN_CHUNK_RADIUS * 2 + 1;
const ACTIVE_CHUNK_GRID_WORLD_SPAN =
  ACTIVE_CHUNK_GRID_SIZE * TERRAIN_CHUNK_SIZE;
const CAMERA_FAR_DISTANCE = ACTIVE_CHUNK_GRID_WORLD_SPAN * 1.5;

const SERVER_TIME_OFFSET_SMOOTHING = 0.2;
const GOOMBA_STATE_FALLBACK: GoombaState["state"] = "idle";
const MYSTERY_BOX_STATE_FALLBACK: MysteryBoxState["state"] = "ready";

// ---------------------------------------------------------------------------
// Row → domain object converters
// ---------------------------------------------------------------------------

type MotionState =
  | "idle"
  | "walk"
  | "running"
  | "jump"
  | "jump_running"
  | "happy"
  | "sad";

function toValidMotionState(value: string): MotionState {
  switch (value) {
    case "idle":
    case "walk":
    case "running":
    case "jump":
    case "jump_running":
    case "happy":
    case "sad":
      return value;
    default:
      return "idle";
  }
}

function toAuthoritativePlayerState(
  row: NetPlayerRow,
  previous?: AuthoritativePlayerState,
): AuthoritativePlayerState {
  const motionState = toValidMotionState(row.motionState);
  if (
    previous &&
    previous.identity === row.identity &&
    previous.displayName === row.displayName &&
    previous.x === row.x &&
    previous.y === row.y &&
    previous.z === row.z &&
    previous.yaw === row.yaw &&
    previous.pitch === row.pitch &&
    previous.vx === row.vx &&
    previous.vy === row.vy &&
    previous.vz === row.vz &&
    previous.planarSpeed === row.planarSpeed &&
    previous.motionState === motionState &&
    previous.lastInputSeq === row.lastInputSeq &&
    previous.updatedAtMs === row.updatedAtMs &&
    previous.lastCastAtMs === row.lastCastAtMs
  ) {
    return previous;
  }
  return {
    identity: row.identity,
    displayName: row.displayName,
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    pitch: row.pitch,
    vx: row.vx,
    vy: row.vy,
    vz: row.vz,
    planarSpeed: row.planarSpeed,
    motionState,
    lastInputSeq: row.lastInputSeq,
    updatedAtMs: row.updatedAtMs,
    lastCastAtMs: row.lastCastAtMs,
  };
}

function toFireballSpawnEvent(row: NetFireballEventRow): FireballSpawnEvent {
  return {
    eventId: row.eventId,
    ownerIdentity: row.ownerIdentity,
    originX: row.originX,
    originY: row.originY,
    originZ: row.originZ,
    directionX: row.directionX,
    directionY: row.directionY,
    directionZ: row.directionZ,
    createdAtMs: row.createdAtMs,
    expiresAtMs: row.expiresAtMs,
  };
}

function toChatMessageEvent(
  row: NetChatMessageEventRow,
  previous?: ChatMessageEvent,
): ChatMessageEvent {
  if (
    previous &&
    previous.messageId === row.messageId &&
    previous.ownerIdentity === row.ownerIdentity &&
    previous.ownerDisplayName === row.ownerDisplayName &&
    previous.messageText === row.messageText &&
    previous.createdAtMs === row.createdAtMs &&
    previous.expiresAtMs === row.expiresAtMs
  ) {
    return previous;
  }
  return {
    messageId: row.messageId,
    ownerIdentity: row.ownerIdentity,
    ownerDisplayName: row.ownerDisplayName,
    messageText: row.messageText,
    createdAtMs: row.createdAtMs,
    expiresAtMs: row.expiresAtMs,
  };
}

function toValidGoombaState(value: string): GoombaState["state"] {
  switch (value) {
    case "idle":
    case "charge":
    case "enraged":
    case "cooldown":
    case "defeated":
      return value;
    default:
      return GOOMBA_STATE_FALLBACK;
  }
}

function toGoombaState(row: NetGoombaRow, previous?: GoombaState): GoombaState {
  const state = toValidGoombaState(row.state);
  if (
    previous &&
    previous.goombaId === row.goombaId &&
    previous.spawnX === row.spawnX &&
    previous.spawnY === row.spawnY &&
    previous.spawnZ === row.spawnZ &&
    previous.x === row.x &&
    previous.y === row.y &&
    previous.z === row.z &&
    previous.yaw === row.yaw &&
    previous.state === state &&
    previous.stateEndsAtMs === row.stateEndsAtMs &&
    previous.updatedAtMs === row.updatedAtMs
  ) {
    return previous;
  }
  return {
    goombaId: row.goombaId,
    spawnX: row.spawnX,
    spawnY: row.spawnY,
    spawnZ: row.spawnZ,
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    state,
    stateEndsAtMs: row.stateEndsAtMs,
    updatedAtMs: row.updatedAtMs,
  };
}

function toValidMysteryBoxState(value: string): MysteryBoxState["state"] {
  switch (value) {
    case "ready":
    case "depleted":
      return value;
    default:
      return MYSTERY_BOX_STATE_FALLBACK;
  }
}

function toMysteryBoxState(
  row: NetMysteryBoxRow,
  previous?: MysteryBoxState,
): MysteryBoxState {
  const state = toValidMysteryBoxState(row.state);
  if (
    previous &&
    previous.mysteryBoxId === row.mysteryBoxId &&
    previous.x === row.x &&
    previous.y === row.y &&
    previous.z === row.z &&
    previous.state === state
  ) {
    return previous;
  }
  return {
    mysteryBoxId: row.mysteryBoxId,
    x: row.x,
    y: row.y,
    z: row.z,
    state,
  };
}

function warnInvalidCommand(commandName: string, details: unknown) {
  if (process.env.NODE_ENV === "production") return;
  console.warn(`[multiplayer] dropped invalid ${commandName} command`, details);
}

// ---------------------------------------------------------------------------
// GoombaLayerSlice — owns useTable(goombaState)
// ---------------------------------------------------------------------------

const GoombaLayerSlice = memo(function GoombaLayerSlice({
  store,
  onGoombaDefeatedRef,
}: {
  store: MultiplayerStore;
  onGoombaDefeatedRef: MutableRefObject<() => void>;
}) {
  const [goombaRows] = useTable(tables.goombaState);
  const bufferRef = useRef<Map<string, GoombaState>>(new Map());

  useEffect(() => {
    const goombas = bufferRef.current;
    goombas.clear();
    const previous = store.state.goombas;
    let defeated = 0;
    for (const row of goombaRows) {
      const prev = previous.get(row.goombaId);
      const next = toGoombaState(row, prev);
      goombas.set(row.goombaId, next);
      if (
        prev &&
        prev.state !== GOOMBA_INTERACT_DISABLED_STATE &&
        next.state === GOOMBA_INTERACT_DISABLED_STATE
      ) {
        defeated += 1;
      }
    }
    setGoombas(store, goombas);
    for (let i = 0; i < defeated; i += 1) onGoombaDefeatedRef.current();
  }, [goombaRows, store, onGoombaDefeatedRef]);

  const goombas = useGoombas(store);
  const goombaArray = useMemo(() => Array.from(goombas.values()), [goombas]);
  return <GoombaLayer goombas={goombaArray} />;
});

// ---------------------------------------------------------------------------
// MysteryBoxLayerSlice — owns useTable(mysteryBoxState)
// ---------------------------------------------------------------------------

const MysteryBoxLayerSlice = memo(function MysteryBoxLayerSlice({
  store,
  onMysteryBoxActivatedRef,
}: {
  store: MultiplayerStore;
  onMysteryBoxActivatedRef: MutableRefObject<() => void>;
}) {
  const [mysteryBoxRows] = useTable(tables.mysteryBoxState);
  const bufferRef = useRef<Map<string, MysteryBoxState>>(new Map());

  useEffect(() => {
    const boxes = bufferRef.current;
    boxes.clear();
    const previous = store.state.mysteryBoxes;
    let activated = 0;
    for (const row of mysteryBoxRows) {
      const prev = previous.get(row.mysteryBoxId);
      const next = toMysteryBoxState(row, prev);
      boxes.set(row.mysteryBoxId, next);
      if (
        prev &&
        prev.state !== MYSTERY_BOX_INTERACT_DISABLED_STATE &&
        next.state === MYSTERY_BOX_INTERACT_DISABLED_STATE
      ) {
        activated += 1;
      }
    }
    setMysteryBoxes(store, boxes);
    for (let i = 0; i < activated; i += 1) onMysteryBoxActivatedRef.current();
  }, [mysteryBoxRows, store, onMysteryBoxActivatedRef]);

  const mysteryBoxes = useMysteryBoxes(store);
  const boxArray = useMemo(
    () => Array.from(mysteryBoxes.values()),
    [mysteryBoxes],
  );
  return <MysteryBoxLayer mysteryBoxes={boxArray} />;
});

// ---------------------------------------------------------------------------
// RemotePlayersSlice — owns useTable(playerState) + useTable(chatMessageEvent)
// ---------------------------------------------------------------------------

const RemotePlayersSlice = memo(function RemotePlayersSlice({
  store,
  authoritativeLocalPlayerStateRef,
}: {
  store: MultiplayerStore;
  authoritativeLocalPlayerStateRef: MutableRefObject<AuthoritativePlayerState | null>;
}) {
  const connectionState = useSpacetimeDB();
  const [playerRows] = useTable(tables.playerState);
  const [chatMessageRows] = useTable(tables.chatMessageEvent);

  const localIdentity = connectionState.identity?.toHexString() ?? null;
  const serverTimeOffsetEstimateRef = useRef<number | null>(null);
  const remotePlayersBufferRef = useRef<Map<string, AuthoritativePlayerState>>(
    new Map(),
  );
  const chatMessagesBufferRef = useRef<ChatMessageEvent[]>([]);
  const chatMessageCacheRef = useRef<Map<string, ChatMessageEvent>>(new Map());
  const nextChatMessageCacheRef = useRef<Map<string, ChatMessageEvent>>(
    new Map(),
  );

  // Token persistence
  useEffect(() => {
    if (connectionState.token && connectionState.token.length > 0) {
      persistMultiplayerToken(connectionState.token);
    }
  }, [connectionState.token]);

  // Player rows → store
  useEffect(() => {
    const remotePlayers = remotePlayersBufferRef.current;
    remotePlayers.clear();
    const previousRemotePlayers = store.state.remotePlayers;
    const previousLocalPlayer = store.state.authoritativeLocalPlayerState;
    let authoritativeLocalPlayer: AuthoritativePlayerState | null = null;
    let freshestUpdatedAtMs = -1;

    for (const row of playerRows) {
      freshestUpdatedAtMs = Math.max(freshestUpdatedAtMs, row.updatedAtMs);
      if (localIdentity && row.identity === localIdentity) {
        authoritativeLocalPlayer = toAuthoritativePlayerState(
          row,
          previousLocalPlayer?.identity === row.identity
            ? previousLocalPlayer
            : undefined,
        );
      } else {
        const player = toAuthoritativePlayerState(
          row,
          previousRemotePlayers.get(row.identity),
        );
        remotePlayers.set(player.identity, player);
      }
    }

    setAuthoritativeLocalPlayerState(store, authoritativeLocalPlayer);
    authoritativeLocalPlayerStateRef.current = authoritativeLocalPlayer;
    setRemotePlayers(store, remotePlayers);

    if (freshestUpdatedAtMs > 0) {
      const sampledOffsetMs = freshestUpdatedAtMs - Date.now();
      const prev = serverTimeOffsetEstimateRef.current;
      const blended =
        prev === null
          ? sampledOffsetMs
          : prev + (sampledOffsetMs - prev) * SERVER_TIME_OFFSET_SMOOTHING;
      serverTimeOffsetEstimateRef.current = blended;
      setServerTimeOffsetMs(store, Math.round(blended));
    }
  }, [localIdentity, playerRows, store, authoritativeLocalPlayerStateRef]);

  // Chat rows → store
  useEffect(() => {
    const chatMessages = chatMessagesBufferRef.current;
    chatMessages.length = 0;
    const previousCache = chatMessageCacheRef.current;
    const nextCache = nextChatMessageCacheRef.current;
    nextCache.clear();
    let previousCreatedAtMs = -Infinity;
    let isSortedAscending = true;

    for (const row of chatMessageRows) {
      const message = toChatMessageEvent(row, previousCache.get(row.messageId));
      nextCache.set(message.messageId, message);
      chatMessages.push(message);
      if (message.createdAtMs < previousCreatedAtMs) isSortedAscending = false;
      previousCreatedAtMs = message.createdAtMs;
    }

    if (!isSortedAscending)
      chatMessages.sort((a, b) => a.createdAtMs - b.createdAtMs);

    chatMessageCacheRef.current = nextCache;
    nextChatMessageCacheRef.current = previousCache;
    setChatMessages(store, chatMessages);
  }, [chatMessageRows, store]);

  const remotePlayers = useRemotePlayers(store);
  const chatMessages = useChatMessages(store);
  const playerArray = useMemo(
    () => Array.from(remotePlayers.values()),
    [remotePlayers],
  );

  return (
    <RemotePlayersLayer players={playerArray} chatMessages={chatMessages} />
  );
});

// ---------------------------------------------------------------------------
// ControllerSlice — owns useTable(fireballEvent) + all player-action reducers
// ---------------------------------------------------------------------------

const ControllerSlice = memo(function ControllerSlice({
  store,
  cameraMode,
  onToggleCameraMode,
  isWalkDefault,
  onToggleDefaultGait,
  onPointerLockChange,
  isInputSuspendedRef,
  onPlayerPositionUpdate,
  mobileMoveInputRef,
  mobileJumpPressedRef,
  mobileFireballTriggerRef,
  damageEventCounterRef,
  fireballManager,
  onLocalShootSound,
  onLocalJump,
  onLocalFootstepsActiveChange,
  authoritativeLocalPlayerStateRef,
  networkFireballSpawnQueueRef,
  fireballLoopController,
  localDisplayNameRef,
}: {
  store: MultiplayerStore;
  cameraMode: CameraMode;
  onToggleCameraMode: () => void;
  isWalkDefault: boolean;
  onToggleDefaultGait: () => void;
  onPointerLockChange?: (isLocked: boolean) => void;
  isInputSuspendedRef?: MutableRefObject<boolean>;
  onPlayerPositionUpdate?: (x: number, y: number, z: number) => void;
  mobileMoveInputRef?: MutableRefObject<MobileMoveInput>;
  mobileJumpPressedRef?: MutableRefObject<boolean>;
  mobileFireballTriggerRef?: MutableRefObject<number>;
  damageEventCounterRef?: MutableRefObject<number>;
  fireballManager?: FireballManager;
  onLocalShootSound?: () => void;
  onLocalJump?: () => void;
  onLocalFootstepsActiveChange?: (isActive: boolean) => void;
  authoritativeLocalPlayerStateRef: MutableRefObject<AuthoritativePlayerState | null>;
  networkFireballSpawnQueueRef: MutableRefObject<FireballSpawnEvent[]>;
  fireballLoopController?: FireballLoopController;
  localDisplayNameRef: MutableRefObject<string>;
}) {
  const connectionState = useSpacetimeDB();
  const [fireballRows] = useTable(tables.fireballEvent);

  const sendUpsertPlayerState = useSpacetimeReducer(reducers.upsertPlayerState);
  const sendCastFireball = useSpacetimeReducer(reducers.castFireball);
  const sendHitGoomba = useSpacetimeReducer(reducers.hitGoomba);
  const sendHitMysteryBox = useSpacetimeReducer(reducers.hitMysteryBox);

  const localIdentity = connectionState.identity?.toHexString() ?? null;
  const isActive = connectionState.isActive;

  const seenFireballEventsRef = useRef<Set<string>>(new Set());
  const activeFireballEventsRef = useRef<Set<string>>(new Set());

  // Fireball ingest
  useEffect(() => {
    const prevSeen = seenFireballEventsRef.current;
    const nextSeen = activeFireballEventsRef.current;
    nextSeen.clear();
    for (const event of fireballRows) {
      nextSeen.add(event.eventId);
      if (prevSeen.has(event.eventId)) continue;
      if (localIdentity && event.ownerIdentity === localIdentity) continue;
      networkFireballSpawnQueueRef.current.push(toFireballSpawnEvent(event));
    }
    seenFireballEventsRef.current = nextSeen;
    activeFireballEventsRef.current = prevSeen;
  }, [fireballRows, localIdentity, networkFireballSpawnQueueRef]);

  // Write live send callbacks into refs so the stable wrappers below never
  // change identity — CharacterRigController calls them in useFrame.
  const sendLocalPlayerSnapshotRef = useRef<
    (snapshot: NetPlayerSnapshot) => void
  >(() => {});
  const sendLocalFireballCastRef = useRef<
    (request: CastFireballCommand) => void
  >(() => {});
  const sendGoombaHitRef = useRef<(goombaId: string) => void>(() => {});
  const sendMysteryBoxHitRef = useRef<(mysteryBoxId: string) => void>(() => {});

  useEffect(() => {
    sendLocalPlayerSnapshotRef.current = (snapshot) => {
      if (!isActive) return;
      const command = toUpsertPlayerStateCommand(
        snapshot,
        localDisplayNameRef.current,
      );
      if (!command) {
        warnInvalidCommand("upsert_player_state", { snapshot });
        return;
      }
      sendUpsertPlayerState(command);
    };
    sendLocalFireballCastRef.current = (request) => {
      if (!isActive) return;
      const command = toCastFireballCommand(request);
      if (!command) {
        warnInvalidCommand("cast_fireball", request);
        return;
      }
      sendCastFireball(command);
    };
    sendGoombaHitRef.current = (goombaId) => {
      if (!isActive) return;
      const command = toHitGoombaCommand(goombaId);
      if (!command) {
        warnInvalidCommand("hit_goomba", { goombaId });
        return;
      }
      sendHitGoomba(command);
    };
    sendMysteryBoxHitRef.current = (mysteryBoxId) => {
      if (!isActive) return;
      const command = toHitMysteryBoxCommand(mysteryBoxId);
      if (!command) {
        warnInvalidCommand("hit_mystery_box", { mysteryBoxId });
        return;
      }
      sendHitMysteryBox(command);
    };
  }, [
    isActive,
    localDisplayNameRef,
    sendUpsertPlayerState,
    sendCastFireball,
    sendHitGoomba,
    sendHitMysteryBox,
  ]);

  // Stable wrappers — [] deps intentional: identity must never change so that
  // CharacterRigController's useCallback/useMemo dependencies stay stable.
  // The live callback is always current via the refs updated in the effect above.
  const onLocalPlayerSnapshot = useCallback(
    (s: NetPlayerSnapshot) => sendLocalPlayerSnapshotRef.current(s),
    [],
  );
  const onLocalFireballCast = useCallback(
    (r: CastFireballCommand) => sendLocalFireballCastRef.current(r),
    [],
  );
  const onLocalGoombaHit = useCallback(
    (id: HitGoombaCommand["goombaId"]) => sendGoombaHitRef.current(id),
    [],
  );
  const onLocalMysteryBoxHit = useCallback(
    (id: string) => sendMysteryBoxHitRef.current(id),
    [],
  );

  const goombas = useGoombas(store);
  const mysteryBoxes = useMysteryBoxes(store);
  const connectionStatus = useConnectionStatus(store);
  const goombaArray = useMemo(() => Array.from(goombas.values()), [goombas]);
  const mysteryBoxArray = useMemo(
    () => Array.from(mysteryBoxes.values()),
    [mysteryBoxes],
  );

  return (
    <CharacterRigController
      cameraMode={cameraMode}
      onToggleCameraMode={onToggleCameraMode}
      isWalkDefault={isWalkDefault}
      onToggleDefaultGait={onToggleDefaultGait}
      onPointerLockChange={onPointerLockChange}
      isInputSuspendedRef={isInputSuspendedRef}
      onPlayerPositionUpdate={onPlayerPositionUpdate}
      mobileMoveInputRef={mobileMoveInputRef}
      mobileJumpPressedRef={mobileJumpPressedRef}
      mobileFireballTriggerRef={mobileFireballTriggerRef}
      damageEventCounterRef={damageEventCounterRef}
      fireballManager={fireballManager}
      onLocalPlayerSnapshot={onLocalPlayerSnapshot}
      onLocalFireballCast={onLocalFireballCast}
      onLocalShootSound={onLocalShootSound}
      onLocalJump={onLocalJump}
      onLocalFootstepsActiveChange={onLocalFootstepsActiveChange}
      goombas={goombaArray}
      onLocalGoombaHit={
        connectionStatus === "connected" ? onLocalGoombaHit : undefined
      }
      mysteryBoxes={mysteryBoxArray}
      onLocalMysteryBoxHit={
        connectionStatus === "connected" ? onLocalMysteryBoxHit : undefined
      }
      authoritativeLocalPlayerStateRef={authoritativeLocalPlayerStateRef}
      networkFireballSpawnQueueRef={networkFireballSpawnQueueRef}
      fireballLoopController={fireballLoopController}
    />
  );
});

// ---------------------------------------------------------------------------
// GameCanvas props
// ---------------------------------------------------------------------------

export interface GameCanvasProps {
  store: MultiplayerStore;
  worldEntityManager: WorldEntityManager;
  cameraMode: CameraMode;
  onToggleCameraMode: () => void;
  isWalkDefault: boolean;
  onToggleDefaultGait: () => void;
  onPointerLockChange?: (isLocked: boolean) => void;
  isInputSuspendedRef?: MutableRefObject<boolean>;
  onPlayerPositionUpdate?: (x: number, y: number, z: number) => void;
  mobileMoveInputRef?: MutableRefObject<MobileMoveInput>;
  mobileJumpPressedRef?: MutableRefObject<boolean>;
  mobileFireballTriggerRef?: MutableRefObject<number>;
  damageEventCounterRef?: MutableRefObject<number>;
  onLocalShootSound?: () => void;
  onLocalJump?: () => void;
  onLocalFootstepsActiveChange?: (isActive: boolean) => void;
  authoritativeLocalPlayerStateRef: MutableRefObject<AuthoritativePlayerState | null>;
  networkFireballSpawnQueueRef: MutableRefObject<FireballSpawnEvent[]>;
  fireballLoopController?: FireballLoopController;
  /** Ref to the local display name — read in ControllerSlice's send callback */
  localDisplayNameRef: MutableRefObject<string>;
  onGoombaDefeatedRef: MutableRefObject<() => void>;
  onMysteryBoxActivatedRef: MutableRefObject<() => void>;
  onCollectRing?: (ringId: string) => void;
  onCollect?: () => void;
  isFpsVisible?: boolean;
  onFpsUpdate?: (fps: number) => void;
  onCanvasCreated?: (canvas: HTMLCanvasElement) => void;
}

export const GameCanvas = memo(function GameCanvas({
  store,
  worldEntityManager,
  cameraMode,
  onToggleCameraMode,
  isWalkDefault,
  onToggleDefaultGait,
  onPointerLockChange,
  isInputSuspendedRef,
  onPlayerPositionUpdate,
  mobileMoveInputRef,
  mobileJumpPressedRef,
  mobileFireballTriggerRef,
  damageEventCounterRef,
  onLocalShootSound,
  onLocalJump,
  onLocalFootstepsActiveChange,
  authoritativeLocalPlayerStateRef,
  networkFireballSpawnQueueRef,
  fireballLoopController,
  localDisplayNameRef,
  onGoombaDefeatedRef,
  onMysteryBoxActivatedRef,
  onCollectRing,
  onCollect,
  isFpsVisible,
  onFpsUpdate,
  onCanvasCreated,
}: GameCanvasProps) {
  return (
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
        onCanvasCreated?.(gl.domElement);
      }}
      className="h-full w-full touch-none"
    >
      {/* AnimatedSun reads store via a ref in useFrame — zero React re-renders */}
      <AnimatedSun
        worldEntityManager={worldEntityManager}
        multiplayerStore={store}
      />
      <group position={[0, 24, 0]}>
        <BirdFlock count={192} bounds={48} />
      </group>
      {isFpsVisible && onFpsUpdate ? (
        <FrameRateProbe onUpdate={onFpsUpdate} />
      ) : null}
      <fog attach="fog" args={[HORIZON_COLOR, SKY_FOG_NEAR, SKY_FOG_FAR]} />
      <Physics gravity={[0, WORLD_GRAVITY_Y, 0]}>
        <Suspense fallback={null}>
          <WorldGeometry worldEntityManager={worldEntityManager} />
          <RingField
            worldEntityManager={worldEntityManager}
            store={store}
            onCollectRing={onCollectRing}
            onCollect={onCollect}
          />
          <GoombaLayerSlice
            store={store}
            onGoombaDefeatedRef={onGoombaDefeatedRef}
          />
          <MysteryBoxLayerSlice
            store={store}
            onMysteryBoxActivatedRef={onMysteryBoxActivatedRef}
          />
          <RemotePlayersSlice
            store={store}
            authoritativeLocalPlayerStateRef={authoritativeLocalPlayerStateRef}
          />
          <ControllerSlice
            store={store}
            cameraMode={cameraMode}
            onToggleCameraMode={onToggleCameraMode}
            isWalkDefault={isWalkDefault}
            onToggleDefaultGait={onToggleDefaultGait}
            onPointerLockChange={onPointerLockChange}
            isInputSuspendedRef={isInputSuspendedRef}
            onPlayerPositionUpdate={onPlayerPositionUpdate}
            mobileMoveInputRef={mobileMoveInputRef}
            mobileJumpPressedRef={mobileJumpPressedRef}
            mobileFireballTriggerRef={mobileFireballTriggerRef}
            damageEventCounterRef={damageEventCounterRef}
            fireballManager={worldEntityManager.fireballManager}
            onLocalShootSound={onLocalShootSound}
            onLocalJump={onLocalJump}
            onLocalFootstepsActiveChange={onLocalFootstepsActiveChange}
            authoritativeLocalPlayerStateRef={authoritativeLocalPlayerStateRef}
            networkFireballSpawnQueueRef={networkFireballSpawnQueueRef}
            fireballLoopController={fireballLoopController}
            localDisplayNameRef={localDisplayNameRef}
          />
        </Suspense>
      </Physics>
    </Canvas>
  );
});
