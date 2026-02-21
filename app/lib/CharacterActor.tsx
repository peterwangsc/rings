"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CHARACTER_PATH,
  DEFAULT_CHARACTER_TARGET_HEIGHT,
  DEFAULT_FADE_IN_SECONDS,
  FIREBALL_THROW_ATTACK_PORTION,
  FIREBALL_THROW_DURATION_SECONDS,
  FIREBALL_THROW_FOREARM_BLEND,
  FIREBALL_THROW_UPPER_ARM_BLEND,
  HAPPY_TIME_SCALE,
  JUMP_AIR_TIME_SECONDS,
  JUMP_RUNNING_TIME_SCALE,
  JUMP_TIME_SCALE,
  MIN_DELTA_SECONDS,
  RUN_ANIM_REFERENCE_SPEED,
  RUNNING_TIME_SCALE,
  SAD_TIME_SCALE,
  STATE_BLEND_DURATION_SECONDS,
  WALK_ANIM_REFERENCE_SPEED,
  WALK_TIME_SCALE,
} from "../utils/constants";
import {
  findClipByName,
  prepareCharacter,
  resolveMotionAction,
  stripRootMotionTracks,
} from "./characterAnimation";
import type {
  CharacterActorProps,
  MotionActionMap,
  MotionState,
} from "./characterTypes";

export type { EmoteState, MotionState } from "./characterTypes";

const CLIP_IDLE = "Idle";
const CLIP_WALK = "Walk";
const CLIP_RUNNING = "Running";
const CLIP_JUMP_RUN = "Jump-Run";
const CLIP_HAPPY = "Happy";
const CLIP_SAD = "Sad";
const RIGHT_ARM_BONE_NAME_CANDIDATES = [
  "mixamorigRightArm",
  "mixamorig:RightArm",
] as const;
const RIGHT_FOREARM_BONE_NAME_CANDIDATES = [
  "mixamorigRightForeArm",
  "mixamorig:RightForeArm",
] as const;
const RIGHT_HAND_BONE_NAME_CANDIDATES = [
  "mixamorigRightHand",
  "mixamorig:RightHand",
] as const;
const LEFT_ARM_BONE_NAME_CANDIDATES = [
  "mixamorigLeftArm",
  "mixamorig:LeftArm",
] as const;
const LEFT_FOREARM_BONE_NAME_CANDIDATES = [
  "mixamorigLeftForeArm",
  "mixamorig:LeftForeArm",
] as const;
const LEFT_UPPER_LEG_BONE_NAME_CANDIDATES = [
  "mixamorigLeftUpLeg",
  "mixamorig:LeftUpLeg",
] as const;
const RIGHT_UPPER_LEG_BONE_NAME_CANDIDATES = [
  "mixamorigRightUpLeg",
  "mixamorig:RightUpLeg",
] as const;
const LEFT_LEG_BONE_NAME_CANDIDATES = [
  "mixamorigLeftLeg",
  "mixamorig:LeftLeg",
] as const;
const RIGHT_LEG_BONE_NAME_CANDIDATES = [
  "mixamorigRightLeg",
  "mixamorig:RightLeg",
] as const;
const SPINE_BONE_NAME_CANDIDATES = [
  "mixamorigSpine",
  "mixamorig:Spine",
] as const;

const FIREBALL_THROW_UPPER_ARM_FORWARD_WEIGHT = 0.88;
const FIREBALL_THROW_UPPER_ARM_UP_WEIGHT = 0.62;
const FIREBALL_THROW_FOREARM_FORWARD_WEIGHT = 1.0;
const FIREBALL_THROW_FOREARM_UP_WEIGHT = 0.3;
const MOUNTED_POSE_SPINE_X = 0.24;
const MOUNTED_POSE_ARM_X = 0.78;
const MOUNTED_POSE_FOREARM_X = 0.62;
const MOUNTED_POSE_UPPER_LEG_X = 0.92;
const MOUNTED_POSE_LEG_X = -1.12;

