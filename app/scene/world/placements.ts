import * as THREE from "three";
import {
  CAMPFIRE_POSITION,
  CHUNK_CLOUD_COUNT,
  CHUNK_CLOUD_MAX_HEIGHT,
  CHUNK_CLOUD_MAX_OPACITY,
  CHUNK_CLOUD_MAX_SEGMENTS,
  CHUNK_CLOUD_MAX_SPEED,
  CHUNK_CLOUD_MIN_HEIGHT,
  CHUNK_CLOUD_MIN_OPACITY,
  CHUNK_CLOUD_MIN_SEGMENTS,
  CHUNK_CLOUD_MIN_SPEED,
  CHUNK_ROCK_COUNT,
  CHUNK_ROCK_MIN_SPACING,
  CHUNK_ROCK_SCALE_MAX,
  CHUNK_ROCK_SCALE_MIN,
  CHUNK_SPAWN_CLEARING_RADIUS,
  CHUNK_TREE_COUNT,
  CHUNK_TREE_HEIGHT_SCALE_MAX,
  CHUNK_TREE_HEIGHT_SCALE_MIN,
  CHUNK_TREE_MIN_SPACING,
  CHUNK_TREE_ROCK_CLEARANCE,
  ROCK_FORMATIONS,
} from "../../utils/constants";
import {
  hash1D,
  sampleTerrainHeight,
  sampleTerrainSlope,
} from "../../utils/terrain";
import {
  getSingleTreeTrunkCollider,
  type SingleTreeTrunkCollider,
} from "../../vegetation/trees/SingleTree";
import { TERRAIN_CHUNK_SIZE } from "./terrainChunks";
import type { ChunkCloudPlacement, ChunkRockPlacement } from "./worldTypes";

const ROCK_COLLIDER_PADDING = 0.02;
const LANDSCAPE_TREE_GROUND_SINK = 0.35;

export type SingleTreePlacement = {
  id: string;
  position: readonly [number, number, number];
  heightScale: number;
  trunkCollider: SingleTreeTrunkCollider;
};

type HasColliderShape = {
  position: readonly [number, number, number];
  colliderHalfExtents: readonly [number, number, number];
  colliderOffset: readonly [number, number, number];
};

export function isNearRock(
  x: number,
  z: number,
  clearance: number,
  rockPlacements: readonly HasColliderShape[],
) {
  return rockPlacements.some((rock) => {
    const rockCenterX = rock.position[0] + rock.colliderOffset[0];
    const rockCenterZ = rock.position[2] + rock.colliderOffset[2];
    const dx = x - rockCenterX;
    const dz = z - rockCenterZ;
    const clearX = rock.colliderHalfExtents[0] + clearance;
    const clearZ = rock.colliderHalfExtents[2] + clearance;
    if (Math.abs(dx) < clearX && Math.abs(dz) < clearZ) {
      return true;
    }
    const radialClear = Math.max(clearX, clearZ);
    return dx * dx + dz * dz < radialClear * radialClear;
  });
}

