import * as THREE from "three";
import type { TreeSystemConfig } from "../types";

export type TreeMaterialSet = {
  branchMaterials: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  canopyMaterials: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  dispose: () => void;
};

export function createTreeMaterials(config: TreeSystemConfig): TreeMaterialSet {
  const fallbackTrunk = config.species[0]?.trunkColor ?? "#5E4432";
  const fallbackCanopy = config.species[0]?.canopyColor ?? "#4E9A4B";

  const branchMaterials = [0, 1, 2].map((lod) => {
    return new THREE.MeshStandardMaterial({
      color: fallbackTrunk,
      roughness: THREE.MathUtils.lerp(0.98, 1, lod / 2),
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    });
  }) as TreeMaterialSet["branchMaterials"];

  const canopyMaterials = [0, 1, 2].map((lod) => {
    return new THREE.MeshStandardMaterial({
      color: fallbackCanopy,
      roughness: THREE.MathUtils.lerp(0.9, 0.96, lod / 2),
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    });
  }) as TreeMaterialSet["canopyMaterials"];

  return {
    branchMaterials,
    canopyMaterials,
    dispose: () => {
      for (const material of branchMaterials) {
        material.dispose();
      }
      for (const material of canopyMaterials) {
        material.dispose();
      }
    },
  };
}