interface DirectionalBoneOverlayScratch {
  readonly startPosition: THREE.Vector3;
  readonly endPosition: THREE.Vector3;
  readonly currentDirection: THREE.Vector3;
  readonly desiredDirection: THREE.Vector3;
  readonly bodyForwardDirection: THREE.Vector3;
  readonly bodyUpDirection: THREE.Vector3;
  readonly upperArmThrowDirection: THREE.Vector3;
  readonly foreArmThrowDirection: THREE.Vector3;
  readonly characterWorldQuaternion: THREE.Quaternion;
  readonly aimQuaternion: THREE.Quaternion;
  readonly weightedAimQuaternion: THREE.Quaternion;
  readonly boneWorldQuaternion: THREE.Quaternion;
  readonly targetWorldQuaternion: THREE.Quaternion;
  readonly parentWorldQuaternion: THREE.Quaternion;
  readonly targetLocalQuaternion: THREE.Quaternion;
  readonly localDeltaQuaternion: THREE.Quaternion;
  readonly identityQuaternion: THREE.Quaternion;
}

function findBoneByNameCandidates(
  root: THREE.Object3D,
  candidates: readonly string[],
): THREE.Bone | null {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const object = root.getObjectByName(candidate);
    if (object instanceof THREE.Bone) {
      return object;
    }
  }
  return null;
}

function cacheBoneRestQuaternion(
  restQuaternions: Map<string, THREE.Quaternion>,
  bone: THREE.Bone | null,
) {
  if (!bone) {
    return;
  }
  restQuaternions.set(bone.uuid, bone.quaternion.clone());
}

function applyMountedPoseToBone(
  bone: THREE.Bone | null,
  restQuaternions: Map<string, THREE.Quaternion>,
  deltaX: number,
  blend: number,
  scratchEuler: THREE.Euler,
  scratchDeltaQuaternion: THREE.Quaternion,
  scratchTargetQuaternion: THREE.Quaternion,
) {
  if (!bone || blend <= MIN_DELTA_SECONDS) {
    return;
  }
  const restQuaternion = restQuaternions.get(bone.uuid);
  if (!restQuaternion) {
    return;
  }
  scratchEuler.set(deltaX, 0, 0, "XYZ");
  scratchDeltaQuaternion.setFromEuler(scratchEuler);
  scratchTargetQuaternion.copy(restQuaternion).multiply(scratchDeltaQuaternion);
  bone.quaternion.slerp(scratchTargetQuaternion, THREE.MathUtils.clamp(blend, 0, 1));
}

