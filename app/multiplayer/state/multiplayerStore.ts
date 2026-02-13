"use client";

import { useSyncExternalStore } from "react";
import type {
  AuthoritativePlayerState,
  ChatMessageEvent,
  ConnectionStatus,
  FireballSpawnEvent,
  GoombaState,
  MultiplayerDiagnostics,
  MultiplayerState,
} from "./multiplayerTypes";

const EMPTY_DIAGNOSTICS: MultiplayerDiagnostics = {
  playerRowCount: 0,
  ringRowCount: 0,
  fireballEventRowCount: 0,
  chatMessageRowCount: 0,
};
const DEFAULT_DAY_CYCLE_DURATION_SECONDS = 300;

export interface MultiplayerStore {
  version: number;
  listeners: Set<() => void>;
  state: MultiplayerState;
}

function emitChanged(store: MultiplayerStore) {
  store.version += 1;
  store.listeners.forEach((listener) => listener());
}

function cloneState(state: MultiplayerState): MultiplayerState {
  return {
    ...state,
    remotePlayers: new Map(state.remotePlayers),
    goombas: new Map(state.goombas),
    collectedRingIds: new Set(state.collectedRingIds),
    pendingRemoteFireballSpawns: [...state.pendingRemoteFireballSpawns],
    chatMessages: [...state.chatMessages],
  };
}

function hasMapContentChanged<T>(a: Map<string, T>, b: Map<string, T>) {
  if (a.size !== b.size) {
    return true;
  }
  for (const [key, value] of a.entries()) {
    if (b.get(key) !== value) {
      return true;
    }
  }
  return false;
}

function hasSetContentChanged(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) {
    return true;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return true;
    }
  }
  return false;
}

export function createMultiplayerStore(
  localDisplayName: string,
): MultiplayerStore {
  return {
    version: 0,
    listeners: new Set(),
    state: {
      connectionStatus: "connecting",
      connectionError: null,
      localIdentity: null,
      localDisplayName,
      dayCycleAnchorMs: null,
      dayCycleDurationSeconds: DEFAULT_DAY_CYCLE_DURATION_SECONDS,
      serverTimeOffsetMs: null,
      authoritativeLocalPlayerState: null,
      remotePlayers: new Map(),
      goombas: new Map(),
      collectedRingIds: new Set(),
      pendingRemoteFireballSpawns: [],
      chatMessages: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS },
    },
  };
}

export function subscribeMultiplayerStore(
  store: MultiplayerStore,
  listener: () => void,
) {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

export function useMultiplayerStoreSnapshot(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.version,
    () => store.version,
  );
}

export function setMultiplayerConnectionStatus(
  store: MultiplayerStore,
  connectionStatus: ConnectionStatus,
  connectionError: string | null,
) {
  const state = store.state;
  if (
    state.connectionStatus === connectionStatus &&
    state.connectionError === connectionError
  ) {
    return;
  }

  store.state = {
    ...state,
    connectionStatus,
    connectionError,
  };
  emitChanged(store);
}

export function setMultiplayerIdentity(
  store: MultiplayerStore,
  localIdentity: string | null,
) {
  if (store.state.localIdentity === localIdentity) {
    return;
  }

  store.state = {
    ...store.state,
    localIdentity,
  };
  emitChanged(store);
}

export function setLocalDisplayName(
  store: MultiplayerStore,
  localDisplayName: string,
) {
  if (store.state.localDisplayName === localDisplayName) {
    return;
  }

  store.state = {
    ...store.state,
    localDisplayName,
  };
  emitChanged(store);
}

export function setWorldDayCycleConfig(
  store: MultiplayerStore,
  dayCycleAnchorMs: number | null,
  dayCycleDurationSeconds: number,
) {
  const normalizedDurationSeconds =
    Number.isFinite(dayCycleDurationSeconds) && dayCycleDurationSeconds > 0
      ? dayCycleDurationSeconds
      : DEFAULT_DAY_CYCLE_DURATION_SECONDS;

  if (
    store.state.dayCycleAnchorMs === dayCycleAnchorMs &&
    store.state.dayCycleDurationSeconds === normalizedDurationSeconds
  ) {
    return;
  }

  store.state = {
    ...store.state,
    dayCycleAnchorMs,
    dayCycleDurationSeconds: normalizedDurationSeconds,
  };
  emitChanged(store);
}

