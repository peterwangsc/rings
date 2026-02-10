import { useFrame } from "@react-three/fiber";
import { CuboidCollider, MeshCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
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
  GRASS_PATCH_COLOR,
  GRASS_ROCK_CLEARANCE,
  GRASS_ROOT_DARKEN,
  GRASS_TINT_VARIATION,
  GRASS_TIP_LIGHTEN,
  GRASS_WIND_SPATIAL_FREQUENCY,
  GRASS_WIND_SPEED,
  GRASS_WIND_STRENGTH,
  GROUND_HALF_EXTENT,
  GROUND_MESH_SEGMENTS,
  ROCK_FORMATIONS,
  ROCK_MATERIAL_COLOR,
  TERRAIN_BASE_NOISE_SCALE,
  TERRAIN_DETAIL_NOISE_SCALE,
  TERRAIN_EDGE_FALLOFF_END,
  TERRAIN_EDGE_FALLOFF_START,
  TERRAIN_FLAT_RADIUS,
  TERRAIN_HEIGHT_AMPLITUDE,
  TERRAIN_MICRO_NOISE_SCALE,
  TERRAIN_RIDGE_STRENGTH,
  TREE_CANOPY_BASE_HEIGHT,
  TREE_CANOPY_BASE_RADIUS,
  TREE_CANOPY_DARK_COLOR,
  TREE_CANOPY_HEIGHT_VARIANCE,
  TREE_CANOPY_LIGHT_COLOR,
  TREE_CANOPY_RADIUS_VARIANCE,
  TREE_CANOPY_VERTICAL_OFFSET,
  TREE_CLEARING_RADIUS,
  TREE_COUNT,
  TREE_FIELD_RADIUS,
  TREE_MAX_SLOPE,
  TREE_MIN_SPACING,
  TREE_TRUNK_BASE_HEIGHT,
  TREE_TRUNK_BASE_RADIUS,
  TREE_TRUNK_COLOR,
  TREE_TRUNK_HEIGHT_VARIANCE,
  TREE_TRUNK_RADIUS_VARIANCE,
} from "../utils/constants";
import { createProceduralRockGeometry } from "../utils/rockGeometry";
import { createRockMaterial } from "../utils/shaders";

const SIMPLEX_NOISE_TEXTURE_PATH = "/simplex-noise.png";
const SIMPLEX_NOISE_TEXTURE_ANISOTROPY = 8;
const GRASS_SHADER_CACHE_KEY = "grass-blades-v1";
const TAU = Math.PI * 2;
const GRASS_BASE_Y = 0.03;
const TERRAIN_SLOPE_SAMPLE_DELTA = 0.45;
const TREE_ROCK_CLEARANCE = 1.2;

type GrassShaderUniforms = {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector3>;
  uFadeDistance: THREE.IUniform<THREE.Vector2>;
  uColorRamp: THREE.IUniform<THREE.Vector2>;
};

