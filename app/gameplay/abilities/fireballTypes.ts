export type FireballPhase = "active" | "distance_fade" | "hit_fade";

export interface FireballSpawnRequest {
  originX: number;
  originY: number;
  originZ: number;
  directionX: number;
  directionY: number;
  directionZ: number;
}

export type FireballCastSolidHitFn = (
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  distance: number,
) => number | null;

export type FireballTerrainHeightFn = (x: number, z: number) => number;

export interface FireballSimulationStepInput {
  dt: number;
  castSolidHit: FireballCastSolidHitFn;
  sampleTerrainHeight: FireballTerrainHeightFn;
}

export interface FireballRuntimeState {
  id: string;
  phase: FireballPhase;
  phaseElapsed: number;
  totalElapsed: number;
  travelDistance: number;
  pulseOffset: number;
  isDead: boolean;

  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;

  vx: number;
  vy: number;
  vz: number;

  scale: number;
  prevScale: number;
  intensityFactor: number;
  prevIntensityFactor: number;
  rotationY: number;
  prevRotationY: number;
}

export interface FireballRenderSlot {
  id: string | null;
  active: boolean;
  x: number;
  y: number;
  z: number;
  scale: number;
  intensityFactor: number;
  rotationY: number;
}

export interface FireballRenderFrame {
  interpolationAlpha: number;
  slots: FireballRenderSlot[];
}
