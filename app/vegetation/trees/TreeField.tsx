import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { generateTreePlacements } from "./generation/poissonPlacement";
import { buildTreeArchetypes } from "./meshing/buildArchetypes";
import { TREE_SYSTEM_CONFIG } from "./treeConfig";
import type { TreeFieldProps } from "./types";
import { createTreeBatches } from "./rendering/createTreeBatches";
import {
  createTreeLodRuntimeState,
  updateTreeLods,
  type TreeLodRuntimeState,
} from "./rendering/lodController";
import {
  createTreeMaterials,
  updateTreeMaterialWindTime,
} from "./rendering/treeMaterials";

export function TreeField({ terrainSampler, rockFormations, camera }: TreeFieldProps) {
  const { camera: defaultCamera } = useThree();

  const config = TREE_SYSTEM_CONFIG;

  const archetypes = useMemo(() => buildTreeArchetypes(config, config.seed), [config]);

  const placements = useMemo(
    () => generateTreePlacements(config, terrainSampler, rockFormations),
    [config, terrainSampler, rockFormations],
  );

  const materials = useMemo(() => createTreeMaterials(config), [config]);

  const batches = useMemo(
    () => createTreeBatches(archetypes, placements, config, materials),
    [archetypes, placements, config, materials],
  );

  const lodStateRef = useRef<TreeLodRuntimeState>(createTreeLodRuntimeState(placements.length));

  useEffect(() => {
    lodStateRef.current = createTreeLodRuntimeState(placements.length);
    const activeCamera = camera ?? defaultCamera;
    updateTreeLods({
      state: lodStateRef.current,
      deltaSeconds: 1,
      cameraPosition: activeCamera.position,
      placements,
      branchBatches: batches.branchBatches,
      canopyBatches: batches.canopyBatches,
      branchInstanceIds: batches.branchInstanceIds,
      canopyInstanceIds: batches.canopyInstanceIds,
      config,
      force: true,
    });
  }, [
    batches,
    camera,
    config,
    defaultCamera,
    placements,
  ]);

  useFrame((state, deltaSeconds) => {
    const activeCamera = camera ?? state.camera;
    updateTreeMaterialWindTime(materials, state.clock.getElapsedTime());
    updateTreeLods({
      state: lodStateRef.current,
      deltaSeconds,
      cameraPosition: activeCamera.position,
      placements,
      branchBatches: batches.branchBatches,
      canopyBatches: batches.canopyBatches,
      branchInstanceIds: batches.branchInstanceIds,
      canopyInstanceIds: batches.canopyInstanceIds,
      config,
    });
  });

  useEffect(() => {
    return () => {
      materials.dispose();
      for (const archetype of archetypes) {
        for (const lod of archetype.lods) {
          lod.branchGeometry.dispose();
          lod.canopyGeometry.dispose();
        }
      }
    };
  }, [archetypes, materials]);

  return (
    <group>
      {batches.branchBatches.map((batch, index) => (
        <primitive key={`tree-branch-lod-${index}`} object={batch} />
      ))}
      {batches.canopyBatches.map((batch, index) => (
        <primitive key={`tree-canopy-lod-${index}`} object={batch} />
      ))}
    </group>
  );
}
