import * as THREE from "three";
import { createProceduralRockGeometry } from "../../utils/rockGeometry";
import type { GrassFieldData } from "./grassField";
import { createChunkGrassField } from "./grassField";
import {
  createCampfirePlacement,
  createChunkCloudPlacements,
  createChunkRockPlacements,
  createChunkTreePlacements,
  type SingleTreePlacement,
} from "./placements";
import type { ChunkCloudPlacement, ChunkRockPlacement } from "./worldTypes";

export type CachedChunkData = {
  rocks: ChunkRockPlacement[];
  rockGeometries: THREE.BufferGeometry[];
  trees: SingleTreePlacement[];
  grassField: GrassFieldData;
  clouds: ChunkCloudPlacement[];
  campfirePlacement: readonly [number, number, number] | null;
};

const cache = new Map<string, CachedChunkData>();
const accessOrder: string[] = [];
const MAX_CACHE_SIZE = 25;

function cacheKey(chunkX: number, chunkZ: number) {
  return `${chunkX},${chunkZ}`;
}

function evictOldest() {
  while (cache.size >= MAX_CACHE_SIZE && accessOrder.length > 0) {
    const key = accessOrder.shift()!;
    const entry = cache.get(key);
    if (entry) {
      entry.rockGeometries.forEach((g) => g.dispose());
      entry.grassField.bladeGeometry.dispose();
      cache.delete(key);
    }
  }
}

function touchKey(key: string) {
  const idx = accessOrder.indexOf(key);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(key);
}

function computeChunkData(chunkX: number, chunkZ: number): CachedChunkData {
  const rocks = createChunkRockPlacements(chunkX, chunkZ);
  const rockGeometries = rocks.map((r) =>
    createProceduralRockGeometry(r.geometrySeed),
  );
  const trees = createChunkTreePlacements(chunkX, chunkZ, rocks);
  const grassField = createChunkGrassField(chunkX, chunkZ, rocks);
  const clouds = createChunkCloudPlacements(chunkX, chunkZ);
  const isOrigin = chunkX === 0 && chunkZ === 0;
  const campfirePlacement = isOrigin ? createCampfirePlacement() : null;

  return { rocks, rockGeometries, trees, grassField, clouds, campfirePlacement };
}

export function getChunkData(
  chunkX: number,
  chunkZ: number,
): CachedChunkData | null {
  const key = cacheKey(chunkX, chunkZ);
  const cached = cache.get(key);
  if (cached) {
    touchKey(key);
    return cached;
  }
  return null;
}

export function computeAndCacheChunkData(
  chunkX: number,
  chunkZ: number,
): CachedChunkData {
  const key = cacheKey(chunkX, chunkZ);
  const existing = cache.get(key);
  if (existing) {
    touchKey(key);
    return existing;
  }

  evictOldest();
  const data = computeChunkData(chunkX, chunkZ);
  cache.set(key, data);
  accessOrder.push(key);
  return data;
}

export function isChunkCached(chunkX: number, chunkZ: number): boolean {
  return cache.has(cacheKey(chunkX, chunkZ));
}

/**
 * Prefetch a single chunk if not already cached.
 * Returns true if work was done, false if already cached.
 */
export function prefetchChunk(chunkX: number, chunkZ: number): boolean {
  if (isChunkCached(chunkX, chunkZ)) return false;
  computeAndCacheChunkData(chunkX, chunkZ);
  return true;
}
