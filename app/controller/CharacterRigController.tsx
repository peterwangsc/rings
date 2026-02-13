"use client";

import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  applyFirstPersonCamera,
  applyThirdPersonCamera,
} from "../camera/cameraRig";
import { FireballRenderLayer } from "../gameplay/abilities/FireballRenderLayer";
import {
  buildFireballRenderFrame,
  createFireballManager,
  enqueueFireballSpawn,
  stepFireballSimulation,
} from "../gameplay/abilities/fireballManager";
import type {
  FireballCastQuery,
  FireballSpawnRequest,
} from "../gameplay/abilities/fireballTypes";
import { CharacterActor, type MotionState } from "../lib/CharacterActor";
import type {
  CharacterInputState,
  CharacterRigControllerProps,
} from "./controllerTypes";
import {
  CHARACTER_CAMERA_YAW_SIGN,
  CHARACTER_MODEL_YAW_OFFSET,
  DEFAULT_INPUT_STATE,
  FIRST_PERSON_CAMERA_FOV,
  FIREBALL_MAX_ACTIVE_COUNT,
  FIREBALL_RADIUS,
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
  setMotionStateIfChanged,
  updateUngroundedTimer,
} from "../utils/physics";
import { sampleTerrainHeight } from "../utils/terrain";
import { useControllerInputHandlers } from "./useControllerInputHandlers";

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;

