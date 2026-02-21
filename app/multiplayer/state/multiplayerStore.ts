"use client";

import { useSyncExternalStore } from "react";
import type {
  AuthoritativePlayerState,
  ChatMessageEvent,
  ConnectionStatus,
  GoombaState,
  MysteryBoxState,
  MultiplayerDiagnostics,
  MultiplayerState,
  PlayerInventorySnapshot,
  PlayerStatsSnapshot,
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

function areShallowValuesEqual<T>(a: T, b: T) {
  if (Object.is(a, b)) {
    return true;
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.is(aRecord[key], bRecord[key])) {
      return false;
    }
  }
  return true;
}

function syncMapInPlace<T>(target: Map<string, T>, next: Map<string, T>) {
  let didChange = false;

  for (const key of target.keys()) {
    if (next.has(key)) {
      continue;
    }
    target.delete(key);
    didChange = true;
  }

  for (const [key, nextValue] of next.entries()) {
    if (!target.has(key)) {
      target.set(key, nextValue);
      didChange = true;
      continue;
    }

    const currentValue = target.get(key) as T;
    if (areShallowValuesEqual(currentValue, nextValue)) {
      continue;
    }

    target.set(key, nextValue);
    didChange = true;
  }

  return didChange;
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
      playerInventories: new Map(),
      playerStats: new Map(),
      goombas: new Map(),
      mysteryBoxes: new Map(),
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

// ---------------------------------------------------------------------------
// Granular slice selectors — each re-renders only when its slice changes.
// Use these in leaf components instead of useMultiplayerStoreSnapshot so that
// network ticks that don't affect a given slice don't cause re-renders.
// ---------------------------------------------------------------------------

export function useConnectionStatus(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.connectionStatus,
    () => store.state.connectionStatus,
  );
}

export function useLocalIdentity(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.localIdentity,
    () => store.state.localIdentity,
  );
}

export function useLocalDisplayName(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.localDisplayName,
    () => store.state.localDisplayName,
  );
}

export function useDayCycleConfig(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.dayCycleAnchorMs,
    () => store.state.dayCycleAnchorMs,
  );
}

export function useRemotePlayers(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.remotePlayers,
    () => store.state.remotePlayers,
  );
}

export function useGoombas(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.goombas,
    () => store.state.goombas,
  );
}

export function useMysteryBoxes(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.mysteryBoxes,
    () => store.state.mysteryBoxes,
  );
}

export function useChatMessages(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.chatMessages,
    () => store.state.chatMessages,
  );
}

export function useServerTimeOffsetMs(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.serverTimeOffsetMs,
    () => store.state.serverTimeOffsetMs,
  );
}

export function useAuthoritativeLocalPlayer(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.authoritativeLocalPlayerState,
    () => store.state.authoritativeLocalPlayerState,
  );
}

export function useRemotePlayerCount(store: MultiplayerStore) {
  return useSyncExternalStore(
    (listener) => subscribeMultiplayerStore(store, listener),
    () => store.state.remotePlayers.size,
    () => store.state.remotePlayers.size,
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

  state.connectionStatus = connectionStatus;
  state.connectionError = connectionError;
  emitChanged(store);
}

export function setMultiplayerIdentity(
  store: MultiplayerStore,
  localIdentity: string | null,
) {
  const state = store.state;
  if (state.localIdentity === localIdentity) {
    return;
  }

  state.localIdentity = localIdentity;
  emitChanged(store);
}

export function setLocalDisplayName(
  store: MultiplayerStore,
  localDisplayName: string,
) {
  const state = store.state;
  if (state.localDisplayName === localDisplayName) {
    return;
  }

  state.localDisplayName = localDisplayName;
  emitChanged(store);
}

export function setWorldDayCycleConfig(
  store: MultiplayerStore,
  dayCycleAnchorMs: number | null,
  dayCycleDurationSeconds: number,
) {
  const state = store.state;
  const normalizedDurationSeconds =
    Number.isFinite(dayCycleDurationSeconds) && dayCycleDurationSeconds > 0
      ? dayCycleDurationSeconds
      : DEFAULT_DAY_CYCLE_DURATION_SECONDS;

  if (
    state.dayCycleAnchorMs === dayCycleAnchorMs &&
    state.dayCycleDurationSeconds === normalizedDurationSeconds
  ) {
    return;
  }

  state.dayCycleAnchorMs = dayCycleAnchorMs;
  state.dayCycleDurationSeconds = normalizedDurationSeconds;
  emitChanged(store);
}

export function setServerTimeOffsetMs(
  store: MultiplayerStore,
  serverTimeOffsetMs: number | null,
) {
  const state = store.state;
  if (state.serverTimeOffsetMs === serverTimeOffsetMs) {
    return;
  }

  state.serverTimeOffsetMs = serverTimeOffsetMs;
  emitChanged(store);
}

export function setAuthoritativeLocalPlayerState(
  store: MultiplayerStore,
  nextState: AuthoritativePlayerState | null,
) {
  const state = store.state;
  if (state.authoritativeLocalPlayerState === nextState) {
    return;
  }

  state.authoritativeLocalPlayerState = nextState;
  emitChanged(store);
}

export function setRemotePlayers(
  store: MultiplayerStore,
  remotePlayers: Map<string, AuthoritativePlayerState>,
) {
  if (!syncMapInPlace(store.state.remotePlayers, remotePlayers)) {
    return;
  }

  emitChanged(store);
}

export function setPlayerInventories(
  store: MultiplayerStore,
  playerInventories: Map<string, PlayerInventorySnapshot>,
) {
  if (!syncMapInPlace(store.state.playerInventories, playerInventories)) {
    return;
  }

  emitChanged(store);
}

export function setPlayerStats(
  store: MultiplayerStore,
  playerStats: Map<string, PlayerStatsSnapshot>,
) {
  if (!syncMapInPlace(store.state.playerStats, playerStats)) {
    return;
  }

  emitChanged(store);
}

export function setGoombas(
  store: MultiplayerStore,
  goombas: Map<string, GoombaState>,
) {
  const prev = store.state.goombas;
  if (prev === goombas) {
    return;
  }
  if (prev.size === goombas.size) {
    let same = true;
    for (const [key, val] of goombas) {
      if (prev.get(key) !== val) { same = false; break; }
    }
    if (same) return;
  }
  store.state.goombas = new Map(goombas);
  emitChanged(store);
}

export function setMysteryBoxes(
  store: MultiplayerStore,
  mysteryBoxes: Map<string, MysteryBoxState>,
) {
  const prev = store.state.mysteryBoxes;
  if (prev === mysteryBoxes) {
    return;
  }
  if (prev.size === mysteryBoxes.size) {
    let same = true;
    for (const [key, val] of mysteryBoxes) {
      if (prev.get(key) !== val) { same = false; break; }
    }
    if (same) return;
  }
  store.state.mysteryBoxes = new Map(mysteryBoxes);
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

  current.playerRowCount = diagnostics.playerRowCount;
  current.ringRowCount = diagnostics.ringRowCount;
  current.fireballEventRowCount = diagnostics.fireballEventRowCount;
  current.chatMessageRowCount = diagnostics.chatMessageRowCount;
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
      if (
        !areShallowValuesEqual(currentMessages[index], chatMessages[index])
      ) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) {
      return;
    }
  }

  currentMessages.length = chatMessages.length;
  for (let index = 0; index < chatMessages.length; index += 1) {
    currentMessages[index] = chatMessages[index];
  }
  emitChanged(store);
}
