import * as THREE from "three";

const ROCK_BASE_RADIUS = 1;
const ROCK_BASE_SUBDIVISIONS = 4;
const ROCK_DOMAIN_WARP_FREQUENCY = 1.32;
const ROCK_DOMAIN_WARP_STRENGTH = 0.34;
const ROCK_STACK_MINI_SCALE = 3.85;
const ROCK_STACK_DISPLACEMENT_STRENGTH = 0.36;
const ROCK_STACK_RIDGE_STRENGTH = 0.2;
const ROCK_STACK_BASIN_STRENGTH = 0.16;
const ROCK_STACK_PROGRESSIVE_WARP_STRENGTH = 0.18;
const ROCK_MACRO_MASS_FREQUENCY = 0.9;
const ROCK_MACRO_MASS_STRENGTH = 0.28;
const ROCK_MACRO_ASYMMETRY_FREQUENCY = 1.7;
const ROCK_MACRO_ASYMMETRY_STRENGTH = 0.11;
const ROCK_EROSION_STRENGTH = 0.17;
const ROCK_FOOTING_Y_MIN = -0.86;
const ROCK_FOOTING_Y_MAX = -0.35;
const ROCK_CROWN_Y_MIN = 0.34;
const ROCK_CROWN_Y_MAX = 0.95;
const ROCK_CROWN_SOFTEN_STRENGTH = 0.1;

type TerrainStackLayer = {
  amplitude: number;
  frequency: number;
  ridgeMix: number;
  sharpness: number;
  warpContribution: number;
};

const ROCK_MINI_TERRAIN_STACK: readonly TerrainStackLayer[] = [
  {
    amplitude: 0.36,
    frequency: 0.95,
    ridgeMix: 0.18,
    sharpness: 1.15,
    warpContribution: 0.45,
  },
  {
    amplitude: 0.24,
    frequency: 1.75,
    ridgeMix: 0.34,
    sharpness: 1.35,
    warpContribution: 0.58,
  },
  {
    amplitude: 0.18,
    frequency: 3.15,
    ridgeMix: 0.55,
    sharpness: 1.75,
    warpContribution: 0.73,
  },
  {
    amplitude: 0.13,
    frequency: 5.8,
    ridgeMix: 0.72,
    sharpness: 2.2,
    warpContribution: 0.88,
  },
  {
    amplitude: 0.09,
    frequency: 9.5,
    ridgeMix: 0.86,
    sharpness: 2.65,
    warpContribution: 1.0,
  },
];

function fract(value: number) {
  return value - Math.floor(value);
}

function smootherStep5(edge0: number, edge1: number, x: number) {
  const denom = Math.max(edge1 - edge0, 1e-6);
  const t = THREE.MathUtils.clamp((x - edge0) / denom, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function hash3(ix: number, iy: number, iz: number, seed: number) {
  const h =
    Math.sin(
      ix * 127.1 +
        iy * 311.7 +
        iz * 74.7 +
        seed * 191.999 +
        ix * iy * 0.017 +
        iz * 0.131,
    ) * 43758.5453;
  return fract(h);
}

function valueNoise3(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  const ux = smootherStep5(0, 1, fx);
  const uy = smootherStep5(0, 1, fy);
  const uz = smootherStep5(0, 1, fz);

  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);

  const x00 = THREE.MathUtils.lerp(c000, c100, ux);
  const x10 = THREE.MathUtils.lerp(c010, c110, ux);
  const x01 = THREE.MathUtils.lerp(c001, c101, ux);
  const x11 = THREE.MathUtils.lerp(c011, c111, ux);
  const y0 = THREE.MathUtils.lerp(x00, x10, uy);
  const y1 = THREE.MathUtils.lerp(x01, x11, uy);
  return THREE.MathUtils.lerp(y0, y1, uz);
}

function fbm(
  point: THREE.Vector3,
  seed: number,
  octaves: number,
  lacunarity: number,
  gain: number,
) {
  let frequency = 1;
  let amplitude = 0.5;
  let sum = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum +=
      valueNoise3(
        point.x * frequency,
        point.y * frequency,
        point.z * frequency,
        seed + octave * 13.31,
      ) * amplitude;
    amplitudeSum += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return amplitudeSum > 0 ? sum / amplitudeSum : 0;
}

function ridgedFbm(point: THREE.Vector3, seed: number, octaves: number) {
  let frequency = 1;
  let amplitude = 0.55;
  let sum = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const n = valueNoise3(
      point.x * frequency,
      point.y * frequency,
      point.z * frequency,
      seed + octave * 9.73,
    );
    const ridge = 1 - Math.abs(n * 2 - 1);
    const shaped = ridge * ridge;
    sum += shaped * amplitude;
    amplitudeSum += amplitude;
    frequency *= 2.04;
    amplitude *= 0.62;
  }

  return amplitudeSum > 0 ? sum / amplitudeSum : 0;
}

