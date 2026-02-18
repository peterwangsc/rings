import {
  FIREBALL_COOLDOWN_SECONDS,
  FIREBALL_MAX_ACTIVE_COUNT,
  MAX_FRAME_DELTA_SECONDS,
} from "../../utils/constants";
import {
  createFireballRuntimeState,
  simulateFireballStep,
  snapshotFireballPreviousValues,
} from "./fireballSim";
import type {
  FireballCastSolidHitFn,
  FireballRenderFrame,
  FireballRenderSlot,
  FireballRuntimeState,
  FireballSpawnRequest,
  FireballTerrainHeightFn,
} from "./fireballTypes";

export const FIREBALL_FIXED_STEP_SECONDS = 1 / 90;
const MAX_ACCUMULATED_SECONDS = FIREBALL_FIXED_STEP_SECONDS * 6;

export interface FireballManager {
  maxActiveCount: number;
  nextId: number;
  cooldownSeconds: number;
  pendingSpawnCount: number;
  pendingSpawnRequests: FireballSpawnRequest[];
  pendingSpawnRequestReadIndex: number;
  accumulatorSeconds: number;
  activeStates: FireballRuntimeState[];
  renderFrame: FireballRenderFrame;
}

export interface FireballManagerStepParams {
  deltaSeconds: number;
  buildSpawnRequest: () => FireballSpawnRequest;
  castSolidHit: FireballCastSolidHitFn;
  sampleTerrainHeight: FireballTerrainHeightFn;
  onAfterSimulateFireballStep?: (state: FireballRuntimeState) => void;
}

function createRenderSlot(): FireballRenderSlot {
  return {
    id: null,
    active: false,
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    intensityFactor: 1,
    rotationY: 0,
  };
}

function interpolate(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

function publishRenderFrame(manager: FireballManager) {
  const alpha = Math.min(
    1,
    Math.max(0, manager.accumulatorSeconds / FIREBALL_FIXED_STEP_SECONDS),
  );
  const frame = manager.renderFrame;
  frame.interpolationAlpha = alpha;

  const { slots } = frame;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    slot.active = false;
    slot.id = null;
  }

  const maxVisible = Math.min(manager.activeStates.length, slots.length);
  for (let index = 0; index < maxVisible; index += 1) {
    const fireball = manager.activeStates[index];
    const slot = slots[index];
    slot.active = true;
    slot.id = fireball.id;
    slot.x = interpolate(fireball.prevX, fireball.x, alpha);
    slot.y = interpolate(fireball.prevY, fireball.y, alpha);
    slot.z = interpolate(fireball.prevZ, fireball.z, alpha);
    slot.scale = interpolate(fireball.prevScale, fireball.scale, alpha);
    slot.intensityFactor = interpolate(
      fireball.prevIntensityFactor,
      fireball.intensityFactor,
      alpha,
    );
    slot.rotationY = interpolate(
      fireball.prevRotationY,
      fireball.rotationY,
      alpha,
    );
  }
}

export function createFireballManager(
  maxActiveCount = FIREBALL_MAX_ACTIVE_COUNT,
): FireballManager {
  const normalizedMaxActiveCount = Math.max(0, Math.floor(maxActiveCount));
  return {
    maxActiveCount: normalizedMaxActiveCount,
    nextId: 0,
    cooldownSeconds: 0,
    pendingSpawnCount: 0,
    pendingSpawnRequests: [],
    pendingSpawnRequestReadIndex: 0,
    accumulatorSeconds: 0,
    activeStates: [],
    renderFrame: {
      interpolationAlpha: 0,
      slots: Array.from(
        { length: normalizedMaxActiveCount },
        () => createRenderSlot(),
      ),
    },
  };
}

export function setFireballManagerMaxActiveCount(
  manager: FireballManager,
  maxActiveCount: number,
) {
  const normalizedMaxActiveCount = Math.min(
    manager.renderFrame.slots.length,
    Math.max(0, Math.floor(maxActiveCount)),
  );
  manager.maxActiveCount = normalizedMaxActiveCount;

  if (manager.activeStates.length > normalizedMaxActiveCount) {
    manager.activeStates.splice(
      0,
      manager.activeStates.length - normalizedMaxActiveCount,
    );
  }
}