export function CharacterRigController({
  cameraMode,
  onToggleCameraMode,
  isWalkDefault,
  onToggleDefaultGait,
  onPointerLockChange,
  onPlayerPositionUpdate,
  mobileMoveInputRef,
  mobileJumpPressedRef,
  mobileFireballTriggerRef,
  fireballManager,
}: CharacterRigControllerProps) {
  const { camera, gl } = useThree();
  const { rapier, world } = useRapier();

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
  const cameraYawRef = useRef(0);
  const cameraPitchRef = useRef(0);
  const characterYawRef = useRef(0);
  const smoothedPlanarSpeedRef = useRef(0);
  const mobileJumpWasPressedRef = useRef(false);
  const fireballRequestCountRef = useRef(0);
  const lastProcessedFireballRequestCountRef = useRef(0);
  const lastProcessedMobileFireballTriggerRef = useRef(0);
  const motionStateRef = useRef<MotionState>("idle");
  const [actorMotionState, setActorMotionState] = useState<MotionState>("idle");
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
  const fireballLaunchDirectionRef = useRef(new THREE.Vector3());
  const fireballPlanarDirectionRef = useRef(new THREE.Vector3());
  const fireballSpawnPositionRef = useRef(new THREE.Vector3());
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraCollisionShape = useMemo(
    () => new rapier.Ball(THIRD_PERSON_CAMERA_COLLISION_RADIUS),
    [rapier],
  );
  const fireballCastShape = useMemo(() => new rapier.Ball(FIREBALL_RADIUS), [rapier]);

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
      cameraMode === "first_person" ? FIRST_PERSON_CAMERA_FOV : THIRD_PERSON_CAMERA_FOV;
    if (perspectiveCamera.fov !== targetFov) {
      perspectiveCamera.fov = targetFov;
      perspectiveCamera.updateProjectionMatrix();
    }
  }, [cameraMode]);

  useControllerInputHandlers({
    camera,
    gl,
    onPointerLockChange,
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

  useFrame((_, deltaSeconds) => {
    const body = bodyRef.current;
    const visualRoot = visualRootRef.current;
    if (!body || !visualRoot) {
      return;
    }

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
    if (mobileFireballTriggerCount > lastProcessedMobileFireballTriggerRef.current) {
      fireballRequestCountRef.current +=
        mobileFireballTriggerCount - lastProcessedMobileFireballTriggerRef.current;
      lastProcessedMobileFireballTriggerRef.current = mobileFireballTriggerCount;
    }

    const pendingFireballRequests =
      fireballRequestCountRef.current - lastProcessedFireballRequestCountRef.current;
    if (pendingFireballRequests > 0) {
      enqueueFireballSpawn(activeFireballManager, pendingFireballRequests);
      lastProcessedFireballRequestCountRef.current += pendingFireballRequests;
    }

    const translation = body.translation();
    const currentVelocity = body.linvel();
    const verticalSpeedAbs = Math.abs(currentVelocity.y);
    const groundingRay = new rapier.Ray(
      { x: translation.x, y: translation.y, z: translation.z },
      { x: 0, y: -1, z: 0 },
    );
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

    const keyboardForwardInput = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
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
    if (moveForwardInput !== 0 || moveRightInput !== 0) {
      moveDirectionRef.current
        .copy(forwardRef.current)
        .multiplyScalar(moveForwardInput)
        .addScaledVector(rightRef.current, moveRightInput);
      if (moveDirectionRef.current.lengthSq() > 0) {
        moveDirectionRef.current.normalize();
      }
    }

    const hasMoveIntent = moveDirectionRef.current.lengthSq() > 0;

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
    const velocityDeltaMagnitude = Math.hypot(velocityDeltaX, velocityDeltaZ);
    const velocityDeltaScale =
      velocityDeltaMagnitude > maxVelocityDelta && velocityDeltaMagnitude > 0
        ? maxVelocityDelta / velocityDeltaMagnitude
        : 1;
    let nextVelocityX = currentVelocity.x + velocityDeltaX * velocityDeltaScale;
    let nextVelocityZ = currentVelocity.z + velocityDeltaZ * velocityDeltaScale;
    if (hasMoveIntent && targetSpeed > 0) {
      const nextPlanarSpeed = Math.hypot(nextVelocityX, nextVelocityZ);
      if (nextPlanarSpeed > targetSpeed) {
        const planarSpeedScale = targetSpeed / nextPlanarSpeed;
        nextVelocityX *= planarSpeedScale;
        nextVelocityZ *= planarSpeedScale;
      }
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

    body.setLinvel(
      { x: nextVelocityX, y: nextVelocityY, z: nextVelocityZ },
      true,
    );

    const planarVelocityMagnitude = Math.hypot(nextVelocityX, nextVelocityZ);
    if (planarVelocityMagnitude > 1e-4) {
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
    visualRoot.position.set(0, PLAYER_VISUAL_Y_OFFSET, 0);

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

    const planarSpeed = Math.hypot(nextVelocityX, nextVelocityZ);
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

    setMotionStateIfChanged(targetMotionState, motionStateRef, setActorMotionState);

    playerPositionRef.current.set(translation.x, translation.y, translation.z);
    onPlayerPositionUpdate?.(translation.x, translation.y, translation.z);

    const buildSpawnRequest = (): FireballSpawnRequest => {
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
        getForwardFromYaw(cameraYawRef.current, fireballPlanarDirectionRef.current);
      }
      fireballPlanarDirectionRef.current.normalize();

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
    };

    const castSolidHit = (query: FireballCastQuery) => {
      const hit = world.castShape(
        { x: query.x, y: query.y, z: query.z },
        IDENTITY_ROTATION,
        { x: query.dirX, y: query.dirY, z: query.dirZ },
        fireballCastShape,
        0,
        query.distance,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body,
        (collider) => {
          const parentBody = collider.parent();
          const userData = parentBody?.userData as
            | { kind?: string }
            | undefined;
          return userData?.kind !== "terrain";
        },
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
    };

    stepFireballSimulation(activeFireballManager, {
      deltaSeconds: dt,
      buildSpawnRequest,
      castSolidHit,
      sampleTerrainHeight,
    });
    buildFireballRenderFrame(activeFireballManager);

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

    const cameraCollisionHit = world.castShape(
      {
        x: cameraPivotRef.current.x,
        y: cameraPivotRef.current.y,
        z: cameraPivotRef.current.z,
      },
      IDENTITY_ROTATION,
      {
        x: cameraCollisionDirectionRef.current.x,
        y: cameraCollisionDirectionRef.current.y,
        z: cameraCollisionDirectionRef.current.z,
      },
      cameraCollisionShape,
      0,
      THIRD_PERSON_CAMERA_DISTANCE,
      true,
      undefined,
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
        position={PLAYER_START_POSITION.toArray()}
        userData={{ kind: "player" }}
      >
        <CapsuleCollider
          args={[PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS]}
          friction={1}
        />
        <group ref={visualRootRef} position={[0, PLAYER_VISUAL_Y_OFFSET, 0]}>
          <CharacterActor
            motionState={actorMotionState}
            planarSpeedRef={smoothedPlanarSpeedRef}
            hidden={cameraMode === "first_person"}
          />
        </group>
      </RigidBody>
      <FireballRenderLayer renderFrame={activeFireballManager.renderFrame} />
    </>
  );
}
