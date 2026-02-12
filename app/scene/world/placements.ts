import * as THREE from "three";
import {
  CAMPFIRE_POSITION,
  GROUND_HALF_EXTENT,
  ROCK_FORMATIONS,
} from "../../utils/constants";
import { hash1D, sampleTerrainHeight } from "../../utils/terrain";
import {
  getSingleTreeTrunkCollider,
  type SingleTreeTrunkCollider,
} from "../../vegetation/trees/SingleTree";
import type { RockPlacement } from "./worldTypes";

const TAU = Math.PI * 2;
const ROCK_COLLIDER_PADDING = 0.02;
const LANDSCAPE_TREE_TARGET_COUNT = 54;
const LANDSCAPE_TREE_FIELD_RADIUS = GROUND_HALF_EXTENT - 4;
const LANDSCAPE_TREE_MIN_SPACING = 7.2;
const LANDSCAPE_TREE_CLEARING_RADIUS = 7.5;
const LANDSCAPE_TREE_ROCK_CLEARANCE = 4;
const LANDSCAPE_TREE_GROUND_SINK = 0.35;
const LANDSCAPE_TREE_MAX_ATTEMPTS = LANDSCAPE_TREE_TARGET_COUNT * 120;

export type SingleTreePlacement = {
  id: string;
  position: readonly [number, number, number];
  heightScale: number;
  trunkCollider: SingleTreeTrunkCollider;
};

export function isNearRock(
  x: number,
  z: number,
  clearance: number,
  rockPlacements: readonly RockPlacement[],
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

export function createRockPlacements(rockGeometries: readonly THREE.BufferGeometry[]) {
  return ROCK_FORMATIONS.map((rock, index) => {
    const geometry = rockGeometries[index];
    const boundingBox = geometry.boundingBox ?? geometry.computeBoundingBox();
    if (!boundingBox) {
      throw new Error(`Rock geometry ${index} is missing a bounding box.`);
    }

    const scaledMin = boundingBox.min.clone().multiply(
      new THREE.Vector3(rock.scale[0], rock.scale[1], rock.scale[2]),
    );
    const scaledMax = boundingBox.max.clone().multiply(
      new THREE.Vector3(rock.scale[0], rock.scale[1], rock.scale[2]),
    );
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

export function createSingleTreePlacements(
  rockPlacements: readonly RockPlacement[],
): SingleTreePlacement[] {
  const placements: SingleTreePlacement[] = [];
  const points: THREE.Vector2[] = [];

  for (
    let attempt = 0;
    attempt < LANDSCAPE_TREE_MAX_ATTEMPTS &&
    placements.length < LANDSCAPE_TREE_TARGET_COUNT;
    attempt++
  ) {
    const radialSample = hash1D(attempt * 11.37 + 2.1);
    const angleSample = hash1D(attempt * 17.89 + 4.6);
    const radius = LANDSCAPE_TREE_FIELD_RADIUS * Math.sqrt(radialSample);
    const angle = angleSample * TAU;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (Math.hypot(x, z) < LANDSCAPE_TREE_CLEARING_RADIUS) {
      continue;
    }
    if (
      Math.hypot(x - CAMPFIRE_POSITION[0], z - CAMPFIRE_POSITION[2]) <
      LANDSCAPE_TREE_CLEARING_RADIUS * 1.05
    ) {
      continue;
    }
    if (isNearRock(x, z, LANDSCAPE_TREE_ROCK_CLEARANCE, rockPlacements)) {
      continue;
    }

    const tooCloseToTree = points.some((point) => {
      const dx = point.x - x;
      const dz = point.y - z;
      return (
        dx * dx + dz * dz <
        LANDSCAPE_TREE_MIN_SPACING * LANDSCAPE_TREE_MIN_SPACING
      );
    });
    if (tooCloseToTree) {
      continue;
    }

    points.push(new THREE.Vector2(x, z));
    const y = sampleTerrainHeight(x, z) - LANDSCAPE_TREE_GROUND_SINK;
    const heightScale = THREE.MathUtils.lerp(
      0.78,
      1.42,
      hash1D(attempt * 23.17 + 9.3),
    );

    placements.push({
      id: `single-tree-${placements.length}`,
      position: [x, y, z] as const,
      heightScale,
      trunkCollider: getSingleTreeTrunkCollider(heightScale),
    });
  }

  return placements;
}
