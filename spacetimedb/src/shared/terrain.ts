import {
  TERRAIN_BASE_NOISE_SCALE,
  TERRAIN_DETAIL_NOISE_SCALE,
  TERRAIN_FLAT_RADIUS,
  TERRAIN_HEIGHT_AMPLITUDE,
  TERRAIN_MICRO_NOISE_SCALE,
  TERRAIN_RIDGE_STRENGTH,
} from './constants';

function fract(value: number) {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const range = edge1 - edge0;
  const t = Math.max(
    0,
    Math.min(1, (x - edge0) / (Math.abs(range) < 1e-6 ? 1e-6 : range)),
  );
  return t * t * (3 - 2 * t);
}

function hash2D(x: number, z: number) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

export function hash1D(value: number) {
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

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

export function sampleTerrainHeight(x: number, z: number) {
  const base =
    valueNoise2D(x * TERRAIN_BASE_NOISE_SCALE, z * TERRAIN_BASE_NOISE_SCALE) *
      2 -
    1;
  const detail =
    valueNoise2D(
      (x + 39.2) * TERRAIN_DETAIL_NOISE_SCALE,
      (z - 12.7) * TERRAIN_DETAIL_NOISE_SCALE,
    ) *
      2 -
    1;
  const micro =
    valueNoise2D(
      (x - 14.4) * TERRAIN_MICRO_NOISE_SCALE,
      (z + 24.3) * TERRAIN_MICRO_NOISE_SCALE,
    ) *
      2 -
    1;

  const ridgeNoise = valueNoise2D((x + 71.1) * 0.08, (z - 8.9) * 0.08) * 2 - 1;
  const ridgeShape = 1 - Math.abs(ridgeNoise);
  const ridge = Math.pow(Math.max(ridgeShape, 0), 2.1) * TERRAIN_RIDGE_STRENGTH;

  const radius = Math.hypot(x, z);
  const spawnMask = smoothstep(
    TERRAIN_FLAT_RADIUS * 0.45,
    TERRAIN_FLAT_RADIUS,
    radius,
  );

  const combinedNoise = base * 0.62 + detail * 0.26 + micro * 0.12;
  return (combinedNoise + ridge) * TERRAIN_HEIGHT_AMPLITUDE * spawnMask;
}
