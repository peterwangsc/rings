import { TERRAIN_CHUNK_HALF_EXTENT, TERRAIN_CHUNK_SIZE } from './constants';
import { hash1D } from './terrain';

export type ChunkCoord = {
  x: number;
  z: number;
};

export function getChunkCoordinate(value: number) {
  return Math.floor(
    (value + TERRAIN_CHUNK_HALF_EXTENT) / TERRAIN_CHUNK_SIZE,
  );
}

export function getChunkCoordFromWorld(x: number, z: number): ChunkCoord {
  return {
    x: getChunkCoordinate(x),
    z: getChunkCoordinate(z),
  };
}

export function getChunkKey(chunkX: number, chunkZ: number) {
  return `${chunkX},${chunkZ}`;
}

export function getChunkCenterWorld(chunkCoordinate: number) {
  return chunkCoordinate * TERRAIN_CHUNK_SIZE;
}

export function chunkHashN(
  chunkX: number,
  chunkZ: number,
  index: number,
  salt: number,
) {
  return hash1D(chunkX * 127.3 + chunkZ * 311.7 + index * salt);
}

export function iterateChunksAround(
  centerX: number,
  centerZ: number,
  radius: number,
) {
  const chunks: ChunkCoord[] = [];
  for (let zOffset = -radius; zOffset <= radius; zOffset += 1) {
    for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
      chunks.push({
        x: centerX + xOffset,
        z: centerZ + zOffset,
      });
    }
  }
  return chunks;
}
