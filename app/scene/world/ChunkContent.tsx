"use client";

import { Cloud, Clouds } from "@react-three/drei";
import {
  CylinderCollider,
  MeshCollider,
  RigidBody,
} from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CHUNK_CLOUD_FADE } from "../../utils/constants";
import { SingleTree } from "../../vegetation/trees/SingleTree";
import { Campfire } from "../Campfire";
import { applyGrassFieldToMesh } from "./grassField";
import {
  type CachedChunkData,
  computeAndCacheChunkData,
  getChunkData,
} from "./chunkDataCache";
import { TerrainChunk } from "./terrainChunks";

const TREE_LOCAL_ORIGIN = [0, 0, 0] as const;

export function ChunkContent({
  chunkX,
  chunkZ,
  terrainMaterial,
  rockMaterial,
  grassMaterial,
  cloudMaterial,
}: {
  chunkX: number;
  chunkZ: number;
  terrainMaterial: THREE.MeshStandardMaterial;
  rockMaterial: THREE.MeshStandardMaterial;
  grassMaterial: THREE.MeshStandardMaterial;
  cloudMaterial: typeof THREE.MeshBasicMaterial;
}) {
  const grassRef =
    useRef<THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(null);

  // Check cache synchronously — if hit, render decorations immediately
  const cachedOnMount = getChunkData(chunkX, chunkZ);
  const [decorations, setDecorations] = useState<CachedChunkData | null>(
    cachedOnMount,
  );

  // If cache miss, defer decoration computation by 1 frame
  useEffect(() => {
    if (decorations) return;
    const id = requestAnimationFrame(() => {
      setDecorations(computeAndCacheChunkData(chunkX, chunkZ));
    });
    return () => cancelAnimationFrame(id);
  }, [chunkX, chunkZ, decorations]);

  // Apply grass instance matrices when decorations become available
  useEffect(() => {
    const grassMesh = grassRef.current;
    if (!grassMesh || !decorations) return;
    applyGrassFieldToMesh(grassMesh, decorations.grassField);
  }, [decorations]);

  return (
    <>
      <TerrainChunk
        chunkX={chunkX}
        chunkZ={chunkZ}
        terrainMaterial={terrainMaterial}
      />

      {decorations && (
        <>
          {decorations.grassField.bladeCount > 0 && (
            <instancedMesh
              ref={grassRef}
              args={[
                decorations.grassField.bladeGeometry,
                grassMaterial,
                decorations.grassField.bladeCount,
              ]}
              frustumCulled={false}
            />
          )}

          {decorations.trees.map((tree) => (
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
              <SingleTree
                position={TREE_LOCAL_ORIGIN}
                heightScale={tree.heightScale}
              />
            </RigidBody>
          ))}

          {decorations.rocks.map((rock, index) => (
            <RigidBody
              key={`chunk-rock-${chunkX}-${chunkZ}-${index}`}
              type="fixed"
              colliders={false}
              position={[
                rock.position[0],
                rock.position[1] + rock.terrainY,
                rock.position[2],
              ]}
            >
              <MeshCollider type="hull">
                <mesh
                  castShadow
                  receiveShadow
                  scale={rock.scale}
                  material={rockMaterial}
                  geometry={decorations.rockGeometries[index]}
                />
              </MeshCollider>
            </RigidBody>
          ))}

          {decorations.clouds.length > 0 && (
            <Clouds material={cloudMaterial} frustumCulled={false} renderOrder={0}>
              {decorations.clouds.map((cloud, index) => (
                <Cloud
                  key={`chunk-cloud-${chunkX}-${chunkZ}-${index}`}
                  position={cloud.position}
                  seed={cloud.seed}
                  segments={cloud.segments}
                  bounds={cloud.bounds}
                  opacity={cloud.opacity}
                  speed={cloud.speed}
                  fade={CHUNK_CLOUD_FADE}
                />
              ))}
            </Clouds>
          )}

          {decorations.campfirePlacement && (
            <Campfire position={decorations.campfirePlacement} />
          )}
        </>
      )}
    </>
  );
}
