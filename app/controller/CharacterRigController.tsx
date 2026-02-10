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
}: CharacterRigControllerProps) {
  const { camera, gl } = useThree();
  const { rapier, world } = useRapier();

  const bodyRef = useRef<RapierRigidBody | null>(null);
  const visualRootRef = useRef<THREE.Group>(null);
  const inputStateRef = useRef<CharacterInputState>({ ...DEFAULT_INPUT_STATE });
  const jumpIntentTimerRef = useRef(0);
  const ungroundedTimerRef = useRef(0);
  const isPointerLockedRef = useRef(false);
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
    camera.up.set(0, 1, 0);
    isPointerLockedRef.current = document.pointerLockElement === gl.domElement;
    onPointerLockChange?.(isPointerLockedRef.current);

    const resetInputState = () => {
      inputStateRef.current = { ...DEFAULT_INPUT_STATE };
      jumpIntentTimerRef.current = 0;
      emoteRequestRef.current = null;
      activeEmoteRef.current = null;
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
      isPointerLockedRef.current = document.pointerLockElement === gl.domElement;
      onPointerLockChange?.(isPointerLockedRef.current);
      if (!isPointerLockedRef.current) {
        resetInputState();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isPointerLockedRef.current) {
        return;
      }

      const nextAngles = updateLookAngles(
        cameraYawRef.current,
        cameraPitchRef.current,
        event.movementX,
        event.movementY,
      );
      cameraYawRef.current = nextAngles.yaw;
      cameraPitchRef.current = nextAngles.pitch;
    };

    const requestPointerLock = () => {
      if (document.pointerLockElement !== gl.domElement) {
        gl.domElement.requestPointerLock();
      }
    };

    gl.domElement.addEventListener("click", requestPointerLock);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetInputState);

    return () => {
      gl.domElement.removeEventListener("click", requestPointerLock);
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
    const isGroundedStable = isGroundedWithinGracePeriod(
      ungroundedTimerRef.current,
    );
    const canConsumeJumpIntent = isGroundedStable;

    const moveForward = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const moveRight = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const hasMoveIntent = moveForward !== 0 || moveRight !== 0;
    const isWalkGait = isWalkDefault ? !input.sprint : input.sprint;

    getForwardFromYaw(cameraYawRef.current, forwardRef.current);
    getRightFromForward(forwardRef.current, rightRef.current);

    moveDirectionRef.current.set(0, 0, 0);
    if (hasMoveIntent) {
      moveDirectionRef.current
        .copy(forwardRef.current)
        .multiplyScalar(moveForward)
        .addScaledVector(rightRef.current, moveRight)
        .normalize();
    }

    const currentVelocity = body.linvel();
    const targetSpeed = isWalkGait ? PLAYER_WALK_SPEED : PLAYER_RUN_SPEED;
    const targetVelocityX = moveDirectionRef.current.x * targetSpeed;
    const targetVelocityZ = moveDirectionRef.current.z * targetSpeed;
    const velocityBlend = 1 - Math.exp(-PLAYER_ACCELERATION * dt);

    const nextVelocityX = THREE.MathUtils.lerp(
      currentVelocity.x,
      targetVelocityX,
      velocityBlend,
    );
    const nextVelocityZ = THREE.MathUtils.lerp(
      currentVelocity.z,
      targetVelocityZ,
      velocityBlend,
    );

    let didJump = false;
    let nextVelocityY = currentVelocity.y;
    if (jumpIntentTimerRef.current > 0 && canConsumeJumpIntent) {
      didJump = true;
      nextVelocityY = PLAYER_JUMP_VELOCITY;
      jumpIntentTimerRef.current = 0;
      ungroundedTimerRef.current = GROUNDED_GRACE_SECONDS;
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

    if (cameraMode === "third_person_free_look") {
      if (hasMoveIntent) {
        const movementYaw = Math.atan2(
          moveDirectionRef.current.x,
          -moveDirectionRef.current.z,
        );
        characterYawRef.current = normalizeAngle(
          movementYaw * CHARACTER_CAMERA_YAW_SIGN,
        );
      }
    } else {
      characterYawRef.current = normalizeAngle(
        cameraYawRef.current * CHARACTER_CAMERA_YAW_SIGN,
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
