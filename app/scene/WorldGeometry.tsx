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
  CAMPFIRE_POSITION,
  GRASS_BLADE_BASE_HEIGHT,
  GRASS_BLADE_BASE_WIDTH,
  GRASS_BLADE_COUNT,
  GRASS_BLADE_HEIGHT_VARIANCE,
  GRASS_BLADE_WIDTH_VARIANCE,
  GRASS_DENSITY_MIN,
  GRASS_DENSITY_NOISE_SCALE,
  GRASS_DISTANCE_FADE_END,
  GRASS_DISTANCE_FADE_START,
  GRASS_FIELD_COLOR,
  GRASS_FIELD_RADIUS,
  GRASS_ROCK_CLEARANCE,
  GRASS_ROOT_DARKEN,
  GRASS_TINT_VARIATION,
  GRASS_TIP_LIGHTEN,
  GRASS_WIND_SPATIAL_FREQUENCY,
  GRASS_WIND_SPEED,
  GRASS_WIND_STRENGTH,
  GROUND_HALF_EXTENT,
  GROUND_MESH_SEGMENTS,
  PLAYER_START_POSITION,
  ROCK_FORMATIONS,
  ROCK_MATERIAL_COLOR,
  TERRAIN_COLOR_DRY,
  TERRAIN_COLOR_HIGHLAND,
  TERRAIN_COLOR_MEADOW,
  TERRAIN_COLOR_RIDGE,
  TERRAIN_COLOR_VALLEY,
  TERRAIN_COLOR_WILDFLOWER,
  TERRAIN_EDGE_FALLOFF_END,
  TERRAIN_EDGE_FALLOFF_START,
  TERRAIN_HEIGHT_AMPLITUDE,
} from "../utils/constants";
import {
  getSingleTreeTrunkCollider,
  SingleTree,
} from "../vegetation/trees/SingleTree";
import { createProceduralRockGeometry } from "../utils/rockGeometry";
import { createRockMaterial } from "../utils/shaders";
import {
  hash1D,
  smoothstep,
  valueNoise2D,
  sampleTerrainHeight,
  sampleTerrainSlope,
} from "../utils/terrain";
import { Campfire } from "./Campfire";

const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;
const GRASS_SHADER_CACHE_KEY = "grass-blades-v1";
const TAU = Math.PI * 2;
const GRASS_BASE_Y = 0.03;
const TERRAIN_CHUNK_SIZE = GROUND_HALF_EXTENT * 2;
const ACTIVE_TERRAIN_CHUNK_RADIUS = 1;
const ROCK_COLLIDER_MODE = "hull" as const;
const ROCK_COLLIDER_PADDING = 0.02;
const TREE_LOCAL_ORIGIN = [0, 0, 0] as const;
const LANDSCAPE_TREE_TARGET_COUNT = 54;
const LANDSCAPE_TREE_FIELD_RADIUS = GROUND_HALF_EXTENT - 4;
const LANDSCAPE_TREE_MIN_SPACING = 7.2;
const LANDSCAPE_TREE_CLEARING_RADIUS = 7.5;
const LANDSCAPE_TREE_ROCK_CLEARANCE = 4;
const LANDSCAPE_TREE_GROUND_SINK = 0.35;
const LANDSCAPE_TREE_MAX_ATTEMPTS = LANDSCAPE_TREE_TARGET_COUNT * 120;

type RockPlacement = (typeof ROCK_FORMATIONS)[number] & {
  terrainY: number;
  colliderHalfExtents: readonly [number, number, number];
  colliderOffset: readonly [number, number, number];
};

type GrassShaderUniforms = {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector3>;
  uFadeDistance: THREE.IUniform<THREE.Vector2>;
  uColorRamp: THREE.IUniform<THREE.Vector2>;
};

type TerrainChunkCoord = {
  x: number;
  z: number;
};

function isNearRock(
  x: number,
  z: number,
  clearance: number,
  rockPlacements: readonly RockPlacement[],
) {
  return rockPlacements.some((rock) => {
    const rockCenterX = rock.position[0] + rock.colliderOffset[0];
    const rockCenterZ = rock.position[2] + rock.colliderOffset[2];
    const dx = x - rockCenterX;
    const dz = z - rockCenterZ;
    const clearX = rock.colliderHalfExtents[0] + clearance;
    const clearZ = rock.colliderHalfExtents[2] + clearance;
    if (Math.abs(dx) < clearX && Math.abs(dz) < clearZ) {
      return true;
    }
    const radialClear = Math.max(clearX, clearZ);
    return dx * dx + dz * dz < radialClear * radialClear;
  });
}

