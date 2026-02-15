"use client";

import {
  useReducer as useSpacetimeReducer,
  useSpacetimeDB,
  useTable,
} from "spacetimedb/react";
import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { MotionState } from "../../lib/CharacterActor";
import { RING_HOVER_HEIGHT, RING_PLACEMENTS } from "../../utils/constants";
import { sampleTerrainHeight } from "../../utils/terrain";
import type { WorldEntityManager } from "../../scene/world/worldEntityManager";
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
  toSendChatMessageCommand,
  toUpsertPlayerStateCommand,
} from "../protocol";
import { persistMultiplayerToken } from "../spacetime/client";
import {
  consumeRemoteFireballSpawns,
  enqueueRemoteFireballSpawns,
  setAuthoritativeLocalPlayerState,
  setChatMessages,
  setCollectedRingIds,
  setGoombas,
  setMultiplayerConnectionStatus as setConnectionStatusInStore,
  setMultiplayerDiagnostics,
  setMultiplayerIdentity,
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
  NetChatMessageEventRow,
  NetFireballEventRow,
  NetGoombaRow,
  NetPlayerRow,
  NetPlayerSnapshot,
  NetWorldStateRow,
} from "./multiplayerTypes";

const MOTION_STATE_FALLBACK: MotionState = "idle";
const DEFAULT_DAY_CYCLE_DURATION_SECONDS = 300;
const SERVER_TIME_OFFSET_SMOOTHING = 0.2;
const GOOMBA_STATE_FALLBACK: GoombaState["state"] = "idle";
const STARTER_RING_POSITIONS = new Map(
  RING_PLACEMENTS.map((placement, index) => [
    `ring-${index}`,
    {
      x: placement[0],
      y: sampleTerrainHeight(placement[0], placement[1]) + RING_HOVER_HEIGHT,
      z: placement[1],
    },
  ]),
);

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
): AuthoritativePlayerState {
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
    motionState: toValidMotionState(row.motionState),
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

function toChatMessageEvent(row: NetChatMessageEventRow): ChatMessageEvent {
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
    case "cooldown":
    case "defeated":
      return value;
    default:
      return GOOMBA_STATE_FALLBACK;
  }
}

function toGoombaState(row: NetGoombaRow): GoombaState {
  return {
    goombaId: row.goombaId,
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    state: toValidGoombaState(row.state),
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
  const [goombaRows] = useTable(tables.goombaState);
  const [ringRows] = useTable(tables.ringState);
  const [ringDropRows] = useTable(tables.ringDropState);
  const [worldStateRows] = useTable(tables.worldState);
  const [fireballRows] = useTable(tables.fireballEvent);
  const [chatMessageRows] = useTable(tables.chatMessageEvent);

  const sendUpsertPlayerState = useSpacetimeReducer(reducers.upsertPlayerState);
  const sendCastFireball = useSpacetimeReducer(reducers.castFireball);
  const sendCollectRing = useSpacetimeReducer(reducers.collectRing);
  const sendHitGoomba = useSpacetimeReducer(reducers.hitGoomba);
  const sendChatMessageReducer = useSpacetimeReducer(reducers.sendChatMessage);

  const seenFireballEventsRef = useRef<Set<string>>(new Set());
  const hasConnectedOnceRef = useRef(false);
  const serverTimeOffsetEstimateRef = useRef<number | null>(null);

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
      ringRowCount: ringRows.length + ringDropRows.length,
      fireballEventRowCount: fireballRows.length,
      chatMessageRowCount: chatMessageRows.length,
    });
  }, [
    chatMessageRows.length,
    fireballRows.length,
    ringDropRows.length,
    playerRows.length,
    ringRows.length,
    store,
  ]);

  useEffect(() => {
    const remotePlayers = new Map<string, AuthoritativePlayerState>();
    let authoritativeLocalPlayer: AuthoritativePlayerState | null = null;
    let freshestUpdatedAtMs = -1;

    for (const row of playerRows) {
      freshestUpdatedAtMs = Math.max(freshestUpdatedAtMs, row.updatedAtMs);
      const player = toAuthoritativePlayerState(row);
      if (localIdentity && player.identity === localIdentity) {
        authoritativeLocalPlayer = player;
      } else {
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
    if (!connectionState.isActive) {
      return;
    }

    const collectedStarterRingIds = new Set<string>();
    const projectedRings: {
      id: string;
      x: number;
      y: number;
      z: number;
      collected: boolean;
      source: "starter" | "drop";
      spawnedAtMs?: number;
    }[] = [];

    for (const ring of ringRows) {
      const starterPosition = STARTER_RING_POSITIONS.get(ring.ringId);
      if (!starterPosition) {
        continue;
      }

      if (ring.collected) {
        collectedStarterRingIds.add(ring.ringId);
      }

      projectedRings.push({
        id: ring.ringId,
        x: starterPosition.x,
        y: starterPosition.y,
        z: starterPosition.z,
        collected: ring.collected,
        source: "starter",
        spawnedAtMs: undefined,
      });
    }

    for (const ringDrop of ringDropRows) {
      projectedRings.push({
        id: ringDrop.ringId,
        x: ringDrop.x,
        y: ringDrop.y,
        z: ringDrop.z,
        collected: ringDrop.collected,
        source: "drop",
        spawnedAtMs: ringDrop.spawnedAtMs,
      });
    }

    let localRingCount = 0;
    for (const inventoryRow of playerInventoryRows) {
      if (inventoryRow.identity !== localIdentity) {
        continue;
      }
      localRingCount = Math.max(0, Math.floor(inventoryRow.ringCount));
      break;
    }

    setCollectedRingIds(store, collectedStarterRingIds);
    applyServerRingRows(worldEntityManager, projectedRings);
    setWorldLocalRingCount(worldEntityManager, localRingCount);
  }, [
    connectionState.isActive,
    localIdentity,
    playerInventoryRows,
    ringDropRows,
    ringRows,
    store,
    worldEntityManager,
  ]);

  useEffect(() => {
    const goombas = new Map<string, GoombaState>();
    for (const row of goombaRows) {
      goombas.set(row.goombaId, toGoombaState(row));
    }
    setGoombas(store, goombas);
  }, [goombaRows, store]);

  useEffect(() => {
    const seenIds = seenFireballEventsRef.current;
    const activeEventIds = new Set<string>();
    const newRemoteEvents: FireballSpawnEvent[] = [];

    for (const event of fireballRows) {
      activeEventIds.add(event.eventId);
      if (seenIds.has(event.eventId)) {
        continue;
      }
      seenIds.add(event.eventId);
      if (localIdentity && event.ownerIdentity === localIdentity) {
        continue;
      }
      newRemoteEvents.push(toFireballSpawnEvent(event));
    }

    for (const eventId of seenIds) {
      if (!activeEventIds.has(eventId)) {
        seenIds.delete(eventId);
      }
    }

    if (newRemoteEvents.length > 0) {
      enqueueRemoteFireballSpawns(store, newRemoteEvents);
      const pending = consumeRemoteFireballSpawns(store);
      if (pending.length > 0) {
        networkFireballSpawnQueueRef.current.push(...pending);
      }
    }
  }, [fireballRows, localIdentity, networkFireballSpawnQueueRef, store]);

  useEffect(() => {
    const chatMessages = chatMessageRows
      .map(toChatMessageEvent)
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
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

  return {
    sendLocalPlayerSnapshot,
    sendLocalFireballCast,
    sendRingCollect,
    sendChatMessage,
    sendGoombaHit,
  };
}
