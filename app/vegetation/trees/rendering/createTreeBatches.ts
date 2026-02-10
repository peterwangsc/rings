import * as THREE from "three";
import type { TreeArchetype, TreePlacement, TreeSystemConfig } from "../types";
import type { TreeMaterialSet } from "./treeMaterials";

export type CreatedTreeBatches = {
  branchBatches: readonly [THREE.BatchedMesh, THREE.BatchedMesh, THREE.BatchedMesh];
  canopyBatches: readonly [THREE.BatchedMesh, THREE.BatchedMesh, THREE.BatchedMesh];
  branchInstanceIds: number[][];
  canopyInstanceIds: number[][];
  dispose: () => void;
};

function hash(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453123;
  return value - Math.floor(value);
}

function archetypeKey(speciesId: string, variantIndex: number) {
  return `${speciesId}-${variantIndex}`;
}

function computeGeometryBudget(geometries: readonly THREE.BufferGeometry[]) {
  let vertexCount = 0;
  let indexCount = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    vertexCount += position.count;
    indexCount += geometry.index ? geometry.index.count : position.count;
  }

  return {
    vertexCount: Math.max(vertexCount, 1),
    indexCount: Math.max(indexCount, 1),
  };
}

function createSpeciesMap(config: TreeSystemConfig) {
  const map = new Map(config.species.map((species) => [species.id, species]));
  return map;
}

type BuildSingleBatchParams = {
  lodLevel: 0 | 1 | 2;
  part: "branch" | "canopy";
  archetypes: readonly TreeArchetype[];
  placements: readonly TreePlacement[];
  material: THREE.Material;
  config: TreeSystemConfig;
};

function buildSingleBatch(params: BuildSingleBatchParams) {
  const speciesMap = createSpeciesMap(params.config);
  const archetypeIndexByKey = new Map(
    params.archetypes.map((archetype, index) => [archetype.id, index]),
  );

  const geometries = params.archetypes.map((archetype) =>
    params.part === "branch"
      ? archetype.lods[params.lodLevel].branchGeometry
      : archetype.lods[params.lodLevel].canopyGeometry,
  );

  const budget = computeGeometryBudget(geometries);
  const batch = new THREE.BatchedMesh(
    params.placements.length,
    budget.vertexCount,
    budget.indexCount,
    params.material,
  );

  batch.castShadow = true;
  batch.receiveShadow = true;
  batch.frustumCulled = true;
  batch.perObjectFrustumCulled = true;

  const geometryIds = geometries.map((geometry) => batch.addGeometry(geometry));
  const instanceIds = new Array<number>(params.placements.length);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (let placementIndex = 0; placementIndex < params.placements.length; placementIndex++) {
    const placement = params.placements[placementIndex];
    const key = archetypeKey(placement.speciesId, placement.variantIndex);
    const archetypeIndex = archetypeIndexByKey.get(key);
    if (archetypeIndex === undefined) {
      throw new Error(`Missing tree archetype for placement key: ${key}`);
    }

    const geometryId = geometryIds[archetypeIndex];
    const instanceId = batch.addInstance(geometryId);

    quaternion.setFromAxisAngle(up, placement.yaw);
    scale.setScalar(placement.scale);
    matrix.compose(placement.position, quaternion, scale);
    batch.setMatrixAt(instanceId, matrix);
    batch.setVisibleAt(instanceId, false);

    const species = speciesMap.get(placement.speciesId);
    const baseColor = new THREE.Color(
      params.part === "branch"
        ? species?.trunkColor ?? "#5E4432"
        : species?.canopyColor ?? "#4E9A4B",
    );

    if (params.part === "branch") {
      baseColor.offsetHSL(
        0,
        (hash(placement.seed + 15.2) - 0.5) * 0.03,
        (hash(placement.seed + 23.4) - 0.5) * 0.12,
      );
    } else {
      baseColor.offsetHSL(
        (hash(placement.seed + 12.7) - 0.5) * 0.03,
        (hash(placement.seed + 20.1) - 0.5) * 0.08,
        (hash(placement.seed + 31.6) - 0.5) * 0.12,
      );
    }

    batch.setColorAt(instanceId, baseColor);
    instanceIds[placementIndex] = instanceId;
  }

  batch.computeBoundingSphere();
  return { batch, instanceIds };
}

export function createTreeBatches(
  archetypes: readonly TreeArchetype[],
  placements: readonly TreePlacement[],
  config: TreeSystemConfig,
  materials: TreeMaterialSet,
): CreatedTreeBatches {
  const branchRecords: readonly [
    { batch: THREE.BatchedMesh; instanceIds: number[] },
    { batch: THREE.BatchedMesh; instanceIds: number[] },
    { batch: THREE.BatchedMesh; instanceIds: number[] },
  ] = [
    buildSingleBatch({
      lodLevel: 0,
      part: "branch",
      archetypes,
      placements,
      material: materials.branchMaterials[0],
      config,
    }),
    buildSingleBatch({
      lodLevel: 1,
      part: "branch",
      archetypes,
      placements,
      material: materials.branchMaterials[1],
      config,
    }),
    buildSingleBatch({
      lodLevel: 2,
      part: "branch",
      archetypes,
      placements,
      material: materials.branchMaterials[2],
      config,
    }),
  ];

  const canopyRecords: readonly [
    { batch: THREE.BatchedMesh; instanceIds: number[] },
    { batch: THREE.BatchedMesh; instanceIds: number[] },
    { batch: THREE.BatchedMesh; instanceIds: number[] },
  ] = [
    buildSingleBatch({
      lodLevel: 0,
      part: "canopy",
      archetypes,
      placements,
      material: materials.canopyMaterials[0],
      config,
    }),
    buildSingleBatch({
      lodLevel: 1,
      part: "canopy",
      archetypes,
      placements,
      material: materials.canopyMaterials[1],
      config,
    }),
    buildSingleBatch({
      lodLevel: 2,
      part: "canopy",
      archetypes,
      placements,
      material: materials.canopyMaterials[2],
      config,
    }),
  ];

  const branchBatches: CreatedTreeBatches["branchBatches"] = [
    branchRecords[0].batch,
    branchRecords[1].batch,
    branchRecords[2].batch,
  ];
  const canopyBatches: CreatedTreeBatches["canopyBatches"] = [
    canopyRecords[0].batch,
    canopyRecords[1].batch,
    canopyRecords[2].batch,
  ];

  const branchInstanceIds = placements.map((_, treeIndex) =>
    branchRecords.map((record) => record.instanceIds[treeIndex]),
  );
  const canopyInstanceIds = placements.map((_, treeIndex) =>
    canopyRecords.map((record) => record.instanceIds[treeIndex]),
  );

  return {
    branchBatches,
    canopyBatches,
    branchInstanceIds,
    canopyInstanceIds,
    dispose: () => {
      for (const batch of branchBatches) {
        batch.dispose();
      }
      for (const batch of canopyBatches) {
        batch.dispose();
      }
    },
  };
}
