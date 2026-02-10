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

  const branchMaterials: TreeMaterialSet["branchMaterials"] = [
    new THREE.MeshStandardMaterial({
      color: fallbackTrunk,
      roughness: 0.98,
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    }),
    new THREE.MeshStandardMaterial({
      color: fallbackTrunk,
      roughness: 0.99,
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    }),
    new THREE.MeshStandardMaterial({
      color: fallbackTrunk,
      roughness: 1,
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    }),
  ];

  const canopyMaterials: TreeMaterialSet["canopyMaterials"] = [
    new THREE.MeshStandardMaterial({
      color: fallbackCanopy,
      roughness: 0.9,
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    }),
    new THREE.MeshStandardMaterial({
      color: fallbackCanopy,
      roughness: 0.93,
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    }),
    new THREE.MeshStandardMaterial({
      color: fallbackCanopy,
      roughness: 0.96,
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
    }),
  ];

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
