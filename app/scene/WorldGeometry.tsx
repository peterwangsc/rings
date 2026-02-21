"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
} from "react";
import * as THREE from "three";
import {
  GRASS_ACCENT_TEXTURE_PATH,
  GRASS_LEAF_TEXTURE_PATH,
  SIMPLEX_NOISE_TEXTURE_PATH,
} from "../assets/gameAssets";
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

const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;

export function WorldGeometry({
  worldEntityManager,
}: {
  worldEntityManager: WorldEntityManager;
}) {
  const worldVersion = useWorldEntityVersion(worldEntityManager);
  void worldVersion;

  const loadedSimplexTexture = useLoader(
    THREE.TextureLoader,
    SIMPLEX_NOISE_TEXTURE_PATH,
  );
  const loadedGrassLeaf = useLoader(THREE.TextureLoader, GRASS_LEAF_TEXTURE_PATH);
  const loadedGrassAccent = useLoader(THREE.TextureLoader, GRASS_ACCENT_TEXTURE_PATH);

  const rockNoiseTexture = useMemo(() => {
    const texture = loadedSimplexTexture.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = SIMPLEX_NOISE_TEXTURE_ANISOTROPY;
    texture.needsUpdate = true;
    return texture;
  }, [loadedSimplexTexture]);

  // Wind noise uses the same simplex texture at different params
  const windNoiseTexture = useMemo(() => {
    const texture = loadedSimplexTexture.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, [loadedSimplexTexture]);

  const grassLeafTexture = useMemo(() => {
    const texture = loadedGrassLeaf.clone();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }, [loadedGrassLeaf]);

  const grassAccentTexture = useMemo(() => {
    const texture = loadedGrassAccent.clone();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }, [loadedGrassAccent]);

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

  const grassMaterial = useMemo(
    () =>
      createGrassMaterial({
        windNoise: windNoiseTexture,
        grassLeaf: grassLeafTexture,
        grassAccent: grassAccentTexture,
      }),
    [windNoiseTexture, grassLeafTexture, grassAccentTexture],
  );
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
      windNoiseTexture.dispose();
      grassLeafTexture.dispose();
      grassAccentTexture.dispose();
    };
  }, [
    grassAccentTexture,
    grassLeafTexture,
    grassMaterial,
    rockMaterial,
    rockNoiseTexture,
    terrainMaterial,
    windNoiseTexture,
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
