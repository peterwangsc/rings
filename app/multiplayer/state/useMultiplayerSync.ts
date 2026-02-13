"use client";

import {
  useReducer as useSpacetimeReducer,
  useSpacetimeDB,
  useTable,
} from "spacetimedb/react";
import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { MotionState } from "../../lib/CharacterActor";
import type { WorldEntityManager } from "../../scene/world/worldEntityManager";
import { applyServerRingState } from "../../scene/world/worldEntityManager";
import { reducers, tables } from "../spacetime/bindings";
import { persistMultiplayerToken } from "../spacetime/client";
import {
  consumeRemoteFireballSpawns,
  enqueueRemoteFireballSpawns,
  setAuthoritativeLocalPlayerState,
  setCollectedRingIds,
  setMultiplayerConnectionStatus as setConnectionStatusInStore,
  setMultiplayerDiagnostics,
  setMultiplayerIdentity,
  setRemotePlayers,
  type MultiplayerStore,
} from "./multiplayerStore";
import type {
  AuthoritativePlayerState,
  FireballSpawnEvent,
  NetFireballEventRow,
  NetPlayerRow,
  NetPlayerSnapshot,
} from "./multiplayerTypes";

const MOTION_STATE_FALLBACK: MotionState = "idle";

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
  const [ringRows] = useTable(tables.ringState);
  const [fireballRows] = useTable(tables.fireballEvent);

  const sendUpsertPlayerState = useSpacetimeReducer(reducers.upsertPlayerState);
  const sendCastFireball = useSpacetimeReducer(reducers.castFireball);
  const sendCollectRing = useSpacetimeReducer(reducers.collectRing);

  const seenFireballEventsRef = useRef<Set<string>>(new Set());
  const hasConnectedOnceRef = useRef(false);

  const localIdentity = connectionState.identity?.toHexString() ?? null;

  useEffect(() => {
    if (connectionState.token && connectionState.token.length > 0) {
      persistMultiplayerToken(connectionState.token);
    }
  }, [connectionState.token]);

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
      ringRowCount: ringRows.length,
      fireballEventRowCount: fireballRows.length,
    });
  }, [fireballRows.length, playerRows.length, ringRows.length, store]);

  useEffect(() => {
    const remotePlayers = new Map<string, AuthoritativePlayerState>();
    let authoritativeLocalPlayer: AuthoritativePlayerState | null = null;

    for (const row of playerRows) {
      const player = toAuthoritativePlayerState(row);
      if (localIdentity && player.identity === localIdentity) {
        authoritativeLocalPlayer = player;
      } else {
        remotePlayers.set(player.identity, player);
      }
    }

    setAuthoritativeLocalPlayerState(store, authoritativeLocalPlayer);
    setRemotePlayers(store, remotePlayers);
  }, [localIdentity, playerRows, store]);

  useEffect(() => {
    const collectedRingIds = new Set<string>();
    for (const ring of ringRows) {
      if (ring.collected) {
        collectedRingIds.add(ring.ringId);
      }
    }

    setCollectedRingIds(store, collectedRingIds);
    applyServerRingState(worldEntityManager, collectedRingIds);
  }, [ringRows, store, worldEntityManager]);

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

  const localDisplayName = store.state.localDisplayName;

  const sendLocalPlayerSnapshot = useCallback(
    (snapshot: NetPlayerSnapshot) => {
      if (!connectionState.isActive) {
        return;
      }
      sendUpsertPlayerState({
        ...snapshot,
        displayName: localDisplayName,
      });
    },
    [connectionState.isActive, localDisplayName, sendUpsertPlayerState],
  );

  const sendLocalFireballCast = useCallback(
    (request: {
      originX: number;
      originY: number;
      originZ: number;
      directionX: number;
      directionY: number;
      directionZ: number;
    }) => {
      if (!connectionState.isActive) {
        return;
      }
      sendCastFireball(request);
    },
    [connectionState.isActive, sendCastFireball],
  );

  const sendRingCollect = useCallback(
    (ringId: string) => {
      if (!connectionState.isActive) {
        return;
      }
      sendCollectRing({ ringId });
    },
    [connectionState.isActive, sendCollectRing],
  );

  return {
    sendLocalPlayerSnapshot,
    sendLocalFireballCast,
    sendRingCollect,
  };
}