function computeDirectionalBoneDelta({
  bone,
  childBone,
  targetWorldDirection,
  blend,
  outputDelta,
  scratch,
}: {
  readonly bone: THREE.Bone;
  readonly childBone: THREE.Bone;
  readonly targetWorldDirection: THREE.Vector3;
  readonly blend: number;
  readonly outputDelta: THREE.Quaternion;
  readonly scratch: DirectionalBoneOverlayScratch;
}): boolean {
  if (blend <= MIN_DELTA_SECONDS) {
    return false;
  }

  bone.getWorldPosition(scratch.startPosition);
  childBone.getWorldPosition(scratch.endPosition);
  scratch.currentDirection.subVectors(scratch.endPosition, scratch.startPosition);
  const currentDirectionLengthSquared = scratch.currentDirection.lengthSq();
  if (currentDirectionLengthSquared <= MIN_DELTA_SECONDS) {
    return false;
  }
  scratch.currentDirection.multiplyScalar(
    1 / Math.sqrt(currentDirectionLengthSquared),
  );

  scratch.desiredDirection.copy(targetWorldDirection);
  const desiredDirectionLengthSquared = scratch.desiredDirection.lengthSq();
  if (desiredDirectionLengthSquared <= MIN_DELTA_SECONDS) {
    return false;
  }
  scratch.desiredDirection.multiplyScalar(
    1 / Math.sqrt(desiredDirectionLengthSquared),
  );

  scratch.aimQuaternion.setFromUnitVectors(
    scratch.currentDirection,
    scratch.desiredDirection,
  );
  scratch.weightedAimQuaternion
    .copy(scratch.identityQuaternion)
    .slerp(scratch.aimQuaternion, THREE.MathUtils.clamp(blend, 0, 1));

  bone.getWorldQuaternion(scratch.boneWorldQuaternion);
  scratch.targetWorldQuaternion
    .copy(scratch.weightedAimQuaternion)
    .multiply(scratch.boneWorldQuaternion);

  if (bone.parent) {
    bone.parent.getWorldQuaternion(scratch.parentWorldQuaternion);
  } else {
    scratch.parentWorldQuaternion.copy(scratch.identityQuaternion);
  }

  scratch.targetLocalQuaternion
    .copy(scratch.parentWorldQuaternion)
    .invert()
    .multiply(scratch.targetWorldQuaternion);
  scratch.localDeltaQuaternion
    .copy(bone.quaternion)
    .invert()
    .multiply(scratch.targetLocalQuaternion)
    .normalize();

  outputDelta
    .copy(scratch.identityQuaternion)
    .slerp(
      scratch.localDeltaQuaternion,
      THREE.MathUtils.clamp(blend, 0, 1),
    )
    .normalize();
  return true;
}

function createQuaternionThrowTrackValues(delta: THREE.Quaternion): number[] {
  return [
    0,
    0,
    0,
    1,
    delta.x,
    delta.y,
    delta.z,
    delta.w,
    0,
    0,
    0,
    1,
  ];
}

