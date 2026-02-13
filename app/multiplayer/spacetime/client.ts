"use client";

import { DbConnection } from "./bindings";

const DEFAULT_SPACETIMEDB_URI = "ws://127.0.0.1:3001";
const DEFAULT_SPACETIMEDB_MODULE = "rings-multiplayer";
const LEGACY_MULTIPLAYER_TOKEN_STORAGE_KEY = "rings.multiplayer.token";
const MULTIPLAYER_TOKEN_STORAGE_KEY_PREFIX = "rings.multiplayer.token";
const MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY = "rings.multiplayer.display_name";

function resolveSpacetimeUri(rawUri: string) {
  const trimmed = rawUri.trim();
  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length)}`;
  }
  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length)}`;
  }
  return trimmed;
}

function resolveConnectionConfig() {
  const uri = resolveSpacetimeUri(
    process.env.NEXT_PUBLIC_SPACETIMEDB_URI ?? DEFAULT_SPACETIMEDB_URI,
  );
  const moduleName =
    process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? DEFAULT_SPACETIMEDB_MODULE;
  return { uri, moduleName };
}

function getTokenStorageKey(uri: string, moduleName: string) {
  return `${MULTIPLAYER_TOKEN_STORAGE_KEY_PREFIX}:${uri}:${moduleName}`;
}

function readStoredToken(uri: string, moduleName: string) {
  if (typeof window === "undefined") {
    return undefined;
  }
  const scopedToken = window.localStorage.getItem(
    getTokenStorageKey(uri, moduleName),
  );
  return scopedToken && scopedToken.length > 0 ? scopedToken : undefined;
}

export function persistMultiplayerToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  const { uri, moduleName } = resolveConnectionConfig();
  window.localStorage.setItem(getTokenStorageKey(uri, moduleName), token);
  window.localStorage.removeItem(LEGACY_MULTIPLAYER_TOKEN_STORAGE_KEY);
}

export function clearMultiplayerToken() {
  if (typeof window === "undefined") {
    return;
  }
  const { uri, moduleName } = resolveConnectionConfig();
  window.localStorage.removeItem(getTokenStorageKey(uri, moduleName));
  window.localStorage.removeItem(LEGACY_MULTIPLAYER_TOKEN_STORAGE_KEY);
}

export function getOrCreateGuestDisplayName() {
  if (typeof window === "undefined") {
    return "Guest-local";
  }

  const existing = window.localStorage.getItem(
    MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY,
  );
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }

  const suffix = globalThis.crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 6)
    .toUpperCase();
  const displayName = `Guest-${suffix}`;
  window.localStorage.setItem(MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY, displayName);
  return displayName;
}

export function createSpacetimeConnectionBuilder() {
  const { uri, moduleName } = resolveConnectionConfig();

  return DbConnection.builder()
    .withUri(uri)
    .withModuleName(moduleName)
    .withToken(readStoredToken(uri, moduleName))
    .withLightMode(true);
}
