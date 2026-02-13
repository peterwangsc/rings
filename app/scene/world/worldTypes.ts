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
