"use client";

import {
  useReducer as useSpacetimeReducer,
  useSpacetimeDB,
  useTable,
} from "spacetimedb/react";
import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { MotionState } from "../../lib/CharacterActor";
import type {
  WorldEntityManager,
  WorldRingSnapshot,
} from "../../scene/world/worldEntityManager";
import {
  applyServerRingRows,
  setWorldLocalRingCount,
} from "../../scene/world/worldEntityManager";
import { reducers, tables } from "../spacetime/bindings";
import type { CastFireballCommand } from "../protocol";
import {
  toCastFireballCommand,
  toCollectRingCommand,
  toHitGoombaCommand,
  toHitMysteryBoxCommand,
  toSendChatMessageCommand,
  toUpsertPlayerStateCommand,
} from "../protocol";
import { persistMultiplayerToken } from "../spacetime/client";
import {
  setAuthoritativeLocalPlayerState,
  setChatMessages,
  setGoombas,
  setMysteryBoxes,
  setMultiplayerConnectionStatus as setConnectionStatusInStore,
  setMultiplayerDiagnostics,
  setMultiplayerIdentity,
  setPlayerInventories,
  setPlayerStats,
  setRemotePlayers,
  setServerTimeOffsetMs,
  setWorldDayCycleConfig,
  type MultiplayerStore,
} from "./multiplayerStore";
import type {
  AuthoritativePlayerState,
  ChatMessageEvent,
  FireballSpawnEvent,
  GoombaState,
  MysteryBoxState,
  NetChatMessageEventRow,
  NetFireballEventRow,
  NetGoombaRow,
  NetMysteryBoxRow,
  NetPlayerInventoryRow,
  NetPlayerRow,
  NetPlayerSnapshot,
  NetPlayerStatsRow,
  NetWorldStateRow,
  PlayerInventorySnapshot,
  PlayerStatsSnapshot,
} from "./multiplayerTypes";

const MOTION_STATE_FALLBACK: MotionState = "idle";
const DEFAULT_DAY_CYCLE_DURATION_SECONDS = 300;
const SERVER_TIME_OFFSET_SMOOTHING = 0.2;
const GOOMBA_STATE_FALLBACK: GoombaState["state"] = "idle";
const MYSTERY_BOX_STATE_FALLBACK: MysteryBoxState["state"] = "ready";

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
      return MOTION_STATE_FALLBACK;
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