function fract(value: number) {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2D(x: number, z: number) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function hash1D(value: number) {
  return fract(Math.sin(value * 12.9898) * 43758.5453123);
}

function valueNoise2D(x: number, z: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;

  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const n00 = hash2D(x0, z0);
  const n10 = hash2D(x0 + 1, z0);
  const n01 = hash2D(x0, z0 + 1);
  const n11 = hash2D(x0 + 1, z0 + 1);

  const nx0 = THREE.MathUtils.lerp(n00, n10, u);
  const nx1 = THREE.MathUtils.lerp(n01, n11, u);
  return THREE.MathUtils.lerp(nx0, nx1, v);
}

function sampleTerrainHeight(x: number, z: number) {
  const base = valueNoise2D(x * TERRAIN_BASE_NOISE_SCALE, z * TERRAIN_BASE_NOISE_SCALE) * 2 - 1;
  const detail =
    valueNoise2D((x + 39.2) * TERRAIN_DETAIL_NOISE_SCALE, (z - 12.7) * TERRAIN_DETAIL_NOISE_SCALE) *
      2 -
    1;
  const micro =
    valueNoise2D((x - 14.4) * TERRAIN_MICRO_NOISE_SCALE, (z + 24.3) * TERRAIN_MICRO_NOISE_SCALE) *
      2 -
    1;

  const ridgeNoise = valueNoise2D((x + 71.1) * 0.08, (z - 8.9) * 0.08) * 2 - 1;
  const ridgeShape = 1 - Math.abs(ridgeNoise);
  const ridge = Math.pow(Math.max(ridgeShape, 0), 2.1) * TERRAIN_RIDGE_STRENGTH;

  const radius = Math.hypot(x, z);
  const centerMask = smoothstep(TERRAIN_FLAT_RADIUS * 0.45, TERRAIN_FLAT_RADIUS, radius);
  const edgeMask = 1 - smoothstep(TERRAIN_EDGE_FALLOFF_START, TERRAIN_EDGE_FALLOFF_END, radius);

  const combinedNoise = base * 0.62 + detail * 0.26 + micro * 0.12;
  return (combinedNoise + ridge) * TERRAIN_HEIGHT_AMPLITUDE * centerMask * edgeMask;
}

function sampleTerrainSlope(x: number, z: number) {
  const delta = TERRAIN_SLOPE_SAMPLE_DELTA;
  const dx = sampleTerrainHeight(x + delta, z) - sampleTerrainHeight(x - delta, z);
  const dz = sampleTerrainHeight(x, z + delta) - sampleTerrainHeight(x, z - delta);
  return Math.hypot(dx, dz) / (2 * delta);
}

function isNearRock(x: number, z: number, clearance: number) {
  return ROCK_FORMATIONS.some((rock) => {
    const dx = x - rock.position[0];
    const dz = z - rock.position[2];
    const clearX = rock.collider[0] + clearance;
    const clearZ = rock.collider[2] + clearance;
    if (Math.abs(dx) < clearX && Math.abs(dz) < clearZ) {
      return true;
    }
    const radialClear = Math.max(clearX, clearZ);
    return dx * dx + dz * dz < radialClear * radialClear;
  });
}

export function WorldGeometry() {
  const grassRef =
    useRef<THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(
      null,
    );
  const treeTrunkRef =
    useRef<THREE.InstancedMesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>>(
      null,
    );
  const treeCanopyRef =
    useRef<THREE.InstancedMesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>>(null);

  const rockNoiseTexture = useMemo(() => {
    const texture = new THREE.TextureLoader().load(SIMPLEX_NOISE_TEXTURE_PATH);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = SIMPLEX_NOISE_TEXTURE_ANISOTROPY;
    texture.needsUpdate = true;
    return texture;
  }, []);

  const terrainGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(
      GROUND_HALF_EXTENT * 2,
      GROUND_HALF_EXTENT * 2,
      GROUND_MESH_SEGMENTS,
      GROUND_MESH_SEGMENTS,
    );
    geometry.rotateX(-Math.PI * 0.5);

    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);

    const lowColor = new THREE.Color(GRASS_PATCH_COLOR);
    const highColor = new THREE.Color(GRASS_FIELD_COLOR).offsetHSL(0.02, -0.05, 0.1);
    const warmColor = new THREE.Color("#7CB66A");
    const workingColor = new THREE.Color();

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = sampleTerrainHeight(x, z);
      positions.setY(i, y);

      const radius = Math.hypot(x, z);
      const edgeDamp = 1 - smoothstep(TERRAIN_EDGE_FALLOFF_START, TERRAIN_EDGE_FALLOFF_END, radius);
      const patchNoise = valueNoise2D((x - 13.5) * 0.08, (z + 7.4) * 0.08);
      const hueNoise = valueNoise2D((x + 21.2) * 0.16, (z - 5.6) * 0.16);
      const heightFactor = THREE.MathUtils.clamp(y / (TERRAIN_HEIGHT_AMPLITUDE * 1.2) + 0.5, 0, 1);

      workingColor.copy(lowColor);
      workingColor.lerp(highColor, THREE.MathUtils.clamp(heightFactor * 0.6 + patchNoise * 0.45, 0, 1));
      workingColor.lerp(warmColor, hueNoise * 0.2);
      workingColor.multiplyScalar(0.86 + edgeDamp * 0.14);

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
  }, []);

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
    () =>
      ROCK_FORMATIONS.map((rock) => ({
        ...rock,
        terrainY: sampleTerrainHeight(rock.position[0], rock.position[2]),
      })),
    [],
  );

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
      if (isNearRock(x, z, GRASS_ROCK_CLEARANCE)) {
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
  }, []);

  const treeField = useMemo(() => {
    const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    trunkGeometry.translate(0, 0.5, 0);
    const canopyGeometry = new THREE.ConeGeometry(1, 1, 8, 1);
    canopyGeometry.translate(0, 0.5, 0);

    const trunkMatrices: THREE.Matrix4[] = [];
    const canopyMatrices: THREE.Matrix4[] = [];
    const trunkColors: THREE.Color[] = [];
    const canopyColors: THREE.Color[] = [];
    const treePositions: THREE.Vector2[] = [];

    const position = new THREE.Vector3();
    const trunkScale = new THREE.Vector3();
    const canopyScale = new THREE.Vector3();
    const rotation = new THREE.Euler(0, 0, 0, "YXZ");
    const quaternion = new THREE.Quaternion();

    const baseTrunkColor = new THREE.Color(TREE_TRUNK_COLOR);
    const darkCanopyColor = new THREE.Color(TREE_CANOPY_DARK_COLOR);
    const lightCanopyColor = new THREE.Color(TREE_CANOPY_LIGHT_COLOR);

    const maxAttempts = TREE_COUNT * 36;
    for (let attempt = 0; attempt < maxAttempts && trunkMatrices.length < TREE_COUNT; attempt++) {
      const sampleRadius = hash1D(attempt * 23.7 + 1.1);
      const sampleAngle = hash1D(attempt * 29.2 + 3.5);
      const radius = TREE_FIELD_RADIUS * Math.sqrt(sampleRadius);
      const angle = sampleAngle * TAU;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (Math.hypot(x, z) < TREE_CLEARING_RADIUS) {
        continue;
      }
      if (isNearRock(x, z, TREE_ROCK_CLEARANCE)) {
        continue;
      }

      const terrainSlope = sampleTerrainSlope(x, z);
      if (terrainSlope > TREE_MAX_SLOPE) {
        continue;
      }

      const treeDensity = valueNoise2D((x - 16.3) * 0.06, (z + 9.8) * 0.06);
      const treeThreshold = 0.42 + hash1D(attempt * 2.9 + 7.1) * 0.22;
      if (treeDensity < treeThreshold) {
        continue;
      }

      const tooCloseToTree = treePositions.some((treePosition) => {
        const dx = treePosition.x - x;
        const dz = treePosition.y - z;
        return dx * dx + dz * dz < TREE_MIN_SPACING * TREE_MIN_SPACING;
      });
      if (tooCloseToTree) {
        continue;
      }

      treePositions.push(new THREE.Vector2(x, z));

      const terrainY = sampleTerrainHeight(x, z);
      const trunkHeight = TREE_TRUNK_BASE_HEIGHT + hash1D(attempt * 6.8 + 2.2) * TREE_TRUNK_HEIGHT_VARIANCE;
      const trunkRadius = TREE_TRUNK_BASE_RADIUS + hash1D(attempt * 3.7 + 9.6) * TREE_TRUNK_RADIUS_VARIANCE;
      const canopyHeight =
        TREE_CANOPY_BASE_HEIGHT + hash1D(attempt * 4.2 + 11.1) * TREE_CANOPY_HEIGHT_VARIANCE;
      const canopyRadius =
        TREE_CANOPY_BASE_RADIUS + hash1D(attempt * 5.4 + 13.2) * TREE_CANOPY_RADIUS_VARIANCE;

      const yaw = hash1D(attempt * 6.9 + 4.4) * TAU;
      const leanX = (hash1D(attempt * 8.2 + 7.5) - 0.5) * 0.08;
      const leanZ = (hash1D(attempt * 9.8 + 5.8) - 0.5) * 0.08;
      rotation.set(leanX, yaw, leanZ);
      quaternion.setFromEuler(rotation);

      trunkScale.set(trunkRadius, trunkHeight, trunkRadius);
      position.set(x, terrainY, z);
      const trunkMatrix = new THREE.Matrix4();
      trunkMatrix.compose(position, quaternion, trunkScale);
      trunkMatrices.push(trunkMatrix);

      canopyScale.set(canopyRadius, canopyHeight, canopyRadius);
      const canopyY = terrainY + trunkHeight * (1 - TREE_CANOPY_VERTICAL_OFFSET);
      position.set(x, canopyY, z);
      const canopyMatrix = new THREE.Matrix4();
      canopyMatrix.compose(position, quaternion, canopyScale);
      canopyMatrices.push(canopyMatrix);

      const trunkTint = baseTrunkColor.clone();
      trunkTint.offsetHSL(0, 0, (hash1D(attempt * 5.1 + 2.7) - 0.5) * 0.12);
      trunkColors.push(trunkTint);

      const canopyBlend = THREE.MathUtils.clamp(
        treeDensity * 0.7 + hash1D(attempt * 7.3 + 3.1) * 0.3,
        0,
        1,
      );
      const canopyTint = darkCanopyColor.clone().lerp(lightCanopyColor, canopyBlend);
      canopyTint.offsetHSL((hash1D(attempt * 3.4 + 8.8) - 0.5) * 0.03, 0, 0);
      canopyColors.push(canopyTint);
    }

    return {
      trunkGeometry,
      canopyGeometry,
      trunkMatrices,
      canopyMatrices,
      trunkColors,
      canopyColors,
      treeCount: trunkMatrices.length,
    };
  }, []);

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

  const treeTrunkMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: TREE_TRUNK_COLOR,
        roughness: 0.98,
        metalness: 0.02,
        vertexColors: true,
      }),
    [],
  );

  const treeCanopyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: TREE_CANOPY_LIGHT_COLOR,
        roughness: 0.95,
        metalness: 0.02,
        vertexColors: true,
      }),
    [],
  );

  useFrame((state) => {
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
    const trunkMesh = treeTrunkRef.current;
    const canopyMesh = treeCanopyRef.current;
    if (!trunkMesh || !canopyMesh) {
      return;
    }

    for (let i = 0; i < treeField.treeCount; i++) {
      trunkMesh.setMatrixAt(i, treeField.trunkMatrices[i]);
      canopyMesh.setMatrixAt(i, treeField.canopyMatrices[i]);
      trunkMesh.setColorAt(i, treeField.trunkColors[i]);
      canopyMesh.setColorAt(i, treeField.canopyColors[i]);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) {
      trunkMesh.instanceColor.needsUpdate = true;
    }
    if (canopyMesh.instanceColor) {
      canopyMesh.instanceColor.needsUpdate = true;
    }
  }, [treeField]);

  useEffect(() => {
    return () => {
      terrainMaterial.dispose();
      terrainGeometry.dispose();
      rockMaterial.dispose();
      grassMaterial.dispose();
      treeTrunkMaterial.dispose();
      treeCanopyMaterial.dispose();
      grassField.bladeGeometry.dispose();
      treeField.trunkGeometry.dispose();
      treeField.canopyGeometry.dispose();
      rockNoiseTexture.dispose();
      rockGeometries.forEach((geometry) => geometry.dispose());
    };
  }, [
    grassField.bladeGeometry,
    grassMaterial,
    rockGeometries,
    rockMaterial,
    rockNoiseTexture,
    terrainGeometry,
    terrainMaterial,
    treeCanopyMaterial,
    treeField.canopyGeometry,
    treeField.trunkGeometry,
    treeTrunkMaterial,
  ]);

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <MeshCollider type="trimesh">
          <mesh geometry={terrainGeometry} material={terrainMaterial} receiveShadow />
        </MeshCollider>
      </RigidBody>

      <instancedMesh
        ref={grassRef}
        args={[grassField.bladeGeometry, grassMaterial, grassField.bladeCount]}
        frustumCulled={false}
      />

      <instancedMesh
        ref={treeTrunkRef}
        args={[treeField.trunkGeometry, treeTrunkMaterial, treeField.treeCount]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      <instancedMesh
        ref={treeCanopyRef}
        args={[treeField.canopyGeometry, treeCanopyMaterial, treeField.treeCount]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {rockPlacements.map((rock, index) => (
        <RigidBody
          key={`rock-${index}`}
          type="fixed"
          colliders={false}
          position={[rock.position[0], rock.position[1] + rock.terrainY, rock.position[2]]}
        >
          <CuboidCollider args={[rock.collider[0], rock.collider[1], rock.collider[2]]} />
          <mesh
            castShadow
            receiveShadow
            scale={rock.scale}
            material={rockMaterial}
            geometry={rockGeometries[index]}
          />
        </RigidBody>
      ))}
    </>
  );
}
