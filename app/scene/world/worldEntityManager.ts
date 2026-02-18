"use client";

import { useSyncExternalStore } from "react";
import * as THREE from "three";
import {
  createFireballManager,
  setFireballManagerMaxActiveCount,
  type FireballManager,
} from "../../gameplay/abilities/fireballManager";
import {
  PLAYER_START_POSITION,
  RING_HOVER_HEIGHT,
  RING_PLACEMENTS,
} from "../../utils/constants";
import { sampleTerrainHeight } from "../../utils/terrain";
import {
  computeAndCacheChunkData,
  isChunkCached,
  prefetchChunk,
} from "./chunkDataCache";
import {
  ACTIVE_TERRAIN_CHUNK_RADIUS,
  getActiveTerrainChunks,
  getChunkCoordinate,
} from "./terrainChunks";
import type { TerrainChunkCoord } from "./worldTypes";

const PREFETCH_RADIUS = ACTIVE_TERRAIN_CHUNK_RADIUS + 1;
const FALLBACK_IDLE_BUDGET_MS = 8;

type IdleCallbackFn = (deadline: IdleDeadline) => void;

function createFallbackIdleDeadline(): IdleDeadline {
  const start = performance.now();
  return {
    didTimeout: false,
    timeRemaining: () =>
      Math.max(0, FALLBACK_IDLE_BUDGET_MS - (performance.now() - start)),
  };
}

function scheduleIdleCallback(callback: IdleCallbackFn) {
  if (typeof globalThis.requestIdleCallback === "function") {
    return globalThis.requestIdleCallback(callback);
  }
  return globalThis.setTimeout(() => {
    callback(createFallbackIdleDeadline());
  }, 1);
}

function cancelScheduledIdleCallback(requestId: number) {
  if (typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(requestId);
    return;
  }
  clearTimeout(requestId);
}

export interface WorldChunkSlot {
  slot: number;
  chunkX: number;
  chunkZ: number;
}

export interface WorldRingEntity {
  id: string;
  position: readonly [number, number, number];
  collected: boolean;
  source: "starter" | "drop";
  spawnedAtMs?: number;
}

export interface WorldRingSnapshot {
  id: string;
  x: number;
  y: number;
  z: number;
  collected: boolean;
  source: "starter" | "drop";
  spawnedAtMs?: number;
}

export interface WorldHudState {
  ringCount: number;
  totalRings: number;
}

export interface WorldEntityManager {
  readonly playerPosition: THREE.Vector3;
  readonly fireballManager: FireballManager;
  readonly activeChunkSlots: WorldChunkSlot[];
  readonly ringEntities: WorldRingEntity[];
  readonly visibleRingEntities: WorldRingEntity[];
  readonly hud: WorldHudState;
  centerChunk: TerrainChunkCoord;
  prefetchRequestId: number | null;
  version: number;
  listeners: Set<() => void>;
}

function emitWorldManagerChanged(world: WorldEntityManager) {
  world.version += 1;
  world.listeners.forEach((listener) => listener());
}

function buildRingEntities() {
  return RING_PLACEMENTS.map((xz, index) => ({
    id: `ring-${index}`,
    position: [
      xz[0],
      sampleTerrainHeight(xz[0], xz[1]) + RING_HOVER_HEIGHT,
      xz[1],
    ] as const,
    collected: false,
    source: "starter" as const,
    spawnedAtMs: undefined,
  }));
}

function syncVisibleRings(world: WorldEntityManager) {
  world.visibleRingEntities.length = 0;
  for (let index = 0; index < world.ringEntities.length; index += 1) {
    const ring = world.ringEntities[index];
    if (!ring.collected) {
      world.visibleRingEntities.push(ring);
    }
  }
}

