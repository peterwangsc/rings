"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CHARACTER_PATH,
  DEFAULT_CHARACTER_TARGET_HEIGHT,
  DEFAULT_FADE_IN_SECONDS,
  HAPPY_TIME_SCALE,
  JUMP_AIR_TIME_SECONDS,
  JUMP_RUNNING_TIME_SCALE,
  JUMP_TIME_SCALE,
  MIN_DELTA_SECONDS,
  RUNNING_TIME_SCALE,
  SAD_TIME_SCALE,
  STATE_BLEND_DURATION_SECONDS,
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
const CLIP_STANDING_JUMP = "Standing Jump";
const CLIP_JUMP_RUN = "Jump-Run";
const CLIP_HAPPY = "Happy";
const CLIP_SAD = "Sad";

export function CharacterActor({
  motionState,
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

    const initialAction = resolveMotionAction(
      actionsRef.current,
      activeStateRef.current,
    );
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
    };
  }, [character, onEmoteFinished]);

  useEffect(() => {
    const currentState = activeStateRef.current;
    if (motionState === currentState) {
      return;
    }

    const currentAction = resolveMotionAction(actionsRef.current, currentState);
    const nextAction = resolveMotionAction(actionsRef.current, motionState);

    if (!nextAction) {
      return;
    }

    if (currentAction === nextAction) {
      activeStateRef.current = motionState;
      return;
    }

    if (currentAction && currentAction !== nextAction) {
      currentAction.fadeOut(STATE_BLEND_DURATION_SECONDS);
    }

    nextAction.reset().fadeIn(STATE_BLEND_DURATION_SECONDS).play();
    activeStateRef.current = motionState;
  }, [motionState]);

  useFrame((_, deltaSeconds) => {
    const dt = Math.max(deltaSeconds, MIN_DELTA_SECONDS);

    if (mixerRef.current) {
      mixerRef.current.update(dt);
    }

    const walkAction = actionsRef.current.walk;
    if (walkAction) {
      walkAction.setEffectiveTimeScale(WALK_TIME_SCALE);
    }

    const runningAction = actionsRef.current.running;
    if (runningAction) {
      runningAction.setEffectiveTimeScale(RUNNING_TIME_SCALE);
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
  });

  return (
    <group visible={!hidden}>
      <primitive object={character} />
    </group>
  );
}

useGLTF.preload(CHARACTER_PATH);