export function setServerTimeOffsetMs(
  store: MultiplayerStore,
  serverTimeOffsetMs: number | null,
) {
  if (store.state.serverTimeOffsetMs === serverTimeOffsetMs) {
    return;
  }

  store.state = {
    ...store.state,
    serverTimeOffsetMs,
  };
  emitChanged(store);
}

export function setAuthoritativeLocalPlayerState(
  store: MultiplayerStore,
  nextState: AuthoritativePlayerState | null,
) {
  if (store.state.authoritativeLocalPlayerState === nextState) {
    return;
  }

  store.state = {
    ...store.state,
    authoritativeLocalPlayerState: nextState,
  };
  emitChanged(store);
}

export function setRemotePlayers(
  store: MultiplayerStore,
  remotePlayers: Map<string, AuthoritativePlayerState>,
) {
  if (!hasMapContentChanged(store.state.remotePlayers, remotePlayers)) {
    return;
  }

  const nextState = cloneState(store.state);
  nextState.remotePlayers = new Map(remotePlayers);
  store.state = nextState;
  emitChanged(store);
}

export function setGoombas(
  store: MultiplayerStore,
  goombas: Map<string, GoombaState>,
) {
  if (!hasMapContentChanged(store.state.goombas, goombas)) {
    return;
  }

  const nextState = cloneState(store.state);
  nextState.goombas = new Map(goombas);
  store.state = nextState;
  emitChanged(store);
}

export function setCollectedRingIds(
  store: MultiplayerStore,
  collectedRingIds: Set<string>,
) {
  if (!hasSetContentChanged(store.state.collectedRingIds, collectedRingIds)) {
    return;
  }

  const nextState = cloneState(store.state);
  nextState.collectedRingIds = new Set(collectedRingIds);
  store.state = nextState;
  emitChanged(store);
}

export function setMultiplayerDiagnostics(
  store: MultiplayerStore,
  diagnostics: MultiplayerDiagnostics,
) {
  const current = store.state.diagnostics;
  if (
    current.playerRowCount === diagnostics.playerRowCount &&
    current.ringRowCount === diagnostics.ringRowCount &&
    current.fireballEventRowCount === diagnostics.fireballEventRowCount &&
    current.chatMessageRowCount === diagnostics.chatMessageRowCount
  ) {
    return;
  }

  store.state = {
    ...store.state,
    diagnostics,
  };
  emitChanged(store);
}

export function setChatMessages(
  store: MultiplayerStore,
  chatMessages: readonly ChatMessageEvent[],
) {
  const currentMessages = store.state.chatMessages;
  if (currentMessages.length === chatMessages.length) {
    let hasDiff = false;
    for (let index = 0; index < currentMessages.length; index += 1) {
      if (currentMessages[index] !== chatMessages[index]) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) {
      return;
    }
  }

  const nextState = cloneState(store.state);
  nextState.chatMessages = [...chatMessages];
  store.state = nextState;
  emitChanged(store);
}

export function enqueueRemoteFireballSpawns(
  store: MultiplayerStore,
  events: readonly FireballSpawnEvent[],
) {
  if (events.length === 0) {
    return;
  }

  const nextState = cloneState(store.state);
  nextState.pendingRemoteFireballSpawns.push(...events);
  store.state = nextState;
  emitChanged(store);
}

export function consumeRemoteFireballSpawns(store: MultiplayerStore) {
  if (store.state.pendingRemoteFireballSpawns.length === 0) {
    return [] as FireballSpawnEvent[];
  }

  const pending = store.state.pendingRemoteFireballSpawns;
  const nextState = cloneState(store.state);
  nextState.pendingRemoteFireballSpawns = [];
  store.state = nextState;
  emitChanged(store);
  return pending;
}
