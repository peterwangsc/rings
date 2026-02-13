"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
} from "react";
import * as THREE from "three";
import { ROCK_MATERIAL_COLOR } from "../utils/constants";
import { createRockMaterial } from "../utils/shaders";
import {
  createGrassMaterial,
  updateGrassMaterialTime,
} from "./world/grassField";
import { ChunkContent } from "./world/ChunkContent";
import {
  type WorldEntityManager,
  useWorldEntityVersion,
} from "./world/worldEntityManager";

const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;

export function WorldGeometry({
  worldEntityManager,
}: {
  worldEntityManager: WorldEntityManager;
}) {
  const worldVersion = useWorldEntityVersion(worldEntityManager);
  void worldVersion;

  const loadedRockNoiseTexture = useLoader(
    THREE.TextureLoader,
    SIMPLEX_NOISE_TEXTURE_PATH,
  );
  const rockNoiseTexture = useMemo(() => {
    const texture = loadedRockNoiseTexture.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = SIMPLEX_NOISE_TEXTURE_ANISOTROPY;
    texture.needsUpdate = true;
    return texture;
  }, [loadedRockNoiseTexture]);

  const terrainMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.02,
      }),
    [],
  );

  const { material: rockMaterial } = useMemo(
    () => createRockMaterial(ROCK_MATERIAL_COLOR, rockNoiseTexture),
    [rockNoiseTexture],
  );
  const grassMaterial = useMemo(() => createGrassMaterial(), []);
  const cloudMaterial = THREE.MeshBasicMaterial;

  useFrame((state) => {
    updateGrassMaterialTime(grassMaterial, state.clock.getElapsedTime());
  });

  useEffect(() => {
    return () => {
      terrainMaterial.dispose();
      rockMaterial.dispose();
      grassMaterial.dispose();
      rockNoiseTexture.dispose();
    };
  }, [
    grassMaterial,
    rockMaterial,
    rockNoiseTexture,
    terrainMaterial,
  ]);

  return (
    <>
      {worldEntityManager.activeChunkSlots.map((chunkSlot) => (
        <ChunkContent
          key={`chunk-${chunkSlot.chunkX}-${chunkSlot.chunkZ}`}
          chunkX={chunkSlot.chunkX}
          chunkZ={chunkSlot.chunkZ}
          terrainMaterial={terrainMaterial}
          rockMaterial={rockMaterial}
          grassMaterial={grassMaterial}
          cloudMaterial={cloudMaterial}
        />
      ))}
    </>
  );
}
