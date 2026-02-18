import {
  FIREBALL_BOUNCE_HORIZONTAL_RETAIN,
  FIREBALL_BOUNCE_RESTITUTION,
  FIREBALL_DISTANCE_FADE_DECAY,
  FIREBALL_DISTANCE_FADE_MAX_SECONDS,
  FIREBALL_DISTANCE_FADE_VELOCITY_DAMP,
  FIREBALL_GRAVITY_Y,
  FIREBALL_HIT_FADE_DECAY,
  FIREBALL_HIT_FADE_MAX_SECONDS,
  FIREBALL_LAUNCH_VERTICAL_VELOCITY,
  FIREBALL_MAX_TRAVEL_DISTANCE,
  FIREBALL_MIN_BOUNCE_Y_SPEED,
  FIREBALL_RADIUS,
  FIREBALL_SPEED,
} from "../../utils/constants";
import type {
  FireballRuntimeState,
  FireballSimulationStepInput,
  FireballSpawnRequest,
} from "./fireballTypes";

const ACTIVE_PULSE_SPEED = 20;
const ACTIVE_SCALE_PULSE = 0.08;
const ACTIVE_INTENSITY_PULSE = 0.12;
const MIN_VISIBILITY_FACTOR = 0.02;
const FIREBALL_SPIN_SPEED = 7.5;

export function createPhaseOffsetFromId(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return (hash % 6283) / 1000;
}

export function createFireballRuntimeState(
  id: string,
  spawnRequest: FireballSpawnRequest,
): FireballRuntimeState {
  return {
    id,
    phase: "active",
    phaseElapsed: 0,
    totalElapsed: 0,
    travelDistance: 0,
    pulseOffset: createPhaseOffsetFromId(id),
    isDead: false,

    x: spawnRequest.originX,
    y: spawnRequest.originY,
    z: spawnRequest.originZ,
    prevX: spawnRequest.originX,
    prevY: spawnRequest.originY,
    prevZ: spawnRequest.originZ,

    vx: spawnRequest.directionX * FIREBALL_SPEED,
    vy: FIREBALL_LAUNCH_VERTICAL_VELOCITY,
    vz: spawnRequest.directionZ * FIREBALL_SPEED,

    scale: 1,
    prevScale: 1,
    intensityFactor: 1,
    prevIntensityFactor: 1,
    rotationY: 0,
    prevRotationY: 0,
  };
}

export function snapshotFireballPreviousValues(state: FireballRuntimeState) {
  state.prevX = state.x;
  state.prevY = state.y;
  state.prevZ = state.z;
  state.prevScale = state.scale;
  state.prevIntensityFactor = state.intensityFactor;
  state.prevRotationY = state.rotationY;
}

function startDistanceFade(state: FireballRuntimeState) {
  if (state.phase !== "active") {
    return;
  }
  state.phase = "distance_fade";
  state.phaseElapsed = 0;
}

function startHitFade(state: FireballRuntimeState) {
  if (state.phase !== "active") {
    return;
  }
  state.phase = "hit_fade";
  state.phaseElapsed = 0;
  state.vx = 0;
  state.vy = 0;
  state.vz = 0;
}

