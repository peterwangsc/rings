import * as THREE from "three";
import {
  CHUNK_GRASS_BLADE_COUNT,
  CHUNK_SPAWN_CLEARING_RADIUS,
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
} from "../../utils/constants";
import {
  hash1D,
  sampleTerrainHeight,
  sampleTerrainSlope,
  smoothstep,
  valueNoise2D,
} from "../../utils/terrain";
import { isNearRock } from "./placements";
import { TERRAIN_CHUNK_SIZE } from "./terrainChunks";
import type { ChunkRockPlacement, RockPlacement } from "./worldTypes";

const GRASS_SHADER_CACHE_KEY = "grass-blades-v2";
const TAU = Math.PI * 2;
const GRASS_BASE_Y = 0.03;

// Accent blade frequency (fraction of blades that get taller accent variant)
const GRASS_ACCENT_FREQUENCY = 0.06;

type GrassShaderUniforms = {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector3>;
  uFadeDistance: THREE.IUniform<THREE.Vector2>;
  uColorRamp: THREE.IUniform<THREE.Vector2>;
  uWindNoise: THREE.IUniform<THREE.Texture | null>;
  uGrassLeaf: THREE.IUniform<THREE.Texture | null>;
  uGrassAccent: THREE.IUniform<THREE.Texture | null>;
  uPatchColor: THREE.IUniform<THREE.Color>;
};

export type GrassFieldData = {
  bladeGeometry: THREE.PlaneGeometry;
  bladeMatrices: THREE.Matrix4[];
  bladeCount: number;
};

export type GrassTextures = {
  windNoise: THREE.Texture;
  grassLeaf: THREE.Texture;
  grassAccent: THREE.Texture;
};

export function createGrassField(
  rockPlacements: readonly RockPlacement[],
): GrassFieldData {
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
    const density = THREE.MathUtils.clamp(
      (macroDensity * 0.72 + patchDensity * 0.28) * slopeMask,
      0,
      1,
    );
    const densityThreshold = GRASS_DENSITY_MIN + hash1D(attempt * 7.7 + 3.1) * 0.18;
    if (density < densityThreshold) {
      continue;
    }
    if (isNearRock(x, z, GRASS_ROCK_CLEARANCE, rockPlacements)) {
      continue;
    }

    const accentSeed = hash1D(attempt * 13.4 + 9.9);
    const isAccent = accentSeed < GRASS_ACCENT_FREQUENCY;

    const widthNoise =
      1 -
      GRASS_BLADE_WIDTH_VARIANCE * 0.5 +
      hash1D(attempt * 5.3 + 4.4) * GRASS_BLADE_WIDTH_VARIANCE;
    const heightNoise =
      1 -
      GRASS_BLADE_HEIGHT_VARIANCE * 0.5 +
      hash1D(attempt * 6.1 + 5.7) * GRASS_BLADE_HEIGHT_VARIANCE;
    const accentHeightScale = isAccent ? 1.55 : 1.0;
    const accentWidthScale = isAccent ? 1.3 : 1.0;
    const width = GRASS_BLADE_BASE_WIDTH * widthNoise * accentWidthScale;
    const height =
      GRASS_BLADE_BASE_HEIGHT *
      heightNoise *
      THREE.MathUtils.lerp(0.85, 1.18, density) *
      accentHeightScale;

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
    // .x = dither seed, .y = density, .z = wind phase seed, .w = tint + accent flag encoded
    bladeDataRaw[dataIndex] = hash1D(attempt * 13.4 + 9.9);
    bladeDataRaw[dataIndex + 1] = density;
    bladeDataRaw[dataIndex + 2] = hash1D(attempt * 15.2 + 12.8);
    // Encode accent in sign: negative tint means accent blade
    const tint = hash1D(attempt * 3.8 + 2.4) * 2 - 1;
    bladeDataRaw[dataIndex + 3] = isAccent ? -(Math.abs(tint) + 2.0) : tint;
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
}