function sampleTerrainStack(
  point: THREE.Vector3,
  seed: number,
  sampleScratch: THREE.Vector3,
  layerScratch: THREE.Vector3,
  warpScratch: THREE.Vector3,
  layerWarpScratch: THREE.Vector3,
) {
  sampleScratch.copy(point).multiplyScalar(ROCK_STACK_MINI_SCALE);
  warpScratch.set(0, 0, 0);

  let stackSum = 0;
  let ridgeSum = 0;
  let amplitudeSum = 0;

  for (let layerIndex = 0; layerIndex < ROCK_MINI_TERRAIN_STACK.length; layerIndex += 1) {
    const layer = ROCK_MINI_TERRAIN_STACK[layerIndex];
    layerScratch
      .copy(sampleScratch)
      .addScaledVector(warpScratch, layer.warpContribution)
      .multiplyScalar(layer.frequency);

    const baseNoise = fbm(
      layerScratch,
      seed * 2.73 + 19 + layerIndex * 17.19,
      3,
      2.06,
      0.52,
    );
    const ridgeSignal = Math.pow(1 - Math.abs(baseNoise * 2 - 1), layer.sharpness);
    const mountainBand = THREE.MathUtils.lerp(
      baseNoise * 2 - 1,
      ridgeSignal * 2 - 1,
      layer.ridgeMix,
    );

    stackSum += mountainBand * layer.amplitude;
    ridgeSum += ridgeSignal * layer.amplitude;
    amplitudeSum += layer.amplitude;

    layerWarpScratch.set(
      valueNoise3(
        layerScratch.x + 23.7,
        layerScratch.y - 11.4,
        layerScratch.z + 5.3,
        seed + layerIndex * 13.1,
      ) *
        2 -
        1,
      valueNoise3(
        layerScratch.x - 7.9,
        layerScratch.y + 17.8,
        layerScratch.z - 2.6,
        seed + layerIndex * 19.4,
      ) *
        2 -
        1,
      valueNoise3(
        layerScratch.x + 9.2,
        layerScratch.y + 3.5,
        layerScratch.z - 16.1,
        seed + layerIndex * 29.8,
      ) *
        2 -
        1,
    );
    warpScratch.add(
      layerWarpScratch.multiplyScalar(
        ROCK_STACK_PROGRESSIVE_WARP_STRENGTH * (0.36 + layer.warpContribution * 0.64),
      ),
    );
  }

  if (amplitudeSum <= 0) {
    return { stackHeight: 0, ridgeMask: 0, basinMask: 0 };
  }

  const normalizedStack = stackSum / amplitudeSum;
  const normalizedRidge = ridgeSum / amplitudeSum;
  const basinMask = smootherStep5(0.26, 0.82, 1 - normalizedRidge);

  return {
    stackHeight: normalizedStack,
    ridgeMask: normalizedRidge,
    basinMask,
  };
}

