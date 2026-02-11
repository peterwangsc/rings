"use client";

import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  applyFirstPersonCamera,
  applyThirdPersonCamera,
  updateLookAngles,
} from "../camera/cameraRig";
import {
  CharacterActor,
  type EmoteState,
  type MotionState,
} from "../lib/CharacterActor";
import type {
  CharacterInputState,
  CharacterRigControllerProps,
} from "./controllerTypes";
import {
  CAMERA_MODE_TOGGLE_KEY,
  CHARACTER_CAMERA_YAW_SIGN,
  CHARACTER_MODEL_YAW_OFFSET,
  DEFAULT_INPUT_STATE,
  FIRST_PERSON_CAMERA_FOV,
  GROUNDED_GRACE_SECONDS,
  HAPPY_EMOTE_KEY,
  JUMP_INPUT_BUFFER_SECONDS,
  MAX_FRAME_DELTA_SECONDS,
  PLAYER_ACCELERATION,
  SAD_EMOTE_KEY,
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

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;

export function CharacterRigController({
  cameraMode,
  onToggleCameraMode,
  isWalkDefault,
  onToggleDefaultGait,
  onPointerLockChange,
  onPlayerPositionUpdate,
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
  const emoteRequestRef = useRef<EmoteState | null>(null);
  const activeEmoteRef = useRef<EmoteState | null>(null);
  const motionStateRef = useRef<MotionState>("idle");
  const [actorMotionState, setActorMotionState] = useState<MotionState>("idle");

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
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraCollisionShape = useMemo(
    () => new rapier.Ball(THIRD_PERSON_CAMERA_COLLISION_RADIUS),
    [rapier],
  );
  const handleEmoteFinished = useCallback((emoteState: EmoteState) => {
    if (activeEmoteRef.current === emoteState) {
      activeEmoteRef.current = null;
    }
  }, []);

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

  useEffect(() => {
    const domElement = gl.domElement;
    camera.up.set(0, 1, 0);
    isPointerLockedRef.current = document.pointerLockElement === domElement;
    onPointerLockChange?.(isPointerLockedRef.current);
    const supportsPointerEvents = "PointerEvent" in window;

    const clearActiveTouchPointer = (pointerId?: number) => {
      if (
        pointerId !== undefined &&
        activeTouchPointerIdRef.current !== null &&
        activeTouchPointerIdRef.current !== pointerId
      ) {
        return;
      }
      const resolvedPointerId = pointerId ?? activeTouchPointerIdRef.current;
      if (
        supportsPointerEvents &&
        resolvedPointerId !== null &&
        domElement.hasPointerCapture(resolvedPointerId)
      ) {
        domElement.releasePointerCapture(resolvedPointerId);
      }
      activeTouchPointerIdRef.current = null;
      activeTouchPositionRef.current = null;
    };

    const resetInputState = () => {
      inputStateRef.current = { ...DEFAULT_INPUT_STATE };
      jumpIntentTimerRef.current = 0;
      emoteRequestRef.current = null;
      activeEmoteRef.current = null;
      clearActiveTouchPointer();
    };

    const setInputState = (code: string, isPressed: boolean) => {
      const input = inputStateRef.current;
      switch (code) {
        case "KeyW":
          input.forward = isPressed;
          break;
        case "KeyS":
          input.backward = isPressed;
          break;
        case "KeyA":
          input.left = isPressed;
          break;
        case "KeyD":
          input.right = isPressed;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          input.sprint = isPressed;
          break;
        case "Space":
          input.jump = isPressed;
          break;
        default:
          break;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === CAMERA_MODE_TOGGLE_KEY && !event.repeat) {
        onToggleCameraMode();
        return;
      }

      if (event.code === "CapsLock" && !event.repeat) {
        onToggleDefaultGait();
        return;
      }

      if (event.code === "Space" && !event.repeat) {
        jumpIntentTimerRef.current = JUMP_INPUT_BUFFER_SECONDS;
      }

      if (event.code === HAPPY_EMOTE_KEY && !event.repeat) {
        emoteRequestRef.current = "happy";
        return;
      }

      if (event.code === SAD_EMOTE_KEY && !event.repeat) {
        emoteRequestRef.current = "sad";
        return;
      }

      setInputState(event.code, true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setInputState(event.code, false);
    };

    const handlePointerLockChange = () => {
      isPointerLockedRef.current = document.pointerLockElement === domElement;
      onPointerLockChange?.(isPointerLockedRef.current);
      if (!isPointerLockedRef.current) {
        resetInputState();
      }
    };

    const applyLookDelta = (movementX: number, movementY: number) => {
      const nextAngles = updateLookAngles(
        cameraYawRef.current,
        cameraPitchRef.current,
        movementX,
        movementY,
      );
      cameraYawRef.current = nextAngles.yaw;
      cameraPitchRef.current = nextAngles.pitch;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isPointerLockedRef.current) {
        return;
      }

      applyLookDelta(event.movementX, event.movementY);
    };

    const requestPointerLock = () => {
      if (
        document.pointerLockElement !== domElement &&
        typeof domElement.requestPointerLock === "function"
      ) {
        domElement.requestPointerLock();
      }
    };

    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        event.preventDefault();
        if (activeTouchPointerIdRef.current === null) {
          activeTouchPointerIdRef.current = event.pointerId;
          activeTouchPositionRef.current = {
            x: event.clientX,
            y: event.clientY,
          };
          domElement.setPointerCapture(event.pointerId);
        }
        return;
      }
      if (event.button !== 0) {
        return;
      }
      requestPointerLock();
    };

    const handleCanvasPointerMove = (event: PointerEvent) => {
      if (
        event.pointerType !== "touch" ||
        activeTouchPointerIdRef.current !== event.pointerId ||
        activeTouchPositionRef.current === null
      ) {
        return;
      }

      const movementX = event.clientX - activeTouchPositionRef.current.x;
      const movementY = event.clientY - activeTouchPositionRef.current.y;
      activeTouchPositionRef.current.x = event.clientX;
      activeTouchPositionRef.current.y = event.clientY;

      if (movementX === 0 && movementY === 0) {
        return;
      }

      event.preventDefault();
      applyLookDelta(movementX, movementY);
    };

    const handleCanvasTouchPointerEnd = (event: PointerEvent) => {
      clearActiveTouchPointer(event.pointerId);
    };

    const handleCanvasLostPointerCapture = (event: PointerEvent) => {
      clearActiveTouchPointer(event.pointerId);
    };

    const findTouchByIdentifier = (touchList: TouchList, identifier: number) => {
      for (let index = 0; index < touchList.length; index += 1) {
        const touch = touchList.item(index);
        if (touch?.identifier === identifier) {
          return touch;
        }
      }
      return null;
    };

    const handleCanvasTouchStart = (event: TouchEvent) => {
      if (activeTouchPointerIdRef.current !== null) {
        return;
      }
      const touch = event.changedTouches.item(0);
      if (!touch) {
        return;
      }
      activeTouchPointerIdRef.current = touch.identifier;
      activeTouchPositionRef.current = { x: touch.clientX, y: touch.clientY };
      event.preventDefault();
    };

    const handleCanvasTouchMove = (event: TouchEvent) => {
      if (
        activeTouchPointerIdRef.current === null ||
        activeTouchPositionRef.current === null
      ) {
        return;
      }
      const touch =
        findTouchByIdentifier(event.touches, activeTouchPointerIdRef.current) ??
        findTouchByIdentifier(
          event.changedTouches,
          activeTouchPointerIdRef.current,
        );
      if (!touch) {
        return;
      }
      const movementX = touch.clientX - activeTouchPositionRef.current.x;
      const movementY = touch.clientY - activeTouchPositionRef.current.y;
      activeTouchPositionRef.current.x = touch.clientX;
      activeTouchPositionRef.current.y = touch.clientY;
      if (movementX === 0 && movementY === 0) {
        return;
      }
      event.preventDefault();
      applyLookDelta(movementX, movementY);
    };

    const handleCanvasTouchEndOrCancel = (event: TouchEvent) => {
      if (activeTouchPointerIdRef.current === null) {
        return;
      }
      const touch = findTouchByIdentifier(
        event.changedTouches,
        activeTouchPointerIdRef.current,
      );
      if (!touch) {
        return;
      }
      clearActiveTouchPointer();
    };

    if (supportsPointerEvents) {
      domElement.addEventListener("pointerdown", handleCanvasPointerDown);
      domElement.addEventListener("pointermove", handleCanvasPointerMove);
      domElement.addEventListener("pointerup", handleCanvasTouchPointerEnd);
      domElement.addEventListener(
        "pointercancel",
        handleCanvasTouchPointerEnd,
      );
      domElement.addEventListener(
        "lostpointercapture",
        handleCanvasLostPointerCapture,
      );
    } else {
      domElement.addEventListener("click", requestPointerLock);
      domElement.addEventListener("touchstart", handleCanvasTouchStart, {
        passive: false,
      });
      domElement.addEventListener("touchmove", handleCanvasTouchMove, {
        passive: false,
      });
      domElement.addEventListener("touchend", handleCanvasTouchEndOrCancel);
      domElement.addEventListener(
        "touchcancel",
        handleCanvasTouchEndOrCancel,
      );
    }
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetInputState);

    return () => {
      if (supportsPointerEvents) {
        domElement.removeEventListener("pointerdown", handleCanvasPointerDown);
        domElement.removeEventListener("pointermove", handleCanvasPointerMove);
        domElement.removeEventListener(
          "pointerup",
          handleCanvasTouchPointerEnd,
        );
        domElement.removeEventListener(
          "pointercancel",
          handleCanvasTouchPointerEnd,
        );
        domElement.removeEventListener(
          "lostpointercapture",
          handleCanvasLostPointerCapture,
        );
      } else {
        domElement.removeEventListener("click", requestPointerLock);
        domElement.removeEventListener("touchstart", handleCanvasTouchStart);
        domElement.removeEventListener("touchmove", handleCanvasTouchMove);
        domElement.removeEventListener("touchend", handleCanvasTouchEndOrCancel);
        domElement.removeEventListener(
          "touchcancel",
          handleCanvasTouchEndOrCancel,
        );
      }
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", resetInputState);
      isPointerLockedRef.current = false;
      onPointerLockChange?.(false);
      resetInputState();
    };
  }, [camera, gl, onPointerLockChange, onToggleCameraMode, onToggleDefaultGait]);

  useFrame((_, deltaSeconds) => {
    const body = bodyRef.current;
    const visualRoot = visualRootRef.current;
    if (!body || !visualRoot) {
      return;
    }

    const dt = Math.min(deltaSeconds, MAX_FRAME_DELTA_SECONDS);
    jumpIntentTimerRef.current = Math.max(0, jumpIntentTimerRef.current - dt);

    const input = inputStateRef.current;
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

    const moveForwardInput = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const moveRightInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
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

    const shouldInterruptActiveEmote =
      activeEmoteRef.current !== null &&
      (!isGroundedStable || hasMoveIntent || didJump);
    if (shouldInterruptActiveEmote) {
      activeEmoteRef.current = null;
    }

    const canPlayEmote = isGroundedStable && !hasMoveIntent && !didJump;
    if (!activeEmoteRef.current && emoteRequestRef.current && canPlayEmote) {
      activeEmoteRef.current = emoteRequestRef.current;
      emoteRequestRef.current = null;
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

    let targetMotionState = resolveTargetMotionState({
      didJump,
      isGroundedStable,
      verticalSpeed: nextVelocityY,
      hasMoveIntent,
      planarSpeed: smoothedPlanarSpeedRef.current,
      isWalkGait,
      previousState: motionStateRef.current,
    });

    if (activeEmoteRef.current && canPlayEmote) {
      targetMotionState = activeEmoteRef.current;
    }

    setMotionStateIfChanged(targetMotionState, motionStateRef, setActorMotionState);

    playerPositionRef.current.set(translation.x, translation.y, translation.z);
    onPlayerPositionUpdate?.(translation.x, translation.y, translation.z);

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
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      canSleep={false}
      enabledRotations={[false, false, false]}
      linearDamping={PLAYER_LINEAR_DAMPING}
      position={PLAYER_START_POSITION.toArray()}
    >
      <CapsuleCollider
        args={[PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS]}
        friction={1}
      />
      <group ref={visualRootRef} position={[0, PLAYER_VISUAL_Y_OFFSET, 0]}>
        <CharacterActor
          motionState={actorMotionState}
          onEmoteFinished={handleEmoteFinished}
          hidden={cameraMode === "first_person"}
        />
      </group>
    </RigidBody>
  );
}