export function createGrassMaterial(textures?: GrassTextures) {
  const uniforms: GrassShaderUniforms = {
    uTime: { value: 0 },
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
    uWindNoise: { value: textures?.windNoise ?? null },
    uGrassLeaf: { value: textures?.grassLeaf ?? null },
    uGrassAccent: { value: textures?.grassAccent ?? null },
    uPatchColor: { value: new THREE.Color(GRASS_PATCH_COLOR) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: GRASS_FIELD_COLOR,
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uFadeDistance = uniforms.uFadeDistance;
    shader.uniforms.uColorRamp = uniforms.uColorRamp;
    shader.uniforms.uWindNoise = uniforms.uWindNoise;
    shader.uniforms.uGrassLeaf = uniforms.uGrassLeaf;
    shader.uniforms.uGrassAccent = uniforms.uGrassAccent;
    shader.uniforms.uPatchColor = uniforms.uPatchColor;
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
varying vec3 vGrassWorldPos;
varying float vWindStrength;
varying float vIsAccent;

uniform float uTime;
uniform vec3 uWind;
uniform sampler2D uWindNoise;

// Dual-noise wind: two rotating noise samples combined for organic, non-repeating wind
// Inspired by the Godot grass demo's diverge-angle approach
float sampleDualNoise(vec2 worldXZ, float time) {
  float speed = uWind.y;
  float scale = uWind.z;
  // Rotate wind direction ~10 degrees apart for two samples
  float c1 = cos(0.175), s1 = sin(0.175);
  float c2 = cos(-0.175), s2 = sin(-0.175);
  vec2 dir1 = vec2(c1 - s1, s1 + c1); // ~10 deg
  vec2 dir2 = vec2(c2 - s2, s2 + c2); // ~-10 deg
  vec2 offset1 = time * speed * 0.025 * normalize(dir1);
  vec2 offset2 = time * speed * 0.025 * normalize(dir2) * 0.89 * (3.14159 / 3.0);
  float n1 = texture2D(uWindNoise, worldXZ * scale * 0.071 + offset1).r;
  float n2 = texture2D(uWindNoise, worldXZ * scale * 0.071 * 0.8 + offset2).r;
  float combined = n1 * n2;
  combined = clamp(combined + 0.365, 0.0, 1.0);
  return (combined - 0.5) * 2.0; // remap to -1..1
}
`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vGrassUv = uv;
float tip = clamp(uv.y, 0.0, 1.0);
vGrassTip = tip;
vGrassSeed = aBladeData.x;

// Decode accent flag from .w: values <= -2.0 are accent blades
float rawTint = aBladeData.w;
float isAccent = step(rawTint, -1.5); // 1.0 if accent
vIsAccent = isAccent;
vGrassTint = rawTint + isAccent * 2.0; // strip the -2 offset to recover tint

#ifdef USE_INSTANCING
vec3 instanceOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vec3 instanceOrigin = vec3(0.0);
#endif

// Dual-noise wind (uses texture when available, fallback to analytic)
float windValue;
#ifdef HAS_WIND_NOISE
windValue = sampleDualNoise(instanceOrigin.xz, uTime);
#else
float windPhase = uTime * uWind.y + dot(instanceOrigin.xz, vec2(uWind.z, uWind.z * 1.19)) + aBladeData.z * 6.28318;
windValue = sin(windPhase) * 0.72 + cos(windPhase * 1.63 + aBladeData.x * 4.0) * 0.28;
#endif

float sway = windValue * uWind.x * (0.35 + aBladeData.y * 0.65);
float bendMask = tip * tip;
transformed.x += sway * bendMask;
transformed.z += sway * 0.45 * bendMask;
vWindStrength = windValue;

#ifdef USE_INSTANCING
vec4 grassWorldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 grassWorldPosition = modelMatrix * vec4(transformed, 1.0);
#endif
vGrassWorldPos = grassWorldPosition.xyz;
`,
      );

    // Determine if wind noise texture is available
    const hasWindNoise = textures?.windNoise != null;
    if (hasWindNoise) {
      shader.vertexShader = `#define HAS_WIND_NOISE\n${shader.vertexShader}`;
    }

    // Determine if leaf textures are available
    const hasLeafTex = textures?.grassLeaf != null;
    if (hasLeafTex) {
      shader.fragmentShader = `#define HAS_LEAF_TEX\n${shader.fragmentShader}`;
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec2 uFadeDistance;
uniform vec2 uColorRamp;
uniform vec3 uPatchColor;
uniform sampler2D uWindNoise;
uniform sampler2D uGrassLeaf;
uniform sampler2D uGrassAccent;
varying vec2 vGrassUv;
varying float vGrassTip;
varying float vGrassSeed;
varying float vGrassTint;
varying vec3 vGrassWorldPos;
varying float vWindStrength;
varying float vIsAccent;
`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// Distance dither fade
float distanceFade = 1.0 - smoothstep(uFadeDistance.x, uFadeDistance.y, distance(cameraPosition, vGrassWorldPos));
float ditherNoise = fract(sin(dot(gl_FragCoord.xy + vec2(vGrassSeed * 31.0, vGrassSeed * 97.0), vec2(12.9898, 78.233))) * 43758.5453);
if (ditherNoise > distanceFade) {
  discard;
}

// UV distortion: fake perspective squish based on wind (like the demo's UV squishing)
vec2 uv = vGrassUv;
uv.x -= 0.5;
float fakePersp = vWindStrength * 0.3;
uv.x *= (1.0 - uv.y) * fakePersp + 1.0;
uv.x += 0.5;
uv.x = clamp(uv.x, 0.0, 1.0);

#ifdef HAS_LEAF_TEX
// Sample grass or accent leaf texture
vec4 leafColor;
if (vIsAccent > 0.5) {
  leafColor = texture2D(uGrassAccent, uv);
} else {
  leafColor = texture2D(uGrassLeaf, uv);
}
if (leafColor.a < 0.5) discard;
#else
// Procedural blade mask (side fade + tip taper)
float sideMask = smoothstep(0.02, 0.28, vGrassUv.x) * (1.0 - smoothstep(0.72, 0.98, vGrassUv.x));
float tipTaper = 1.0 - smoothstep(0.68, 1.0, vGrassTip) * abs(vGrassUv.x - 0.5) * 2.0;
float bladeMask = sideMask * tipTaper;
if (bladeMask < 0.09) discard;
#endif

// Color gradient from root (dark) to tip (light)
float gradient = mix(uColorRamp.x, uColorRamp.y, smoothstep(0.0, 1.0, vGrassTip));

// World-space noise patch coloring (albedo2/3 from demo - two overlapping noise bands)
float patch2 = texture2D(uWindNoise, vGrassWorldPos.xz * 0.005).r;
float patch3 = texture2D(uWindNoise, vGrassWorldPos.xz * 0.003 + vec2(0.41, 0.73)).r;
vec3 baseColor = diffuseColor.rgb;
if (patch2 > 0.604) {
  // Lighter patch
  baseColor = mix(baseColor, uPatchColor, 0.55);
}
if (patch3 > 0.661) {
  // Slightly different tint
  baseColor = mix(baseColor, diffuseColor.rgb * 0.88 + vec3(0.02, 0.04, 0.0), 0.4);
}
// Accent blades get a slightly different hue
if (vIsAccent > 0.5) {
  baseColor = mix(baseColor, baseColor * vec3(0.85, 1.05, 0.75), 0.35);
}

float tint = 1.0 + vGrassTint * ${GRASS_TINT_VARIATION.toFixed(2)};
diffuseColor.rgb = baseColor * gradient * tint;
`,
      );
  };

  material.customProgramCacheKey = () =>
    `${GRASS_SHADER_CACHE_KEY}-${textures?.windNoise != null ? "wn" : "nw"}-${textures?.grassLeaf != null ? "lt" : "nl"}`;
  return material;
}