function applyRingCountToHudAndFireballManager(
  world: WorldEntityManager,
  ringCount: number,
) {
  const normalizedRingCount = Math.max(0, Math.floor(ringCount));
  if (normalizedRingCount > world.hud.totalRings) {
    world.hud.totalRings = normalizedRingCount;
  }
  if (
    world.hud.ringCount === normalizedRingCount &&
    world.fireballManager.maxActiveCount === normalizedRingCount
  ) {
    return false;
  }

  world.hud.ringCount = normalizedRingCount;
  setFireballManagerMaxActiveCount(
    world.fireballManager,
    normalizedRingCount,
  );
  return true;
}

function upsertActiveChunkSlots(
  world: WorldEntityManager,
  centerChunk: TerrainChunkCoord,
) {
  const activeChunks = getActiveTerrainChunks(centerChunk);

  for (let index = 0; index < activeChunks.length; index += 1) {
    const coord = activeChunks[index];
    const existingSlot = world.activeChunkSlots[index];
    if (existingSlot) {
      existingSlot.chunkX = coord.x;
      existingSlot.chunkZ = coord.z;
    } else {
      world.activeChunkSlots.push({
        slot: index,
        chunkX: coord.x,
        chunkZ: coord.z,
      });
    }
    computeAndCacheChunkData(coord.x, coord.z);
  }

  if (world.activeChunkSlots.length > activeChunks.length) {
    world.activeChunkSlots.length = activeChunks.length;
  }
}

function getPrefetchTargets(center: TerrainChunkCoord) {
  const targets: TerrainChunkCoord[] = [];
  for (let dz = -PREFETCH_RADIUS; dz <= PREFETCH_RADIUS; dz += 1) {
    for (let dx = -PREFETCH_RADIUS; dx <= PREFETCH_RADIUS; dx += 1) {
      if (
        Math.abs(dx) <= ACTIVE_TERRAIN_CHUNK_RADIUS &&
        Math.abs(dz) <= ACTIVE_TERRAIN_CHUNK_RADIUS
      ) {
        continue;
      }

      const chunkX = center.x + dx;
      const chunkZ = center.z + dz;
      if (!isChunkCached(chunkX, chunkZ)) {
        targets.push({ x: chunkX, z: chunkZ });
      }
    }
  }
  return targets;
}

function scheduleChunkPrefetch(
  world: WorldEntityManager,
  centerChunk: TerrainChunkCoord,
) {
  if (world.prefetchRequestId !== null) {
    cancelScheduledIdleCallback(world.prefetchRequestId);
    world.prefetchRequestId = null;
  }

  const targets = getPrefetchTargets(centerChunk);
  if (targets.length === 0) {
    return;
  }

  let targetIndex = 0;
  function prefetchNext(deadline: IdleDeadline) {
    while (targetIndex < targets.length && deadline.timeRemaining() > 5) {
      const target = targets[targetIndex];
      prefetchChunk(target.x, target.z);
      targetIndex += 1;
    }

    if (targetIndex < targets.length) {
      world.prefetchRequestId = scheduleIdleCallback(prefetchNext);
      return;
    }

    world.prefetchRequestId = null;
  }

  world.prefetchRequestId = scheduleIdleCallback(prefetchNext);
}

export function createWorldEntityManager(): WorldEntityManager {
  const centerChunk: TerrainChunkCoord = {
    x: getChunkCoordinate(PLAYER_START_POSITION.x),
    z: getChunkCoordinate(PLAYER_START_POSITION.z),
  };

  const world: WorldEntityManager = {
    playerPosition: PLAYER_START_POSITION.clone(),
    fireballManager: createFireballManager(),
    activeChunkSlots: [],
    ringEntities: buildRingEntities(),
    visibleRingEntities: [],
    hud: {
      ringCount: 0,
      totalRings: RING_PLACEMENTS.length,
    },
    centerChunk,
    prefetchRequestId: null,
    version: 0,
    listeners: new Set(),
  };

  upsertActiveChunkSlots(world, centerChunk);
  syncVisibleRings(world);
  applyRingCountToHudAndFireballManager(world, 0);
  scheduleChunkPrefetch(world, centerChunk);
  return world;
}

