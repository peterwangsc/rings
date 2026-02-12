import { useFrame, useLoader } from "@react-three/fiber";
import {
  CuboidCollider,
  CylinderCollider,
  MeshCollider,
  RigidBody,
} from "@react-three/rapier";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  PLAYER_START_POSITION,
  ROCK_FORMATIONS,
  ROCK_MATERIAL_COLOR,
} from "../utils/constants";
import { createProceduralRockGeometry } from "../utils/rockGeometry";
import { createRockMaterial } from "../utils/shaders";
import { SingleTree } from "../vegetation/trees/SingleTree";
import { Campfire } from "./Campfire";
import {
  applyGrassFieldToMesh,
  createGrassField,
  createGrassMaterial,
  updateGrassMaterialTime,
} from "./world/grassField";
import {
  createCampfirePlacement,
  createRockPlacements,
  createSingleTreePlacements,
} from "./world/placements";
import {
  getActiveTerrainChunks,
  getChunkCoordinate,
  TerrainChunk,
} from "./world/terrainChunks";
import type { TerrainChunkCoord } from "./world/worldTypes";

const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;
const ROCK_COLLIDER_MODE = "hull" as const;
const TREE_LOCAL_ORIGIN = [0, 0, 0] as const;

export function WorldGeometry({
  playerPositionRef,
}: {
  playerPositionRef: MutableRefObject<THREE.Vector3>;
}) {
  const grassRef =
    useRef<THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(
      null,
    );
  const [centerChunk, setCenterChunk] = useState<TerrainChunkCoord>(() => ({
    x: getChunkCoordinate(PLAYER_START_POSITION.x),
    z: getChunkCoordinate(PLAYER_START_POSITION.z),
  }));
  const activeCenterChunkRef = useRef(centerChunk);

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
  const rockGeometries = useMemo(
    () => ROCK_FORMATIONS.map((_, index) => createProceduralRockGeometry(index)),
    [],
  );
  const rockPlacements = useMemo(
    () => createRockPlacements(rockGeometries),
    [rockGeometries],
  );
  const campfirePlacement = useMemo(() => createCampfirePlacement(), []);
  const singleTreePlacements = useMemo(
    () => createSingleTreePlacements(rockPlacements),
    [rockPlacements],
  );

  const grassField = useMemo(
    () => createGrassField(rockPlacements),
    [rockPlacements],
  );
  const grassMaterial = useMemo(() => createGrassMaterial(), []);

  const activeTerrainChunks = useMemo(
    () => getActiveTerrainChunks(centerChunk),
    [centerChunk],
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
    }

    const grassMesh = grassRef.current;
    if (!grassMesh || Array.isArray(grassMesh.material)) {
      return;
    }
    updateGrassMaterialTime(grassMesh.material, state.clock.getElapsedTime());
  });

  useEffect(() => {
    const grassMesh = grassRef.current;
    if (!grassMesh) {
      return;
    }
    applyGrassFieldToMesh(grassMesh, grassField);
  }, [grassField]);

  useEffect(() => {
    return () => {
      terrainMaterial.dispose();
      rockMaterial.dispose();
      grassMaterial.dispose();
      grassField.bladeGeometry.dispose();
      rockNoiseTexture.dispose();
      rockGeometries.forEach((geometry) => geometry.dispose());
    };
  }, [
    grassField.bladeGeometry,
    grassMaterial,
    rockGeometries,
    rockMaterial,
    rockNoiseTexture,
    terrainMaterial,
  ]);

  return (
    <>
      {activeTerrainChunks.map((chunk) => (
        <TerrainChunk
          key={`terrain-chunk-${chunk.x}-${chunk.z}`}
          chunkX={chunk.x}
          chunkZ={chunk.z}
          terrainMaterial={terrainMaterial}
        />
      ))}

      <instancedMesh
        ref={grassRef}
        args={[grassField.bladeGeometry, grassMaterial, grassField.bladeCount]}
        frustumCulled={false}
      />

      {singleTreePlacements.map((tree) => (
        <RigidBody
          key={tree.id}
          type="fixed"
          colliders={false}
          position={tree.position}
        >
          <CylinderCollider
            args={[tree.trunkCollider.halfHeight, tree.trunkCollider.radius]}
            position={[0, tree.trunkCollider.centerY, 0]}
          />
          <SingleTree position={TREE_LOCAL_ORIGIN} heightScale={tree.heightScale} />
        </RigidBody>
      ))}

      <Campfire position={campfirePlacement} />

      {rockPlacements.map((rock, index) => (
        <RigidBody
          key={`rock-${index}`}
          type="fixed"
          colliders={false}
          position={[rock.position[0], rock.position[1] + rock.terrainY, rock.position[2]]}
        >
          {ROCK_COLLIDER_MODE === "hull" ? (
            <MeshCollider type="hull">
              <mesh
                castShadow
                receiveShadow
                scale={rock.scale}
                material={rockMaterial}
                geometry={rockGeometries[index]}
              />
            </MeshCollider>
          ) : (
            <>
              <CuboidCollider
                args={[
                  rock.colliderHalfExtents[0],
                  rock.colliderHalfExtents[1],
                  rock.colliderHalfExtents[2],
                ]}
                position={[
                  rock.colliderOffset[0],
                  rock.colliderOffset[1],
                  rock.colliderOffset[2],
                ]}
              />
              <mesh
                castShadow
                receiveShadow
                scale={rock.scale}
                material={rockMaterial}
                geometry={rockGeometries[index]}
              />
            </>
          )}
        </RigidBody>
      ))}
    </>
  );
}
