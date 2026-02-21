"use client";

import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  applyFirstPersonCamera,
  applyThirdPersonCamera,
} from "../camera/cameraRig";
import { FireballRenderLayer } from "../gameplay/abilities/FireballRenderLayer";
import {
  createFireballManager,
  enqueueFireballSpawn,
  enqueueFireballSpawnRequest,
  stepFireballSimulation,
} from "../gameplay/abilities/fireballManager";
import type { FireballSpawnRequest } from "../gameplay/abilities/fireballTypes";
import {
  writePredictedGoombaPose,
  type GoombaPose,
} from "../gameplay/goombas/goombaPrediction";
import type { FireballLoopController } from "../audio/useGameAudio";
import { CharacterActor, type MotionState } from "../lib/CharacterActor";
import type {
  CharacterInputState,
  CharacterRigControllerProps,
} from "./controllerTypes";

const NOOP_FIREBALL_LOOPS: FireballLoopController = {
  setFireballLoopGain: () => {},
  stopFireballLoop: () => {},
};
import {
  CHARACTER_CAMERA_YAW_SIGN,
  CHARACTER_MODEL_YAW_OFFSET,
  DEFAULT_INPUT_STATE,
  FIRST_PERSON_CAMERA_FOV,
  FIREBALL_MAX_ACTIVE_COUNT,
  FIREBALL_RADIUS,
  GOOMBA_FIREBALL_HITBOX_BASE_OFFSET,
  GOOMBA_FIREBALL_HITBOX_HEIGHT,
  GOOMBA_FIREBALL_HITBOX_RADIUS,
  GOOMBA_HIT_RETRY_COOLDOWN_MS,
  GOOMBA_INTERACT_DISABLED_STATE,
  GOOMBA_STOMP_MIN_FALL_SPEED,
  GOOMBA_STOMP_RADIUS,
  MYSTERY_BOX_HALF_EXTENT,
  MYSTERY_BOX_HEAD_RAY_LENGTH,
  MYSTERY_BOX_HIT_CLIENT_COOLDOWN_MS,
  MYSTERY_BOX_HIT_CLIENT_RADIUS,
  MYSTERY_BOX_HIT_DOWNWARD_CLEAR_SPEED,
  MYSTERY_BOX_INTERACT_DISABLED_STATE,
  GROUNDED_GRACE_SECONDS,
  JUMP_INPUT_BUFFER_SECONDS,
  MAX_FRAME_DELTA_SECONDS,
  PLAYER_ACCELERATION,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_EYE_HEIGHT_OFFSET,
  PLAYER_GROUND_CAST_DISTANCE,
  PLAYER_JUMP_VELOCITY,
  PLAYER_LINEAR_DAMPING,
  PLAYER_RUN_SPEED,
  PLAYER_START_POSITION,
  PLAYER_START_YAW,
  PLAYER_VISUAL_Y_OFFSET,
  PLAYER_WALK_SPEED,
  PLANAR_SPEED_SMOOTHING,
  THIRD_PERSON_CAMERA_COLLISION_RADIUS,
  THIRD_PERSON_CAMERA_COLLISION_SKIN,
  THIRD_PERSON_CAMERA_DISTANCE,
  THIRD_PERSON_CAMERA_FOV,
  THIRD_PERSON_CAMERA_MIN_DISTANCE,
  THIRD_PERSON_ORBIT_ORIGIN_HEIGHT_OFFSET,
  THIRD_PERSON_PIVOT_HEIGHT_OFFSET,
  VERTICAL_STILL_ENTER_SPEED_EPS,
  VERTICAL_STILL_EXIT_SPEED_EPS,
  VERTICAL_STILL_GROUNDED_RECOVERY_SECONDS,
  WORLD_UP,
} from "../utils/constants";
import {
  getForwardFromYaw,
  getLookDirection,
  getRightFromForward,
  normalizeAngle,
} from "../utils/math";
import {
  isGroundedWithinGracePeriod,
  resolveTargetMotionState,
  updateUngroundedTimer,
} from "../utils/physics";
import { sampleTerrainHeight } from "../utils/terrain";
import { useControllerInputHandlers } from "./useControllerInputHandlers";

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;
const SNAPSHOT_INTERVAL_SECONDS = 1 / 20;
const RECONCILIATION_SOFT_DISTANCE_SQUARED = 0.08 * 0.08;
const RECONCILIATION_HARD_DISTANCE_SQUARED = 2.5 * 2.5;
const MAX_LOCAL_FIREBALL_REQUESTS_PER_FRAME = 4;
const MAX_NETWORK_FIREBALL_SPAWNS_PER_FRAME = 6;
const FOOTSTEPS_MIN_PLANAR_SPEED = 0.32;
const DAMAGE_KNOCKBACK_HORIZONTAL_SPEED = 36.25;
const DAMAGE_KNOCKBACK_VERTICAL_VELOCITY = 23.2;
const DAMAGE_DIRECTION_EPSILON_SQUARED = 1e-6;
const GOOMBA_STOMP_RADIUS_SQUARED = GOOMBA_STOMP_RADIUS * GOOMBA_STOMP_RADIUS;
const MYSTERY_BOX_HIT_CLIENT_RADIUS_SQUARED =
  MYSTERY_BOX_HIT_CLIENT_RADIUS * MYSTERY_BOX_HIT_CLIENT_RADIUS;
const FIREBALL_GOOMBA_HIT_RADIUS_SQUARED =
  (GOOMBA_FIREBALL_HITBOX_RADIUS + FIREBALL_RADIUS) *
  (GOOMBA_FIREBALL_HITBOX_RADIUS + FIREBALL_RADIUS);
const GOOMBA_PREDICTION_LAG_MS = 50;
const PLAYER_START_POSITION_ARRAY = [
  PLAYER_START_POSITION.x,
  PLAYER_START_POSITION.y,
  PLAYER_START_POSITION.z,
] as const;

