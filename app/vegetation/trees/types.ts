import type * as THREE from "three";

export type NumericRange = readonly [number, number];

export type TreeSpeciesShape = "round" | "conical" | "windswept";

export type TreeSpeciesPreset = {
  id: string;
  shape: TreeSpeciesShape;
  placementWeight: number;
  trunkColor: string;
  canopyColor: string;
  trunkHeight: NumericRange;
  canopyHeight: NumericRange;
  canopyRadius: NumericRange;
  canopyPuffRadius: NumericRange;
  attractorCount: readonly [number, number];
  branchSpread: number;
  lean: number;
  windSkew: number;
};

export type TreeSystemConfig = {
  seed: number;
  variantsPerSpecies: number;
  placement: {
    treeCount: number;
    fieldRadius: number;
    clearingRadius: number;
    minSpacing: number;
    maxSlope: number;
    rockClearance: number;
    poissonAttempts: number;
    maxPlacementAttempts: number;
    densityNoiseScale: number;
    densityThreshold: number;
    densityJitter: number;
  };
  growth: {
    stepSize: number;
    killDistance: number;
    influenceRadius: number;
    maxIterations: number;
    trunkLiftBias: number;
    lateralBias: number;
    apicalDominance: number;
  };
  radius: {
    gamma: number;
    twigRadius: number;
    minKeptRadius: number;
  };
  meshing: {
    lodBranchRadialSegments: readonly [number, number, number];
    lodCanopyDetail: readonly [number, number, number];
    lodCanopySampleStride: readonly [number, number, number];
    trunkDepthForLod2: number;
  };
  lod: {
    updateHz: number;
    lod0Distance: number;
    lod1Distance: number;
    lod2Distance: number;
    hiddenDistance: number;
    hysteresis: number;
  };
  species: readonly TreeSpeciesPreset[];
};

export type TerrainSampler = {
  sampleHeight: (x: number, z: number) => number;
  sampleSlope: (x: number, z: number) => number;
};

export type RockFormationLike = {
  position: readonly [number, number, number];
  collider: readonly [number, number, number];
};

export type TreePlacement = {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  speciesId: string;
  variantIndex: number;
  seed: number;
};

export type TreeSkeletonNode = {
  id: number;
  parentId: number | null;
  children: number[];
  position: THREE.Vector3;
  depth: number;
  radius: number;
};

export type TreeSkeleton = {
  nodes: TreeSkeletonNode[];
  rootId: number;
  terminalNodeIds: number[];
};

export type TreeArchetypeLod = {
  branchGeometry: THREE.BufferGeometry;
  canopyGeometry: THREE.BufferGeometry;
};

export type TreeArchetype = {
  id: string;
  speciesId: string;
  variantIndex: number;
  seed: number;
  lods: readonly [TreeArchetypeLod, TreeArchetypeLod, TreeArchetypeLod];
  boundsRadius: number;
};

export type TreeLodLevel = 0 | 1 | 2 | 3;

export type TreeFieldProps = {
  terrainSampler: TerrainSampler;
  rockFormations: readonly RockFormationLike[];
  camera?: THREE.Camera;
};
