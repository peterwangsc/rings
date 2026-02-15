"use client";

import { DbConnection } from "./bindings";
import {
  DEFAULT_GUEST_DISPLAY_NAME,
  isLegacyGeneratedGuestDisplayName,
  pickRandomGuestDisplayName,
} from "./guestDisplayNames";

const DEFAULT_SPACETIMEDB_URI = "ws://127.0.0.1:3001";
const DEFAULT_SPACETIMEDB_MODULE = "rings-multiplayer";
const LEGACY_MULTIPLAYER_TOKEN_STORAGE_KEY = "rings.multiplayer.token";
const MULTIPLAYER_TOKEN_STORAGE_KEY_PREFIX = "rings.multiplayer.token";
const MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY = "rings.multiplayer.display_name";
const MAX_DISPLAY_NAME_LENGTH = 24;

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

export function sanitizeMultiplayerDisplayName(rawDisplayName: string) {
  const normalizedWhitespace = rawDisplayName.replace(/\s+/g, " ");
  return normalizedWhitespace.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
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
    return DEFAULT_GUEST_DISPLAY_NAME;
  }

  const existing = window.localStorage.getItem(
    MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY,
  );
  if (existing) {
    const sanitizedExisting = sanitizeMultiplayerDisplayName(existing);
    if (sanitizedExisting.length > 0) {
      if (isLegacyGeneratedGuestDisplayName(sanitizedExisting)) {
        const migratedDisplayName = pickRandomGuestDisplayName();
        window.localStorage.setItem(
          MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY,
          migratedDisplayName,
        );
        return migratedDisplayName;
      }
      if (sanitizedExisting !== existing) {
        window.localStorage.setItem(
          MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY,
          sanitizedExisting,
        );
      }
      return sanitizedExisting;
    }
  }

  const displayName = pickRandomGuestDisplayName();
  window.localStorage.setItem(MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY, displayName);
  return displayName;
}

export function setStoredGuestDisplayName(rawDisplayName: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const sanitized = sanitizeMultiplayerDisplayName(rawDisplayName);
  if (sanitized.length <= 0) {
    return null;
  }

  window.localStorage.setItem(MULTIPLAYER_DISPLAY_NAME_STORAGE_KEY, sanitized);
  return sanitized;
}

export function createSpacetimeConnectionBuilder() {
  const { uri, moduleName } = resolveConnectionConfig();

  return DbConnection.builder()
    .withUri(uri)
    .withModuleName(moduleName)
    .withToken(readStoredToken(uri, moduleName))
    .withLightMode(true);
}