function toFireballSpawnEvent(
  row: NetFireballEventRow,
): FireballSpawnEvent {
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

function toGoombaState(
  row: NetGoombaRow,
  previous?: GoombaState,
): GoombaState {
  const state = toValidGoombaState(row.state);
  if (
    previous &&
    previous.goombaId === row.goombaId &&
    previous.x === row.x &&
    previous.y === row.y &&
    previous.z === row.z &&
    previous.yaw === row.yaw &&
    previous.state === state
  ) {
    return previous;
  }

  return {
    goombaId: row.goombaId,
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    state,
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

  return {
    identity: row.identity,
    ringCount,
    updatedAtMs: row.updatedAtMs,
  };
}

function toPlayerStatsSnapshot(
  row: NetPlayerStatsRow,
  previous?: PlayerStatsSnapshot,
): PlayerStatsSnapshot {
  const normalizedDisplayName = row.displayName.trim();
  const displayName =
    normalizedDisplayName.length > 0 ? normalizedDisplayName : "Guest";
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

  return {
    identity: row.identity,
    displayName,
    highestRingCount,
    updatedAtMs: row.updatedAtMs,
  };
}

function pickWorldStateRow(
  rows: readonly NetWorldStateRow[],
): NetWorldStateRow | null {
  if (rows.length <= 0) {
    return null;
  }
  return rows.find((row) => row.id === "global") ?? rows[0];
}

function getConnectionErrorMessage(error: unknown) {
  if (!error) {
    return "unknown_connection_error";
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  const errorWithMessage = error as { message?: unknown };
  if (
    typeof errorWithMessage.message === "string" &&
    errorWithMessage.message.trim().length > 0
  ) {
    return errorWithMessage.message;
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {
    // ignore serialization errors and fall through to generic marker
  }
  return String(error);
}

function warnInvalidCommand(commandName: string, details: unknown) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  console.warn(`[multiplayer] dropped invalid ${commandName} command`, details);
}

export function useMultiplayerSync({
  store,
  worldEntityManager,
  networkFireballSpawnQueueRef,
}: {
  store: MultiplayerStore;
  worldEntityManager: WorldEntityManager;
  networkFireballSpawnQueueRef: MutableRefObject<FireballSpawnEvent[]>;
}) {
  const connectionState = useSpacetimeDB();
  const [playerRows] = useTable(tables.playerState);
  const [playerInventoryRows] = useTable(tables.playerInventory);
  const [playerStatsRows] = useTable(tables.playerStats);
  const [goombaRows] = useTable(tables.goombaState);
  const [mysteryBoxRows] = useTable(tables.mysteryBoxState);
  const [ringDropRows] = useTable(tables.ringDropState);
  const [worldStateRows] = useTable(tables.worldState);
  const [fireballRows] = useTable(tables.fireballEvent);
  const [chatMessageRows] = useTable(tables.chatMessageEvent);

  const sendUpsertPlayerState = useSpacetimeReducer(reducers.upsertPlayerState);
  const sendCastFireball = useSpacetimeReducer(reducers.castFireball);
  const sendCollectRing = useSpacetimeReducer(reducers.collectRing);
  const sendHitGoomba = useSpacetimeReducer(reducers.hitGoomba);
  const sendHitMysteryBox = useSpacetimeReducer(reducers.hitMysteryBox);
  const sendChatMessageReducer = useSpacetimeReducer(reducers.sendChatMessage);

  const seenFireballEventsRef = useRef<Set<string>>(new Set());
  const activeFireballEventsRef = useRef<Set<string>>(new Set());
  const hasConnectedOnceRef = useRef(false);
  const serverTimeOffsetEstimateRef = useRef<number | null>(null);
  const remotePlayersBufferRef = useRef<Map<string, AuthoritativePlayerState>>(
    new Map(),
  );
  const playerInventoriesBufferRef = useRef<Map<string, PlayerInventorySnapshot>>(
    new Map(),
  );
  const playerStatsBufferRef = useRef<Map<string, PlayerStatsSnapshot>>(
    new Map(),
  );
  const projectedRingsBufferRef = useRef<WorldRingSnapshot[]>([]);
  const goombasBufferRef = useRef<Map<string, GoombaState>>(new Map());
  const mysteryBoxesBufferRef = useRef<Map<string, MysteryBoxState>>(new Map());
  const chatMessagesBufferRef = useRef<ChatMessageEvent[]>([]);
  const chatMessageCacheRef = useRef<Map<string, ChatMessageEvent>>(new Map());
  const nextChatMessageCacheRef = useRef<Map<string, ChatMessageEvent>>(
    new Map(),
  );

  const localIdentity = connectionState.identity?.toHexString() ?? null;

  useEffect(() => {
    if (connectionState.token && connectionState.token.length > 0) {
      persistMultiplayerToken(connectionState.token);
    }
  }, [connectionState.token]);

  useEffect(() => {
    if (connectionState.isActive) {
      return;
    }
    serverTimeOffsetEstimateRef.current = null;
    setServerTimeOffsetMs(store, null);
  }, [connectionState.isActive, store]);

  useEffect(() => {
    setMultiplayerIdentity(store, localIdentity);
  }, [localIdentity, store]);

  useEffect(() => {
    if (connectionState.connectionError) {
      const connectionErrorMessage = getConnectionErrorMessage(
        connectionState.connectionError,
      );
      setConnectionStatusInStore(
        store,
        "error",
        connectionErrorMessage,
      );
      return;
    }

    if (connectionState.isActive) {
      hasConnectedOnceRef.current = true;
      setConnectionStatusInStore(store, "connected", null);
      return;
    }

    if (hasConnectedOnceRef.current) {
      setConnectionStatusInStore(store, "disconnected", null);
      return;
    }

    setConnectionStatusInStore(store, "connecting", null);
  }, [connectionState.connectionError, connectionState.isActive, store]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }
    if (!connectionState.connectionError) {
      return;
    }
    const connectionErrorMessage = getConnectionErrorMessage(
      connectionState.connectionError,
    );
    const errorObject = connectionState.connectionError as {
      name?: unknown;
      code?: unknown;
    };
    console.error("[multiplayer] SpacetimeDB connection error", {
      message: connectionErrorMessage,
      errorName:
        typeof errorObject.name === "string" ? errorObject.name : undefined,
      errorCode:
        typeof errorObject.code === "string" ? errorObject.code : undefined,
      uri: process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? "ws://127.0.0.1:3001",
      module:
        process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "rings-multiplayer",
      rawError: connectionState.connectionError,
    });
  }, [connectionState.connectionError]);

  useEffect(() => {
    setMultiplayerDiagnostics(store, {
      playerRowCount: playerRows.length,
      ringRowCount: ringDropRows.length,
      fireballEventRowCount: fireballRows.length,
      chatMessageRowCount: chatMessageRows.length,
    });
  }, [
    chatMessageRows.length,
    fireballRows.length,
    ringDropRows.length,
    playerRows.length,
    store,
  ]);

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
    setRemotePlayers(store, remotePlayers);

    if (freshestUpdatedAtMs > 0) {
      const sampledOffsetMs = freshestUpdatedAtMs - Date.now();
      const previousOffsetMs = serverTimeOffsetEstimateRef.current;
      const blendedOffsetMs =
        previousOffsetMs === null
          ? sampledOffsetMs
          : previousOffsetMs +
            (sampledOffsetMs - previousOffsetMs) * SERVER_TIME_OFFSET_SMOOTHING;
      serverTimeOffsetEstimateRef.current = blendedOffsetMs;
      setServerTimeOffsetMs(store, Math.round(blendedOffsetMs));
    }
  }, [localIdentity, playerRows, store]);

  useEffect(() => {
    const worldState = pickWorldStateRow(worldStateRows);
    if (!worldState) {
      setWorldDayCycleConfig(
        store,
        null,
        DEFAULT_DAY_CYCLE_DURATION_SECONDS,
      );
      return;
    }

    setWorldDayCycleConfig(
      store,
      worldState.dayCycleAnchorMs,
      worldState.dayCycleDurationSeconds,
    );
  }, [store, worldStateRows]);

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

  useEffect(() => {
    if (!connectionState.isActive) {
      return;
    }

    const projectedRings = projectedRingsBufferRef.current;
    projectedRings.length = 0;

    for (const ringDrop of ringDropRows) {
      if (ringDrop.collected) {
        continue;
      }
      projectedRings.push({
        id: ringDrop.ringId,
        x: ringDrop.x,
        y: ringDrop.y,
        z: ringDrop.z,
        spawnedAtMs: ringDrop.spawnedAtMs,
      });
    }

    applyServerRingRows(worldEntityManager, projectedRings);
  }, [
    connectionState.isActive,
    ringDropRows,
    worldEntityManager,
  ]);

  useEffect(() => {
    if (!connectionState.isActive) {
      return;
    }

    let localRingCount = 0;
    for (const inventoryRow of playerInventoryRows) {
      if (inventoryRow.identity !== localIdentity) {
        continue;
      }
      localRingCount = Math.max(0, Math.floor(inventoryRow.ringCount));
      break;
    }

    setWorldLocalRingCount(worldEntityManager, localRingCount);
  }, [
    connectionState.isActive,
    localIdentity,
    playerInventoryRows,
    worldEntityManager,
  ]);

  useEffect(() => {
    const goombas = goombasBufferRef.current;
    goombas.clear();
    const previousGoombas = store.state.goombas;
    for (const row of goombaRows) {
      goombas.set(
        row.goombaId,
        toGoombaState(row, previousGoombas.get(row.goombaId)),
      );
    }
    setGoombas(store, goombas);
  }, [goombaRows, store]);

  useEffect(() => {
    const mysteryBoxes = mysteryBoxesBufferRef.current;
    mysteryBoxes.clear();
    const previousMysteryBoxes = store.state.mysteryBoxes;
    for (const row of mysteryBoxRows) {
      mysteryBoxes.set(
        row.mysteryBoxId,
        toMysteryBoxState(row, previousMysteryBoxes.get(row.mysteryBoxId)),
      );
    }
    setMysteryBoxes(store, mysteryBoxes);
  }, [mysteryBoxRows, store]);

  useEffect(() => {
    const previousSeenIds = seenFireballEventsRef.current;
    const nextSeenIds = activeFireballEventsRef.current;
    nextSeenIds.clear();

    for (const event of fireballRows) {
      nextSeenIds.add(event.eventId);
      if (previousSeenIds.has(event.eventId)) {
        continue;
      }
      if (localIdentity && event.ownerIdentity === localIdentity) {
        continue;
      }
      networkFireballSpawnQueueRef.current.push(toFireballSpawnEvent(event));
    }

    seenFireballEventsRef.current = nextSeenIds;
    activeFireballEventsRef.current = previousSeenIds;
  }, [fireballRows, localIdentity, networkFireballSpawnQueueRef]);

  useEffect(() => {
    const chatMessages = chatMessagesBufferRef.current;
    chatMessages.length = 0;
    const previousMessageCache = chatMessageCacheRef.current;
    const nextMessageCache = nextChatMessageCacheRef.current;
    nextMessageCache.clear();
    let previousCreatedAtMs = -Infinity;
    let isSortedAscending = true;

    for (const row of chatMessageRows) {
      const message = toChatMessageEvent(
        row,
        previousMessageCache.get(row.messageId),
      );
      nextMessageCache.set(message.messageId, message);
      chatMessages.push(message);
      if (message.createdAtMs < previousCreatedAtMs) {
        isSortedAscending = false;
      }
      previousCreatedAtMs = message.createdAtMs;
    }

    if (!isSortedAscending) {
      chatMessages.sort((a, b) => a.createdAtMs - b.createdAtMs);
    }

    chatMessageCacheRef.current = nextMessageCache;
    nextChatMessageCacheRef.current = previousMessageCache;
    setChatMessages(store, chatMessages);
  }, [chatMessageRows, store]);

  const localDisplayName = store.state.localDisplayName;

  const sendLocalPlayerSnapshot = useCallback(
    (snapshot: NetPlayerSnapshot) => {
      if (!connectionState.isActive) {
        return;
      }
      const command = toUpsertPlayerStateCommand(snapshot, localDisplayName);
      if (!command) {
        warnInvalidCommand("upsert_player_state", {
          snapshot,
          localDisplayName,
        });
        return;
      }
      sendUpsertPlayerState(command);
    },
    [connectionState.isActive, localDisplayName, sendUpsertPlayerState],
  );

  const sendLocalFireballCast = useCallback(
    (request: CastFireballCommand) => {
      if (!connectionState.isActive) {
        return;
      }
      const command = toCastFireballCommand(request);
      if (!command) {
        warnInvalidCommand("cast_fireball", request);
        return;
      }
      sendCastFireball(command);
    },
    [connectionState.isActive, sendCastFireball],
  );

  const sendRingCollect = useCallback(
    (ringId: string) => {
      if (!connectionState.isActive) {
        return;
      }
      const command = toCollectRingCommand(ringId);
      if (!command) {
        warnInvalidCommand("collect_ring", { ringId });
        return;
      }
      sendCollectRing(command);
    },
    [connectionState.isActive, sendCollectRing],
  );

  const sendChatMessage = useCallback(
    (messageText: string) => {
      if (!connectionState.isActive) {
        return;
      }
      const command = toSendChatMessageCommand(messageText);
      if (!command) {
        warnInvalidCommand("send_chat_message", { messageText });
        return;
      }
      sendChatMessageReducer(command);
    },
    [connectionState.isActive, sendChatMessageReducer],
  );

  const sendGoombaHit = useCallback(
    (goombaId: string) => {
      if (!connectionState.isActive) {
        return;
      }
      const command = toHitGoombaCommand(goombaId);
      if (!command) {
        warnInvalidCommand("hit_goomba", { goombaId });
        return;
      }
      sendHitGoomba(command);
    },
    [connectionState.isActive, sendHitGoomba],
  );

  const sendMysteryBoxHit = useCallback(
    (mysteryBoxId: string) => {
      if (!connectionState.isActive) {
        return;
      }
      const command = toHitMysteryBoxCommand(mysteryBoxId);
      if (!command) {
        warnInvalidCommand("hit_mystery_box", { mysteryBoxId });
        return;
      }
      sendHitMysteryBox(command);
    },
    [connectionState.isActive, sendHitMysteryBox],
  );

  return {
    sendLocalPlayerSnapshot,
    sendLocalFireballCast,
    sendRingCollect,
    sendChatMessage,
    sendGoombaHit,
    sendMysteryBoxHit,
  };
}