export function createRockPlacements(
  rockGeometries: readonly THREE.BufferGeometry[],
) {
  return ROCK_FORMATIONS.map((rock, index) => {
    const geometry = rockGeometries[index];
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    const boundingBox = geometry.boundingBox;
    if (!boundingBox) {
      throw new Error(`Rock geometry ${index} is missing a bounding box.`);
    }

    const scaledMin = boundingBox.min
      .clone()
      .multiply(new THREE.Vector3(rock.scale[0], rock.scale[1], rock.scale[2]));
    const scaledMax = boundingBox.max
      .clone()
      .multiply(new THREE.Vector3(rock.scale[0], rock.scale[1], rock.scale[2]));
    const size = scaledMax.clone().sub(scaledMin);
    const center = scaledMin.clone().add(scaledMax).multiplyScalar(0.5);

    return {
      ...rock,
      terrainY: sampleTerrainHeight(rock.position[0], rock.position[2]),
      colliderHalfExtents: [
        Math.max(size.x * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
        Math.max(size.y * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
        Math.max(size.z * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
      ] as const,
      colliderOffset: [center.x, center.y, center.z] as const,
    };
  });
}

export function createCampfirePlacement() {
  return [
    CAMPFIRE_POSITION[0],
    sampleTerrainHeight(CAMPFIRE_POSITION[0], CAMPFIRE_POSITION[2]) +
      CAMPFIRE_POSITION[1],
    CAMPFIRE_POSITION[2],
  ] as const;
}

// --- Deterministic chunk hash ---

function chunkHashN(
  chunkX: number,
  chunkZ: number,
  index: number,
  salt: number,
) {
  return hash1D(chunkX * 127.3 + chunkZ * 311.7 + index * salt);
}

// --- Per-chunk rock placement ---

export function createChunkRockPlacements(
  chunkX: number,
  chunkZ: number,
): ChunkRockPlacement[] {
  const chunkCenterX = chunkX * TERRAIN_CHUNK_SIZE;
  const chunkCenterZ = chunkZ * TERRAIN_CHUNK_SIZE;
  const margin = 4;
  const isOriginChunk = chunkX === 0 && chunkZ === 0;

  const placements: ChunkRockPlacement[] = [];
  const maxAttempts = CHUNK_ROCK_COUNT * 30;

  for (
    let attempt = 0;
    attempt < maxAttempts && placements.length < CHUNK_ROCK_COUNT;
    attempt++
  ) {
    const hx = chunkHashN(chunkX, chunkZ, attempt, 17.31);
    const hz = chunkHashN(chunkX, chunkZ, attempt, 23.47);
    const x = chunkCenterX + (hx - 0.5) * (TERRAIN_CHUNK_SIZE - margin * 2);
    const z = chunkCenterZ + (hz - 0.5) * (TERRAIN_CHUNK_SIZE - margin * 2);

    // Skip spawn clearing on origin chunk
    if (isOriginChunk && Math.hypot(x, z) < CHUNK_SPAWN_CLEARING_RADIUS) {
      continue;
    }

    // Skip steep slopes
    const slope = sampleTerrainSlope(x, z);
    if (slope > 1.2) {
      continue;
    }

    // Min spacing between rocks
    const tooClose = placements.some((r) => {
      const dx = r.position[0] - x;
      const dz = r.position[2] - z;
      return (
        dx * dx + dz * dz < CHUNK_ROCK_MIN_SPACING * CHUNK_ROCK_MIN_SPACING
      );
    });
    if (tooClose) {
      continue;
    }

    const scaleSample = chunkHashN(chunkX, chunkZ, attempt, 31.19);
    const baseScale = THREE.MathUtils.lerp(
      CHUNK_ROCK_SCALE_MIN,
      CHUNK_ROCK_SCALE_MAX,
      scaleSample,
    );
    const sx =
      baseScale *
      THREE.MathUtils.lerp(
        0.8,
        1.2,
        chunkHashN(chunkX, chunkZ, attempt, 37.41),
      );
    const sy =
      baseScale *
      THREE.MathUtils.lerp(
        0.6,
        1.0,
        chunkHashN(chunkX, chunkZ, attempt, 41.73),
      );
    const sz =
      baseScale *
      THREE.MathUtils.lerp(
        0.8,
        1.2,
        chunkHashN(chunkX, chunkZ, attempt, 47.11),
      );

    const geometrySeed = Math.floor(
      chunkHashN(chunkX, chunkZ, attempt, 53.29) * 100000,
    );
    const terrainY = sampleTerrainHeight(x, z);

    // Approximate collider from scale (before geometry is generated)
    const colliderHalf: readonly [number, number, number] = [
      Math.max(sx * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
      Math.max(sy * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
      Math.max(sz * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
    ];

    placements.push({
      position: [x, sy * 0.5, z] as const,
      scale: [sx, sy, sz] as const,
      collider: [sx * 0.5, sy * 0.5, sz * 0.5] as const,
      geometrySeed,
      terrainY,
      colliderHalfExtents: colliderHalf,
      colliderOffset: [0, 0, 0] as const,
    });
  }

  return placements;
}

// --- Per-chunk tree placement ---

export function createChunkTreePlacements(
  chunkX: number,
  chunkZ: number,
  rockPlacements: readonly ChunkRockPlacement[],
): SingleTreePlacement[] {
  const chunkCenterX = chunkX * TERRAIN_CHUNK_SIZE;
  const chunkCenterZ = chunkZ * TERRAIN_CHUNK_SIZE;
  const margin = 3;
  const isOriginChunk = chunkX === 0 && chunkZ === 0;

  const placements: SingleTreePlacement[] = [];
  const points: { x: number; z: number }[] = [];
  const maxAttempts = CHUNK_TREE_COUNT * 30;

  for (
    let attempt = 0;
    attempt < maxAttempts && placements.length < CHUNK_TREE_COUNT;
    attempt++
  ) {
    const hx = chunkHashN(chunkX, chunkZ, attempt, 61.37);
    const hz = chunkHashN(chunkX, chunkZ, attempt, 67.53);
    const x = chunkCenterX + (hx - 0.5) * (TERRAIN_CHUNK_SIZE - margin * 2);
    const z = chunkCenterZ + (hz - 0.5) * (TERRAIN_CHUNK_SIZE - margin * 2);

    // Skip spawn clearing and campfire area on origin chunk
    if (isOriginChunk) {
      if (Math.hypot(x, z) < CHUNK_SPAWN_CLEARING_RADIUS + 2) {
        continue;
      }
      if (
        Math.hypot(x - CAMPFIRE_POSITION[0], z - CAMPFIRE_POSITION[2]) <
        CHUNK_SPAWN_CLEARING_RADIUS
      ) {
        continue;
      }
    }

    // Rock clearance
    if (isNearRock(x, z, CHUNK_TREE_ROCK_CLEARANCE, rockPlacements)) {
      continue;
    }

    // Tree spacing
    const tooClose = points.some((p) => {
      const dx = p.x - x;
      const dz = p.z - z;
      return (
        dx * dx + dz * dz < CHUNK_TREE_MIN_SPACING * CHUNK_TREE_MIN_SPACING
      );
    });
    if (tooClose) {
      continue;
    }

    points.push({ x, z });
    const y = sampleTerrainHeight(x, z) - LANDSCAPE_TREE_GROUND_SINK;
    const heightScale = THREE.MathUtils.lerp(
      CHUNK_TREE_HEIGHT_SCALE_MIN,
      CHUNK_TREE_HEIGHT_SCALE_MAX,
      chunkHashN(chunkX, chunkZ, attempt, 73.91),
    );

    placements.push({
      id: `chunk-tree-${chunkX}-${chunkZ}-${placements.length}`,
      position: [x, y, z] as const,
      heightScale,
      trunkCollider: getSingleTreeTrunkCollider(heightScale),
    });
  }

  return placements;
}

// --- Per-chunk cloud placement ---

export function createChunkCloudPlacements(
  chunkX: number,
  chunkZ: number,
): ChunkCloudPlacement[] {
  const chunkCenterX = chunkX * TERRAIN_CHUNK_SIZE;
  const chunkCenterZ = chunkZ * TERRAIN_CHUNK_SIZE;
  const placements: ChunkCloudPlacement[] = [];

  for (let i = 0; i < CHUNK_CLOUD_COUNT; i++) {
    const hx = chunkHashN(chunkX, chunkZ, i, 83.17);
    const hz = chunkHashN(chunkX, chunkZ, i, 89.31);
    const hy = chunkHashN(chunkX, chunkZ, i, 97.43);
    const x = chunkCenterX + (hx - 0.5) * TERRAIN_CHUNK_SIZE;
    const z = chunkCenterZ + (hz - 0.5) * TERRAIN_CHUNK_SIZE;
    const y = THREE.MathUtils.lerp(
      CHUNK_CLOUD_MIN_HEIGHT,
      CHUNK_CLOUD_MAX_HEIGHT,
      hy,
    );

    const segHash = chunkHashN(chunkX, chunkZ, i, 101.59);
    const segments = Math.round(
      THREE.MathUtils.lerp(
        CHUNK_CLOUD_MIN_SEGMENTS,
        CHUNK_CLOUD_MAX_SEGMENTS,
        segHash,
      ),
    );

    const boundsW = THREE.MathUtils.lerp(
      12,
      22,
      chunkHashN(chunkX, chunkZ, i, 107.71),
    );
    const boundsH = THREE.MathUtils.lerp(
      3,
      6,
      chunkHashN(chunkX, chunkZ, i, 113.83),
    );

    const opacity = THREE.MathUtils.lerp(
      CHUNK_CLOUD_MIN_OPACITY,
      CHUNK_CLOUD_MAX_OPACITY,
      chunkHashN(chunkX, chunkZ, i, 119.97),
    );
    const speed = THREE.MathUtils.lerp(
      CHUNK_CLOUD_MIN_SPEED,
      CHUNK_CLOUD_MAX_SPEED,
      chunkHashN(chunkX, chunkZ, i, 127.13),
    );

    const seed = Math.floor(chunkHashN(chunkX, chunkZ, i, 131.29) * 100000);

    placements.push({
      position: [x, y, z] as const,
      seed,
      segments,
      bounds: [boundsW, boundsH, 1] as const,
      opacity,
      speed,
    });
  }

  return placements;
}