export function enqueueFireballSpawn(
  manager: FireballManager,
  count = 1,
) {
  const normalizedCount = Math.floor(count);
  if (normalizedCount <= 0) {
    return;
  }
  manager.pendingSpawnCount += normalizedCount;
}

export function enqueueFireballSpawnRequest(
  manager: FireballManager,
  request: FireballSpawnRequest,
) {
  manager.pendingSpawnRequests.push(request);
}

function spawnFireball(
  manager: FireballManager,
  spawnRequest: FireballSpawnRequest,
) {
  if (manager.maxActiveCount <= 0) {
    return false;
  }

  const id = `fireball-${manager.nextId}`;
  manager.nextId += 1;

  if (manager.activeStates.length >= manager.maxActiveCount) {
    return false;
  }

  manager.activeStates.push(createFireballRuntimeState(id, spawnRequest));
  return true;
}

export function stepFireballSimulation(
  manager: FireballManager,
  params: FireballManagerStepParams,
) {
  const onAfterSimulateFireballStep = params.onAfterSimulateFireballStep;
  const frameDelta = Math.min(
    MAX_FRAME_DELTA_SECONDS,
    Math.max(0, params.deltaSeconds),
  );
  manager.accumulatorSeconds = Math.min(
    manager.accumulatorSeconds + frameDelta,
    MAX_ACCUMULATED_SECONDS,
  );

  while (manager.accumulatorSeconds >= FIREBALL_FIXED_STEP_SECONDS) {
    // Pass 1 - ingest requests: pendingSpawnCount was filled through enqueueFireballSpawn.

    // Pass 2 - process cooldown + spawn.
    manager.cooldownSeconds = Math.max(
      0,
      manager.cooldownSeconds - FIREBALL_FIXED_STEP_SECONDS,
    );
    if (manager.pendingSpawnRequestReadIndex < manager.pendingSpawnRequests.length) {
      spawnFireball(
        manager,
        manager.pendingSpawnRequests[manager.pendingSpawnRequestReadIndex],
      );
      manager.pendingSpawnRequestReadIndex += 1;
      if (manager.pendingSpawnRequestReadIndex >= manager.pendingSpawnRequests.length) {
        manager.pendingSpawnRequests.length = 0;
        manager.pendingSpawnRequestReadIndex = 0;
      }
    } else if (manager.pendingSpawnCount > 0 && manager.cooldownSeconds <= 0) {
      const didSpawn = spawnFireball(manager, params.buildSpawnRequest());
      manager.pendingSpawnCount -= 1;
      if (didSpawn) {
        manager.cooldownSeconds = FIREBALL_COOLDOWN_SECONDS;
      }
    }

    // Snapshot interpolation state for the upcoming fixed step.
    for (let index = 0; index < manager.activeStates.length; index += 1) {
      snapshotFireballPreviousValues(manager.activeStates[index]);
    }

    // Pass 3 - run deterministic simulation step.
    for (let index = 0; index < manager.activeStates.length; index += 1) {
      const state = manager.activeStates[index];
      simulateFireballStep(state, {
        dt: FIREBALL_FIXED_STEP_SECONDS,
        castSolidHit: params.castSolidHit,
        sampleTerrainHeight: params.sampleTerrainHeight,
      });
      if (!state.isDead && onAfterSimulateFireballStep) {
        onAfterSimulateFireballStep(state);
      }
    }

    // Pass 4 - deactivate and compact dead entries.
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < manager.activeStates.length; readIndex += 1) {
      const fireball = manager.activeStates[readIndex];
      if (fireball.isDead) {
        continue;
      }
      manager.activeStates[writeIndex] = fireball;
      writeIndex += 1;
    }
    if (writeIndex < manager.activeStates.length) {
      manager.activeStates.length = writeIndex;
    }

    manager.accumulatorSeconds -= FIREBALL_FIXED_STEP_SECONDS;
  }

  // Pass 5 - publish render frame.
  publishRenderFrame(manager);
}
