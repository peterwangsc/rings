"use client";

import { useFrame, useLoader } from "@react-three/fiber";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import {
  PLAYER_START_POSITION,
  ROCK_MATERIAL_COLOR,
} from "../utils/constants";
import { createRockMaterial } from "../utils/shaders";
import {
  createGrassMaterial,
  updateGrassMaterialTime,
} from "./world/grassField";
import {
  ACTIVE_TERRAIN_CHUNK_RADIUS,
  getActiveTerrainChunks,
  getChunkCoordinate,
} from "./world/terrainChunks";
import { ChunkContent } from "./world/ChunkContent";
import {
  computeAndCacheChunkData,
  isChunkCached,
  prefetchChunk,
} from "./world/chunkDataCache";
import type { TerrainChunkCoord } from "./world/worldTypes";

const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;
const PREFETCH_RADIUS = ACTIVE_TERRAIN_CHUNK_RADIUS + 1;

export function WorldGeometry({
  playerPositionRef,
}: {
  playerPositionRef: MutableRefObject<THREE.Vector3>;
}) {
  const [centerChunk, setCenterChunk] = useState<TerrainChunkCoord>(() => ({
    x: getChunkCoordinate(PLAYER_START_POSITION.x),
    z: getChunkCoordinate(PLAYER_START_POSITION.z),
  }));
  const activeCenterChunkRef = useRef(centerChunk);
  const prefetchIdRef = useRef<number | null>(null);

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

  const activeTerrainChunks = useMemo(
    () => getActiveTerrainChunks(centerChunk),
    [centerChunk],
  );

  // Pre-warm chunk data for initial active chunks so decorations render on first frame
  useMemo(() => {
    activeTerrainChunks.forEach((chunk) => {
      computeAndCacheChunkData(chunk.x, chunk.z);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Collect chunks in the prefetch ring (one beyond active) that aren't cached yet
  const getPrefetchTargets = useCallback(
    (center: TerrainChunkCoord) => {
      const targets: TerrainChunkCoord[] = [];
      for (let dz = -PREFETCH_RADIUS; dz <= PREFETCH_RADIUS; dz++) {
        for (let dx = -PREFETCH_RADIUS; dx <= PREFETCH_RADIUS; dx++) {
          // Skip chunks that are already in the active set
          if (
            Math.abs(dx) <= ACTIVE_TERRAIN_CHUNK_RADIUS &&
            Math.abs(dz) <= ACTIVE_TERRAIN_CHUNK_RADIUS
          ) {
            continue;
          }
          const cx = center.x + dx;
          const cz = center.z + dz;
          if (!isChunkCached(cx, cz)) {
            targets.push({ x: cx, z: cz });
          }
        }
      }
      return targets;
    },
    [],
  );

  // Schedule prefetch work using requestIdleCallback (one chunk per callback)
  const schedulePrefetch = useCallback(
    (center: TerrainChunkCoord) => {
      // Cancel any pending prefetch
      if (prefetchIdRef.current !== null) {
        cancelIdleCallback(prefetchIdRef.current);
        prefetchIdRef.current = null;
      }

      const targets = getPrefetchTargets(center);
      let index = 0;

      function prefetchNext(deadline: IdleDeadline) {
        // Process one chunk per idle callback to avoid blocking
        while (index < targets.length && deadline.timeRemaining() > 5) {
          const target = targets[index];
          prefetchChunk(target.x, target.z);
          index++;
        }
        if (index < targets.length) {
          prefetchIdRef.current = requestIdleCallback(prefetchNext);
        } else {
          prefetchIdRef.current = null;
        }
      }

      if (targets.length > 0) {
        prefetchIdRef.current = requestIdleCallback(prefetchNext);
      }
    },
    [getPrefetchTargets],
  );

  useFrame((state) => {
    const playerPosition = playerPositionRef.current;
    const nextChunkX = getChunkCoordinate(playerPosition.x);
    const nextChunkZ = getChunkCoordinate(playerPosition.z);
    if (
      nextChunkX !== activeCenterChunkRef.current.x ||
      nextChunkZ !== activeCenterChunkRef.current.z
    ) {
      const nextCenterChunk = { x: nextChunkX, z: nextChunkZ };
      activeCenterChunkRef.current = nextCenterChunk;
      setCenterChunk(nextCenterChunk);
      schedulePrefetch(nextCenterChunk);
    }

    updateGrassMaterialTime(grassMaterial, state.clock.getElapsedTime());
  });

  // Initial prefetch on mount
  useEffect(() => {
    schedulePrefetch(activeCenterChunkRef.current);
    return () => {
      if (prefetchIdRef.current !== null) {
        cancelIdleCallback(prefetchIdRef.current);
      }
    };
  }, [schedulePrefetch]);

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
      {activeTerrainChunks.map((chunk) => (
        <ChunkContent
          key={`chunk-${chunk.x}-${chunk.z}`}
          chunkX={chunk.x}
          chunkZ={chunk.z}
          terrainMaterial={terrainMaterial}
          rockMaterial={rockMaterial}
          grassMaterial={grassMaterial}
          cloudMaterial={cloudMaterial}
        />
      ))}
    </>
  );
}