export function applyGrassFieldToMesh(
  mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>,
  grassField: GrassFieldData,
) {
  for (let i = 0; i < grassField.bladeCount; i++) {
    mesh.setMatrixAt(i, grassField.bladeMatrices[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function chunkGrassHash(chunkX: number, chunkZ: number, index: number, salt: number) {
  return hash1D(chunkX * 191.3 + chunkZ * 271.7 + index * salt);
}

export function createChunkGrassField(
  chunkX: number,
  chunkZ: number,
  rockPlacements: readonly ChunkRockPlacement[],
): GrassFieldData {
  const bladeGeometry = new THREE.PlaneGeometry(1, 1, 1, 4);
  bladeGeometry.translate(0, 0.5, 0);

  const chunkCenterX = chunkX * TERRAIN_CHUNK_SIZE;
  const chunkCenterZ = chunkZ * TERRAIN_CHUNK_SIZE;
  const isOriginChunk = chunkX === 0 && chunkZ === 0;

  const bladeMatrices: THREE.Matrix4[] = [];
  const bladeDataRaw = new Float32Array(CHUNK_GRASS_BLADE_COUNT * 4);

  const basePosition = new THREE.Vector3();
  const rotation = new THREE.Euler(0, 0, 0, "YXZ");
  const quaternion = new THREE.Quaternion();
  const bladeScale = new THREE.Vector3();

  const maxAttempts = CHUNK_GRASS_BLADE_COUNT * 26;
  let bladeCount = 0;
  for (let attempt = 0; attempt < maxAttempts && bladeCount < CHUNK_GRASS_BLADE_COUNT; attempt++) {
    const hx = chunkGrassHash(chunkX, chunkZ, attempt, 17.13);
    const hz = chunkGrassHash(chunkX, chunkZ, attempt, 19.31);
    const x = chunkCenterX + (hx - 0.5) * TERRAIN_CHUNK_SIZE;
    const z = chunkCenterZ + (hz - 0.5) * TERRAIN_CHUNK_SIZE;

    if (isOriginChunk && Math.hypot(x, z) < CHUNK_SPAWN_CLEARING_RADIUS * 0.5) {
      continue;
    }

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
    const density = THREE.MathUtils.clamp(
      (macroDensity * 0.72 + patchDensity * 0.28) * slopeMask,
      0,
      1,
    );
    const densityThreshold = GRASS_DENSITY_MIN + chunkGrassHash(chunkX, chunkZ, attempt, 7.7) * 0.18;
    if (density < densityThreshold) {
      continue;
    }
    if (isNearRock(x, z, GRASS_ROCK_CLEARANCE, rockPlacements)) {
      continue;
    }

    const accentSeed = chunkGrassHash(chunkX, chunkZ, attempt, 13.4);
    const isAccent = accentSeed < GRASS_ACCENT_FREQUENCY;

    const widthNoise =
      1 -
      GRASS_BLADE_WIDTH_VARIANCE * 0.5 +
      chunkGrassHash(chunkX, chunkZ, attempt, 5.3) * GRASS_BLADE_WIDTH_VARIANCE;
    const heightNoise =
      1 -
      GRASS_BLADE_HEIGHT_VARIANCE * 0.5 +
      chunkGrassHash(chunkX, chunkZ, attempt, 6.1) * GRASS_BLADE_HEIGHT_VARIANCE;
    const accentHeightScale = isAccent ? 1.55 : 1.0;
    const accentWidthScale = isAccent ? 1.3 : 1.0;
    const width = GRASS_BLADE_BASE_WIDTH * widthNoise * accentWidthScale;
    const height =
      GRASS_BLADE_BASE_HEIGHT *
      heightNoise *
      THREE.MathUtils.lerp(0.85, 1.18, density) *
      accentHeightScale;

    const yaw = chunkGrassHash(chunkX, chunkZ, attempt, 9.1) * TAU;
    const leanX = (chunkGrassHash(chunkX, chunkZ, attempt, 11.7) - 0.5) * 0.1;
    const leanZ = (chunkGrassHash(chunkX, chunkZ, attempt, 12.4) - 0.5) * 0.1;
    rotation.set(leanX, yaw, leanZ);
    quaternion.setFromEuler(rotation);

    basePosition.set(x, sampleTerrainHeight(x, z) + GRASS_BASE_Y, z);
    bladeScale.set(width, height, 1);

    const matrix = new THREE.Matrix4();
    matrix.compose(basePosition, quaternion, bladeScale);
    bladeMatrices.push(matrix);

    const dataIndex = bladeCount * 4;
    bladeDataRaw[dataIndex] = chunkGrassHash(chunkX, chunkZ, attempt, 13.4);
    bladeDataRaw[dataIndex + 1] = density;
    bladeDataRaw[dataIndex + 2] = chunkGrassHash(chunkX, chunkZ, attempt, 15.2);
    const tint = chunkGrassHash(chunkX, chunkZ, attempt, 3.8) * 2 - 1;
    bladeDataRaw[dataIndex + 3] = isAccent ? -(Math.abs(tint) + 2.0) : tint;
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
}

export function updateGrassMaterialTime(
  material: THREE.MeshStandardMaterial,
  elapsedTime: number,
) {
  const timeUniform = material.userData.uTime as THREE.IUniform<number> | undefined;
  if (timeUniform) {
    timeUniform.value = elapsedTime;
  }
}
