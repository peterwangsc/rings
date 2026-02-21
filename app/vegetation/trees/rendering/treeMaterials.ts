import * as THREE from "three";
import type { TreeSystemConfig } from "../types";

type TreeWindUniforms = {
  uTreeWindTime: { value: number };
  uTreeWindAmp: { value: number };
  uTreeWindFreq: { value: number };
  uTreeWindSpeed: { value: number };
};

type WindAwareCanopyMaterial = THREE.MeshStandardMaterial & {
  userData: {
    treeWindUniforms?: TreeWindUniforms;
  };
};

const CANOPY_WIND_AMPLITUDE = [0.055, 0.04, 0.028] as const;
const CANOPY_WIND_FREQUENCY = [0.85, 0.72, 0.62] as const;
const CANOPY_WIND_SPEED = 0.9;

export type TreeMaterialSet = {
  branchMaterials: readonly [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  canopyMaterials: readonly [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  dispose: () => void;
};

function applyCanopyWindPatch(material: THREE.MeshStandardMaterial, lodLevel: 0 | 1 | 2) {
  const amplitude = CANOPY_WIND_AMPLITUDE[lodLevel];
  const frequency = CANOPY_WIND_FREQUENCY[lodLevel];
  const speed = CANOPY_WIND_SPEED;

  material.onBeforeCompile = (shader) => {
    const windUniforms: TreeWindUniforms = {
      uTreeWindTime: { value: 0 },
      uTreeWindAmp: { value: amplitude },
      uTreeWindFreq: { value: frequency },
      uTreeWindSpeed: { value: speed },
    };

    shader.uniforms.uTreeWindTime = windUniforms.uTreeWindTime;
    shader.uniforms.uTreeWindAmp = windUniforms.uTreeWindAmp;
    shader.uniforms.uTreeWindFreq = windUniforms.uTreeWindFreq;
    shader.uniforms.uTreeWindSpeed = windUniforms.uTreeWindSpeed;
    (material as WindAwareCanopyMaterial).userData.treeWindUniforms = windUniforms;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `
#include <common>
uniform float uTreeWindTime;
uniform float uTreeWindAmp;
uniform float uTreeWindFreq;
uniform float uTreeWindSpeed;
`,
      )
      .replace(
        "#include <begin_vertex>",
        `
#include <begin_vertex>
vec4 treeWorldPosition = modelMatrix * vec4(transformed, 1.0);
float treeWindHeight = smoothstep(-0.25, 1.35, position.y);
float treeWindPhase =
  (treeWorldPosition.x * 0.075 + treeWorldPosition.z * 0.063) * uTreeWindFreq +
  uTreeWindTime * uTreeWindSpeed;
transformed.x += sin(treeWindPhase) * uTreeWindAmp * treeWindHeight;
transformed.z += cos(treeWindPhase * 0.83) * uTreeWindAmp * 0.55 * treeWindHeight;
`,
      );
  };

  material.customProgramCacheKey = () => `tree-canopy-wind-${lodLevel}-${amplitude}-${frequency}-${speed}`;
  material.needsUpdate = true;
}

export function updateTreeMaterialWindTime(materials: TreeMaterialSet, timeSeconds: number) {
  for (const material of materials.canopyMaterials) {
    const windUniforms = (material as WindAwareCanopyMaterial).userData.treeWindUniforms;
    if (!windUniforms) {
      continue;
    }
    windUniforms.uTreeWindTime.value = timeSeconds;
  }
}

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
    const material = new THREE.MeshStandardMaterial({
      color: fallbackCanopy,
      roughness: THREE.MathUtils.lerp(0.9, 0.96, lod / 2),
      metalness: 0.01,
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
      alphaToCoverage: true,
      forceSinglePass: true,
      dithering: true,
    });
    applyCanopyWindPatch(material, lod as 0 | 1 | 2);
    return material;
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
