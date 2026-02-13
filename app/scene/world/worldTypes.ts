import { ROCK_FORMATIONS } from "../../utils/constants";

export type RockPlacement = (typeof ROCK_FORMATIONS)[number] & {
  terrainY: number;
  colliderHalfExtents: readonly [number, number, number];
  colliderOffset: readonly [number, number, number];
};

export type TerrainChunkCoord = {
  x: number;
  z: number;
};

export type ChunkCloudPlacement = {
  position: readonly [number, number, number];
  seed: number;
  segments: number;
  bounds: readonly [number, number, number];
  opacity: number;
  speed: number;
};

export type ChunkRockPlacement = {
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  collider: readonly [number, number, number];
  geometrySeed: number;
  terrainY: number;
  colliderHalfExtents: readonly [number, number, number];
  colliderOffset: readonly [number, number, number];
};