function createFireballThrowClip({
  upperArmBone,
  upperArmDelta,
  foreArmBone,
  foreArmDelta,
}: {
  readonly upperArmBone: THREE.Bone;
  readonly upperArmDelta: THREE.Quaternion;
  readonly foreArmBone: THREE.Bone | null;
  readonly foreArmDelta: THREE.Quaternion | null;
}): THREE.AnimationClip {
  const attackTime = THREE.MathUtils.clamp(
    FIREBALL_THROW_DURATION_SECONDS * FIREBALL_THROW_ATTACK_PORTION,
    MIN_DELTA_SECONDS,
    FIREBALL_THROW_DURATION_SECONDS - MIN_DELTA_SECONDS,
  );
  const times = [0, attackTime, FIREBALL_THROW_DURATION_SECONDS];
  const tracks: THREE.KeyframeTrack[] = [
    new THREE.QuaternionKeyframeTrack(
      `${upperArmBone.uuid}.quaternion`,
      times,
      createQuaternionThrowTrackValues(upperArmDelta),
    ),
  ];

  if (foreArmBone && foreArmDelta) {
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${foreArmBone.uuid}.quaternion`,
        times,
        createQuaternionThrowTrackValues(foreArmDelta),
      ),
    );
  }

  return new THREE.AnimationClip(
    "FireballThrowOverlay",
    FIREBALL_THROW_DURATION_SECONDS,
    tracks,
    THREE.AdditiveAnimationBlendMode,
  );
}

export function CharacterActor({
  motionState = "idle",
  motionStateRef,
  planarSpeedRef,
  fireballCastCountRef,
  mountedPoseBlendRef,
  targetHeight = DEFAULT_CHARACTER_TARGET_HEIGHT,
  hidden = false,
  onEmoteFinished,
}: CharacterActorProps) {
  const gltf = useGLTF(CHARACTER_PATH);

  const character = useMemo(
    () => prepareCharacter(gltf.scene, gltf.animations, targetHeight),
    [gltf.scene, gltf.animations, targetHeight],
  );

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<MotionActionMap>({
    idle: null,
    walk: null,
    running: null,
    jump: null,
    jump_running: null,
    happy: null,
    sad: null,
  });
  const activeStateRef = useRef<MotionState>(motionState);
  const rightArmBoneRef = useRef<THREE.Bone | null>(null);
  const leftArmBoneRef = useRef<THREE.Bone | null>(null);
  const rightForeArmBoneRef = useRef<THREE.Bone | null>(null);
  const leftForeArmBoneRef = useRef<THREE.Bone | null>(null);
  const rightHandBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const leftUpperLegBoneRef = useRef<THREE.Bone | null>(null);
  const rightUpperLegBoneRef = useRef<THREE.Bone | null>(null);
  const leftLegBoneRef = useRef<THREE.Bone | null>(null);
  const rightLegBoneRef = useRef<THREE.Bone | null>(null);
  const mountedPoseRestQuaternionsRef = useRef<Map<string, THREE.Quaternion>>(
    new Map(),
  );
  const mountedPoseEulerRef = useRef(new THREE.Euler());
  const mountedPoseDeltaQuaternionRef = useRef(new THREE.Quaternion());
  const mountedPoseTargetQuaternionRef = useRef(new THREE.Quaternion());
  const fireballThrowActionRef = useRef<THREE.AnimationAction | null>(null);
  const fireballThrowClipRef = useRef<THREE.AnimationClip | null>(null);
  const fireballThrowUpperArmDeltaRef = useRef(new THREE.Quaternion());
  const fireballThrowForeArmDeltaRef = useRef(new THREE.Quaternion());
  const lastProcessedFireballCastCountRef = useRef(0);
  const fireballThrowOverlayScratchRef = useRef<DirectionalBoneOverlayScratch>({
    startPosition: new THREE.Vector3(),
    endPosition: new THREE.Vector3(),
    currentDirection: new THREE.Vector3(),
    desiredDirection: new THREE.Vector3(),
    bodyForwardDirection: new THREE.Vector3(),
    bodyUpDirection: new THREE.Vector3(),
    upperArmThrowDirection: new THREE.Vector3(),
    foreArmThrowDirection: new THREE.Vector3(),
    characterWorldQuaternion: new THREE.Quaternion(),
    aimQuaternion: new THREE.Quaternion(),
    weightedAimQuaternion: new THREE.Quaternion(),
    boneWorldQuaternion: new THREE.Quaternion(),
    targetWorldQuaternion: new THREE.Quaternion(),
    parentWorldQuaternion: new THREE.Quaternion(),
    targetLocalQuaternion: new THREE.Quaternion(),
    localDeltaQuaternion: new THREE.Quaternion(),
    identityQuaternion: new THREE.Quaternion(),
  });

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(character);

    const idleClip = findClipByName(character.animations, CLIP_IDLE);
    const walkClip = findClipByName(character.animations, CLIP_WALK);
    const runningClip = findClipByName(character.animations, CLIP_RUNNING);
    const jumpActionClip = findClipByName(character.animations, CLIP_JUMP_RUN);
    const jumpRunningClip = findClipByName(character.animations, CLIP_JUMP_RUN);
    const happyClip = findClipByName(character.animations, CLIP_HAPPY);
    const sadClip = findClipByName(character.animations, CLIP_SAD);

    const idleAction = idleClip
      ? mixer.clipAction(stripRootMotionTracks(idleClip))
      : null;
    const walkAction = walkClip
      ? mixer.clipAction(stripRootMotionTracks(walkClip))
      : null;
    const runningAction = runningClip
      ? mixer.clipAction(stripRootMotionTracks(runningClip))
      : null;
    const jumpAction = jumpActionClip
      ? mixer.clipAction(stripRootMotionTracks(jumpActionClip))
      : null;
    const jumpRunningAction = jumpRunningClip
      ? mixer.clipAction(stripRootMotionTracks(jumpRunningClip))
      : null;
    const happyAction = happyClip
      ? mixer.clipAction(stripRootMotionTracks(happyClip))
      : null;
    const sadAction = sadClip
      ? mixer.clipAction(stripRootMotionTracks(sadClip))
      : null;

    const allActions = [
      idleAction,
      walkAction,
      runningAction,
      jumpAction,
      jumpRunningAction,
      happyAction,
      sadAction,
    ].filter((action): action is THREE.AnimationAction => action !== null);

    [idleAction, walkAction, runningAction]
      .filter((action): action is THREE.AnimationAction => action !== null)
      .forEach((action) => {
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(1);
      });

    [jumpAction, jumpRunningAction, happyAction, sadAction]
      .filter((action): action is THREE.AnimationAction => action !== null)
      .forEach((action) => {
        action.enabled = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(1);
      });

    allActions.forEach((action) => {
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
    });

    actionsRef.current = {
      idle: idleAction,
      walk: walkAction,
      running: runningAction,
      jump: jumpAction,
      jump_running: jumpRunningAction,
      happy: happyAction,
      sad: sadAction,
    };

    rightArmBoneRef.current = findBoneByNameCandidates(
      character,
      RIGHT_ARM_BONE_NAME_CANDIDATES,
    );
    leftArmBoneRef.current = findBoneByNameCandidates(
      character,
      LEFT_ARM_BONE_NAME_CANDIDATES,
    );
    rightForeArmBoneRef.current = findBoneByNameCandidates(
      character,
      RIGHT_FOREARM_BONE_NAME_CANDIDATES,
    );
    leftForeArmBoneRef.current = findBoneByNameCandidates(
      character,
      LEFT_FOREARM_BONE_NAME_CANDIDATES,
    );
    rightHandBoneRef.current = findBoneByNameCandidates(
      character,
      RIGHT_HAND_BONE_NAME_CANDIDATES,
    );
    spineBoneRef.current = findBoneByNameCandidates(
      character,
      SPINE_BONE_NAME_CANDIDATES,
    );
    leftUpperLegBoneRef.current = findBoneByNameCandidates(
      character,
      LEFT_UPPER_LEG_BONE_NAME_CANDIDATES,
    );
    rightUpperLegBoneRef.current = findBoneByNameCandidates(
      character,
      RIGHT_UPPER_LEG_BONE_NAME_CANDIDATES,
    );
    leftLegBoneRef.current = findBoneByNameCandidates(
      character,
      LEFT_LEG_BONE_NAME_CANDIDATES,
    );
    rightLegBoneRef.current = findBoneByNameCandidates(
      character,
      RIGHT_LEG_BONE_NAME_CANDIDATES,
    );
    const mountedPoseRestQuaternions = mountedPoseRestQuaternionsRef.current;
    mountedPoseRestQuaternions.clear();
    cacheBoneRestQuaternion(mountedPoseRestQuaternions, spineBoneRef.current);
    cacheBoneRestQuaternion(mountedPoseRestQuaternions, leftArmBoneRef.current);
    cacheBoneRestQuaternion(mountedPoseRestQuaternions, rightArmBoneRef.current);
    cacheBoneRestQuaternion(
      mountedPoseRestQuaternions,
      leftForeArmBoneRef.current,
    );
    cacheBoneRestQuaternion(
      mountedPoseRestQuaternions,
      rightForeArmBoneRef.current,
    );
    cacheBoneRestQuaternion(
      mountedPoseRestQuaternions,
      leftUpperLegBoneRef.current,
    );
    cacheBoneRestQuaternion(
      mountedPoseRestQuaternions,
      rightUpperLegBoneRef.current,
    );
    cacheBoneRestQuaternion(mountedPoseRestQuaternions, leftLegBoneRef.current);
    cacheBoneRestQuaternion(mountedPoseRestQuaternions, rightLegBoneRef.current);
    fireballThrowActionRef.current = null;
    fireballThrowClipRef.current = null;
    lastProcessedFireballCastCountRef.current = fireballCastCountRef?.current ?? 0;

    const handleActionFinished = (event: THREE.Event): void => {
      if (!onEmoteFinished) {
        return;
      }

      const finishedAction = (
        event as THREE.Event & { action?: THREE.AnimationAction }
      ).action;
      if (!finishedAction) {
        return;
      }

      if (finishedAction === happyAction) {
        onEmoteFinished("happy");
        return;
      }

      if (finishedAction === sadAction) {
        onEmoteFinished("sad");
      }
    };
    mixer.addEventListener("finished", handleActionFinished);

    if (motionStateRef) {
      activeStateRef.current = motionStateRef.current;
    }
    const initialAction = resolveMotionAction(actionsRef.current, activeStateRef.current);
    if (initialAction) {
      initialAction.reset().fadeIn(DEFAULT_FADE_IN_SECONDS).play();
    }

    if (
      !idleAction ||
      !walkAction ||
      !runningAction ||
      !jumpAction ||
      !jumpRunningAction ||
      !happyAction ||
      !sadAction
    ) {
      console.warn("[CharacterActor] Missing expected clips.", {
        available: character.animations.map((clip) => clip.name),
      });
    }

    mixerRef.current = mixer;

    return () => {
      const throwAction = fireballThrowActionRef.current;
      const throwClip = fireballThrowClipRef.current;
      if (throwAction && throwClip) {
        throwAction.stop();
        mixer.uncacheAction(throwClip, character);
        mixer.uncacheClip(throwClip);
      }

      mixer.removeEventListener("finished", handleActionFinished);
      allActions.forEach((action) => action.stop());
      mixer.stopAllAction();
      mixer.uncacheRoot(character);
      mixerRef.current = null;
      actionsRef.current = {
        idle: null,
        walk: null,
        running: null,
        jump: null,
        jump_running: null,
        happy: null,
        sad: null,
      };
      rightArmBoneRef.current = null;
      leftArmBoneRef.current = null;
      rightForeArmBoneRef.current = null;
      leftForeArmBoneRef.current = null;
      rightHandBoneRef.current = null;
      spineBoneRef.current = null;
      leftUpperLegBoneRef.current = null;
      rightUpperLegBoneRef.current = null;
      leftLegBoneRef.current = null;
      rightLegBoneRef.current = null;
      mountedPoseRestQuaternions.clear();
      fireballThrowActionRef.current = null;
      fireballThrowClipRef.current = null;
      lastProcessedFireballCastCountRef.current = 0;
    };
  }, [character, fireballCastCountRef, motionStateRef, onEmoteFinished]);

  useFrame((_, deltaSeconds) => {
    const dt = Math.max(deltaSeconds, MIN_DELTA_SECONDS);

    const mixer = mixerRef.current;
    if (mixer) {
      mixer.update(dt);
    }

    const activeThrowAction = fireballThrowActionRef.current;
    const activeThrowClip = fireballThrowClipRef.current;
    if (mixer && activeThrowAction && activeThrowClip && !activeThrowAction.isRunning()) {
      activeThrowAction.stop();
      mixer.uncacheAction(activeThrowClip, character);
      mixer.uncacheClip(activeThrowClip);
      fireballThrowActionRef.current = null;
      fireballThrowClipRef.current = null;
    }

    const latestFireballCastCount = fireballCastCountRef?.current ?? 0;
    const lastProcessedFireballCastCount = lastProcessedFireballCastCountRef.current;
    if (latestFireballCastCount > lastProcessedFireballCastCount) {
      lastProcessedFireballCastCountRef.current = latestFireballCastCount;
      const rightArmBone = rightArmBoneRef.current;
      const rightForeArmBone = rightForeArmBoneRef.current;
      const rightHandBone = rightHandBoneRef.current;
      if (mixer && rightArmBone && rightForeArmBone) {
        const scratch = fireballThrowOverlayScratchRef.current;
        character.getWorldQuaternion(scratch.characterWorldQuaternion);
        character.getWorldDirection(scratch.bodyForwardDirection);
        const bodyForwardLengthSquared = scratch.bodyForwardDirection.lengthSq();
        if (bodyForwardLengthSquared > MIN_DELTA_SECONDS) {
          scratch.bodyForwardDirection.multiplyScalar(
            1 / Math.sqrt(bodyForwardLengthSquared),
          );
        } else {
          scratch.bodyForwardDirection.set(0, 0, 1);
        }
        scratch.bodyUpDirection
          .set(0, 1, 0)
          .applyQuaternion(scratch.characterWorldQuaternion)
          .normalize();
        scratch.upperArmThrowDirection
          .copy(scratch.bodyForwardDirection)
          .multiplyScalar(FIREBALL_THROW_UPPER_ARM_FORWARD_WEIGHT)
          .addScaledVector(
            scratch.bodyUpDirection,
            FIREBALL_THROW_UPPER_ARM_UP_WEIGHT,
          )
          .normalize();
        scratch.foreArmThrowDirection
          .copy(scratch.bodyForwardDirection)
          .multiplyScalar(FIREBALL_THROW_FOREARM_FORWARD_WEIGHT)
          .addScaledVector(scratch.bodyUpDirection, FIREBALL_THROW_FOREARM_UP_WEIGHT)
          .normalize();

        const upperArmDelta = fireballThrowUpperArmDeltaRef.current;
        const hasUpperArmDelta = computeDirectionalBoneDelta({
          bone: rightArmBone,
          childBone: rightForeArmBone,
          targetWorldDirection: scratch.upperArmThrowDirection,
          blend: FIREBALL_THROW_UPPER_ARM_BLEND,
          outputDelta: upperArmDelta,
          scratch,
        });
        if (hasUpperArmDelta) {
          const foreArmDelta = fireballThrowForeArmDeltaRef.current;
          const hasForeArmDelta = rightHandBone
            ? computeDirectionalBoneDelta({
                bone: rightForeArmBone,
                childBone: rightHandBone,
                targetWorldDirection: scratch.foreArmThrowDirection,
                blend: FIREBALL_THROW_FOREARM_BLEND,
                outputDelta: foreArmDelta,
                scratch,
              })
            : false;

          const previousThrowAction = fireballThrowActionRef.current;
          const previousThrowClip = fireballThrowClipRef.current;
          if (previousThrowAction && previousThrowClip) {
            previousThrowAction.stop();
            mixer.uncacheAction(previousThrowClip, character);
            mixer.uncacheClip(previousThrowClip);
          }

          const throwClip = createFireballThrowClip({
            upperArmBone: rightArmBone,
            upperArmDelta,
            foreArmBone: hasForeArmDelta ? rightForeArmBone : null,
            foreArmDelta: hasForeArmDelta ? foreArmDelta : null,
          });
          const throwAction = mixer.clipAction(throwClip);
          throwAction.enabled = true;
          throwAction.setLoop(THREE.LoopOnce, 1);
          throwAction.clampWhenFinished = false;
          throwAction.setEffectiveWeight(1);
          throwAction.setEffectiveTimeScale(1);
          throwAction.reset().play();
          fireballThrowActionRef.current = throwAction;
          fireballThrowClipRef.current = throwClip;
        }
      }
    } else if (latestFireballCastCount < lastProcessedFireballCastCount) {
      lastProcessedFireballCastCountRef.current = latestFireballCastCount;
    }

    const nextState = motionStateRef?.current ?? motionState;
    const currentState = activeStateRef.current;
    if (nextState !== currentState) {
      const currentAction = resolveMotionAction(actionsRef.current, currentState);
      const nextAction = resolveMotionAction(actionsRef.current, nextState);
      if (nextAction) {
        if (currentAction && currentAction !== nextAction) {
          currentAction.fadeOut(STATE_BLEND_DURATION_SECONDS);
        }
        if (currentAction !== nextAction) {
          nextAction.reset().fadeIn(STATE_BLEND_DURATION_SECONDS).play();
        }
        activeStateRef.current = nextState;
      }
    }

    const speed = planarSpeedRef?.current ?? 0;

    const walkAction = actionsRef.current.walk;
    if (walkAction) {
      const walkSpeedRatio =
        WALK_ANIM_REFERENCE_SPEED > 0 ? speed / WALK_ANIM_REFERENCE_SPEED : 1;
      walkAction.setEffectiveTimeScale(
        WALK_TIME_SCALE * Math.max(walkSpeedRatio, MIN_DELTA_SECONDS),
      );
    }

    const runningAction = actionsRef.current.running;
    if (runningAction) {
      const runSpeedRatio =
        RUN_ANIM_REFERENCE_SPEED > 0 ? speed / RUN_ANIM_REFERENCE_SPEED : 1;
      runningAction.setEffectiveTimeScale(
        RUNNING_TIME_SCALE * Math.max(runSpeedRatio, MIN_DELTA_SECONDS),
      );
    }

    const jumpAction = actionsRef.current.jump;
    if (jumpAction) {
      const jumpDuration = Math.max(
        jumpAction.getClip().duration,
        MIN_DELTA_SECONDS,
      );
      const jumpPlaybackScale = jumpDuration / JUMP_AIR_TIME_SECONDS;
      jumpAction.setEffectiveTimeScale(JUMP_TIME_SCALE * jumpPlaybackScale);
    }

    const jumpRunningAction = actionsRef.current.jump_running;
    if (jumpRunningAction) {
      const jumpRunDuration = Math.max(
        jumpRunningAction.getClip().duration,
        MIN_DELTA_SECONDS,
      );
      const jumpRunPlaybackScale = jumpRunDuration / JUMP_AIR_TIME_SECONDS;
      jumpRunningAction.setEffectiveTimeScale(
        JUMP_RUNNING_TIME_SCALE * jumpRunPlaybackScale,
      );
    }

    const happyAction = actionsRef.current.happy;
    if (happyAction) {
      happyAction.setEffectiveTimeScale(HAPPY_TIME_SCALE);
    }

    const sadAction = actionsRef.current.sad;
    if (sadAction) {
      sadAction.setEffectiveTimeScale(SAD_TIME_SCALE);
    }

    const mountedPoseBlend = THREE.MathUtils.clamp(
      mountedPoseBlendRef?.current ?? 0,
      0,
      1,
    );
    if (mountedPoseBlend > MIN_DELTA_SECONDS) {
      const mountedPoseRestQuaternions = mountedPoseRestQuaternionsRef.current;
      const mountedPoseEuler = mountedPoseEulerRef.current;
      const mountedPoseDeltaQuaternion = mountedPoseDeltaQuaternionRef.current;
      const mountedPoseTargetQuaternion = mountedPoseTargetQuaternionRef.current;
      applyMountedPoseToBone(
        spineBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_SPINE_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        leftArmBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_ARM_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        rightArmBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_ARM_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        leftForeArmBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_FOREARM_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        rightForeArmBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_FOREARM_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        leftUpperLegBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_UPPER_LEG_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        rightUpperLegBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_UPPER_LEG_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        leftLegBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_LEG_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
      applyMountedPoseToBone(
        rightLegBoneRef.current,
        mountedPoseRestQuaternions,
        MOUNTED_POSE_LEG_X,
        mountedPoseBlend,
        mountedPoseEuler,
        mountedPoseDeltaQuaternion,
        mountedPoseTargetQuaternion,
      );
    }
  });

  return (
    <group visible={!hidden}>
      <primitive object={character} />
    </group>
  );
}

useGLTF.preload(CHARACTER_PATH);