function getSegmentToSegmentDistanceSquared(
  segmentAStartX: number,
  segmentAStartY: number,
  segmentAStartZ: number,
  segmentAEndX: number,
  segmentAEndY: number,
  segmentAEndZ: number,
  segmentBStartX: number,
  segmentBStartY: number,
  segmentBStartZ: number,
  segmentBEndX: number,
  segmentBEndY: number,
  segmentBEndZ: number,
) {
  const SEGMENT_EPSILON = 1e-8;

  const directionAX = segmentAEndX - segmentAStartX;
  const directionAY = segmentAEndY - segmentAStartY;
  const directionAZ = segmentAEndZ - segmentAStartZ;
  const directionBX = segmentBEndX - segmentBStartX;
  const directionBY = segmentBEndY - segmentBStartY;
  const directionBZ = segmentBEndZ - segmentBStartZ;
  const offsetX = segmentAStartX - segmentBStartX;
  const offsetY = segmentAStartY - segmentBStartY;
  const offsetZ = segmentAStartZ - segmentBStartZ;

  const a =
    directionAX * directionAX +
    directionAY * directionAY +
    directionAZ * directionAZ;
  const b =
    directionAX * directionBX +
    directionAY * directionBY +
    directionAZ * directionBZ;
  const c =
    directionBX * directionBX +
    directionBY * directionBY +
    directionBZ * directionBZ;
  const d =
    directionAX * offsetX + directionAY * offsetY + directionAZ * offsetZ;
  const e =
    directionBX * offsetX + directionBY * offsetY + directionBZ * offsetZ;
  const denominator = a * c - b * b;

  let sNumerator: number;
  let sDenominator = denominator;
  let tNumerator: number;
  let tDenominator = denominator;

  if (denominator <= SEGMENT_EPSILON) {
    sNumerator = 0;
    sDenominator = 1;
    tNumerator = e;
    tDenominator = c;
  } else {
    sNumerator = b * e - c * d;
    tNumerator = a * e - b * d;

    if (sNumerator < 0) {
      sNumerator = 0;
      tNumerator = e;
      tDenominator = c;
    } else if (sNumerator > sDenominator) {
      sNumerator = sDenominator;
      tNumerator = e + b;
      tDenominator = c;
    }
  }

  if (tNumerator < 0) {
    tNumerator = 0;
    if (-d < 0) {
      sNumerator = 0;
    } else if (-d > a) {
      sNumerator = sDenominator;
    } else {
      sNumerator = -d;
      sDenominator = a;
    }
  } else if (tNumerator > tDenominator) {
    tNumerator = tDenominator;
    if (-d + b < 0) {
      sNumerator = 0;
    } else if (-d + b > a) {
      sNumerator = sDenominator;
    } else {
      sNumerator = -d + b;
      sDenominator = a;
    }
  }

  const s =
    Math.abs(sNumerator) <= SEGMENT_EPSILON ? 0 : sNumerator / sDenominator;
  const t =
    Math.abs(tNumerator) <= SEGMENT_EPSILON ? 0 : tNumerator / tDenominator;

  const dx = offsetX + directionAX * s - directionBX * t;
  const dy = offsetY + directionAY * s - directionBY * t;
  const dz = offsetZ + directionAZ * s - directionBZ * t;
  return dx * dx + dy * dy + dz * dz;
}

function getPointToSegmentDistanceSquared2D(
  segmentStartX: number,
  segmentStartZ: number,
  segmentEndX: number,
  segmentEndZ: number,
  pointX: number,
  pointZ: number,
) {
  const segmentDeltaX = segmentEndX - segmentStartX;
  const segmentDeltaZ = segmentEndZ - segmentStartZ;
  const segmentLengthSquared =
    segmentDeltaX * segmentDeltaX + segmentDeltaZ * segmentDeltaZ;
  if (segmentLengthSquared <= 1e-8) {
    const dx = pointX - segmentStartX;
    const dz = pointZ - segmentStartZ;
    return dx * dx + dz * dz;
  }

  const t = THREE.MathUtils.clamp(
    ((pointX - segmentStartX) * segmentDeltaX +
      (pointZ - segmentStartZ) * segmentDeltaZ) /
      segmentLengthSquared,
    0,
    1,
  );
  const closestX = segmentStartX + segmentDeltaX * t;
  const closestZ = segmentStartZ + segmentDeltaZ * t;
  const dx = pointX - closestX;
  const dz = pointZ - closestZ;
  return dx * dx + dz * dz;
}

function shouldCollideFireball(collider: {
  parent(): { userData?: { kind?: string } } | null;
}) {
  const parentBody = collider.parent();
  const userData = parentBody?.userData as { kind?: string } | undefined;
  return userData?.kind !== "terrain";
}

function setRayOrigin(
  ray: { origin: { x: number; y: number; z: number } },
  x: number,
  y: number,
  z: number,
) {
  ray.origin.x = x;
  ray.origin.y = y;
  ray.origin.z = z;
}

function clearArray(values: { length: number }) {
  values.length = 0;
}

function isGoombaHitOnCooldown(
  goombaHitTimestamps: Map<string, number>,
  goombaId: string,
  nowMs: number,
) {
  const lastHitAtMs = goombaHitTimestamps.get(goombaId);
  if (lastHitAtMs === undefined) {
    return false;
  }
  if (nowMs - lastHitAtMs <= GOOMBA_HIT_RETRY_COOLDOWN_MS) {
    return true;
  }
  goombaHitTimestamps.delete(goombaId);
  return false;
}

function isMysteryBoxHitOnCooldown(
  mysteryBoxHitTimestamps: Map<string, number>,
  mysteryBoxId: string,
  nowMs: number,
) {
  const lastHitAtMs = mysteryBoxHitTimestamps.get(mysteryBoxId);
  if (lastHitAtMs === undefined) {
    return false;
  }
  if (nowMs - lastHitAtMs <= MYSTERY_BOX_HIT_CLIENT_COOLDOWN_MS) {
    return true;
  }
  mysteryBoxHitTimestamps.delete(mysteryBoxId);
  return false;
}