export function disposeWorldEntityManager(world: WorldEntityManager) {
  if (world.prefetchRequestId !== null) {
    cancelScheduledIdleCallback(world.prefetchRequestId);
    world.prefetchRequestId = null;
  }
  world.listeners.clear();
}

export function subscribeWorldEntityManager(
  world: WorldEntityManager,
  listener: () => void,
) {
  world.listeners.add(listener);
  return () => {
    world.listeners.delete(listener);
  };
}

export function useWorldEntityVersion(world: WorldEntityManager) {
  return useSyncExternalStore(
    (listener) => subscribeWorldEntityManager(world, listener),
    () => world.version,
    () => world.version,
  );
}

export function updateWorldPlayerPosition(
  world: WorldEntityManager,
  x: number,
  y: number,
  z: number,
) {
  world.playerPosition.set(x, y, z);

  const nextChunkX = getChunkCoordinate(x);
  const nextChunkZ = getChunkCoordinate(z);
  if (
    nextChunkX === world.centerChunk.x &&
    nextChunkZ === world.centerChunk.z
  ) {
    return;
  }

  world.centerChunk = { x: nextChunkX, z: nextChunkZ };
  upsertActiveChunkSlots(world, world.centerChunk);
  scheduleChunkPrefetch(world, world.centerChunk);
  emitWorldManagerChanged(world);
}

export function collectWorldRing(world: WorldEntityManager, ringId: string) {
  const ring = world.ringEntities.find((candidate) => candidate.id === ringId);
  if (!ring || ring.collected) {
    return;
  }

  ring.collected = true;
  syncVisibleRings(world);
  applyRingCountToHudAndFireballManager(
    world,
    world.ringEntities.length - world.visibleRingEntities.length,
  );
  emitWorldManagerChanged(world);
}

export function applyServerRingRows(
  world: WorldEntityManager,
  ringRows: readonly WorldRingSnapshot[],
) {
  const existingById = new Map<string, WorldRingEntity>();
  for (let index = 0; index < world.ringEntities.length; index += 1) {
    const ring = world.ringEntities[index];
    existingById.set(ring.id, ring);
  }

  const nextRingEntities: WorldRingEntity[] = [];
  let didChange = false;

  for (let index = 0; index < ringRows.length; index += 1) {
    const snapshot = ringRows[index];
    const existing = existingById.get(snapshot.id);
    if (!existing) {
      nextRingEntities.push({
        id: snapshot.id,
        position: [snapshot.x, snapshot.y, snapshot.z],
        collected: snapshot.collected,
        source: snapshot.source,
        spawnedAtMs: snapshot.spawnedAtMs,
      });
      didChange = true;
      continue;
    }

    existingById.delete(snapshot.id);
    const [x, y, z] = existing.position;
    if (
      x !== snapshot.x ||
      y !== snapshot.y ||
      z !== snapshot.z ||
      existing.collected !== snapshot.collected ||
      existing.source !== snapshot.source ||
      existing.spawnedAtMs !== snapshot.spawnedAtMs
    ) {
      existing.position = [snapshot.x, snapshot.y, snapshot.z];
      existing.collected = snapshot.collected;
      existing.source = snapshot.source;
      existing.spawnedAtMs = snapshot.spawnedAtMs;
      didChange = true;
    }
    nextRingEntities.push(existing);
  }

  if (existingById.size > 0) {
    didChange = true;
  }

  if (!didChange) {
    return;
  }

  world.ringEntities.splice(0, world.ringEntities.length, ...nextRingEntities);
  syncVisibleRings(world);
  emitWorldManagerChanged(world);
}

export function setWorldLocalRingCount(
  world: WorldEntityManager,
  ringCount: number,
) {
  if (!applyRingCountToHudAndFireballManager(world, ringCount)) {
    return;
  }

  emitWorldManagerChanged(world);
}
