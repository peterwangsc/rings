import * as THREE from "three";

const ROCK_SHADER_CACHE_KEY = "rock-surface-v5";
const ROCK_BASE_ROUGHNESS = 0.94;
const ROCK_BASE_METALNESS = 0.02;

// Triplanar noise bump — continues the geometry's fBM patterns at higher frequency
const ROCK_NOISE_TRIPLANAR_SCALE = 0.52;
const ROCK_NOISE_DETAIL_SCALE = 2.35;
const ROCK_NOISE_MICRO_SCALE = 5.9;
const ROCK_TRIPLANAR_BLEND_POWER = 4;

// Bump mapping
const ROCK_BUMP_SAMPLE_OFFSET = 0.072;
const ROCK_BUMP_STRENGTH = 3.25;
const ROCK_BUMP_BLEND = 0.78;

// Per-pixel roughness variation
const ROCK_ROUGHNESS_CAVITY_BOOST = 0.25;
const ROCK_ROUGHNESS_RIDGE_REDUCE = 0.12;

export type RockShaderUniforms = {
  uRockNoiseTexture: THREE.IUniform<THREE.Texture>;
};

export function createRockMaterial(
  baseColor: THREE.ColorRepresentation,
  noiseTexture: THREE.Texture,
) {
  const uniforms: RockShaderUniforms = {
    uRockNoiseTexture: { value: noiseTexture },
  };

  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: ROCK_BASE_ROUGHNESS,
    metalness: ROCK_BASE_METALNESS,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRockNoiseTexture = uniforms.uRockNoiseTexture;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vRockWorldPosition;
varying vec3 vRockWorldNormal;
`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec4 rockWorldPosition = modelMatrix * vec4(position, 1.0);
vRockWorldPosition = rockWorldPosition.xyz;
vRockWorldNormal = normalize(mat3(modelMatrix) * normal);
`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uRockNoiseTexture;
varying vec3 vRockWorldPosition;
varying vec3 vRockWorldNormal;

// Globals — computed in color_fragment, reused by roughness and normals
float gRockBumpHeight = 0.0;
float gRockCavityMask = 0.0;
float gRockRidgeMask = 0.0;
vec2 gRockBumpGradient = vec2(0.0);

float rockSaturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float smootherStep5(float edge0, float edge1, float x) {
  float t = rockSaturate((x - edge0) / max(edge1 - edge0, 1e-5));
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// --- Triplanar noise sampling ---
float sampleTriplanarNoise(vec3 worldPosition, vec3 worldNormal, float scale) {
  vec3 blendWeights = pow(abs(worldNormal), vec3(${ROCK_TRIPLANAR_BLEND_POWER.toFixed(1)}));
  blendWeights /= max(dot(blendWeights, vec3(1.0)), 1e-5);
  float xProjection = texture2D(uRockNoiseTexture, worldPosition.yz * scale).r;
  float yProjection = texture2D(uRockNoiseTexture, worldPosition.xz * scale).r;
  float zProjection = texture2D(uRockNoiseTexture, worldPosition.xy * scale).r;
  return dot(vec3(xProjection, yProjection, zProjection), blendWeights);
}

float sampleRockNoise(vec3 worldPosition, vec3 worldNormal) {
  return sampleTriplanarNoise(
    worldPosition,
    worldNormal,
    ${ROCK_NOISE_TRIPLANAR_SCALE.toFixed(2)}
  );
}

// Multi-octave height — mirrors the geometry's ridge/pocket patterns at finer scale
float computeRockHeight(vec3 worldPosition, vec3 worldNormal) {
  float macro = sampleRockNoise(worldPosition, worldNormal);
  float detail = sampleRockNoise(
    worldPosition * ${ROCK_NOISE_DETAIL_SCALE.toFixed(2)} + vec3(12.4, -7.2, 4.1),
    worldNormal
  );
  float micro = sampleRockNoise(
    worldPosition * ${ROCK_NOISE_MICRO_SCALE.toFixed(2)} + vec3(-8.7, 3.9, 11.6),
    worldNormal
  );

  // Ridge shaping — same approach as the geometry's terrain stack
  float ridgeShape = 1.0 - abs(macro * 2.0 - 1.0);
  ridgeShape = smootherStep5(0.18, 0.92, ridgeShape);
  float pocketShape = smootherStep5(0.57, 0.94, detail);
  float chipShape = 1.0 - smootherStep5(0.24, 0.70, micro);

  return rockSaturate(ridgeShape * 0.55 + pocketShape * 0.30 + chipShape * 0.15);
}

// Compute bump gradient and cavity/ridge masks, cache in globals
void computeRockSurfaceGlobals() {
  vec3 wn = normalize(vRockWorldNormal);
  vec3 basisUp = abs(wn.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(basisUp, wn));
  vec3 B = normalize(cross(wn, T));

  float hC = computeRockHeight(vRockWorldPosition, wn);
  float hT = computeRockHeight(
    vRockWorldPosition + T * ${ROCK_BUMP_SAMPLE_OFFSET.toFixed(3)}, wn
  );
  float hB = computeRockHeight(
    vRockWorldPosition + B * ${ROCK_BUMP_SAMPLE_OFFSET.toFixed(3)}, wn
  );

  gRockBumpGradient = vec2(hC - hT, hC - hB);
  gRockBumpHeight = hC;

  float slope = rockSaturate(length(gRockBumpGradient) * 3.4);
  float cavitySignal = rockSaturate((1.0 - hC) * 0.7 + slope * 0.55);
  float ridgeSignal = rockSaturate(hC * 0.9 + (1.0 - slope) * 0.25);
  gRockCavityMask = smootherStep5(0.34, 0.90, cavitySignal);
  gRockRidgeMask = smootherStep5(0.42, 0.93, ridgeSignal);
}
`,
      )
      // ── color_fragment: just compute globals, leave diffuse color alone ──
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
computeRockSurfaceGlobals();
`,
      )
      // ── roughnessmap_fragment: cavities rougher, ridges smoother ──
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor += gRockCavityMask * ${ROCK_ROUGHNESS_CAVITY_BOOST.toFixed(2)};
roughnessFactor -= gRockRidgeMask * ${ROCK_ROUGHNESS_RIDGE_REDUCE.toFixed(2)};
roughnessFactor = clamp(roughnessFactor, 0.1, 1.0);
`,
      )
      // ── normal_fragment_maps: noise bump from cached gradient ──
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
vec3 rwn = normalize(vRockWorldNormal);
vec3 bUp = abs(rwn.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
vec3 T = normalize(cross(bUp, rwn));
vec3 B = normalize(cross(rwn, T));

vec3 rockBumpNormalWorld = normalize(
  rwn
  + gRockBumpGradient.x * T * ${ROCK_BUMP_STRENGTH.toFixed(2)}
  + gRockBumpGradient.y * B * ${ROCK_BUMP_STRENGTH.toFixed(2)}
);
vec3 rockBumpNormalView = normalize((viewMatrix * vec4(rockBumpNormalWorld, 0.0)).xyz);
normal = normalize(mix(normal, rockBumpNormalView, ${ROCK_BUMP_BLEND.toFixed(2)}));
`,
      );
  };

  material.customProgramCacheKey = () => ROCK_SHADER_CACHE_KEY;

  return { material, uniforms };
}