function getChunkCoordinate(value: number) {
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

    const radius = Math.hypot(worldX, worldZ);
    const edgeDamp =
      1 - smoothstep(TERRAIN_EDGE_FALLOFF_START, TERRAIN_EDGE_FALLOFF_END, radius);
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
    workingColor.multiplyScalar(0.84 + edgeDamp * 0.16);

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

function TerrainChunk({
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
  const rockPlacements = useMemo<readonly RockPlacement[]>(
    () =>
      ROCK_FORMATIONS.map((rock, index) => {
        const geometry = rockGeometries[index];
        const boundingBox = geometry.boundingBox ?? geometry.computeBoundingBox();
        if (!boundingBox) {
          throw new Error(`Rock geometry ${index} is missing a bounding box.`);
        }

        const scaledMin = boundingBox.min.clone().multiply(
          new THREE.Vector3(rock.scale[0], rock.scale[1], rock.scale[2]),
        );
        const scaledMax = boundingBox.max.clone().multiply(
          new THREE.Vector3(rock.scale[0], rock.scale[1], rock.scale[2]),
        );
        const size = scaledMax.clone().sub(scaledMin);
        const center = scaledMin.clone().add(scaledMax).multiplyScalar(0.5);

        return {
          ...rock,
          terrainY: sampleTerrainHeight(rock.position[0], rock.position[2]),
          colliderHalfExtents: [
            Math.max(size.x * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
            Math.max(size.y * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
            Math.max(size.z * 0.5 + ROCK_COLLIDER_PADDING, 0.01),
          ] as const,
          colliderOffset: [center.x, center.y, center.z] as const,
        };
      }),
    [rockGeometries],
  );
  const campfirePlacement = useMemo(
    () =>
      [
        CAMPFIRE_POSITION[0],
        sampleTerrainHeight(CAMPFIRE_POSITION[0], CAMPFIRE_POSITION[2]) +
          CAMPFIRE_POSITION[1],
        CAMPFIRE_POSITION[2],
      ] as const,
    [],
  );
  const singleTreePlacements = useMemo(() => {
    const placements: Array<{
      id: string;
      position: readonly [number, number, number];
      heightScale: number;
      trunkCollider: ReturnType<typeof getSingleTreeTrunkCollider>;
    }> = [];
    const points: THREE.Vector2[] = [];

    for (
      let attempt = 0;
      attempt < LANDSCAPE_TREE_MAX_ATTEMPTS &&
      placements.length < LANDSCAPE_TREE_TARGET_COUNT;
      attempt++
    ) {
      const radialSample = hash1D(attempt * 11.37 + 2.1);
      const angleSample = hash1D(attempt * 17.89 + 4.6);
      const radius = LANDSCAPE_TREE_FIELD_RADIUS * Math.sqrt(radialSample);
      const angle = angleSample * TAU;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (Math.hypot(x, z) < LANDSCAPE_TREE_CLEARING_RADIUS) {
        continue;
      }
      if (
        Math.hypot(x - CAMPFIRE_POSITION[0], z - CAMPFIRE_POSITION[2]) <
        LANDSCAPE_TREE_CLEARING_RADIUS * 1.05
      ) {
        continue;
      }
      if (isNearRock(x, z, LANDSCAPE_TREE_ROCK_CLEARANCE, rockPlacements)) {
        continue;
      }

      const tooCloseToTree = points.some((point) => {
        const dx = point.x - x;
        const dz = point.y - z;
        return dx * dx + dz * dz < LANDSCAPE_TREE_MIN_SPACING * LANDSCAPE_TREE_MIN_SPACING;
      });
      if (tooCloseToTree) {
        continue;
      }

      points.push(new THREE.Vector2(x, z));
      const y = sampleTerrainHeight(x, z) - LANDSCAPE_TREE_GROUND_SINK;
      const heightScale = THREE.MathUtils.lerp(
        0.78,
        1.42,
        hash1D(attempt * 23.17 + 9.3),
      );

      placements.push({
        id: `single-tree-${placements.length}`,
        position: [x, y, z] as const,
        heightScale,
        trunkCollider: getSingleTreeTrunkCollider(heightScale),
      });
    }

    return placements;
  }, [rockPlacements]);

  const grassField = useMemo(() => {
    const bladeGeometry = new THREE.PlaneGeometry(1, 1, 1, 4);
    bladeGeometry.translate(0, 0.5, 0);

    const bladeMatrices: THREE.Matrix4[] = [];
    const bladeDataRaw = new Float32Array(GRASS_BLADE_COUNT * 4);

    const basePosition = new THREE.Vector3();
    const rotation = new THREE.Euler(0, 0, 0, "YXZ");
    const quaternion = new THREE.Quaternion();
    const bladeScale = new THREE.Vector3();

    const maxAttempts = GRASS_BLADE_COUNT * 26;
    let bladeCount = 0;
    for (let attempt = 0; attempt < maxAttempts && bladeCount < GRASS_BLADE_COUNT; attempt++) {
      const sampleRadius = hash1D(attempt * 17.13 + 1.7);
      const sampleAngle = hash1D(attempt * 19.31 + 8.2);
      const radius = GRASS_FIELD_RADIUS * Math.sqrt(sampleRadius);
      const angle = sampleAngle * TAU;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const slope = sampleTerrainSlope(x, z);
      const slopeMask = 1 - smoothstep(0.45, 1.45, slope);
      if (slopeMask < 0.18) {
        continue;
      }

      const macroDensity = valueNoise2D(
        x * GRASS_DENSITY_NOISE_SCALE,
        z * GRASS_DENSITY_NOISE_SCALE,
      );
      const patchDensity = valueNoise2D(
        (x + 41.7) * GRASS_DENSITY_NOISE_SCALE * 0.58,
        (z - 17.3) * GRASS_DENSITY_NOISE_SCALE * 0.58,
      );
      const density = THREE.MathUtils.clamp((macroDensity * 0.72 + patchDensity * 0.28) * slopeMask, 0, 1);
      const densityThreshold = GRASS_DENSITY_MIN + hash1D(attempt * 7.7 + 3.1) * 0.18;
      if (density < densityThreshold) {
        continue;
      }
      if (isNearRock(x, z, GRASS_ROCK_CLEARANCE, rockPlacements)) {
        continue;
      }

      const widthNoise =
        1 -
        GRASS_BLADE_WIDTH_VARIANCE * 0.5 +
        hash1D(attempt * 5.3 + 4.4) * GRASS_BLADE_WIDTH_VARIANCE;
      const heightNoise =
        1 -
        GRASS_BLADE_HEIGHT_VARIANCE * 0.5 +
        hash1D(attempt * 6.1 + 5.7) * GRASS_BLADE_HEIGHT_VARIANCE;
      const width = GRASS_BLADE_BASE_WIDTH * widthNoise;
      const height = GRASS_BLADE_BASE_HEIGHT * heightNoise * THREE.MathUtils.lerp(0.85, 1.18, density);

      const yaw = hash1D(attempt * 9.1 + 2.2) * TAU;
      const leanX = (hash1D(attempt * 11.7 + 6.6) - 0.5) * 0.1;
      const leanZ = (hash1D(attempt * 12.4 + 7.1) - 0.5) * 0.1;
      rotation.set(leanX, yaw, leanZ);
      quaternion.setFromEuler(rotation);

      basePosition.set(x, sampleTerrainHeight(x, z) + GRASS_BASE_Y, z);
      bladeScale.set(width, height, 1);

      const matrix = new THREE.Matrix4();
      matrix.compose(basePosition, quaternion, bladeScale);
      bladeMatrices.push(matrix);

      const dataIndex = bladeCount * 4;
      bladeDataRaw[dataIndex] = hash1D(attempt * 13.4 + 9.9); // seed
      bladeDataRaw[dataIndex + 1] = density; // density signal
      bladeDataRaw[dataIndex + 2] = hash1D(attempt * 15.2 + 12.8); // wind phase
      bladeDataRaw[dataIndex + 3] = hash1D(attempt * 3.8 + 2.4) * 2 - 1; // tint offset
      bladeCount += 1;
    }

    const bladeData = bladeDataRaw.subarray(0, bladeCount * 4);
    bladeGeometry.setAttribute(
      "aBladeData",
      new THREE.InstancedBufferAttribute(bladeData, 4),
    );

    return {
      bladeGeometry,
      bladeMatrices,
      bladeCount,
    };
  }, [rockPlacements]);

  const { material: grassMaterial } = useMemo(() => {
    const timeUniform: THREE.IUniform<number> = { value: 0 };
    const uniforms: GrassShaderUniforms = {
      uTime: timeUniform,
      uWind: {
        value: new THREE.Vector3(
          GRASS_WIND_STRENGTH,
          GRASS_WIND_SPEED,
          GRASS_WIND_SPATIAL_FREQUENCY,
        ),
      },
      uFadeDistance: {
        value: new THREE.Vector2(
          GRASS_DISTANCE_FADE_START,
          GRASS_DISTANCE_FADE_END,
        ),
      },
      uColorRamp: {
        value: new THREE.Vector2(GRASS_ROOT_DARKEN, GRASS_TIP_LIGHTEN),
      },
    };

    const material = new THREE.MeshStandardMaterial({
      color: GRASS_FIELD_COLOR,
      roughness: 0.96,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uWind = uniforms.uWind;
      shader.uniforms.uFadeDistance = uniforms.uFadeDistance;
      shader.uniforms.uColorRamp = uniforms.uColorRamp;
      material.userData.uTime = uniforms.uTime;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute vec4 aBladeData;
varying vec2 vGrassUv;
varying float vGrassTip;
varying float vGrassSeed;
varying float vGrassTint;
varying vec3 vGrassWorldPosition;
uniform float uTime;
uniform vec3 uWind;
`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vGrassUv = uv;
float tip = clamp(uv.y, 0.0, 1.0);
vGrassTip = tip;
vGrassSeed = aBladeData.x;
vGrassTint = aBladeData.w;

#ifdef USE_INSTANCING
vec3 instanceOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vec3 instanceOrigin = vec3(0.0);
#endif

float windPhase = uTime * uWind.y + dot(instanceOrigin.xz, vec2(uWind.z, uWind.z * 1.19)) + aBladeData.z * 6.28318;
float gust = sin(windPhase) * 0.72 + cos(windPhase * 1.63 + aBladeData.x * 4.0) * 0.28;
float sway = gust * uWind.x * (0.35 + aBladeData.y * 0.65);
float bendMask = tip * tip;
transformed.x += sway * bendMask;
transformed.z += sway * 0.45 * bendMask;

#ifdef USE_INSTANCING
vec4 grassWorldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 grassWorldPosition = modelMatrix * vec4(transformed, 1.0);
#endif
vGrassWorldPosition = grassWorldPosition.xyz;
`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec2 uFadeDistance;
uniform vec2 uColorRamp;
varying vec2 vGrassUv;
varying float vGrassTip;
varying float vGrassSeed;
varying float vGrassTint;
varying vec3 vGrassWorldPosition;
`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float distanceFade = 1.0 - smoothstep(uFadeDistance.x, uFadeDistance.y, distance(cameraPosition, vGrassWorldPosition));
float ditherNoise = fract(sin(dot(gl_FragCoord.xy + vec2(vGrassSeed * 31.0, vGrassSeed * 97.0), vec2(12.9898, 78.233))) * 43758.5453);
if (ditherNoise > distanceFade) {
  discard;
}

float sideMask = smoothstep(0.02, 0.28, vGrassUv.x) * (1.0 - smoothstep(0.72, 0.98, vGrassUv.x));
float tipTaper = 1.0 - smoothstep(0.68, 1.0, vGrassTip) * abs(vGrassUv.x - 0.5) * 2.0;
float bladeMask = sideMask * tipTaper;
if (bladeMask < 0.09) {
  discard;
}

float gradient = mix(uColorRamp.x, uColorRamp.y, smoothstep(0.0, 1.0, vGrassTip));
float tint = 1.0 + vGrassTint * ${GRASS_TINT_VARIATION.toFixed(2)};
diffuseColor.rgb *= gradient * tint;
`,
        );
    };

    material.customProgramCacheKey = () => GRASS_SHADER_CACHE_KEY;
    return { material, uniforms };
  }, []);

  const activeTerrainChunks = useMemo(() => {
    const chunks: TerrainChunkCoord[] = [];
    for (let zOffset = -ACTIVE_TERRAIN_CHUNK_RADIUS; zOffset <= ACTIVE_TERRAIN_CHUNK_RADIUS; zOffset += 1) {
      for (let xOffset = -ACTIVE_TERRAIN_CHUNK_RADIUS; xOffset <= ACTIVE_TERRAIN_CHUNK_RADIUS; xOffset += 1) {
        chunks.push({
          x: centerChunk.x + xOffset,
          z: centerChunk.z + zOffset,
        });
      }
    }
    return chunks;
  }, [centerChunk.x, centerChunk.z]);

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
    if (!grassMesh) {
      return;
    }

    const material = grassMesh.material;
    if (Array.isArray(material)) {
      return;
    }

    const timeUniform = material.userData.uTime as THREE.IUniform<number> | undefined;
    if (timeUniform) {
      timeUniform.value = state.clock.getElapsedTime();
    }
  });

  useEffect(() => {
    const grassMesh = grassRef.current;
    if (!grassMesh) {
      return;
    }

    for (let i = 0; i < grassField.bladeCount; i++) {
      grassMesh.setMatrixAt(i, grassField.bladeMatrices[i]);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
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