export function createProceduralRockGeometry(seed: number) {
  const geometry = new THREE.IcosahedronGeometry(
    ROCK_BASE_RADIUS,
    ROCK_BASE_SUBDIVISIONS,
  );
  const positionAttribute = geometry.getAttribute("position");
  const positions = positionAttribute.array as Float32Array;

  const baseDirection = new THREE.Vector3();
  const warpedPosition = new THREE.Vector3();
  const warpVector = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const stackSampleScratch = new THREE.Vector3();
  const stackLayerScratch = new THREE.Vector3();
  const stackWarpScratch = new THREE.Vector3();
  const stackLayerWarpScratch = new THREE.Vector3();

  const rockSeed = seed + 1;

  for (let index = 0; index < positionAttribute.count; index += 1) {
    const i3 = index * 3;
    baseDirection
      .set(positions[i3], positions[i3 + 1], positions[i3 + 2])
      .normalize();

    scratch
      .copy(baseDirection)
      .multiplyScalar(ROCK_DOMAIN_WARP_FREQUENCY);
    warpVector.set(
      fbm(scratch, rockSeed * 1.71 + 11, 3, 2.1, 0.52) * 2 - 1,
      fbm(scratch, rockSeed * 1.89 + 23, 3, 2.1, 0.52) * 2 - 1,
      fbm(scratch, rockSeed * 2.07 + 37, 3, 2.1, 0.52) * 2 - 1,
    );

    warpedPosition
      .copy(baseDirection)
      .addScaledVector(warpVector, ROCK_DOMAIN_WARP_STRENGTH);

    const stackSample = sampleTerrainStack(
      warpedPosition,
      rockSeed * 1.61 + 3,
      stackSampleScratch,
      stackLayerScratch,
      stackWarpScratch,
      stackLayerWarpScratch,
    );
    const macroMassNoise = fbm(
      scratch.copy(warpedPosition).multiplyScalar(ROCK_MACRO_MASS_FREQUENCY),
      rockSeed * 3.17 + 5,
      4,
      2.04,
      0.5,
    );
    const macroAsymmetry = ridgedFbm(
      scratch
        .copy(warpedPosition)
        .set(warpedPosition.x * 1.0, warpedPosition.y * 0.65, warpedPosition.z * 1.15)
        .multiplyScalar(ROCK_MACRO_ASYMMETRY_FREQUENCY),
      rockSeed * 4.11 + 17,
      3,
    );
    const screeNoise = ridgedFbm(
      scratch.copy(warpedPosition).multiplyScalar(6.8),
      rockSeed * 6.43 + 47,
      2,
    );

    const sideExposure = 1 - Math.abs(baseDirection.y);
    const erosionMask = smootherStep5(0.18, 0.94, sideExposure);
    const footingMask = smootherStep5(
      ROCK_FOOTING_Y_MIN,
      ROCK_FOOTING_Y_MAX,
      baseDirection.y,
    );
    const crownMask = smootherStep5(ROCK_CROWN_Y_MIN, ROCK_CROWN_Y_MAX, baseDirection.y);

    let displacement =
      (macroMassNoise - 0.5) * ROCK_MACRO_MASS_STRENGTH +
      stackSample.stackHeight * ROCK_STACK_DISPLACEMENT_STRENGTH +
      (stackSample.ridgeMask - 0.5) * ROCK_STACK_RIDGE_STRENGTH -
      stackSample.basinMask * ROCK_STACK_BASIN_STRENGTH +
      (macroAsymmetry - 0.5) * ROCK_MACRO_ASYMMETRY_STRENGTH;

    displacement -=
      erosionMask * (stackSample.ridgeMask * 0.65 + screeNoise * 0.35) * ROCK_EROSION_STRENGTH;
    displacement -= crownMask * (1 - stackSample.ridgeMask) * ROCK_CROWN_SOFTEN_STRENGTH;
    displacement *= THREE.MathUtils.lerp(0.52, 1, footingMask);

    const radius = Math.max(0.52, ROCK_BASE_RADIUS + displacement);
    baseDirection.multiplyScalar(radius);

    const basePlane =
      -0.92 +
      fbm(scratch.copy(warpedPosition).multiplyScalar(1.2), rockSeed * 7.31, 2, 2, 0.5) *
        0.14;
    baseDirection.y = Math.max(baseDirection.y, basePlane);

    positions[i3] = baseDirection.x;
    positions[i3 + 1] = baseDirection.y;
    positions[i3 + 2] = baseDirection.z;
  }

  positionAttribute.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}