export function simulateFireballStep(
  state: FireballRuntimeState,
  input: FireballSimulationStepInput,
) {
  if (state.isDead) {
    return;
  }

  const { dt, castSolidHit, sampleTerrainHeight } = input;
  state.totalElapsed += dt;

  if (state.phase === "active") {
    state.vy += FIREBALL_GRAVITY_Y * dt;

    const nextX = state.x + state.vx * dt;
    const nextY = state.y + state.vy * dt;
    const nextZ = state.z + state.vz * dt;

    const resolvedNextX = nextX;
    let resolvedNextY = nextY;
    const resolvedNextZ = nextZ;

    const terrainFloorY = sampleTerrainHeight(nextX, nextZ) + FIREBALL_RADIUS;
    if (resolvedNextY <= terrainFloorY && state.vy < 0) {
      resolvedNextY = terrainFloorY;
      state.vy = Math.max(
        FIREBALL_MIN_BOUNCE_Y_SPEED,
        -state.vy * FIREBALL_BOUNCE_RESTITUTION,
      );
      state.vx *= FIREBALL_BOUNCE_HORIZONTAL_RETAIN;
      state.vz *= FIREBALL_BOUNCE_HORIZONTAL_RETAIN;
    }

    const stepX = resolvedNextX - state.x;
    const stepY = resolvedNextY - state.y;
    const stepZ = resolvedNextZ - state.z;
    const stepLengthSquared = stepX * stepX + stepY * stepY + stepZ * stepZ;
    const stepLength = Math.sqrt(stepLengthSquared);

    let advancedDistance = stepLength;
    let hitSolidObstacle = false;

    if (stepLengthSquared > 1e-12) {
      const inverseStepLength = 1 / stepLength;
      const dirX = stepX * inverseStepLength;
      const dirY = stepY * inverseStepLength;
      const dirZ = stepZ * inverseStepLength;
      const timeOfImpact = castSolidHit(
        state.x,
        state.y,
        state.z,
        dirX,
        dirY,
        dirZ,
        stepLength,
      );

      if (timeOfImpact !== null) {
        const hitTravelDistance = Math.max(
          0,
          timeOfImpact - FIREBALL_RADIUS * 0.2,
        );
        state.x += dirX * hitTravelDistance;
        state.y += dirY * hitTravelDistance;
        state.z += dirZ * hitTravelDistance;
        advancedDistance = hitTravelDistance;
        hitSolidObstacle = true;
      }
    }

    if (!hitSolidObstacle) {
      state.x = resolvedNextX;
      state.y = resolvedNextY;
      state.z = resolvedNextZ;
    } else {
      startHitFade(state);
    }

    state.travelDistance += advancedDistance;
    if (state.travelDistance >= FIREBALL_MAX_TRAVEL_DISTANCE) {
      startDistanceFade(state);
    }
  } else {
    state.phaseElapsed += dt;

    if (state.phase === "distance_fade") {
      state.vy += FIREBALL_GRAVITY_Y * dt * 0.45;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.z += state.vz * dt;

      const velocityDamp = Math.exp(-FIREBALL_DISTANCE_FADE_VELOCITY_DAMP * dt);
      state.vx *= velocityDamp;
      state.vy *= velocityDamp;
      state.vz *= velocityDamp;

      const floorY = sampleTerrainHeight(state.x, state.z) + FIREBALL_RADIUS * 0.6;
      if (state.y < floorY) {
        state.y = floorY;
        state.vy = Math.max(0.15, state.vy);
      }

      if (state.phaseElapsed >= FIREBALL_DISTANCE_FADE_MAX_SECONDS) {
        state.isDead = true;
        return;
      }
    } else if (state.phaseElapsed >= FIREBALL_HIT_FADE_MAX_SECONDS) {
      state.isDead = true;
      return;
    }
  }

  let scaleFactor = 1;
  let intensityFactor = 1;
  if (state.phase === "active") {
    const pulse = Math.sin(state.totalElapsed * ACTIVE_PULSE_SPEED + state.pulseOffset);
    scaleFactor = 1 + pulse * ACTIVE_SCALE_PULSE;
    intensityFactor = 1 + pulse * ACTIVE_INTENSITY_PULSE;
  } else if (state.phase === "distance_fade") {
    const decay = Math.exp(-FIREBALL_DISTANCE_FADE_DECAY * state.phaseElapsed);
    scaleFactor = decay;
    intensityFactor = decay;
  } else {
    const decay = Math.exp(-FIREBALL_HIT_FADE_DECAY * state.phaseElapsed);
    scaleFactor = decay;
    intensityFactor = decay;
  }

  if (
    scaleFactor <= MIN_VISIBILITY_FACTOR ||
    intensityFactor <= MIN_VISIBILITY_FACTOR
  ) {
    state.isDead = true;
    return;
  }

  state.scale = scaleFactor;
  state.intensityFactor = intensityFactor;
  state.rotationY += dt * FIREBALL_SPIN_SPEED;
}
