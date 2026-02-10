import * as THREE from "three";
import type { TreeLodLevel, TreePlacement, TreeSystemConfig } from "../types";

export type TreeLodRuntimeState = {
  levels: Int8Array;
  elapsed: number;
  initialized: boolean;
};

export type TreeLodUpdateParams = {
  state: TreeLodRuntimeState;
  deltaSeconds: number;
  cameraPosition: THREE.Vector3;
  placements: readonly TreePlacement[];
  branchBatches: readonly [THREE.BatchedMesh, THREE.BatchedMesh, THREE.BatchedMesh];
  canopyBatches: readonly [THREE.BatchedMesh, THREE.BatchedMesh, THREE.BatchedMesh];
  branchInstanceIds: readonly number[][];
  canopyInstanceIds: readonly number[][];
  config: TreeSystemConfig;
  force?: boolean;
};

export function createTreeLodRuntimeState(treeCount: number): TreeLodRuntimeState {
  const levels = new Int8Array(treeCount);
  levels.fill(3);
  return {
    levels,
    elapsed: 0,
    initialized: false,
  };
}

function resolveLod(
  distance: number,
  current: TreeLodLevel,
  lodConfig: TreeSystemConfig["lod"],
): TreeLodLevel {
  const hysteresis = lodConfig.hysteresis;

  if (current === 0) {
    if (distance <= lodConfig.lod0Distance + hysteresis) {
      return 0;
    }
    if (distance <= lodConfig.lod1Distance + hysteresis) {
      return 1;
    }
    if (distance <= lodConfig.lod2Distance + hysteresis) {
      return 2;
    }
    return 3;
  }

  if (current === 1) {
    if (distance < lodConfig.lod0Distance - hysteresis) {
      return 0;
    }
    if (distance <= lodConfig.lod1Distance + hysteresis) {
      return 1;
    }
    if (distance <= lodConfig.lod2Distance + hysteresis) {
      return 2;
    }
    return 3;
  }

  if (current === 2) {
    if (distance < lodConfig.lod1Distance - hysteresis) {
      return 1;
    }
    if (distance <= lodConfig.lod2Distance + hysteresis) {
      return 2;
    }
    if (distance < lodConfig.hiddenDistance + hysteresis) {
      return 2;
    }
    return 3;
  }

  if (distance < lodConfig.lod2Distance - hysteresis) {
    return 2;
  }
  return 3;
}

export function updateTreeLods(params: TreeLodUpdateParams) {
  const updateInterval = 1 / Math.max(params.config.lod.updateHz, 1e-6);
  params.state.elapsed += params.deltaSeconds;

  if (!params.force && params.state.initialized && params.state.elapsed < updateInterval) {
    return;
  }
  params.state.elapsed = 0;

  for (let treeIndex = 0; treeIndex < params.placements.length; treeIndex++) {
    const placement = params.placements[treeIndex];
    const distance = params.cameraPosition.distanceTo(placement.position);
    const currentLevel = params.state.levels[treeIndex] as TreeLodLevel;
    const nextLevel = resolveLod(distance, currentLevel, params.config.lod);

    if (params.state.initialized && nextLevel === currentLevel) {
      continue;
    }

    for (let lodLevel = 0; lodLevel < 3; lodLevel++) {
      const visible = nextLevel === lodLevel;
      const branchInstanceId = params.branchInstanceIds[treeIndex][lodLevel];
      const canopyInstanceId = params.canopyInstanceIds[treeIndex][lodLevel];

      params.branchBatches[lodLevel].setVisibleAt(branchInstanceId, visible);
      params.canopyBatches[lodLevel].setVisibleAt(canopyInstanceId, visible);
    }

    params.state.levels[treeIndex] = nextLevel;
  }

  params.state.initialized = true;
}
