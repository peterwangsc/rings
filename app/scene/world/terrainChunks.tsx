"use client";

import { MeshCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  GROUND_HALF_EXTENT,
  GROUND_MESH_SEGMENTS,
  TERRAIN_COLOR_DRY,
  TERRAIN_COLOR_HIGHLAND,
  TERRAIN_COLOR_MEADOW,
  TERRAIN_COLOR_RIDGE,
  TERRAIN_COLOR_VALLEY,
  TERRAIN_COLOR_WILDFLOWER,
  TERRAIN_HEIGHT_AMPLITUDE,
} from "../../utils/constants";
import {
  sampleTerrainHeight,
  sampleTerrainSlope,
  smoothstep,
  valueNoise2D,
} from "../../utils/terrain";
import type { TerrainChunkCoord } from "./worldTypes";

export const TERRAIN_CHUNK_SIZE = GROUND_HALF_EXTENT * 2;
export const ACTIVE_TERRAIN_CHUNK_RADIUS = 1;

export function getChunkCoordinate(value: number) {
  return Math.floor((value + GROUND_HALF_EXTENT) / TERRAIN_CHUNK_SIZE);
}

function getChunkCenterWorld(chunkCoordinate: number) {
  return chunkCoordinate * TERRAIN_CHUNK_SIZE;
}

function createTerrainGeometry(chunkX: number, chunkZ: number) {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_CHUNK_SIZE,
    TERRAIN_CHUNK_SIZE,
    GROUND_MESH_SEGMENTS,
    GROUND_MESH_SEGMENTS,
  );
  geometry.rotateX(-Math.PI * 0.5);

  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const chunkCenterX = getChunkCenterWorld(chunkX);
  const chunkCenterZ = getChunkCenterWorld(chunkZ);

  const valleyColor = new THREE.Color(TERRAIN_COLOR_VALLEY);
  const meadowColor = new THREE.Color(TERRAIN_COLOR_MEADOW);
  const highlandColor = new THREE.Color(TERRAIN_COLOR_HIGHLAND);
  const ridgeColor = new THREE.Color(TERRAIN_COLOR_RIDGE);
  const dryColor = new THREE.Color(TERRAIN_COLOR_DRY);
  const wildflowerColor = new THREE.Color(TERRAIN_COLOR_WILDFLOWER);
  const workingColor = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const localX = positions.getX(i);
    const localZ = positions.getZ(i);
    const worldX = chunkCenterX + localX;
    const worldZ = chunkCenterZ + localZ;
    const y = sampleTerrainHeight(worldX, worldZ);
    positions.setY(i, y);

    const broadNoise = valueNoise2D((worldX - 13.5) * 0.08, (worldZ + 7.4) * 0.08);
    const detailNoise = valueNoise2D((worldX + 21.2) * 0.16, (worldZ - 5.6) * 0.16);
    const moistureNoise = valueNoise2D((worldX - 44.1) * 0.06, (worldZ + 15.4) * 0.06);
    const flowerNoise = valueNoise2D((worldX + 7.5) * 0.24, (worldZ - 31.2) * 0.24);
    const slope = sampleTerrainSlope(worldX, worldZ);
    const steepMask = smoothstep(0.52, 1.34, slope);

    const heightFactor = THREE.MathUtils.clamp(
      y / (TERRAIN_HEIGHT_AMPLITUDE * 1.2) + 0.5,
      0,
      1,
    );
    const valleyMask = 1 - smoothstep(0.28, 0.56, heightFactor);
    const highlandMask = smoothstep(0.56, 0.9, heightFactor);
    const dryMask = THREE.MathUtils.clamp((1 - moistureNoise) * 0.65 + highlandMask * 0.35, 0, 1);
    const ridgeMask = THREE.MathUtils.clamp(steepMask * 0.78 + (1 - broadNoise) * 0.22, 0, 1);
    const flowerMask =
      smoothstep(0.83, 0.98, flowerNoise) *
      (1 - steepMask) *
      THREE.MathUtils.clamp(1 - valleyMask * 0.85, 0, 1);

    const meadowBlend = THREE.MathUtils.clamp(
      (1 - valleyMask * 0.55) * (0.72 + broadNoise * 0.28),
      0,
      1,
    );

    workingColor.copy(valleyColor);
    workingColor.lerp(meadowColor, meadowBlend);
    workingColor.lerp(highlandColor, highlandMask * 0.68);
    workingColor.lerp(ridgeColor, ridgeMask * 0.52);
    workingColor.lerp(dryColor, dryMask * 0.3);
    workingColor.lerp(wildflowerColor, flowerMask * 0.26);
    workingColor.offsetHSL((detailNoise - 0.5) * 0.02, 0, (detailNoise - 0.5) * 0.03);
    colors[i * 3] = workingColor.r;
    colors[i * 3 + 1] = workingColor.g;
    colors[i * 3 + 2] = workingColor.b;
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function TerrainChunk({
  chunkX,
  chunkZ,
  terrainMaterial,
}: {
  chunkX: number;
  chunkZ: number;
  terrainMaterial: THREE.MeshStandardMaterial;
}) {
  const terrainGeometry = useMemo(
    () => createTerrainGeometry(chunkX, chunkZ),
    [chunkX, chunkZ],
  );
  const chunkPosition = useMemo(
    () => [getChunkCenterWorld(chunkX), 0, getChunkCenterWorld(chunkZ)] as const,
    [chunkX, chunkZ],
  );

  useEffect(() => {
    return () => {
      terrainGeometry.dispose();
    };
  }, [terrainGeometry]);

  return (
    <RigidBody type="fixed" colliders={false} position={chunkPosition}>
      <MeshCollider type="trimesh">
        <mesh geometry={terrainGeometry} material={terrainMaterial} receiveShadow />
      </MeshCollider>
    </RigidBody>
  );
}

export function getActiveTerrainChunks(centerChunk: TerrainChunkCoord) {
  const chunks: TerrainChunkCoord[] = [];
  for (
    let zOffset = -ACTIVE_TERRAIN_CHUNK_RADIUS;
    zOffset <= ACTIVE_TERRAIN_CHUNK_RADIUS;
    zOffset += 1
  ) {
    for (
      let xOffset = -ACTIVE_TERRAIN_CHUNK_RADIUS;
      xOffset <= ACTIVE_TERRAIN_CHUNK_RADIUS;
      xOffset += 1
    ) {
      chunks.push({
        x: centerChunk.x + xOffset,
        z: centerChunk.z + zOffset,
      });
    }
  }
  return chunks;
}
