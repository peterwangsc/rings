import * as THREE from "three";
import type {
  RockFormationLike,
  TerrainSampler,
  TreePlacement,
  TreeSpeciesPreset,
  TreeSystemConfig,
} from "../types";

const TAU = Math.PI * 2;

function createRng(seed: number) {
  let state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fract(value: number) {
  return value - Math.floor(value);
}

function hash2D(x: number, z: number) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function valueNoise2D(x: number, z: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const n00 = hash2D(x0, z0);
  const n10 = hash2D(x0 + 1, z0);
  const n01 = hash2D(x0, z0 + 1);
  const n11 = hash2D(x0 + 1, z0 + 1);

  const nx0 = THREE.MathUtils.lerp(n00, n10, u);
  const nx1 = THREE.MathUtils.lerp(n01, n11, u);
  return THREE.MathUtils.lerp(nx0, nx1, v);
}

function isNearRock(
  x: number,
  z: number,
  clearance: number,
  rockFormations: readonly RockFormationLike[],
) {
  return rockFormations.some((rock) => {
    const dx = x - rock.position[0];
    const dz = z - rock.position[2];
    const clearX = rock.collider[0] + clearance;
    const clearZ = rock.collider[2] + clearance;
    if (Math.abs(dx) < clearX && Math.abs(dz) < clearZ) {
      return true;
    }
    const radialClear = Math.max(clearX, clearZ);
    return dx * dx + dz * dz < radialClear * radialClear;
  });
}

function sampleWeightedSpecies(
  rng: () => number,
  species: readonly TreeSpeciesPreset[],
): TreeSpeciesPreset {
  const totalWeight = species.reduce((sum, entry) => sum + entry.placementWeight, 0);
  let target = rng() * Math.max(totalWeight, 1e-6);
  for (const entry of species) {
    target -= entry.placementWeight;
    if (target <= 0) {
      return entry;
    }
  }
  return species[species.length - 1];
}

export function generateTreePlacements(
  config: TreeSystemConfig,
  terrainSampler: TerrainSampler,
  rockFormations: readonly RockFormationLike[],
): TreePlacement[] {
  const rng = createRng(config.seed);
  const placements: TreePlacement[] = [];
  const points: THREE.Vector2[] = [];
  const active: number[] = [];

  const { placement } = config;
  const cellSize = placement.minSpacing / Math.sqrt(2);
  const gridSize = Math.ceil((placement.fieldRadius * 2) / cellSize);
  const grid = new Int32Array(gridSize * gridSize).fill(-1);

  const getGridCoord = (value: number) =>
    Math.floor((value + placement.fieldRadius) / cellSize);
  const inGrid = (gx: number, gz: number) =>
    gx >= 0 && gz >= 0 && gx < gridSize && gz < gridSize;

  const canPlace = (x: number, z: number) => {
    const radialDistance = Math.hypot(x, z);
    if (radialDistance < placement.clearingRadius || radialDistance > placement.fieldRadius) {
      return false;
    }
    if (isNearRock(x, z, placement.rockClearance, rockFormations)) {
      return false;
    }

    const slope = terrainSampler.sampleSlope(x, z);
    if (slope > placement.maxSlope) {
      return false;
    }

    const density = valueNoise2D(
      (x - 16.3) * placement.densityNoiseScale,
      (z + 9.8) * placement.densityNoiseScale,
    );
    const densityThreshold = placement.densityThreshold + rng() * placement.densityJitter;
    if (density < densityThreshold) {
      return false;
    }

    const gx = getGridCoord(x);
    const gz = getGridCoord(z);
    if (!inGrid(gx, gz)) {
      return false;
    }

    const neighborRange = Math.ceil(placement.minSpacing / cellSize);
    for (let dz = -neighborRange; dz <= neighborRange; dz++) {
      for (let dx = -neighborRange; dx <= neighborRange; dx++) {
        const ngX = gx + dx;
        const ngZ = gz + dz;
        if (!inGrid(ngX, ngZ)) {
          continue;
        }
        const pointIndex = grid[ngZ * gridSize + ngX];
        if (pointIndex < 0) {
          continue;
        }
        const point = points[pointIndex];
        const deltaX = point.x - x;
        const deltaZ = point.y - z;
        if (deltaX * deltaX + deltaZ * deltaZ < placement.minSpacing * placement.minSpacing) {
          return false;
        }
      }
    }

    return true;
  };

  const pushPlacement = (x: number, z: number) => {
    const gx = getGridCoord(x);
    const gz = getGridCoord(z);
    if (!inGrid(gx, gz)) {
      return false;
    }

    const point = new THREE.Vector2(x, z);
    const pointIndex = points.length;
    points.push(point);
    active.push(pointIndex);
    grid[gz * gridSize + gx] = pointIndex;

    const species = sampleWeightedSpecies(rng, config.species);
    const variantIndex = Math.floor(rng() * config.variantsPerSpecies);
    const placementSeed = Math.floor(rng() * 1_000_000_000);

    placements.push({
      position: new THREE.Vector3(x, terrainSampler.sampleHeight(x, z), z),
      yaw: rng() * TAU,
      scale: THREE.MathUtils.lerp(0.86, 1.2, rng()),
      speciesId: species.id,
      variantIndex,
      seed: placementSeed,
    });

    return true;
  };

  for (let i = 0; i < placement.maxPlacementAttempts && points.length === 0; i++) {
    const radius = placement.fieldRadius * Math.sqrt(rng());
    const angle = rng() * TAU;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (canPlace(x, z)) {
      pushPlacement(x, z);
      break;
    }
  }

  while (active.length > 0 && placements.length < placement.treeCount) {
    const activeIndex = Math.floor(rng() * active.length);
    const pointIndex = active[activeIndex];
    const center = points[pointIndex];

    let accepted = false;
    for (let sample = 0; sample < placement.poissonAttempts; sample++) {
      const angle = rng() * TAU;
      const distance = placement.minSpacing * (1 + rng());
      const x = center.x + Math.cos(angle) * distance;
      const z = center.y + Math.sin(angle) * distance;
      if (!canPlace(x, z)) {
        continue;
      }
      pushPlacement(x, z);
      accepted = true;
      break;
    }

    if (!accepted) {
      active[activeIndex] = active[active.length - 1];
      active.pop();
    }
  }

  for (
    let attempt = 0;
    attempt < placement.maxPlacementAttempts && placements.length < placement.treeCount;
    attempt++
  ) {
    const radius = placement.fieldRadius * Math.sqrt(rng());
    const angle = rng() * TAU;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!canPlace(x, z)) {
      continue;
    }
    pushPlacement(x, z);
  }

  return placements;
}