export function CharacterRigController({
  characterPath,
  cameraMode,
  onToggleCameraMode,
  isWalkDefault,
  onToggleDefaultGait,
  onPointerLockChange,
  isInputSuspended,
  isInputSuspendedRef: isInputSuspendedRefProp,
  onPlayerPositionUpdate,
  mobileMoveInputRef,
  mobileJumpPressedRef,
  mobileFireballTriggerRef,
  damageEventCounterRef,
  fireballManager,
  onLocalPlayerSnapshot,
  onLocalFireballCast,
  onLocalShootSound,
  onLocalJump,
  onLocalFootstepsActiveChange,
  goombas,
  onLocalGoombaHit,
  mysteryBoxes,
  onLocalMysteryBoxHit,
  authoritativeLocalPlayerState,
  authoritativeLocalPlayerStateRef: authoritativeLocalPlayerStateRefProp,
  networkFireballSpawnQueueRef,
  fireballLoopController,
}: CharacterRigControllerProps) {
  const { camera, gl } = useThree();
  const { rapier, world } = useRapier();

  // Unified input-suspended ref — callers may pass a ref (preferred) or a boolean value.
  // Using a ref avoids re-registration of all event listeners on every chat open/close.
  const internalIsInputSuspendedRef = useRef(isInputSuspended ?? false);
  const isInputSuspendedRef = isInputSuspendedRefProp ?? internalIsInputSuspendedRef;
  // Keep the internal ref in sync when the boolean prop variant is used.
  // Event handlers read the ref so a post-render update is fine.
  useEffect(() => {
    if (!isInputSuspendedRefProp) {
      internalIsInputSuspendedRef.current = isInputSuspended ?? false;
    }
  });

  const bodyRef = useRef<RapierRigidBody | null>(null);
  const visualRootRef = useRef<THREE.Group>(null);
  const inputStateRef = useRef<CharacterInputState>({ ...DEFAULT_INPUT_STATE });
  const jumpIntentTimerRef = useRef(0);
  const ungroundedTimerRef = useRef(0);
  const verticalStillTimerRef = useRef(0);
  const isInVerticalStillBandRef = useRef(false);
  const groundedRecoveryLatchRef = useRef(false);
  const isPointerLockedRef = useRef(false);
  const activeTouchPointerIdRef = useRef<number | null>(null);
  const activeTouchPositionRef = useRef<{ x: number; y: number } | null>(null);
  const cameraYawRef = useRef(PLAYER_START_YAW);
  const cameraPitchRef = useRef(0);
  const characterYawRef = useRef(PLAYER_START_YAW);
  const smoothedPlanarSpeedRef = useRef(0);
  const mobileJumpWasPressedRef = useRef(false);
  const fireballRequestCountRef = useRef(0);
  const lastProcessedFireballRequestCountRef = useRef(0);
  const fireballCastAnimationCountRef = useRef(0);
  const lastProcessedMobileFireballTriggerRef = useRef(0);
  const networkFireballQueueReadIndexRef = useRef(0);
  const snapshotAccumulatorSecondsRef = useRef(0);
  const localInputSequenceRef = useRef(0);
  const lastProcessedDamageEventCounterRef = useRef(0);
  const goombaHitTimestampsRef = useRef(new Map<string, number>());
  const mysteryBoxHitTimestampsRef = useRef(new Map<string, number>());
  // True while the player has upward momentum (set on positive vy, cleared on hard downward)
  const wasMovingUpRef = useRef(false);
  const footstepsAudioActiveRef = useRef(false);
  const motionStateRef = useRef<MotionState>("idle");
  const fallbackFireballManager = useMemo(
    () => createFireballManager(FIREBALL_MAX_ACTIVE_COUNT),
    [],
  );
  const activeFireballManager = fireballManager ?? fallbackFireballManager;

  const moveDirectionRef = useRef(new THREE.Vector3());
  const forwardRef = useRef(new THREE.Vector3());
  const rightRef = useRef(new THREE.Vector3());
  const lookDirectionRef = useRef(new THREE.Vector3());
  const playerPositionRef = useRef(new THREE.Vector3());
  const cameraFocusPositionRef = useRef(new THREE.Vector3());
  const thirdPersonOrbitOriginRef = useRef(new THREE.Vector3());
  const cameraPivotRef = useRef(new THREE.Vector3());
  const desiredCameraPositionRef = useRef(new THREE.Vector3());
  const lookTargetRef = useRef(new THREE.Vector3());
  const visualQuaternionRef = useRef(new THREE.Quaternion());
  const cameraCollisionDirectionRef = useRef(new THREE.Vector3());
  const cameraCollisionOriginRef = useRef({ x: 0, y: 0, z: 0 });
  const cameraCollisionCastDirectionRef = useRef({ x: 0, y: 0, z: 0 });
  const fireballLaunchDirectionRef = useRef(new THREE.Vector3());
  const fireballPlanarDirectionRef = useRef(new THREE.Vector3());
  const fireballSpawnPositionRef = useRef(new THREE.Vector3());
  const bodyTranslationRef = useRef({
    x: PLAYER_START_POSITION.x,
    y: PLAYER_START_POSITION.y,
    z: PLAYER_START_POSITION.z,
  });
  const nextLinvelRef = useRef({ x: 0, y: 0, z: 0 });
  const reconciliationTranslationRef = useRef({
    x: PLAYER_START_POSITION.x,
    y: PLAYER_START_POSITION.y,
    z: PLAYER_START_POSITION.z,
  });
  const predictedGoombaPoseRef = useRef<GoombaPose>({
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
  });
  const fireballCastOriginRef = useRef({ x: 0, y: 0, z: 0 });
  const fireballCastDirectionRef = useRef({ x: 0, y: 0, z: 0 });
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraCollisionShape = useMemo(
    () => new rapier.Ball(THIRD_PERSON_CAMERA_COLLISION_RADIUS),
    [rapier],
  );
  const fireballCastShape = useMemo(
    () => new rapier.Ball(FIREBALL_RADIUS),
    [rapier],
  );
  const groundingRay = useMemo(
    () => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
    [rapier],
  );
  const buildSpawnRequest = useCallback((): FireballSpawnRequest => {
    getLookDirection(
      cameraYawRef.current,
      cameraPitchRef.current,
      fireballLaunchDirectionRef.current,
    );

    fireballPlanarDirectionRef.current.set(
      fireballLaunchDirectionRef.current.x,
      0,
      fireballLaunchDirectionRef.current.z,
    );
    if (fireballPlanarDirectionRef.current.lengthSq() < 1e-6) {
      getForwardFromYaw(
        cameraYawRef.current,
        fireballPlanarDirectionRef.current,
      );
    }
    fireballPlanarDirectionRef.current.normalize();

    const translation = bodyTranslationRef.current;
    fireballSpawnPositionRef.current
      .set(
        translation.x,
        translation.y + PLAYER_EYE_HEIGHT_OFFSET * 0.7 + FIREBALL_RADIUS * 0.5,
        translation.z,
      )
      .addScaledVector(
        fireballPlanarDirectionRef.current,
        PLAYER_CAPSULE_RADIUS + FIREBALL_RADIUS + 0.24,
      );

    return {
      originX: fireballSpawnPositionRef.current.x,
      originY: fireballSpawnPositionRef.current.y,
      originZ: fireballSpawnPositionRef.current.z,
      directionX: fireballPlanarDirectionRef.current.x,
      directionY: fireballPlanarDirectionRef.current.y,
      directionZ: fireballPlanarDirectionRef.current.z,
    };
  }, []);
  const castSolidHit = useCallback(
    (
      x: number,
      y: number,
      z: number,
      dirX: number,
      dirY: number,
      dirZ: number,
      distance: number,
    ) => {
      const body = bodyRef.current;
      if (!body) {
        return null;
      }
      const fireballCastOrigin = fireballCastOriginRef.current;
      fireballCastOrigin.x = x;
      fireballCastOrigin.y = y;
      fireballCastOrigin.z = z;

      const fireballCastDirection = fireballCastDirectionRef.current;
      fireballCastDirection.x = dirX;
      fireballCastDirection.y = dirY;
      fireballCastDirection.z = dirZ;

      const hit = world.castShape(
        fireballCastOrigin,
        IDENTITY_ROTATION,
        fireballCastDirection,
        fireballCastShape,
        0,
        distance,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body,
        shouldCollideFireball,
      );
      if (!hit) {
        return null;
      }

      const toiCandidate = hit as {
        time_of_impact?: number;
        timeOfImpact?: number;
      };
      const timeOfImpact =
        toiCandidate.time_of_impact ?? toiCandidate.timeOfImpact;
      return typeof timeOfImpact === "number" ? timeOfImpact : null;
    },
    [fireballCastShape, rapier, world],
  );
  useEffect(() => {
    perspectiveCameraRef.current =
      camera instanceof THREE.PerspectiveCamera ? camera : null;
  }, [camera]);

  useEffect(() => {
    const perspectiveCamera = perspectiveCameraRef.current;
    if (!perspectiveCamera) {
      return;
    }
    const targetFov =
      cameraMode === "first_person"
        ? FIRST_PERSON_CAMERA_FOV
        : THIRD_PERSON_CAMERA_FOV;
    if (perspectiveCamera.fov !== targetFov) {
      perspectiveCamera.fov = targetFov;
      perspectiveCamera.updateProjectionMatrix();
    }
  }, [cameraMode]);

  useControllerInputHandlers({
    camera,
    gl,
    onPointerLockChange,
    isInputSuspendedRef,
    onToggleCameraMode,
    onToggleDefaultGait,
    inputStateRef,
    jumpIntentTimerRef,
    fireballRequestCountRef,
    mobileJumpWasPressedRef,
    isPointerLockedRef,
    activeTouchPointerIdRef,
    activeTouchPositionRef,
    cameraYawRef,
    cameraPitchRef,
  });

  useEffect(() => {
    return () => {
      if (!footstepsAudioActiveRef.current) {
        return;
      }
      footstepsAudioActiveRef.current = false;
      onLocalFootstepsActiveChange?.(false);
    };
  }, [onLocalFootstepsActiveChange]);

  useFrame((_, deltaSeconds) => {
    const body = bodyRef.current;
    const visualRoot = visualRootRef.current;
    if (!body || !visualRoot) {
      return;
    }

    // Resolve authoritative state from ref (preferred, avoids render-time .current) or prop
    const resolvedAuthoritativeState =
      authoritativeLocalPlayerStateRefProp?.current ?? authoritativeLocalPlayerState;

    const dt = Math.min(deltaSeconds, MAX_FRAME_DELTA_SECONDS);
    jumpIntentTimerRef.current = Math.max(0, jumpIntentTimerRef.current - dt);

    const input = inputStateRef.current;
    const mobileMoveInput = mobileMoveInputRef?.current;
    const mobileJumpPressed = mobileJumpPressedRef?.current ?? false;
    const mobileFireballTriggerCount = mobileFireballTriggerRef?.current ?? 0;
    if (mobileJumpPressed && !mobileJumpWasPressedRef.current) {
      jumpIntentTimerRef.current = JUMP_INPUT_BUFFER_SECONDS;
    }
    mobileJumpWasPressedRef.current = mobileJumpPressed;
    if (
      mobileFireballTriggerCount > lastProcessedMobileFireballTriggerRef.current
    ) {
      fireballRequestCountRef.current +=
        mobileFireballTriggerCount -
        lastProcessedMobileFireballTriggerRef.current;
      lastProcessedMobileFireballTriggerRef.current =
        mobileFireballTriggerCount;
    }
    const damageCounter = damageEventCounterRef?.current ?? 0;
    const hasPendingDamageEvent =
      damageCounter > lastProcessedDamageEventCounterRef.current;
    if (hasPendingDamageEvent) {
      lastProcessedDamageEventCounterRef.current = damageCounter;
    }

    const translation = body.translation();
    bodyTranslationRef.current.x = translation.x;
    bodyTranslationRef.current.y = translation.y;
    bodyTranslationRef.current.z = translation.z;
    const goombaHitTimestamps = goombaHitTimestampsRef.current;
    const mysteryBoxHitTimestamps = mysteryBoxHitTimestampsRef.current;
    const estimatedServerNowMs = Date.now() - GOOMBA_PREDICTION_LAG_MS;
    const getPredictedGoombaPose = (
      goomba: NonNullable<typeof goombas>[number],
    ) =>
      writePredictedGoombaPose(
        goomba,
        estimatedServerNowMs,
        predictedGoombaPoseRef.current,
      );
    let nowMs = -1;
    const getNowMs = () => {
      if (nowMs < 0) {
        nowMs = performance.now();
      }
      return nowMs;
    };
    const currentVelocity = body.linvel();
    const verticalSpeedAbs = Math.abs(currentVelocity.y);
    // Track upward-momentum latch for mystery box bonk detection
    if (currentVelocity.y > 0) {
      wasMovingUpRef.current = true;
    } else if (currentVelocity.y < -MYSTERY_BOX_HIT_DOWNWARD_CLEAR_SPEED) {
      wasMovingUpRef.current = false;
    }
    setRayOrigin(groundingRay, translation.x, translation.y, translation.z);
    const groundingHit = world.castRay(
      groundingRay,
      PLAYER_GROUND_CAST_DISTANCE,
      true,
      undefined,
      undefined,
      undefined,
      body,
    );

    const isGroundHit = groundingHit !== null;
    ungroundedTimerRef.current = updateUngroundedTimer(
      isGroundHit,
      ungroundedTimerRef.current,
      dt,
    );
    if (isGroundHit) {
      verticalStillTimerRef.current = 0;
      isInVerticalStillBandRef.current = false;
      groundedRecoveryLatchRef.current = false;
    } else if (isInVerticalStillBandRef.current) {
      if (verticalSpeedAbs > VERTICAL_STILL_EXIT_SPEED_EPS) {
        verticalStillTimerRef.current = 0;
        isInVerticalStillBandRef.current = false;
        groundedRecoveryLatchRef.current = false;
      } else {
        verticalStillTimerRef.current = Math.min(
          VERTICAL_STILL_GROUNDED_RECOVERY_SECONDS,
          verticalStillTimerRef.current + dt,
        );
        if (
          verticalStillTimerRef.current >=
          VERTICAL_STILL_GROUNDED_RECOVERY_SECONDS
        ) {
          groundedRecoveryLatchRef.current = true;
        }
      }
    } else if (verticalSpeedAbs < VERTICAL_STILL_ENTER_SPEED_EPS) {
      isInVerticalStillBandRef.current = true;
      verticalStillTimerRef.current = dt;
    } else {
      verticalStillTimerRef.current = 0;
    }

    const isGroundedStable =
      isGroundedWithinGracePeriod(ungroundedTimerRef.current) ||
      groundedRecoveryLatchRef.current;
    const canConsumeJumpIntent = isGroundedStable;

    const keyboardForwardInput =
      (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const keyboardRightInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const moveForwardInput = THREE.MathUtils.clamp(
      keyboardForwardInput - (mobileMoveInput?.y ?? 0),
      -1,
      1,
    );
    const moveRightInput = THREE.MathUtils.clamp(
      keyboardRightInput + (mobileMoveInput?.x ?? 0),
      -1,
      1,
    );
    const isWalkGait = isWalkDefault ? !input.sprint : input.sprint;

    getForwardFromYaw(cameraYawRef.current, forwardRef.current);
    getRightFromForward(forwardRef.current, rightRef.current);

    moveDirectionRef.current.set(0, 0, 0);
    let moveIntentLengthSquared = 0;
    if (moveForwardInput !== 0 || moveRightInput !== 0) {
      moveDirectionRef.current
        .copy(forwardRef.current)
        .multiplyScalar(moveForwardInput)
        .addScaledVector(rightRef.current, moveRightInput);
      moveIntentLengthSquared = moveDirectionRef.current.lengthSq();
      if (moveIntentLengthSquared > 0) {
        moveDirectionRef.current.normalize();
      }
    }

    const hasMoveIntent = moveIntentLengthSquared > 0;

    const targetSpeed = isWalkGait ? PLAYER_WALK_SPEED : PLAYER_RUN_SPEED;
    const targetVelocityX = hasMoveIntent
      ? moveDirectionRef.current.x * targetSpeed
      : 0;
    const targetVelocityZ = hasMoveIntent
      ? moveDirectionRef.current.z * targetSpeed
      : 0;
    const velocityDeltaX = targetVelocityX - currentVelocity.x;
    const velocityDeltaZ = targetVelocityZ - currentVelocity.z;
    const maxVelocityDelta = PLAYER_ACCELERATION * dt;
    const velocityDeltaMagnitudeSquared =
      velocityDeltaX * velocityDeltaX + velocityDeltaZ * velocityDeltaZ;
    const maxVelocityDeltaSquared = maxVelocityDelta * maxVelocityDelta;
    const velocityDeltaScale =
      velocityDeltaMagnitudeSquared > maxVelocityDeltaSquared &&
      velocityDeltaMagnitudeSquared > 0
        ? maxVelocityDelta / Math.sqrt(velocityDeltaMagnitudeSquared)
        : 1;
    let nextVelocityX = currentVelocity.x + velocityDeltaX * velocityDeltaScale;
    let nextVelocityZ = currentVelocity.z + velocityDeltaZ * velocityDeltaScale;
    if (hasMoveIntent && targetSpeed > 0) {
      const nextPlanarSpeedSquared =
        nextVelocityX * nextVelocityX + nextVelocityZ * nextVelocityZ;
      if (nextPlanarSpeedSquared > targetSpeed * targetSpeed) {
        const planarSpeedScale =
          targetSpeed / Math.sqrt(nextPlanarSpeedSquared);
        nextVelocityX *= planarSpeedScale;
        nextVelocityZ *= planarSpeedScale;
      }
    }
    if (hasPendingDamageEvent) {
      let knockbackDirectionX = 0;
      let knockbackDirectionZ = 0;
      let nearestGoombaDistanceSquared = Infinity;
      if (goombas) {
        for (let index = 0; index < goombas.length; index += 1) {
          const goomba = goombas[index];
          if (goomba.state === GOOMBA_INTERACT_DISABLED_STATE) {
            continue;
          }
          const predictedPose = getPredictedGoombaPose(goomba);
          const dx = translation.x - predictedPose.x;
          const dz = translation.z - predictedPose.z;
          const distanceSquared = dx * dx + dz * dz;
          if (
            distanceSquared >= nearestGoombaDistanceSquared ||
            distanceSquared <= DAMAGE_DIRECTION_EPSILON_SQUARED
          ) {
            continue;
          }
          const inverseDistance = 1 / Math.sqrt(distanceSquared);
          knockbackDirectionX = dx * inverseDistance;
          knockbackDirectionZ = dz * inverseDistance;
          nearestGoombaDistanceSquared = distanceSquared;
        }
      }
      if (
        knockbackDirectionX * knockbackDirectionX +
          knockbackDirectionZ * knockbackDirectionZ <=
        DAMAGE_DIRECTION_EPSILON_SQUARED
      ) {
        knockbackDirectionX = -forwardRef.current.x;
        knockbackDirectionZ = -forwardRef.current.z;
      }
      nextVelocityX = knockbackDirectionX * DAMAGE_KNOCKBACK_HORIZONTAL_SPEED;
      nextVelocityZ = knockbackDirectionZ * DAMAGE_KNOCKBACK_HORIZONTAL_SPEED;
    }

    let didJump = false;
    let nextVelocityY = currentVelocity.y;
    if (jumpIntentTimerRef.current > 0 && canConsumeJumpIntent) {
      didJump = true;
      nextVelocityY = PLAYER_JUMP_VELOCITY;
      jumpIntentTimerRef.current = 0;
      ungroundedTimerRef.current = GROUNDED_GRACE_SECONDS;
      verticalStillTimerRef.current = 0;
      isInVerticalStillBandRef.current = false;
      groundedRecoveryLatchRef.current = false;
    }
    if (didJump) {
      onLocalJump?.();
    }
    if (hasPendingDamageEvent) {
      nextVelocityY = Math.max(
        nextVelocityY,
        DAMAGE_KNOCKBACK_VERTICAL_VELOCITY,
      );
      jumpIntentTimerRef.current = 0;
      ungroundedTimerRef.current = GROUNDED_GRACE_SECONDS;
      verticalStillTimerRef.current = 0;
      isInVerticalStillBandRef.current = false;
      groundedRecoveryLatchRef.current = false;
    }

    const nextLinvel = nextLinvelRef.current;
    nextLinvel.x = nextVelocityX;
    nextLinvel.y = nextVelocityY;
    nextLinvel.z = nextVelocityZ;
    body.setLinvel(nextLinvel, true);

    if (
      goombas &&
      onLocalGoombaHit &&
      nextVelocityY < -GOOMBA_STOMP_MIN_FALL_SPEED
    ) {
      const playerFeetY =
        translation.y - (PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS);
      for (let index = 0; index < goombas.length; index += 1) {
        const goomba = goombas[index];
        if (goomba.state === GOOMBA_INTERACT_DISABLED_STATE) {
          continue;
        }
        const predictedPose = getPredictedGoombaPose(goomba);
        if (
          isGoombaHitOnCooldown(
            goombaHitTimestamps,
            goomba.goombaId,
            getNowMs(),
          )
        ) {
          continue;
        }
        if (playerFeetY < predictedPose.y + 0.08) {
          continue;
        }

        const dx = translation.x - predictedPose.x;
        const dz = translation.z - predictedPose.z;
        if (dx * dx + dz * dz > GOOMBA_STOMP_RADIUS_SQUARED) {
          continue;
        }

        goombaHitTimestamps.set(goomba.goombaId, getNowMs());
        onLocalGoombaHit(goomba.goombaId);
        nextLinvel.x = nextVelocityX;
        nextLinvel.y = Math.max(6, PLAYER_JUMP_VELOCITY * 0.48);
        nextLinvel.z = nextVelocityZ;
        body.setLinvel(nextLinvel, true);
        break;
      }
    }

    // Mystery box bonk detection: upward ray from player head, per-frame poll
    if (mysteryBoxes && onLocalMysteryBoxHit && wasMovingUpRef.current) {
      const playerHeadY =
        translation.y + PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
      for (let index = 0; index < mysteryBoxes.length; index += 1) {
        const mysteryBox = mysteryBoxes[index];
        if (mysteryBox.state === MYSTERY_BOX_INTERACT_DISABLED_STATE) {
          continue;
        }
        // XZ proximity pre-filter
        const dx = translation.x - mysteryBox.x;
        const dz = translation.z - mysteryBox.z;
        if (dx * dx + dz * dz > MYSTERY_BOX_HIT_CLIENT_RADIUS_SQUARED) {
          continue;
        }
        if (isMysteryBoxHitOnCooldown(mysteryBoxHitTimestamps, mysteryBox.mysteryBoxId, getNowMs())) {
          continue;
        }
        // Check if player head is within the ray-length window below the box bottom
        const boxBottomY = mysteryBox.y - MYSTERY_BOX_HALF_EXTENT;
        if (playerHeadY < boxBottomY - MYSTERY_BOX_HEAD_RAY_LENGTH) {
          continue;
        }
        if (playerHeadY > boxBottomY + MYSTERY_BOX_HALF_EXTENT) {
          // Head is above the box bottom — player is inside or above, not bonking
          continue;
        }
        mysteryBoxHitTimestamps.set(mysteryBox.mysteryBoxId, getNowMs());
        onLocalMysteryBoxHit(mysteryBox.mysteryBoxId);
        // Bonk: cancel upward velocity so head doesn't clip through
        nextLinvel.x = nextVelocityX;
        nextLinvel.y = 0;
        nextLinvel.z = nextVelocityZ;
        body.setLinvel(nextLinvel, true);
        wasMovingUpRef.current = false;
        break;
      }
    }

    const planarSpeedSquared =
      nextVelocityX * nextVelocityX + nextVelocityZ * nextVelocityZ;
    const planarSpeed = Math.sqrt(planarSpeedSquared);
    const shouldPlayFootsteps =
      !isInputSuspended &&
      isGroundedStable &&
      hasMoveIntent &&
      planarSpeed > FOOTSTEPS_MIN_PLANAR_SPEED;
    if (shouldPlayFootsteps !== footstepsAudioActiveRef.current) {
      footstepsAudioActiveRef.current = shouldPlayFootsteps;
      onLocalFootstepsActiveChange?.(shouldPlayFootsteps);
    }
    if (planarSpeedSquared > 1e-8) {
      const velocityYaw = Math.atan2(nextVelocityX, -nextVelocityZ);
      characterYawRef.current = normalizeAngle(
        velocityYaw * CHARACTER_CAMERA_YAW_SIGN,
      );
    }

    visualQuaternionRef.current.setFromAxisAngle(
      WORLD_UP,
      characterYawRef.current + CHARACTER_MODEL_YAW_OFFSET,
    );
    visualRoot.quaternion.copy(visualQuaternionRef.current);

    cameraFocusPositionRef.current.set(
      translation.x,
      translation.y + PLAYER_EYE_HEIGHT_OFFSET,
      translation.z,
    );
    thirdPersonOrbitOriginRef.current.set(
      translation.x,
      translation.y + THIRD_PERSON_ORBIT_ORIGIN_HEIGHT_OFFSET,
      translation.z,
    );

    const speedBlend = 1 - Math.exp(-PLANAR_SPEED_SMOOTHING * dt);
    smoothedPlanarSpeedRef.current +=
      (planarSpeed - smoothedPlanarSpeedRef.current) * speedBlend;

    const targetMotionState = resolveTargetMotionState({
      didJump,
      isGroundedStable,
      verticalSpeed: nextVelocityY,
      hasMoveIntent,
      planarSpeed: smoothedPlanarSpeedRef.current,
      isWalkGait,
      previousState: motionStateRef.current,
    });

    if (motionStateRef.current !== targetMotionState) {
      motionStateRef.current = targetMotionState;
    }

    playerPositionRef.current.set(translation.x, translation.y, translation.z);
    onPlayerPositionUpdate?.(translation.x, translation.y, translation.z);

    snapshotAccumulatorSecondsRef.current += dt;
    while (snapshotAccumulatorSecondsRef.current >= SNAPSHOT_INTERVAL_SECONDS) {
      localInputSequenceRef.current += 1;
      onLocalPlayerSnapshot?.({
        x: translation.x,
        y: translation.y,
        z: translation.z,
        yaw: characterYawRef.current,
        pitch: cameraPitchRef.current,
        vx: nextVelocityX,
        vy: nextVelocityY,
        vz: nextVelocityZ,
        planarSpeed: smoothedPlanarSpeedRef.current,
        motionState: motionStateRef.current,
        lastInputSeq: localInputSequenceRef.current,
      });
      snapshotAccumulatorSecondsRef.current -= SNAPSHOT_INTERVAL_SECONDS;
    }

    if (resolvedAuthoritativeState) {
      const dx = resolvedAuthoritativeState.x - translation.x;
      const dy = resolvedAuthoritativeState.y - translation.y;
      const dz = resolvedAuthoritativeState.z - translation.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;

      if (distanceSquared > RECONCILIATION_HARD_DISTANCE_SQUARED) {
        const nextTranslation = reconciliationTranslationRef.current;
        nextTranslation.x = resolvedAuthoritativeState.x;
        nextTranslation.y = resolvedAuthoritativeState.y;
        nextTranslation.z = resolvedAuthoritativeState.z;
        body.setTranslation(nextTranslation, true);
        nextLinvel.x = resolvedAuthoritativeState.vx;
        nextLinvel.y = resolvedAuthoritativeState.vy;
        nextLinvel.z = resolvedAuthoritativeState.vz;
        body.setLinvel(nextLinvel, true);
      } else if (distanceSquared > RECONCILIATION_SOFT_DISTANCE_SQUARED) {
        const correctionBlend = 1 - Math.exp(-10 * dt);
        const nextTranslation = reconciliationTranslationRef.current;
        nextTranslation.x = translation.x + dx * correctionBlend;
        nextTranslation.y = translation.y + dy * correctionBlend;
        nextTranslation.z = translation.z + dz * correctionBlend;
        body.setTranslation(nextTranslation, true);
      }
    }

    const pendingFireballRequests =
      fireballRequestCountRef.current -
      lastProcessedFireballRequestCountRef.current;
    if (pendingFireballRequests > 0) {
      const requestsToProcess = Math.min(
        pendingFireballRequests,
        MAX_LOCAL_FIREBALL_REQUESTS_PER_FRAME,
      );
      enqueueFireballSpawn(activeFireballManager, requestsToProcess);
      for (let index = 0; index < requestsToProcess; index += 1) {
        onLocalFireballCast?.(buildSpawnRequest());
        onLocalShootSound?.();
      }
      fireballCastAnimationCountRef.current += requestsToProcess;
      lastProcessedFireballRequestCountRef.current += requestsToProcess;
    }

    const pendingNetworkSpawns = networkFireballSpawnQueueRef?.current;
    if (pendingNetworkSpawns && pendingNetworkSpawns.length > 0) {
      const readIndex = networkFireballQueueReadIndexRef.current;
      const remaining = pendingNetworkSpawns.length - readIndex;
      if (remaining <= 0) {
        networkFireballQueueReadIndexRef.current = 0;
        clearArray(pendingNetworkSpawns);
      } else {
        const spawnCountToProcess = Math.min(
          remaining,
          MAX_NETWORK_FIREBALL_SPAWNS_PER_FRAME,
        );
        for (let index = 0; index < spawnCountToProcess; index += 1) {
          const spawn = pendingNetworkSpawns[readIndex + index];
          enqueueFireballSpawnRequest(activeFireballManager, spawn);
        }
        const nextReadIndex = readIndex + spawnCountToProcess;
        if (nextReadIndex >= pendingNetworkSpawns.length) {
          networkFireballQueueReadIndexRef.current = 0;
          clearArray(pendingNetworkSpawns);
        } else {
          networkFireballQueueReadIndexRef.current = nextReadIndex;
        }
      }
    }

    stepFireballSimulation(activeFireballManager, {
      deltaSeconds: dt,
      buildSpawnRequest,
      castSolidHit,
      sampleTerrainHeight,
      onAfterSimulateFireballStep: (fireballState) => {
        if (!goombas || !onLocalGoombaHit || fireballState.phase !== "active") {
          return;
        }
        const fireballStartX = fireballState.prevX;
        const fireballStartY = fireballState.prevY;
        const fireballStartZ = fireballState.prevZ;
        const fireballEndX = fireballState.x;
        const fireballEndY = fireballState.y;
        const fireballEndZ = fireballState.z;
        const fireballMinY = Math.min(fireballStartY, fireballEndY);
        const fireballMaxY = Math.max(fireballStartY, fireballEndY);

        for (
          let goombaIndex = 0;
          goombaIndex < goombas.length;
          goombaIndex += 1
        ) {
          const goomba = goombas[goombaIndex];
          if (goomba.state === GOOMBA_INTERACT_DISABLED_STATE) {
            continue;
          }
          const predictedPose = getPredictedGoombaPose(goomba);
          if (
            isGoombaHitOnCooldown(
              goombaHitTimestamps,
              goomba.goombaId,
              getNowMs(),
            )
          ) {
            continue;
          }

          const hitboxBottomY =
            predictedPose.y + GOOMBA_FIREBALL_HITBOX_BASE_OFFSET;
          const hitboxTopY = hitboxBottomY + GOOMBA_FIREBALL_HITBOX_HEIGHT;
          if (fireballMaxY < hitboxBottomY || fireballMinY > hitboxTopY) {
            continue;
          }
          if (
            getPointToSegmentDistanceSquared2D(
              fireballStartX,
              fireballStartZ,
              fireballEndX,
              fireballEndZ,
              predictedPose.x,
              predictedPose.z,
            ) > FIREBALL_GOOMBA_HIT_RADIUS_SQUARED
          ) {
            continue;
          }

          const distanceSquared = getSegmentToSegmentDistanceSquared(
            fireballStartX,
            fireballStartY,
            fireballStartZ,
            fireballEndX,
            fireballEndY,
            fireballEndZ,
            predictedPose.x,
            hitboxBottomY,
            predictedPose.z,
            predictedPose.x,
            hitboxTopY,
            predictedPose.z,
          );
          if (distanceSquared > FIREBALL_GOOMBA_HIT_RADIUS_SQUARED) {
            continue;
          }

          fireballState.isDead = true;
          goombaHitTimestamps.set(goomba.goombaId, getNowMs());
          onLocalGoombaHit(goomba.goombaId);
          break;
        }
      },
    });

    getLookDirection(
      cameraYawRef.current,
      cameraPitchRef.current,
      lookDirectionRef.current,
    );

    if (cameraMode === "first_person") {
      applyFirstPersonCamera(
        camera,
        cameraFocusPositionRef.current,
        lookDirectionRef.current,
        lookTargetRef.current,
      );
      return;
    }

    cameraPivotRef.current.set(
      thirdPersonOrbitOriginRef.current.x,
      thirdPersonOrbitOriginRef.current.y + THIRD_PERSON_PIVOT_HEIGHT_OFFSET,
      thirdPersonOrbitOriginRef.current.z,
    );
    cameraCollisionDirectionRef.current
      .copy(lookDirectionRef.current)
      .multiplyScalar(-1);
    const cameraCollisionOrigin = cameraCollisionOriginRef.current;
    cameraCollisionOrigin.x = cameraPivotRef.current.x;
    cameraCollisionOrigin.y = cameraPivotRef.current.y;
    cameraCollisionOrigin.z = cameraPivotRef.current.z;
    const cameraCollisionCastDirection =
      cameraCollisionCastDirectionRef.current;
    cameraCollisionCastDirection.x = cameraCollisionDirectionRef.current.x;
    cameraCollisionCastDirection.y = cameraCollisionDirectionRef.current.y;
    cameraCollisionCastDirection.z = cameraCollisionDirectionRef.current.z;

    const cameraCollisionHit = world.castShape(
      cameraCollisionOrigin,
      IDENTITY_ROTATION,
      cameraCollisionCastDirection,
      cameraCollisionShape,
      0,
      THIRD_PERSON_CAMERA_DISTANCE,
      true,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      body,
    );

    let resolvedCameraDistance = THIRD_PERSON_CAMERA_DISTANCE;
    if (cameraCollisionHit !== null) {
      resolvedCameraDistance = THREE.MathUtils.clamp(
        cameraCollisionHit.time_of_impact - THIRD_PERSON_CAMERA_COLLISION_SKIN,
        THIRD_PERSON_CAMERA_MIN_DISTANCE,
        THIRD_PERSON_CAMERA_DISTANCE,
      );
    }

    applyThirdPersonCamera(
      camera,
      thirdPersonOrbitOriginRef.current,
      lookDirectionRef.current,
      dt,
      cameraPivotRef.current,
      desiredCameraPositionRef.current,
      lookTargetRef.current,
      resolvedCameraDistance,
    );
  }, -100);

  return (
    <>
      <RigidBody
        ref={bodyRef}
        colliders={false}
        canSleep={false}
        enabledRotations={[false, false, false]}
        linearDamping={PLAYER_LINEAR_DAMPING}
        position={PLAYER_START_POSITION_ARRAY}
        userData={{ kind: "player" }}
      >
        <CapsuleCollider
          args={[PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS]}
          friction={1}
        />
        <group ref={visualRootRef} position={[0, PLAYER_VISUAL_Y_OFFSET, 0]}>
          <CharacterActor
            characterPath={characterPath}
            motionStateRef={motionStateRef}
            planarSpeedRef={smoothedPlanarSpeedRef}
            fireballCastCountRef={fireballCastAnimationCountRef}
            hidden={cameraMode === "first_person"}
          />
        </group>
      </RigidBody>
      <FireballRenderLayer
        renderFrame={activeFireballManager.renderFrame}
        fireballLoops={fireballLoopController ?? NOOP_FIREBALL_LOOPS}
      />
    </>
  );
}
